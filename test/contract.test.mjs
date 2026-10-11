import test from 'node:test'
import assert from 'node:assert/strict'
import { ROUTE_PREFIX, ASSET, CLIPS, LOOPING, KINDS, TOOL_CLASS, classifyTool, BOND, LEDGER_REASONS, BALANCE_TIERS, INTENTS, TUNING } from '../src/shared/contract.js'

test('路由前缀是注册进 host 的那一个', () => {
  assert.equal(ROUTE_PREFIX, '/dsh-kylin-pet-7341')
})

test('几何常量与实测包围盒一致', () => {
  assert.equal(ASSET.W, 640)
  assert.equal(ASSET.H, 360)
  assert.ok(Math.abs(ASSET.FOOT_RATIO - 330 / 360) < 1e-12)
  assert.ok(Math.abs(ASSET.CHAR_TOP - 30 / 360) < 1e-12)
  assert.deepEqual(ASSET.HIT_X, [0.30, 0.70])
  assert.ok(ASSET.HIT_X[0] <= 0.325 && ASSET.HIT_X[1] >= 0.673, '命中区必须覆盖实测并集 0.325-0.673')
})

test('19 个素材名一个不少、不重复', () => {
  const names = Object.values(CLIPS).flat()
  assert.equal(names.length, 19)
  assert.equal(new Set(names).size, 19)
})

test('契约是冻结的（防运行期被改）', () => {
  assert.throws(() => { ASSET.W = 1 }, TypeError)
  assert.throws(() => { CLIPS.idle = [] }, TypeError)
  assert.ok(LOOPING.length === 2 && LOOPING.includes('idle') && LOOPING.includes('walk'))
  assert.equal(KINDS.length, 8)   // 5 回合边界/执行期 + 3 任务跟随（F2）
  assert.ok(Object.isFrozen(KINDS))
  // V5：分类表与它内部的每个数组都必须冻结 —— 它被 host 与 client 同时读，
  // 运行期被谁改一格，两边就会对同一个工具说出不同的话，而且不会有任何测试红。
  assert.ok(Object.isFrozen(TOOL_CLASS))
  for (const cls of Object.keys(TOOL_CLASS)) assert.ok(Object.isFrozen(TOOL_CLASS[cls]), cls + ' 应当冻结')
  assert.ok(BOND.AFFINITY_MIN === -100 && BOND.AFFINITY_MAX === 100)
  assert.ok(LEDGER_REASONS.length === 7 && Object.isFrozen(LEDGER_REASONS))
  assert.equal(BALANCE_TIERS[0][0], '充裕')
  assert.ok(INTENTS.solo.length === 4 && INTENTS.social.length === 9)
  assert.equal(Object.keys(TUNING.COOLDOWN_SEC).length, 8)
  assert.equal(Object.keys(TUNING.EFFECT).length, 9)
})
