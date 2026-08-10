import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bannerModuleUrl = pathToFileURL(path.join(repoRoot, 'packages', 'cli', 'dist', 'banner.js')).href

test('banner uses the new block wordmark instead of the old ASCII letters', async () => {
  const { renderNbcpBanner } = await import(bannerModuleUrl)
  const output = renderNbcpBanner()

  assert.match(output, /█{2,}/)
  assert.match(output, /Lotterymcp 中文命令行入口/)
  assert.match(output, /www\.neuxsbot\.com/)
  assert.doesNotMatch(output, /NN\s{3}NN EEEEEEE/)
})

test('P3 documentation screenshots match real CLI output', () => {
  const result = spawnSync(
    process.execPath,
    [path.join(repoRoot, 'scripts', 'generate-doc-screenshots.mjs'), '--check'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    },
  )
  assert.equal(result.status, 0, result.stderr || result.stdout)
  const predictionSvg = readFileSync(path.join(repoRoot, 'docs', 'screenshots', 'terminal-pl3.svg'), 'utf8')
  assert.match(predictionSvg, /预测 ID:/)
  assert.match(predictionSvg, /weighted-frequency-v1/)
})
