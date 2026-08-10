import { type Pl3Record, type Pl3SourceRecord } from './pl3-prediction.js';
export declare const PL3_DATABASE_FILENAME = "pl3.sqlite";
export declare const PL3_DATABASE_SCHEMA_VERSION = 1;
export declare const PL3_DATABASE_LATEST_SCHEMA_VERSION = 3;
export type Pl3DrawStatus = 'confirmed' | 'single_source' | 'conflict';
export type Pl3ConflictType = 'date' | 'numbers' | 'both';
export type Pl3OfficialProvider = 'lottery-gov-cn' | 'zhcw';
export type Pl3ObservationProvider = Pl3OfficialProvider | 'neuxsbot-remote' | 'file-import' | 'legacy-json' | string;
export type Pl3StoredDrawRecord = Pl3Record & {
    status: Exclude<Pl3DrawStatus, 'conflict'>;
    observationId: number;
    provider: string;
    sourceUrl?: string;
    observedAt: string;
};
export type Pl3StoreStatus = {
    databasePath: string;
    schemaVersion: number;
    totalPeriods: number;
    usableRecords: number;
    confirmedRecords: number;
    singleSourceRecords: number;
    conflictRecords: number;
    latestPeriod: string | null;
    latestDrawDate: string | null;
    authoritativeTotal: number | null;
    authoritativeCompleteness: number | null;
    reconciliationCoverage: number | null;
    dualSourceCoverage: number | null;
    completenessStatus: 'known' | 'unknown';
    legacyPredictionCount: number;
};
export type Pl3YearConfidence = {
    year: string;
    totalPeriods: number;
    confirmedRecords: number;
    singleSourceRecords: number;
    conflictRecords: number;
    dualSourceCoverage: number | null;
};
export type Pl3ImportOptions = {
    provider: Pl3ObservationProvider;
    sourceUrl?: string;
    observedAt?: string;
    fetchedAt?: string;
    statusCode?: number;
    rawPath?: string;
    rawContentHash?: string;
    parseStatus?: 'parsed' | 'failed';
    authoritativeTotal?: number;
    metadata?: Record<string, unknown>;
};
export type Pl3ImportResult = {
    inputCount: number;
    insertedObservations: number;
    repeatedObservations: number;
    affectedPeriods: number;
    confirmedRecords: number;
    singleSourceRecords: number;
    conflictRecords: number;
    snapshotId: string;
};
export type Pl3ArchivePageInput = {
    provider: Pl3ObservationProvider;
    page: number;
    sourceUrl: string;
    fetchedAt: string;
    statusCode: number;
    contentHash: string;
    rawPath: string;
    parseStatus: 'parsed' | 'failed';
    records: readonly Pl3SourceRecord[];
    metadata?: Record<string, unknown>;
};
export type Pl3ArchiveImportResult = Omit<Pl3ImportResult, 'snapshotId'> & {
    sourceSnapshotCount: number;
    sourceSnapshotIds: string[];
};
export type Pl3ReconcileHistoryResult = {
    scannedPeriods: number;
    upgradedToConfirmed: number;
    remainingSingleSource: number;
    remainingConflicts: number;
};
export type Pl3StoreQuery = {
    period?: string;
    fromDate?: string;
    toDate?: string;
    page?: number;
    limit?: number;
};
export type Pl3DatasetSnapshot = {
    snapshotId: string;
    fromPeriod: string;
    afterPeriod: string;
    recordCount: number;
    dataHash: string;
    codeCommit: string | null;
    createdAt: string;
    quality: 'confirmed' | 'allow-single-source';
    confirmedCount: number;
    singleSourceCount: number;
};
export type Pl3DatasetSnapshotVerification = {
    snapshotId: string;
    valid: boolean;
    expectedRecordCount: number;
    actualRecordCount: number;
    expectedDataHash: string;
    actualDataHash: string;
};
export type Pl3FeatureSnapshotStorageRecord = {
    featureSnapshotId: string;
    datasetSnapshotId: string;
    afterPeriod: string;
    featureVersion: string;
    windowsJson: string;
    windowConfigHash: string;
    payloadGzip: Buffer;
    payloadHash: string;
    codeCommit: string | null;
    createdAt: string;
};
export type Pl3ExperimentStatus = 'registered' | 'running' | 'development_complete' | 'frozen_evaluated' | 'interrupted' | 'failed';
export type Pl3ExperimentStorageRecord = {
    experimentId: string;
    schemaVersion: number;
    name: string;
    mode: 'development' | 'confirmatory';
    researchBatchId: string;
    datasetSnapshotId: string;
    featureVersion: string;
    specJson: string;
    specHash: string;
    codeCommit: string;
    randomSeed: number;
    status: Pl3ExperimentStatus;
    reportPath: string | null;
    reportHash: string | null;
    errorMessage: string | null;
    createdAt: string;
    updatedAt: string;
};
export type Pl3ExperimentFoldStorageRecord = {
    experimentId: string;
    foldLevel: 'inner' | 'outer' | 'frozen';
    foldIndex: number;
    trainFromPeriod: string;
    trainToPeriod: string;
    testFromPeriod: string;
    testToPeriod: string;
    status: 'pending' | 'running' | 'complete' | 'failed';
    selectedParamsJson: string | null;
    metricsJson: string | null;
    resultPath: string | null;
    resultHash: string | null;
    startedAt: string | null;
    completedAt: string | null;
};
export type Pl3LegacyMigrationPreview = {
    dataDir: string;
    databasePath: string;
    historyPath: string;
    ledgerPath: string;
    databaseExists: boolean;
    historyExists: boolean;
    ledgerExists: boolean;
    recordCount: number;
    latestPeriod: string | null;
    oldestPeriod: string | null;
    recordHash: string | null;
    predictionCount: number;
    predictionIds: string[];
};
export type Pl3LegacyMigrationResult = Pl3LegacyMigrationPreview & {
    applied: true;
    backupPaths: string[];
    importedObservations: number;
    importedPredictions: number;
};
export type Pl3SchemaMigrationPreview = {
    databasePath: string;
    currentVersion: number;
    targetVersion: number;
    migrationRequired: boolean;
    migrations: Array<{
        version: number;
        name: string;
        checksum: string;
    }>;
};
export type Pl3OperationalEventLevel = 'info' | 'warning' | 'error';
export type Pl3OperationalEvent = {
    eventId: number;
    level: Pl3OperationalEventLevel;
    eventType: string;
    message: string;
    details: Record<string, unknown>;
    createdAt: string;
};
export type Pl3OnlinePredictionRun = {
    runId: string;
    predictionId: string | null;
    status: 'running' | 'success' | 'failed';
    dataMode: string;
    afterPeriod: string | null;
    targetPeriod: string | null;
    reportPath: string | null;
    reportHash: string | null;
    errorMessage: string | null;
    startedAt: string;
    completedAt: string | null;
};
export type Pl3NotificationDelivery = {
    deliveryId: number;
    channel: string;
    dedupeKey: string;
    status: 'success' | 'failed';
    target: string | null;
    messageHash: string;
    errorMessage: string | null;
    deliveredAt: string;
};
type ExperimentAuditRow = {
    audit_id: number;
    action: string;
    status: string;
    details_json: string;
    created_at: string;
};
type RuntimeLockRow = {
    lock_name: string;
    owner_id: string;
    owner_pid: number;
    acquired_at: string;
    expires_at: string;
};
export declare class Pl3Store {
    readonly databasePath: string;
    private readonly database;
    constructor(databasePath: string, options?: {
        readonly?: boolean;
        fileMustExist?: boolean;
        maintenance?: boolean;
    });
    close(): void;
    getSchemaVersion(): number;
    private setMeta;
    private getMeta;
    private insertSourceSnapshot;
    private upsertObservation;
    private reconcilePeriod;
    importRecords(records: readonly Pl3SourceRecord[], options: Pl3ImportOptions): Pl3ImportResult;
    importArchivePages(pages: readonly Pl3ArchivePageInput[], options?: {
        authoritativeTotal?: number;
    }): Pl3ArchiveImportResult;
    reconcileHistory(): Pl3ReconcileHistoryResult;
    private getDrawStatus;
    recordArchivePages(pages: readonly Pl3ArchivePageInput[]): string[];
    resolveConflict(input: {
        period: string;
        observationId: number;
        reason: string;
        evidenceUrl?: string;
    }): Pl3StoredDrawRecord | null;
    getRecord(period: string): Pl3StoredDrawRecord | null;
    getRecords(query?: Pl3StoreQuery): Pl3StoredDrawRecord[];
    getRecordCount(query?: Omit<Pl3StoreQuery, 'page' | 'limit'>): number;
    getConflicts(query?: {
        fromPeriod?: string;
        toPeriod?: string;
        type?: Pl3ConflictType;
    }): {
        period: string;
        type: Pl3ConflictType;
        updatedAt: string;
        observations: {
            observationId: number;
            provider: string;
            drawDate: string;
            numbers: string;
            sourceUrl?: string | null;
            observedAt: string;
        }[];
    }[];
    getStatus(): Pl3StoreStatus;
    listReferencedRawPaths(): string[];
    getConfidenceByYear(): Pl3YearConfidence[];
    getDrawObservationEvidence(period: string): {
        period: string;
        firstObservedAt: string | null;
        lastObservedAt: string | null;
        sourceCount: number | null;
    } | null;
    getPredictionSlaEvidence(prediction: {
        afterPeriod: string;
        generatedAt: string;
    }): {
        targetPeriod: string | null;
        predictedAt: string;
        firstObservedAt: string | null;
        predictedBeforeFirstObservation: boolean | null;
    };
    createDatasetSnapshot(input?: {
        fromPeriod?: string;
        afterPeriod?: string;
        last?: number;
        allowSingleSource?: boolean;
        codeCommit?: string;
    }): Pl3DatasetSnapshot;
    listDatasetSnapshots(query?: {
        page?: number;
        limit?: number;
    }): Pl3DatasetSnapshot[];
    getDatasetSnapshot(snapshotId: string): Pl3DatasetSnapshot | null;
    private toDatasetSnapshot;
    getDatasetSnapshotRecords(snapshotId: string, afterPeriod?: string): Pl3StoredDrawRecord[];
    verifyDatasetSnapshot(snapshotId: string): Pl3DatasetSnapshotVerification;
    getFeatureSnapshot(featureSnapshotId: string): Pl3FeatureSnapshotStorageRecord | null;
    saveFeatureSnapshot(input: Pl3FeatureSnapshotStorageRecord): Pl3FeatureSnapshotStorageRecord;
    registerExperiment(input: Omit<Pl3ExperimentStorageRecord, 'status' | 'reportPath' | 'reportHash' | 'errorMessage' | 'createdAt' | 'updatedAt'>): Pl3ExperimentStorageRecord;
    private toExperiment;
    getExperiment(experimentId: string): Pl3ExperimentStorageRecord | null;
    listExperiments(query?: {
        page?: number;
        limit?: number;
        status?: Pl3ExperimentStatus;
    }): Pl3ExperimentStorageRecord[];
    updateExperimentStatus(experimentId: string, status: Pl3ExperimentStatus, input?: {
        expected?: readonly Pl3ExperimentStatus[];
        errorMessage?: string | null;
    }): Pl3ExperimentStorageRecord;
    saveExperimentFold(input: Pl3ExperimentFoldStorageRecord): void;
    listExperimentFolds(experimentId: string, foldLevel?: Pl3ExperimentFoldStorageRecord['foldLevel']): Pl3ExperimentFoldStorageRecord[];
    replaceExperimentMetrics(input: {
        experimentId: string;
        foldLevel: string;
        foldIndex: number;
        modelId: string;
        metrics: Array<{
            name: string;
            role: 'primary' | 'secondary' | 'exploratory';
            segment?: string;
            value: number;
            sampleCount: number;
        }>;
    }): void;
    getExperimentMetrics(experimentId: string): unknown[];
    acquireRuntimeLock(lockName: string, ownerId: string, leaseMs?: number): boolean;
    renewRuntimeLock(lockName: string, ownerId: string, leaseMs?: number): void;
    releaseRuntimeLock(lockName: string, ownerId: string): void;
    listRuntimeLocks(): RuntimeLockRow[];
    addExperimentAudit(experimentId: string, action: string, status: string, details?: unknown): void;
    listExperimentAudit(experimentId: string): ExperimentAuditRow[];
    setExperimentReport(experimentId: string, reportPath: string, reportHash: string): Pl3ExperimentStorageRecord;
    recordOnlinePredictionRun(input: {
        runId: string;
        predictionId?: string | null;
        status: 'running' | 'success' | 'failed';
        dataMode: string;
        afterPeriod?: string | null;
        targetPeriod?: string | null;
        reportPath?: string | null;
        reportHash?: string | null;
        errorMessage?: string | null;
        startedAt?: string;
        completedAt?: string | null;
    }): Pl3OnlinePredictionRun;
    getOnlinePredictionRun(runId: string): Pl3OnlinePredictionRun | null;
    listOnlinePredictionRuns(query?: {
        limit?: number;
    }): Pl3OnlinePredictionRun[];
    private toOnlinePredictionRun;
    recordOperationalEvent(input: {
        level: Pl3OperationalEventLevel;
        eventType: string;
        message: string;
        details?: Record<string, unknown>;
    }): number;
    listOperationalEvents(query?: {
        limit?: number;
    }): Pl3OperationalEvent[];
    recordNotificationDelivery(input: {
        channel: string;
        dedupeKey: string;
        status: 'success' | 'failed';
        target?: string | null;
        messageHash: string;
        errorMessage?: string | null;
    }): void;
    listNotificationDeliveries(query?: {
        limit?: number;
    }): Pl3NotificationDelivery[];
    importLegacyPredictions(predictions: readonly Record<string, unknown>[]): number;
}
export declare const resolvePl3DatabasePath: (dataDir?: string) => string;
export declare const hasPl3Database: (dataDir?: string) => boolean;
export declare const openPl3Store: (options?: {
    dataDir?: string;
    databasePath?: string;
    readonly?: boolean;
    fileMustExist?: boolean;
    maintenance?: boolean;
}) => Pl3Store;
export declare const previewLegacyPl3Migration: (dataDir?: string) => Promise<Pl3LegacyMigrationPreview>;
export declare const applyLegacyPl3Migration: (dataDir?: string) => Promise<Pl3LegacyMigrationResult>;
export declare const backupPl3Database: (dataDir?: string) => Promise<{
    databasePath: string;
    backupPath: string;
    removedBackups: string[];
}>;
export declare const previewPl3SchemaMigration: (dataDir?: string) => Pl3SchemaMigrationPreview;
export declare const applyPl3SchemaMigration: (dataDir?: string) => Promise<{
    currentVersion: number;
    migrationRequired: boolean;
    migrations: never[];
    applied: true;
    backupPath: string;
    replacedPath: string;
    databasePath: string;
    targetVersion: number;
} | {
    applied: false;
    backupPath: null;
    replacedPath: null;
    databasePath: string;
    currentVersion: number;
    targetVersion: number;
    migrationRequired: boolean;
    migrations: Array<{
        version: number;
        name: string;
        checksum: string;
    }>;
}>;
export declare const restorePl3Database: (dataDir: string, backupPath: string) => Promise<{
    databasePath: string;
    replacedPath: string | null;
    safetyBackupPath: string | null;
}>;
export {};
