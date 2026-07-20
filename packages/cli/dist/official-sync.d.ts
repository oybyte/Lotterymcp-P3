import { type Pl3DrawRecord } from 'lotterymcp-core';
export type SyncOfficialPl3Options = {
    limit: number;
    dataDir: string;
    fetchImpl?: typeof fetch;
};
export type SyncOfficialFileOptions = {
    filePath: string;
    limit: number;
    dataDir: string;
};
export type SyncOfficialPl3Result = {
    lotteryType: 'pl3';
    records: Pl3DrawRecord[];
    outputPath: string;
    sourceUrl: string;
    warnings: string[];
    settledCount: number;
};
export type OfficialRawResponse = {
    provider: 'lottery-gov-cn' | 'zhcw';
    page: number;
    url: string;
    statusCode: number;
    statusText: string;
    fetchedAt: string;
    contentType: string | null;
    rawText: string;
};
export type OfficialSyncProvider = 'auto' | 'lottery-gov-cn' | 'zhcw';
export type FetchOfficialPl3ArchiveResult = {
    records: Pl3DrawRecord[];
    provider: 'lottery-gov-cn' | 'zhcw';
    sourceUrl: string;
    authoritativeTotal: number | null;
    rawResponses: OfficialRawResponse[];
    warnings: string[];
};
export type SyncOfficialPl3StoreOptions = SyncOfficialPl3Options & {
    full?: boolean;
    provider?: OfficialSyncProvider;
    resume?: boolean;
    restart?: boolean;
};
export type SyncOfficialPl3StoreResult = SyncOfficialPl3Result & {
    databasePath: string;
    provider: 'lottery-gov-cn' | 'zhcw';
    authoritativeTotal: number | null;
    rawResponseCount: number;
    rawManifestPath: string;
    confirmedRecords: number;
    singleSourceRecords: number;
    conflictRecords: number;
    checkpointPath: string;
    resumedPageCount: number;
};
export declare const parseJsonOrJsonp: (rawText: string) => any;
export declare const fetchOfficialPl3Archive: (limit: number, fetchImpl?: typeof fetch, provider?: OfficialSyncProvider) => Promise<FetchOfficialPl3ArchiveResult>;
export declare const fetchOfficialPl3Records: (limit: number, fetchImpl?: typeof fetch) => Promise<Pl3DrawRecord[]>;
export declare const syncOfficialPl3ToStore: (options: SyncOfficialPl3StoreOptions) => Promise<SyncOfficialPl3StoreResult>;
export declare const syncOfficialPl3: (options: SyncOfficialPl3Options) => Promise<SyncOfficialPl3Result>;
export declare const syncOfficialFile: (options: SyncOfficialFileOptions) => Promise<SyncOfficialPl3Result>;
