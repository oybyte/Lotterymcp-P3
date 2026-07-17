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
export declare const parseJsonOrJsonp: (rawText: string) => any;
export declare const fetchOfficialPl3Records: (limit: number, fetchImpl?: typeof fetch) => Promise<Pl3DrawRecord[]>;
export declare const syncOfficialPl3: (options: SyncOfficialPl3Options) => Promise<SyncOfficialPl3Result>;
export declare const syncOfficialFile: (options: SyncOfficialFileOptions) => Promise<SyncOfficialPl3Result>;
