import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import {
  PL3_DATABASE_LATEST_SCHEMA_VERSION,
  applyPl3SchemaMigration,
  backupPl3Database,
  createLotteryMcpClient,
  createPl3PredictionService,
  hasPl3Database,
  openPl3Store,
  previewPl3SchemaMigration,
  resolvePl3DatabasePath,
  restorePl3Database,
  writeJsonAtomically,
  type LotteryMcpConfig,
  type Pl3PlayType,
  type Pl3PredictionResult,
  type Pl3PredictionLedger,
} from 'lotterymcp-core'
import { MCP_SERVER_TOOLS } from 'lotterymcp-server'
import { syncOfficialPl3ToStore, type SyncOfficialPl3StoreResult } from './official-sync.js'

const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')

const safeRelativePath = (value: string) => {
  const normalized = value.replaceAll('\\', '/').replace(/^\/+/, '')
  if (!normalized || normalized.includes('..')) throw new Error(`不安全的相对路径: ${value}`)
  return normalized
}

const readFileHash = async (filePath: string) => sha256(await readFile(filePath))

const copyIfExists = async (source: string, target: string) => {
  if (!existsSync(source)) return null
  await mkdir(path.dirname(target), { recursive: true })
  await copyFile(source, target)
  return target
}

const atomicWriteText = async (targetPath: string, text: string) => {
  await mkdir(path.dirname(targetPath), { recursive: true })
  const temporaryPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporaryPath, text, 'utf8')
  await rename(temporaryPath, targetPath)
}

const beijingFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const toBeijingDay = (date = new Date()) => beijingFormatter.format(date)

const canonicalize = (value: unknown): string => {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item)).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
    .join(',')}}`
}

const readJsonIfExists = async <T>(filePath: string, fallback: T): Promise<T> => {
  if (!existsSync(filePath)) return fallback
  return JSON.parse(await readFile(filePath, 'utf8')) as T
}

const base64Url = (buffer: Buffer) =>
  buffer.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')

const webAssetsDir = () => path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'web')

export type Pl3DataBundleManifest = {
  version: 1
  createdAt: string
  dataDir: string
  database: {
    file: 'pl3.sqlite'
    sha256: string
    bytes: number
  }
  ledger?: {
    file: 'pl3-predictions.json'
    sha256: string
    bytes: number
  }
}

export const createPl3DataBundle = async (input: {
  dataDir: string
  outputDir: string
}) => {
  const dataDir = path.resolve(input.dataDir)
  if (!hasPl3Database(dataDir)) throw new Error('尚未启用 SQLite，无法创建迁移 bundle。')
  const outputDir = path.resolve(input.outputDir)
  await mkdir(outputDir, { recursive: true })
  const backup = await backupPl3Database(dataDir)
  const databaseTarget = path.join(outputDir, 'pl3.sqlite')
  await copyFile(backup.backupPath, databaseTarget)

  const ledgerSource = path.join(dataDir, 'pl3-predictions.json')
  const ledgerTarget = await copyIfExists(ledgerSource, path.join(outputDir, 'pl3-predictions.json'))
  const databaseStat = await stat(databaseTarget)
  const manifest: Pl3DataBundleManifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    dataDir,
    database: {
      file: 'pl3.sqlite',
      sha256: await readFileHash(databaseTarget),
      bytes: databaseStat.size,
    },
    ...(ledgerTarget ? {
      ledger: {
        file: 'pl3-predictions.json',
        sha256: await readFileHash(ledgerTarget),
        bytes: (await stat(ledgerTarget)).size,
      },
    } : {}),
  }
  await writeJsonAtomically(path.join(outputDir, 'manifest.json'), manifest)
  return { outputDir, manifest, sourceBackupPath: backup.backupPath }
}

export const verifyPl3DataBundle = async (bundleDir: string) => {
  const resolvedBundleDir = path.resolve(bundleDir)
  const manifestPath = path.join(resolvedBundleDir, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Pl3DataBundleManifest
  if (manifest.version !== 1) throw new Error(`不支持的 bundle 版本: ${manifest.version}`)
  const databasePath = path.join(resolvedBundleDir, safeRelativePath(manifest.database.file))
  const databaseHash = await readFileHash(databasePath)
  const databaseStat = await stat(databasePath)
  const checks: Array<{
    file: string
    expectedSha256: string
    actualSha256: string
    expectedBytes: number
    actualBytes: number
    valid: boolean
  }> = [{
    file: manifest.database.file,
    expectedSha256: manifest.database.sha256,
    actualSha256: databaseHash,
    expectedBytes: manifest.database.bytes,
    actualBytes: databaseStat.size,
    valid: databaseHash === manifest.database.sha256 && databaseStat.size === manifest.database.bytes,
  }]
  if (manifest.ledger) {
    const ledgerPath = path.join(resolvedBundleDir, safeRelativePath(manifest.ledger.file))
    const ledgerHash = await readFileHash(ledgerPath)
    const ledgerStat = await stat(ledgerPath)
    checks.push({
      file: manifest.ledger.file,
      expectedSha256: manifest.ledger.sha256,
      actualSha256: ledgerHash,
      expectedBytes: manifest.ledger.bytes,
      actualBytes: ledgerStat.size,
      valid: ledgerHash === manifest.ledger.sha256 && ledgerStat.size === manifest.ledger.bytes,
    })
  }
  return {
    bundleDir: resolvedBundleDir,
    manifest,
    valid: checks.every((item) => item.valid),
    checks,
  }
}

export const restorePl3DataBundle = async (input: {
  dataDir: string
  bundleDir: string
}) => {
  const verification = await verifyPl3DataBundle(input.bundleDir)
  if (!verification.valid) throw new Error('bundle 校验失败，拒绝恢复。')
  const dataDir = path.resolve(input.dataDir)
  const databasePath = path.join(verification.bundleDir, verification.manifest.database.file)
  const restored = await restorePl3Database(dataDir, databasePath)
  let ledgerRestoredPath: string | null = null
  if (verification.manifest.ledger) {
    const source = path.join(verification.bundleDir, verification.manifest.ledger.file)
    const target = path.join(dataDir, 'pl3-predictions.json')
    if (existsSync(target)) {
      await copyFile(target, path.join(dataDir, `pl3-predictions.${Date.now()}.json.bak`))
    }
    await copyFile(source, target)
    ledgerRestoredPath = target
  }
  return { ...restored, ledgerRestoredPath, verification }
}

const renderMarkdownReport = (input: {
  generatedAt: string
  runId: string
  prediction: Pl3PredictionResult
  sync?: SyncOfficialPl3StoreResult
}) => [
  '# Lotterymcp P3 Daily Report',
  '',
  `Run ID: ${input.runId}`,
  `Generated at: ${input.generatedAt}`,
  `After period: ${input.prediction.afterPeriod}`,
  `Prediction ID: ${input.prediction.predictionId}`,
  `Training records: ${input.prediction.training.recordCount}`,
  `Play/tickets: ${input.prediction.query.playType}/${input.prediction.query.tickets}`,
  `Settlement: ${input.prediction.settlement.status}`,
  '',
  '## Tickets',
  '',
  ...input.prediction.tickets.map((ticket) =>
    `- ${ticket.rank}. ${ticket.playType} ${ticket.display} score=${ticket.score}`),
  '',
  '## Backtest',
  '',
  input.prediction.backtest.status === 'complete'
    ? `Cost ${input.prediction.backtest.totalCost}, return ${input.prediction.backtest.totalReturn}, ROI ${input.prediction.backtest.roi}.`
    : 'Insufficient data for backtest.',
  input.prediction.payouts.note,
  '',
  ...(input.sync ? [
    '## Sync',
    '',
    `Provider: ${input.sync.provider}`,
    `Records: ${input.sync.records.length}`,
    `Confirmed/single-source/conflict: ${input.sync.confirmedRecords}/${input.sync.singleSourceRecords}/${input.sync.conflictRecords}`,
  ] : []),
  '',
].join('\n')

export type Pl3DailyReportSummary = {
  runId: string
  day: string
  generatedAt: string
  predictionId: string
  afterPeriod: string
  reportPath: string
  markdownPath: string
  reportHash: string
  snapshotSettlement: Pl3PredictionResult['settlement']
}

export type Pl3DailyReportIndex = {
  version: 1
  updatedAt: string
  reports: Pl3DailyReportSummary[]
}

const reportsRoot = (dataDir: string) => path.join(path.resolve(dataDir), 'reports')
const reportIndexPath = (dataDir: string) => path.join(reportsRoot(dataDir), 'index.json')
const latestReportPath = (dataDir: string) => path.join(reportsRoot(dataDir), 'latest.json')

const upsertReportIndex = async (dataDir: string, summary: Pl3DailyReportSummary) => {
  const index = await readJsonIfExists<Pl3DailyReportIndex>(reportIndexPath(dataDir), {
    version: 1,
    updatedAt: summary.generatedAt,
    reports: [],
  })
  const reports = [
    summary,
    ...index.reports.filter((item) => item.runId !== summary.runId),
  ].sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))
  const nextIndex: Pl3DailyReportIndex = {
    version: 1,
    updatedAt: new Date().toISOString(),
    reports,
  }
  await writeJsonAtomically(reportIndexPath(dataDir), nextIndex)
  await writeJsonAtomically(latestReportPath(dataDir), summary)
  return nextIndex
}

const renderHtmlReport = (markdown: string) => {
  const escaped = markdown
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Lotterymcp P3 Daily Report</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 32px; color: #172026; background: #f6f7f9; }
    main { max-width: 920px; margin: 0 auto; background: #fff; border: 1px solid #d7dde5; border-radius: 8px; padding: 24px; }
    pre { white-space: pre-wrap; line-height: 1.55; font-size: 14px; }
  </style>
</head>
<body><main><pre>${escaped}</pre></main></body>
</html>
`
}

export const writePl3DailyReport = async (input: {
  dataDir: string
  runId: string
  prediction: Pl3PredictionResult
  sync?: SyncOfficialPl3StoreResult
}) => {
  const generatedAt = new Date().toISOString()
  const day = toBeijingDay(new Date(generatedAt))
  const reportDir = path.join(reportsRoot(input.dataDir), 'daily', day, input.runId)
  const markdown = renderMarkdownReport({ generatedAt, runId: input.runId, prediction: input.prediction, sync: input.sync })
  const payload = {
    runId: input.runId,
    generatedAt,
    prediction: input.prediction,
    sync: input.sync ? {
      provider: input.sync.provider,
      records: input.sync.records.length,
      confirmedRecords: input.sync.confirmedRecords,
      singleSourceRecords: input.sync.singleSourceRecords,
      conflictRecords: input.sync.conflictRecords,
      warnings: input.sync.warnings,
    } : null,
  }
  await mkdir(reportDir, { recursive: true })
  await atomicWriteText(path.join(reportDir, 'report.md'), markdown)
  await writeJsonAtomically(path.join(reportDir, 'report.json'), payload)
  await atomicWriteText(path.join(reportDir, 'index.html'), renderHtmlReport(markdown))
  const reportHash = sha256(canonicalize(payload))
  const summary: Pl3DailyReportSummary = {
    runId: input.runId,
    day,
    generatedAt,
    predictionId: input.prediction.predictionId,
    afterPeriod: input.prediction.afterPeriod,
    reportPath: path.relative(reportsRoot(input.dataDir), path.join(reportDir, 'report.json')).replaceAll('\\', '/'),
    markdownPath: path.relative(reportsRoot(input.dataDir), path.join(reportDir, 'report.md')).replaceAll('\\', '/'),
    reportHash,
    snapshotSettlement: input.prediction.settlement,
  }
  await upsertReportIndex(input.dataDir, summary)
  return {
    reportDir,
    reportPath: path.join(reportDir, 'report.json'),
    markdownPath: path.join(reportDir, 'report.md'),
    htmlPath: path.join(reportDir, 'index.html'),
    reportHash,
    summary,
  }
}

const sendEnterpriseWechat = async (input: {
  webhookUrl?: string
  text: string
  dedupeKey: string
  dataDir: string
}) => {
  const webhookUrl = input.webhookUrl || process.env.LOTTERYMCP_WECHAT_WEBHOOK || process.env.WECOM_BOT_WEBHOOK
  if (!webhookUrl) return { skipped: true, channel: 'enterprise-wechat' as const }
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ msgtype: 'markdown', markdown: { content: input.text } }),
  })
  const rawText = await response.text()
  const ok = response.ok && /"errcode"\s*:\s*0/.test(rawText)
  if (hasPl3Database(input.dataDir)) {
    const store = openPl3Store({ dataDir: input.dataDir })
    try {
      if (store.getSchemaVersion() >= 3) {
        store.recordNotificationDelivery({
          channel: 'enterprise-wechat',
          dedupeKey: input.dedupeKey,
          status: ok ? 'success' : 'failed',
          target: new URL(webhookUrl).origin,
          messageHash: sha256(input.text),
          errorMessage: ok ? null : rawText.slice(0, 500),
        })
      }
    } finally {
      store.close()
    }
  }
  if (!ok) throw new Error(`企业微信通知失败: HTTP ${response.status} ${rawText.slice(0, 200)}`)
  return { skipped: false, channel: 'enterprise-wechat' as const }
}

type WebAccessMode = 'tunnel' | 'public'

type WebAuthConfig = {
  passwordHash: string
  passwordSalt: string
  totpSecret: string
  recoveryCodeHashes: string[]
  createdAt: string
}

const resolveWebAccessMode = (value: unknown): WebAccessMode =>
  String(value || process.env.LOTTERYMCP_WEB_ACCESS_MODE || 'tunnel').trim().toLowerCase() === 'public'
    ? 'public'
    : 'tunnel'

const resolveWebStateDir = (dataDir: string) =>
  path.resolve(process.env.LOTTERYMCP_WEB_STATE_DIR || path.join(path.dirname(path.resolve(dataDir)), 'web-state'))

const resolveWebSecretPath = (dataDir: string) =>
  path.resolve(process.env.LOTTERYMCP_WEB_AUTH_CONFIG || path.join(path.dirname(path.resolve(dataDir)), 'secrets', 'web-auth.json'))

const hashPassword = (password: string, salt = randomBytes(16).toString('hex')) => ({
  salt,
  hash: scryptSync(password, salt, 32, { N: 32768, r: 8, p: 1 }).toString('hex'),
})

const verifyHash = (actualHex: string, expectedHex: string) => {
  const actual = Buffer.from(actualHex, 'hex')
  const expected = Buffer.from(expectedHex, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

const toBase32 = (buffer: Buffer) => {
  let bits = ''
  let output = ''
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0')
  for (let index = 0; index < bits.length; index += 5) {
    const chunk = bits.slice(index, index + 5).padEnd(5, '0')
    output += base32Alphabet[parseInt(chunk, 2)]
  }
  return output
}

const fromBase32 = (value: string) => {
  const clean = value.replaceAll('=', '').replace(/\s+/g, '').toUpperCase()
  let bits = ''
  for (const char of clean) {
    const index = base32Alphabet.indexOf(char)
    if (index < 0) throw new Error('TOTP secret 格式无效。')
    bits += index.toString(2).padStart(5, '0')
  }
  const bytes: number[] = []
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(parseInt(bits.slice(index, index + 8), 2))
  }
  return Buffer.from(bytes)
}

const generateTotp = (secret: string, step = Math.floor(Date.now() / 30000)) => {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))
  const hmac = createHmac('sha1', fromBase32(secret)).update(counter).digest()
  const offset = hmac[hmac.length - 1]! & 0xf
  const binary = ((hmac[offset]! & 0x7f) << 24)
    | (hmac[offset + 1]! << 16)
    | (hmac[offset + 2]! << 8)
    | hmac[offset + 3]!
  return String(binary % 1_000_000).padStart(6, '0')
}

const createWebAuthDatabase = (webStateDir: string) => {
  mkdirSync(webStateDir, { recursive: true })
  const database = new Database(path.join(webStateDir, 'web-auth.sqlite'))
  database.pragma('journal_mode = WAL')
  database.pragma('busy_timeout = 2000')
  database.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      absolute_expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS login_attempts (
      ip TEXT PRIMARY KEY,
      failed_count INTEGER NOT NULL,
      last_failed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS totp_replay (
      code_step TEXT PRIMARY KEY,
      used_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_audit (
      audit_id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      ip TEXT,
      details_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
  `)
  return database
}

export const createWebAuthConfig = async (input: {
  dataDir: string
  password: string
  secretPath?: string
}) => {
  if (input.password.length < 10) throw new Error('Web 访问口令至少需要 10 个字符。')
  const secretPath = path.resolve(input.secretPath || resolveWebSecretPath(input.dataDir))
  const password = hashPassword(input.password)
  const recoveryCodes = Array.from({ length: 10 }, () => base64Url(randomBytes(10)))
  const config: WebAuthConfig = {
    passwordHash: password.hash,
    passwordSalt: password.salt,
    totpSecret: toBase32(randomBytes(20)),
    recoveryCodeHashes: recoveryCodes.map((code) => sha256(code)),
    createdAt: new Date().toISOString(),
  }
  await mkdir(path.dirname(secretPath), { recursive: true })
  await writeJsonAtomically(secretPath, config)
  return { secretPath, totpSecret: config.totpSecret, recoveryCodes }
}

const loadWebAuthConfig = async (dataDir: string) => readJsonIfExists<WebAuthConfig | null>(resolveWebSecretPath(dataDir), null)

const parseCookies = (header: string | undefined) =>
  Object.fromEntries(String(header || '').split(';').map((item) => {
    const [key, ...rest] = item.trim().split('=')
    return [key, decodeURIComponent(rest.join('='))]
  }).filter(([key]) => key))

const readRequestJson = async (request: http.IncomingMessage) => {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  const body = Buffer.concat(chunks).toString('utf8')
  return body ? JSON.parse(body) as Record<string, unknown> : {}
}

const sendJson = (response: http.ServerResponse, statusCode: number, data: unknown, meta: Record<string, unknown> = {}) => {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify({ data, meta }))
}

const sendText = (response: http.ServerResponse, statusCode: number, text: string) => {
  response.writeHead(statusCode, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
  response.end(text)
}

const getCurrentSettlement = async (dataDir: string, predictionId?: string | null) => {
  if (!predictionId) return null
  const ledgerPath = path.join(path.resolve(dataDir), 'pl3-predictions.json')
  const ledger = await readJsonIfExists<Pl3PredictionLedger>(ledgerPath, { version: 1, predictions: [] })
  return ledger.predictions.find((item) => item.predictionId === predictionId)?.settlement || null
}

const listDailyReports = async (dataDir: string, limit = 20) => {
  const index = await readJsonIfExists<Pl3DailyReportIndex>(reportIndexPath(dataDir), {
    version: 1,
    updatedAt: new Date().toISOString(),
    reports: [],
  })
  return index.reports.slice(0, Math.max(1, Math.min(100, limit)))
}

const readReportDetail = async (dataDir: string, runId: string) => {
  const reports = await listDailyReports(dataDir, 100)
  const summary = reports.find((item) => item.runId === runId)
  if (!summary) return null
  const reportRoot = reportsRoot(dataDir)
  const reportPath = path.resolve(reportRoot, safeRelativePath(summary.reportPath))
  const markdownPath = path.resolve(reportRoot, safeRelativePath(summary.markdownPath))
  if (!reportPath.startsWith(path.resolve(reportRoot)) || !markdownPath.startsWith(path.resolve(reportRoot))) {
    throw new Error('日报路径越界。')
  }
  const payload = JSON.parse(await readFile(reportPath, 'utf8')) as {
    generatedAt: string
    prediction: Pl3PredictionResult
    sync: unknown
  }
  const markdown = await readFile(markdownPath, 'utf8')
  return {
    summary,
    payload,
    markdown,
    currentSettlement: await getCurrentSettlement(dataDir, payload.prediction.predictionId),
  }
}

const createWebSessionManager = async (input: {
  dataDir: string
  accessMode: WebAccessMode
}) => {
  const authRequired = input.accessMode === 'public'
  const webStateDir = resolveWebStateDir(input.dataDir)
  const database = createWebAuthDatabase(webStateDir)
  const config = authRequired ? await loadWebAuthConfig(input.dataDir) : null
  if (authRequired && !config) throw new Error(`公网模式必须先初始化 Web 认证: ${resolveWebSecretPath(input.dataDir)}`)

  const audit = (eventType: string, ip: string | null, details: Record<string, unknown> = {}) => {
    database.prepare('INSERT INTO auth_audit(event_type, ip, details_json, created_at) VALUES (?, ?, ?, ?)')
      .run(eventType, ip, canonicalize(details), new Date().toISOString())
  }

  const getSession = (request: http.IncomingMessage) => {
    if (!authRequired) return { authenticated: true }
    const sessionId = parseCookies(request.headers.cookie).lotterymcp_session
    if (!sessionId) return { authenticated: false }
    const now = new Date().toISOString()
    const row = database.prepare(`
      SELECT * FROM sessions WHERE session_id = ?
        AND expires_at > ? AND absolute_expires_at > ?
    `).get(sessionId, now, now) as any
    if (!row) return { authenticated: false }
    const nextExpires = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString()
    database.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE session_id = ?')
      .run(now, nextExpires, sessionId)
    return { authenticated: true, sessionId }
  }

  const login = async (request: http.IncomingMessage, response: http.ServerResponse) => {
    if (!authRequired || !config) return sendJson(response, 200, { authenticated: true })
    const ip = request.socket.remoteAddress || 'unknown'
    const attempt = database.prepare('SELECT * FROM login_attempts WHERE ip = ?').get(ip) as any
    if (attempt && Number(attempt.failed_count) >= 8 && Date.now() - Date.parse(String(attempt.last_failed_at)) < 15 * 60 * 1000) {
      audit('login-throttled', ip)
      return sendText(response, 429, '登录尝试过多，请稍后再试。')
    }
    const body = await readRequestJson(request)
    const password = String(body.password || '')
    const totp = String(body.totp || '').trim()
    const hashed = hashPassword(password, config.passwordSalt)
    const passwordOk = verifyHash(hashed.hash, config.passwordHash)
    const step = Math.floor(Date.now() / 30000)
    const totpOk = [-1, 0, 1].some((offset) => generateTotp(config.totpSecret, step + offset) === totp)
    const replayKey = `${step}:${totp}`
    const replay = totpOk ? database.prepare('SELECT code_step FROM totp_replay WHERE code_step = ?').get(replayKey) : null
    if (!passwordOk || !totpOk || replay) {
      database.prepare(`
        INSERT INTO login_attempts(ip, failed_count, last_failed_at) VALUES (?, 1, ?)
        ON CONFLICT(ip) DO UPDATE SET failed_count = failed_count + 1, last_failed_at = excluded.last_failed_at
      `).run(ip, new Date().toISOString())
      audit('login-failed', ip, { passwordOk, totpOk, replay: Boolean(replay) })
      return sendText(response, 401, '口令或动态验证码无效。')
    }
    database.prepare('DELETE FROM login_attempts WHERE ip = ?').run(ip)
    database.prepare('INSERT OR IGNORE INTO totp_replay(code_step, used_at) VALUES (?, ?)').run(replayKey, new Date().toISOString())
    const sessionId = base64Url(randomBytes(32))
    const now = new Date()
    database.prepare(`
      INSERT INTO sessions(session_id, created_at, last_seen_at, expires_at, absolute_expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      sessionId,
      now.toISOString(),
      now.toISOString(),
      new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString(),
      new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    )
    audit('login-success', ip)
    response.setHeader('set-cookie', `lotterymcp_session=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${input.accessMode === 'public' ? '; Secure' : ''}`)
    return sendJson(response, 200, { authenticated: true })
  }

  const logout = (request: http.IncomingMessage, response: http.ServerResponse) => {
    const sessionId = parseCookies(request.headers.cookie).lotterymcp_session
    if (sessionId) database.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId)
    response.setHeader('set-cookie', 'lotterymcp_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0')
    return sendJson(response, 200, { authenticated: false })
  }

  return {
    authRequired,
    getSession,
    login,
    logout,
    close: () => database.close(),
  }
}

export const runPl3DailyOnce = async (input: {
  config: LotteryMcpConfig
  periods?: number
  tickets?: number
  playType?: Pl3PlayType
  sync?: boolean
  migrate?: boolean
  notify?: boolean
}) => {
  const dataDir = path.resolve(String(input.config.dataDir || '.lotterymcp-data'))
  const runId = `p3-${new Date().toISOString().replace(/[:.]/g, '-')}`
  let syncResult: SyncOfficialPl3StoreResult | undefined
  let storeOpened = false

  if (input.sync !== false) {
    syncResult = await syncOfficialPl3ToStore({
      dataDir,
      limit: Math.max(input.periods || 500, 500),
      full: false,
      provider: 'auto',
      resume: true,
    })
  }

  if (hasPl3Database(dataDir)) {
    const preview = previewPl3SchemaMigration(dataDir)
    if (preview.migrationRequired) {
      if (!input.migrate) {
        throw new Error(`每日任务需要 schema ${preview.targetVersion}，请先运行 data migrate --apply，或本命令追加 --migrate。`)
      }
      await applyPl3SchemaMigration(dataDir)
    }
    const store = openPl3Store({ dataDir })
    try {
      storeOpened = true
      store.recordOnlinePredictionRun({
        runId,
        status: 'running',
        dataMode: input.config.dataMode || 'official',
      })
    } finally {
      store.close()
    }
  }

  try {
    const client = createLotteryMcpClient({
      apiBaseUrl: input.config.apiBaseUrl,
      token: input.config.token,
      defaultPeriods: input.config.defaultPeriods,
      dataMode: input.config.dataMode || 'official',
      dataDir,
    })
    const service = createPl3PredictionService(client, {
      dataDir,
      defaultPeriods: input.periods || 200,
    })
    const envelope = await service.predict({
      periods: input.periods,
      tickets: input.tickets,
      playType: input.playType,
    })
    const report = await writePl3DailyReport({
      dataDir,
      runId,
      prediction: envelope.data,
      sync: syncResult,
    })
    if (storeOpened) {
      const store = openPl3Store({ dataDir })
      try {
        store.recordOnlinePredictionRun({
          runId,
          predictionId: envelope.data.predictionId,
          status: 'success',
          dataMode: input.config.dataMode || 'official',
          afterPeriod: envelope.data.afterPeriod,
          targetPeriod: envelope.data.settlement.targetPeriod || null,
          reportPath: path.relative(dataDir, report.reportPath).replaceAll('\\', '/'),
          reportHash: report.reportHash,
          completedAt: new Date().toISOString(),
        })
        store.recordOperationalEvent({
          level: 'info',
          eventType: 'daily-run-success',
          message: `每日排列3预测完成，截止期号 ${envelope.data.afterPeriod}。`,
          details: { predictionId: envelope.data.predictionId, reportPath: report.reportPath },
        })
      } finally {
        store.close()
      }
    }
    const notification = input.notify === false ? { skipped: true } : await sendEnterpriseWechat({
      dataDir,
      dedupeKey: envelope.data.predictionId,
      text: [
        '### Lotterymcp P3 每日预测完成',
        `> 截止期号: ${envelope.data.afterPeriod}`,
        `> 预测ID: ${envelope.data.predictionId}`,
        `> 注数: ${envelope.data.query.tickets}`,
        `> 报告: ${report.reportPath}`,
      ].join('\n'),
    })
    return { runId, prediction: envelope.data, report, sync: syncResult, notification }
  } catch (error) {
    if (storeOpened) {
      const store = openPl3Store({ dataDir })
      try {
        store.recordOnlinePredictionRun({
          runId,
          status: 'failed',
          dataMode: input.config.dataMode || 'official',
          errorMessage: error instanceof Error ? error.message : String(error),
          completedAt: new Date().toISOString(),
        })
        store.recordOperationalEvent({
          level: 'error',
          eventType: 'daily-run-failed',
          message: error instanceof Error ? error.message : String(error),
        })
      } finally {
        store.close()
      }
    }
    throw error
  }
}

const contentTypeFor = (filePath: string) => {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8'
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8'
  if (filePath.endsWith('.md')) return 'text/markdown; charset=utf-8'
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8'
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8'
  if (filePath.endsWith('.svg')) return 'image/svg+xml'
  if (filePath.endsWith('.ico')) return 'image/x-icon'
  return 'text/plain; charset=utf-8'
}

export const servePl3Reports = async (input: {
  dataDir: string
  host?: string
  port?: number
  accessMode?: WebAccessMode
}) => {
  const dataDir = path.resolve(input.dataDir)
  const reportsDir = reportsRoot(dataDir)
  const assetsDir = webAssetsDir()
  await mkdir(reportsDir, { recursive: true })
  const host = input.host || '127.0.0.1'
  const port = input.port || 4317
  const accessMode = resolveWebAccessMode(input.accessMode)
  const sessionManager = await createWebSessionManager({ dataDir, accessMode })

  const requireSession = (request: http.IncomingMessage, response: http.ServerResponse) => {
    const session = sessionManager.getSession(request)
    if (!session.authenticated) {
      sendText(response, 401, '需要登录。')
      return false
    }
    return true
  }

  const handleApi = async (request: http.IncomingMessage, response: http.ServerResponse, url: URL) => {
    if (url.pathname === '/healthz') return sendJson(response, 200, { ok: true, service: 'lotterymcp-web' })
    if (url.pathname === '/readyz') {
      return sendJson(response, hasPl3Database(dataDir) ? 200 : 503, {
        ready: hasPl3Database(dataDir),
        database: hasPl3Database(dataDir) ? resolvePl3DatabasePath(dataDir) : null,
      })
    }
    if (url.pathname === '/api/v1/session') {
      const session = sessionManager.getSession(request)
      return sendJson(response, 200, {
        authenticated: session.authenticated,
        accessMode,
        authRequired: sessionManager.authRequired,
      })
    }
    if (url.pathname === '/api/v1/auth/login' && request.method === 'POST') {
      return sessionManager.login(request, response)
    }
    if (url.pathname === '/api/v1/auth/logout' && request.method === 'POST') {
      return sessionManager.logout(request, response)
    }
    if (!requireSession(request, response)) return undefined
    if (url.pathname === '/api/v1/overview') {
      if (!hasPl3Database(dataDir)) return sendText(response, 503, '尚未找到排列3 SQLite 数据库。')
      const store = openPl3Store({ dataDir, readonly: true, fileMustExist: true })
      try {
        const schemaVersion = store.getSchemaVersion()
        const status = store.getStatus()
        const runs = schemaVersion >= 3 ? store.listOnlinePredictionRuns({ limit: 1 }) : []
        const latestReport = (await listDailyReports(dataDir, 1))[0] || null
        const detail = latestReport ? await readReportDetail(dataDir, latestReport.runId) : null
        const ledgerPath = path.join(dataDir, 'pl3-predictions.json')
        const ledger = await readJsonIfExists<Pl3PredictionLedger>(ledgerPath, { version: 1, predictions: [] })
        const latestPrediction = detail?.payload.prediction || ledger.predictions.at(-1) || null
        const currentSettlement = await getCurrentSettlement(dataDir, latestPrediction?.predictionId || latestReport?.predictionId)
        sendJson(response, 200, {
          generatedAt: new Date().toISOString(),
          accessMode,
          data: {
            usableRecords: status.usableRecords,
            confirmedRecords: status.confirmedRecords,
            singleSourceRecords: status.singleSourceRecords,
            conflictRecords: status.conflictRecords,
            latestPeriod: status.latestPeriod,
            latestDrawDate: status.latestDrawDate,
            dualSourceCoverage: status.dualSourceCoverage,
          },
          latestRun: runs[0] || null,
          latestReport,
          latestPrediction,
          currentSettlement,
          ledger: {
            total: ledger.predictions.length,
            pending: ledger.predictions.filter((item) => item.settlement.status === 'pending').length,
            provisional: ledger.predictions.filter((item) => item.settlement.status === 'provisional').length,
            confirmed: ledger.predictions.filter((item) => item.settlement.status === 'confirmed').length,
            disputed: ledger.predictions.filter((item) => item.settlement.status === 'disputed').length,
            settled: ledger.predictions.filter((item) => item.settlement.status === 'settled').length,
          },
          tools: MCP_SERVER_TOOLS,
        })
      } finally {
        store.close()
      }
      return undefined
    }
    if (url.pathname === '/api/v1/reports') {
      const limit = Number(url.searchParams.get('limit') || 20)
      return sendJson(response, 200, { reports: await listDailyReports(dataDir, limit) })
    }
    const reportMatch = /^\/api\/v1\/reports\/([^/]+)$/.exec(url.pathname)
    if (reportMatch) {
      const detail = await readReportDetail(dataDir, decodeURIComponent(reportMatch[1]!))
      if (!detail) return sendText(response, 404, '日报不存在。')
      return sendJson(response, 200, detail)
    }
    if (url.pathname === '/api/v1/operations') {
      if (!hasPl3Database(dataDir)) return sendJson(response, 200, { runs: [], operations: [] })
      const store = openPl3Store({ dataDir, readonly: true, fileMustExist: true })
      try {
        const limit = Number(url.searchParams.get('limit') || 20)
        const schemaVersion = store.getSchemaVersion()
        return sendJson(response, 200, {
          runs: schemaVersion >= 3 ? store.listOnlinePredictionRuns({ limit }) : [],
          operations: schemaVersion >= 3 ? store.listOperationalEvents({ limit }) : [],
        })
      } finally {
        store.close()
      }
    }
    return sendText(response, 404, 'API not found')
  }

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', `http://${host}`)
      if (url.pathname === '/healthz' || url.pathname === '/readyz' || url.pathname.startsWith('/api/')) {
        await handleApi(request, response, url)
        return
      }
      const relative = safeRelativePath(url.pathname === '/' ? 'index.html' : url.pathname)
      let filePath = path.resolve(assetsDir, relative)
      if (!filePath.startsWith(path.resolve(assetsDir))) throw new Error('越界路径')
      if (!existsSync(filePath)) filePath = path.join(assetsDir, 'index.html')
      const body = await readFile(filePath)
      response.writeHead(200, { 'content-type': contentTypeFor(filePath), 'cache-control': filePath.endsWith('index.html') ? 'no-store' : 'public, max-age=31536000, immutable' })
      response.end(body)
    } catch (error) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      response.end(error instanceof Error ? error.message : 'Not found')
    }
  })
  await new Promise<void>((resolve) => server.listen(port, host, resolve))
  server.on('close', () => sessionManager.close())
  return { server, url: `http://${host}:${port}/`, reportsDir, assetsDir, accessMode }
}

export const listReportDays = async (dataDir: string) => {
  const dailyDir = path.join(path.resolve(dataDir), 'reports', 'daily')
  if (!existsSync(dailyDir)) return []
  return (await readdir(dailyDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse()
}

export const getPl3DatabasePathForOps = (dataDir: string) => resolvePl3DatabasePath(dataDir)
