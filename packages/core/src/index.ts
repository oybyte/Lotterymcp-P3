import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  PL3_DEFAULT_PERIODS,
  PL3_LOTTERY_TYPE,
  PL3_MAX_PERIODS,
  PL3_MIN_RECORDS,
  Pl3PredictionError,
  getPl3PredictionLedgerSummary,
  isValidPl3DrawDate,
  normalizePl3Records,
  predictPl3,
  settlePl3Predictions,
  upsertPl3Prediction,
  type Pl3PayoutConfig,
  type Pl3PredictionQuery,
  type Pl3PredictionResult,
  type Pl3LotteryType,
  type Pl3Record,
  type Pl3SourceRecord,
} from './pl3-prediction.js'
import { hasPl3Database, openPl3Store } from './pl3-store.js'

export * from './pl3-prediction.js'
export * from './pl3-store.js'
export * from './pl3-features.js'
export * from './pl3-experiments.js'

/** @deprecated Provider selection is dynamic. Read meta.provider instead. */
export const LOTTERY_MCP_PROVIDER = 'remote'

export const PL3_DATA_TOOLS = ['lottery.latest', 'lottery.history', 'lottery.periods', 'lottery.summary'] as const

export const PL3_MCP_TOOLS = [...PL3_DATA_TOOLS, 'lottery.predict'] as const

/** @deprecated Use PL3_DATA_TOOLS instead. */
export const LOTTERY_MCP_TOOLS = PL3_DATA_TOOLS

export type Pl3McpToolName = (typeof PL3_MCP_TOOLS)[number]
export type Pl3DataToolName = (typeof PL3_DATA_TOOLS)[number]
/** @deprecated Use Pl3McpToolName instead. */
export type LotteryMcpToolName = Pl3McpToolName
export type McpPlan = 'public' | 'member'
export type Pl3DataMode = 'remote' | 'official'
/** @deprecated Use Pl3DataMode instead. */
export type LotteryDataMode = Pl3DataMode

export type McpMeta = {
  plan: McpPlan
  provider?: 'remote' | 'official'
  apiKeyUsed?: boolean
  requestLimit: number | null
  generatedAt: string
  memberGroupId?: number | null
  memberGroupName?: string | null
  page?: number
  limit?: number
  total?: number
  hasMore?: boolean
}

export type McpEnvelope<T> = {
  data: T
  meta: McpMeta
}

export type McpHealthResponse = {
  ok: boolean
  service: string
  transport?: string
  provider?: 'remote' | 'official'
  dataDir?: string
  auth?: {
    header?: string
  }
  tools?: Pl3DataToolName[]
}

export type Pl3LatestQuery = {
  lotteryType?: Pl3LotteryType
}

export type Pl3HistoryQuery = {
  lotteryType?: Pl3LotteryType
  period?: string
  fromDate?: string
  toDate?: string
  page?: number
  limit?: number
}

export type Pl3PeriodsQuery = {
  lotteryType?: Pl3LotteryType
  page?: number
  limit?: number
}

export type Pl3SummaryQuery = {
  lotteryType?: Pl3LotteryType
}

/** @deprecated Use Pl3LatestQuery instead. */
export type LotteryLatestQuery = Pl3LatestQuery
/** @deprecated Use Pl3HistoryQuery instead. */
export type LotteryHistoryQuery = Pl3HistoryQuery
/** @deprecated Use Pl3PeriodsQuery instead. */
export type LotteryPeriodsQuery = Pl3PeriodsQuery
/** @deprecated Use Pl3SummaryQuery instead. */
export type LotterySummaryQuery = Pl3SummaryQuery

export type LotteryMcpConfig = {
  apiBaseUrl?: string
  token?: string
  defaultPeriods: string
  dataMode?: Pl3DataMode
  dataDir?: string
}

/** @deprecated Use LotteryMcpConfig instead. */
export type NbcpConfig = LotteryMcpConfig

export type LotteryMcpClientConfig = {
  apiBaseUrl?: string
  token?: string
  defaultPeriods?: string
  dataMode?: Pl3DataMode
  dataDir?: string
  fetchImpl?: typeof fetch
}

export type LotteryMcpClient = {
  apiBaseUrl: string
  token: string
  defaultPeriods: string
  getHealth(): Promise<McpHealthResponse>
  getLatest(query: Pl3LatestQuery): Promise<McpEnvelope<Pl3DrawRecord | null>>
  getHistory(query: Pl3HistoryQuery): Promise<McpEnvelope<Pl3DrawRecord[]>>
  getPeriods(query: Pl3PeriodsQuery): Promise<McpEnvelope<Pl3PeriodRecord[]>>
  getSummary(query: Pl3SummaryQuery): Promise<McpEnvelope<Pl3Summary | null>>
}

export type LotteryDataProvider = Pick<
  LotteryMcpClient,
  'getHealth' | 'getLatest' | 'getHistory' | 'getPeriods' | 'getSummary'
>

export type Pl3PredictionServiceConfig = {
  dataDir?: string
  defaultPeriods?: string | number
  payouts?: Partial<Pl3PayoutConfig>
}

export type Pl3PredictionService = {
  ledgerPath: string
  predict(query?: Pl3PredictionQuery): Promise<McpEnvelope<Pl3PredictionResult>>
  settle(): Promise<{ settledCount: number }>
  getLedgerSummary(): Promise<{
    total: number
    pending: number
    provisional: number
    confirmed: number
    disputed: number
  }>
}

export type Pl3DrawRecord = Pl3Record & {
  source?: string
  sourceUrl?: string
  rawProvider?: string
  status?: 'confirmed' | 'single_source'
}

export type Pl3PeriodRecord = Pick<Pl3DrawRecord, 'lotteryType' | 'period' | 'drawDate'>

export type Pl3Summary = {
  lotteryType: Pl3LotteryType
  total: number
  latestPeriod: string | null
  latestDrawDate: string | null
  dataDir?: string
}

/** @deprecated Use Pl3DrawRecord instead. */
export type OfficialLotteryRecord = Pl3DrawRecord

export type McpAction = {
  type?: string
  label?: string
  url?: string
}

export class McpApiError extends Error {
  readonly statusCode: number
  readonly code?: string
  readonly upgradeUrl?: string
  readonly displayMode?: string
  readonly action?: McpAction
  readonly data?: unknown

  constructor(input: {
    statusCode: number
    message: string
    code?: string
    upgradeUrl?: string
    displayMode?: string
    action?: McpAction
    data?: unknown
  }) {
    super(input.message)
    this.name = 'McpApiError'
    this.statusCode = input.statusCode
    this.code = input.code
    this.upgradeUrl = input.upgradeUrl
    this.displayMode = input.displayMode
    this.action = input.action
    this.data = input.data
  }
}

const DEFAULT_PERIODS = '100'
const DEFAULT_DATA_DIR = '.lotterymcp-data'
/** @deprecated Use PL3_LOTTERY_TYPE instead. */
export const SUPPORTED_LOTTERY_TYPE = PL3_LOTTERY_TYPE
const RATE_LIMIT_RETRIES = 2
const RATE_LIMIT_BASE_DELAY_MS = 1000
const RATE_LIMIT_MAX_DELAY_MS = 5000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const getRateLimitDelayMs = (response: Response, attempt: number) => {
  const retryAfter = response.headers.get('retry-after')
  if (retryAfter) {
    const parsed = Number(retryAfter)
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.min(parsed * 1000, RATE_LIMIT_MAX_DELAY_MS)
    }
  }

  return Math.min(RATE_LIMIT_BASE_DELAY_MS * 2 ** Math.max(attempt - 1, 0), RATE_LIMIT_MAX_DELAY_MS)
}

export const normalizeApiBaseUrl = (value: unknown) =>
  String(value || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/api\/v1\/mcp$/i, '')
    .replace(/\/api\/v1$/i, '')
    .replace(/\/api$/i, '')

const buildSearchParams = (query?: Record<string, unknown>) => {
  const searchParams = new URLSearchParams()

  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === '') {
      continue
    }

    searchParams.set(key, String(value))
  }

  return searchParams
}

const parseJsonSafely = (rawText: string): Record<string, unknown> => {
  if (!rawText) {
    return {}
  }

  try {
    return JSON.parse(rawText)
  } catch {
    return {
      message: rawText,
    }
  }
}

const createApiError = (statusCode: number, payload: Record<string, unknown>) =>
  new McpApiError({
    statusCode,
    message: String(payload?.message || '网站接口请求失败'),
    code: typeof payload?.code === 'string' ? payload.code : undefined,
    upgradeUrl: typeof payload?.upgradeUrl === 'string' ? payload.upgradeUrl : undefined,
    displayMode: typeof payload?.displayMode === 'string' ? payload.displayMode : undefined,
    action: payload?.action && typeof payload.action === 'object' ? (payload.action as McpAction) : undefined,
    data: payload,
  })

const normalizeDataMode = (value: unknown): Pl3DataMode =>
  String(value || '')
    .trim()
    .toLowerCase() === 'official'
    ? 'official'
    : 'remote'

export const normalizeLotteryType = (value: unknown = PL3_LOTTERY_TYPE) => {
  const lotteryType = String(value || PL3_LOTTERY_TYPE)
    .trim()
    .toLowerCase()

  if (lotteryType !== PL3_LOTTERY_TYPE) {
    throw new McpApiError({
      statusCode: 400,
      code: 'LOTTERYMCP_ONLY_PL3_SUPPORTED',
      message: `当前版本只支持排列3(pl3)，不支持 ${lotteryType || '(空)'}。`,
    })
  }

  return PL3_LOTTERY_TYPE
}

const resolveOfficialDataDir = (value: unknown) => {
  const dataDir = String(value || DEFAULT_DATA_DIR).trim() || DEFAULT_DATA_DIR
  return path.resolve(dataDir)
}

const normalizeLimit = (value: unknown, fallback: number) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

const normalizePage = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1
}

const toPl3ValidationApiError = (error: unknown, context: string, statusCode = 422) => {
  if (error instanceof McpApiError) return error
  if (error instanceof Pl3PredictionError) {
    return new McpApiError({
      statusCode: error.code === 'LOTTERYMCP_ONLY_PL3_SUPPORTED' ? 400 : statusCode,
      code: error.code,
      message: `${context}: ${error.message}`,
      data: error.details,
    })
  }
  return new McpApiError({
    statusCode,
    code: 'LOTTERYMCP_PL3_INVALID_RECORDS',
    message: `${context}: ${error instanceof Error ? error.message : String(error)}`,
    data: error,
  })
}

const normalizePl3DrawRecords = (records: readonly Pl3SourceRecord[], context: string): Pl3DrawRecord[] => {
  try {
    const sourceByPeriod = new Map<string, Record<string, unknown>>()
    for (const source of records) {
      if (source && typeof source === 'object') {
        sourceByPeriod.set(String(source.period || '').trim(), source as Record<string, unknown>)
      }
    }
    return normalizePl3Records(records).map((record) => {
      const source = sourceByPeriod.get(record.period)
      return {
        ...record,
        ...(typeof source?.source === 'string' ? { source: source.source } : {}),
        ...(typeof source?.sourceUrl === 'string' ? { sourceUrl: source.sourceUrl } : {}),
        ...(typeof source?.rawProvider === 'string' ? { rawProvider: source.rawProvider } : {}),
        ...(source?.status === 'confirmed' || source?.status === 'single_source' ? { status: source.status } : {}),
      }
    })
  } catch (error) {
    throw toPl3ValidationApiError(error, context)
  }
}

const readOfficialCache = async (dataDir: string, lotteryType: Pl3LotteryType) => {
  const normalizedLotteryType = normalizeLotteryType(lotteryType)

  if (hasPl3Database(dataDir)) {
    const store = openPl3Store({ dataDir, readonly: true, fileMustExist: true })
    try {
      const count = store.getRecordCount()
      return store.getRecords({ page: 1, limit: Math.max(count, 1) }).map<Pl3DrawRecord>((record) => ({
        lotteryType: record.lotteryType,
        period: record.period,
        drawDate: record.drawDate,
        numbers: record.numbers,
        numbersList: record.numbersList,
        status: record.status,
        source: 'official',
        sourceUrl: record.sourceUrl,
        rawProvider: record.provider,
      }))
    } finally {
      store.close()
    }
  }

  const cachePath = path.join(dataDir, `${normalizedLotteryType}.json`)
  let rawText: string

  try {
    rawText = await readFile(cachePath, 'utf8')
  } catch {
    throw new McpApiError({
      statusCode: 404,
      code: 'LOTTERYMCP_OFFICIAL_CACHE_MISSING',
      message: '未找到排列3(pl3)官方数据缓存，请先运行 lotterymcp sync --source official。',
      data: { cachePath },
    })
  }

  const parsed = parseJsonSafely(rawText)
  const records = Array.isArray(parsed) ? parsed : parsed?.records

  if (!Array.isArray(records)) {
    throw new McpApiError({
      statusCode: 422,
      code: 'LOTTERYMCP_OFFICIAL_CACHE_INVALID',
      message: `${normalizedLotteryType} 的官方数据缓存格式无效。`,
      data: { cachePath },
    })
  }

  try {
    return normalizePl3DrawRecords(records as Pl3SourceRecord[], '排列3官方数据缓存格式无效').reverse()
  } catch (error) {
    if (error instanceof McpApiError && error.code === 'LOTTERYMCP_ONLY_PL3_SUPPORTED') throw error
    throw new McpApiError({
      statusCode: 422,
      code: error instanceof McpApiError ? error.code : 'LOTTERYMCP_OFFICIAL_CACHE_INVALID',
      message: error instanceof Error ? error.message : `${normalizedLotteryType} 的官方数据缓存格式无效。`,
      data: { cachePath },
    })
  }
}

const filterOfficialRecords = (records: Pl3DrawRecord[], query: Pl3HistoryQuery) => {
  const period = String(query.period || '').trim()
  const fromDate = String(query.fromDate || '').trim()
  const toDate = String(query.toDate || '').trim()

  return records.filter((record) => {
    if (period && record.period !== period) {
      return false
    }

    if (fromDate && record.drawDate && record.drawDate < fromDate) {
      return false
    }

    if (toDate && record.drawDate && record.drawDate > toDate) {
      return false
    }

    return true
  })
}

export const createOfficialLocalProvider = (
  config: Pick<LotteryMcpClientConfig, 'dataDir' | 'defaultPeriods'> = {},
): LotteryDataProvider => {
  const dataDir = resolveOfficialDataDir(config.dataDir)
  const fallbackLimit = normalizeLimit(config.defaultPeriods, Number(DEFAULT_PERIODS))

  const createMeta = (extra: Partial<McpMeta> = {}): McpMeta => ({
    plan: 'public',
    provider: 'official',
    apiKeyUsed: false,
    requestLimit: null,
    generatedAt: new Date().toISOString(),
    ...extra,
  })

  return {
    getHealth: async () => ({
      ok: true,
      service: 'lotterymcp-official-local',
      transport: hasPl3Database(dataDir) ? 'local-sqlite' : 'local-json',
      provider: 'official',
      dataDir,
      tools: [...PL3_DATA_TOOLS],
    }),
    getLatest: async (query) => {
      const records = await readOfficialCache(dataDir, query.lotteryType || PL3_LOTTERY_TYPE)
      return {
        data: records[0] || null,
        meta: createMeta(),
      }
    },
    getHistory: async (query) => {
      const lotteryType = normalizeLotteryType(query.lotteryType)
      const records = filterOfficialRecords(await readOfficialCache(dataDir, lotteryType), query)
      const page = normalizePage(query.page)
      const limit = normalizeLimit(query.limit, fallbackLimit)
      const offset = (page - 1) * limit
      const data = records.slice(offset, offset + limit)

      return {
        data,
        meta: createMeta({
          page,
          limit,
          total: records.length,
          hasMore: offset + data.length < records.length,
        }),
      }
    },
    getPeriods: async (query) => {
      const records = await readOfficialCache(dataDir, query.lotteryType || PL3_LOTTERY_TYPE)
      const page = normalizePage(query.page)
      const limit = normalizeLimit(query.limit, fallbackLimit)
      const offset = (page - 1) * limit
      const periods = records.map((record) => ({
        lotteryType: record.lotteryType,
        period: record.period,
        drawDate: record.drawDate,
      }))
      const data = periods.slice(offset, offset + limit)

      return {
        data,
        meta: createMeta({
          page,
          limit,
          total: periods.length,
          hasMore: offset + data.length < periods.length,
        }),
      }
    },
    getSummary: async (query) => {
      const lotteryType = normalizeLotteryType(query.lotteryType)
      const records = await readOfficialCache(dataDir, lotteryType)
      return {
        data: {
          lotteryType,
          total: records.length,
          latestPeriod: records[0]?.period || null,
          latestDrawDate: records[0]?.drawDate || null,
          dataDir,
        },
        meta: createMeta(),
      }
    },
  }
}

export const formatMcpApiError = (error: unknown) => {
  if (!(error instanceof McpApiError)) {
    return error instanceof Error ? error.message : String(error)
  }

  const lines = [error.message]

  if (error.statusCode === 429) {
    lines.push('建议先稍后重试，或降低默认期数/调用频率后再试。')
  }

  if (error.code) {
    lines.push(`错误代码: ${error.code}`)
  }

  if (error.action?.url) {
    lines.push(`处理链接: ${error.action.url}`)
  } else if (error.upgradeUrl) {
    lines.push(`升级页面: ${error.upgradeUrl}`)
  }

  return lines.join('\n')
}

const invalidRemoteResponse = (message: string, data: unknown) =>
  new McpApiError({
    statusCode: 502,
    code: 'LOTTERYMCP_PL3_INVALID_REMOTE_RESPONSE',
    message: `排列3远端响应无效: ${message}`,
    data,
  })

const normalizeRemoteEnvelope = <T>(payload: unknown, normalizeData: (value: unknown) => T): McpEnvelope<T> => {
  if (!payload || typeof payload !== 'object') {
    throw invalidRemoteResponse('响应不是对象。', payload)
  }
  const envelope = payload as { data?: unknown; meta?: unknown }
  if (!envelope.meta || typeof envelope.meta !== 'object') {
    throw invalidRemoteResponse('缺少 meta 对象。', payload)
  }
  try {
    return {
      data: normalizeData(envelope.data),
      meta: envelope.meta as McpMeta,
    }
  } catch (error) {
    if (error instanceof McpApiError && error.code === 'LOTTERYMCP_PL3_INVALID_REMOTE_RESPONSE') throw error
    throw invalidRemoteResponse(error instanceof Error ? error.message : String(error), payload)
  }
}

const normalizeRemoteDraw = (value: unknown): Pl3DrawRecord => {
  if (!value || typeof value !== 'object') throw new Error('开奖记录不是对象。')
  return normalizePl3DrawRecords([value as Pl3SourceRecord], '排列3远端开奖记录无效')[0]!
}

const normalizeRemotePeriods = (value: unknown): Pl3PeriodRecord[] => {
  if (!Array.isArray(value)) throw new Error('期号数据不是数组。')
  return value.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('期号记录不是对象。')
    const source = item as Record<string, unknown>
    const lotteryType = normalizeLotteryType(source.lotteryType)
    const period = String(source.period || '').trim()
    const drawDate = String(source.drawDate || '')
      .trim()
      .slice(0, 10)
    if (!/^\d{5,12}$/.test(period)) throw new Error(`无效期号: ${period || '(空)'}`)
    if (!isValidPl3DrawDate(drawDate)) throw new Error(`第 ${period} 期的开奖日期无效。`)
    return { lotteryType, period, drawDate }
  })
}

const normalizeRemoteSummary = (value: unknown): Pl3Summary | null => {
  if (value === null) return null
  if (!value || typeof value !== 'object') throw new Error('摘要不是对象。')
  const source = value as Record<string, unknown>
  const lotteryType = normalizeLotteryType(source.lotteryType)
  const total = Number(source.total)
  if (!Number.isInteger(total) || total < 0) throw new Error('摘要 total 必须是非负整数。')
  const latestPeriod = source.latestPeriod == null ? null : String(source.latestPeriod)
  const latestDrawDate = source.latestDrawDate == null ? null : String(source.latestDrawDate).slice(0, 10)
  if (latestPeriod !== null && !/^\d{5,12}$/.test(latestPeriod)) throw new Error('摘要最新期号无效。')
  if (latestDrawDate !== null && !isValidPl3DrawDate(latestDrawDate)) throw new Error('摘要最新开奖日期无效。')
  return {
    lotteryType,
    total,
    latestPeriod,
    latestDrawDate,
    ...(typeof source.dataDir === 'string' ? { dataDir: source.dataDir } : {}),
  }
}

export const createLotteryMcpClient = (config: LotteryMcpClientConfig): LotteryMcpClient => {
  if (normalizeDataMode(config.dataMode) === 'official') {
    const provider = createOfficialLocalProvider(config)
    return {
      apiBaseUrl: '',
      token: '',
      defaultPeriods: String(config.defaultPeriods || DEFAULT_PERIODS).trim() || DEFAULT_PERIODS,
      ...provider,
    }
  }

  const apiBaseUrl = normalizeApiBaseUrl(config.apiBaseUrl)
  const token = String(config.token || '').trim()
  const defaultPeriods = String(config.defaultPeriods || DEFAULT_PERIODS).trim() || DEFAULT_PERIODS
  const fetchImpl = config.fetchImpl || fetch

  const request = async <T>(path: string, query?: Record<string, unknown>): Promise<T> => {
    if (!apiBaseUrl) {
      throw new McpApiError({
        statusCode: 400,
        code: 'NBCP_CONFIG_MISSING_API_BASE_URL',
        message: '未配置 API_BASE_URL',
      })
    }

    const url = new URL(`/api/v1/mcp/${path.replace(/^\/+/, '')}`, `${apiBaseUrl}/`)
    url.search = buildSearchParams(query).toString()

    let response: Response | undefined

    for (let attempt = 1; attempt <= RATE_LIMIT_RETRIES + 1; attempt += 1) {
      try {
        response = await fetchImpl(url, {
          method: 'GET',
          headers: {
            accept: 'application/json',
            ...(token ? { 'x-api-key': token } : {}),
          },
        })
      } catch (error) {
        throw new McpApiError({
          statusCode: 503,
          code: 'NBCP_NETWORK_ERROR',
          message: error instanceof Error ? `无法连接网站接口: ${error.message}` : '无法连接网站接口',
          data: error,
        })
      }

      if (response.status === 429 && attempt <= RATE_LIMIT_RETRIES) {
        await sleep(getRateLimitDelayMs(response, attempt))
        continue
      }

      break
    }

    if (!response) {
      throw new McpApiError({
        statusCode: 503,
        code: 'NBCP_NETWORK_ERROR',
        message: '无法连接网站接口',
      })
    }

    const rawText = await response.text()
    const payload = parseJsonSafely(rawText)

    if (!response.ok) {
      throw createApiError(response.status, payload)
    }

    return payload as T
  }

  return {
    apiBaseUrl,
    token,
    defaultPeriods,
    getHealth: () => request<McpHealthResponse>('health'),
    getLatest: async (query) =>
      normalizeRemoteEnvelope(
        await request<unknown>('lottery/latest', { ...query, lotteryType: normalizeLotteryType(query.lotteryType) }),
        (value) => (value === null ? null : normalizeRemoteDraw(value)),
      ),
    getHistory: async (query) =>
      normalizeRemoteEnvelope(
        await request<unknown>('lottery/history', { ...query, lotteryType: normalizeLotteryType(query.lotteryType) }),
        (value) => {
          if (!Array.isArray(value)) throw new Error('历史数据不是数组。')
          return normalizePl3DrawRecords(value as Pl3SourceRecord[], '排列3远端历史数据无效').reverse()
        },
      ),
    getPeriods: async (query) =>
      normalizeRemoteEnvelope(
        await request<unknown>('lottery/periods', { ...query, lotteryType: normalizeLotteryType(query.lotteryType) }),
        normalizeRemotePeriods,
      ),
    getSummary: async (query) =>
      normalizeRemoteEnvelope(
        await request<unknown>('lottery/summary', { ...query, lotteryType: normalizeLotteryType(query.lotteryType) }),
        normalizeRemoteSummary,
      ),
  }
}

const toPredictionApiError = (error: unknown) => {
  if (error instanceof McpApiError) return error
  if (error instanceof Pl3PredictionError) {
    return new McpApiError({
      statusCode: error.code === 'LOTTERYMCP_PL3_INSUFFICIENT_DATA' ? 422 : 400,
      code: error.code,
      message: error.message,
      data: error.details,
    })
  }
  return error
}

const resolvePredictionPeriods = (queryValue: unknown, defaultValue: unknown) => {
  const parsed = Number(queryValue ?? defaultValue ?? PL3_DEFAULT_PERIODS)
  if (!Number.isInteger(parsed) || parsed < PL3_MIN_RECORDS || parsed > PL3_MAX_PERIODS) {
    throw new McpApiError({
      statusCode: 400,
      code: 'LOTTERYMCP_PL3_INVALID_PERIODS',
      message: `排列3预测期数必须是 ${PL3_MIN_RECORDS}-${PL3_MAX_PERIODS} 的整数。`,
    })
  }
  return parsed
}

export const createPl3PredictionService = (
  client: Pick<LotteryMcpClient, 'getHistory'>,
  config: Pl3PredictionServiceConfig = {},
): Pl3PredictionService => {
  const dataDir = resolveOfficialDataDir(config.dataDir)
  const ledgerPath = path.join(dataDir, 'pl3-predictions.json')

  const fetchHistory = async (periods: number) => {
    const records: Pl3SourceRecord[] = []
    const pageSize = Math.min(500, periods)
    let page = 1
    let meta: McpMeta | undefined

    while (records.length < periods) {
      const envelope = await client.getHistory({
        lotteryType: PL3_LOTTERY_TYPE,
        page,
        limit: Math.min(pageSize, periods - records.length),
      })
      const rows: Pl3SourceRecord[] = envelope.data
      records.push(...rows)
      meta = envelope.meta
      if (rows.length === 0 || !envelope.meta?.hasMore) break
      page += 1
    }

    return { records: records.slice(0, periods), meta }
  }

  const settleWithRecords = async (records: readonly Pl3SourceRecord[]) => {
    try {
      const result = await settlePl3Predictions(ledgerPath, records)
      return { settledCount: result.settledCount }
    } catch (error) {
      throw toPredictionApiError(error)
    }
  }

  return {
    ledgerPath,
    predict: async (query = {}) => {
      try {
        normalizeLotteryType(query.lotteryType)
        const periods = resolvePredictionPeriods(query.periods, config.defaultPeriods)
        const { records, meta } = await fetchHistory(periods)
        await settleWithRecords(records)
        const prediction = predictPl3(records, {
          ...query,
          lotteryType: PL3_LOTTERY_TYPE,
          periods,
          payouts: { ...(config.payouts || {}), ...(query.payouts || {}) },
        })
        await upsertPl3Prediction(ledgerPath, prediction)
        return {
          data: prediction,
          meta: {
            plan: meta?.plan || 'public',
            provider: meta?.provider || 'remote',
            apiKeyUsed: meta?.apiKeyUsed,
            requestLimit: meta?.requestLimit ?? null,
            generatedAt: prediction.generatedAt,
            total: prediction.training.recordCount,
          },
        }
      } catch (error) {
        throw toPredictionApiError(error)
      }
    },
    settle: async () => {
      const periods = resolvePredictionPeriods(config.defaultPeriods, PL3_DEFAULT_PERIODS)
      const { records } = await fetchHistory(periods)
      return settleWithRecords(records)
    },
    getLedgerSummary: () => getPl3PredictionLedgerSummary(ledgerPath),
  }
}

/** @deprecated Use createLotteryMcpClient instead. */
export const createLotteryApiClient = createLotteryMcpClient
