import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { type Pl3PayoutConfig, type Pl3McpToolName, type LotteryMcpClient, type LotteryMcpClientConfig } from 'lotterymcp-core';
import { z } from 'zod';
export declare const MCP_SERVER_TRANSPORT = "stdio";
export declare const MCP_SERVER_TOOLS: readonly ["lottery.latest", "lottery.history", "lottery.periods", "lottery.summary", "lottery.predict"];
export type LotteryMcpServerOptions = LotteryMcpClientConfig & {
    predictionPayouts?: Partial<Pl3PayoutConfig>;
};
type LotteryMcpClientLike = Pick<LotteryMcpClient, 'getLatest' | 'getHistory' | 'getPeriods' | 'getSummary'>;
export type LotteryToolDefinition = {
    name: Pl3McpToolName;
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
    client: LotteryMcpClient;
    server: McpServer;
    toolCatalog: LotteryToolDefinition[];
};
export declare const startLotteryMcpStdioServer: (options: LotteryMcpServerOptions) => Promise<{
    client: LotteryMcpClient;
    server: McpServer;
    toolCatalog: LotteryToolDefinition[];
    transport: StdioServerTransport;
}>;
/** @deprecated Use startLotteryMcpStdioServer instead. */
export declare const startNbcpStdioServer: (options: LotteryMcpServerOptions) => Promise<{
    client: LotteryMcpClient;
    server: McpServer;
    toolCatalog: LotteryToolDefinition[];
    transport: StdioServerTransport;
}>;
export {};
