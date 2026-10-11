import { KINDS } from '../shared/contract.js'

/** 环形缓冲上限：够覆盖一次「客户端卡了一分钟」的窗口，又不会无限长。 */
export const CAPACITY = 64

/**
 * 诱因板 —— 本片里「引擎刚发生了什么」的唯一出口。
 *
 * 设计约束（都是为了能单测）：
 * - 纯内存、无定时器、无 IO；
 * - 时钟可注入（now），于是 at 在测试里是确定的；
 * - since 的三种输入（缺省 / 数字 / 垃圾）语义各不相同，必须显式。
 */
export function createBoard(opts = {}) {
  const capacity = opts.capacity || CAPACITY
  const now = opts.now || (() => Date.now())
  let cursor = 0
  let items = []

  return {
    /** 记一条诱因，返回它的 seq。未知 kind 直接抛 —— 静默丢弃会让「宠没反应」变成悬案。 */
    push(kind, detail) {
      if (KINDS.indexOf(kind) < 0) throw new Error('unknown stimulus kind: ' + kind)
      cursor += 1
      const line = { seq: cursor, kind: kind, at: now(), detail: detail === undefined ? '' : String(detail) }
      items = items.concat([line])
      if (items.length > capacity) items = items.slice(items.length - capacity)
      return cursor
    },

    /**
     * 拉取诱因。
     * - since 非数字（undefined / '' / 'abc' / 负数）⇒ 起步查询：只报水位、不给历史。
     *   这一步是刻意的：新 client 不该对「它加载之前发生的事」做出反应。
     * - since 是数字 ⇒ 给 seq > since 的全部。
     */
    since(value) {
      const n = Number(value)
      const ok = value !== undefined && value !== null && value !== '' && Number.isFinite(n) && n >= 0
      if (!ok) return []
      return items.filter((s) => s.seq > n)
    },

    /** 当前水位（server 重启后归零）。 */
    get cursor() { return cursor },

    /** 只读快照，给测试与取证用。 */
    get all() { return items.slice() },
  }
}
