import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cliEntry = path.join(repoRoot, 'packages', 'cli', 'dist', 'index.js')
const configEntryUrl = pathToFileURL(path.join(repoRoot, 'packages', 'cli', 'dist', 'config.js')).href
const coreEntryUrl = pathToFileURL(path.join(repoRoot, 'packages', 'core', 'dist', 'index.js')).href

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

const runCli = (args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliEntry, ...args], {
      cwd: repoRoot,
      env: {
        ...process.env,
        ...(options.env || {}),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => {
      resolve({
        status: code,
        stdout,
        stderr,
      })
    })

    if (options.input) {
      child.stdin.write(options.input)
    }
    child.stdin.end()
  })

test('cli --help exits successfully and shows readable Chinese help', () => {
  const result = spawnSync(process.execPath, [cliEntry, '--help'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })

  assert.equal(result.status, 0)
  assert.match(result.stdout, /使用方法:/)
  assert.match(result.stdout, /启动 MCP stdio 服务/)
  assert.match(result.stdout, /生成排列3候选与 walk-forward 回测/)
  assert.match(result.stdout, /remote 模式配置官网 Token；official 模式同步公开排列3数据/)
  assert.match(result.stdout, /npx --yes lotterymcp@latest/)
  assert.equal(result.stderr, '')
})

test('cli without args shows the startup menu in Chinese and can exit cleanly', () => {
  const result = spawnSync(process.execPath, [cliEntry], {
    cwd: repoRoot,
    encoding: 'utf8',
    input: '0\n',
    env: {
      ...process.env,
      NBCP_FORCE_BANNER: '1',
      NBCP_FORCE_MENU: '1',
    },
  })

  assert.equal(result.status, 0)
  assert.ok(result.stdout.includes('Lotterymcp'))
  assert.match(result.stdout, /请选择操作：/)
  assert.match(result.stdout, /1\.\s+注册\/登录并获取 Token/)
  assert.match(result.stdout, /2\.\s+配置数据模式和默认期数/)
  assert.match(result.stdout, /3\.\s+生成 MCP 配置片段/)
  assert.match(result.stdout, /4\.\s+检查当前配置和网站连通性/)
  assert.match(result.stdout, /5\.\s+启动 MCP 服务/)
  assert.match(result.stdout, /6\.\s+生成排列3预测与回测/)
  assert.match(result.stdout, /0\.\s+退出/)
  assert.match(result.stdout, /请输入数字：/)
  assert.match(result.stdout, /已退出。/)
  assert.equal(result.stderr, '')
})

test('cli init saves API base URL, token, and default periods', () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'nbcp-config-'))
  const configPath = path.join(tempDir, 'cp.config.json')
  const result = spawnSync(process.execPath, [cliEntry, 'init'], {
    cwd: repoRoot,
    encoding: 'utf8',
    input: 'https://api.example.com\nmy-token-123456\n188\n',
    env: {
      ...process.env,
      NBCP_CONFIG_PATH: configPath,
    },
  })

  assert.equal(result.status, 0)
  assert.match(result.stdout, /配置已保存。/)
  assert.match(result.stdout, /配置文件:/)
  assert.match(result.stdout, /Token 是敏感信息/)
  const savedConfig = JSON.parse(readFileSync(configPath, 'utf8'))
  assert.deepEqual(savedConfig, {
    apiBaseUrl: 'https://api.example.com',
    token: 'my-token-123456',
    defaultPeriods: '188',
    dataMode: 'remote',
    dataDir: '.lotterymcp-data',
  })
  assert.equal(result.stderr, '')
})

test('cli init configures official mode without a token', async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'lotterymcp-official-config-'))
  const configPath = path.join(tempDir, 'cp.config.json')
  const dataDir = path.join(tempDir, 'data')
  const result = await runCli([
    'init', '--mode', 'official', '--data-dir', dataDir, '--periods', '200',
  ], {
    env: {
      NBCP_CONFIG_PATH: configPath,
      NEUXSBOT_TOKEN: 'environment-token-must-not-be-saved',
    },
  })

  assert.equal(result.status, 0)
  assert.match(result.stdout, /DATA_MODE: official/)
  assert.doesNotMatch(result.stdout, /Token 是敏感信息|environment-token/)
  const saved = JSON.parse(readFileSync(configPath, 'utf8'))
  assert.equal(saved.dataMode, 'official')
  assert.equal(saved.dataDir, dataDir)
  assert.equal(saved.defaultPeriods, '200')
  assert.equal(saved.token, '')
})

test('cli init supports named remote options', async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'lotterymcp-remote-config-'))
  const configPath = path.join(tempDir, 'cp.config.json')
  const result = await runCli([
    'init', '--mode', 'remote', '--api-base-url', 'https://api.example.com',
    '--token', 'named-token', '--periods', '188',
  ], { env: { NBCP_CONFIG_PATH: configPath } })

  assert.equal(result.status, 0)
  const saved = JSON.parse(readFileSync(configPath, 'utf8'))
  assert.equal(saved.dataMode, 'remote')
  assert.equal(saved.apiBaseUrl, 'https://api.example.com')
  assert.equal(saved.token, 'named-token')
  assert.equal(saved.defaultPeriods, '188')
})

test('official MCP snippet does not include remote credentials', async () => {
  const { renderMcpConfigSnippet } = await import(configEntryUrl)
  const snippet = JSON.parse(renderMcpConfigSnippet({
    apiBaseUrl: 'https://api.example.com',
    token: 'must-not-leak',
    defaultPeriods: '200',
    dataMode: 'official',
    dataDir: '.lotterymcp-data',
  }))
  const env = snippet.mcpServers.lotterymcp.env
  assert.equal(env.LOTTERYMCP_DATA_MODE, 'official')
  assert.equal(env.LOTTERYMCP_DATA_DIR, '.lotterymcp-data')
  assert.equal(env.NEUXSBOT_API_BASE_URL, undefined)
  assert.equal(env.NEUXSBOT_TOKEN, undefined)
})

test('cli subcommands expose focused help without hidden aliases', async () => {
  for (const command of ['init', 'predict', 'sync', 'doctor', 'data', 'experiment', 'ops']) {
    const result = await runCli([command, '--help'])
    assert.equal(result.status, 0, command)
    assert.match(result.stdout, /用法:/)
    assert.doesNotMatch(result.stdout, /(?:^|\s)--all(?:\s|$)|pl3_markov/)
    assert.equal(result.stderr, '')
  }
})

test('cli data migration performs explicit dry-run and side-by-side apply', async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'lotterymcp-cli-migrate-'))
  writeFileSync(path.join(dataDir, 'pl3.json'), JSON.stringify({
    records: [{
      lotteryType: 'pl3',
      period: '26180',
      drawDate: '2026-07-01',
      numbers: '1,2,3',
      numbersList: [1, 2, 3],
    }],
  }), 'utf8')
  writeFileSync(path.join(dataDir, 'pl3-predictions.json'), JSON.stringify({
    version: 1,
    predictions: [{ predictionId: 'cli-legacy-prediction' }],
  }), 'utf8')
  const env = { LOTTERYMCP_DATA_DIR: dataDir }

  const before = await runCli(['data', 'status'], { env })
  assert.equal(before.status, 0)
  assert.match(before.stdout, /legacy-json/)
  assert.match(before.stdout, /有效记录: 1/)

  const dryRun = await runCli(['data', 'migrate', '--dry-run'], { env })
  assert.equal(dryRun.status, 0)
  assert.match(dryRun.stdout, /迁移预检通过/)
  assert.equal(existsSync(path.join(dataDir, 'pl3.sqlite')), false)

  const applied = await runCli(['data', 'migrate', '--apply'], { env })
  assert.equal(applied.status, 0)
  assert.match(applied.stdout, /SQLite 迁移完成/)
  assert.equal(existsSync(path.join(dataDir, 'pl3.sqlite')), true)
  assert.equal(existsSync(path.join(dataDir, 'pl3.json')), true)

  const after = await runCli(['data', 'status'], { env })
  assert.equal(after.status, 0)
  assert.match(after.stdout, /数据存储: sqlite/)
  assert.match(after.stdout, /可用记录: 1/)
  assert.match(after.stdout, /已保全旧预测: 1/)

  const schemaDryRun = await runCli(['data', 'migrate', '--dry-run'], { env })
  assert.equal(schemaDryRun.status, 0)
  assert.match(schemaDryRun.stdout, /当前版本: 1/)
  assert.match(schemaDryRun.stdout, /M002 p3-experiment-foundation/)
  assert.match(schemaDryRun.stdout, /M003 p3-online-operations/)
  const schemaApplied = await runCli(['data', 'migrate', '--apply'], { env })
  assert.equal(schemaApplied.status, 0)
  assert.match(schemaApplied.stdout, /schema 迁移完成/)
  const experiments = await runCli(['experiment', 'list'], { env })
  assert.equal(experiments.status, 0)
  assert.match(experiments.stdout, /当前没有排列3实验/)
})

test('cli doctor performs a real health check and reports success in Chinese', async () => {
  const requests = []
  const server = await startJsonServer((req, res) => {
    requests.push({ url: req.url, headers: req.headers })
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    res.end(
      JSON.stringify({
        ok: true,
        service: 'nexusbot-lottery-api',
        transport: 'rest',
        auth: { header: 'x-api-key' },
        tools: ['lottery.latest', 'lottery.history', 'lottery.periods', 'lottery.summary'],
      }),
    )
  })

  try {
    const result = await runCli(['doctor'], {
      env: {
        LOTTERYMCP_DATA_MODE: 'remote',
        NEUXSBOT_API_BASE_URL: server.origin,
        NEUXSBOT_TOKEN: 'doctor-token-001',
        NEUXSBOT_DEFAULT_PERIODS: '100',
      },
    })

    assert.equal(result.status, 0)
    assert.match(result.stdout, /当前配置:/)
    assert.match(result.stdout, /网站接口正常/)
    assert.match(result.stdout, /服务名称: nexusbot-lottery-api/)
    assert.doesNotMatch(result.stdout, /doctor-token-001/)
    assert.equal(requests[0]?.url, '/api/v1/mcp/health')
    assert.equal(requests[0]?.headers['x-api-key'], 'doctor-token-001')
    assert.equal(result.stderr, '')
  } finally {
    await server.close()
  }
})

test('cli doctor reports friendly guidance when the website rate limits requests', async () => {
  const server = await startJsonServer((_req, res) => {
    res.writeHead(429, {
      'content-type': 'application/json; charset=utf-8',
      'retry-after': '0',
    })
    res.end(
      JSON.stringify({
        statusCode: 429,
        code: 'MCP_RATE_LIMITED',
        message: '请求过于频繁，请稍后重试。',
      }),
    )
  })

  try {
    const result = await runCli(['doctor'], {
      env: {
        LOTTERYMCP_DATA_MODE: 'remote',
        NEUXSBOT_API_BASE_URL: server.origin,
        NEUXSBOT_TOKEN: 'doctor-token-002',
        NEUXSBOT_DEFAULT_PERIODS: '100',
      },
    })

    assert.equal(result.status, 1)
    assert.match(result.stdout, /当前配置:/)
    assert.match(result.stderr, /请求过于频繁/)
    assert.match(result.stderr, /降低默认期数|调用频率/)
  } finally {
    await server.close()
  }
})

test('cli login points users to the account token page', () => {
  const result = spawnSync(process.execPath, [cliEntry, 'login'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })

  assert.equal(result.status, 0)
  assert.match(result.stdout, /官网首页: https:\/\/www\.neuxsbot\.com/)
  assert.match(result.stdout, /官网账号页: https:\/\/www\.neuxsbot\.com\/member/)
  assert.equal(result.stderr, '')
})

test('cli serve stays silent on stdout when config is incomplete', () => {
  const result = spawnSync(process.execPath, [cliEntry, 'serve'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      NBCP_FORCE_BANNER: '1',
      LOTTERYMCP_DATA_MODE: 'remote',
      NEUXSBOT_API_BASE_URL: '',
      NEUXSBOT_TOKEN: '',
    },
  })

  assert.equal(result.status, 1)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /未检测到完整配置/)
})

test('cli sync defaults to pl3 and writes official cache from a public-source compatible endpoint', async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'lotterymcp-sync-'))
  const server = await startJsonServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    res.end(
      JSON.stringify({
        value: {
          list: [
            {
              lotteryDrawNum: '2026002',
              lotteryDrawTime: '2026-01-02',
              lotteryDrawResult: '4 5 6',
            },
            {
              lotteryDrawNum: '2026001',
              lotteryDrawTime: '2026-01-01',
              lotteryDrawResult: '1 2 3',
            },
          ],
        },
      }),
    )
  })

  try {
    const result = await runCli(['sync', '--source', 'official', '--limit', '2'], {
      env: {
        LOTTERYMCP_DATA_DIR: tempDir,
        LOTTERYMCP_SPORTTERY_API_URL: server.origin,
      },
    })

    assert.equal(result.status, 0)
    assert.match(result.stdout, /同步完成/)
    assert.match(result.stdout, /lotterymcp init --mode official/)
    const saved = JSON.parse(readFileSync(path.join(tempDir, 'pl3.json'), 'utf8'))
    assert.equal(saved.provider, 'official')
    assert.equal(saved.records.length, 2)
    assert.equal(saved.records[0].period, '2026002')
    assert.deepEqual(saved.records[0].numbersList, [4, 5, 6])
  } finally {
    await server.close()
  }
})

test('cli sync rejects non-pl3 official lottery types', async () => {
  const result = await runCli(['sync', '--source', 'official', '--lottery', 'fc3d', '--limit', '2'])

  assert.equal(result.status, 1)
  assert.match(result.stderr, /未支持的官方彩种: fc3d/)
  assert.match(result.stdout, /支持彩种: pl3/)
  assert.doesNotMatch(result.stdout, /--all/)
})

test('cli sync enforces the P3 cache limit boundary', async () => {
  for (const limit of ['1.5', '1001']) {
    const result = await runCli(['sync', '--source', 'official', '--limit', limit])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /同步期数必须是 1-1000 的整数/)
  }
})

test('cli sync keeps --all as a hidden pl3 compatibility flag', async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'lotterymcp-sync-all-'))
  const server = await startJsonServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    res.end(
      JSON.stringify({
        value: {
          list: [
          {
            lotteryDrawNum: '2026001',
            lotteryDrawTime: '2026-01-01',
            lotteryDrawResult: '1 2 3',
          },
        ],
        },
      }),
    )
  })

  try {
    const result = await runCli(['sync', '--source', 'official', '--all', '--limit', '1'], {
      env: {
        LOTTERYMCP_DATA_DIR: tempDir,
        LOTTERYMCP_SPORTTERY_API_URL: server.origin,
      },
    })

    assert.equal(result.status, 0)
    assert.match(result.stdout, /正在同步 pl3/)
    assert.doesNotThrow(() => readFileSync(path.join(tempDir, 'pl3.json'), 'utf8'))
  } finally {
    await server.close()
  }
})

test('cli doctor supports official mode without a token when cache exists', async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'lotterymcp-official-doctor-'))
  const server = await startJsonServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    res.end(
      JSON.stringify({
        value: {
          list: [
          {
            lotteryDrawNum: '2026001',
            lotteryDrawTime: '2026-01-01',
            lotteryDrawResult: '1 2 3',
          },
        ],
        },
      }),
    )
  })

  try {
    const syncResult = await runCli(['sync', '--source', 'official', '--lottery', 'pl3', '--limit', '1'], {
      env: {
        LOTTERYMCP_DATA_DIR: tempDir,
        LOTTERYMCP_SPORTTERY_API_URL: server.origin,
      },
    })
    assert.equal(syncResult.status, 0)

    const result = await runCli(['doctor'], {
      env: {
        LOTTERYMCP_DATA_MODE: 'official',
        LOTTERYMCP_DATA_DIR: tempDir,
        NEUXSBOT_API_BASE_URL: '',
        NEUXSBOT_TOKEN: '',
      },
    })

    assert.equal(result.status, 0)
    assert.match(result.stdout, /DATA_MODE: official/)
    assert.match(result.stdout, /官方本地数据源正常/)
    assert.match(result.stdout, /数据来源: official/)
    assert.doesNotMatch(result.stdout, /鉴权头:/)
  } finally {
    await server.close()
  }
})

test('cli predict and analyze alias use the same TypeScript pl3 engine in official mode', async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'lotterymcp-cli-predict-'))
  const records = Array.from({ length: 100 }, (_, index) => ({
    lotteryType: 'pl3',
    period: String(26001 + index),
    drawDate: `2026-01-${String(index % 28 + 1).padStart(2, '0')}`,
    numbers: `${index % 10},${(index + 3) % 10},${(index + 6) % 10}`,
  })).reverse()
  const cachePath = path.join(tempDir, 'pl3.json')
  await import('node:fs/promises').then(({ writeFile }) => writeFile(cachePath, JSON.stringify({ records }), 'utf8'))
  const env = {
    LOTTERYMCP_DATA_MODE: 'official',
    LOTTERYMCP_DATA_DIR: tempDir,
    NEUXSBOT_API_BASE_URL: '',
    NEUXSBOT_TOKEN: '',
  }

  const prediction = await runCli(['predict', '--periods', '100', '--tickets', '3', '--play', 'mixed'], { env })
  assert.equal(prediction.status, 0)
  assert.match(prediction.stdout, /排列3预测结果/)
  assert.match(prediction.stdout, /玩法\/注数: mixed \/ 3/)
  assert.doesNotMatch(prediction.stdout, /Python/)

  const alias = await runCli(['analyze', 'p3', '--periods', '100', '--tickets', '3'], { env })
  assert.equal(alias.status, 0)
  assert.match(alias.stdout, /排列3预测结果/)

  const rejected = await runCli(['analyze', 'fc3d'], { env })
  assert.equal(rejected.status, 1)
  assert.match(rejected.stderr, /未知参数: fc3d/)
})

test('cli ops run-once generates a local daily report from SQLite data', async () => {
  const core = await import(coreEntryUrl)
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'lotterymcp-ops-run-'))
  const records = Array.from({ length: 100 }, (_, index) => ({
    lotteryType: 'pl3',
    period: String(27001 + index),
    drawDate: `2026-02-${String(index % 28 + 1).padStart(2, '0')}`,
    numbers: `${index % 10},${(index + 4) % 10},${(index + 8) % 10}`,
  }))
  const store = core.openPl3Store({ dataDir: tempDir })
  store.importRecords(records, { provider: 'file-import' })
  store.close()
  await core.applyPl3SchemaMigration(tempDir)

  const result = await runCli([
    'ops', 'run-once', '--no-sync', '--no-notify', '--periods', '100', '--tickets', '3', '--json',
  ], {
    env: {
      LOTTERYMCP_DATA_MODE: 'official',
      LOTTERYMCP_DATA_DIR: tempDir,
      NEUXSBOT_API_BASE_URL: '',
      NEUXSBOT_TOKEN: '',
    },
  })

  assert.equal(result.status, 0)
  const payload = JSON.parse(result.stdout)
  assert.match(payload.runId, /^p3-/)
  assert.equal(payload.prediction.training.recordCount, 100)
  assert.equal(existsSync(payload.report.htmlPath), true)
})
