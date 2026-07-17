import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cliEntry = path.join(repoRoot, 'packages', 'cli', 'dist', 'index.js')
const outputDir = path.join(repoRoot, 'docs', 'screenshots')
const checkOnly = process.argv.includes('--check')

const escapeXml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')

const cleanOutput = (value) => value
  .replace(/\u001b\[[0-9;]*m/g, '')
  .replaceAll('\r\n', '\n')
  .trim()

const runCli = (args, options = {}) => {
  const result = spawnSync(process.execPath, [cliEntry, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    input: options.input,
    env: { ...process.env, NBCP_DISABLE_BANNER: '1', ...options.env },
  })
  if (result.status !== 0) {
    throw new Error(`CLI screenshot command failed: ${cleanOutput(result.stderr || result.stdout)}`)
  }
  return cleanOutput(result.stdout)
}

const renderSvg = (title, command, output) => {
  const lines = output.split('\n')
  const width = 1500
  const lineHeight = 36
  const height = Math.max(720, 220 + lines.length * lineHeight)
  const body = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="#08090b"/>`,
    `<rect x="32" y="32" width="${width - 64}" height="${height - 64}" rx="8" fill="#111318" stroke="#343942" stroke-width="2"/>`,
    '<circle cx="76" cy="72" r="8" fill="#ff5f57"/>',
    '<circle cx="104" cy="72" r="8" fill="#febc2e"/>',
    '<circle cx="132" cy="72" r="8" fill="#28c840"/>',
    `<text x="174" y="82" fill="#f3f5f7" font-size="29" font-family="Consolas, Microsoft YaHei UI, monospace">${escapeXml(title)}</text>`,
    `<text x="72" y="132" fill="#7ee787" font-size="24" font-family="Consolas, Microsoft YaHei UI, monospace">$ ${escapeXml(command)}</text>`,
    `<line x1="64" y1="154" x2="${width - 64}" y2="154" stroke="#2a2e35"/>`,
  ]
  let y = 194
  for (const line of lines) {
    if (!line) {
      y += Math.floor(lineHeight / 2)
      continue
    }
    const color = line.includes('排列3预测结果') || line.includes('请选择操作')
      ? '#f2cc60'
      : line.includes('候选票')
        ? '#8ab4ff'
        : line.includes('回测:')
          ? '#c4b5fd'
          : line.includes('历史模拟')
            ? '#9da5b4'
            : '#d9dde3'
    body.push(`<text x="72" y="${y}" fill="${color}" font-size="24" font-family="Consolas, Microsoft YaHei UI, monospace">${escapeXml(line)}</text>`)
    y += lineHeight
  }
  body.push('</svg>')
  return `${body.join('\n')}\n`
}

const tempDir = mkdtempSync(path.join(os.tmpdir(), 'lotterymcp-docs-'))
try {
  let seed = 20260717
  const nextDigit = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed % 10
  }
  const records = Array.from({ length: 200 }, (_, index) => {
    const date = new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10)
    return {
      lotteryType: 'pl3',
      period: String(2025001 + index),
      drawDate: date,
      numbers: `${nextDigit()},${nextDigit()},${nextDigit()}`,
    }
  }).reverse()
  writeFileSync(path.join(tempDir, 'pl3.json'), `${JSON.stringify({ records }, null, 2)}\n`, 'utf8')

  const menuOutput = runCli([], {
    input: '0\n',
    env: { NBCP_FORCE_MENU: '1' },
  })
  const predictionOutput = runCli(['predict', '--periods', '200', '--tickets', '10', '--play', 'mixed'], {
    env: {
      LOTTERYMCP_DATA_MODE: 'official',
      LOTTERYMCP_DATA_DIR: tempDir,
      NBCP_CONFIG_PATH: path.join(tempDir, 'missing-config.json'),
      NEUXSBOT_TOKEN: '',
    },
  })

  const outputs = new Map([
    ['terminal-help.svg', renderSvg('Lotterymcp 排列3菜单', 'npx --yes lotterymcp@latest', menuOutput)],
    ['terminal-pl3.svg', renderSvg('排列3预测与 Walk-forward 回测', 'lotterymcp predict --periods 200 --tickets 10 --play mixed', predictionOutput)],
  ])

  for (const [filename, content] of outputs) {
    const targetPath = path.join(outputDir, filename)
    if (checkOnly) {
      const current = readFileSync(targetPath, 'utf8').replaceAll('\r\n', '\n')
      if (current !== content) throw new Error(`${filename} 已过期，请运行 npm run docs:screenshots。`)
    } else {
      writeFileSync(targetPath, content, 'utf8')
    }
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true })
}
