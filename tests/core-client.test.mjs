import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const coreEntryUrl = pathToFileURL(path.join(repoRoot, 'packages', 'core', 'dist', 'index.js')).href

test('legacy core client factory remains a thin compatibility alias', async () => {
  const { createLotteryApiClient, createLotteryMcpClient } = await import(coreEntryUrl)
  assert.equal(createLotteryApiClient, createLotteryMcpClient)
})

const startJsonServer = async (handler) => {
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const origin = `http://127.0.0.1:${address.port}`

  return {
    origin,
    close: async () => {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    },
  }
}

test('core client requests the health endpoint and sends x-api-key', async () => {
  const requests = []
  const server = await startJsonServer((req, res) => {
    requests.push({ url: req.url, headers: req.headers })
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ ok: true, service: 'nexusbot-lottery-api' }))
  })

  try {
    const { createLotteryMcpClient } = await import(coreEntryUrl)
    const client = createLotteryMcpClient({
      apiBaseUrl: server.origin,
      token: 'test-token-001',
      defaultPeriods: '100',
    })

    const result = await client.getHealth()

    assert.equal(result.ok, true)
    assert.equal(requests[0]?.url, '/api/v1/mcp/health')
    assert.equal(requests[0]?.headers['x-api-key'], 'test-token-001')
  } finally {
    await server.close()
  }
})

test('core client normalizes structured API errors from the website', async () => {
  const server = await startJsonServer((_req, res) => {
    res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
    res.end(
      JSON.stringify({
        statusCode: 403,
        code: 'MCP_MEMBERSHIP_EXPIRED',
        message: '会员已过期，请升级后继续使用。',
        upgradeUrl: '/member/group-upgrade',
        displayMode: 'dialog_button',
        action: {
          type: 'open_url',
          label: '升级',
          url: 'https://www.neuxsbot.com/member/',
        },
      }),
    )
  })

  try {
    const { McpApiError, createLotteryMcpClient } = await import(coreEntryUrl)
    const client = createLotteryMcpClient({
      apiBaseUrl: server.origin,
      token: 'expired-token-001',
      defaultPeriods: '100',
    })

    await assert.rejects(
      () => client.getSummary({ lotteryType: 'pl3' }),
      (error) => {
        assert.ok(error instanceof McpApiError)
        assert.equal(error.statusCode, 403)
        assert.equal(error.code, 'MCP_MEMBERSHIP_EXPIRED')
        assert.equal(error.upgradeUrl, '/member/group-upgrade')
        assert.equal(error.displayMode, 'dialog_button')
        assert.equal(error.action?.url, 'https://www.neuxsbot.com/member/')
        return true
      },
    )
  } finally {
    await server.close()
  }
})

test('core client retries a 429 response and succeeds on the next attempt', async () => {
  const { createLotteryMcpClient } = await import(coreEntryUrl)
  let attempts = 0
  const client = createLotteryMcpClient({
    apiBaseUrl: 'https://www.neuxsbot.com',
    token: 'retry-token-001',
    defaultPeriods: '100',
    fetchImpl: async () => {
      attempts += 1
      if (attempts === 1) {
        return new Response(JSON.stringify({ message: '请求过于频繁，请稍后重试。' }), {
          status: 429,
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'retry-after': '0',
          },
        })
      }

      return new Response(JSON.stringify({ ok: true, service: 'nexusbot-lottery-api' }), {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
        },
      })
    },
  })

  const result = await client.getHealth()

  assert.equal(result.ok, true)
  assert.equal(attempts, 2)
})

test('official local provider reads cached lottery data with pagination and summary', async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'lotterymcp-official-'))
  writeFileSync(
    path.join(tempDir, 'pl3.json'),
    JSON.stringify({
      provider: 'official',
      lotteryType: 'pl3',
      records: [
        {
          lotteryType: 'pl3',
          period: '2026003',
          drawDate: '2026-01-03',
          numbers: '7,8,9',
          numbersList: [7, 8, 9],
          source: 'official',
        },
        {
          lotteryType: 'pl3',
          period: '2026002',
          drawDate: '2026-01-02',
          numbers: '4,5,6',
          numbersList: [4, 5, 6],
          source: 'official',
        },
        {
          lotteryType: 'pl3',
          period: '2026001',
          drawDate: '2026-01-01',
          numbers: '1,2,3',
          numbersList: [1, 2, 3],
          source: 'official',
        },
      ],
    }),
    'utf8',
  )

  const { createLotteryMcpClient } = await import(coreEntryUrl)
  const client = createLotteryMcpClient({
    apiBaseUrl: '',
    dataMode: 'official',
    dataDir: tempDir,
    defaultPeriods: '2',
  })

  const latest = await client.getLatest({})
  assert.equal(latest.meta.provider, 'official')
  assert.equal(latest.data.period, '2026003')

  const history = await client.getHistory({
    fromDate: '2026-01-02',
    page: 1,
    limit: 1,
  })
  assert.equal(history.meta.plan, 'public')
  assert.equal(history.meta.hasMore, true)
  assert.equal(history.meta.total, 2)
  assert.deepEqual(
    history.data.map((item) => item.period),
    ['2026003'],
  )

  const periods = await client.getPeriods({ lotteryType: 'pl3', limit: 2 })
  assert.deepEqual(
    periods.data.map((item) => item.period),
    ['2026003', '2026002'],
  )

  const summary = await client.getSummary({})
  assert.equal(summary.data.total, 3)
  assert.equal(summary.data.latestPeriod, '2026003')
})

test('core client rejects non-pl3 lottery types before provider calls', async () => {
  const { McpApiError, createLotteryMcpClient } = await import(coreEntryUrl)
  const client = createLotteryMcpClient({
    apiBaseUrl: 'https://www.neuxsbot.com',
    token: 'token-001',
    defaultPeriods: '2',
  })

  await assert.rejects(
    () => client.getLatest({ lotteryType: 'fc3d' }),
    (error) => {
      assert.ok(error instanceof McpApiError)
      assert.equal(error.code, 'LOTTERYMCP_ONLY_PL3_SUPPORTED')
      assert.match(error.message, /只支持排列3/)
      return true
    },
  )
})

test('official local provider reports a clear error when cache is missing', async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'lotterymcp-official-missing-'))
  const { McpApiError, createLotteryMcpClient } = await import(coreEntryUrl)
  const client = createLotteryMcpClient({
    apiBaseUrl: '',
    dataMode: 'official',
    dataDir: tempDir,
    defaultPeriods: '2',
  })

  await assert.rejects(
    () => client.getLatest({}),
    (error) => {
      assert.ok(error instanceof McpApiError)
      assert.equal(error.code, 'LOTTERYMCP_OFFICIAL_CACHE_MISSING')
      assert.match(error.message, /lotterymcp sync --source official/)
      return true
    },
  )
})

test('official local provider rejects non-pl3 and malformed cache records', async () => {
  const { McpApiError, createLotteryMcpClient } = await import(coreEntryUrl)
  const valid = {
    lotteryType: 'pl3',
    period: '2026001',
    drawDate: '2026-01-01',
    numbers: '1,2,3',
  }
  const cases = [
    { records: [{ ...valid, lotteryType: 'fc3d' }], code: 'LOTTERYMCP_ONLY_PL3_SUPPORTED' },
    { records: [{ ...valid, numbers: '1,2' }], code: 'LOTTERYMCP_PL3_INVALID_NUMBERS' },
    { records: [{ ...valid, drawDate: '2026-02-30' }], code: 'LOTTERYMCP_PL3_INVALID_DRAW_DATE' },
    {
      records: [valid, { ...valid, numbers: '9,8,7' }],
      code: 'LOTTERYMCP_PL3_DUPLICATE_PERIOD',
    },
  ]

  for (const [index, fixture] of cases.entries()) {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), `lotterymcp-invalid-cache-${index}-`))
    writeFileSync(path.join(dataDir, 'pl3.json'), JSON.stringify({ records: fixture.records }), 'utf8')
    const client = createLotteryMcpClient({ apiBaseUrl: '', dataMode: 'official', dataDir })
    await assert.rejects(
      () => client.getHistory({}),
      (error) => error instanceof McpApiError && error.code === fixture.code,
    )
  }
})

test('remote provider rejects invalid P3 data from all four endpoints', async () => {
  const { McpApiError, createLotteryMcpClient } = await import(coreEntryUrl)
  const meta = { plan: 'member', provider: 'remote', requestLimit: null, generatedAt: '2026-01-01T00:00:00.000Z' }
  const payloads = {
    latest: { data: { lotteryType: 'fc3d', period: '2026001', drawDate: '2026-01-01', numbers: '1,2,3' }, meta },
    history: { data: [{ lotteryType: 'pl3', period: '2026001', drawDate: '2026-01-01', numbers: '1,2' }], meta },
    periods: { data: [{ lotteryType: 'pl3', period: '2026001', drawDate: '2026-02-30' }], meta },
    summary: { data: { lotteryType: 'fc3d', total: 1, latestPeriod: '2026001', latestDrawDate: '2026-01-01' }, meta },
  }
  const client = createLotteryMcpClient({
    apiBaseUrl: 'https://api.example.com',
    token: 'test-token',
    fetchImpl: async (input) => {
      const endpoint = new URL(input).pathname.split('/').at(-1)
      return new Response(JSON.stringify(payloads[endpoint]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })

  for (const operation of [
    () => client.getLatest({}),
    () => client.getHistory({}),
    () => client.getPeriods({}),
    () => client.getSummary({}),
  ]) {
    await assert.rejects(operation, (error) => {
      assert.ok(error instanceof McpApiError)
      assert.equal(error.statusCode, 502)
      assert.equal(error.code, 'LOTTERYMCP_PL3_INVALID_REMOTE_RESPONSE')
      return true
    })
  }
})

test('remote and official providers produce the same pl3 prediction for the same history', async () => {
  const records = Array.from({ length: 100 }, (_, index) => ({
    lotteryType: 'pl3',
    period: String(26001 + index),
    drawDate: `2026-01-${String((index % 28) + 1).padStart(2, '0')}`,
    numbers: `${index % 10},${(index + 3) % 10},${(index + 6) % 10}`,
  })).reverse()
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'lotterymcp-provider-parity-'))
  const officialDir = path.join(tempDir, 'official')
  const remoteDir = path.join(tempDir, 'remote')
  await import('node:fs/promises').then(({ mkdir }) => mkdir(officialDir, { recursive: true }))
  writeFileSync(path.join(officialDir, 'pl3.json'), JSON.stringify({ records }), 'utf8')

  const { createLotteryMcpClient, createPl3PredictionService } = await import(coreEntryUrl)
  const officialClient = createLotteryMcpClient({ apiBaseUrl: '', dataMode: 'official', dataDir: officialDir })
  const remoteClient = createLotteryMcpClient({
    apiBaseUrl: 'https://api.example.com',
    token: 'test-token',
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          data: records,
          meta: {
            plan: 'member',
            provider: 'remote',
            requestLimit: null,
            generatedAt: new Date().toISOString(),
            hasMore: false,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
  })
  const query = { periods: 100, tickets: 5, playType: 'mixed', generatedAt: '2026-01-01T00:00:00.000Z' }
  const official = await createPl3PredictionService(officialClient, { dataDir: officialDir }).predict(query)
  const remote = await createPl3PredictionService(remoteClient, { dataDir: remoteDir }).predict(query)

  assert.equal(official.data.predictionId, remote.data.predictionId)
  assert.deepEqual(official.data.tickets, remote.data.tickets)
  assert.equal(official.meta.provider, 'official')
  assert.equal(remote.meta.provider, 'remote')
})
