import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export type LotteryMcpConfig = {
  apiBaseUrl: string
  token: string
  defaultPeriods: string
  dataMode?: 'remote' | 'official'
  dataDir?: string
}

/** @deprecated Use LotteryMcpConfig instead. */
export type NbcpConfig = LotteryMcpConfig

export const DEFAULT_API_BASE_URL = 'https://www.neuxsbot.com'
export const DEFAULT_PERIODS = '100'
export const DEFAULT_DATA_MODE = 'remote'
export const DEFAULT_DATA_DIR = '.lotterymcp-data'
export const CONFIG_DIRNAME = '.neuxsbot'
export const CONFIG_FILENAME = 'cp.config.json'

export const getConfigPath = () =>
  process.env.NBCP_CONFIG_PATH || path.join(os.homedir(), CONFIG_DIRNAME, CONFIG_FILENAME)

export const loadLocalConfig = async (): Promise<Partial<LotteryMcpConfig>> => {
  try {
    const configText = await readFile(getConfigPath(), 'utf8')
    const parsed = JSON.parse(configText) as Partial<LotteryMcpConfig>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export const resolveConfig = async (): Promise<Partial<LotteryMcpConfig>> => {
  const localConfig = await loadLocalConfig()
  const dataMode = process.env.LOTTERYMCP_DATA_MODE || localConfig.dataMode || DEFAULT_DATA_MODE

  return {
    apiBaseUrl: process.env.NEUXSBOT_API_BASE_URL || localConfig.apiBaseUrl || DEFAULT_API_BASE_URL,
    token: process.env.NEUXSBOT_TOKEN || localConfig.token || '',
    defaultPeriods: process.env.NEUXSBOT_DEFAULT_PERIODS || localConfig.defaultPeriods || DEFAULT_PERIODS,
    dataMode: dataMode === 'official' ? 'official' : 'remote',
    dataDir: process.env.LOTTERYMCP_DATA_DIR || localConfig.dataDir || DEFAULT_DATA_DIR,
  }
}

export const saveLocalConfig = async (config: LotteryMcpConfig) => {
  const configPath = getConfigPath()
  await mkdir(path.dirname(configPath), { recursive: true })
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}

export const validateConfig = (config: Partial<LotteryMcpConfig>) => {
  const missing: string[] = []
  const dataMode = config.dataMode || DEFAULT_DATA_MODE

  if (dataMode === 'remote' && !config.apiBaseUrl?.trim()) {
    missing.push('API_BASE_URL')
  }

  if (dataMode === 'remote' && !config.token?.trim()) {
    missing.push('TOKEN')
  }

  if (!config.defaultPeriods?.trim() || !/^\d+$/.test(config.defaultPeriods.trim())) {
    missing.push('DEFAULT_PERIODS')
  }

  return missing
}

export const maskToken = (token: string) => {
  if (!token) {
    return '(未设置)'
  }

  if (token.length <= 8) {
    return `${token.slice(0, 2)}***`
  }

  return `${token.slice(0, 4)}***${token.slice(-4)}`
}

export const renderMcpConfigSnippet = (config: LotteryMcpConfig) =>
  JSON.stringify(
    {
      mcpServers: {
        lotterymcp: {
          command: 'npx',
          args: ['-y', 'lotterymcp@latest', 'serve'],
          env: {
            NEUXSBOT_DEFAULT_PERIODS: config.defaultPeriods,
            LOTTERYMCP_DATA_MODE: config.dataMode || DEFAULT_DATA_MODE,
            ...(config.dataMode === 'official'
              ? { LOTTERYMCP_DATA_DIR: config.dataDir || DEFAULT_DATA_DIR }
              : {
                  NEUXSBOT_API_BASE_URL: config.apiBaseUrl,
                  NEUXSBOT_TOKEN: config.token,
                }),
          },
        },
      },
    },
    null,
    2,
  )
