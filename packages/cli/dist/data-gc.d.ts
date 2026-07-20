type GcCandidate = {
    relativePath: string;
    size: number;
    mtimeMs: number;
};
type GcPlan = {
    schemaVersion: 1;
    createdAt: string;
    dataDir: string;
    rawDir: string;
    candidates: GcCandidate[];
    totalBytes: number;
    planHash: string;
};
export declare const createPl3RawGcPlan: (dataDir: string) => Promise<GcPlan>;
export declare const applyPl3RawGcPlan: (dataDir: string) => Promise<{
    deletedFiles: number;
    deletedBytes: number;
    paths: string[];
}>;
export {};
