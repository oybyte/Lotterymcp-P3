import { type Pl3PayoutConfig, type Pl3PredictionQuery, type Pl3PredictionResult, type Pl3LotteryType, type Pl3Record } from './pl3-prediction.js';
export * from './pl3-prediction.js';
export * from './pl3-store.js';
export * from './pl3-features.js';
export * from './pl3-experiments.js';
/** @deprecated Provider selection is dynamic. Read meta.provider instead. */
export declare const LOTTERY_MCP_PROVIDER = "remote";
export declare const PL3_DATA_TOOLS: readonly ["lottery.latest", "lottery.history", "lottery.periods", "lottery.summary"];
export declare const PL3_MCP_TOOLS: readonly ["lottery.latest", "lottery.history", "lottery.periods", "lottery.summary", "lottery.predict"];
/** @deprecated Use PL3_DATA_TOOLS instead. */
export declare const LOTTERY_MCP_TOOLS: readonly ["lottery.latest", "lottery.history", "lottery.periods", "lottery.summary"];
export type Pl3McpToolName = (typeof PL3_MCP_TOOLS)[number];
export type Pl3DataToolName = (typeof PL3_DATA_TOOLS)[number];
/** @deprecated Use Pl3McpToolName instead. */
export type LotteryMcpToolName = Pl3McpToolName;
export type McpPlan = 'public' | 'member';
export type Pl3DataMode = 'remote' | 'official';
/** @deprecated Use Pl3DataMode instead. */
export type LotteryDataMode = Pl3DataMode;
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
    tools?: Pl3DataToolName[];
};
export type Pl3LatestQuery = {
    lotteryType?: Pl3LotteryType;
};
export type Pl3HistoryQuery = {
    lotteryType?: Pl3LotteryType;
    period?: string;
    fromDate?: string;
    toDate?: string;
    page?: number;
    limit?: number;
};
export type Pl3PeriodsQuery = {
    lotteryType?: Pl3LotteryType;
    page?: number;
    limit?: number;
};
export type Pl3SummaryQuery = {
    lotteryType?: Pl3LotteryType;
};
/** @deprecated Use Pl3LatestQuery instead. */
export type LotteryLatestQuery = Pl3LatestQuery;
/** @deprecated Use Pl3HistoryQuery instead. */
export type LotteryHistoryQuery = Pl3HistoryQuery;
/** @deprecated Use Pl3PeriodsQuery instead. */
export type LotteryPeriodsQuery = Pl3PeriodsQuery;
/** @deprecated Use Pl3SummaryQuery instead. */
export type LotterySummaryQuery = Pl3SummaryQuery;
export type LotteryMcpConfig = {
    apiBaseUrl?: string;
    token?: string;
    defaultPeriods: string;
    dataMode?: Pl3DataMode;
    dataDir?: string;
};
/** @deprecated Use LotteryMcpConfig instead. */
export type NbcpConfig = LotteryMcpConfig;
export type LotteryMcpClientConfig = {
    apiBaseUrl?: string;
    token?: string;
    defaultPeriods?: string;
    dataMode?: Pl3DataMode;
    dataDir?: string;
    fetchImpl?: typeof fetch;
};
export type LotteryMcpClient = {
    apiBaseUrl: string;
    token: string;
    defaultPeriods: string;
    getHealth(): Promise<McpHealthResponse>;
    getLatest(query: Pl3LatestQuery): Promise<McpEnvelope<Pl3DrawRecord | null>>;
    getHistory(query: Pl3HistoryQuery): Promise<McpEnvelope<Pl3DrawRecord[]>>;
    getPeriods(query: Pl3PeriodsQuery): Promise<McpEnvelope<Pl3PeriodRecord[]>>;
    getSummary(query: Pl3SummaryQuery): Promise<McpEnvelope<Pl3Summary | null>>;
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
        provisional: number;
        confirmed: number;
        disputed: number;
    }>;
};
export type Pl3DrawRecord = Pl3Record & {
    source?: string;
    sourceUrl?: string;
    rawProvider?: string;
    status?: 'confirmed' | 'single_source';
};
export type Pl3PeriodRecord = Pick<Pl3DrawRecord, 'lotteryType' | 'period' | 'drawDate'>;
export type Pl3Summary = {
    lotteryType: Pl3LotteryType;
    total: number;
    latestPeriod: string | null;
    latestDrawDate: string | null;
    dataDir?: string;
};
/** @deprecated Use Pl3DrawRecord instead. */
export type OfficialLotteryRecord = Pl3DrawRecord;
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
/** @deprecated Use PL3_LOTTERY_TYPE instead. */
export declare const SUPPORTED_LOTTERY_TYPE: "pl3";
export declare const normalizeApiBaseUrl: (value: unknown) => string;
export declare const normalizeLotteryType: (value?: unknown) => "pl3";
export declare const createOfficialLocalProvider: (config?: Pick<LotteryMcpClientConfig, "dataDir" | "defaultPeriods">) => LotteryDataProvider;
export declare const formatMcpApiError: (error: unknown) => string;
export declare const createLotteryMcpClient: (config: LotteryMcpClientConfig) => LotteryMcpClient;
export declare const createPl3PredictionService: (client: Pick<LotteryMcpClient, "getHistory">, config?: Pl3PredictionServiceConfig) => Pl3PredictionService;
/** @deprecated Use createLotteryMcpClient instead. */
export declare const createLotteryApiClient: (config: LotteryMcpClientConfig) => LotteryMcpClient;
