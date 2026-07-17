import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const serverEntryUrl = pathToFileURL(path.join(repoRoot, 'packages', 'mcp-server', 'dist', 'index.js')).href

test('mcp server exposes the five P3 tools through the public tool catalog', async () => {
  const { createLotteryToolCatalog } = await import(serverEntryUrl)

  const catalog = createLotteryToolCatalog({
    getLatest: async () => ({ data: null, meta: { plan: 'member', apiKeyUsed: true, requestLimit: null, generatedAt: new Date().toISOString() } }),
    getHistory: async () => ({ data: [], meta: { plan: 'member', apiKeyUsed: true, requestLimit: 20, generatedAt: new Date().toISOString() } }),
    getPeriods: async () => ({ data: [], meta: { plan: 'member', apiKeyUsed: true, requestLimit: 20, generatedAt: new Date().toISOString() } }),
    getSummary: async () => ({ data: null, meta: { plan: 'member', apiKeyUsed: true, requestLimit: null, generatedAt: new Date().toISOString() } }),
  })

  assert.deepEqual(
    catalog.map((item) => item.name),
    ['lottery.latest', 'lottery.history', 'lottery.periods', 'lottery.summary', 'lottery.predict'],
  )
})

test('predict tool defaults to pl3 and rejects other lottery types', async () => {
  const { createLotteryToolCatalog } = await import(serverEntryUrl)
  const records = Array.from({ length: 100 }, (_, index) => ({
    lotteryType: 'pl3',
    period: String(26001 + index),
    drawDate: `2026-01-${String(index % 28 + 1).padStart(2, '0')}`,
    numbers: `${index % 10},${(index + 1) % 10},${(index + 2) % 10}`,
  })).reverse()
  const catalog = createLotteryToolCatalog({
    getLatest: async () => ({ data: null, meta: {} }),
    getHistory: async () => ({
      data: records,
      meta: { plan: 'public', provider: 'official', requestLimit: null, generatedAt: new Date().toISOString(), hasMore: false },
    }),
    getPeriods: async () => ({ data: [], meta: {} }),
    getSummary: async () => ({ data: null, meta: {} }),
  }, { dataDir: path.join(repoRoot, '.tmp-tests', 'mcp-predict') })
  const predictTool = catalog.find((item) => item.name === 'lottery.predict')

  const success = await predictTool.handler({ tickets: 3 })
  assert.equal(success.isError, false)
  assert.match(success.content[0].text, /"lotteryType": "pl3"/)

  const rejected = await predictTool.handler({ lotteryType: 'fc3d' })
  assert.equal(rejected.isError, true)
  assert.equal(rejected.structuredContent.code, 'LOTTERYMCP_ONLY_PL3_SUPPORTED')
})

test('latest tool delegates to the client and returns text content', async () => {
  const { createLotteryToolCatalog } = await import(serverEntryUrl)
  const calls = []
  const catalog = createLotteryToolCatalog({
    getLatest: async (input) => {
      calls.push(input)
      return {
        data: {
          lotteryType: 'pl3',
          period: '2026048',
          numbers: '1 2 3',
          drawDate: '2026-04-08',
        },
        meta: {
          plan: 'member',
          apiKeyUsed: true,
          requestLimit: null,
          generatedAt: '2026-04-08T00:00:00.000Z',
        },
      }
    },
    getHistory: async () => ({ data: [], meta: { plan: 'member', apiKeyUsed: true, requestLimit: 20, generatedAt: new Date().toISOString() } }),
    getPeriods: async () => ({ data: [], meta: { plan: 'member', apiKeyUsed: true, requestLimit: 20, generatedAt: new Date().toISOString() } }),
    getSummary: async () => ({ data: null, meta: { plan: 'member', apiKeyUsed: true, requestLimit: null, generatedAt: new Date().toISOString() } }),
  })

  const latestTool = catalog.find((item) => item.name === 'lottery.latest')
  const result = await latestTool.handler({})

  assert.deepEqual(calls, [{ lotteryType: undefined }])
  assert.equal(result.isError, false)
  assert.equal(result.content[0].type, 'text')
  assert.match(result.content[0].text, /pl3/)
  assert.match(result.content[0].text, /2026048/)
})
