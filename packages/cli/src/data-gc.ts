import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { lstat, readFile, readdir, unlink } from 'node:fs/promises'
import path from 'node:path'
import { openPl3Store, writeJsonAtomically } from 'lotterymcp-core'

const GC_MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000
const GC_PLAN_MAX_AGE_MS = 60 * 60 * 1000

type GcCandidate = {
  relativePath: string
  size: number
  mtimeMs: number
}

type GcPlan = {
  schemaVersion: 1
  createdAt: string
  dataDir: string
  rawDir: string
  candidates: GcCandidate[]
  totalBytes: number
  planHash: string
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
const normalizeRelative = (value: string) => value.replaceAll('\\', '/').replace(/^\.\//, '')

const resolveInside = (root: string, relativePath: string) => {
  const resolvedRoot = path.resolve(root)
  const resolved = path.resolve(resolvedRoot, relativePath)
  const prefix = `${resolvedRoot}${path.sep}`
  if (resolved !== resolvedRoot && !resolved.startsWith(prefix)) {
    throw new Error(`raw 路径越界: ${relativePath}`)
  }
  return resolved
}

const walkFiles = async (root: string, current = root): Promise<string[]> => {
  if (!existsSync(current)) return []
  const entries = await readdir(current, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const fullPath = path.join(current, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`raw 目录包含符号链接，拒绝 GC: ${fullPath}`)
    if (entry.isDirectory()) files.push(...await walkFiles(root, fullPath))
    else if (entry.isFile()) files.push(normalizeRelative(path.relative(root, fullPath)))
  }
  return files
}

const collectManifestReferences = async (dataDir: string, rawDir: string, references: Set<string>) => {
  const manifestDir = path.join(rawDir, 'manifests')
  if (!existsSync(manifestDir)) return
  for (const relativeToManifest of await walkFiles(manifestDir)) {
    const manifestPath = path.join(manifestDir, relativeToManifest)
    const relativePath = normalizeRelative(path.relative(dataDir, manifestPath))
    references.add(relativePath)
    try {
      const parsed = JSON.parse(await readFile(manifestPath, 'utf8'))
      if (Array.isArray(parsed?.responses)) {
        parsed.responses.forEach((response: any) => {
          if (typeof response?.rawPath === 'string') references.add(normalizeRelative(response.rawPath))
        })
      }
    } catch {
      throw new Error(`raw manifest 格式无效，拒绝 GC: ${manifestPath}`)
    }
  }
}

const collectCheckpointReferences = async (dataDir: string, rawDir: string, references: Set<string>) => {
  const checkpointDir = path.join(rawDir, 'checkpoints')
  if (!existsSync(checkpointDir)) return
  for (const relativeToCheckpoint of await walkFiles(checkpointDir)) {
    if (!relativeToCheckpoint.endsWith('.json')) continue
    const checkpointPath = path.join(checkpointDir, relativeToCheckpoint)
    references.add(normalizeRelative(path.relative(dataDir, checkpointPath)))
    try {
      const parsed = JSON.parse(await readFile(checkpointPath, 'utf8'))
      if (Array.isArray(parsed?.pages)) {
        parsed.pages.forEach((page: any) => {
          if (typeof page?.rawPath === 'string') references.add(normalizeRelative(page.rawPath))
        })
      }
    } catch {
      // Archived invalid checkpoints remain protected but do not block cleanup of unrelated files.
    }
  }
}

const buildPlanHash = (plan: Omit<GcPlan, 'planHash'>) => sha256(JSON.stringify({
  ...plan,
  candidates: [...plan.candidates].sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
}))

export const createPl3RawGcPlan = async (dataDir: string): Promise<GcPlan> => {
  const resolvedDataDir = path.resolve(dataDir)
  const rawDir = path.join(resolvedDataDir, 'raw')
  const references = new Set<string>()
  const store = openPl3Store({ dataDir: resolvedDataDir, readonly: true, fileMustExist: true })
  try {
    store.listReferencedRawPaths().forEach((rawPath) => references.add(normalizeRelative(rawPath)))
  } finally {
    store.close()
  }
  await collectManifestReferences(resolvedDataDir, rawDir, references)
  await collectCheckpointReferences(resolvedDataDir, rawDir, references)

  const candidates: GcCandidate[] = []
  const cutoff = Date.now() - GC_MIN_AGE_MS
  for (const relativeToRaw of await walkFiles(rawDir)) {
    if (relativeToRaw === 'gc-plan.json' || relativeToRaw.startsWith('checkpoints/') || relativeToRaw.startsWith('manifests/')) continue
    const relativePath = normalizeRelative(path.join('raw', relativeToRaw))
    if (references.has(relativePath)) continue
    const filePath = resolveInside(resolvedDataDir, relativePath)
    const info = await lstat(filePath)
    if (!info.isFile() || info.mtimeMs > cutoff) continue
    candidates.push({ relativePath, size: info.size, mtimeMs: info.mtimeMs })
  }
  candidates.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  const withoutHash = {
    schemaVersion: 1 as const,
    createdAt: new Date().toISOString(),
    dataDir: resolvedDataDir,
    rawDir,
    candidates,
    totalBytes: candidates.reduce((total, item) => total + item.size, 0),
  }
  const plan: GcPlan = { ...withoutHash, planHash: buildPlanHash(withoutHash) }
  await writeJsonAtomically(path.join(rawDir, 'gc-plan.json'), plan)
  return plan
}

export const applyPl3RawGcPlan = async (dataDir: string) => {
  const resolvedDataDir = path.resolve(dataDir)
  const planPath = path.join(resolvedDataDir, 'raw', 'gc-plan.json')
  if (!existsSync(planPath)) throw new Error('未找到 raw GC 计划，请先运行 data gc --dry-run。')
  const plan = JSON.parse(await readFile(planPath, 'utf8')) as GcPlan
  const { planHash, ...withoutHash } = plan
  if (plan.schemaVersion !== 1 || plan.dataDir !== resolvedDataDir || buildPlanHash(withoutHash) !== planHash) {
    throw new Error('raw GC 计划无效或已被修改，请重新执行 dry-run。')
  }
  const createdAt = new Date(plan.createdAt).getTime()
  if (!Number.isFinite(createdAt) || Date.now() - createdAt > GC_PLAN_MAX_AGE_MS) {
    throw new Error('raw GC 计划已过期，请重新执行 dry-run。')
  }

  const currentPlan = await createPl3RawGcPlan(resolvedDataDir)
  const expected = plan.candidates.map((item) => JSON.stringify(item))
  const current = currentPlan.candidates.map((item) => JSON.stringify(item))
  if (expected.length !== current.length || expected.some((item, index) => item !== current[index])) {
    throw new Error('raw 文件状态已变化，拒绝应用旧 GC 计划，请重新执行 dry-run。')
  }
  for (const candidate of plan.candidates) {
    await unlink(resolveInside(resolvedDataDir, candidate.relativePath))
  }
  await unlink(planPath).catch(() => undefined)
  return {
    deletedFiles: plan.candidates.length,
    deletedBytes: plan.totalBytes,
    paths: plan.candidates.map((item) => item.relativePath),
  }
}
