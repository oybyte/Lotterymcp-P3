import { createHash } from 'node:crypto'
import {
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
} from 'node:fs/promises'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import {
  PL3_LOTTERY_TYPE,
  Pl3PredictionError,
  normalizePl3Records,
  type Pl3PredictionLedger,
  type Pl3Record,
  type Pl3SourceRecord,
} from './pl3-prediction.js'

export const PL3_DATABASE_FILENAME = 'pl3.sqlite'
export const PL3_DATABASE_SCHEMA_VERSION = 1
export const PL3_DATABASE_LATEST_SCHEMA_VERSION = 3

export type Pl3DrawStatus = 'confirmed' | 'single_source' | 'conflict'
export type Pl3ConflictType = 'date' | 'numbers' | 'both'
export type Pl3OfficialProvider = 'lottery-gov-cn' | 'zhcw'
export type Pl3ObservationProvider = Pl3OfficialProvider | 'neuxsbot-remote' | 'file-import' | 'legacy-json' | string

export type Pl3StoredDrawRecord = Pl3Record & {
  status: Exclude<Pl3DrawStatus, 'conflict'>
  observationId: number
  provider: string
  sourceUrl?: string
  observedAt: string
}

export type Pl3StoreStatus = {
  databasePath: string
  schemaVersion: number
  totalPeriods: number
  usableRecords: number
  confirmedRecords: number
  singleSourceRecords: number
  conflictRecords: number
  latestPeriod: string | null
  latestDrawDate: string | null
  authoritativeTotal: number | null
  authoritativeCompleteness: number | null
  reconciliationCoverage: number | null
  dualSourceCoverage: number | null
  completenessStatus: 'known' | 'unknown'
  legacyPredictionCount: number
}

export type Pl3ImportOptions = {
  provider: Pl3ObservationProvider
  sourceUrl?: string
  observedAt?: string
  fetchedAt?: string
  statusCode?: number
  rawPath?: string
  rawContentHash?: string
  parseStatus?: 'parsed' | 'failed'
  authoritativeTotal?: number
  metadata?: Record<string, unknown>
}

export type Pl3ImportResult = {
  inputCount: number
  insertedObservations: number
  repeatedObservations: number
  affectedPeriods: number
  confirmedRecords: number
  singleSourceRecords: number
  conflictRecords: number
  snapshotId: string
}

export type Pl3ArchivePageInput = {
  provider: Pl3ObservationProvider
  page: number
  sourceUrl: string
  fetchedAt: string
  statusCode: number
  contentHash: string
  rawPath: string
  parseStatus: 'parsed' | 'failed'
  records: readonly Pl3SourceRecord[]
  metadata?: Record<string, unknown>
}

export type Pl3ArchiveImportResult = Omit<Pl3ImportResult, 'snapshotId'> & {
  sourceSnapshotCount: number
  sourceSnapshotIds: string[]
}

export type Pl3StoreQuery = {
  period?: string
  fromDate?: string
  toDate?: string
  page?: number
  limit?: number
}

export type Pl3DatasetSnapshot = {
  snapshotId: string
  fromPeriod: string
  afterPeriod: string
  recordCount: number
  dataHash: string
  codeCommit: string | null
  createdAt: string
  quality: 'confirmed' | 'allow-single-source'
  confirmedCount: number
  singleSourceCount: number
}

export type Pl3DatasetSnapshotVerification = {
  snapshotId: string
  valid: boolean
  expectedRecordCount: number
  actualRecordCount: number
  expectedDataHash: string
  actualDataHash: string
}

export type Pl3FeatureSnapshotStorageRecord = {
  featureSnapshotId: string
  datasetSnapshotId: string
  afterPeriod: string
  featureVersion: string
  windowsJson: string
  windowConfigHash: string
  payloadGzip: Buffer
  payloadHash: string
  codeCommit: string | null
  createdAt: string
}

export type Pl3ExperimentStatus =
  | 'registered'
  | 'running'
  | 'development_complete'
  | 'frozen_evaluated'
  | 'interrupted'
  | 'failed'

export type Pl3ExperimentStorageRecord = {
  experimentId: string
  schemaVersion: number
  name: string
  mode: 'development' | 'confirmatory'
  researchBatchId: string
  datasetSnapshotId: string
  featureVersion: string
  specJson: string
  specHash: string
  codeCommit: string
  randomSeed: number
  status: Pl3ExperimentStatus
  reportPath: string | null
  reportHash: string | null
  errorMessage: string | null
  createdAt: string
  updatedAt: string
}

export type Pl3ExperimentFoldStorageRecord = {
  experimentId: string
  foldLevel: 'inner' | 'outer' | 'frozen'
  foldIndex: number
  trainFromPeriod: string
  trainToPeriod: string
  testFromPeriod: string
  testToPeriod: string
  status: 'pending' | 'running' | 'complete' | 'failed'
  selectedParamsJson: string | null
  metricsJson: string | null
  resultPath: string | null
  resultHash: string | null
  startedAt: string | null
  completedAt: string | null
}

export type Pl3LegacyMigrationPreview = {
  dataDir: string
  databasePath: string
  historyPath: string
  ledgerPath: string
  databaseExists: boolean
  historyExists: boolean
  ledgerExists: boolean
  recordCount: number
  latestPeriod: string | null
  oldestPeriod: string | null
  recordHash: string | null
  predictionCount: number
  predictionIds: string[]
}

export type Pl3LegacyMigrationResult = Pl3LegacyMigrationPreview & {
  applied: true
  backupPaths: string[]
  importedObservations: number
  importedPredictions: number
}

export type Pl3SchemaMigrationPreview = {
  databasePath: string
  currentVersion: number
  targetVersion: number
  migrationRequired: boolean
  migrations: Array<{ version: number; name: string; checksum: string }>
}

export type Pl3OperationalEventLevel = 'info' | 'warning' | 'error'

export type Pl3OperationalEvent = {
  eventId: number
  level: Pl3OperationalEventLevel
  eventType: string
  message: string
  details: Record<string, unknown>
  createdAt: string
}

export type Pl3OnlinePredictionRun = {
  runId: string
  predictionId: string | null
  status: 'running' | 'success' | 'failed'
  dataMode: string
  afterPeriod: string | null
  targetPeriod: string | null
  reportPath: string | null
  reportHash: string | null
  errorMessage: string | null
  startedAt: string
  completedAt: string | null
}

export type Pl3NotificationDelivery = {
  deliveryId: number
  channel: string
  dedupeKey: string
  status: 'success' | 'failed'
  target: string | null
  messageHash: string
  errorMessage: string | null
  deliveredAt: string
}

type DrawRow = {
  period: string
  period_num: number
  draw_date: string | null
  d1: number | null
  d2: number | null
  d3: number | null
  numbers: string | null
  status: Pl3DrawStatus
  selected_observation_id: number | null
  manual_observation_id: number | null
  resolved_through_observation_id: number | null
  updated_at: string
}

type ObservationRow = {
  id: number
  period: string
  period_num: number
  draw_date: string
  d1: number
  d2: number
  d3: number
  numbers: string
  provider: string
  source_url: string | null
  first_observed_at: string
  last_observed_at: string
  observation_count: number
}

const OFFICIAL_CONFIRMATION_PROVIDERS = new Set<Pl3OfficialProvider>(['lottery-gov-cn', 'zhcw'])
const DEFAULT_DATA_DIR = '.lotterymcp-data'
const MAINTENANCE_LOCK_MAX_AGE_MS = 120_000

const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')

const canonicalize = (value: unknown): string => {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item)).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
    .join(',')}}`
}

const normalizeTimestamp = (value: unknown, fallback = new Date().toISOString()) => {
  const parsed = new Date(String(value || ''))
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : fallback
}

const normalizeProvider = (value: unknown) => {
  const provider = String(value || '').trim().toLowerCase()
  if (!provider) throw new Pl3PredictionError('LOTTERYMCP_PL3_PROVIDER_REQUIRED', '排列3数据来源不能为空。')
  if (provider.length > 80) throw new Pl3PredictionError('LOTTERYMCP_PL3_PROVIDER_INVALID', '排列3数据来源名称过长。')
  return provider
}

const normalizePositiveInteger = (value: unknown) => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

const toPeriodNumber = (period: string) => {
  if (!/^\d{5,12}$/.test(period)) {
    throw new Pl3PredictionError('LOTTERYMCP_PL3_INVALID_PERIOD', `排列3期号无效: ${period || '(空)'}`)
  }
  return Number(period)
}

const createMigration001 = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  source_url TEXT,
  fetched_at TEXT NOT NULL,
  status_code INTEGER,
  content_hash TEXT NOT NULL,
  raw_path TEXT,
  parse_status TEXT NOT NULL CHECK (parse_status IN ('parsed', 'failed')),
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS draw_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period TEXT NOT NULL,
  period_num INTEGER NOT NULL,
  draw_date TEXT NOT NULL,
  d1 INTEGER NOT NULL CHECK (d1 BETWEEN 0 AND 9),
  d2 INTEGER NOT NULL CHECK (d2 BETWEEN 0 AND 9),
  d3 INTEGER NOT NULL CHECK (d3 BETWEEN 0 AND 9),
  numbers TEXT NOT NULL,
  provider TEXT NOT NULL,
  source_url TEXT,
  source_snapshot_id TEXT REFERENCES source_snapshots(snapshot_id),
  first_observed_at TEXT NOT NULL,
  last_observed_at TEXT NOT NULL,
  observation_count INTEGER NOT NULL DEFAULT 1,
  UNIQUE (period, provider, draw_date, numbers)
);

CREATE INDEX IF NOT EXISTS idx_draw_observations_period ON draw_observations(period_num DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_draw_observations_provider ON draw_observations(provider, period_num DESC);

CREATE TABLE IF NOT EXISTS draws (
  period TEXT PRIMARY KEY,
  period_num INTEGER NOT NULL,
  draw_date TEXT,
  d1 INTEGER CHECK (d1 IS NULL OR d1 BETWEEN 0 AND 9),
  d2 INTEGER CHECK (d2 IS NULL OR d2 BETWEEN 0 AND 9),
  d3 INTEGER CHECK (d3 IS NULL OR d3 BETWEEN 0 AND 9),
  numbers TEXT,
  status TEXT NOT NULL CHECK (status IN ('confirmed', 'single_source', 'conflict')),
  selected_observation_id INTEGER REFERENCES draw_observations(id),
  manual_observation_id INTEGER REFERENCES draw_observations(id),
  resolved_through_observation_id INTEGER REFERENCES draw_observations(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_draws_status_period ON draws(status, period_num DESC);

CREATE TABLE IF NOT EXISTS draw_revisions (
  revision_id INTEGER PRIMARY KEY AUTOINCREMENT,
  period TEXT NOT NULL REFERENCES draws(period),
  old_value_json TEXT,
  new_value_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  evidence_url TEXT,
  revised_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dataset_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  from_period TEXT NOT NULL,
  after_period TEXT NOT NULL,
  record_count INTEGER NOT NULL,
  data_hash TEXT NOT NULL,
  code_commit TEXT,
  quality TEXT NOT NULL CHECK (quality IN ('confirmed', 'allow-single-source')),
  confirmed_count INTEGER NOT NULL,
  single_source_count INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dataset_snapshot_draws (
  snapshot_id TEXT NOT NULL REFERENCES dataset_snapshots(snapshot_id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  observation_id INTEGER NOT NULL REFERENCES draw_observations(id),
  draw_status TEXT NOT NULL CHECK (draw_status IN ('confirmed', 'single_source')),
  ordinal INTEGER NOT NULL,
  PRIMARY KEY (snapshot_id, period),
  UNIQUE (snapshot_id, ordinal)
);

CREATE TABLE IF NOT EXISTS legacy_predictions (
  prediction_id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  imported_at TEXT NOT NULL
);
`

const migration001Checksum = sha256(createMigration001)

const createMigration002 = `
CREATE TABLE feature_snapshots (
  feature_snapshot_id TEXT PRIMARY KEY,
  dataset_snapshot_id TEXT NOT NULL REFERENCES dataset_snapshots(snapshot_id),
  after_period TEXT NOT NULL,
  feature_version TEXT NOT NULL,
  windows_json TEXT NOT NULL,
  window_config_hash TEXT NOT NULL,
  payload_gzip BLOB NOT NULL,
  payload_hash TEXT NOT NULL,
  code_commit TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (dataset_snapshot_id, after_period, feature_version, window_config_hash)
);

CREATE INDEX idx_feature_snapshots_dataset_period
  ON feature_snapshots(dataset_snapshot_id, after_period, feature_version);

CREATE TABLE experiments (
  experiment_id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('development', 'confirmatory')),
  research_batch_id TEXT NOT NULL,
  dataset_snapshot_id TEXT NOT NULL REFERENCES dataset_snapshots(snapshot_id),
  feature_version TEXT NOT NULL,
  spec_json TEXT NOT NULL,
  spec_hash TEXT NOT NULL,
  code_commit TEXT NOT NULL,
  random_seed INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'registered', 'running', 'development_complete', 'frozen_evaluated', 'interrupted', 'failed'
  )),
  report_path TEXT,
  report_hash TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_experiments_status_created ON experiments(status, created_at DESC);
CREATE INDEX idx_experiments_batch ON experiments(research_batch_id, created_at DESC);

CREATE TABLE experiment_folds (
  experiment_id TEXT NOT NULL REFERENCES experiments(experiment_id) ON DELETE CASCADE,
  fold_level TEXT NOT NULL CHECK (fold_level IN ('inner', 'outer', 'frozen')),
  fold_index INTEGER NOT NULL,
  train_from_period TEXT NOT NULL,
  train_to_period TEXT NOT NULL,
  test_from_period TEXT NOT NULL,
  test_to_period TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'complete', 'failed')),
  selected_params_json TEXT,
  metrics_json TEXT,
  result_path TEXT,
  result_hash TEXT,
  started_at TEXT,
  completed_at TEXT,
  PRIMARY KEY (experiment_id, fold_level, fold_index)
);

CREATE TABLE experiment_metrics (
  experiment_id TEXT NOT NULL REFERENCES experiments(experiment_id) ON DELETE CASCADE,
  fold_level TEXT NOT NULL,
  fold_index INTEGER NOT NULL,
  model_id TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  metric_role TEXT NOT NULL CHECK (metric_role IN ('primary', 'secondary', 'exploratory')),
  segment TEXT NOT NULL DEFAULT 'all',
  value REAL NOT NULL,
  sample_count INTEGER NOT NULL,
  PRIMARY KEY (experiment_id, fold_level, fold_index, model_id, metric_name, segment)
);

CREATE TABLE runtime_locks (
  lock_name TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  owner_pid INTEGER NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE experiment_audit (
  audit_id INTEGER PRIMARY KEY AUTOINCREMENT,
  experiment_id TEXT NOT NULL REFERENCES experiments(experiment_id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
`

const migration002Checksum = sha256(createMigration002)

const createMigration003 = `
CREATE TABLE online_prediction_runs (
  run_id TEXT PRIMARY KEY,
  prediction_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  data_mode TEXT NOT NULL,
  after_period TEXT,
  target_period TEXT,
  report_path TEXT,
  report_hash TEXT,
  error_message TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX idx_online_prediction_runs_started
  ON online_prediction_runs(started_at DESC);

CREATE TABLE operational_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL CHECK (level IN ('info', 'warning', 'error')),
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX idx_operational_events_created
  ON operational_events(created_at DESC);

CREATE TABLE notification_deliveries (
  delivery_id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  target TEXT,
  message_hash TEXT NOT NULL,
  error_message TEXT,
  delivered_at TEXT NOT NULL,
  UNIQUE(channel, dedupe_key)
);
`

const migration003Checksum = sha256(createMigration003)

const schemaMigrations = [
  { version: 2, name: 'p3-experiment-foundation', checksum: migration002Checksum, sql: createMigration002 },
  { version: 3, name: 'p3-online-operations', checksum: migration003Checksum, sql: createMigration003 },
] as const

const applyMigrations = (database: Database.Database) => {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `)

  const existing = database.prepare(
    'SELECT version, checksum FROM schema_migrations WHERE version = ?',
  ).get(PL3_DATABASE_SCHEMA_VERSION) as { version: number; checksum: string } | undefined

  if (existing) {
    if (existing.checksum !== migration001Checksum) {
      throw new Error('排列3数据库 migration 001 校验和不匹配，拒绝继续打开。')
    }
    return
  }

  database.transaction(() => {
    database.exec(createMigration001)
    database.prepare(
      'INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
    ).run(PL3_DATABASE_SCHEMA_VERSION, 'p3-data-archive', migration001Checksum, new Date().toISOString())
  })()
}

const serializeDrawRow = (row: DrawRow | undefined) => row ? canonicalize({
  period: row.period,
  drawDate: row.draw_date,
  numbers: row.numbers,
  status: row.status,
  selectedObservationId: row.selected_observation_id,
}) : null

export class Pl3Store {
  readonly databasePath: string
  private readonly database: Database.Database

  constructor(databasePath: string, options: {
    readonly?: boolean
    fileMustExist?: boolean
    maintenance?: boolean
  } = {}) {
    this.databasePath = path.resolve(databasePath)
    const maintenanceLockPath = path.join(path.dirname(this.databasePath), 'pl3.sqlite.maintenance.lock')
    if (!options.maintenance && existsSync(maintenanceLockPath)) {
      throw new Error('排列3数据库正在执行维护操作，请稍后重试。')
    }
    if (!options.readonly) mkdirSync(path.dirname(this.databasePath), { recursive: true })
    this.database = new Database(this.databasePath, {
      readonly: Boolean(options.readonly),
      fileMustExist: Boolean(options.fileMustExist),
    })
    this.database.pragma('foreign_keys = ON')
    this.database.pragma('busy_timeout = 2000')
    if (!options.readonly) {
      this.database.pragma('journal_mode = WAL')
      applyMigrations(this.database)
    }
  }

  close() {
    if (this.database.open) this.database.close()
  }

  getSchemaVersion() {
    const row = this.database.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as {
      version: number | null
    }
    return Number(row.version || 0)
  }

  private setMeta(key: string, value: string) {
    const now = new Date().toISOString()
    this.database.prepare(`
      INSERT INTO app_meta(key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, value, now)
  }

  private getMeta(key: string) {
    const row = this.database.prepare('SELECT value FROM app_meta WHERE key = ?').get(key) as {
      value: string
    } | undefined
    return row?.value
  }

  private insertSourceSnapshot(input: {
    provider: string
    sourceUrl?: string
    fetchedAt: string
    statusCode?: number
    contentHash: string
    rawPath?: string
    parseStatus: 'parsed' | 'failed'
    metadata?: Record<string, unknown>
  }) {
    const snapshotId = sha256(canonicalize({
      provider: input.provider,
      fetchedAt: input.fetchedAt,
      contentHash: input.contentHash,
      rawPath: input.rawPath || null,
    }))
    this.database.prepare(`
      INSERT OR IGNORE INTO source_snapshots(
        snapshot_id, provider, source_url, fetched_at, status_code,
        content_hash, raw_path, parse_status, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      snapshotId,
      input.provider,
      input.sourceUrl || null,
      input.fetchedAt,
      input.statusCode ?? null,
      input.contentHash,
      input.rawPath || null,
      input.parseStatus,
      canonicalize(input.metadata || {}),
    )
    return snapshotId
  }

  private upsertObservation(input: {
    record: Pl3Record
    provider: string
    sourceUrl?: string
    snapshotId: string
    observedAt: string
  }) {
    return this.database.prepare(`
      INSERT INTO draw_observations(
        period, period_num, draw_date, d1, d2, d3, numbers, provider,
        source_url, source_snapshot_id, first_observed_at, last_observed_at, observation_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(period, provider, draw_date, numbers) DO UPDATE SET
        last_observed_at = excluded.last_observed_at,
        observation_count = draw_observations.observation_count + 1
      RETURNING id, observation_count
    `).get(
      input.record.period,
      toPeriodNumber(input.record.period),
      input.record.drawDate,
      input.record.numbersList[0],
      input.record.numbersList[1],
      input.record.numbersList[2],
      input.record.numbers,
      input.provider,
      input.sourceUrl || null,
      input.snapshotId,
      input.observedAt,
      input.observedAt,
    ) as { id: number; observation_count: number }
  }

  private reconcilePeriod(period: string, now: string) {
    const observations = this.database.prepare(`
      SELECT id, period, period_num, draw_date, d1, d2, d3, numbers, provider, source_url,
             first_observed_at, last_observed_at, observation_count
      FROM draw_observations
      WHERE period = ?
      ORDER BY id ASC
    `).all(period) as ObservationRow[]

    if (observations.length === 0) return
    const oldRow = this.database.prepare('SELECT * FROM draws WHERE period = ?').get(period) as DrawRow | undefined
    const latestObservationId = observations.at(-1)!.id
    let selected: ObservationRow | undefined
    let status: Pl3DrawStatus

    if (
      oldRow?.manual_observation_id &&
      oldRow.resolved_through_observation_id &&
      oldRow.resolved_through_observation_id >= latestObservationId
    ) {
      selected = observations.find((item) => item.id === oldRow.manual_observation_id)
      status = 'confirmed'
    } else {
      const values = new Map<string, ObservationRow[]>()
      for (const observation of observations) {
        const key = `${observation.draw_date}|${observation.numbers}`
        const entries = values.get(key) || []
        entries.push(observation)
        values.set(key, entries)
      }

      if (values.size > 1) {
        status = 'conflict'
      } else {
        const matching = [...values.values()][0]!
        selected = matching.at(-1)
        const officialProviders = new Set(
          matching.map((item) => item.provider).filter((item): item is Pl3OfficialProvider =>
            OFFICIAL_CONFIRMATION_PROVIDERS.has(item as Pl3OfficialProvider)),
        )
        status = officialProviders.size === OFFICIAL_CONFIRMATION_PROVIDERS.size
          ? 'confirmed'
          : 'single_source'
      }
    }

    const nextValue = {
      period,
      drawDate: selected?.draw_date || null,
      numbers: selected?.numbers || null,
      status,
      selectedObservationId: selected?.id || null,
    }

    this.database.prepare(`
      INSERT INTO draws(
        period, period_num, draw_date, d1, d2, d3, numbers, status,
        selected_observation_id, manual_observation_id, resolved_through_observation_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
      ON CONFLICT(period) DO UPDATE SET
        period_num = excluded.period_num,
        draw_date = excluded.draw_date,
        d1 = excluded.d1,
        d2 = excluded.d2,
        d3 = excluded.d3,
        numbers = excluded.numbers,
        status = excluded.status,
        selected_observation_id = excluded.selected_observation_id,
        manual_observation_id = CASE
          WHEN draws.resolved_through_observation_id >= ? THEN draws.manual_observation_id
          ELSE NULL
        END,
        resolved_through_observation_id = CASE
          WHEN draws.resolved_through_observation_id >= ? THEN draws.resolved_through_observation_id
          ELSE NULL
        END,
        updated_at = excluded.updated_at
    `).run(
      period,
      observations[0]!.period_num,
      selected?.draw_date || null,
      selected?.d1 ?? null,
      selected?.d2 ?? null,
      selected?.d3 ?? null,
      selected?.numbers || null,
      status,
      selected?.id || null,
      now,
      now,
      latestObservationId,
      latestObservationId,
    )

    if (oldRow && serializeDrawRow(oldRow) !== canonicalize(nextValue)) {
      this.database.prepare(`
        INSERT INTO draw_revisions(period, old_value_json, new_value_json, reason, evidence_url, revised_at)
        VALUES (?, ?, ?, ?, NULL, ?)
      `).run(period, serializeDrawRow(oldRow), canonicalize(nextValue), 'source-reconciliation', now)
    }
  }

  importRecords(records: readonly Pl3SourceRecord[], options: Pl3ImportOptions): Pl3ImportResult {
    const provider = normalizeProvider(options.provider)
    const observedAt = normalizeTimestamp(options.observedAt)
    const fetchedAt = normalizeTimestamp(options.fetchedAt, observedAt)
    const parsedRecords = records.map((record) => normalizePl3Records([record])[0]!)
    const rawContentHash = options.rawContentHash || sha256(canonicalize(parsedRecords))
    let snapshotId = ''
    const affectedPeriods = new Set<string>()
    let insertedObservations = 0
    let repeatedObservations = 0

    const result = this.database.transaction(() => {
      snapshotId = this.insertSourceSnapshot({
        provider,
        sourceUrl: options.sourceUrl,
        fetchedAt,
        statusCode: options.statusCode,
        contentHash: rawContentHash,
        rawPath: options.rawPath,
        parseStatus: options.parseStatus || 'parsed',
        metadata: options.metadata,
      })

      for (const record of parsedRecords) {
        const source = records.find((item) => String(item.period || '').trim() === record.period)
        const row = this.upsertObservation({
          record,
          provider,
          sourceUrl: options.sourceUrl || (typeof source?.sourceUrl === 'string' ? source.sourceUrl : undefined),
          snapshotId,
          observedAt,
        })
        if (row.observation_count === 1) insertedObservations += 1
        else repeatedObservations += 1
        affectedPeriods.add(record.period)
      }

      const now = new Date().toISOString()
      for (const period of affectedPeriods) this.reconcilePeriod(period, now)

      const authoritativeTotal = normalizePositiveInteger(options.authoritativeTotal)
      if (authoritativeTotal) this.setMeta(`authoritative_total:${provider}`, String(authoritativeTotal))

      return this.getStatus()
    })()

    return {
      inputCount: records.length,
      insertedObservations,
      repeatedObservations,
      affectedPeriods: affectedPeriods.size,
      confirmedRecords: result.confirmedRecords,
      singleSourceRecords: result.singleSourceRecords,
      conflictRecords: result.conflictRecords,
      snapshotId,
    }
  }

  importArchivePages(
    pages: readonly Pl3ArchivePageInput[],
    options: { authoritativeTotal?: number } = {},
  ): Pl3ArchiveImportResult {
    if (pages.length === 0) throw new Error('排列3 archive 不包含任何来源页面。')
    const affectedPeriods = new Set<string>()
    const sourceSnapshotIds: string[] = []
    let inputCount = 0
    let insertedObservations = 0
    let repeatedObservations = 0

    const status = this.database.transaction(() => {
      for (const page of pages) {
        const provider = normalizeProvider(page.provider)
        const fetchedAt = normalizeTimestamp(page.fetchedAt)
        const snapshotId = this.insertSourceSnapshot({
          provider,
          sourceUrl: page.sourceUrl,
          fetchedAt,
          statusCode: page.statusCode,
          contentHash: page.contentHash,
          rawPath: page.rawPath,
          parseStatus: page.parseStatus,
          metadata: { page: page.page, ...(page.metadata || {}) },
        })
        sourceSnapshotIds.push(snapshotId)
        if (page.parseStatus !== 'parsed') continue

        for (const sourceRecord of page.records) {
          inputCount += 1
          const record = normalizePl3Records([sourceRecord])[0]!
          const row = this.upsertObservation({
            record,
            provider,
            sourceUrl: page.sourceUrl,
            snapshotId,
            observedAt: fetchedAt,
          })
          if (row.observation_count === 1) insertedObservations += 1
          else repeatedObservations += 1
          affectedPeriods.add(record.period)
        }
      }

      const now = new Date().toISOString()
      for (const period of affectedPeriods) this.reconcilePeriod(period, now)
      const authoritativeTotal = normalizePositiveInteger(options.authoritativeTotal)
      if (authoritativeTotal) {
        const parsedPage = pages.find((page) => page.parseStatus === 'parsed')
        if (parsedPage) this.setMeta(`authoritative_total:${normalizeProvider(parsedPage.provider)}`, String(authoritativeTotal))
      }
      return this.getStatus()
    })()

    return {
      inputCount,
      insertedObservations,
      repeatedObservations,
      affectedPeriods: affectedPeriods.size,
      confirmedRecords: status.confirmedRecords,
      singleSourceRecords: status.singleSourceRecords,
      conflictRecords: status.conflictRecords,
      sourceSnapshotCount: sourceSnapshotIds.length,
      sourceSnapshotIds,
    }
  }

  recordArchivePages(pages: readonly Pl3ArchivePageInput[]) {
    return this.database.transaction(() => pages.map((page) => this.insertSourceSnapshot({
      provider: normalizeProvider(page.provider),
      sourceUrl: page.sourceUrl,
      fetchedAt: normalizeTimestamp(page.fetchedAt),
      statusCode: page.statusCode,
      contentHash: page.contentHash,
      rawPath: page.rawPath,
      parseStatus: page.parseStatus,
      metadata: { page: page.page, discardedBatch: true, ...(page.metadata || {}) },
    })))()
  }

  resolveConflict(input: {
    period: string
    observationId: number
    reason: string
    evidenceUrl?: string
  }) {
    const period = String(input.period || '').trim()
    toPeriodNumber(period)
    const reason = String(input.reason || '').trim()
    if (!reason) throw new Error('处理排列3冲突时必须填写原因。')
    const evidenceUrl = String(input.evidenceUrl || '').trim()
    if (!evidenceUrl) throw new Error('处理排列3冲突时必须提供证据 URL。')
    let parsedEvidenceUrl: URL
    try {
      parsedEvidenceUrl = new URL(evidenceUrl)
    } catch {
      throw new Error('排列3冲突证据 URL 格式无效。')
    }
    if (!['http:', 'https:'].includes(parsedEvidenceUrl.protocol)) {
      throw new Error('排列3冲突证据 URL 只支持 http/https。')
    }
    const now = new Date().toISOString()

    return this.database.transaction(() => {
      const observation = this.database.prepare(`
        SELECT id, period, period_num, draw_date, d1, d2, d3, numbers, provider, source_url,
               first_observed_at, last_observed_at, observation_count
        FROM draw_observations WHERE id = ? AND period = ?
      `).get(input.observationId, period) as ObservationRow | undefined
      if (!observation) throw new Error(`第 ${period} 期不存在 observation ${input.observationId}。`)
      const oldRow = this.database.prepare('SELECT * FROM draws WHERE period = ?').get(period) as DrawRow | undefined
      if (!oldRow) throw new Error(`第 ${period} 期不存在当前真值记录。`)
      const maxRow = this.database.prepare(
        'SELECT MAX(id) AS id FROM draw_observations WHERE period = ?',
      ).get(period) as { id: number }

      this.database.prepare(`
        UPDATE draws SET
          draw_date = ?, d1 = ?, d2 = ?, d3 = ?, numbers = ?, status = 'confirmed',
          selected_observation_id = ?, manual_observation_id = ?,
          resolved_through_observation_id = ?, updated_at = ?
        WHERE period = ?
      `).run(
        observation.draw_date,
        observation.d1,
        observation.d2,
        observation.d3,
        observation.numbers,
        observation.id,
        observation.id,
        maxRow.id,
        now,
        period,
      )

      const newValue = canonicalize({
        period,
        drawDate: observation.draw_date,
        numbers: observation.numbers,
        status: 'confirmed',
        selectedObservationId: observation.id,
      })
      this.database.prepare(`
        INSERT INTO draw_revisions(period, old_value_json, new_value_json, reason, evidence_url, revised_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(period, serializeDrawRow(oldRow), newValue, reason, evidenceUrl, now)
      return this.getRecord(period)
    })()
  }

  getRecord(period: string): Pl3StoredDrawRecord | null {
    return this.getRecords({ period, page: 1, limit: 1 })[0] || null
  }

  getRecords(query: Pl3StoreQuery = {}): Pl3StoredDrawRecord[] {
    const conditions = [`d.status IN ('confirmed', 'single_source')`, 'd.selected_observation_id IS NOT NULL']
    const parameters: Array<string | number> = []
    if (query.period) {
      conditions.push('d.period = ?')
      parameters.push(String(query.period))
    }
    if (query.fromDate) {
      conditions.push('d.draw_date >= ?')
      parameters.push(String(query.fromDate))
    }
    if (query.toDate) {
      conditions.push('d.draw_date <= ?')
      parameters.push(String(query.toDate))
    }
    const page = Math.max(1, Math.floor(Number(query.page) || 1))
    const limit = Math.max(1, Math.floor(Number(query.limit) || 100))
    const offset = (page - 1) * limit
    parameters.push(limit, offset)

    const rows = this.database.prepare(`
      SELECT d.period, d.draw_date, d.d1, d.d2, d.d3, d.numbers, d.status,
             o.id AS observation_id, o.provider, o.source_url, o.last_observed_at
      FROM draws d
      JOIN draw_observations o ON o.id = d.selected_observation_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY d.period_num DESC
      LIMIT ? OFFSET ?
    `).all(...parameters) as Array<{
      period: string
      draw_date: string
      d1: number
      d2: number
      d3: number
      numbers: string
      status: Exclude<Pl3DrawStatus, 'conflict'>
      observation_id: number
      provider: string
      source_url: string | null
      last_observed_at: string
    }>

    return rows.map((row) => ({
      lotteryType: PL3_LOTTERY_TYPE,
      period: row.period,
      drawDate: row.draw_date,
      numbers: row.numbers,
      numbersList: [row.d1, row.d2, row.d3],
      status: row.status,
      observationId: row.observation_id,
      provider: row.provider,
      ...(row.source_url ? { sourceUrl: row.source_url } : {}),
      observedAt: row.last_observed_at,
    }))
  }

  getRecordCount(query: Omit<Pl3StoreQuery, 'page' | 'limit'> = {}) {
    const conditions = [`status IN ('confirmed', 'single_source')`]
    const parameters: string[] = []
    if (query.period) {
      conditions.push('period = ?')
      parameters.push(String(query.period))
    }
    if (query.fromDate) {
      conditions.push('draw_date >= ?')
      parameters.push(String(query.fromDate))
    }
    if (query.toDate) {
      conditions.push('draw_date <= ?')
      parameters.push(String(query.toDate))
    }
    const row = this.database.prepare(
      `SELECT COUNT(*) AS count FROM draws WHERE ${conditions.join(' AND ')}`,
    ).get(...parameters) as { count: number }
    return row.count
  }

  getConflicts(query: {
    fromPeriod?: string
    toPeriod?: string
    type?: Pl3ConflictType
  } = {}) {
    const conditions = [`d.status = 'conflict'`]
    const parameters: number[] = []
    if (query.fromPeriod) {
      conditions.push('d.period_num >= ?')
      parameters.push(toPeriodNumber(query.fromPeriod))
    }
    if (query.toPeriod) {
      conditions.push('d.period_num <= ?')
      parameters.push(toPeriodNumber(query.toPeriod))
    }
    const rows = this.database.prepare(`
      SELECT d.period, d.period_num, d.updated_at,
             json_group_array(json_object(
               'observationId', o.id,
               'provider', o.provider,
               'drawDate', o.draw_date,
               'numbers', o.numbers,
               'sourceUrl', o.source_url,
               'observedAt', o.last_observed_at
             )) AS observations_json
      FROM draws d
      JOIN draw_observations o ON o.period = d.period
      WHERE ${conditions.join(' AND ')}
      GROUP BY d.period
      ORDER BY d.period_num DESC
    `).all(...parameters).map((row: any) => {
      const observations = JSON.parse(String(row.observations_json)) as Array<{
        observationId: number
        provider: string
        drawDate: string
        numbers: string
        sourceUrl?: string | null
        observedAt: string
      }>
      const dates = new Set(observations.map((item) => item.drawDate))
      const numbers = new Set(observations.map((item) => item.numbers))
      const type: Pl3ConflictType = dates.size > 1 && numbers.size > 1
        ? 'both'
        : dates.size > 1
          ? 'date'
          : 'numbers'
      return {
        period: String(row.period),
        type,
        updatedAt: String(row.updated_at),
        observations,
      }
    })
    return query.type ? rows.filter((row) => row.type === query.type) : rows
  }

  getStatus(): Pl3StoreStatus {
    const counts = this.database.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed,
        SUM(CASE WHEN status = 'single_source' THEN 1 ELSE 0 END) AS single_source,
        SUM(CASE WHEN status = 'conflict' THEN 1 ELSE 0 END) AS conflict
      FROM draws
    `).get() as { total: number; confirmed: number | null; single_source: number | null; conflict: number | null }
    const latest = this.database.prepare(`
      SELECT period, draw_date FROM draws
      WHERE status IN ('confirmed', 'single_source')
      ORDER BY period_num DESC LIMIT 1
    `).get() as { period: string; draw_date: string } | undefined
    const authoritativeTotal = normalizePositiveInteger(
      this.getMeta('authoritative_total:lottery-gov-cn') || this.getMeta('authoritative_total:zhcw'),
    )
    const confirmed = Number(counts.confirmed || 0)
    const singleSource = Number(counts.single_source || 0)
    const conflict = Number(counts.conflict || 0)
    const total = Number(counts.total || 0)
    const usable = confirmed + singleSource
    const legacyPredictionRow = this.database.prepare(
      'SELECT COUNT(*) AS count FROM legacy_predictions',
    ).get() as { count: number }
    const dualSourceRow = this.database.prepare(`
      SELECT COUNT(*) AS count
      FROM draws d
      JOIN draw_observations selected ON selected.id = d.selected_observation_id
      WHERE d.status = 'confirmed'
        AND EXISTS (
          SELECT 1 FROM draw_observations primary_source
          WHERE primary_source.period = d.period
            AND primary_source.provider = 'lottery-gov-cn'
            AND primary_source.draw_date = selected.draw_date
            AND primary_source.numbers = selected.numbers
        )
        AND EXISTS (
          SELECT 1 FROM draw_observations fallback_source
          WHERE fallback_source.period = d.period
            AND fallback_source.provider = 'zhcw'
            AND fallback_source.draw_date = selected.draw_date
            AND fallback_source.numbers = selected.numbers
        )
    `).get() as { count: number }

    return {
      databasePath: this.databasePath,
      schemaVersion: this.getSchemaVersion(),
      totalPeriods: total,
      usableRecords: usable,
      confirmedRecords: confirmed,
      singleSourceRecords: singleSource,
      conflictRecords: conflict,
      latestPeriod: latest?.period || null,
      latestDrawDate: latest?.draw_date || null,
      authoritativeTotal,
      authoritativeCompleteness: authoritativeTotal ? usable / authoritativeTotal : null,
      reconciliationCoverage: total > 0 ? usable / total : null,
      dualSourceCoverage: total > 0 ? dualSourceRow.count / total : null,
      completenessStatus: authoritativeTotal ? 'known' : 'unknown',
      legacyPredictionCount: legacyPredictionRow.count,
    }
  }

  listReferencedRawPaths() {
    return (this.database.prepare(`
      SELECT DISTINCT raw_path FROM source_snapshots
      WHERE raw_path IS NOT NULL AND raw_path <> ''
      ORDER BY raw_path
    `).all() as Array<{ raw_path: string }>).map((row) => row.raw_path.replaceAll('\\', '/'))
  }

  createDatasetSnapshot(input: {
    fromPeriod?: string
    afterPeriod?: string
    last?: number
    allowSingleSource?: boolean
    codeCommit?: string
  } = {}): Pl3DatasetSnapshot {
    if (input.last !== undefined && (input.fromPeriod || input.afterPeriod)) {
      throw new Error('snapshot 的 last 与显式期号范围不能同时使用。')
    }
    const allowSingleSource = Boolean(input.allowSingleSource)
    let fromPeriod = input.fromPeriod
    let afterPeriod = input.afterPeriod
    if (input.last !== undefined) {
      if (!Number.isInteger(input.last) || input.last < 1) throw new Error('snapshot last 必须是正整数。')
      const statuses = allowSingleSource ? `('confirmed', 'single_source')` : `('confirmed')`
      const boundaries = this.database.prepare(`
        SELECT period FROM draws
        WHERE status IN ${statuses} AND selected_observation_id IS NOT NULL
        ORDER BY period_num DESC LIMIT ?
      `).all(input.last) as Array<{ period: string }>
      if (boundaries.length < input.last) {
        throw new Pl3PredictionError(
          'LOTTERYMCP_PL3_INSUFFICIENT_SNAPSHOT_DATA',
          `创建 snapshot 需要 ${input.last} 条记录，当前只有 ${boundaries.length} 条符合质量要求。`,
        )
      }
      afterPeriod = boundaries[0]!.period
      fromPeriod = boundaries.at(-1)!.period
    }

    const conditions: string[] = []
    const parameters: number[] = []
    if (fromPeriod) {
      conditions.push('period_num >= ?')
      parameters.push(toPeriodNumber(fromPeriod))
    }
    if (afterPeriod) {
      conditions.push('period_num <= ?')
      parameters.push(toPeriodNumber(afterPeriod))
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const conflicts = this.database.prepare(
      `SELECT period FROM draws ${where ? `${where} AND` : 'WHERE'} status = 'conflict' ORDER BY period_num`,
    ).all(...parameters) as Array<{ period: string }>
    if (conflicts.length > 0) {
      throw new Pl3PredictionError(
        'LOTTERYMCP_PL3_DATA_CONFLICT',
        `数据快照范围存在 ${conflicts.length} 个未解决冲突。`,
        { periods: conflicts.map((item) => item.period) },
      )
    }

    if (!allowSingleSource) {
      const singleSource = this.database.prepare(
        `SELECT period FROM draws ${where ? `${where} AND` : 'WHERE'} status = 'single_source' ORDER BY period_num`,
      ).all(...parameters) as Array<{ period: string }>
      if (singleSource.length > 0) {
        throw new Pl3PredictionError(
          'LOTTERYMCP_PL3_SINGLE_SOURCE_DATA',
          `数据快照范围存在 ${singleSource.length} 条单来源记录。`,
          { periods: singleSource.map((item) => item.period) },
        )
      }
    }

    const rows = this.database.prepare(`
      SELECT period, selected_observation_id AS observation_id, draw_date, numbers, status
      FROM draws
      ${where ? `${where} AND` : 'WHERE'} status IN (${allowSingleSource ? `'confirmed', 'single_source'` : `'confirmed'`})
      ORDER BY period_num ASC
    `).all(...parameters) as Array<{
      period: string
      observation_id: number
      draw_date: string
      numbers: string
      status: Exclude<Pl3DrawStatus, 'conflict'>
    }>
    if (rows.length === 0) throw new Error('没有可用于创建排列3数据快照的记录。')

    const dataHash = sha256(canonicalize(rows.map((row) => ({
      period: row.period,
      drawDate: row.draw_date,
      numbers: row.numbers,
      observationId: row.observation_id,
      status: row.status,
    }))))
    const snapshotId = sha256(canonicalize({
      schemaVersion: 1,
      dataHash,
      fromPeriod: rows[0]!.period,
      afterPeriod: rows.at(-1)!.period,
      observations: rows.map((row) => row.observation_id),
    }))
    const createdAt = new Date().toISOString()
    const confirmedCount = rows.filter((row) => row.status === 'confirmed').length
    const singleSourceCount = rows.length - confirmedCount
    const quality = allowSingleSource ? 'allow-single-source' : 'confirmed'

    this.database.transaction(() => {
      this.database.prepare(`
        INSERT OR IGNORE INTO dataset_snapshots(
          snapshot_id, from_period, after_period, record_count, data_hash, code_commit,
          quality, confirmed_count, single_source_count, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        snapshotId,
        rows[0]!.period,
        rows.at(-1)!.period,
        rows.length,
        dataHash,
        input.codeCommit || null,
        quality,
        confirmedCount,
        singleSourceCount,
        createdAt,
      )
      const insert = this.database.prepare(`
        INSERT OR IGNORE INTO dataset_snapshot_draws(snapshot_id, period, observation_id, draw_status, ordinal)
        VALUES (?, ?, ?, ?, ?)
      `)
      rows.forEach((row, ordinal) => insert.run(snapshotId, row.period, row.observation_id, row.status, ordinal))
    })()
    return this.getDatasetSnapshot(snapshotId)!
  }

  listDatasetSnapshots(query: { page?: number; limit?: number } = {}) {
    const page = Math.max(1, Math.floor(Number(query.page) || 1))
    const limit = Math.max(1, Math.min(100, Math.floor(Number(query.limit) || 20)))
    return (this.database.prepare(`
      SELECT * FROM dataset_snapshots ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(limit, (page - 1) * limit) as any[]).map((row) => this.toDatasetSnapshot(row))
  }

  getDatasetSnapshot(snapshotId: string): Pl3DatasetSnapshot | null {
    const row = this.database.prepare(
      'SELECT * FROM dataset_snapshots WHERE snapshot_id = ?',
    ).get(snapshotId) as any
    return row ? this.toDatasetSnapshot(row) : null
  }

  private toDatasetSnapshot(row: any): Pl3DatasetSnapshot {
    return {
      snapshotId: String(row.snapshot_id),
      fromPeriod: String(row.from_period),
      afterPeriod: String(row.after_period),
      recordCount: Number(row.record_count),
      dataHash: String(row.data_hash),
      codeCommit: row.code_commit == null ? null : String(row.code_commit),
      createdAt: String(row.created_at),
      quality: row.quality,
      confirmedCount: Number(row.confirmed_count),
      singleSourceCount: Number(row.single_source_count),
    }
  }

  getDatasetSnapshotRecords(snapshotId: string, afterPeriod?: string): Pl3StoredDrawRecord[] {
    const snapshot = this.getDatasetSnapshot(snapshotId)
    if (!snapshot) throw new Error(`排列3数据 snapshot 不存在: ${snapshotId}`)
    const parameters: Array<string | number> = [snapshotId]
    const cutoff = afterPeriod ? toPeriodNumber(afterPeriod) : null
    if (afterPeriod && cutoff! > toPeriodNumber(snapshot.afterPeriod)) {
      throw new Error(`afterPeriod ${afterPeriod} 超出 snapshot 截止期号 ${snapshot.afterPeriod}。`)
    }
    if (cutoff !== null) parameters.push(cutoff)
    const rows = this.database.prepare(`
      SELECT o.id, o.period, o.period_num, o.draw_date, o.d1, o.d2, o.d3, o.numbers,
             o.provider, o.source_url, o.last_observed_at, sd.draw_status
      FROM dataset_snapshot_draws sd
      JOIN draw_observations o ON o.id = sd.observation_id
      WHERE sd.snapshot_id = ? ${cutoff === null ? '' : 'AND o.period_num <= ?'}
      ORDER BY sd.ordinal ASC
    `).all(...parameters) as any[]
    return rows.map((row) => ({
      lotteryType: PL3_LOTTERY_TYPE,
      period: String(row.period),
      drawDate: String(row.draw_date),
      numbers: String(row.numbers),
      numbersList: [Number(row.d1), Number(row.d2), Number(row.d3)],
      status: row.draw_status,
      observationId: Number(row.id),
      provider: String(row.provider),
      ...(row.source_url ? { sourceUrl: String(row.source_url) } : {}),
      observedAt: String(row.last_observed_at),
    }))
  }

  verifyDatasetSnapshot(snapshotId: string): Pl3DatasetSnapshotVerification {
    const snapshot = this.getDatasetSnapshot(snapshotId)
    if (!snapshot) throw new Error(`排列3数据 snapshot 不存在: ${snapshotId}`)
    const records = this.getDatasetSnapshotRecords(snapshotId)
    const actualDataHash = sha256(canonicalize(records.map((record) => ({
      period: record.period,
      drawDate: record.drawDate,
      numbers: record.numbers,
      observationId: record.observationId,
      status: record.status,
    }))))
    return {
      snapshotId,
      valid: records.length === snapshot.recordCount && actualDataHash === snapshot.dataHash,
      expectedRecordCount: snapshot.recordCount,
      actualRecordCount: records.length,
      expectedDataHash: snapshot.dataHash,
      actualDataHash,
    }
  }

  getFeatureSnapshot(featureSnapshotId: string): Pl3FeatureSnapshotStorageRecord | null {
    if (this.getSchemaVersion() < 2) {
      throw new Error('排列3数据库尚未应用 M002，请先运行 data migrate --apply。')
    }
    const row = this.database.prepare(
      'SELECT * FROM feature_snapshots WHERE feature_snapshot_id = ?',
    ).get(featureSnapshotId) as any
    return row ? {
      featureSnapshotId: String(row.feature_snapshot_id),
      datasetSnapshotId: String(row.dataset_snapshot_id),
      afterPeriod: String(row.after_period),
      featureVersion: String(row.feature_version),
      windowsJson: String(row.windows_json),
      windowConfigHash: String(row.window_config_hash),
      payloadGzip: Buffer.from(row.payload_gzip),
      payloadHash: String(row.payload_hash),
      codeCommit: row.code_commit == null ? null : String(row.code_commit),
      createdAt: String(row.created_at),
    } : null
  }

  saveFeatureSnapshot(input: Pl3FeatureSnapshotStorageRecord) {
    if (this.getSchemaVersion() < 2) {
      throw new Error('排列3数据库尚未应用 M002，请先运行 data migrate --apply。')
    }
    this.database.prepare(`
      INSERT OR IGNORE INTO feature_snapshots(
        feature_snapshot_id, dataset_snapshot_id, after_period, feature_version,
        windows_json, window_config_hash, payload_gzip, payload_hash, code_commit, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.featureSnapshotId,
      input.datasetSnapshotId,
      input.afterPeriod,
      input.featureVersion,
      input.windowsJson,
      input.windowConfigHash,
      input.payloadGzip,
      input.payloadHash,
      input.codeCommit,
      input.createdAt,
    )
    return this.getFeatureSnapshot(input.featureSnapshotId)!
  }

  registerExperiment(input: Omit<Pl3ExperimentStorageRecord, 'status' | 'reportPath' | 'reportHash' | 'errorMessage' | 'createdAt' | 'updatedAt'>) {
    if (this.getSchemaVersion() < 2) throw new Error('排列3数据库尚未应用 M002。')
    const now = new Date().toISOString()
    this.database.prepare(`
      INSERT OR IGNORE INTO experiments(
        experiment_id, schema_version, name, mode, research_batch_id, dataset_snapshot_id,
        feature_version, spec_json, spec_hash, code_commit, random_seed, status,
        report_path, report_hash, error_message, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'registered', NULL, NULL, NULL, ?, ?)
    `).run(
      input.experimentId,
      input.schemaVersion,
      input.name,
      input.mode,
      input.researchBatchId,
      input.datasetSnapshotId,
      input.featureVersion,
      input.specJson,
      input.specHash,
      input.codeCommit,
      input.randomSeed,
      now,
      now,
    )
    const stored = this.getExperiment(input.experimentId)!
    if (stored.specHash !== input.specHash || stored.codeCommit !== input.codeCommit) {
      throw new Error(`experimentId ${input.experimentId} 已绑定不同 spec。`)
    }
    return stored
  }

  private toExperiment(row: any): Pl3ExperimentStorageRecord {
    return {
      experimentId: String(row.experiment_id),
      schemaVersion: Number(row.schema_version),
      name: String(row.name),
      mode: row.mode,
      researchBatchId: String(row.research_batch_id),
      datasetSnapshotId: String(row.dataset_snapshot_id),
      featureVersion: String(row.feature_version),
      specJson: String(row.spec_json),
      specHash: String(row.spec_hash),
      codeCommit: String(row.code_commit),
      randomSeed: Number(row.random_seed),
      status: row.status,
      reportPath: row.report_path == null ? null : String(row.report_path),
      reportHash: row.report_hash == null ? null : String(row.report_hash),
      errorMessage: row.error_message == null ? null : String(row.error_message),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }
  }

  getExperiment(experimentId: string): Pl3ExperimentStorageRecord | null {
    if (this.getSchemaVersion() < 2) throw new Error('排列3数据库尚未应用 M002。')
    const row = this.database.prepare('SELECT * FROM experiments WHERE experiment_id = ?').get(experimentId)
    return row ? this.toExperiment(row) : null
  }

  listExperiments(query: { page?: number; limit?: number; status?: Pl3ExperimentStatus } = {}) {
    if (this.getSchemaVersion() < 2) throw new Error('排列3数据库尚未应用 M002。')
    const page = Math.max(1, Math.floor(Number(query.page) || 1))
    const limit = Math.max(1, Math.min(100, Math.floor(Number(query.limit) || 20)))
    const rows = query.status
      ? this.database.prepare(`
          SELECT * FROM experiments WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?
        `).all(query.status, limit, (page - 1) * limit)
      : this.database.prepare(`
          SELECT * FROM experiments ORDER BY created_at DESC LIMIT ? OFFSET ?
        `).all(limit, (page - 1) * limit)
    return (rows as any[]).map((row) => this.toExperiment(row))
  }

  updateExperimentStatus(
    experimentId: string,
    status: Pl3ExperimentStatus,
    input: { expected?: readonly Pl3ExperimentStatus[]; errorMessage?: string | null } = {},
  ) {
    const current = this.getExperiment(experimentId)
    if (!current) throw new Error(`排列3实验不存在: ${experimentId}`)
    if (input.expected && !input.expected.includes(current.status)) {
      throw new Error(`实验 ${experimentId} 当前状态 ${current.status}，不能切换为 ${status}。`)
    }
    this.database.prepare(`
      UPDATE experiments SET status = ?, error_message = ?, updated_at = ? WHERE experiment_id = ?
    `).run(status, input.errorMessage ?? null, new Date().toISOString(), experimentId)
    return this.getExperiment(experimentId)!
  }

  saveExperimentFold(input: Pl3ExperimentFoldStorageRecord) {
    const existing = this.database.prepare(`
      SELECT status FROM experiment_folds
      WHERE experiment_id = ? AND fold_level = ? AND fold_index = ?
    `).get(input.experimentId, input.foldLevel, input.foldIndex) as { status: string } | undefined
    if (existing?.status === 'complete') {
      throw new Error(`已完成实验折不可覆盖: ${input.foldLevel}/${input.foldIndex}`)
    }
    this.database.prepare(`
      INSERT INTO experiment_folds(
        experiment_id, fold_level, fold_index, train_from_period, train_to_period,
        test_from_period, test_to_period, status, selected_params_json, metrics_json,
        result_path, result_hash, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(experiment_id, fold_level, fold_index) DO UPDATE SET
        train_from_period = excluded.train_from_period,
        train_to_period = excluded.train_to_period,
        test_from_period = excluded.test_from_period,
        test_to_period = excluded.test_to_period,
        status = excluded.status,
        selected_params_json = excluded.selected_params_json,
        metrics_json = excluded.metrics_json,
        result_path = excluded.result_path,
        result_hash = excluded.result_hash,
        started_at = excluded.started_at,
        completed_at = excluded.completed_at
    `).run(
      input.experimentId,
      input.foldLevel,
      input.foldIndex,
      input.trainFromPeriod,
      input.trainToPeriod,
      input.testFromPeriod,
      input.testToPeriod,
      input.status,
      input.selectedParamsJson,
      input.metricsJson,
      input.resultPath,
      input.resultHash,
      input.startedAt,
      input.completedAt,
    )
  }

  listExperimentFolds(experimentId: string, foldLevel?: Pl3ExperimentFoldStorageRecord['foldLevel']) {
    const rows = foldLevel
      ? this.database.prepare(`
          SELECT * FROM experiment_folds WHERE experiment_id = ? AND fold_level = ? ORDER BY fold_index
        `).all(experimentId, foldLevel)
      : this.database.prepare(`
          SELECT * FROM experiment_folds WHERE experiment_id = ? ORDER BY fold_level, fold_index
        `).all(experimentId)
    return (rows as any[]).map((row): Pl3ExperimentFoldStorageRecord => ({
      experimentId: String(row.experiment_id),
      foldLevel: row.fold_level,
      foldIndex: Number(row.fold_index),
      trainFromPeriod: String(row.train_from_period),
      trainToPeriod: String(row.train_to_period),
      testFromPeriod: String(row.test_from_period),
      testToPeriod: String(row.test_to_period),
      status: row.status,
      selectedParamsJson: row.selected_params_json == null ? null : String(row.selected_params_json),
      metricsJson: row.metrics_json == null ? null : String(row.metrics_json),
      resultPath: row.result_path == null ? null : String(row.result_path),
      resultHash: row.result_hash == null ? null : String(row.result_hash),
      startedAt: row.started_at == null ? null : String(row.started_at),
      completedAt: row.completed_at == null ? null : String(row.completed_at),
    }))
  }

  replaceExperimentMetrics(input: {
    experimentId: string
    foldLevel: string
    foldIndex: number
    modelId: string
    metrics: Array<{ name: string; role: 'primary' | 'secondary' | 'exploratory'; segment?: string; value: number; sampleCount: number }>
  }) {
    const fold = this.database.prepare(`
      SELECT status FROM experiment_folds
      WHERE experiment_id = ? AND fold_level = ? AND fold_index = ?
    `).get(input.experimentId, input.foldLevel, input.foldIndex) as { status: string } | undefined
    if (fold?.status === 'complete') {
      throw new Error(`已完成实验折的指标不可覆盖: ${input.foldLevel}/${input.foldIndex}`)
    }
    this.database.transaction(() => {
      this.database.prepare(`
        DELETE FROM experiment_metrics
        WHERE experiment_id = ? AND fold_level = ? AND fold_index = ? AND model_id = ?
      `).run(input.experimentId, input.foldLevel, input.foldIndex, input.modelId)
      const insert = this.database.prepare(`
        INSERT INTO experiment_metrics(
          experiment_id, fold_level, fold_index, model_id, metric_name,
          metric_role, segment, value, sample_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      input.metrics.forEach((metric) => insert.run(
        input.experimentId,
        input.foldLevel,
        input.foldIndex,
        input.modelId,
        metric.name,
        metric.role,
        metric.segment || 'all',
        metric.value,
        metric.sampleCount,
      ))
    })()
  }

  getExperimentMetrics(experimentId: string) {
    return this.database.prepare(`
      SELECT * FROM experiment_metrics WHERE experiment_id = ?
      ORDER BY fold_level, fold_index, model_id, metric_name
    `).all(experimentId)
  }

  acquireRuntimeLock(lockName: string, ownerId: string, leaseMs = 120_000) {
    const now = Date.now()
    const acquiredAt = new Date(now).toISOString()
    const expiresAt = new Date(now + leaseMs).toISOString()
    return this.database.transaction(() => {
      this.database.prepare('DELETE FROM runtime_locks WHERE expires_at <= ?').run(acquiredAt)
      const result = this.database.prepare(`
        INSERT OR IGNORE INTO runtime_locks(lock_name, owner_id, owner_pid, acquired_at, expires_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(lockName, ownerId, process.pid, acquiredAt, expiresAt)
      return result.changes === 1
    })()
  }

  renewRuntimeLock(lockName: string, ownerId: string, leaseMs = 120_000) {
    const result = this.database.prepare(`
      UPDATE runtime_locks SET expires_at = ? WHERE lock_name = ? AND owner_id = ?
    `).run(new Date(Date.now() + leaseMs).toISOString(), lockName, ownerId)
    if (result.changes !== 1) throw new Error(`实验运行锁 ${lockName} 已丢失。`)
  }

  releaseRuntimeLock(lockName: string, ownerId: string) {
    this.database.prepare('DELETE FROM runtime_locks WHERE lock_name = ? AND owner_id = ?').run(lockName, ownerId)
  }

  listRuntimeLocks() {
    return this.database.prepare('SELECT * FROM runtime_locks ORDER BY lock_name').all()
  }

  addExperimentAudit(experimentId: string, action: string, status: string, details: unknown = {}) {
    this.database.prepare(`
      INSERT INTO experiment_audit(experiment_id, action, status, details_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(experimentId, action, status, canonicalize(details), new Date().toISOString())
  }

  listExperimentAudit(experimentId: string) {
    return this.database.prepare(`
      SELECT audit_id, action, status, details_json, created_at
      FROM experiment_audit WHERE experiment_id = ? ORDER BY audit_id
    `).all(experimentId)
  }

  setExperimentReport(experimentId: string, reportPath: string, reportHash: string) {
    this.database.prepare(`
      UPDATE experiments SET report_path = ?, report_hash = ?, updated_at = ? WHERE experiment_id = ?
    `).run(reportPath, reportHash, new Date().toISOString(), experimentId)
    return this.getExperiment(experimentId)!
  }

  recordOnlinePredictionRun(input: {
    runId: string
    predictionId?: string | null
    status: 'running' | 'success' | 'failed'
    dataMode: string
    afterPeriod?: string | null
    targetPeriod?: string | null
    reportPath?: string | null
    reportHash?: string | null
    errorMessage?: string | null
    startedAt?: string
    completedAt?: string | null
  }) {
    if (this.getSchemaVersion() < 3) throw new Error('排列3数据库尚未应用 M003。')
    const startedAt = input.startedAt || new Date().toISOString()
    this.database.prepare(`
      INSERT INTO online_prediction_runs(
        run_id, prediction_id, status, data_mode, after_period, target_period,
        report_path, report_hash, error_message, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id) DO UPDATE SET
        prediction_id = excluded.prediction_id,
        status = excluded.status,
        data_mode = excluded.data_mode,
        after_period = excluded.after_period,
        target_period = excluded.target_period,
        report_path = excluded.report_path,
        report_hash = excluded.report_hash,
        error_message = excluded.error_message,
        completed_at = excluded.completed_at
    `).run(
      input.runId,
      input.predictionId || null,
      input.status,
      input.dataMode,
      input.afterPeriod || null,
      input.targetPeriod || null,
      input.reportPath || null,
      input.reportHash || null,
      input.errorMessage || null,
      startedAt,
      input.completedAt || null,
    )
    return this.getOnlinePredictionRun(input.runId)!
  }

  getOnlinePredictionRun(runId: string): Pl3OnlinePredictionRun | null {
    if (this.getSchemaVersion() < 3) throw new Error('排列3数据库尚未应用 M003。')
    const row = this.database.prepare('SELECT * FROM online_prediction_runs WHERE run_id = ?').get(runId) as any
    return row ? this.toOnlinePredictionRun(row) : null
  }

  listOnlinePredictionRuns(query: { limit?: number } = {}) {
    if (this.getSchemaVersion() < 3) throw new Error('排列3数据库尚未应用 M003。')
    const limit = Math.max(1, Math.min(100, Math.floor(Number(query.limit) || 20)))
    return (this.database.prepare(`
      SELECT * FROM online_prediction_runs ORDER BY started_at DESC LIMIT ?
    `).all(limit) as any[]).map((row) => this.toOnlinePredictionRun(row))
  }

  private toOnlinePredictionRun(row: any): Pl3OnlinePredictionRun {
    return {
      runId: String(row.run_id),
      predictionId: row.prediction_id == null ? null : String(row.prediction_id),
      status: row.status,
      dataMode: String(row.data_mode),
      afterPeriod: row.after_period == null ? null : String(row.after_period),
      targetPeriod: row.target_period == null ? null : String(row.target_period),
      reportPath: row.report_path == null ? null : String(row.report_path),
      reportHash: row.report_hash == null ? null : String(row.report_hash),
      errorMessage: row.error_message == null ? null : String(row.error_message),
      startedAt: String(row.started_at),
      completedAt: row.completed_at == null ? null : String(row.completed_at),
    }
  }

  recordOperationalEvent(input: {
    level: Pl3OperationalEventLevel
    eventType: string
    message: string
    details?: Record<string, unknown>
  }) {
    if (this.getSchemaVersion() < 3) throw new Error('排列3数据库尚未应用 M003。')
    const result = this.database.prepare(`
      INSERT INTO operational_events(level, event_type, message, details_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      input.level,
      input.eventType,
      input.message,
      canonicalize(input.details || {}),
      new Date().toISOString(),
    )
    return Number(result.lastInsertRowid)
  }

  listOperationalEvents(query: { limit?: number } = {}): Pl3OperationalEvent[] {
    if (this.getSchemaVersion() < 3) throw new Error('排列3数据库尚未应用 M003。')
    const limit = Math.max(1, Math.min(200, Math.floor(Number(query.limit) || 50)))
    return (this.database.prepare(`
      SELECT * FROM operational_events ORDER BY event_id DESC LIMIT ?
    `).all(limit) as any[]).map((row) => ({
      eventId: Number(row.event_id),
      level: row.level,
      eventType: String(row.event_type),
      message: String(row.message),
      details: JSON.parse(String(row.details_json || '{}')),
      createdAt: String(row.created_at),
    }))
  }

  recordNotificationDelivery(input: {
    channel: string
    dedupeKey: string
    status: 'success' | 'failed'
    target?: string | null
    messageHash: string
    errorMessage?: string | null
  }) {
    if (this.getSchemaVersion() < 3) throw new Error('排列3数据库尚未应用 M003。')
    this.database.prepare(`
      INSERT INTO notification_deliveries(
        channel, dedupe_key, status, target, message_hash, error_message, delivered_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(channel, dedupe_key) DO UPDATE SET
        status = excluded.status,
        target = excluded.target,
        message_hash = excluded.message_hash,
        error_message = excluded.error_message,
        delivered_at = excluded.delivered_at
    `).run(
      input.channel,
      input.dedupeKey,
      input.status,
      input.target || null,
      input.messageHash,
      input.errorMessage || null,
      new Date().toISOString(),
    )
  }

  listNotificationDeliveries(query: { limit?: number } = {}): Pl3NotificationDelivery[] {
    if (this.getSchemaVersion() < 3) throw new Error('排列3数据库尚未应用 M003。')
    const limit = Math.max(1, Math.min(100, Math.floor(Number(query.limit) || 20)))
    return (this.database.prepare(`
      SELECT * FROM notification_deliveries ORDER BY delivery_id DESC LIMIT ?
    `).all(limit) as any[]).map((row) => ({
      deliveryId: Number(row.delivery_id),
      channel: String(row.channel),
      dedupeKey: String(row.dedupe_key),
      status: row.status,
      target: row.target == null ? null : String(row.target),
      messageHash: String(row.message_hash),
      errorMessage: row.error_message == null ? null : String(row.error_message),
      deliveredAt: String(row.delivered_at),
    }))
  }

  importLegacyPredictions(predictions: readonly Record<string, unknown>[]) {
    const now = new Date().toISOString()
    return this.database.transaction(() => {
      let imported = 0
      const insert = this.database.prepare(`
        INSERT OR IGNORE INTO legacy_predictions(prediction_id, payload_json, imported_at)
        VALUES (?, ?, ?)
      `)
      for (const prediction of predictions) {
        const predictionId = String(prediction.predictionId || '').trim()
        if (!predictionId) throw new Error('旧预测账本包含缺少 predictionId 的记录。')
        const result = insert.run(predictionId, JSON.stringify(prediction), now)
        imported += result.changes
      }
      return imported
    })()
  }
}

export const resolvePl3DatabasePath = (dataDir = DEFAULT_DATA_DIR) =>
  path.join(path.resolve(dataDir || DEFAULT_DATA_DIR), PL3_DATABASE_FILENAME)

export const hasPl3Database = (dataDir = DEFAULT_DATA_DIR) => existsSync(resolvePl3DatabasePath(dataDir))

export const openPl3Store = (options: {
  dataDir?: string
  databasePath?: string
  readonly?: boolean
  fileMustExist?: boolean
  maintenance?: boolean
} = {}) => new Pl3Store(
  options.databasePath || resolvePl3DatabasePath(options.dataDir),
  {
    readonly: options.readonly,
    fileMustExist: options.fileMustExist,
    maintenance: options.maintenance,
  },
)

const readLegacyHistory = async (historyPath: string) => {
  if (!existsSync(historyPath)) return []
  const parsed = JSON.parse(await readFile(historyPath, 'utf8'))
  const records = Array.isArray(parsed) ? parsed : parsed?.records
  if (!Array.isArray(records)) throw new Error(`旧排列3缓存格式无效: ${historyPath}`)
  return normalizePl3Records(records as Pl3SourceRecord[])
}

const readLegacyLedger = async (ledgerPath: string): Promise<Pl3PredictionLedger> => {
  if (!existsSync(ledgerPath)) return { version: 1, predictions: [] }
  const parsed = JSON.parse(await readFile(ledgerPath, 'utf8'))
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.predictions)) {
    throw new Error(`旧排列3预测账本格式无效: ${ledgerPath}`)
  }
  return parsed as Pl3PredictionLedger
}

export const previewLegacyPl3Migration = async (dataDir = DEFAULT_DATA_DIR): Promise<Pl3LegacyMigrationPreview> => {
  const resolvedDataDir = path.resolve(dataDir || DEFAULT_DATA_DIR)
  const databasePath = resolvePl3DatabasePath(resolvedDataDir)
  const historyPath = path.join(resolvedDataDir, 'pl3.json')
  const ledgerPath = path.join(resolvedDataDir, 'pl3-predictions.json')
  const records = await readLegacyHistory(historyPath)
  const ledger = await readLegacyLedger(ledgerPath)
  return {
    dataDir: resolvedDataDir,
    databasePath,
    historyPath,
    ledgerPath,
    databaseExists: existsSync(databasePath),
    historyExists: existsSync(historyPath),
    ledgerExists: existsSync(ledgerPath),
    recordCount: records.length,
    latestPeriod: records.at(-1)?.period || null,
    oldestPeriod: records[0]?.period || null,
    recordHash: records.length > 0 ? sha256(canonicalize(records)) : null,
    predictionCount: ledger.predictions.length,
    predictionIds: ledger.predictions.map((item) => item.predictionId).sort(),
  }
}

const withMaintenanceLock = async <T>(dataDir: string, task: () => Promise<T>) => {
  await mkdir(dataDir, { recursive: true })
  const lockPath = path.join(dataDir, 'pl3.sqlite.maintenance.lock')
  let handle
  try {
    try {
      handle = await open(lockPath, 'wx')
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error
      const info = await stat(lockPath)
      if (Date.now() - info.mtimeMs <= MAINTENANCE_LOCK_MAX_AGE_MS) {
        throw new Error('排列3数据库正在执行维护操作，请稍后重试。')
      }
      await unlink(lockPath)
      handle = await open(lockPath, 'wx')
    }
    await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }))
    return await task()
  } finally {
    await handle?.close().catch(() => undefined)
    await unlink(lockPath).catch(() => undefined)
  }
}

const backupLegacyFile = async (filePath: string, backupDir: string, stamp: string) => {
  if (!existsSync(filePath)) return null
  await mkdir(backupDir, { recursive: true })
  const extension = path.extname(filePath)
  const basename = path.basename(filePath, extension)
  const backupPath = path.join(backupDir, `${basename}.${stamp}${extension}`)
  await copyFile(filePath, backupPath)
  return backupPath
}

export const applyLegacyPl3Migration = async (dataDir = DEFAULT_DATA_DIR): Promise<Pl3LegacyMigrationResult> => {
  const preview = await previewLegacyPl3Migration(dataDir)
  if (preview.databaseExists) throw new Error(`排列3数据库已存在，拒绝覆盖: ${preview.databasePath}`)
  if (!preview.historyExists) throw new Error(`未找到待迁移的排列3历史缓存: ${preview.historyPath}`)

  return withMaintenanceLock(preview.dataDir, async () => {
    const refreshed = await previewLegacyPl3Migration(preview.dataDir)
    if (refreshed.databaseExists) throw new Error(`排列3数据库已存在，拒绝覆盖: ${refreshed.databasePath}`)
    if (refreshed.recordHash !== preview.recordHash || refreshed.predictionIds.join('|') !== preview.predictionIds.join('|')) {
      throw new Error('迁移预检后旧 JSON 已发生变化，请重新执行 dry-run。')
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupDir = path.join(preview.dataDir, 'backups')
    const backupPaths = (await Promise.all([
      backupLegacyFile(preview.historyPath, backupDir, stamp),
      backupLegacyFile(preview.ledgerPath, backupDir, stamp),
    ])).filter((item): item is string => Boolean(item))
    const stagingPath = `${preview.databasePath}.migrating-${stamp}`
    let store: Pl3Store | undefined

    try {
      const records = await readLegacyHistory(preview.historyPath)
      const ledger = await readLegacyLedger(preview.ledgerPath)
      store = openPl3Store({ databasePath: stagingPath, maintenance: true })
      const imported = store.importRecords(records, {
        provider: 'legacy-json',
        sourceUrl: preview.historyPath,
        metadata: { migration: 'legacy-json-v1' },
      })
      const importedPredictions = store.importLegacyPredictions(
        ledger.predictions as unknown as Record<string, unknown>[],
      )
      const status = store.getStatus()
      if (status.usableRecords !== preview.recordCount) {
        throw new Error(`迁移记录数不一致: 预期 ${preview.recordCount}，实际 ${status.usableRecords}`)
      }
      if (status.latestPeriod !== preview.latestPeriod) {
        throw new Error(`迁移最新期号不一致: 预期 ${preview.latestPeriod}，实际 ${status.latestPeriod}`)
      }
      if (status.legacyPredictionCount !== preview.predictionCount) {
        throw new Error(`迁移预测数不一致: 预期 ${preview.predictionCount}，实际 ${status.legacyPredictionCount}`)
      }
      store.close()
      store = undefined

      const verification = new Database(stagingPath, { readonly: true, fileMustExist: true })
      try {
        const integrity = verification.pragma('integrity_check', { simple: true })
        if (integrity !== 'ok') throw new Error(`排列3数据库完整性检查失败: ${String(integrity)}`)
        const foreignKeyErrors = verification.pragma('foreign_key_check') as unknown[]
        if (foreignKeyErrors.length > 0) throw new Error('排列3数据库外键检查失败。')
      } finally {
        verification.close()
      }

      await rename(stagingPath, preview.databasePath)
      return {
        ...preview,
        applied: true,
        backupPaths,
        importedObservations: imported.insertedObservations,
        importedPredictions,
      }
    } catch (error) {
      store?.close()
      await unlink(stagingPath).catch(() => undefined)
      throw error
    }
  })
}

export const backupPl3Database = async (dataDir = DEFAULT_DATA_DIR) => {
  const resolvedDataDir = path.resolve(dataDir || DEFAULT_DATA_DIR)
  const databasePath = resolvePl3DatabasePath(resolvedDataDir)
  if (!existsSync(databasePath)) throw new Error(`排列3数据库不存在: ${databasePath}`)
  const backupDir = path.join(resolvedDataDir, 'backups')
  await mkdir(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = path.join(backupDir, `pl3.${stamp}.sqlite`)
  const database = new Database(databasePath, { readonly: true, fileMustExist: true })
  try {
    await database.backup(backupPath)
  } finally {
    database.close()
  }

  const verification = new Database(backupPath, { readonly: true, fileMustExist: true })
  try {
    const integrity = verification.pragma('integrity_check', { simple: true })
    if (integrity !== 'ok') throw new Error(`数据库备份完整性检查失败: ${String(integrity)}`)
  } finally {
    verification.close()
  }

  const backups = (await readdir(backupDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /^pl3\..+\.sqlite$/.test(entry.name))
    .map((entry) => path.join(backupDir, entry.name))
    .sort()
  const expired = backups.slice(0, Math.max(0, backups.length - 5))
  await Promise.all(expired.map((filePath) => unlink(filePath).catch(() => undefined)))
  return { databasePath, backupPath, removedBackups: expired }
}

export const previewPl3SchemaMigration = (dataDir = DEFAULT_DATA_DIR): Pl3SchemaMigrationPreview => {
  const databasePath = resolvePl3DatabasePath(dataDir)
  if (!existsSync(databasePath)) throw new Error(`排列3数据库不存在: ${databasePath}`)
  const database = new Database(databasePath, { readonly: true, fileMustExist: true })
  try {
    const rows = database.prepare(
      'SELECT version, checksum FROM schema_migrations ORDER BY version',
    ).all() as Array<{ version: number; checksum: string }>
    const currentVersion = rows.at(-1)?.version || 0
    const migration001 = rows.find((row) => row.version === 1)
    if (!migration001 || migration001.checksum !== migration001Checksum) {
      throw new Error('排列3数据库 M001 校验和不匹配。')
    }
    const migration002 = rows.find((row) => row.version === 2)
    if (migration002 && migration002.checksum !== migration002Checksum) {
      throw new Error('排列3数据库 M002 校验和不匹配。')
    }
    const migration003 = rows.find((row) => row.version === 3)
    if (migration003 && migration003.checksum !== migration003Checksum) {
      throw new Error('排列3数据库 M003 校验和不匹配。')
    }
    if (currentVersion > PL3_DATABASE_LATEST_SCHEMA_VERSION) {
      throw new Error(`数据库 schema ${currentVersion} 高于当前程序支持的 ${PL3_DATABASE_LATEST_SCHEMA_VERSION}。`)
    }
    return {
      databasePath,
      currentVersion,
      targetVersion: PL3_DATABASE_LATEST_SCHEMA_VERSION,
      migrationRequired: currentVersion < PL3_DATABASE_LATEST_SCHEMA_VERSION,
      migrations: schemaMigrations
        .filter((migration) => migration.version > currentVersion)
        .map(({ version, name, checksum }) => ({ version, name, checksum })),
    }
  } finally {
    database.close()
  }
}

export const applyPl3SchemaMigration = async (dataDir = DEFAULT_DATA_DIR) => {
  const resolvedDataDir = path.resolve(dataDir || DEFAULT_DATA_DIR)
  const preview = previewPl3SchemaMigration(resolvedDataDir)
  if (!preview.migrationRequired) return { ...preview, applied: false as const, backupPath: null, replacedPath: null }

  return withMaintenanceLock(resolvedDataDir, async () => {
    const refreshed = previewPl3SchemaMigration(resolvedDataDir)
    if (!refreshed.migrationRequired) {
      return { ...refreshed, applied: false as const, backupPath: null, replacedPath: null }
    }
    const backup = await backupPl3Database(resolvedDataDir)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const stagingPath = `${refreshed.databasePath}.schema-${refreshed.targetVersion}-${stamp}`
    const replacedPath = `${refreshed.databasePath}.schema-${refreshed.currentVersion}-${stamp}`
    await copyFile(backup.backupPath, stagingPath)
    let staging: Database.Database | undefined

    try {
      staging = new Database(stagingPath, { fileMustExist: true })
      staging.pragma('foreign_keys = ON')
      staging.transaction(() => {
        for (const migration of schemaMigrations.filter((item) => item.version > refreshed.currentVersion)) {
          staging!.exec(migration.sql)
          staging!.prepare(
            'INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
          ).run(migration.version, migration.name, migration.checksum, new Date().toISOString())
        }
      })()
      const integrity = staging.pragma('integrity_check', { simple: true })
      if (integrity !== 'ok') throw new Error(`schema 迁移完整性检查失败: ${String(integrity)}`)
      const foreignKeyErrors = staging.pragma('foreign_key_check') as unknown[]
      if (foreignKeyErrors.length > 0) throw new Error('schema 迁移外键检查失败。')
      staging.close()
      staging = undefined

      const current = new Database(refreshed.databasePath, { fileMustExist: true })
      try {
        current.pragma('busy_timeout = 2000')
        current.exec('BEGIN EXCLUSIVE')
        current.exec('ROLLBACK')
      } catch (error) {
        throw new Error(`排列3数据库仍在使用，无法应用 M002: ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        current.close()
      }

      await rename(refreshed.databasePath, replacedPath)
      const movedSidecars: Array<{ source: string; destination: string }> = []
      try {
        for (const suffix of ['-wal', '-shm']) {
          const source = `${refreshed.databasePath}${suffix}`
          if (!existsSync(source)) continue
          const destination = `${replacedPath}${suffix}`
          await rename(source, destination)
          movedSidecars.push({ source, destination })
        }
        await rename(stagingPath, refreshed.databasePath)
      } catch (error) {
        if (!existsSync(refreshed.databasePath) && existsSync(replacedPath)) {
          await rename(replacedPath, refreshed.databasePath)
          for (const sidecar of movedSidecars.reverse()) {
            if (existsSync(sidecar.destination)) await rename(sidecar.destination, sidecar.source)
          }
        }
        throw error
      }
      return {
        ...refreshed,
        currentVersion: refreshed.targetVersion,
        migrationRequired: false,
        migrations: [],
        applied: true as const,
        backupPath: backup.backupPath,
        replacedPath,
      }
    } catch (error) {
      staging?.close()
      await unlink(stagingPath).catch(() => undefined)
      throw error
    }
  })
}

export const restorePl3Database = async (dataDir: string, backupPath: string) => {
  const resolvedDataDir = path.resolve(dataDir || DEFAULT_DATA_DIR)
  const resolvedBackupPath = path.resolve(backupPath)
  if (!existsSync(resolvedBackupPath)) throw new Error(`数据库备份不存在: ${resolvedBackupPath}`)
  return withMaintenanceLock(resolvedDataDir, async () => {
    const verification = new Database(resolvedBackupPath, { readonly: true, fileMustExist: true })
    try {
      verification.pragma('foreign_keys = ON')
      const integrity = verification.pragma('integrity_check', { simple: true })
      if (integrity !== 'ok') throw new Error(`数据库备份完整性检查失败: ${String(integrity)}`)
      const foreignKeyErrors = verification.pragma('foreign_key_check') as unknown[]
      if (foreignKeyErrors.length > 0) throw new Error('数据库备份外键检查失败。')
    } finally {
      verification.close()
    }
    const databasePath = resolvePl3DatabasePath(resolvedDataDir)
    let safetyBackupPath: string | null = null
    if (existsSync(databasePath)) {
      safetyBackupPath = (await backupPl3Database(resolvedDataDir)).backupPath
      const current = new Database(databasePath, { fileMustExist: true })
      try {
        current.pragma('busy_timeout = 2000')
        current.exec('BEGIN EXCLUSIVE')
        current.exec('ROLLBACK')
      } catch (error) {
        throw new Error(`排列3数据库仍在使用，无法恢复: ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        current.close()
      }
    }
    const stagingPath = `${databasePath}.restore-${Date.now()}`
    await copyFile(resolvedBackupPath, stagingPath)
    const replacedPath = existsSync(databasePath) ? `${databasePath}.replaced-${Date.now()}` : null
    const sidecars = ['-wal', '-shm']
    const movedSidecars: Array<{ source: string; destination: string }> = []
    try {
      if (replacedPath) {
        await rename(databasePath, replacedPath)
        for (const suffix of sidecars) {
          const source = `${databasePath}${suffix}`
          if (!existsSync(source)) continue
          const destination = `${replacedPath}${suffix}`
          await rename(source, destination)
          movedSidecars.push({ source, destination })
        }
      }
      await rename(stagingPath, databasePath)
      return { databasePath, replacedPath, safetyBackupPath }
    } catch (error) {
      await unlink(stagingPath).catch(() => undefined)
      if (replacedPath && existsSync(replacedPath) && !existsSync(databasePath)) {
        await rename(replacedPath, databasePath)
        for (const sidecar of movedSidecars.reverse()) {
          if (existsSync(sidecar.destination)) await rename(sidecar.destination, sidecar.source)
        }
      }
      throw error
    }
  })
}
