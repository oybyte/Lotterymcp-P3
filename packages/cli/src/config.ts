import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export type NbcpConfig = {
  apiBaseUrl: string
  token: string
  defaultPeriods: string
  dataMode?: 'remote' | 'official'
  dataDir?: string
}

export const DEFAULT_API_BASE_URL = 'https://www.neuxsbot.com'
export const DEFAULT_PERIODS = '100'
export const DEFAULT_DATA_MODE = 'remote'
export const DEFAULT_DATA_DIR = '.lotterymcp-data'
export const CONFIG_DIRNAME = '.neuxsbot'
export const CONFIG_FILENAME = 'cp.config.json'

export const getConfigPath = () =>
  process.env.NBCP_CONFIG_PATH || path.join(os.homedir(), CONFIG_DIRNAME, CONFIG_FILENAME)

export const loadLocalConfig = async (): Promise<Partial<NbcpConfig>> => {
  try {
    const configText = await readFile(getConfigPath(), 'utf8')
    const parsed = JSON.parse(configText) as Partial<NbcpConfig>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export const resolveConfig = async (): Promise<Partial<NbcpConfig>> => {
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

export const saveLocalConfig = async (config: NbcpConfig) => {
  const configPath = getConfigPath()
  await mkdir(path.dirname(configPath), { recursive: true })
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}

export const validateConfig = (config: Partial<NbcpConfig>) => {
  const missing: string[] = []

  if (!config.apiBaseUrl?.trim()) {
    missing.push('API_BASE_URL')
  }

  if ((config.dataMode || DEFAULT_DATA_MODE) !== 'official' && !config.token?.trim()) {
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

export const renderMcpConfigSnippet = (config: NbcpConfig) =>
  JSON.stringify(
    {
      mcpServers: {
        'neuxsbot-cp': {
          command: 'npx',
          args: ['-y', 'lotterymcp@latest', 'serve'],
          env: {
            NEUXSBOT_API_BASE_URL: config.apiBaseUrl,
            NEUXSBOT_DEFAULT_PERIODS: config.defaultPeriods,
            LOTTERYMCP_DATA_MODE: config.dataMode || DEFAULT_DATA_MODE,
            ...(config.dataMode === 'official'
              ? { LOTTERYMCP_DATA_DIR: config.dataDir || DEFAULT_DATA_DIR }
              : { NEUXSBOT_TOKEN: config.token }),
          },
        },
      },
    },
    null,
    2,
  )
