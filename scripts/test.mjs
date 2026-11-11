import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const files = []
for (const dir of ['portable-memory-core', 'test']) {
  for (const name of readdirSync(join(root, dir)).sort()) {
    if (name.endsWith('.test.mjs')) files.push(join(root, dir, name))
  }
}
if (!files.length) {
  console.error('no test files found')
  process.exit(1)
}
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' })
process.exit(result.status ?? 1)
