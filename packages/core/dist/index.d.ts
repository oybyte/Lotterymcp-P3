import { type Pl3PayoutConfig, type Pl3PredictionQuery, type Pl3PredictionResult } from './pl3-prediction.js';
export * from './pl3-prediction.js';
export declare const LOTTERY_MCP_PROVIDER = "remote";
export declare const LOTTERY_MCP_TOOLS: readonly ["lottery.latest", "lottery.history", "lottery.periods", "lottery.summary"];
export type LotteryMcpToolName = (typeof LOTTERY_MCP_TOOLS)[number];
export type McpPlan = 'public' | 'member';
export type LotteryDataMode = 'remote' | 'official';
export type McpMeta = {
    plan: McpPlan;
    provider?: 'remote' | 'official';
    apiKeyUsed?: boolean;
    requestLimit: number | null;
    generatedAt: string;
    memberGroupId?: number | null;
    memberGroupName?: string | null;
    page?: number;
    limit?: number;
    total?: number;
    hasMore?: boolean;
};
export type McpEnvelope<T> = {
    data: T;
    meta: McpMeta;
};
export type McpHealthResponse = {
    ok: boolean;
    service: string;
    transport?: string;
    provider?: 'remote' | 'official';
    dataDir?: string;
    auth?: {
        header?: string;
    };
    tools?: string[];
};
export type LotteryLatestQuery = {
    lotteryType?: string;
};
export type LotteryHistoryQuery = {
    lotteryType?: string;
    period?: string;
    fromDate?: string;
    toDate?: string;
    page?: number;
    limit?: number;
};
export type LotteryPeriodsQuery = {
    lotteryType?: string;
    page?: number;
    limit?: number;
};
export type LotterySummaryQuery = {
    lotteryType?: string;
};
export type LotteryMcpConfig = {
    apiBaseUrl: string;
    token: string;
    defaultPeriods: string;
    dataMode?: LotteryDataMode;
    dataDir?: string;
};
/** @deprecated Use LotteryMcpConfig instead. */
export type NbcpConfig = LotteryMcpConfig;
export type LotteryMcpClientConfig = {
    apiBaseUrl: string;
    token?: string;
    defaultPeriods?: string;
    dataMode?: LotteryDataMode;
    dataDir?: string;
    fetchImpl?: typeof fetch;
};
export type LotteryMcpClient = {
    apiBaseUrl: string;
    token: string;
    defaultPeriods: string;
    getHealth(): Promise<McpHealthResponse>;
    getLatest(query: LotteryLatestQuery): Promise<McpEnvelope<unknown>>;
    getHistory(query: LotteryHistoryQuery): Promise<McpEnvelope<unknown>>;
    getPeriods(query: LotteryPeriodsQuery): Promise<McpEnvelope<unknown>>;
    getSummary(query: LotterySummaryQuery): Promise<McpEnvelope<unknown>>;
};
export type LotteryDataProvider = Pick<LotteryMcpClient, 'getHealth' | 'getLatest' | 'getHistory' | 'getPeriods' | 'getSummary'>;
export type Pl3PredictionServiceConfig = {
    dataDir?: string;
    defaultPeriods?: string | number;
    payouts?: Partial<Pl3PayoutConfig>;
};
export type Pl3PredictionService = {
    ledgerPath: string;
    predict(query?: Pl3PredictionQuery): Promise<McpEnvelope<Pl3PredictionResult>>;
    settle(): Promise<{
        settledCount: number;
    }>;
    getLedgerSummary(): Promise<{
        total: number;
        pending: number;
        settled: number;
    }>;
};
export type OfficialLotteryRecord = {
    lotteryType: string;
    period: string;
    drawDate: string;
    numbers: string;
    numbersList?: number[];
    source?: string;
    sourceUrl?: string;
    [key: string]: unknown;
};
export type McpAction = {
    type?: string;
    label?: string;
    url?: string;
};
export declare class McpApiError extends Error {
    readonly statusCode: number;
    readonly code?: string;
    readonly upgradeUrl?: string;
    readonly displayMode?: string;
    readonly action?: McpAction;
    readonly data?: unknown;
    constructor(input: {
        statusCode: number;
        message: string;
        code?: string;
        upgradeUrl?: string;
        displayMode?: string;
        action?: McpAction;
        data?: unknown;
    });
}
export declare const SUPPORTED_LOTTERY_TYPE = "pl3";
export declare const normalizeApiBaseUrl: (value: string) => string;
export declare const normalizeLotteryType: (value?: unknown) => string;
export declare const createOfficialLocalProvider: (config?: Pick<LotteryMcpClientConfig, "dataDir" | "defaultPeriods">) => LotteryDataProvider;
export declare const formatMcpApiError: (error: unknown) => string;
export declare const createLotteryMcpClient: (config: LotteryMcpClientConfig) => LotteryMcpClient;
export declare const createPl3PredictionService: (client: Pick<LotteryMcpClient, "getHistory">, config?: Pl3PredictionServiceConfig) => Pl3PredictionService;
/** @deprecated Use createLotteryMcpClient instead. */
export declare const createLotteryApiClient: (config: LotteryMcpClientConfig) => LotteryMcpClient;
