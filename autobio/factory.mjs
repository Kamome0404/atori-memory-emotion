// autobio 初始化工厂：原子加载 runtime+integration，验证导出后创建 shadow runtime。
// 审核/候选/注入规则仍在 lib/autobio 内部。
import { join } from 'node:path'

export async function createAutobioRuntime({ dataDir, ownerUid, memoryPort, loadRuntime, loadIntegration } = {}) {
  const owner = String(ownerUid || '')
  if (!owner) throw new Error('owner missing')
  const [runtimeMod, integrationMod] = await Promise.all([
    (loadRuntime || (() => import('./runtime.mjs')))(),
    (loadIntegration || (() => import('./integration.mjs')))(),
  ])
  if (typeof runtimeMod.createAutobio !== 'function' || typeof integrationMod.matchApprovedReference !== 'function' || typeof integrationMod.formatApprovedReference !== 'function') {
    throw new Error('missing autobio exports')
  }
  const runtime = runtimeMod.createAutobio({
    dbPath: join(dataDir || '', 'autobio-shadow.sqlite'),
    mode: 'shadow',
    ownerScope: `private:${owner}`,
    memoryPort,
  })
  return {
    runtime,
    matchApprovedReference: integrationMod.matchApprovedReference,
    formatApprovedReference: integrationMod.formatApprovedReference,
  }
}
