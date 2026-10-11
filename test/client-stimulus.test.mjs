import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

/**
 * 出厂导演表（assets/default-config.jsonc 的相应字段）。
 * qualified 只读 cast[].id 与 directing.workStatus —— 判据的输入面就这么大。
 */
const CONFIG = {
  cast: [{ id: 'kylinzi' }, { id: 'xisha' }],
  directing: { workStatus: { kylinzi: ['ok'], xisha: ['fail'] } },
}

/** 在裸 realm 里跑 client.js：只提供 window.__ModuleLoader__，不碰 DOM。 */
function loadClient() {
  const src = readFileSync(new URL('../src/stage/client.js', import.meta.url), 'utf8')
  let captured = null
  const win = {
    __ModuleLoader__: {
      load: (mod) => { captured = mod.factory(() => { throw new Error('client 不该在装载期 require 任何模块') }) },
    },
  }
  vm.runInNewContext(src, { window: win, console: console, performance: performance })
  assert.ok(captured, 'client.js 必须调用 window.__ModuleLoader__.load')
  return captured
}

/** vm 里的数组不是本 realm 的 Array 实例：deepStrictEqual 前先搬过来。 */
const ids = (list) => Array.from(list)

test('qualified：turn-ok 只给 ok 档的宠', () => {
  const { qualified } = loadClient().__kylinContract
  assert.equal(typeof qualified, 'function')
  assert.deepEqual(ids(qualified('turn-ok', CONFIG)), ['kylinzi'])
})

test('qualified：turn-fail 只给 fail 档的宠', () => {
  const { qualified } = loadClient().__kylinContract
  assert.deepEqual(ids(qualified('turn-fail', CONFIG)), ['xisha'])
})

test('qualified：waiting 是双方探头，不查表', () => {
  const { qualified } = loadClient().__kylinContract
  assert.deepEqual(ids(qualified('waiting', CONFIG)), ['kylinzi', 'xisha'])
})

test('qualified：缺 directing.workStatus 时降级不崩', () => {
  const { qualified } = loadClient().__kylinContract
  const bare = { cast: [{ id: 'kylinzi' }, { id: 'xisha' }] }
  assert.deepEqual(ids(qualified('turn-ok', bare)), [])
  assert.deepEqual(ids(qualified('turn-fail', bare)), [])
  assert.deepEqual(ids(qualified('waiting', bare)), ['kylinzi', 'xisha'])
  assert.deepEqual(ids(qualified('turn-ok', undefined)), [])
  assert.deepEqual(ids(qualified('waiting', undefined)), [])
})
