import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import * as host from '../src/shared/contract.js'

const SHARED_KEYS = ['ROUTE_PREFIX', 'ASSET', 'CLIPS', 'LOOPING', 'KINDS', 'BOND', 'BALANCE_TIERS', 'ANIM_EXT', 'INTENTS', 'TUNING']
// INTENTS / TUNING 由 V3b Task 1 引入：**必须在这里**，否则 client 的镜像可以静默漂移 ——
// 上一轮子代理用手工脚本验过相等，但手工验证不是门。（2026-10-11 由子代理 B 项指出。）

/** JSON 归一化 + 键排序：跨 realm 对象不能直接 deepStrictEqual。 */
function canon(value) {
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, walk(v[k])]))
    }
    return v
  }
  return JSON.stringify(walk(JSON.parse(JSON.stringify(value))))
}

/** 在裸 realm 里跑 client.js：只提供 window.__ModuleLoader__，不碰 DOM。 */
function loadClient() {
  const src = readFileSync(new URL('../src/stage/client.js', import.meta.url), 'utf8')
  let captured = null
  const win = {
    __ModuleLoader__: {
      load: (mod) => {
        assert.equal(mod.id, 'dsh-kylin-pet')
        captured = mod.factory(() => { throw new Error('client 不该在装载期 require 任何模块') })
      },
    },
  }
  vm.runInNewContext(src, { window: win, console: console, performance: performance })
  assert.ok(captured, 'client.js 必须调用 window.__ModuleLoader__.load')
  return captured
}

test('client 与 host 契约逐键对齐（允许重复，禁止漂移）', () => {
  const client = loadClient()
  assert.ok(client.__kylinContract, 'client 必须暴露 __kylinContract 供一致性测试')
  for (const k of SHARED_KEYS) {
    assert.equal(canon(client.__kylinContract[k]), canon(host[k]), '契约漂移：' + k)
  }
})

test('client 只暴露 inject / apply / __kylinContract', () => {
  const client = loadClient()
  assert.deepEqual(Object.keys(client).sort(), ['__kylinContract', 'apply', 'inject'])
  assert.deepEqual(canon(client.inject), canon([]))   // 跨 realm：client 的数组不是本 realm 的 Array 实例
  assert.equal(typeof client.apply, 'function')
})

test('工厂能接住 require 形参（漏了它整个条目会激活失败）', () => {
  const src = readFileSync(new URL('../src/stage/client.js', import.meta.url), 'utf8')
  assert.match(src, /factory:\s*\(\s*require\s*\)/)
})
