import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const readJson = (relativePath) => JSON.parse(readFileSync(path.join(repoRoot, relativePath), 'utf8'))

test('cli package does not depend on unpublished local file dependencies', () => {
  const cliPackage = readJson(path.join('packages', 'cli', 'package.json'))
  const dependencyEntries = Object.entries(cliPackage.dependencies || {})

  assert.ok(dependencyEntries.length > 0)

  for (const [name, version] of dependencyEntries) {
    assert.doesNotMatch(
      String(version),
      /^file:/,
      `CLI package dependency ${name} must not use a local file reference in a publishable package`,
    )
  }
})

test('publishable packages expose registry metadata and cli package includes a README', () => {
  const packageDirs = ['core', 'mcp-server', 'cli', 'nbcp']
  const cliReadmePath = path.join(repoRoot, 'packages', 'cli', 'README.md')

  for (const packageDir of packageDirs) {
    const manifest = readJson(path.join('packages', packageDir, 'package.json'))
    assert.equal(manifest.version, '0.7.0')
    assert.equal(manifest.private, false)
    assert.equal(manifest.publishConfig?.access, 'public')
    assert.equal(manifest.license, 'MIT')
    assert.match(manifest.repository?.url || '', /Lotterymcp-P3\.git$/)
    assert.match(manifest.bugs?.url || '', /Lotterymcp-P3\/issues$/)
    assert.equal(existsSync(path.join(repoRoot, 'packages', packageDir, 'LICENSE')), true)
  }
  assert.equal(existsSync(cliReadmePath), true)
  assert.equal(existsSync(path.join(repoRoot, 'LICENSE')), true)
})

test('source and public docs expose no non-P3 lottery names', () => {
  const roots = ['README.md', 'docs', 'examples', 'packages', 'scripts']
  const files = []
  const visit = (target) => {
    const absolute = path.join(repoRoot, target)
    if (!existsSync(absolute)) return
    if (statSync(absolute).isDirectory()) {
      if (path.basename(absolute) === 'dist') return
      for (const entry of readdirSync(absolute)) visit(path.join(target, entry))
      return
    }
    if (/\.(?:ts|js|mjs|json|md|yml|yaml)$/.test(target)) files.push(target)
  }
  roots.forEach(visit)
  const forbidden = /fc3d|ssq|kl8|dlt|pl5|qxc|双色球|大乐透|七星彩/i
  for (const file of files) {
    assert.doesNotMatch(readFileSync(path.join(repoRoot, file), 'utf8'), forbidden, file)
  }
})

test('published cli is TypeScript-only and ships the P3 sync implementation', () => {
  const cliPackage = readJson(path.join('packages', 'cli', 'package.json'))

  assert.deepEqual(cliPackage.files, ['dist', 'README.md'])
  assert.equal(existsSync(path.join(repoRoot, 'packages', 'cli', 'dist', 'official-sync.js')), true)
  assert.equal(existsSync(path.join(repoRoot, 'packages', 'cli', 'dist', 'web', 'index.html')), true)
})

test('public docs stay product-facing and do not expose internal conversation wording', () => {
  const readme = readFileSync(path.join(repoRoot, 'README.md'), 'utf8')
  const usageDoc = readFileSync(path.join(repoRoot, 'docs', 'mcp-usage.zh-CN.md'), 'utf8')
  const promptDoc = readFileSync(path.join(repoRoot, 'docs', 'prompt-templates.zh-CN.md'), 'utf8')

  assert.match(readme, /分析问题示例/)
  assert.doesNotMatch(readme, /AI 提示词模板/)
  assert.doesNotMatch(readme, /packages\/cli/)
  assert.doesNotMatch(readme, /packages\/core/)
  assert.doesNotMatch(readme, /packages\/mcp-server/)
  assert.doesNotMatch(readme, /\?{3,}/)

  assert.match(usageDoc, /MCP 接入说明/)
  assert.doesNotMatch(usageDoc, /\?{3,}/)

  assert.match(promptDoc, /分析问题示例/)
  assert.doesNotMatch(promptDoc, /提示词模板/)
  assert.doesNotMatch(promptDoc, /\?{3,}/)
})

test('one-command reproduction smoke covers data archive, prediction, SLA and snapshot', async () => {
  const { execFileSync } = await import('node:child_process')
  const output = execFileSync(process.execPath, [path.join(repoRoot, 'scripts', 'reproduction-smoke.mjs')], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  })
  assert.match(output, /一键复现通过/)
})
