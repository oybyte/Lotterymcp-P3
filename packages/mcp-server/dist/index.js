import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { LOTTERY_MCP_TOOLS, McpApiError, createLotteryMcpClient, createPl3PredictionService, formatMcpApiError, } from 'lotterymcp-core';
import { z } from 'zod';
export const MCP_SERVER_TRANSPORT = 'stdio';
export const MCP_SERVER_TOOLS = [...LOTTERY_MCP_TOOLS, 'lottery.predict'];
const DEFAULT_PERIODS = 100;
const normalizeDefaultPeriods = (value) => {
    const parsed = Number(String(value || '').trim());
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_PERIODS;
};
const serializeToolPayload = (payload) => JSON.stringify(payload, null, 2);
const createSuccessResult = (payload) => ({
    isError: false,
    content: [{ type: 'text', text: serializeToolPayload(payload) }],
    structuredContent: payload,
});
const createErrorResult = (error) => {
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
        };
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
        isError: true,
        content: [{ type: 'text', text: `调用失败: ${message}` }],
    };
};
const withToolExecution = async (callback) => {
    try {
        return createSuccessResult(await callback());
    }
    catch (error) {
        return createErrorResult(error);
    }
};
export const createLotteryToolCatalog = (client, options) => {
    const fallbackLimit = normalizeDefaultPeriods(options?.defaultPeriods);
    const predictionService = createPl3PredictionService(client, {
        defaultPeriods: 200,
        dataDir: options?.dataDir,
        payouts: options?.predictionPayouts,
    });
    return [
        {
            name: 'lottery.latest',
            description: '获取排列3最新开奖数据。',
            inputSchema: {
                lotteryType: z.string().optional().describe('可选。当前版本仅支持 pl3，省略时默认 pl3。'),
            },
            handler: async (args) => withToolExecution(() => client.getLatest({ lotteryType: typeof args.lotteryType === 'string' ? args.lotteryType : undefined })),
        },
        {
            name: 'lottery.history',
            description: '查询排列3历史开奖列表，未传 limit 时默认使用本地配置期数。',
            inputSchema: {
                lotteryType: z.string().optional().describe('可选。当前版本仅支持 pl3，省略时默认 pl3。'),
                period: z.string().optional().describe('可选。按期号筛选。'),
                fromDate: z.string().optional().describe('可选。开始日期，格式 YYYY-MM-DD。'),
                toDate: z.string().optional().describe('可选。结束日期，格式 YYYY-MM-DD。'),
                page: z.number().int().positive().optional().describe('可选。分页页码。'),
                limit: z.number().int().positive().optional().describe('可选。返回条数。'),
            },
            handler: async (args) => withToolExecution(() => client.getHistory({
                lotteryType: typeof args.lotteryType === 'string' ? args.lotteryType : undefined,
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
                lotteryType: z.string().optional().describe('可选。当前版本仅支持 pl3，省略时默认 pl3。'),
                page: z.number().int().positive().optional().describe('可选。分页页码。'),
                limit: z.number().int().positive().optional().describe('可选。返回条数。'),
            },
            handler: async (args) => withToolExecution(() => client.getPeriods({
                lotteryType: typeof args.lotteryType === 'string' ? args.lotteryType : undefined,
                page: typeof args.page === 'number' ? args.page : undefined,
                limit: typeof args.limit === 'number' ? args.limit : fallbackLimit,
            })),
        },
        {
            name: 'lottery.summary',
            description: '查看排列3数据摘要。',
            inputSchema: {
                lotteryType: z.string().optional().describe('可选。当前版本仅支持 pl3，省略时默认 pl3。'),
            },
            handler: async (args) => withToolExecution(() => client.getSummary({
                lotteryType: typeof args.lotteryType === 'string' ? args.lotteryType : undefined,
            })),
        },
        {
            name: 'lottery.predict',
            description: '基于排列3历史数据生成确定性候选排序和无未来数据泄漏的 walk-forward 回测。评分不是中奖概率。',
            inputSchema: {
                lotteryType: z.string().optional().describe('可选。当前版本仅支持 pl3，省略时默认 pl3。'),
                periods: z.number().int().min(100).max(1000).optional().describe('可选。读取历史期数，默认 200。'),
                tickets: z.number().int().min(1).max(100).optional().describe('可选。候选注数，默认 10。'),
                playType: z.enum(['direct', 'group3', 'group6', 'mixed']).optional().describe('可选。玩法，默认 mixed。'),
            },
            handler: async (args) => withToolExecution(() => predictionService.predict({
                lotteryType: typeof args.lotteryType === 'string' ? args.lotteryType : undefined,
                periods: typeof args.periods === 'number' ? args.periods : undefined,
                tickets: typeof args.tickets === 'number' ? args.tickets : undefined,
                playType: typeof args.playType === 'string' ? args.playType : undefined,
            })),
        },
    ];
};
export const createLotteryMcpServer = (options) => {
    const client = createLotteryMcpClient(options);
    const server = new McpServer({
        name: 'neuxsbot-lottery-mcp',
        version: '0.2.0',
    });
    const toolCatalog = createLotteryToolCatalog(client, {
        defaultPeriods: options.defaultPeriods,
        dataDir: options.dataDir,
        predictionPayouts: options.predictionPayouts,
    });
    toolCatalog.forEach((tool) => {
        server.registerTool(tool.name, {
            description: tool.description,
            inputSchema: tool.inputSchema,
        }, async (args) => tool.handler(args));
    });
    return {
        client,
        server,
        toolCatalog,
    };
};
export const startLotteryMcpStdioServer = async (options) => {
    const { client, server, toolCatalog } = createLotteryMcpServer(options);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    return {
        client,
        server,
        toolCatalog,
        transport,
    };
};
/** @deprecated Use startLotteryMcpStdioServer instead. */
export const startNbcpStdioServer = startLotteryMcpStdioServer;
