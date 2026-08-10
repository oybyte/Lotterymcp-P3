import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const repoRoot = path.resolve(import.meta.dirname, '..')
const npmCommand = process.platform === 'win32' ? process.execPath : 'npm'
const npmPrefix =
  process.platform === 'win32'
    ? [
        path.join(
          path.dirname(execFileSync('where.exe', ['npm.cmd'], { encoding: 'utf8' }).split(/\r?\n/)[0]),
          'node_modules',
          'npm',
          'bin',
          'npm-cli.js',
        ),
      ]
    : []
const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'lotterymcp-pack-smoke-'))
const packDir = path.join(temporaryRoot, 'packs')
const appDir = path.join(temporaryRoot, 'app')

const run = (args, options = {}) =>
  execFileSync(npmCommand, [...npmPrefix, ...args], {
    cwd: options.cwd || repoRoot,
    encoding: options.encoding || 'utf8',
    stdio: options.stdio || ['ignore', 'pipe', 'inherit'],
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  })

try {
  mkdirSync(packDir, { recursive: true })
  mkdirSync(appDir, { recursive: true })
  writeFileSync(
    path.join(appDir, 'package.json'),
    JSON.stringify(
      {
        name: 'lotterymcp-pack-smoke',
        version: '1.0.0',
        private: true,
        type: 'module',
      },
      null,
      2,
    ),
  )
  const raw = run([
    'pack',
    '--json',
    '--pack-destination',
    packDir,
    '--workspace',
    'lotterymcp-core',
    '--workspace',
    'lotterymcp-server',
    '--workspace',
    'neuxnbcp',
    '--workspace',
    'lotterymcp',
  ])
  const start = raw.indexOf('[')
  if (start < 0) throw new Error(`npm pack --json 未返回 JSON: ${raw}`)
  const packs = JSON.parse(raw.slice(start))
  const tarballs = packs.map((item) => path.join(packDir, item.filename))
  if (tarballs.length !== 4) throw new Error(`预期 4 个发布包，实际 ${tarballs.length}`)
  run(['install', '--prefix', appDir, '--no-audit', '--no-fund', ...tarballs], { stdio: 'inherit' })

  const coreEntry = path.join(appDir, 'node_modules', 'lotterymcp-core', 'dist', 'index.js')
  const core = await import(pathToFileURL(coreEntry).href)
  const dataDir = path.join(temporaryRoot, 'data')
  let store = core.openPl3Store({ dataDir })
  store.importRecords(
    [
      {
        lotteryType: 'pl3',
        period: '2026001',
        drawDate: '2026-01-01',
        numbers: '1,2,3',
        numbersList: [1, 2, 3],
      },
    ],
    { provider: 'file-import' },
  )
  if (store.getStatus().usableRecords !== 1) throw new Error('SQLite smoke 首次读取失败。')
  store.close()
  store = core.openPl3Store({ dataDir, readonly: true, fileMustExist: true })
  if (store.getStatus().latestPeriod !== '2026001') throw new Error('SQLite smoke 重新打开读取失败。')
  store.close()

  execFileSync(process.execPath, [path.join(appDir, 'node_modules', 'neuxnbcp', 'dist', 'index.js'), '--help'], {
    cwd: appDir,
    stdio: 'inherit',
    windowsHide: true,
  })
  console.log(`Node ${process.version} ${process.platform}/${process.arch} pack + SQLite smoke 通过。`)
} finally {
  if (process.platform !== 'win32') {
    rmSync(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}
