import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

const rootDir = path.resolve(import.meta.dirname, '..')
const coreEntryUrl = pathToFileURL(path.join(rootDir, 'packages/core/dist/index.js')).href

const record = (period, numbers, drawDate = '2026-07-01') => ({
  lotteryType: 'pl3',
  period,
  drawDate,
  numbers: numbers.join(','),
  numbersList: numbers,
})

test('SQLite truth reconciliation only treats two independent official providers as confirmed', async () => {
  const { openPl3Store } = await import(coreEntryUrl)
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'lotterymcp-store-truth-'))
  const store = openPl3Store({ dataDir })
  try {
    store.importRecords([record('26180', [1, 2, 3])], { provider: 'lottery-gov-cn' })
    assert.equal(store.getStatus().singleSourceRecords, 1)
    assert.equal(store.getStatus().confirmedRecords, 0)
    assert.equal(store.getStatus().dualSourceCoverage, 0)

    store.importRecords([record('26180', [1, 2, 3])], { provider: 'neuxsbot-remote' })
    assert.equal(store.getStatus().singleSourceRecords, 1)
    assert.equal(store.getStatus().confirmedRecords, 0)

    store.importRecords([record('26180', [1, 2, 3])], { provider: 'zhcw' })
    assert.equal(store.getStatus().singleSourceRecords, 0)
    assert.equal(store.getStatus().confirmedRecords, 1)
    assert.equal(store.getStatus().dualSourceCoverage, 1)
    assert.equal(store.getRecords({ limit: 10 })[0].status, 'confirmed')
  } finally {
    store.close()
  }
})

test('getConfidenceByYear groups confirmed and single-source draws per year', async () => {
  const { openPl3Store } = await import(coreEntryUrl)
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'lotterymcp-store-by-year-'))
  const store = openPl3Store({ dataDir })
  try {
    store.importRecords(
      [
        record('26001', [1, 2, 3]),
        record('26002', [4, 5, 6]),
        record('26003', [7, 8, 9]),
        record('25001', [1, 1, 1]),
        record('25002', [2, 2, 2]),
      ],
      { provider: 'lottery-gov-cn' },
    )
    store.importRecords(
      [record('26001', [1, 2, 3]), record('26002', [4, 5, 6]), record('26003', [7, 8, 9]), record('25001', [1, 1, 1])],
      { provider: 'zhcw' },
    )

    const byYear = store.getConfidenceByYear()
    assert.deepEqual(
      byYear.map((row) => row.year),
      ['25', '26'],
    )
    assert.deepEqual(byYear[0], {
      year: '25',
      totalPeriods: 2,
      confirmedRecords: 1,
      singleSourceRecords: 1,
      conflictRecords: 0,
      dualSourceCoverage: 0.5,
    })
    assert.deepEqual(byYear[1], {
      year: '26',
      totalPeriods: 3,
      confirmedRecords: 3,
      singleSourceRecords: 0,
      conflictRecords: 0,
      dualSourceCoverage: 1,
    })
  } finally {
    store.close()
  }
})

test('SQLite conflicts block snapshots and can only be resolved with an audited observation choice', async () => {
  const { openPl3Store } = await import(coreEntryUrl)
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'lotterymcp-store-conflict-'))
  const store = openPl3Store({ dataDir })
  try {
    store.importRecords([record('26180', [1, 2, 3])], { provider: 'lottery-gov-cn' })
    store.importRecords([record('26180', [3, 2, 1])], { provider: 'zhcw' })
    assert.equal(store.getStatus().conflictRecords, 1)
    assert.equal(store.getRecords({ limit: 10 }).length, 0)
    assert.throws(
      () => store.createDatasetSnapshot(),
      (error) => error?.code === 'LOTTERYMCP_PL3_DATA_CONFLICT',
    )

    const conflict = store.getConflicts()[0]
    assert.equal(conflict.observations.length, 2)
    const selected = conflict.observations.find((item) => item.provider === 'lottery-gov-cn')
    const resolved = store.resolveConflict({
      period: '26180',
      observationId: selected.observationId,
      reason: '根据官方原始页面人工确认',
      evidenceUrl: 'https://example.test/evidence',
    })
    assert.deepEqual(resolved.numbersList, [1, 2, 3])
    assert.equal(resolved.status, 'confirmed')
    assert.equal(store.getStatus().conflictRecords, 0)
    assert.equal(store.getStatus().dualSourceCoverage, 0)
    assert.equal(store.createDatasetSnapshot({ codeCommit: 'fixture' }).recordCount, 1)
  } finally {
    store.close()
  }
})

test('legacy migration validates side-by-side, preserves JSON and prediction ids, and activates SQLite', async () => {
  const {
    applyLegacyPl3Migration,
    createOfficialLocalProvider,
    openPl3Store,
    previewLegacyPl3Migration,
    resolvePl3DatabasePath,
  } = await import(coreEntryUrl)
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'lotterymcp-store-migration-'))
  const records = [record('26179', [0, 1, 2], '2026-06-30'), record('26180', [1, 2, 3], '2026-07-01')]
  const historyPath = path.join(dataDir, 'pl3.json')
  const ledgerPath = path.join(dataDir, 'pl3-predictions.json')
  writeFileSync(historyPath, JSON.stringify({ records }), 'utf8')
  writeFileSync(
    ledgerPath,
    JSON.stringify({
      version: 1,
      predictions: [{ predictionId: 'legacy-prediction-001' }],
    }),
    'utf8',
  )

  const preview = await previewLegacyPl3Migration(dataDir)
  assert.equal(preview.databaseExists, false)
  assert.equal(preview.recordCount, 2)
  assert.equal(preview.latestPeriod, '26180')
  assert.deepEqual(preview.predictionIds, ['legacy-prediction-001'])

  const migrated = await applyLegacyPl3Migration(dataDir)
  assert.equal(migrated.importedObservations, 2)
  assert.equal(migrated.importedPredictions, 1)
  assert.equal(existsSync(resolvePl3DatabasePath(dataDir)), true)
  assert.equal(existsSync(historyPath), true)
  assert.equal(existsSync(ledgerPath), true)
  assert.equal(migrated.backupPaths.length, 2)
  migrated.backupPaths.forEach((backupPath) => assert.equal(existsSync(backupPath), true))

  const store = openPl3Store({ dataDir, readonly: true, fileMustExist: true })
  try {
    const status = store.getStatus()
    assert.equal(status.usableRecords, 2)
    assert.equal(status.singleSourceRecords, 2)
    assert.equal(status.legacyPredictionCount, 1)
  } finally {
    store.close()
  }

  const provider = createOfficialLocalProvider({ dataDir, defaultPeriods: '100' })
  const health = await provider.getHealth()
  assert.equal(health.transport, 'local-sqlite')
  const latest = await provider.getLatest({})
  assert.equal(latest.data.period, '26180')
})

test('database restore validates a SQLite backup and preserves the replaced database', async () => {
  const { openPl3Store, resolvePl3DatabasePath, restorePl3Database } = await import(coreEntryUrl)
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'lotterymcp-store-restore-'))
  let store = openPl3Store({ dataDir })
  store.importRecords([record('26180', [1, 2, 3])], { provider: 'file-import' })
  store.close()

  const databasePath = resolvePl3DatabasePath(dataDir)
  const backupPath = path.join(dataDir, 'known-good.sqlite')
  copyFileSync(databasePath, backupPath)

  store = openPl3Store({ dataDir })
  store.importRecords([record('26181', [4, 5, 6], '2026-07-02')], { provider: 'file-import' })
  assert.equal(store.getStatus().usableRecords, 2)
  store.close()

  const restored = await restorePl3Database(dataDir, backupPath)
  assert.ok(restored.replacedPath)
  assert.equal(existsSync(restored.replacedPath), true)
  assert.ok(restored.safetyBackupPath)
  assert.equal(existsSync(restored.safetyBackupPath), true)
  store = openPl3Store({ dataDir, readonly: true, fileMustExist: true })
  try {
    assert.equal(store.getStatus().usableRecords, 1)
    assert.equal(store.getStatus().latestPeriod, '26180')
  } finally {
    store.close()
  }
})

test('dataset snapshots are confirmed-only, stable across commits, and immutable after draw revisions', async () => {
  const { openPl3Store } = await import(coreEntryUrl)
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'lotterymcp-snapshot-'))
  const records = [
    record('26179', [0, 1, 2], '2026-06-30'),
    record('26180', [1, 2, 3], '2026-07-01'),
    record('26181', [4, 5, 6], '2026-07-02'),
  ]
  const store = openPl3Store({ dataDir })
  try {
    store.importRecords(records, { provider: 'lottery-gov-cn' })
    assert.throws(
      () => store.createDatasetSnapshot({ last: 2 }),
      (error) => error?.code === 'LOTTERYMCP_PL3_INSUFFICIENT_SNAPSHOT_DATA',
    )
    store.importRecords(records, { provider: 'zhcw' })
    const first = store.createDatasetSnapshot({ last: 2, codeCommit: 'commit-a' })
    const second = store.createDatasetSnapshot({ last: 2, codeCommit: 'commit-b' })
    assert.equal(first.snapshotId, second.snapshotId)
    assert.equal(first.createdAt, second.createdAt)
    assert.equal(second.codeCommit, 'commit-a')
    assert.equal(first.recordCount, 2)
    assert.equal(first.fromPeriod, '26180')
    assert.equal(first.afterPeriod, '26181')
    assert.equal(store.listDatasetSnapshots().length, 1)
    assert.equal(store.getDatasetSnapshotRecords(first.snapshotId).length, 2)
    assert.equal(store.verifyDatasetSnapshot(first.snapshotId).valid, true)

    store.importRecords([record('26180', [9, 9, 9], '2026-07-01')], { provider: 'zhcw' })
    assert.equal(store.getStatus().conflictRecords, 1)
    assert.equal(store.verifyDatasetSnapshot(first.snapshotId).valid, true)
    assert.deepEqual(
      store.getDatasetSnapshotRecords(first.snapshotId).map((item) => item.numbers),
      ['1,2,3', '4,5,6'],
    )
  } finally {
    store.close()
  }
})

test('conflicts support date/number classification and resolution requires an HTTP evidence URL', async () => {
  const { openPl3Store } = await import(coreEntryUrl)
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'lotterymcp-conflict-filter-'))
  const store = openPl3Store({ dataDir })
  try {
    store.importRecords([record('26179', [1, 2, 3], '2026-07-01')], { provider: 'lottery-gov-cn' })
    store.importRecords([record('26179', [1, 2, 3], '2026-07-02')], { provider: 'zhcw' })
    store.importRecords([record('26180', [1, 2, 3], '2026-07-03')], { provider: 'lottery-gov-cn' })
    store.importRecords([record('26180', [3, 2, 1], '2026-07-03')], { provider: 'zhcw' })
    assert.deepEqual(
      store.getConflicts({ type: 'date' }).map((item) => item.period),
      ['26179'],
    )
    assert.deepEqual(
      store.getConflicts({ type: 'numbers' }).map((item) => item.period),
      ['26180'],
    )
    assert.equal(store.getConflicts({ fromPeriod: '26180' }).length, 1)
    const observationId = store.getConflicts({ type: 'numbers' })[0].observations[0].observationId
    assert.throws(() => store.resolveConflict({ period: '26180', observationId, reason: 'test' }), /证据 URL/)
    assert.throws(
      () =>
        store.resolveConflict({
          period: '26180',
          observationId,
          reason: 'test',
          evidenceUrl: 'file:///tmp/evidence',
        }),
      /http\/https/,
    )
  } finally {
    store.close()
  }
})

test('reconcileHistory re-derives stale single_source draws when the second official source observation already exists', async () => {
  const { openPl3Store } = await import(coreEntryUrl)
  const Database = (await import('better-sqlite3')).default
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'lotterymcp-reconcile-history-'))
  const store = openPl3Store({ dataDir })
  try {
    store.importRecords([record('26179', [1, 2, 3], '2026-07-02')], { provider: 'lottery-gov-cn' })
    store.importRecords([record('26180', [4, 5, 6], '2026-07-03')], { provider: 'lottery-gov-cn' })
    assert.equal(store.getStatus().confirmedRecords, 0)
    assert.equal(store.getStatus().singleSourceRecords, 2)

    const first = store.reconcileHistory()
    assert.deepEqual(first, {
      scannedPeriods: 2,
      upgradedToConfirmed: 0,
      remainingSingleSource: 2,
      remainingConflicts: 0,
    })

    const raw = new Database(path.join(dataDir, 'pl3.sqlite'))
    try {
      raw
        .prepare(
          `
        INSERT INTO draw_observations(period, period_num, draw_date, d1, d2, d3, numbers, provider, first_observed_at, last_observed_at, observation_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `,
        )
        .run(
          '26179',
          26179,
          '2026-07-02',
          1,
          2,
          3,
          '1,2,3',
          'zhcw',
          '2026-07-03T00:00:00.000Z',
          '2026-07-03T00:00:00.000Z',
        )
    } finally {
      raw.close()
    }
    assert.equal(store.getStatus().confirmedRecords, 0)

    const second = store.reconcileHistory()
    assert.equal(second.upgradedToConfirmed, 1)
    assert.equal(second.remainingSingleSource, 1)
    assert.equal(store.getStatus().confirmedRecords, 1)
    assert.equal(store.getStatus().singleSourceRecords, 1)
    assert.equal(store.getRecords({ limit: 10 }).find((item) => item.period === '26179')?.status, 'confirmed')
  } finally {
    store.close()
  }
})

test('SLA evidence verifies a prediction is generated before the target draw is first observed', async () => {
  const { openPl3Store, verifyPl3PredictionSla, writeJsonAtomically } = await import(coreEntryUrl)
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'lotterymcp-sla-'))
  const store = openPl3Store({ dataDir })
  const ledgerPath = path.join(dataDir, 'pl3-predictions.json')
  try {
    store.importRecords([record('26185', [1, 2, 3], '2026-07-08')], { provider: 'lottery-gov-cn' })
    store.importRecords([record('26185', [1, 2, 3], '2026-07-08')], { provider: 'zhcw' })

    const ledger = {
      version: 1,
      predictions: [
        {
          predictionId: 'pred-before',
          afterPeriod: '26184',
          generatedAt: '2026-07-01T00:00:00.000Z',
          settlement: { status: 'confirmed' },
        },
        {
          predictionId: 'pred-unknown-target',
          afterPeriod: '26199',
          generatedAt: '2026-07-01T00:00:00.000Z',
          settlement: { status: 'confirmed' },
        },
      ],
    }
    await writeJsonAtomically(ledgerPath, ledger)

    const summary = await verifyPl3PredictionSla(ledgerPath, (prediction) => store.getPredictionSlaEvidence(prediction))

    assert.equal(summary.total, 2)
    assert.equal(summary.withEvidence, 1)
    assert.equal(summary.verifiedBeforeObservation, 1)
    assert.equal(summary.violated, 0)
    assert.equal(summary.pendingEvidence, 1)

    const item = summary.items.find((entry) => entry.predictionId === 'pred-before')
    assert.ok(item)
    assert.equal(item.targetPeriod, '26185')
    assert.ok(item.firstObservedAt)
    assert.equal(item.predictedBeforeFirstObservation, true)

    const target = store.getPredictionSlaEvidence({ afterPeriod: '26300', generatedAt: '2027-01-01T00:00:00.000Z' })
    assert.equal(target.targetPeriod, null)
    assert.equal(target.predictedBeforeFirstObservation, null)
  } finally {
    store.close()
  }
})
