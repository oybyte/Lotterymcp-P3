import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const syncEntryUrl = pathToFileURL(path.join(repoRoot, 'packages', 'cli', 'dist', 'official-sync.js')).href

const sportteryRows = (start, count) => Array.from({ length: count }, (_, index) => ({
  lotteryDrawNum: String(start - index),
  lotteryDrawTime: `2026-01-${String((index % 28) + 1).padStart(2, '0')}`,
  lotteryDrawResult: `${index % 10} ${(index + 1) % 10} ${(index + 2) % 10}`,
}))

const zhcwRows = (start, count) => Array.from({ length: count }, (_, index) => ({
  issue: String(start - index),
  openTime: `2026-02-${String((index % 28) + 1).padStart(2, '0')}`,
  frontWinningNum: `${index % 10} ${(index + 3) % 10} ${(index + 6) % 10}`,
  backWinningNum: '',
}))

test('official sync fetches multiple sporttery pages until the requested limit', async () => {
  const { fetchOfficialPl3Records } = await import(syncEntryUrl)
  const pages = []
  const pageSizes = []
  const fetchImpl = async (input) => {
    const url = new URL(input)
    const page = Number(url.searchParams.get('pageNo'))
    const pageSize = Number(url.searchParams.get('pageSize'))
    pages.push(page)
    pageSizes.push(pageSize)
    const count = page === 1 ? pageSize : 5
    return new Response(JSON.stringify({ value: { list: sportteryRows(26187 - (page - 1) * 30, count) } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  const records = await fetchOfficialPl3Records(35, fetchImpl)

  assert.equal(records.length, 35)
  assert.deepEqual(pages, [1, 2])
  assert.deepEqual(pageSizes, [30, 30])
  assert.equal(records[0].rawProvider, 'sporttery')
})

test('official sync switches the whole request to zhcw after a sporttery failure', async () => {
  const { fetchOfficialPl3Records } = await import(syncEntryUrl)
  const providers = []
  const fetchImpl = async (input) => {
    const url = new URL(input)
    if (url.hostname.includes('sporttery')) {
      providers.push('sporttery')
      return new Response('blocked', { status: 403, statusText: 'Forbidden' })
    }
    providers.push('zhcw')
    const page = Number(url.searchParams.get('pageNum'))
    const pageSize = Number(url.searchParams.get('pageSize'))
    const count = page === 1 ? pageSize : 5
    return new Response(`callback(${JSON.stringify({ data: zhcwRows(26187 - (page - 1) * 30, count) })})`, {
      status: 200,
      headers: { 'content-type': 'application/javascript' },
    })
  }

  const records = await fetchOfficialPl3Records(35, fetchImpl)

  assert.equal(records.length, 35)
  assert.deepEqual(providers, ['sporttery', 'zhcw', 'zhcw'])
  assert.ok(records.every((record) => record.rawProvider === 'zhcw'))
})

test('repeated sporttery pages trigger the zhcw fallback', async () => {
  const { fetchOfficialPl3Records } = await import(syncEntryUrl)
  let fallbackCalls = 0
  const fetchImpl = async (input) => {
    const url = new URL(input)
    if (url.hostname.includes('sporttery')) {
      return new Response(JSON.stringify({ value: { list: sportteryRows(26187, 30) } }), { status: 200 })
    }
    fallbackCalls += 1
    const pageSize = Number(url.searchParams.get('pageSize'))
    const page = Number(url.searchParams.get('pageNum'))
    const count = page === 1 ? pageSize : 5
    return new Response(`callback(${JSON.stringify({ data: zhcwRows(26187 - (page - 1) * 30, count) })})`, { status: 200 })
  }

  const records = await fetchOfficialPl3Records(35, fetchImpl)
  assert.equal(records.length, 35)
  assert.equal(fallbackCalls, 2)
})

test('file sync merges and deduplicates records with atomic JSON output', async () => {
  const { syncOfficialFile } = await import(syncEntryUrl)
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'lotterymcp-file-sync-'))
  const importPath = path.join(tempDir, 'import.json')
  const dataDir = path.join(tempDir, 'data')
  const existingPath = path.join(dataDir, 'pl3.json')
  const existing = zhcwRows(26102, 2).map((row) => ({
    lotteryType: 'pl3', period: row.issue, drawDate: row.openTime, numbers: row.frontWinningNum.replaceAll(' ', ','),
  }))
  const incoming = zhcwRows(26103, 2).map((row) => ({
    lotteryType: 'pl3', period: row.issue, drawDate: row.openTime, numbers: row.frontWinningNum.replaceAll(' ', ','),
  }))
  writeFileSync(importPath, JSON.stringify({ records: incoming }), 'utf8')
  await import('node:fs/promises').then(({ mkdir }) => mkdir(dataDir, { recursive: true }))
  writeFileSync(existingPath, JSON.stringify({ records: existing }), 'utf8')

  const result = await syncOfficialFile({ filePath: importPath, limit: 10, dataDir })
  const saved = JSON.parse(readFileSync(existingPath, 'utf8'))

  assert.equal(result.records.length, 3)
  assert.equal(saved.recordCount, 3)
  assert.deepEqual(saved.records.map((record) => record.period), ['26103', '26102', '26101'])
  assert.ok(result.warnings.some((warning) => warning.includes('当前有效缓存为 3 期')))
  assert.equal(readdirSync(dataDir).some((name) => name.endsWith('.tmp')), false)
})
