import assert from 'node:assert/strict'
import { existsSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const coreEntryUrl = pathToFileURL(path.join(repoRoot, 'packages', 'core', 'dist', 'index.js')).href

const draw = (index) => {
  const date = new Date(Date.UTC(2010, 0, 1 + index)).toISOString().slice(0, 10)
  const numbersList = [index % 10, Math.floor(index / 3) % 10, Math.floor(index / 7) % 10]
  return {
    lotteryType: 'pl3',
    period: String(100000 + index),
    drawDate: date,
    numbers: numbersList.join(','),
    numbersList,
  }
}

const createConfirmedSnapshot = async (count) => {
  const core = await import(coreEntryUrl)
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'lotterymcp-features-'))
  const records = Array.from({ length: count }, (_, index) => draw(index))
  let store = core.openPl3Store({ dataDir })
  store.importRecords(records, { provider: 'lottery-gov-cn' })
  store.importRecords(records, { provider: 'zhcw' })
  const dataset = store.createDatasetSnapshot({ last: count, codeCommit: 'fixture' })
  store.close()
  await core.applyPl3SchemaMigration(dataDir)
  store = core.openPl3Store({ dataDir, fileMustExist: true })
  return { core, dataDir, records, dataset, store }
}

test('schema migrations are explicit, backed up, and idempotent through M003', async () => {
  const core = await import(coreEntryUrl)
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'lotterymcp-m002-'))
  const store = core.openPl3Store({ dataDir })
  store.importRecords([draw(0)], { provider: 'file-import' })
  store.close()

  const preview = core.previewPl3SchemaMigration(dataDir)
  assert.equal(preview.currentVersion, 1)
  assert.equal(preview.targetVersion, 3)
  assert.equal(preview.migrationRequired, true)
  assert.equal(preview.migrations[0].name, 'p3-experiment-foundation')
  assert.equal(preview.migrations[1].name, 'p3-online-operations')

  const applied = await core.applyPl3SchemaMigration(dataDir)
  assert.equal(applied.applied, true)
  assert.equal(applied.currentVersion, 3)
  assert.equal(existsSync(applied.backupPath), true)
  assert.equal(existsSync(applied.replacedPath), true)
  const migratedStore = core.openPl3Store({ dataDir })
  try {
    migratedStore.recordOnlinePredictionRun({
      runId: 'run-fixture',
      status: 'success',
      dataMode: 'official',
      predictionId: 'prediction-fixture',
    })
    migratedStore.recordOperationalEvent({
      level: 'info',
      eventType: 'test',
      message: 'M003 works',
    })
    migratedStore.recordNotificationDelivery({
      channel: 'enterprise-wechat',
      dedupeKey: 'prediction-fixture',
      status: 'success',
      messageHash: 'hash-fixture',
    })
    assert.equal(migratedStore.listOnlinePredictionRuns()[0].runId, 'run-fixture')
    assert.equal(migratedStore.listOperationalEvents()[0].eventType, 'test')
    assert.equal(migratedStore.listNotificationDeliveries()[0].dedupeKey, 'prediction-fixture')
  } finally {
    migratedStore.close()
  }
  const repeated = await core.applyPl3SchemaMigration(dataDir)
  assert.equal(repeated.applied, false)
  assert.equal(repeated.currentVersion, 3)
})

test('As-of feature snapshots are deterministic and isolated from future database changes', async () => {
  const { core, records, dataset, store } = await createConfirmedSnapshot(120)
  try {
    const input = {
      datasetSnapshotId: dataset.snapshotId,
      afterPeriod: records[99].period,
      windows: [10, 30, 200],
      codeCommit: 'feature-fixture',
    }
    const first = core.createPl3FeatureSnapshot(store, input)
    assert.equal(first.payload.recordCount, 100)
    assert.equal(first.payload.windowFeatures['10'].availableCount, 10)
    assert.equal(first.payload.windowFeatures['200'].availableCount, 100)
    assert.equal(first.payload.windowFeatures['200'].previousAvailableCount, 0)
    assert.deepEqual(first.payload.windowFeatures['10'].positionCounts[0], Array(10).fill(1))
    assert.equal(first.payload.windowFeatures['10'].positionEntropy[0], Number(Math.log(10).toFixed(12)))
    assert.equal(first.payload.windowFeatures['10'].positionConcentration[0], 0.1)
    assert.equal(first.payload.currentOmission.length, 3)
    assert.equal(first.payload.currentOmission[0].length, 10)

    const repeated = core.createPl3FeatureSnapshot(store, input)
    assert.equal(repeated.featureSnapshotId, first.featureSnapshotId)
    assert.equal(repeated.payloadHash, first.payloadHash)
    assert.equal(repeated.createdAt, first.createdAt)

    const future = draw(5000)
    store.importRecords([future], { provider: 'lottery-gov-cn' })
    store.importRecords([future], { provider: 'zhcw' })
    const afterFutureImport = core.createPl3FeatureSnapshot(store, input)
    assert.equal(afterFutureImport.payloadHash, first.payloadHash)
    assert.deepEqual(afterFutureImport.payload, first.payload)

    const decoded = core.getPl3FeatureSnapshot(store, first.featureSnapshotId)
    assert.equal(decoded.payloadHash, first.payloadHash)
    assert.deepEqual(decoded.payload, first.payload)
  } finally {
    store.close()
  }
})
