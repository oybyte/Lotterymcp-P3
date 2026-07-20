import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const coreEntryUrl = pathToFileURL(path.join(repoRoot, 'packages', 'core', 'dist', 'index.js')).href

const draw = (index) => {
  const date = new Date(Date.UTC(2000, 0, 1 + index)).toISOString().slice(0, 10)
  const numbersList = [index % 10, Math.floor(index / 5) % 10, Math.floor(index / 11) % 10]
  return {
    lotteryType: 'pl3',
    period: String(200000 + index),
    drawDate: date,
    numbers: numbersList.join(','),
    numbersList,
  }
}

const createExperimentStore = async (count) => {
  const core = await import(coreEntryUrl)
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'lotterymcp-experiment-'))
  const records = Array.from({ length: count }, (_, index) => draw(index))
  let store = core.openPl3Store({ dataDir })
  store.importRecords(records, { provider: 'lottery-gov-cn' })
  store.importRecords(records, { provider: 'zhcw' })
  const dataset = store.createDatasetSnapshot({ last: count, codeCommit: 'dataset-fixture' })
  store.close()
  await core.applyPl3SchemaMigration(dataDir)
  store = core.openPl3Store({ dataDir, fileMustExist: true })
  return { core, dataDir, records, dataset, store }
}

const specFor = (datasetSnapshotId, overrides = {}) => ({
  name: 'P3 deterministic baseline',
  hypothesis: '基线用于验证实验框架，不声明未来预测优势。',
  mode: 'confirmatory',
  datasetSnapshotId,
  models: ['uniform-theory'],
  bootstrap: { blockLength: 30, resamples: 10000 },
  ...overrides,
})

test('experiment specs normalize search spaces and reject ROI as a primary metric', async () => {
  const core = await import(coreEntryUrl)
  const normalized = core.normalizePl3ExperimentSpec({
    ...specFor('snapshot-fixture'),
    models: [{
      modelId: 'weighted-frequency-v1',
      params: { historyWindow: 200 },
      searchSpace: { historyWindow: [500, 100, 200, 100] },
    }],
  })
  assert.deepEqual(normalized.models[0].searchSpace.historyWindow, [100, 200, 500])
  assert.throws(
    () => core.normalizePl3ExperimentSpec({ ...specFor('snapshot-fixture'), primaryMetric: 'roi' }),
    /主指标固定/,
  )
})

test('experiment IDs are stable and frozen results stay hidden until one-time evaluation', async () => {
  const { core, dataDir, dataset, store } = await createExperimentStore(2000)
  try {
    const spec = specFor(dataset.snapshotId, { models: ['uniform-theory', 'random-monte-carlo'] })
    const first = core.createPl3Experiment(store, spec, 'commit-fixture')
    const repeated = core.createPl3Experiment(store, spec, 'commit-fixture')
    assert.equal(repeated.experiment.experimentId, first.experiment.experimentId)
    assert.equal(repeated.experiment.createdAt, first.experiment.createdAt)
    const changedCommit = core.createPl3Experiment(store, spec, 'commit-fixture-2')
    assert.notEqual(changedCommit.experiment.experimentId, first.experiment.experimentId)

    const development = await core.runPl3Experiment(store, first.experiment.experimentId)
    assert.equal(development.report.frozenVisible, false)
    assert.equal('frozen' in development.report.summary, false)
    assert.equal(store.getExperiment(first.experiment.experimentId).status, 'development_complete')

    const frozen = await core.evaluatePl3ExperimentFrozen(store, first.experiment.experimentId)
    assert.equal(frozen.report.frozenVisible, true)
    assert.equal(frozen.report.summary.frozen.length, 2)
    assert.equal(store.getExperiment(first.experiment.experimentId).status, 'frozen_evaluated')
    const frozenFolds = store.listExperimentFolds(first.experiment.experimentId, 'frozen')
    assert.equal(frozenFolds.length, 20)
    const firstFold = JSON.parse(readFileSync(path.join(dataDir, frozenFolds[0].resultPath), 'utf8'))
    assert.equal(firstFold.bootstrap['random-monte-carlo'].samples, 10000)
    assert.equal(firstFold.cases.every((item) => item.afterPeriod < item.targetPeriod), true)

    const regenerated = await core.generatePl3ExperimentReport(store, first.experiment.experimentId)
    assert.equal(regenerated.reportHash, frozen.reportHash)
    await assert.rejects(
      () => core.evaluatePl3ExperimentFrozen(store, first.experiment.experimentId),
      /不能评估冻结区|已经尝试/,
    )
  } finally {
    store.close()
  }
})

test('interrupted experiments resume after the last complete fold and retain nested selections', async () => {
  const { core, dataset, store } = await createExperimentStore(2100)
  try {
    const created = core.createPl3Experiment(store, specFor(dataset.snapshotId, {
      mode: 'development',
      models: ['uniform-theory'],
    }), 'resume-fixture')
    const originalSave = store.saveExperimentFold.bind(store)
    let interrupted = false
    store.saveExperimentFold = (fold) => {
      originalSave(fold)
      if (!interrupted && fold.foldLevel === 'outer' && fold.status === 'complete') {
        interrupted = true
        throw new Error('fixture interruption after fold 0')
      }
    }
    await assert.rejects(
      () => core.runPl3Experiment(store, created.experiment.experimentId),
      /fixture interruption/,
    )
    assert.equal(store.getExperiment(created.experiment.experimentId).status, 'interrupted')
    assert.deepEqual(
      store.listExperimentFolds(created.experiment.experimentId, 'outer')
        .filter((fold) => fold.status === 'complete').map((fold) => fold.foldIndex),
      [0],
    )

    store.saveExperimentFold = originalSave
    await core.runPl3Experiment(store, created.experiment.experimentId)
    assert.equal(store.getExperiment(created.experiment.experimentId).status, 'development_complete')
    assert.deepEqual(
      store.listExperimentFolds(created.experiment.experimentId, 'outer').map((fold) => fold.foldIndex),
      [0, 1],
    )
    assert.deepEqual(
      store.listExperimentFolds(created.experiment.experimentId, 'inner').map((fold) => fold.foldIndex),
      [0, 1],
    )
    const completeFold = store.listExperimentFolds(created.experiment.experimentId, 'outer')[0]
    assert.throws(() => store.saveExperimentFold(completeFold), /不可覆盖/)
  } finally {
    store.close()
  }
})

test('runtime experiment locks reject concurrent owners and allow lease handoff', async () => {
  const { store } = await createExperimentStore(2000)
  try {
    assert.equal(store.acquireRuntimeLock('experiment-runner', 'owner-a', 120000), true)
    assert.equal(store.acquireRuntimeLock('experiment-runner', 'owner-b', 120000), false)
    store.renewRuntimeLock('experiment-runner', 'owner-a', 120000)
    store.releaseRuntimeLock('experiment-runner', 'owner-a')
    assert.equal(store.acquireRuntimeLock('experiment-runner', 'owner-b', 120000), true)
  } finally {
    store.close()
  }
})
