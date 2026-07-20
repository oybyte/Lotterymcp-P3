export type Pl3FileFormat = 'json' | 'csv';
export declare const importPl3FileToStore: (input: {
    dataDir: string;
    filePath: string;
    format?: string;
}) => Promise<{
    inputCount: number;
    insertedObservations: number;
    repeatedObservations: number;
    affectedPeriods: number;
    confirmedRecords: number;
    singleSourceRecords: number;
    conflictRecords: number;
    snapshotId: string;
    filePath: string;
    format: Pl3FileFormat;
    rawPath: string;
    databasePath: string;
}>;
export declare const exportPl3Store: (input: {
    dataDir: string;
    outputPath: string;
    format?: string;
}) => Promise<{
    databasePath: string;
    outputPath: string;
    format: Pl3FileFormat;
    recordCount: number;
}>;
