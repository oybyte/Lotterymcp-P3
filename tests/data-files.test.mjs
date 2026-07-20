import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { parse } from 'csv-parse/sync'

const rootDir = path.resolve(import.meta.dirname, '..')
const coreEntryUrl = pathToFileURL(path.join(rootDir, 'packages/core/dist/index.js')).href
const dataFilesEntryUrl = pathToFileURL(path.join(rootDir, 'packages/cli/dist/data-files.js')).href
const dataGcEntryUrl = pathToFileURL(path.join(rootDir, 'packages/cli/dist/data-gc.js')).href

test('JSON and CSV files use the same SQLite validation and support round-trip export', async () => {
  const { importPl3FileToStore, exportPl3Store } = await import(dataFilesEntryUrl)
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'lotterymcp-data-files-'))
  const jsonPath = path.join(dataDir, 'history.json')
  const csvPath = path.join(dataDir, 'history.csv')
  writeFileSync(jsonPath, JSON.stringify({
    records: [{
      lotteryType: 'pl3',
      period: '26180',
      drawDate: '2026-07-01',
      numbers: '1,2,3',
    }],
  }), 'utf8')
  writeFileSync(csvPath, [
    'lotteryType,period,drawDate,numbers',
    'pl3,26181,2026-07-02,"4,5,6"',
  ].join('\n'), 'utf8')

  const jsonImport = await importPl3FileToStore({ dataDir, filePath: jsonPath })
  const csvImport = await importPl3FileToStore({ dataDir, filePath: csvPath })
  assert.equal(jsonImport.insertedObservations, 1)
  assert.equal(csvImport.insertedObservations, 1)
  assert.equal(existsSync(jsonImport.rawPath), true)
  assert.equal(existsSync(csvImport.rawPath), true)

  const jsonExportPath = path.join(dataDir, 'exports', 'pl3.json')
  const csvExportPath = path.join(dataDir, 'exports', 'pl3.csv')
  const jsonExport = await exportPl3Store({ dataDir, outputPath: jsonExportPath })
  const csvExport = await exportPl3Store({ dataDir, outputPath: csvExportPath })
  assert.equal(jsonExport.recordCount, 2)
  assert.equal(csvExport.recordCount, 2)
  const exportedJson = JSON.parse(readFileSync(jsonExportPath, 'utf8'))
  assert.deepEqual(exportedJson.records.map((item) => item.period), ['26181', '26180'])
  const exportedCsv = parse(readFileSync(csvExportPath, 'utf8'), { columns: true })
  assert.deepEqual(exportedCsv.map((item) => item.numbers), ['4,5,6', '1,2,3'])
})

test('database backup is validated and can restore a known-good snapshot', async () => {
  const { backupPl3Database, openPl3Store, restorePl3Database } = await import(coreEntryUrl)
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'lotterymcp-backup-'))
  let store = openPl3Store({ dataDir })
  store.importRecords([{
    lotteryType: 'pl3', period: '26180', drawDate: '2026-07-01', numbers: '1,2,3',
  }], { provider: 'file-import' })
  store.close()

  const backup = await backupPl3Database(dataDir)
  assert.equal(existsSync(backup.backupPath), true)

  store = openPl3Store({ dataDir })
  store.importRecords([{
    lotteryType: 'pl3', period: '26181', drawDate: '2026-07-02', numbers: '4,5,6',
  }], { provider: 'file-import' })
  store.close()

  await restorePl3Database(dataDir, backup.backupPath)
  store = openPl3Store({ dataDir, readonly: true, fileMustExist: true })
  try {
    assert.equal(store.getStatus().usableRecords, 1)
    assert.equal(store.getStatus().latestPeriod, '26180')
  } finally {
    store.close()
  }
})

test('raw GC deletes only an unchanged, old and unreferenced dry-run plan', async () => {
  const { openPl3Store } = await import(coreEntryUrl)
  const { applyPl3RawGcPlan, createPl3RawGcPlan } = await import(dataGcEntryUrl)
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'lotterymcp-gc-'))
  const rawDir = path.join(dataDir, 'raw', 'file-import', '2026')
  mkdirSync(rawDir, { recursive: true })
  const referencedPath = path.join(rawDir, 'referenced.json.gz')
  const orphanPath = path.join(rawDir, 'orphan.json.gz')
  writeFileSync(referencedPath, 'referenced', 'utf8')
  writeFileSync(orphanPath, 'orphan', 'utf8')
  const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
  utimesSync(referencedPath, old, old)
  utimesSync(orphanPath, old, old)

  const store = openPl3Store({ dataDir })
  store.importRecords([{
    lotteryType: 'pl3', period: '26180', drawDate: '2026-07-01', numbers: '1,2,3',
  }], {
    provider: 'file-import',
    rawPath: 'raw/file-import/2026/referenced.json.gz',
  })
  store.close()

  const plan = await createPl3RawGcPlan(dataDir)
  assert.deepEqual(plan.candidates.map((item) => item.relativePath), ['raw/file-import/2026/orphan.json.gz'])
  const result = await applyPl3RawGcPlan(dataDir)
  assert.equal(result.deletedFiles, 1)
  assert.equal(existsSync(orphanPath), false)
  assert.equal(existsSync(referencedPath), true)

  const changedPath = path.join(rawDir, 'changed.json.gz')
  writeFileSync(changedPath, 'before', 'utf8')
  utimesSync(changedPath, old, old)
  await createPl3RawGcPlan(dataDir)
  writeFileSync(changedPath, 'after', 'utf8')
  await assert.rejects(() => applyPl3RawGcPlan(dataDir), /状态已变化/)
  assert.equal(existsSync(changedPath), true)
})
