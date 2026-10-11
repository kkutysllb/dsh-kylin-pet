import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseJsonc, deepMerge, loadPetConfig, validateConfig } from '../src/server/pet-config.js'

const NL = String.fromCharCode(10)

/** 造一个「包内出厂配置 + 可选用户覆盖」的临时世界 */
function world(user) {
  const root = mkdtempSync(join(tmpdir(), 'kpet-'))
  const packageDir = join(root, 'pkg')
  const home = join(root, 'home')
  mkdirSync(join(packageDir, 'assets'), { recursive: true })
  writeFileSync(join(packageDir, 'assets', 'default-config.jsonc'), [
    '{',
    '  // 出厂注释',
    '  "cast": [ { "id": "a", "name": "甲", "anchor": "top-right", "size": 280, "animationDir": "main-animation", "memeDir": "main-memes" } ],',
    '  "directing": { "duet": { "distance": 120, "cooldownSec": 300 } },',
    '}',
  ].join(NL))
  if (user) {
    mkdirSync(join(home, 'dsh-kylin-pet'), { recursive: true })
    writeFileSync(join(home, 'dsh-kylin-pet', 'main-config.jsonc'), user)
  }
  return { packageDir, home }
}

test('parseJsonc: 注释与尾逗号被吃掉，字符串里的 // 不动', () => {
  assert.deepEqual(parseJsonc('{ "a": 1, /* x */ "b": "http://x/y", }'), { a: 1, b: 'http://x/y' })
})

test('deepMerge: 对象递归、数组整组替换', () => {
  const out = deepMerge({ a: { x: 1, y: 2 }, list: [1, 2], s: 'base' }, { a: { y: 9 }, list: [7], s: 'over' })
  assert.deepEqual(out, { a: { x: 1, y: 9 }, list: [7], s: 'over' })
})

test('无用户覆盖 -> 出厂配置', () => {
  const w = world(null)
  assert.equal(loadPetConfig(w).cast[0].id, 'a')
})

test('用户覆盖：深合并保留未提及的出厂键', () => {
  const w = world('{ "directing": { "duet": { "distance": 42 } } }')
  const cfg = loadPetConfig(w)
  assert.equal(cfg.directing.duet.distance, 42)
  assert.equal(cfg.directing.duet.cooldownSec, 300)
  assert.equal(cfg.cast[0].id, 'a')
})

test('用户 cast 整组替换（不按 id 合并）', () => {
  const w = world('{ "cast": [ { "id": "b", "name": "乙", "anchor": "bottom-left", "size": 200, "animationDir": "whale-animation", "memeDir": "whale-memes" } ] }')
  assert.deepEqual(loadPetConfig(w).cast.map((p) => p.id), ['b'])
})

test('校验：空 cast / 缺字段 / id 重复都要抛', () => {
  assert.throws(() => validateConfig({ cast: [] }, 'x'), /非空数组/)
  assert.throws(() => validateConfig({ cast: [{ id: 'a' }] }, 'x'), /缺字段 name/)
  const pet = { id: 'a', name: '甲', anchor: 'x', size: 1, animationDir: 'd', memeDir: 'm' }
  assert.throws(() => validateConfig({ cast: [pet, { ...pet }] }, 'x'), /id 重复/)
})

test('真实出厂配置能过校验（防 assets/default-config.jsonc 被改坏）', () => {
  const cfg = loadPetConfig({ home: '/nonexistent-home-for-test' })
  assert.deepEqual(cfg.cast.map((p) => p.id), ['kylinzi', 'xisha'])
  assert.deepEqual(cfg.directing.workStatus, { kylinzi: ['ok'], xisha: ['fail'] })
  assert.equal(cfg.directing.duet.distance, 120)
  assert.equal(cfg.directing.duet.cooldownSec, 300)
})
