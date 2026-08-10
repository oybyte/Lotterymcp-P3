import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const repoRoot = path.resolve(import.meta.dirname, '..')
const coreEntryUrl = pathToFileURL(path.join(repoRoot, 'packages', 'core', 'dist', 'index.js')).href

const assertRepro = (condition, message) => {
  if (!condition) throw new Error(`复现断言失败: ${message}`)
}

const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'lotterymcp-repro-'))
try {
  const core = await import(coreEntryUrl)
  const dataDir = path.join(temporaryRoot, 'data')

  const records = Array.from({ length: 300 }, (_, index) => ({
    lotteryType: 'pl3',
    period: `26${String(index + 1).padStart(3, '0')}`,
    drawDate: `2026-01-${String((index % 28) + 1).padStart(2, '0')}`,
    numbers: `${index % 10},${(index * 3 + 1) % 10},${(index * 7 + 2) % 10}`,
    numbersList: [index % 10, (index * 3 + 1) % 10, (index * 7 + 2) % 10],
  }))

  // 1. 数据档案：写入 SQLite 并验证状态
  let store = core.openPl3Store({ dataDir })
  store.importRecords(records, { provider: 'lottery-gov-cn' })
  store.importRecords(records, { provider: 'zhcw' })
  assertRepro(store.getStatus().usableRecords === 300, 'SQLite 写入 300 期记录')
  assertRepro(store.getStatus().confirmedRecords === 300, '双官方源一致确认 300 期')
  assertRepro(store.getStatus().conflictRecords === 0, '无冲突记录')
  store.close()

  // 2. 预测：确定性 ID + 数据状态标注 + 每注构成解释
  const first = core.predictPl3(records, { tickets: 10, playType: 'mixed', generatedAt: '2026-01-01T00:00:00.000Z' })
  const second = core.predictPl3(records, { tickets: 10, playType: 'mixed', generatedAt: '2026-02-01T00:00:00.000Z' })
  assertRepro(first.predictionId === second.predictionId, '预测 ID 与生成时间无关（确定性）')
  assertRepro(first.training.dataStatus.confirmedRecords === 0, '数据状态标注存在')
  assertRepro(
    first.tickets.every((ticket) => ticket.scoreComposition),
    '候选票携带分构成解释',
  )
  assertRepro(first.tickets[0].scoreComposition.leadingFeature !== undefined, '主导特征已标注')

  // 3. 可信度报告 + SLA 时间证据
  store = core.openPl3Store({ dataDir, readonly: true, fileMustExist: true })
  const byYear = store.getConfidenceByYear()
  assertRepro(byYear.length >= 1 && byYear[0].totalPeriods === 300, '分年度可信度报告')
  const ledgerPath = path.join(dataDir, 'pl3-predictions.json')
  await core.writeJsonAtomically(ledgerPath, {
    version: 1,
    predictions: [
      {
        predictionId: first.predictionId,
        afterPeriod: '26200',
        generatedAt: '2026-01-01T00:00:00.000Z',
        settlement: { status: 'pending' },
      },
    ],
  })
  const sla = await core.verifyPl3PredictionSla(ledgerPath, (prediction) => store.getPredictionSlaEvidence(prediction))
  assertRepro(sla.total === 1, 'SLA 检查覆盖 1 条预测')
  assertRepro(sla.withEvidence === 1 && sla.verifiedBeforeObservation === 1, '预测早于目标期首次 observation')
  store.close()

  // 4. 数据集快照 + 哈希校验
  store = core.openPl3Store({ dataDir })
  const snapshot = store.createDatasetSnapshot({ last: 200 })
  assertRepro(snapshot.recordCount === 200, 'confirmed 快照创建 200 期')
  const verification = store.verifyDatasetSnapshot(snapshot.snapshotId)
  assertRepro(verification.valid, '快照哈希校验通过')
  store.close()

  console.log(
    `Node ${process.version} ${process.platform}/${process.arch} 一键复现通过（数据档案 → 预测 → SLA → 快照）。`,
  )
} finally {
  if (process.platform !== 'win32') {
    rmSync(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}
