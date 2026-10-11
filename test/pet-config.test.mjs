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

// ── v0.1.1 S5：设置页写入口 ───────────────────────────────────────────────

test('sanitizeConfigPatch：白名单整形，多余字段与坏值一律抛错', async () => {
  const { sanitizeConfigPatch } = await import('../src/server/pet-config.js')
  const base = loadPetConfig({ home: '/nonexistent-home-for-test' })
  const okp = sanitizeConfigPatch({ cast: [{ id: 'kylinzi', size: 320, anchor: 'bottom-right', balance: true }] }, base)
  assert.deepEqual(okp, { cast: [{ id: 'kylinzi', size: 320, anchor: 'bottom-right', balance: true }] })
  assert.deepEqual(sanitizeConfigPatch({ directing: { workStatus: { xisha: ['fail'] } } }, base), { directing: { workStatus: { xisha: ['fail'] } } })
  const bads = [
    [{ cast: [{ id: 'nobody', size: 280 }] }, /cast 之外的 id/],
    [{ cast: [{ id: 'kylinzi', size: 9999 }] }, /size 必须在 120-560/],
    [{ cast: [{ id: 'kylinzi', anchor: 'middle' }] }, /anchor 必须是/],
    [{ cast: [{ id: 'kylinzi', balance: 'yes' }] }, /balance 必须是布尔/],
    [{ directing: { workStatus: { nobody: ['ok'] } } }, /workStatus 里出现了 cast 之外的 id/],
    [{ directing: { workStatus: { xisha: ['meh'] } } }, /只允许 ok\/fail/],
    [{ directing: { other: 1 } }, /directing 不认识字段/],
    [{ theme: 'dark' }, /patch 不认识字段/],
    ['nope', /patch 必须是对象/],
  ]
  for (const [input, re] of bads) assert.throws(() => sanitizeConfigPatch(input, base), re, JSON.stringify(input))
})

test('saveConfigPatch：原子落盘、与既有覆盖层深合并、保存后 loadPetConfig 读到新值', async () => {
  const { saveConfigPatch, loadPetConfig } = await import('../src/server/pet-config.js')
  const { existsSync, mkdirSync, writeFileSync } = await import('node:fs')
  const home = join(mkdtempSync(join(tmpdir(), 'kylin-cfg-')), '')
  // 预置一份既有覆盖层（完整 cast 条目 —— 覆盖层的 cast 是整组替换语义，部分条目本来就非法）：
  // 它应该被保留并与新 patch 合并。
  mkdirSync(join(home, 'dsh-kylin-pet'), { recursive: true })
  writeFileSync(join(home, 'dsh-kylin-pet', 'main-config.jsonc'), JSON.stringify({
    cast: [
      { id: 'kylinzi', name: '麒麟仔', anchor: 'top-right', size: 400, animationDir: 'main-animation', memeDir: 'main-memes', balance: false },
      { id: 'xisha', name: '鲸鱼娘', anchor: 'bottom-left', size: 280, animationDir: 'whale-animation', memeDir: 'whale-memes', balance: false },
    ],
  }))
  const saved = saveConfigPatch({ cast: [{ id: 'xisha', balance: true }] }, { home })
  assert.equal(saved.path, join(home, 'dsh-kylin-pet', 'main-config.jsonc'))
  assert.equal(existsSync(saved.path + '.tmp'), false, '原子写不留 tmp 残骸')
  const cfg = loadPetConfig({ home })
  const kz = cfg.cast.find((p) => p.id === 'kylinzi')
  const xs = cfg.cast.find((p) => p.id === 'xisha')
  assert.equal(kz.size, 400, '既有覆盖层的字段原样保留')
  assert.equal(xs.balance, true, '新 patch 生效')
  assert.equal(saved.config.cast.find((p) => p.id === 'kylinzi').size, 400, '返回的 config = 保存后应当生效的完整配置')
})

test('saveConfigPatch：坏 patch 抛错且不落盘', async () => {
  const { saveConfigPatch } = await import('../src/server/pet-config.js')
  const { existsSync } = await import('node:fs')
  const home = mkdtempSync(join(tmpdir(), 'kylin-cfg-'))
  assert.throws(() => saveConfigPatch({ cast: [{ id: 'kylinzi', size: 42 }] }, { home }), /size 必须在/)
  assert.equal(existsSync(join(home, 'dsh-kylin-pet', 'main-config.jsonc')), false, '失败的保存不得留下半份覆盖层')
})
