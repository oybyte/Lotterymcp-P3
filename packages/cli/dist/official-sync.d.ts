import { type OfficialLotteryRecord } from 'lotterymcp-core';
export type OfficialLotteryType = 'pl3';
export type SyncOfficialLotteryOptions = {
    lotteryType: OfficialLotteryType;
    limit: number;
    dataDir: string;
    fetchImpl?: typeof fetch;
};
export type SyncOfficialFileOptions = {
    filePath: string;
    limit: number;
    dataDir: string;
};
export type SyncOfficialLotteryResult = {
    lotteryType: OfficialLotteryType;
    records: OfficialLotteryRecord[];
    outputPath: string;
    sourceUrl: string;
    warnings: string[];
    settledCount: number;
};
export declare const OFFICIAL_LOTTERY_TYPES: readonly OfficialLotteryType[];
export declare const parseJsonOrJsonp: (rawText: string) => any;
export declare const fetchOfficialLotteryRecords: (lotteryType: OfficialLotteryType, limit: number, fetchImpl?: typeof fetch) => Promise<OfficialLotteryRecord[]>;
export declare const syncOfficialLottery: (options: SyncOfficialLotteryOptions) => Promise<SyncOfficialLotteryResult>;
export declare const syncOfficialFile: (options: SyncOfficialFileOptions) => Promise<SyncOfficialLotteryResult>;
export declare const isOfficialLotteryType: (value: string) => value is OfficialLotteryType;
