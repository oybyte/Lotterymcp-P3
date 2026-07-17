export type Pl3PlayType = 'direct' | 'group3' | 'group6' | 'mixed';
export type Pl3TicketPlayType = Exclude<Pl3PlayType, 'mixed'>;
export type Pl3SourceRecord = {
    lotteryType?: string;
    period?: string | number;
    drawDate?: string;
    numbers?: string;
    numbersList?: unknown[];
    numbers_list?: unknown[];
    [key: string]: unknown;
};
export type Pl3Record = {
    lotteryType: 'pl3';
    period: string;
    drawDate: string;
    numbers: string;
    numbersList: [number, number, number];
};
export type Pl3PayoutConfig = {
    stake: number;
    direct: number;
    group3: number;
    group6: number;
};
export type Pl3PredictionQuery = {
    lotteryType?: string;
    periods?: number;
    tickets?: number;
    playType?: Pl3PlayType;
    generatedAt?: string;
    payouts?: Partial<Pl3PayoutConfig>;
};
export type Pl3Ticket = {
    rank: number;
    playType: Pl3TicketPlayType;
    numbers: [number, number, number];
    display: string;
    score: number;
    pairDigit?: number;
    singleDigit?: number;
};
export type Pl3BacktestPlayMetrics = {
    ticketsPerDraw: number;
    winningTickets: number;
    winningDraws: number;
    hitRate: number;
    returnAmount: number;
};
export type Pl3BacktestCase = {
    targetPeriod: string;
    afterPeriod: string;
    ticketSignature: string;
    winningTickets: number;
    returnAmount: number;
};
export type Pl3BacktestResult = {
    status: 'complete' | 'insufficient_data';
    minimumTrainingRecords: number;
    testCount: number;
    totalCost: number;
    totalReturn: number;
    profit: number;
    roi: number | null;
    positionTwoDigitDraws: number;
    unorderedTwoDigitDraws: number;
    plays: Record<Pl3TicketPlayType, Pl3BacktestPlayMetrics>;
    baseline: {
        perTicketHitProbability: Record<Pl3TicketPlayType, number>;
        expectedWinningTickets: number;
        expectedReturn: number;
        expectedRoi: number | null;
    };
    cases: Pl3BacktestCase[];
};
export type Pl3Settlement = {
    status: 'pending' | 'settled';
    targetPeriod?: string;
    drawDate?: string;
    actualNumbers?: [number, number, number];
    winningTickets?: number;
    returnAmount?: number;
    profit?: number;
    settledAt?: string;
};
export type Pl3PredictionResult = {
    predictionId: string;
    lotteryType: 'pl3';
    generatedAt: string;
    afterPeriod: string;
    target: 'next-draw';
    training: {
        recordCount: number;
        fromPeriod: string;
        toPeriod: string;
        trainingDataHash: string;
    };
    model: {
        name: 'weighted-frequency';
        version: string;
        scoreIsProbability: false;
        weights: typeof PL3_MODEL_WEIGHTS;
    };
    query: {
        periods: number;
        tickets: number;
        playType: Pl3PlayType;
    };
    payouts: Pl3PayoutConfig & {
        note: string;
    };
    tickets: Pl3Ticket[];
    backtest: Pl3BacktestResult;
    settlement: Pl3Settlement;
};
export type Pl3PredictionLedger = {
    version: 1;
    predictions: Pl3PredictionResult[];
};
export declare class Pl3PredictionError extends Error {
    readonly code: string;
    readonly details?: unknown;
    constructor(code: string, message: string, details?: unknown);
}
export declare const PL3_MODEL_VERSION = "weighted-frequency-v1";
export declare const PL3_MIN_RECORDS = 100;
export declare const PL3_DEFAULT_PERIODS = 200;
export declare const PL3_MAX_PERIODS = 1000;
export declare const PL3_DEFAULT_TICKETS = 10;
export declare const PL3_MAX_TICKETS = 100;
export declare const PL3_MODEL_WEIGHTS: {
    readonly positionFrequency: 0.3;
    readonly digitFrequency: 0.2;
    readonly sumFrequency: 0.2;
    readonly oddEvenFrequency: 0.15;
    readonly spanFrequency: 0.1;
    readonly numberTypeFrequency: 0.05;
};
export declare const PL3_DEFAULT_PAYOUTS: Pl3PayoutConfig;
export declare const normalizePl3Records: (records: readonly Pl3SourceRecord[]) => Pl3Record[];
export declare const scorePl3TicketPools: (sourceRecords: readonly Pl3SourceRecord[]) => {
    direct: Pl3Ticket[];
    group3: Pl3Ticket[];
    group6: Pl3Ticket[];
};
export declare const backtestPl3: (sourceRecords: readonly Pl3SourceRecord[], options?: Pick<Pl3PredictionQuery, "tickets" | "playType" | "payouts">) => Pl3BacktestResult;
export declare const predictPl3: (sourceRecords: readonly Pl3SourceRecord[], query?: Pl3PredictionQuery) => Pl3PredictionResult;
export declare const writeJsonAtomically: (targetPath: string, payload: unknown) => Promise<void>;
export declare const upsertPl3Prediction: (ledgerPath: string, prediction: Pl3PredictionResult) => Promise<Pl3PredictionResult>;
export declare const settlePl3Predictions: (ledgerPath: string, sourceRecords: readonly Pl3SourceRecord[]) => Promise<{
    settledCount: number;
    ledger: Pl3PredictionLedger;
}>;
export declare const getPl3PredictionLedgerSummary: (ledgerPath: string) => Promise<{
    total: number;
    pending: number;
    settled: number;
}>;
