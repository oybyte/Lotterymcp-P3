import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
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

test('archive fetch records source totals and raw responses', async () => {
  const { fetchOfficialPl3Archive } = await import(syncEntryUrl)
  const fetchImpl = async (input) => {
    const url = new URL(input)
    const page = Number(url.searchParams.get('pageNo'))
    const pageSize = Number(url.searchParams.get('pageSize'))
    const count = page === 1 ? pageSize : 5
    return new Response(JSON.stringify({
      value: {
        total: 7662,
        pages: 256,
        list: sportteryRows(26187 - (page - 1) * 30, count),
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }

  const archive = await fetchOfficialPl3Archive(35, fetchImpl)
  assert.equal(archive.records.length, 35)
  assert.equal(archive.provider, 'lottery-gov-cn')
  assert.equal(archive.authoritativeTotal, 7662)
  assert.equal(archive.rawResponses.length, 2)
  assert.deepEqual(archive.rawResponses.map((item) => item.page), [1, 2])
  assert.ok(archive.rawResponses.every((item) => item.rawText.includes('lotteryDrawNum')))
})

test('SQLite data sync persists raw responses, manifest and source observations', async () => {
  const { syncOfficialPl3ToStore } = await import(syncEntryUrl)
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'lotterymcp-store-sync-'))
  const fetchImpl = async (input) => {
    const url = new URL(input)
    const page = Number(url.searchParams.get('pageNo'))
    const pageSize = Number(url.searchParams.get('pageSize'))
    const count = page === 1 ? pageSize : 5
    return new Response(JSON.stringify({
      value: {
        total: 7662,
        pages: 256,
        list: sportteryRows(26187 - (page - 1) * 30, count),
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }

  const result = await syncOfficialPl3ToStore({ dataDir: tempDir, limit: 35, fetchImpl })
  assert.equal(result.records.length, 35)
  assert.equal(result.singleSourceRecords, 35)
  assert.equal(result.confirmedRecords, 0)
  assert.equal(result.conflictRecords, 0)
  assert.equal(result.authoritativeTotal, 7662)
  assert.equal(result.rawResponseCount, 2)
  assert.equal(existsSync(result.databasePath), true)
  assert.equal(existsSync(result.rawManifestPath), true)
  const manifest = JSON.parse(readFileSync(result.rawManifestPath, 'utf8'))
  assert.equal(manifest.responses.length, 2)
  for (const response of manifest.responses) {
    assert.equal(existsSync(path.join(tempDir, response.rawPath)), true)
  }
})

test('explicit second official source reconciles matching draws as confirmed', async () => {
  const { syncOfficialPl3ToStore } = await import(syncEntryUrl)
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'lotterymcp-store-reconcile-'))
  const fetchImpl = async (input) => {
    const url = new URL(input)
    if (url.hostname.includes('sporttery')) {
      const page = Number(url.searchParams.get('pageNo'))
      const pageSize = Number(url.searchParams.get('pageSize'))
      const count = page === 1 ? pageSize : 5
      return new Response(JSON.stringify({
        value: { total: 35, list: sportteryRows(26187 - (page - 1) * 30, count) },
      }), { status: 200 })
    }
    const page = Number(url.searchParams.get('pageNum'))
    const pageSize = Number(url.searchParams.get('pageSize'))
    const count = page === 1 ? pageSize : 5
    const rows = sportteryRows(26187 - (page - 1) * 30, count).map((row) => ({
      issue: row.lotteryDrawNum,
      openTime: row.lotteryDrawTime,
      frontWinningNum: row.lotteryDrawResult,
      backWinningNum: '',
    }))
    return new Response(`callback(${JSON.stringify({ total: 35, data: rows })})`, { status: 200 })
  }

  const primary = await syncOfficialPl3ToStore({
    dataDir: tempDir,
    limit: 35,
    provider: 'lottery-gov-cn',
    fetchImpl,
  })
  assert.equal(primary.singleSourceRecords, 35)
  const reconciled = await syncOfficialPl3ToStore({
    dataDir: tempDir,
    limit: 35,
    provider: 'zhcw',
    fetchImpl,
  })
  assert.equal(reconciled.confirmedRecords, 35)
  assert.equal(reconciled.singleSourceRecords, 0)
  assert.equal(reconciled.conflictRecords, 0)
})

test('SQLite full sync resumes from the next unfinished page and removes checkpoint after commit', async () => {
  const { syncOfficialPl3ToStore } = await import(syncEntryUrl)
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'lotterymcp-store-resume-'))
  const firstPages = []
  const interruptedFetch = async (input) => {
    const url = new URL(input)
    const page = Number(url.searchParams.get('pageNo'))
    firstPages.push(page)
    if (page === 3) throw new Error('simulated interruption')
    return new Response(JSON.stringify({
      value: { total: 65, list: sportteryRows(26187 - (page - 1) * 30, 30) },
    }), { status: 200 })
  }

  await assert.rejects(
    () => syncOfficialPl3ToStore({
      dataDir: tempDir,
      limit: 65,
      provider: 'lottery-gov-cn',
      fetchImpl: interruptedFetch,
    }),
    /simulated interruption/,
  )
  assert.deepEqual(firstPages, [1, 2, 3])
  const checkpointDir = path.join(tempDir, 'raw', 'checkpoints')
  const checkpointPath = path.join(checkpointDir, readdirSync(checkpointDir).find((name) => name.endsWith('.json')))
  assert.equal(existsSync(checkpointPath), true)

  const resumedPages = []
  const resumedFetch = async (input) => {
    const url = new URL(input)
    const page = Number(url.searchParams.get('pageNo'))
    resumedPages.push(page)
    return new Response(JSON.stringify({
      value: { total: 65, list: sportteryRows(26187 - (page - 1) * 30, page === 3 ? 5 : 30) },
    }), { status: 200 })
  }
  const result = await syncOfficialPl3ToStore({
    dataDir: tempDir,
    limit: 65,
    provider: 'lottery-gov-cn',
    fetchImpl: resumedFetch,
  })
  assert.deepEqual(resumedPages, [3])
  assert.equal(result.resumedPageCount, 2)
  assert.equal(result.records.length, 65)
  assert.equal(existsSync(checkpointPath), false)
})

test('expired checkpoints and explicit restart begin again from page one', async () => {
  const { syncOfficialPl3ToStore } = await import(syncEntryUrl)
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'lotterymcp-store-stale-'))
  const interruptAfterFirstPage = async (input) => {
    const page = Number(new URL(input).searchParams.get('pageNo'))
    if (page === 2) throw new Error('fixture checkpoint interruption')
    return new Response(JSON.stringify({
      value: { total: 35, list: sportteryRows(26187, 30) },
    }), { status: 200 })
  }
  await assert.rejects(
    () => syncOfficialPl3ToStore({
      dataDir: tempDir,
      limit: 35,
      provider: 'lottery-gov-cn',
      fetchImpl: interruptAfterFirstPage,
    }),
    /fixture checkpoint interruption/,
  )
  const checkpointDir = path.join(tempDir, 'raw', 'checkpoints')
  let checkpointName = readdirSync(checkpointDir).find((name) => name.endsWith('.json'))
  const checkpointPath = path.join(checkpointDir, checkpointName)
  const stale = JSON.parse(readFileSync(checkpointPath, 'utf8'))
  stale.updatedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
  writeFileSync(checkpointPath, JSON.stringify(stale), 'utf8')

  const stalePages = []
  const successFetch = async (input) => {
    const page = Number(new URL(input).searchParams.get('pageNo'))
    stalePages.push(page)
    return new Response(JSON.stringify({
      value: { total: 35, list: sportteryRows(26187 - (page - 1) * 30, page === 1 ? 30 : 5) },
    }), { status: 200 })
  }
  const staleResult = await syncOfficialPl3ToStore({
    dataDir: tempDir,
    limit: 35,
    provider: 'lottery-gov-cn',
    fetchImpl: successFetch,
  })
  assert.deepEqual(stalePages, [1, 2])
  assert.equal(staleResult.resumedPageCount, 0)
  assert.equal(readdirSync(checkpointDir).some((name) => name.includes('.stale-')), true)

  await assert.rejects(
    () => syncOfficialPl3ToStore({
      dataDir: tempDir,
      limit: 65,
      provider: 'lottery-gov-cn',
      fetchImpl: async (input) => {
        const page = Number(new URL(input).searchParams.get('pageNo'))
        if (page === 2) throw new Error('fixture restart interruption')
        return new Response(JSON.stringify({
          value: { total: 65, list: sportteryRows(26187, 30) },
        }), { status: 200 })
      },
    }),
    /fixture restart interruption/,
  )
  checkpointName = readdirSync(checkpointDir).find((name) => name.endsWith('.json'))
  assert.ok(checkpointName)
  const restartedPages = []
  await syncOfficialPl3ToStore({
    dataDir: tempDir,
    limit: 65,
    provider: 'lottery-gov-cn',
    restart: true,
    fetchImpl: async (input) => {
      const page = Number(new URL(input).searchParams.get('pageNo'))
      restartedPages.push(page)
      return new Response(JSON.stringify({
        value: { total: 65, list: sportteryRows(26187 - (page - 1) * 30, page === 3 ? 5 : 30) },
      }), { status: 200 })
    },
  })
  assert.deepEqual(restartedPages, [1, 2, 3])
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
