import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// node:sqlite 预检：Node 22.13–23.3 需要 --experimental-sqlite，早报错比跑一半报错好
try {
  await import('node:sqlite')
} catch (e) {
  console.error('[preflight] this package needs node:sqlite.')
  console.error('  Node', process.version, '—', e.code || e.message)
  console.error('  On Node 22.13–23.3 run with: node --experimental-sqlite scripts/test.mjs')
  process.exit(2)
}

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
