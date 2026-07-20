import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  PL3_FEATURE_VERSION,
  createPl3FeatureSnapshot,
  type Pl3FeatureSnapshot,
} from './pl3-features.js'
import {
  PL3_MODEL_VERSION,
  scorePl3TicketPools,
  writeJsonAtomically,
  type Pl3Record,
} from './pl3-prediction.js'
import type {
  Pl3ExperimentFoldStorageRecord,
  Pl3ExperimentStatus,
  Pl3ExperimentStorageRecord,
  Pl3Store,
} from './pl3-store.js'

export const PL3_EXPERIMENT_SPEC_VERSION = 1
export type Pl3BaselineModelId = 'uniform-theory' | 'random-monte-carlo' | typeof PL3_MODEL_VERSION
export type Pl3ExperimentMode = 'development' | 'confirmatory'

export type Pl3ExperimentSpecInput = {
  schemaVersion?: 1
  name: string
  hypothesis: string
  mode?: Pl3ExperimentMode
  researchBatchId?: string
  datasetSnapshotId: string
  featureVersion?: typeof PL3_FEATURE_VERSION
  models?: Array<Pl3BaselineModelId | {
    modelId: Pl3BaselineModelId
    params?: Record<string, unknown>
    searchSpace?: Record<string, unknown[]>
  }>
  primaryMetric?: 'normalizedRank.mean'
  secondaryMetrics?: string[]
  exclusionRules?: string[]
  split?: Partial<Pl3ExperimentSplit>
  bootstrap?: Partial<Pl3ExperimentBootstrap>
  randomSeed?: number
  resource?: Partial<Pl3ExperimentResource>
}

export type Pl3ExperimentSplit = {
  minTrain: number
  frozenCount: number
  training: 'expanding'
  innerValidation: number
  innerStep: number
  outerTest: number
  outerStep: number
}

export type Pl3ExperimentBootstrap = {
  blockLength: number
  resamples: number
}

export type Pl3ExperimentResource = {
  maxRuntimeSeconds: number
  maxCpuFraction: number
}

export type Pl3ExperimentSpec = {
  schemaVersion: 1
  name: string
  hypothesis: string
  mode: Pl3ExperimentMode
  researchBatchId: string
  datasetSnapshotId: string
  featureVersion: typeof PL3_FEATURE_VERSION
  models: Array<{
    modelId: Pl3BaselineModelId
    params: Record<string, unknown>
    searchSpace: Record<string, unknown[]>
  }>
  primaryMetric: 'normalizedRank.mean'
  secondaryMetrics: string[]
  exclusionRules: string[]
  split: Pl3ExperimentSplit
  bootstrap: Pl3ExperimentBootstrap
  randomSeed: number
  resource: Pl3ExperimentResource
}

export type Pl3RankedState = {
  number: string
  score: number
  rank: number
}

export type Pl3EvaluationCase = {
  targetPeriod: string
  afterPeriod: string
  actualNumber: string
  modelId: Pl3BaselineModelId
  rank: number
  normalizedRank: number
  reciprocalRank: number
  positionRanks: [number, number, number]
}

export type Pl3ModelMetrics = {
  modelId: Pl3BaselineModelId
  sampleCount: number
  normalizedRank: { mean: number; median: number }
  meanReciprocalRank: number
  coverage: { top10: number; top20: number; top50: number; top100: number }
  positionAccuracy: Array<{ top1: number; top3: number; top5: number }>
}

export type Pl3FoldResult = {
  schemaVersion: 1
  experimentId: string
  foldLevel: 'outer' | 'frozen'
  foldIndex: number
  trainRange: { fromPeriod: string; toPeriod: string; count: number }
  testRange: { fromPeriod: string; toPeriod: string; count: number }
  featureSnapshotIds: string[]
  selectedParams: Record<string, Record<string, unknown>>
  modelMetrics: Pl3ModelMetrics[]
  bootstrap: Record<string, Pl3BootstrapSummary>
  cases: Pl3EvaluationCase[]
}

export type Pl3BootstrapSummary = {
  samples: number
  blockLength: number
  mean: number
  standardDeviation: number
  quantiles: { p025: number; p50: number; p975: number }
}

const DEFAULT_SECONDARY_METRICS = [
  'normalizedRank.median',
  'mrr',
  'top10',
  'top20',
  'top50',
  'top100',
  'position.top1',
  'position.top3',
  'position.top5',
]

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

const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const round = (value: number) => Number(value.toFixed(12))
const mean = (values: readonly number[]) => values.length > 0
  ? values.reduce((total, value) => total + value, 0) / values.length
  : 0
const median = (values: readonly number[]) => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

const normalizeInteger = (value: unknown, fallback: number, minimum: number, maximum: number, name: string) => {
  const parsed = value === undefined ? fallback : Number(value)
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} 必须是 ${minimum}-${maximum} 的整数。`)
  }
  return parsed
}

const normalizePositiveNumber = (value: unknown, fallback: number, maximum: number, name: string) => {
  const parsed = value === undefined ? fallback : Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > maximum) {
    throw new Error(`${name} 必须是 0-${maximum} 的正数。`)
  }
  return parsed
}

export const normalizePl3ExperimentSpec = (input: Pl3ExperimentSpecInput): Pl3ExperimentSpec => {
  if (!input || typeof input !== 'object') throw new Error('排列3实验 spec 必须是对象。')
  const name = String(input.name || '').trim()
  const hypothesis = String(input.hypothesis || '').trim()
  if (!name) throw new Error('排列3实验 spec 缺少 name。')
  if (!hypothesis) throw new Error('排列3实验 spec 缺少 hypothesis。')
  const datasetSnapshotId = String(input.datasetSnapshotId || '').trim()
  if (!datasetSnapshotId) throw new Error('排列3实验 spec 缺少 datasetSnapshotId。')
  const mode = input.mode || 'development'
  if (!['development', 'confirmatory'].includes(mode)) throw new Error(`不支持的实验模式: ${mode}`)
  const allowedModels = new Set<Pl3BaselineModelId>(['uniform-theory', 'random-monte-carlo', PL3_MODEL_VERSION])
  const rawModels = input.models?.length ? input.models : [PL3_MODEL_VERSION]
  const models = rawModels.map((item) => {
    const rawModelId = typeof item === 'string' ? item : item.modelId
    if (!allowedModels.has(rawModelId as Pl3BaselineModelId)) {
      throw new Error(`不支持的排列3实验模型: ${rawModelId}`)
    }
    const modelId = rawModelId as Pl3BaselineModelId
    const params = typeof item === 'string' ? {} : { ...(item.params || {}) }
    const searchSpace = typeof item === 'string' ? {} : { ...(item.searchSpace || {}) }
    if (modelId === PL3_MODEL_VERSION) {
      params.historyWindow = normalizeInteger(params.historyWindow, 200, 100, 1000, 'historyWindow')
      const rawHistoryWindows = searchSpace.historyWindow || []
      if (!Array.isArray(rawHistoryWindows)) throw new Error('searchSpace.historyWindow 必须是数组。')
      searchSpace.historyWindow = [...new Set(rawHistoryWindows.map((value) =>
        normalizeInteger(value, 200, 100, 1000, 'searchSpace.historyWindow'),
      ))].sort((left, right) => Number(left) - Number(right))
      const unknownKeys = Object.keys(searchSpace).filter((key) => key !== 'historyWindow')
      if (unknownKeys.length > 0) throw new Error(`weighted-frequency-v1 不支持搜索参数: ${unknownKeys.join(', ')}`)
    } else if (Object.keys(searchSpace).length > 0) {
      throw new Error(`基线模型 ${modelId} 不接受参数搜索空间。`)
    }
    return { modelId, params, searchSpace }
  }).sort((left, right) => left.modelId.localeCompare(right.modelId))
  if (new Set(models.map((item) => item.modelId)).size !== models.length) {
    throw new Error('同一 experiment spec 不能重复声明模型。')
  }
  if (input.primaryMetric && input.primaryMetric !== 'normalizedRank.mean') {
    throw new Error('排列3实验主指标固定为 normalizedRank.mean。')
  }

  return {
    schemaVersion: 1,
    name,
    hypothesis,
    mode,
    researchBatchId: String(input.researchBatchId || 'default').trim() || 'default',
    datasetSnapshotId,
    featureVersion: input.featureVersion || PL3_FEATURE_VERSION,
    models,
    primaryMetric: 'normalizedRank.mean',
    secondaryMetrics: [...new Set(input.secondaryMetrics || DEFAULT_SECONDARY_METRICS)].sort(),
    exclusionRules: [...new Set((input.exclusionRules || []).map((rule) => String(rule).trim()).filter(Boolean))].sort(),
    split: {
      minTrain: normalizeInteger(input.split?.minTrain, 1000, 1000, 10000, 'split.minTrain'),
      frozenCount: normalizeInteger(input.split?.frozenCount, 1000, 1000, 10000, 'split.frozenCount'),
      training: 'expanding',
      innerValidation: normalizeInteger(input.split?.innerValidation, 50, 1, 1000, 'split.innerValidation'),
      innerStep: normalizeInteger(input.split?.innerStep, 50, 1, 1000, 'split.innerStep'),
      outerTest: normalizeInteger(input.split?.outerTest, 50, 1, 1000, 'split.outerTest'),
      outerStep: normalizeInteger(input.split?.outerStep, 50, 1, 1000, 'split.outerStep'),
    },
    bootstrap: {
      blockLength: normalizeInteger(input.bootstrap?.blockLength, 30, 1, 1000, 'bootstrap.blockLength'),
      resamples: normalizeInteger(input.bootstrap?.resamples, 10000, 10000, 100000, 'bootstrap.resamples'),
    },
    randomSeed: normalizeInteger(input.randomSeed, 20260717, 0, 0x7fffffff, 'randomSeed'),
    resource: {
      maxRuntimeSeconds: normalizeInteger(input.resource?.maxRuntimeSeconds, 7200, 60, 86400, 'resource.maxRuntimeSeconds'),
      maxCpuFraction: normalizePositiveNumber(input.resource?.maxCpuFraction, 0.5, 1, 'resource.maxCpuFraction'),
    },
  }
}

export const createPl3Experiment = (
  store: Pl3Store,
  input: Pl3ExperimentSpecInput,
  codeCommit: string,
) => {
  const spec = normalizePl3ExperimentSpec(input)
  const snapshot = store.getDatasetSnapshot(spec.datasetSnapshotId)
  if (!snapshot) throw new Error(`排列3数据 snapshot 不存在: ${spec.datasetSnapshotId}`)
  if (snapshot.singleSourceCount > 0) throw new Error('正式实验不接受 single-source dataset snapshot。')
  const minimumRecords = spec.split.minTrain + spec.split.frozenCount
  if (snapshot.recordCount < minimumRecords) {
    throw new Error(`实验至少需要 ${minimumRecords} 条 confirmed 记录，当前为 ${snapshot.recordCount}。`)
  }
  const normalizedCommit = String(codeCommit || '').trim()
  if (!normalizedCommit) throw new Error('创建实验必须记录代码 commit。')
  const specJson = canonicalize(spec)
  const specHash = sha256(specJson)
  const experimentId = sha256(canonicalize({
    schemaVersion: 1,
    specHash,
    datasetHash: snapshot.dataHash,
    codeCommit: normalizedCommit,
  }))
  const stored = store.registerExperiment({
    experimentId,
    schemaVersion: 1,
    name: spec.name,
    mode: spec.mode,
    researchBatchId: spec.researchBatchId,
    datasetSnapshotId: spec.datasetSnapshotId,
    featureVersion: spec.featureVersion,
    specJson,
    specHash,
    codeCommit: normalizedCommit,
    randomSeed: spec.randomSeed,
  })
  store.addExperimentAudit(experimentId, 'create', 'complete', { specHash })
  return { experiment: stored, spec }
}

const seededRandom = (seed: number) => {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ value >>> 15, value | 1)
    value ^= value + Math.imul(value ^ value >>> 7, value | 61)
    return ((value ^ value >>> 14) >>> 0) / 4294967296
  }
}

const stringSeed = (base: number, value: string) => {
  const hash = createHash('sha256').update(`${base}:${value}`).digest()
  return hash.readUInt32LE(0)
}

const allNumbers = () => Array.from({ length: 1000 }, (_, value) => String(value).padStart(3, '0'))
const NUMBER_STATES = allNumbers()

type Pl3ModelConfig = Pl3ExperimentSpec['models'][number]

const modelCandidates = (model: Pl3ModelConfig): Pl3ModelConfig[] => {
  if (model.modelId !== PL3_MODEL_VERSION) return [{ ...model, params: { ...model.params }, searchSpace: {} }]
  const windows = [
    Number(model.params.historyWindow),
    ...(model.searchSpace.historyWindow || []).map(Number),
  ]
  return [...new Set(windows)].sort((left, right) => left - right).map((historyWindow) => ({
    modelId: model.modelId,
    params: { ...model.params, historyWindow },
    searchSpace: {},
  }))
}

const parameterSimplicity = (model: Pl3ModelConfig) => {
  if (model.modelId !== PL3_MODEL_VERSION) return 0
  return Number(model.params.historyWindow || 200)
}

const rankModel = (
  model: Pl3ModelConfig,
  training: readonly Pl3Record[],
  targetPeriod: string,
  randomSeed: number,
): Pl3RankedState[] => {
  if (model.modelId === 'uniform-theory') {
    return NUMBER_STATES.map((number, index) => ({ number, score: 0, rank: index + 1 }))
  }
  if (model.modelId === 'random-monte-carlo') {
    const random = seededRandom(stringSeed(randomSeed, targetPeriod))
    const shuffled = [...NUMBER_STATES]
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const selected = Math.floor(random() * (index + 1))
      ;[shuffled[index], shuffled[selected]] = [shuffled[selected]!, shuffled[index]!]
    }
    return shuffled.map((number, index) => ({ number, score: round(1 - index / 1000), rank: index + 1 }))
  }
  const historyWindow = Number(model.params.historyWindow || 200)
  return scorePl3TicketPools(training.slice(-historyWindow)).direct.map((ticket) => ({
    number: ticket.display,
    score: ticket.score,
    rank: ticket.rank,
  }))
}

const positionRanks = (states: readonly Pl3RankedState[], actual: readonly number[]): [number, number, number] => {
  const ranks = [0, 1, 2].map((position) => {
    const digitScores = Array.from({ length: 10 }, (_, digit) => ({ digit, score: 0 }))
    states.forEach((state) => {
      digitScores[Number(state.number[position])]!.score += state.score
    })
    digitScores.sort((left, right) => right.score - left.score || left.digit - right.digit)
    return digitScores.findIndex((item) => item.digit === actual[position]) + 1
  })
  return ranks as [number, number, number]
}

const calculateModelMetrics = (modelId: Pl3BaselineModelId, cases: readonly Pl3EvaluationCase[]): Pl3ModelMetrics => {
  const ranks = cases.map((item) => item.normalizedRank)
  return {
    modelId,
    sampleCount: cases.length,
    normalizedRank: { mean: round(mean(ranks)), median: round(median(ranks)) },
    meanReciprocalRank: round(mean(cases.map((item) => item.reciprocalRank))),
    coverage: {
      top10: round(cases.filter((item) => item.rank <= 10).length / Math.max(cases.length, 1)),
      top20: round(cases.filter((item) => item.rank <= 20).length / Math.max(cases.length, 1)),
      top50: round(cases.filter((item) => item.rank <= 50).length / Math.max(cases.length, 1)),
      top100: round(cases.filter((item) => item.rank <= 100).length / Math.max(cases.length, 1)),
    },
    positionAccuracy: [0, 1, 2].map((position) => ({
      top1: round(cases.filter((item) => item.positionRanks[position]! <= 1).length / Math.max(cases.length, 1)),
      top3: round(cases.filter((item) => item.positionRanks[position]! <= 3).length / Math.max(cases.length, 1)),
      top5: round(cases.filter((item) => item.positionRanks[position]! <= 5).length / Math.max(cases.length, 1)),
    })),
  }
}

const quantile = (sorted: readonly number[], probability: number) => {
  if (sorted.length === 0) return 0
  const index = (sorted.length - 1) * probability
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (index - lower)
}

const blockBootstrap = (
  values: readonly number[],
  resamples: number,
  blockLength: number,
  seed: number,
): Pl3BootstrapSummary => {
  if (values.length === 0) {
    return { samples: resamples, blockLength, mean: 0, standardDeviation: 0, quantiles: { p025: 0, p50: 0, p975: 0 } }
  }
  const random = seededRandom(seed)
  const samples: number[] = []
  const effectiveBlock = Math.min(blockLength, values.length)
  for (let sample = 0; sample < resamples; sample += 1) {
    const selected: number[] = []
    while (selected.length < values.length) {
      const start = Math.floor(random() * Math.max(1, values.length - effectiveBlock + 1))
      selected.push(...values.slice(start, start + effectiveBlock))
    }
    samples.push(mean(selected.slice(0, values.length)))
  }
  samples.sort((left, right) => left - right)
  const average = mean(samples)
  const variance = mean(samples.map((value) => (value - average) ** 2))
  return {
    samples: resamples,
    blockLength: effectiveBlock,
    mean: round(average),
    standardDeviation: round(Math.sqrt(variance)),
    quantiles: {
      p025: round(quantile(samples, 0.025)),
      p50: round(quantile(samples, 0.5)),
      p975: round(quantile(samples, 0.975)),
    },
  }
}

const metricsToRows = (metrics: Pl3ModelMetrics) => [
  { name: 'normalizedRank.mean', role: 'primary' as const, value: metrics.normalizedRank.mean },
  { name: 'normalizedRank.median', role: 'secondary' as const, value: metrics.normalizedRank.median },
  { name: 'mrr', role: 'secondary' as const, value: metrics.meanReciprocalRank },
  { name: 'top10', role: 'secondary' as const, value: metrics.coverage.top10 },
  { name: 'top20', role: 'secondary' as const, value: metrics.coverage.top20 },
  { name: 'top50', role: 'secondary' as const, value: metrics.coverage.top50 },
  { name: 'top100', role: 'secondary' as const, value: metrics.coverage.top100 },
  ...metrics.positionAccuracy.flatMap((position, index) => [
    { name: 'position.top1', role: 'secondary' as const, segment: String(index), value: position.top1 },
    { name: 'position.top3', role: 'secondary' as const, segment: String(index), value: position.top3 },
    { name: 'position.top5', role: 'secondary' as const, segment: String(index), value: position.top5 },
  ]),
].map((metric) => ({ ...metric, sampleCount: metrics.sampleCount }))

const writeTextAtomically = async (outputPath: string, content: string) => {
  await mkdir(path.dirname(outputPath), { recursive: true })
  const temporaryPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporaryPath, content, 'utf8')
  await rename(temporaryPath, outputPath)
}

const evaluateModelCase = (
  model: Pl3ModelConfig,
  records: readonly Pl3Record[],
  targetIndex: number,
  randomSeed: number,
): Pl3EvaluationCase => {
  const training = records.slice(0, targetIndex)
  const target = records[targetIndex]!
  const states = rankModel(model, training, target.period, randomSeed)
  if (states.length !== 1000 || new Set(states.map((state) => state.number)).size !== 1000) {
    throw new Error(`模型 ${model.modelId} 未输出完整 1000 状态。`)
  }
  const actualNumber = target.numbersList.join('')
  const actualState = states.find((state) => state.number === actualNumber)
  if (!actualState) throw new Error(`模型 ${model.modelId} 缺少实际状态 ${actualNumber}。`)
  return {
    targetPeriod: target.period,
    afterPeriod: training.at(-1)!.period,
    actualNumber,
    modelId: model.modelId,
    rank: actualState.rank,
    normalizedRank: round((actualState.rank - 1) / 999),
    reciprocalRank: round(1 / actualState.rank),
    positionRanks: positionRanks(states, target.numbersList),
  }
}

const selectModelsForFold = async (input: {
  store: Pl3Store
  experiment: Pl3ExperimentStorageRecord
  spec: Pl3ExperimentSpec
  records: readonly Pl3Record[]
  targetStart: number
  selectionIndex: number
  ownerId: string
}) => {
  const existing = input.store.listExperimentFolds(input.experiment.experimentId, 'inner')
    .find((fold) => fold.foldIndex === input.selectionIndex && fold.status === 'complete')
  if (existing?.selectedParamsJson) {
    const selected = JSON.parse(existing.selectedParamsJson) as Record<string, Record<string, unknown>>
    return input.spec.models.map((model) => ({ ...model, params: selected[model.modelId] || model.params, searchSpace: {} }))
  }

  const validationEnd = input.spec.split.minTrain + Math.floor(
    (input.targetStart - input.spec.split.minTrain) / input.spec.split.innerStep,
  ) * input.spec.split.innerStep
  const validationStart = Math.max(input.spec.split.minTrain, validationEnd - input.spec.split.innerValidation)
  const selectedModels: Pl3ModelConfig[] = []
  const candidateMetrics: Record<string, Array<{ params: Record<string, unknown>; meanNormalizedRank: number }>> = {}
  const featureSnapshotIds: string[] = []

  if (input.spec.models.some((model) => model.modelId === PL3_MODEL_VERSION)) {
    for (let targetIndex = validationStart; targetIndex < validationEnd; targetIndex += 1) {
      const training = input.records.slice(0, targetIndex)
      const snapshot = createPl3FeatureSnapshot(input.store, {
        datasetSnapshotId: input.spec.datasetSnapshotId,
        afterPeriod: training.at(-1)!.period,
        featureVersion: input.spec.featureVersion,
        codeCommit: input.experiment.codeCommit,
      })
      featureSnapshotIds.push(snapshot.featureSnapshotId)
    }
  }

  for (const model of input.spec.models) {
    const candidates = modelCandidates(model)
    const scored = candidates.map((candidate) => {
      const cases: Pl3EvaluationCase[] = []
      for (let targetIndex = validationStart; targetIndex < validationEnd; targetIndex += 1) {
        cases.push(evaluateModelCase(candidate, input.records, targetIndex, input.spec.randomSeed))
      }
      return {
        model: candidate,
        meanNormalizedRank: cases.length > 0 ? mean(cases.map((item) => item.normalizedRank)) : 0,
      }
    }).sort((left, right) =>
      left.meanNormalizedRank - right.meanNormalizedRank ||
      parameterSimplicity(left.model) - parameterSimplicity(right.model) ||
      canonicalize(left.model.params).localeCompare(canonicalize(right.model.params)))
    selectedModels.push(scored[0]!.model)
    candidateMetrics[model.modelId] = scored.map((item) => ({
      params: item.model.params,
      meanNormalizedRank: round(item.meanNormalizedRank),
    }))
  }

  const selectedParams = Object.fromEntries(selectedModels.map((model) => [model.modelId, model.params]))
  const now = new Date().toISOString()
  const trainEndIndex = Math.max(0, validationStart - 1)
  const testStartIndex = validationStart < validationEnd ? validationStart : Math.max(0, validationEnd - 1)
  const result = {
    schemaVersion: 1,
    experimentId: input.experiment.experimentId,
    foldLevel: 'inner',
    foldIndex: input.selectionIndex,
    validationRange: validationStart < validationEnd ? {
      fromPeriod: input.records[validationStart]!.period,
      toPeriod: input.records[validationEnd - 1]!.period,
      count: validationEnd - validationStart,
    } : null,
    selectedParams,
    candidateMetrics,
    featureSnapshotIds,
  }
  const relativePath = foldRelativePath(input.experiment.experimentId, 'inner', input.selectionIndex)
  await writeJsonAtomically(path.join(path.dirname(input.store.databasePath), relativePath), result)
  input.store.saveExperimentFold({
    experimentId: input.experiment.experimentId,
    foldLevel: 'inner',
    foldIndex: input.selectionIndex,
    trainFromPeriod: input.records[0]!.period,
    trainToPeriod: input.records[trainEndIndex]!.period,
    testFromPeriod: input.records[testStartIndex]!.period,
    testToPeriod: input.records[Math.max(testStartIndex, validationEnd - 1)]!.period,
    status: 'complete',
    selectedParamsJson: canonicalize(selectedParams),
    metricsJson: canonicalize(candidateMetrics),
    resultPath: relativePath,
    resultHash: sha256(canonicalize(result)),
    startedAt: now,
    completedAt: now,
  })
  input.store.renewRuntimeLock('experiment-runner', input.ownerId)
  return selectedModels
}

const evaluateFold = async (input: {
  store: Pl3Store
  experiment: Pl3ExperimentStorageRecord
  spec: Pl3ExperimentSpec
  records: readonly Pl3Record[]
  foldLevel: 'outer' | 'frozen'
  foldIndex: number
  targetStart: number
  targetEnd: number
  ownerId: string
  models: Pl3ModelConfig[]
}) => {
  const cases: Pl3EvaluationCase[] = []
  const featureSnapshotIds: string[] = []
  const requiresFeatures = input.models.some((model) => model.modelId === PL3_MODEL_VERSION)
  for (let targetIndex = input.targetStart; targetIndex < input.targetEnd; targetIndex += 1) {
    input.store.renewRuntimeLock('experiment-runner', input.ownerId)
    const training = input.records.slice(0, targetIndex)
    const target = input.records[targetIndex]!
    if (requiresFeatures) {
      const featureSnapshot: Pl3FeatureSnapshot = createPl3FeatureSnapshot(input.store, {
        datasetSnapshotId: input.spec.datasetSnapshotId,
        afterPeriod: training.at(-1)!.period,
        featureVersion: input.spec.featureVersion,
        codeCommit: input.experiment.codeCommit,
      })
      featureSnapshotIds.push(featureSnapshot.featureSnapshotId)
    }
    for (const model of input.models) cases.push(
      evaluateModelCase(model, input.records, targetIndex, input.spec.randomSeed),
    )
  }
  const modelMetrics = input.models.map((model) => calculateModelMetrics(
    model.modelId,
    cases.filter((item) => item.modelId === model.modelId),
  ))
  const bootstrap = Object.fromEntries(input.models.map((model) => {
    const values = cases.filter((item) => item.modelId === model.modelId).map((item) => item.normalizedRank)
    return [model.modelId, blockBootstrap(
      values,
      input.spec.bootstrap.resamples,
      input.spec.bootstrap.blockLength,
      stringSeed(input.spec.randomSeed, `${input.foldLevel}:${input.foldIndex}:${model.modelId}`),
    )]
  }))
  return {
    schemaVersion: 1,
    experimentId: input.experiment.experimentId,
    foldLevel: input.foldLevel,
    foldIndex: input.foldIndex,
    trainRange: {
      fromPeriod: input.records[0]!.period,
      toPeriod: input.records[input.targetStart - 1]!.period,
      count: input.targetStart,
    },
    testRange: {
      fromPeriod: input.records[input.targetStart]!.period,
      toPeriod: input.records[input.targetEnd - 1]!.period,
      count: input.targetEnd - input.targetStart,
    },
    featureSnapshotIds,
    selectedParams: Object.fromEntries(input.models.map((model) => [model.modelId, model.params])),
    modelMetrics,
    bootstrap,
    cases,
  } satisfies Pl3FoldResult
}

const foldRelativePath = (experimentId: string, level: string, index: number) =>
  path.posix.join('reports', 'experiments', experimentId, 'folds', `${level}-${String(index).padStart(4, '0')}.json`)

const runFoldSet = async (input: {
  store: Pl3Store
  experiment: Pl3ExperimentStorageRecord
  spec: Pl3ExperimentSpec
  records: readonly Pl3Record[]
  foldLevel: 'outer' | 'frozen'
  start: number
  end: number
  blockSize: number
  step: number
  ownerId: string
  selectNested?: boolean
  fixedModels?: Pl3ModelConfig[]
}) => {
  const existing = new Map(input.store.listExperimentFolds(input.experiment.experimentId, input.foldLevel)
    .filter((fold) => fold.status === 'complete')
    .map((fold) => [fold.foldIndex, fold]))
  let foldIndex = 0
  for (let targetStart = input.start; targetStart < input.end; targetStart += input.step) {
    const targetEnd = Math.min(targetStart + input.blockSize, input.end)
    if (existing.has(foldIndex)) {
      foldIndex += 1
      continue
    }
    const startedAt = new Date().toISOString()
    const models = input.fixedModels || (input.selectNested === false
      ? input.spec.models.map((model) => ({ ...model, searchSpace: {} }))
      : await selectModelsForFold({
          store: input.store,
          experiment: input.experiment,
          spec: input.spec,
          records: input.records,
          targetStart,
          selectionIndex: foldIndex,
          ownerId: input.ownerId,
        }))
    const base: Pl3ExperimentFoldStorageRecord = {
      experimentId: input.experiment.experimentId,
      foldLevel: input.foldLevel,
      foldIndex,
      trainFromPeriod: input.records[0]!.period,
      trainToPeriod: input.records[targetStart - 1]!.period,
      testFromPeriod: input.records[targetStart]!.period,
      testToPeriod: input.records[targetEnd - 1]!.period,
      status: 'running',
      selectedParamsJson: canonicalize(Object.fromEntries(models.map((model) => [model.modelId, model.params]))),
      metricsJson: null,
      resultPath: null,
      resultHash: null,
      startedAt,
      completedAt: null,
    }
    input.store.saveExperimentFold(base)
    const result = await evaluateFold({
      store: input.store,
      experiment: input.experiment,
      spec: input.spec,
      records: input.records,
      foldLevel: input.foldLevel,
      foldIndex,
      targetStart,
      targetEnd,
      ownerId: input.ownerId,
      models,
    })
    const resultJson = canonicalize(result)
    const resultHash = sha256(resultJson)
    const relativePath = foldRelativePath(input.experiment.experimentId, input.foldLevel, foldIndex)
    await writeJsonAtomically(path.join(path.dirname(input.store.databasePath), relativePath), result)
    result.modelMetrics.forEach((metrics) => input.store.replaceExperimentMetrics({
      experimentId: input.experiment.experimentId,
      foldLevel: input.foldLevel,
      foldIndex,
      modelId: metrics.modelId,
      metrics: metricsToRows(metrics),
    }))
    input.store.saveExperimentFold({
      ...base,
      status: 'complete',
      metricsJson: canonicalize(result.modelMetrics),
      resultPath: relativePath,
      resultHash,
      completedAt: new Date().toISOString(),
    })
    foldIndex += 1
  }
  return foldIndex
}

const loadExperimentAndSpec = (store: Pl3Store, experimentId: string) => {
  const experiment = store.getExperiment(experimentId)
  if (!experiment) throw new Error(`排列3实验不存在: ${experimentId}`)
  const spec = JSON.parse(experiment.specJson) as Pl3ExperimentSpec
  return { experiment, spec }
}

const reportContent = async (store: Pl3Store, experimentId: string) => {
  const { experiment, spec } = loadExperimentAndSpec(store, experimentId)
  const includeFrozen = experiment.status === 'frozen_evaluated'
  const folds = store.listExperimentFolds(experimentId)
    .filter((fold) =>
      fold.status === 'complete' &&
      (fold.foldLevel === 'outer' || (includeFrozen && fold.foldLevel === 'frozen')),
    )
  const foldResults: Pl3FoldResult[] = []
  for (const fold of folds) {
    if (!fold.resultPath) continue
    foldResults.push(JSON.parse(await readFile(path.join(path.dirname(store.databasePath), fold.resultPath), 'utf8')))
  }
  const levels = ['outer', ...(includeFrozen ? ['frozen'] : [])]
  const summary = Object.fromEntries(levels.map((level) => {
    const levelCases = foldResults.filter((fold) => fold.foldLevel === level).flatMap((fold) => fold.cases)
    return [level, spec.models.map((model) => calculateModelMetrics(
      model.modelId,
      levelCases.filter((item) => item.modelId === model.modelId),
    ))]
  }))
  return {
    schemaVersion: 1,
    experimentId,
    name: experiment.name,
    status: experiment.status,
    mode: experiment.mode,
    datasetSnapshotId: experiment.datasetSnapshotId,
    specHash: experiment.specHash,
    codeCommit: experiment.codeCommit,
    primaryMetric: spec.primaryMetric,
    frozenVisible: includeFrozen,
    completedFoldCount: folds.length,
    summary,
  }
}

export const generatePl3ExperimentReport = async (store: Pl3Store, experimentId: string) => {
  const report = await reportContent(store, experimentId)
  const relativeJsonPath = path.posix.join('reports', 'experiments', experimentId, 'report.json')
  const relativeMarkdownPath = path.posix.join('reports', 'experiments', experimentId, 'report.md')
  const dataDir = path.dirname(store.databasePath)
  await writeJsonAtomically(path.join(dataDir, relativeJsonPath), report)
  const markdown = [
    `# 排列3实验 ${experimentId}`,
    '',
    `- 名称：${report.name}`,
    `- 状态：${report.status}`,
    `- 数据 snapshot：${report.datasetSnapshotId}`,
    `- 主指标：${report.primaryMetric}`,
    `- 冻结结果可见：${report.frozenVisible ? '是' : '否'}`,
    '',
    '```json',
    JSON.stringify(report.summary, null, 2),
    '```',
    '',
  ].join('\n')
  await writeTextAtomically(path.join(dataDir, relativeMarkdownPath), markdown)
  const reportHash = sha256(canonicalize(report))
  store.setExperimentReport(experimentId, relativeJsonPath, reportHash)
  return { report, reportHash, reportPath: path.join(dataDir, relativeJsonPath), markdownPath: path.join(dataDir, relativeMarkdownPath) }
}

export const runPl3Experiment = async (store: Pl3Store, experimentId: string) => {
  const loaded = loadExperimentAndSpec(store, experimentId)
  if (!['registered', 'interrupted'].includes(loaded.experiment.status)) {
    throw new Error(`实验 ${experimentId} 当前状态 ${loaded.experiment.status}，不能运行开发区。`)
  }
  const records = store.getDatasetSnapshotRecords(loaded.spec.datasetSnapshotId)
  const developmentEnd = records.length - loaded.spec.split.frozenCount
  if (developmentEnd < loaded.spec.split.minTrain) throw new Error('开发区不足最低训练段。')
  const ownerId = randomUUID()
  if (!store.acquireRuntimeLock('experiment-runner', ownerId)) throw new Error('已有排列3实验正在运行。')
  const startedAt = Date.now()
  try {
    store.updateExperimentStatus(experimentId, 'running', { expected: ['registered', 'interrupted'] })
    store.addExperimentAudit(experimentId, 'development-run', 'started')
    const foldCount = await runFoldSet({
      store,
      experiment: loaded.experiment,
      spec: loaded.spec,
      records,
      foldLevel: 'outer',
      start: loaded.spec.split.minTrain,
      end: developmentEnd,
      blockSize: loaded.spec.split.outerTest,
      step: loaded.spec.split.outerStep,
      ownerId,
      selectNested: true,
    })
    if ((Date.now() - startedAt) / 1000 > loaded.spec.resource.maxRuntimeSeconds) {
      throw new Error('排列3实验超过预注册运行时间上限。')
    }
    store.updateExperimentStatus(experimentId, 'development_complete', { expected: ['running'] })
    store.addExperimentAudit(experimentId, 'development-run', 'complete', { foldCount, innerSelection: 'not_required' })
    return await generatePl3ExperimentReport(store, experimentId)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (store.getExperiment(experimentId)?.status === 'running') {
      store.updateExperimentStatus(experimentId, 'interrupted', {
        expected: ['running'],
        errorMessage: message,
      })
    }
    store.addExperimentAudit(experimentId, 'development-run', 'interrupted', { error: message })
    throw error
  } finally {
    store.releaseRuntimeLock('experiment-runner', ownerId)
  }
}

export const evaluatePl3ExperimentFrozen = async (store: Pl3Store, experimentId: string) => {
  const loaded = loadExperimentAndSpec(store, experimentId)
  if (loaded.experiment.mode !== 'confirmatory') throw new Error('只有 confirmatory 实验可以解封冻结区。')
  if (loaded.experiment.status !== 'development_complete') {
    throw new Error(`实验 ${experimentId} 当前状态 ${loaded.experiment.status}，不能评估冻结区。`)
  }
  const previousAttempts = (store.listExperimentAudit(experimentId) as any[])
    .filter((item) => item.action === 'frozen-evaluate' && item.status === 'started')
  if (previousAttempts.length > 0) throw new Error('该实验已经尝试过冻结评估，必须创建新 experimentId。')
  const records = store.getDatasetSnapshotRecords(loaded.spec.datasetSnapshotId)
  const frozenStart = records.length - loaded.spec.split.frozenCount
  const ownerId = randomUUID()
  if (!store.acquireRuntimeLock('experiment-runner', ownerId)) throw new Error('已有排列3实验正在运行。')
  try {
    store.addExperimentAudit(experimentId, 'frozen-evaluate', 'started')
    store.updateExperimentStatus(experimentId, 'running', { expected: ['development_complete'] })
    const outerFolds = store.listExperimentFolds(experimentId, 'outer')
      .filter((fold) => fold.status === 'complete' && fold.selectedParamsJson)
    const lastOuter = outerFolds.at(-1)
    const fixedModels = lastOuter?.selectedParamsJson
      ? (() => {
          const selected = JSON.parse(lastOuter.selectedParamsJson!) as Record<string, Record<string, unknown>>
          return loaded.spec.models.map((model) => ({
            ...model,
            params: selected[model.modelId] || model.params,
            searchSpace: {},
          }))
        })()
      : await selectModelsForFold({
          store,
          experiment: loaded.experiment,
          spec: loaded.spec,
          records,
          targetStart: frozenStart,
          selectionIndex: 1_000_000,
          ownerId,
        })
    const foldCount = await runFoldSet({
      store,
      experiment: loaded.experiment,
      spec: loaded.spec,
      records,
      foldLevel: 'frozen',
      start: frozenStart,
      end: records.length,
      blockSize: loaded.spec.split.outerTest,
      step: loaded.spec.split.outerTest,
      ownerId,
      selectNested: false,
      fixedModels,
    })
    store.updateExperimentStatus(experimentId, 'frozen_evaluated', { expected: ['running'] })
    store.addExperimentAudit(experimentId, 'frozen-evaluate', 'complete', { foldCount })
    return await generatePl3ExperimentReport(store, experimentId)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (store.getExperiment(experimentId)?.status === 'running') {
      store.updateExperimentStatus(experimentId, 'failed', {
        expected: ['running'],
        errorMessage: message,
      })
    }
    store.addExperimentAudit(experimentId, 'frozen-evaluate', 'failed', { error: message })
    throw error
  } finally {
    store.releaseRuntimeLock('experiment-runner', ownerId)
  }
}

export const inspectPl3Experiment = (store: Pl3Store, experimentId: string) => {
  const loaded = loadExperimentAndSpec(store, experimentId)
  return {
    experiment: loaded.experiment,
    spec: loaded.spec,
    folds: store.listExperimentFolds(experimentId),
    audit: store.listExperimentAudit(experimentId),
  }
}
