import { cp, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, 'packages', 'web', 'dist')
const target = path.join(root, 'packages', 'cli', 'dist', 'web')

await rm(target, { recursive: true, force: true })
await mkdir(path.dirname(target), { recursive: true })
await cp(source, target, { recursive: true })
