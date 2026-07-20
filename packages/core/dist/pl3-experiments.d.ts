import { PL3_FEATURE_VERSION } from './pl3-features.js';
import { PL3_MODEL_VERSION } from './pl3-prediction.js';
import type { Pl3ExperimentFoldStorageRecord, Pl3ExperimentStatus, Pl3ExperimentStorageRecord, Pl3Store } from './pl3-store.js';
export declare const PL3_EXPERIMENT_SPEC_VERSION = 1;
export type Pl3BaselineModelId = 'uniform-theory' | 'random-monte-carlo' | typeof PL3_MODEL_VERSION;
export type Pl3ExperimentMode = 'development' | 'confirmatory';
export type Pl3ExperimentSpecInput = {
    schemaVersion?: 1;
    name: string;
    hypothesis: string;
    mode?: Pl3ExperimentMode;
    researchBatchId?: string;
    datasetSnapshotId: string;
    featureVersion?: typeof PL3_FEATURE_VERSION;
    models?: Array<Pl3BaselineModelId | {
        modelId: Pl3BaselineModelId;
        params?: Record<string, unknown>;
        searchSpace?: Record<string, unknown[]>;
    }>;
    primaryMetric?: 'normalizedRank.mean';
    secondaryMetrics?: string[];
    exclusionRules?: string[];
    split?: Partial<Pl3ExperimentSplit>;
    bootstrap?: Partial<Pl3ExperimentBootstrap>;
    randomSeed?: number;
    resource?: Partial<Pl3ExperimentResource>;
};
export type Pl3ExperimentSplit = {
    minTrain: number;
    frozenCount: number;
    training: 'expanding';
    innerValidation: number;
    innerStep: number;
    outerTest: number;
    outerStep: number;
};
export type Pl3ExperimentBootstrap = {
    blockLength: number;
    resamples: number;
};
export type Pl3ExperimentResource = {
    maxRuntimeSeconds: number;
    maxCpuFraction: number;
};
export type Pl3ExperimentSpec = {
    schemaVersion: 1;
    name: string;
    hypothesis: string;
    mode: Pl3ExperimentMode;
    researchBatchId: string;
    datasetSnapshotId: string;
    featureVersion: typeof PL3_FEATURE_VERSION;
    models: Array<{
        modelId: Pl3BaselineModelId;
        params: Record<string, unknown>;
        searchSpace: Record<string, unknown[]>;
    }>;
    primaryMetric: 'normalizedRank.mean';
    secondaryMetrics: string[];
    exclusionRules: string[];
    split: Pl3ExperimentSplit;
    bootstrap: Pl3ExperimentBootstrap;
    randomSeed: number;
    resource: Pl3ExperimentResource;
};
export type Pl3RankedState = {
    number: string;
    score: number;
    rank: number;
};
export type Pl3EvaluationCase = {
    targetPeriod: string;
    afterPeriod: string;
    actualNumber: string;
    modelId: Pl3BaselineModelId;
    rank: number;
    normalizedRank: number;
    reciprocalRank: number;
    positionRanks: [number, number, number];
};
export type Pl3ModelMetrics = {
    modelId: Pl3BaselineModelId;
    sampleCount: number;
    normalizedRank: {
        mean: number;
        median: number;
    };
    meanReciprocalRank: number;
    coverage: {
        top10: number;
        top20: number;
        top50: number;
        top100: number;
    };
    positionAccuracy: Array<{
        top1: number;
        top3: number;
        top5: number;
    }>;
};
export type Pl3FoldResult = {
    schemaVersion: 1;
    experimentId: string;
    foldLevel: 'outer' | 'frozen';
    foldIndex: number;
    trainRange: {
        fromPeriod: string;
        toPeriod: string;
        count: number;
    };
    testRange: {
        fromPeriod: string;
        toPeriod: string;
        count: number;
    };
    featureSnapshotIds: string[];
    selectedParams: Record<string, Record<string, unknown>>;
    modelMetrics: Pl3ModelMetrics[];
    bootstrap: Record<string, Pl3BootstrapSummary>;
    cases: Pl3EvaluationCase[];
};
export type Pl3BootstrapSummary = {
    samples: number;
    blockLength: number;
    mean: number;
    standardDeviation: number;
    quantiles: {
        p025: number;
        p50: number;
        p975: number;
    };
};
export declare const normalizePl3ExperimentSpec: (input: Pl3ExperimentSpecInput) => Pl3ExperimentSpec;
export declare const createPl3Experiment: (store: Pl3Store, input: Pl3ExperimentSpecInput, codeCommit: string) => {
    experiment: Pl3ExperimentStorageRecord;
    spec: Pl3ExperimentSpec;
};
export declare const generatePl3ExperimentReport: (store: Pl3Store, experimentId: string) => Promise<{
    report: {
        schemaVersion: number;
        experimentId: string;
        name: string;
        status: Pl3ExperimentStatus;
        mode: "development" | "confirmatory";
        datasetSnapshotId: string;
        specHash: string;
        codeCommit: string;
        primaryMetric: "normalizedRank.mean";
        frozenVisible: boolean;
        completedFoldCount: number;
        summary: {
            [k: string]: Pl3ModelMetrics[];
        };
    };
    reportHash: string;
    reportPath: string;
    markdownPath: string;
}>;
export declare const runPl3Experiment: (store: Pl3Store, experimentId: string) => Promise<{
    report: {
        schemaVersion: number;
        experimentId: string;
        name: string;
        status: Pl3ExperimentStatus;
        mode: "development" | "confirmatory";
        datasetSnapshotId: string;
        specHash: string;
        codeCommit: string;
        primaryMetric: "normalizedRank.mean";
        frozenVisible: boolean;
        completedFoldCount: number;
        summary: {
            [k: string]: Pl3ModelMetrics[];
        };
    };
    reportHash: string;
    reportPath: string;
    markdownPath: string;
}>;
export declare const evaluatePl3ExperimentFrozen: (store: Pl3Store, experimentId: string) => Promise<{
    report: {
        schemaVersion: number;
        experimentId: string;
        name: string;
        status: Pl3ExperimentStatus;
        mode: "development" | "confirmatory";
        datasetSnapshotId: string;
        specHash: string;
        codeCommit: string;
        primaryMetric: "normalizedRank.mean";
        frozenVisible: boolean;
        completedFoldCount: number;
        summary: {
            [k: string]: Pl3ModelMetrics[];
        };
    };
    reportHash: string;
    reportPath: string;
    markdownPath: string;
}>;
export declare const inspectPl3Experiment: (store: Pl3Store, experimentId: string) => {
    experiment: Pl3ExperimentStorageRecord;
    spec: Pl3ExperimentSpec;
    folds: Pl3ExperimentFoldStorageRecord[];
    audit: unknown[];
};
