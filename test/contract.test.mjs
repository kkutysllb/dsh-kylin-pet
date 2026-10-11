import test from 'node:test'
import assert from 'node:assert/strict'
import { ROUTE_PREFIX, ASSET, CLIPS, LOOPING, KINDS } from '../src/shared/contract.js'

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
  assert.equal(KINDS.length, 3)
  assert.ok(Object.isFrozen(KINDS))
})
