import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const coreEntryUrl = pathToFileURL(path.join(repoRoot, 'packages', 'core', 'dist', 'index.js')).href

const buildRecords = (count, offset = 0) =>
  Array.from({ length: count }, (_, index) => {
    const sequence = offset + index
    const year = 26 + Math.floor(sequence / 300)
    const issue = (sequence % 300) + 1
    return {
      lotteryType: 'pl3',
      period: `${year}${String(issue).padStart(3, '0')}`,
      drawDate: `2026-01-${String((index % 28) + 1).padStart(2, '0')}`,
      numbers: `${sequence % 10},${(sequence * 3 + 1) % 10},${(sequence * 7 + 2) % 10}`,
    }
  })

test('pl3 ticket pools contain all direct, group3, and group6 states with averaged group scores', async () => {
  const { scorePl3TicketPools } = await import(coreEntryUrl)
  const pools = scorePl3TicketPools(buildRecords(120))

  assert.equal(pools.direct.length, 1000)
  assert.equal(pools.group3.length, 90)
  assert.equal(pools.group6.length, 120)

  const directScores = new Map(pools.direct.map((ticket) => [ticket.display, ticket.score]))
  const group3 = pools.group3.find((ticket) => ticket.pairDigit === 1 && ticket.singleDigit === 2)
  const expectedGroup3 = (directScores.get('112') + directScores.get('121') + directScores.get('211')) / 3
  assert.ok(Math.abs(group3.score - Number(expectedGroup3.toFixed(6))) < 0.000001)

  const group6 = pools.group6.find((ticket) => ticket.display === '123')
  const expectedGroup6 =
    ['123', '132', '213', '231', '312', '321'].reduce((sum, value) => sum + directScores.get(value), 0) / 6
  assert.ok(Math.abs(group6.score - Number(expectedGroup6.toFixed(6))) < 0.000001)

  const direct = pools.direct.find((ticket) => ticket.display === '123')
  assert.ok(direct.scoreComposition)
  const { leadingFeature, ...directFeatures } = direct.scoreComposition
  const weightKeys = Object.keys(directFeatures)
  assert.equal(weightKeys.length, 6)
  assert.ok(
    weightKeys.every((key) =>
      [
        'positionFrequency',
        'digitFrequency',
        'sumFrequency',
        'oddEvenFrequency',
        'spanFrequency',
        'numberTypeFrequency',
      ].includes(key),
    ),
  )
  assert.ok(weightKeys.includes(leadingFeature))
  assert.ok(Math.abs(Object.values(directFeatures).reduce((sum, value) => sum + value, 0) - direct.score) < 0.001)

  const group3Composition = group3.scoreComposition
  assert.ok(group3Composition)
  assert.ok(
    Math.abs(
      Object.values(group3Composition)
        .filter((value) => typeof value === 'number')
        .reduce((sum, value) => sum + value, 0) - group3.score,
    ) < 0.001,
  )
  assert.equal(group3Composition.leadingFeature, group6.scoreComposition?.leadingFeature)
})

test('pl3 prediction applies deterministic mixed allocation and stable data-based ids', async () => {
  const { predictPl3 } = await import(coreEntryUrl)
  const records = buildRecords(200)
  const first = predictPl3(records, { tickets: 10, playType: 'mixed', generatedAt: '2026-01-01T00:00:00.000Z' })
  const second = predictPl3(records, { tickets: 10, playType: 'mixed', generatedAt: '2026-02-01T00:00:00.000Z' })

  assert.equal(first.predictionId, second.predictionId)
  const corrected = structuredClone(records)
  corrected[50].numbers = '9,9,9'
  assert.notEqual(first.predictionId, predictPl3(corrected, { tickets: 10, playType: 'mixed' }).predictionId)
  assert.equal(first.tickets.filter((ticket) => ticket.playType === 'direct').length, 4)
  assert.equal(first.tickets.filter((ticket) => ticket.playType === 'group3').length, 4)
  assert.equal(first.tickets.filter((ticket) => ticket.playType === 'group6').length, 2)
  assert.equal(new Set(first.tickets.map((ticket) => `${ticket.playType}:${ticket.display}`)).size, 10)
  assert.equal(first.model.scoreIsProbability, false)
})

test('pl3 prediction enforces data boundaries and reports the 100-record backtest edge', async () => {
  const { Pl3PredictionError, predictPl3 } = await import(coreEntryUrl)

  assert.throws(
    () => predictPl3(buildRecords(99)),
    (error) => error instanceof Pl3PredictionError && error.code === 'LOTTERYMCP_PL3_INSUFFICIENT_DATA',
  )
  assert.equal(predictPl3(buildRecords(100)).backtest.status, 'insufficient_data')
  assert.equal(predictPl3(buildRecords(101)).backtest.testCount, 1)
  assert.equal(predictPl3(buildRecords(200)).backtest.testCount, 100)
})

test('walk-forward cases do not use records from their future', async () => {
  const { backtestPl3 } = await import(coreEntryUrl)
  const records = buildRecords(140)
  const original = backtestPl3(records, { tickets: 5, playType: 'mixed' })
  const changed = structuredClone(records)
  changed[130].numbers = '9,9,9'
  const mutated = backtestPl3(changed, { tickets: 5, playType: 'mixed' })

  const targetPeriod = records[120].period
  assert.equal(
    original.cases.find((item) => item.targetPeriod === targetPeriod).ticketSignature,
    mutated.cases.find((item) => item.targetPeriod === targetPeriod).ticketSignature,
  )
})

test('backtest exposes theoretical baselines and cost-return metrics', async () => {
  const { backtestPl3 } = await import(coreEntryUrl)
  const result = backtestPl3(buildRecords(110), { tickets: 10, playType: 'mixed' })

  assert.deepEqual(result.baseline.perTicketHitProbability, {
    direct: 0.001,
    group3: 0.003,
    group6: 0.006,
  })
  assert.equal(result.totalCost, 200)
  assert.equal(typeof result.totalReturn, 'number')
  assert.equal(typeof result.roi, 'number')
})

test('prediction ledger upserts stable ids and settles against the next draw', async () => {
  const { getPl3PredictionLedgerSummary, predictPl3, settlePl3Predictions, upsertPl3Prediction } = await import(
    coreEntryUrl
  )
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'lotterymcp-ledger-'))
  const ledgerPath = path.join(tempDir, 'pl3-predictions.json')
  const records = buildRecords(100)
  const prediction = predictPl3(records, { tickets: 10 })

  await upsertPl3Prediction(ledgerPath, prediction)
  await upsertPl3Prediction(ledgerPath, { ...prediction, generatedAt: '2026-03-01T00:00:00.000Z' })
  assert.deepEqual(await getPl3PredictionLedgerSummary(ledgerPath), {
    total: 1,
    pending: 1,
    provisional: 0,
    confirmed: 0,
    disputed: 0,
  })

  const next = { ...buildRecords(1, 100)[0], status: 'confirmed' }
  const settlement = await settlePl3Predictions(ledgerPath, [...records, next])
  assert.equal(settlement.settledCount, 1)
  assert.deepEqual(await getPl3PredictionLedgerSummary(ledgerPath), {
    total: 1,
    pending: 0,
    provisional: 0,
    confirmed: 1,
    disputed: 0,
  })
  const saved = JSON.parse(readFileSync(ledgerPath, 'utf8'))
  assert.equal(saved.predictions[0].settlement.status, 'confirmed')
  assert.equal(saved.predictions[0].settlement.targetPeriod, next.period)
})

test('prediction ledger uses provisional settlement for single-source draws', async () => {
  const { getPl3PredictionLedgerSummary, predictPl3, settlePl3Predictions, upsertPl3Prediction } = await import(
    coreEntryUrl
  )
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'lotterymcp-ledger-provisional-'))
  const ledgerPath = path.join(tempDir, 'pl3-predictions.json')
  const records = buildRecords(100)
  const prediction = predictPl3(records, { tickets: 10 })
  await upsertPl3Prediction(ledgerPath, prediction)

  const next = { ...buildRecords(1, 100)[0], status: 'single_source' }
  await settlePl3Predictions(ledgerPath, [...records, next])
  assert.deepEqual(await getPl3PredictionLedgerSummary(ledgerPath), {
    total: 1,
    pending: 0,
    provisional: 1,
    confirmed: 0,
    disputed: 0,
  })
  const saved = JSON.parse(readFileSync(ledgerPath, 'utf8'))
  assert.equal(saved.predictions[0].settlement.providerStatus, 'single_source')
  assert.equal(saved.predictions[0].settlement.revisions.length, 1)
})

test('prediction annotates training data status from source records', async () => {
  const { predictPl3 } = await import(coreEntryUrl)
  const records = buildRecords(120).map((record, index) => ({
    ...record,
    status: index % 2 === 0 ? 'confirmed' : 'single_source',
  }))
  const prediction = predictPl3(records, { periods: 100, tickets: 5 })

  assert.deepEqual(prediction.training.dataStatus, {
    confirmedRecords: 50,
    singleSourceRecords: 50,
    conflictRecords: 0,
    unclassifiedRecords: 0,
    dualSourceCoverage: 0.5,
  })
  assert.equal(prediction.predictionId.includes(':'), false)
})

test('prediction marks training data status as unannotated when no status is available', async () => {
  const { predictPl3 } = await import(coreEntryUrl)
  const prediction = predictPl3(buildRecords(110), { tickets: 5 })

  assert.deepEqual(prediction.training.dataStatus, {
    confirmedRecords: 0,
    singleSourceRecords: 0,
    conflictRecords: 0,
    unclassifiedRecords: 110,
    dualSourceCoverage: null,
  })
})

test('confirmed training window filters single-source records and keeps a distinct stable id', async () => {
  const { predictPl3 } = await import(coreEntryUrl)
  const records = buildRecords(200).map((record, index) => ({
    ...record,
    status: index % 10 === 0 ? 'single_source' : 'confirmed',
  }))

  const mixed = predictPl3(records, { periods: 150, tickets: 5 })
  assert.equal(mixed.query.trainingStatus, 'mixed')
  assert.equal(mixed.training.recordCount, 150)
  assert.equal(mixed.training.dataStatus.confirmedRecords, 135)
  assert.equal(mixed.training.dataStatus.singleSourceRecords, 15)

  const confirmed = predictPl3(records, { periods: 150, tickets: 5, trainingStatus: 'confirmed' })
  assert.equal(confirmed.query.trainingStatus, 'confirmed')
  assert.equal(confirmed.training.recordCount, 150)
  assert.equal(confirmed.training.dataStatus.confirmedRecords, 150)
  assert.equal(confirmed.training.dataStatus.singleSourceRecords, 0)
  assert.notEqual(confirmed.predictionId, mixed.predictionId)
})

test('confirmed training window reports insufficient data when few records are confirmed', async () => {
  const { Pl3PredictionError, predictPl3 } = await import(coreEntryUrl)
  const records = buildRecords(200).map((record, index) => ({
    ...record,
    status: index % 19 === 0 ? 'confirmed' : 'single_source',
  }))
  assert.throws(
    () => predictPl3(records, { periods: 200, tickets: 5, trainingStatus: 'confirmed' }),
    (error) =>
      error instanceof Pl3PredictionError &&
      error.code === 'LOTTERYMCP_PL3_INSUFFICIENT_DATA' &&
      error.details?.trainingStatus === 'confirmed',
  )
})

test('prediction ledger does not settle without the base period and rejects an active lock', async () => {
  const { predictPl3, settlePl3Predictions, upsertPl3Prediction } = await import(coreEntryUrl)
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'lotterymcp-ledger-lock-'))
  const ledgerPath = path.join(tempDir, 'pl3-predictions.json')
  const records = buildRecords(100)
  const prediction = predictPl3(records)
  await upsertPl3Prediction(ledgerPath, prediction)

  const truncated = buildRecords(5, 101)
  const settlement = await settlePl3Predictions(ledgerPath, truncated)
  assert.equal(settlement.settledCount, 0)

  writeFileSync(`${ledgerPath}.lock`, new Date().toISOString(), 'utf8')
  await assert.rejects(
    () => upsertPl3Prediction(ledgerPath, prediction),
    (error) => error.code === 'LOTTERYMCP_PL3_LEDGER_LOCKED',
  )
})
