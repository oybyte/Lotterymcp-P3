import http from 'node:http';
import { type LotteryMcpConfig, type Pl3PlayType, type Pl3PredictionResult } from 'lotterymcp-core';
import { type SyncOfficialPl3StoreResult } from './official-sync.js';
export type Pl3DataBundleManifest = {
    version: 1;
    createdAt: string;
    dataDir: string;
    database: {
        file: 'pl3.sqlite';
        sha256: string;
        bytes: number;
    };
    ledger?: {
        file: 'pl3-predictions.json';
        sha256: string;
        bytes: number;
    };
};
export declare const createPl3DataBundle: (input: {
    dataDir: string;
    outputDir: string;
}) => Promise<{
    outputDir: string;
    manifest: Pl3DataBundleManifest;
    sourceBackupPath: string;
}>;
export declare const verifyPl3DataBundle: (bundleDir: string) => Promise<{
    bundleDir: string;
    manifest: Pl3DataBundleManifest;
    valid: boolean;
    checks: {
        file: string;
        expectedSha256: string;
        actualSha256: string;
        expectedBytes: number;
        actualBytes: number;
        valid: boolean;
    }[];
}>;
export declare const restorePl3DataBundle: (input: {
    dataDir: string;
    bundleDir: string;
}) => Promise<{
    ledgerRestoredPath: string | null;
    verification: {
        bundleDir: string;
        manifest: Pl3DataBundleManifest;
        valid: boolean;
        checks: {
            file: string;
            expectedSha256: string;
            actualSha256: string;
            expectedBytes: number;
            actualBytes: number;
            valid: boolean;
        }[];
    };
    databasePath: string;
    replacedPath: string | null;
    safetyBackupPath: string | null;
}>;
export type Pl3DailyReportSummary = {
    runId: string;
    day: string;
    generatedAt: string;
    predictionId: string;
    afterPeriod: string;
    reportPath: string;
    markdownPath: string;
    reportHash: string;
    snapshotSettlement: Pl3PredictionResult['settlement'];
};
export type Pl3DailyReportIndex = {
    version: 1;
    updatedAt: string;
    reports: Pl3DailyReportSummary[];
};
export declare const writePl3DailyReport: (input: {
    dataDir: string;
    runId: string;
    prediction: Pl3PredictionResult;
    sync?: SyncOfficialPl3StoreResult;
}) => Promise<{
    reportDir: string;
    reportPath: string;
    markdownPath: string;
    htmlPath: string;
    reportHash: string;
    summary: Pl3DailyReportSummary;
}>;
type WebAccessMode = 'tunnel' | 'public';
export declare const createWebAuthConfig: (input: {
    dataDir: string;
    password: string;
    secretPath?: string;
}) => Promise<{
    secretPath: string;
    totpSecret: string;
    recoveryCodes: string[];
}>;
export declare const runPl3DailyOnce: (input: {
    config: LotteryMcpConfig;
    periods?: number;
    tickets?: number;
    playType?: Pl3PlayType;
    trainingStatus?: "confirmed" | "mixed";
    sync?: boolean;
    migrate?: boolean;
    notify?: boolean;
}) => Promise<{
    runId: string;
    prediction: Pl3PredictionResult;
    report: {
        reportDir: string;
        reportPath: string;
        markdownPath: string;
        htmlPath: string;
        reportHash: string;
        summary: Pl3DailyReportSummary;
    };
    sync: SyncOfficialPl3StoreResult | undefined;
    notification: {
        skipped: boolean;
        channel: "enterprise-wechat";
    } | {
        skipped: boolean;
    };
}>;
export declare const servePl3Reports: (input: {
    dataDir: string;
    host?: string;
    port?: number;
    accessMode?: WebAccessMode;
}) => Promise<{
    server: http.Server<typeof http.IncomingMessage, typeof http.ServerResponse>;
    url: string;
    reportsDir: string;
    assetsDir: string;
    accessMode: WebAccessMode;
}>;
export declare const listReportDays: (dataDir: string) => Promise<string[]>;
export declare const getPl3DatabasePathForOps: (dataDir: string) => string;
export {};
