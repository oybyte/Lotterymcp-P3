import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import {
  PL3_LOTTERY_TYPE,
  PL3_MCP_TOOLS,
  McpApiError,
  createLotteryMcpClient,
  createPl3PredictionService,
  formatMcpApiError,
  type Pl3PayoutConfig,
  type Pl3PlayType,
  type Pl3McpToolName,
  type Pl3LotteryType,
  type LotteryMcpClient,
  type LotteryMcpClientConfig,
} from 'lotterymcp-core'
import { z } from 'zod'

export const MCP_SERVER_TRANSPORT = 'stdio'
export const MCP_SERVER_TOOLS = PL3_MCP_TOOLS

export type LotteryMcpServerOptions = LotteryMcpClientConfig & {
  predictionPayouts?: Partial<Pl3PayoutConfig>
}

type LotteryMcpClientLike = Pick<LotteryMcpClient, 'getLatest' | 'getHistory' | 'getPeriods' | 'getSummary'>

export type LotteryToolDefinition = {
  name: Pl3McpToolName
  description: string
  inputSchema: Record<string, z.ZodTypeAny>
  handler: (args: Record<string, unknown>) => Promise<CallToolResult>
}

const DEFAULT_PERIODS = 100

const normalizeDefaultPeriods = (value: unknown) => {
  const parsed = Number(String(value || '').trim())
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_PERIODS
}

const parsePl3LotteryType = (value: unknown): Pl3LotteryType | undefined => {
  if (value === undefined) return undefined
  if (value === PL3_LOTTERY_TYPE) return PL3_LOTTERY_TYPE
  throw new McpApiError({
    statusCode: 400,
    code: 'LOTTERYMCP_ONLY_PL3_SUPPORTED',
    message: `当前版本只支持排列3(pl3)，不支持 ${String(value || '(空)')}。`,
  })
}

const pl3LotteryTypeSchema = () =>
  z.literal(PL3_LOTTERY_TYPE).optional().describe('可选。省略时默认 pl3。')

const serializeToolPayload = (payload: unknown) => JSON.stringify(payload, null, 2)

const createSuccessResult = (payload: unknown): CallToolResult => ({
  isError: false,
  content: [{ type: 'text', text: serializeToolPayload(payload) }],
  structuredContent: payload as Record<string, unknown>,
})

const createErrorResult = (error: unknown): CallToolResult => {
  if (error instanceof McpApiError) {
    return {
      isError: true,
      content: [{ type: 'text', text: formatMcpApiError(error) }],
      structuredContent: {
        statusCode: error.statusCode,
        code: error.code,
        message: error.message,
        upgradeUrl: error.upgradeUrl,
        displayMode: error.displayMode,
        action: error.action,
      },
    }
  }

  const message = error instanceof Error ? error.message : String(error)
  return {
    isError: true,
    content: [{ type: 'text', text: `调用失败: ${message}` }],
  }
}

const withToolExecution = async (callback: () => Promise<unknown>) => {
  try {
    return createSuccessResult(await callback())
  } catch (error) {
    return createErrorResult(error)
  }
}

export const createLotteryToolCatalog = (
  client: LotteryMcpClientLike,
  options?: {
    defaultPeriods?: number | string
    dataDir?: string
    predictionPayouts?: Partial<Pl3PayoutConfig>
  },
): LotteryToolDefinition[] => {
  const fallbackLimit = normalizeDefaultPeriods(options?.defaultPeriods)
  const predictionService = createPl3PredictionService(client, {
    defaultPeriods: 200,
    dataDir: options?.dataDir,
    payouts: options?.predictionPayouts,
  })

  return [
    {
      name: 'lottery.latest',
      description: '获取排列3最新开奖数据。',
      inputSchema: {
        lotteryType: pl3LotteryTypeSchema(),
      },
      handler: async (args) =>
        withToolExecution(() =>
          client.getLatest({ lotteryType: parsePl3LotteryType(args.lotteryType) })),
    },
    {
      name: 'lottery.history',
      description: '查询排列3历史开奖列表，未传 limit 时默认使用本地配置期数。',
      inputSchema: {
        lotteryType: pl3LotteryTypeSchema(),
        period: z.string().optional().describe('可选。按期号筛选。'),
        fromDate: z.string().optional().describe('可选。开始日期，格式 YYYY-MM-DD。'),
        toDate: z.string().optional().describe('可选。结束日期，格式 YYYY-MM-DD。'),
        page: z.number().int().positive().optional().describe('可选。分页页码。'),
        limit: z.number().int().positive().optional().describe('可选。返回条数。'),
      },
      handler: async (args) =>
        withToolExecution(() =>
          client.getHistory({
            lotteryType: parsePl3LotteryType(args.lotteryType),
            period: typeof args.period === 'string' ? args.period : undefined,
            fromDate: typeof args.fromDate === 'string' ? args.fromDate : undefined,
            toDate: typeof args.toDate === 'string' ? args.toDate : undefined,
            page: typeof args.page === 'number' ? args.page : undefined,
            limit: typeof args.limit === 'number' ? args.limit : fallbackLimit,
          })),
    },
    {
      name: 'lottery.periods',
      description: '列出排列3历史期号列表。',
      inputSchema: {
        lotteryType: pl3LotteryTypeSchema(),
        page: z.number().int().positive().optional().describe('可选。分页页码。'),
        limit: z.number().int().positive().optional().describe('可选。返回条数。'),
      },
      handler: async (args) =>
        withToolExecution(() =>
          client.getPeriods({
            lotteryType: parsePl3LotteryType(args.lotteryType),
            page: typeof args.page === 'number' ? args.page : undefined,
            limit: typeof args.limit === 'number' ? args.limit : fallbackLimit,
          })),
    },
    {
      name: 'lottery.summary',
      description: '查看排列3数据摘要。',
      inputSchema: {
        lotteryType: pl3LotteryTypeSchema(),
      },
      handler: async (args) =>
        withToolExecution(() =>
          client.getSummary({
            lotteryType: parsePl3LotteryType(args.lotteryType),
          })),
    },
    {
      name: 'lottery.predict',
      description: '基于排列3历史数据生成确定性候选排序和无未来数据泄漏的 walk-forward 回测。评分不是中奖概率。',
      inputSchema: {
        lotteryType: pl3LotteryTypeSchema(),
        periods: z.number().int().min(100).max(1000).optional().describe('可选。读取历史期数，默认 200。'),
        tickets: z.number().int().min(1).max(100).optional().describe('可选。候选注数，默认 10。'),
        playType: z.enum(['direct', 'group3', 'group6', 'mixed']).optional().describe('可选。玩法，默认 mixed。'),
      },
      handler: async (args) =>
        withToolExecution(() => predictionService.predict({
          lotteryType: parsePl3LotteryType(args.lotteryType),
          periods: typeof args.periods === 'number' ? args.periods : undefined,
          tickets: typeof args.tickets === 'number' ? args.tickets : undefined,
          playType: typeof args.playType === 'string' ? args.playType as Pl3PlayType : undefined,
        })),
    },
  ]
}

export const createLotteryMcpServer = (options: LotteryMcpServerOptions) => {
  const client = createLotteryMcpClient(options)
  const server = new McpServer({
    name: 'neuxsbot-lottery-mcp',
    version: '0.7.0',
  })

  const toolCatalog = createLotteryToolCatalog(client, {
    defaultPeriods: options.defaultPeriods,
    dataDir: options.dataDir,
    predictionPayouts: options.predictionPayouts,
  })

  toolCatalog.forEach((tool) => {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      async (args) => tool.handler(args as Record<string, unknown>),
    )
  })

  return {
    client,
    server,
    toolCatalog,
  }
}

export const startLotteryMcpStdioServer = async (options: LotteryMcpServerOptions) => {
  const { client, server, toolCatalog } = createLotteryMcpServer(options)
  const transport = new StdioServerTransport()
  await server.connect(transport)

  return {
    client,
    server,
    toolCatalog,
    transport,
  }
}

/** @deprecated Use startLotteryMcpStdioServer instead. */
export const startNbcpStdioServer = startLotteryMcpStdioServer
