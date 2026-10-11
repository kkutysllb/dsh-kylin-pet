import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import * as host from '../src/shared/contract.js'

const SHARED_KEYS = ['ROUTE_PREFIX', 'ASSET', 'CLIPS', 'CLICKS', 'LOOPING', 'KINDS', 'BUSY_CLIP', 'BOND', 'BALANCE_TIERS', 'ANIM_EXT', 'INTENTS', 'TUNING']
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
  // `slots` 是**硬依赖**：舞台挂进宿主槽位 shell.overlay，生死交给宿主（官方 ui-plugin 契约：
  // 不要往 document.body 追加第二个应用）。声明它之后，宿主不支持槽位时插件会 pending，
  // 而不是静默挂到 body 上当没人管的孤儿 —— 那正是「关开关桌宠不消失」的根因。
  assert.deepEqual(canon(client.inject), canon(['slots']))   // 跨 realm：client 的数组不是本 realm 的 Array 实例
  assert.equal(typeof client.apply, 'function')
})

test('工厂能接住 require 形参（漏了它整个条目会激活失败）', () => {
  const src = readFileSync(new URL('../src/stage/client.js', import.meta.url), 'utf8')
  assert.match(src, /factory:\s*\(\s*require\s*\)/)
})

/** V5b：apply 的**注册面**单测。真正「舞台被收干净」由 tools/v5b-teardown.mjs 在真浏览器里验（11 门），
 *  这里只守那个便宜且致命的不变式：**apply 必须收 ctx 并注册 effect**。
 *  用户报的 bug 就是这条缺失 —— 关掉插件开关时客户端模块被卸载、样式被驱逐，
 *  而我们挂在 body 上的舞台没人摘。 */
function loadModuleExports() {
  const src = readFileSync(new URL('../src/stage/client.js', import.meta.url), 'utf8')
  let captured = null
  const win = {
    __ModuleLoader__: {
      load: (mod) => { captured = mod.factory(() => { throw new Error('装载期不该 require') }) },
    },
  }
  // 刻意**不给** document / fetch：apply 里的 start() 会因此失败，
  // 而我们要断言的那件事（同步注册 effect）不依赖它 —— 这正是这条测试便宜的原因。
  vm.runInNewContext(src, { window: win, console: { info: () => {}, warn: () => {} }, performance: performance })
  assert.ok(captured, 'client.js 必须调用 __ModuleLoader__.load')
  return captured
}

test('V5b·1 apply 收 ctx 并注册**恰好一处** effect —— 关插件开关时靠它交还舞台', () => {
  const ex = loadModuleExports()
  const labels = []
  const disposers = []
  const slots = []
  const ctx = {
    effect: (cb, label) => {
      labels.push(label)
      const d = cb()
      if (typeof d === 'function') disposers.push(d)
      return d
    },
    // 形状照宿主 Slots 服务：inject(槽名, 注册回调) 返回收回落子的 disposer。
    slots: {
      inject: (name, register) => { slots.push(name); register(); return () => { slots.pop() } },
      register: () => () => {},
    },
  }
  ex.apply(ctx)
  // v0.1.1 S5：两处 effect —— 舞台（shell.overlay）+ 设置页（settings.section）。
  assert.equal(labels.length, 2, '舞台与设置页各注册一处 effect（多/少都会破坏卸载契约）')
  assert.ok(labels.every((l) => String(l).indexOf('dsh-kylin-pet') >= 0), 'label 要能认出是我们：' + JSON.stringify(labels))
  assert.ok(slots.indexOf('shell.overlay') >= 0 && slots.indexOf('settings.section') >= 0, '两个槽位都要挂：' + JSON.stringify(slots))
  assert.equal(disposers.length, 2)
  // 挂的必须正是「整帧浮动层」+ 设置页两个槽位 —— 挂别处等于又把它塞进某个有主布局里。
  assert.deepEqual(slots, ['shell.overlay', 'settings.section'])
  // 卸载必须**安全**：绝不抛 —— 抛会让整个模块的驱逐失败。
  for (const d of disposers) assert.doesNotThrow(() => d())
  assert.deepEqual(slots, [], '卸载后槽位注册要被收回')
  // 宿主没有 slots 服务时必须**响亮降级**（warn 一句就退出），不许静默挂到 body 上。
  assert.doesNotThrow(() => ex.apply({ effect: () => () => {} }))
})

