import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { type Pl3PayoutConfig, type LotteryMcpClientConfig } from 'lotterymcp-core';
import { z } from 'zod';
export declare const MCP_SERVER_TRANSPORT = "stdio";
export declare const MCP_SERVER_TOOLS: string[];
export type LotteryMcpServerOptions = LotteryMcpClientConfig & {
    predictionPayouts?: Partial<Pl3PayoutConfig>;
};
type LotteryMcpClientLike = {
    getLatest: (input: {
        lotteryType?: string;
    }) => Promise<any>;
    getHistory: (input: {
        lotteryType?: string;
        period?: string;
        fromDate?: string;
        toDate?: string;
        page?: number;
        limit?: number;
    }) => Promise<any>;
    getPeriods: (input: {
        lotteryType?: string;
        page?: number;
        limit?: number;
    }) => Promise<any>;
    getSummary: (input: {
        lotteryType?: string;
    }) => Promise<any>;
};
export type LotteryToolDefinition = {
    name: string;
    description: string;
    inputSchema: Record<string, z.ZodTypeAny>;
    handler: (args: Record<string, unknown>) => Promise<CallToolResult>;
};
export declare const createLotteryToolCatalog: (client: LotteryMcpClientLike, options?: {
    defaultPeriods?: number | string;
    dataDir?: string;
    predictionPayouts?: Partial<Pl3PayoutConfig>;
}) => LotteryToolDefinition[];
export declare const createLotteryMcpServer: (options: LotteryMcpServerOptions) => {
    client: import("lotterymcp-core").LotteryMcpClient;
    server: McpServer;
    toolCatalog: LotteryToolDefinition[];
};
export declare const startLotteryMcpStdioServer: (options: LotteryMcpServerOptions) => Promise<{
    client: import("lotterymcp-core").LotteryMcpClient;
    server: McpServer;
    toolCatalog: LotteryToolDefinition[];
    transport: StdioServerTransport;
}>;
export declare const startNbcpStdioServer: (options: LotteryMcpServerOptions) => Promise<{
    client: import("lotterymcp-core").LotteryMcpClient;
    server: McpServer;
    toolCatalog: LotteryToolDefinition[];
    transport: StdioServerTransport;
}>;
export {};
