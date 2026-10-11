import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 设定集 ↔ 代码 的对账测试（V4 Task 2）。
 *
 * 为什么需要它：`docs/character-bible.md` 第 5 节声称「台词全量清单」。
 * **声称要么可执行，要么迟早变成假话** —— 写那份设定集时我就犯过一次：
 * 把「计划中」的表标成「与代码逐条对应」，而当时 8 个剧本台词根本没进代码。
 *
 * 所以这里做**双向**对账：
 *   1. 代码里有的，设定集必须有；
 *   2. 设定集标为「已实现」的，代码里必须有；
 *   3. 设定集标为「计划中」却已在代码里的 ⇒ 红（状态标注过期）。
 */

const BIBLE = readFileSync(new URL('../docs/character-bible.md', import.meta.url), 'utf8')
const CLIENT = readFileSync(new URL('../src/stage/client.js', import.meta.url), 'utf8')

/** 切出某个小节正文（到下一个 ### 或 --- 为止）。 */
function section(title) {
  const i = BIBLE.indexOf(title)
  if (i < 0) return ''
  const rest = BIBLE.slice(i + title.length)
  const end = rest.search(/\n### |\n---/)
  return end < 0 ? rest : rest.slice(0, end)
}

/** 解析 markdown 表的正文行（丢掉表头与 |---| 分隔行）。 */
function rows(block) {
  return block.split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('|') && !/^\|[\s:|-]+\|$/.test(l))
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()))
    .filter((cells) => cells.length >= 2 && cells[0] !== '场景' && cells[0] !== '剧本')
}

/** 取代码里 `const NAME = Object.freeze({ ... })` 的平衡花括号内容；找不到回 null。 */
function literal(src, name) {
  const i = src.indexOf('const ' + name + ' = Object.freeze({')
  if (i < 0) return null
  let depth = 0, start = -1
  for (let k = i; k < src.length; k++) {
    if (src[k] === '{') { depth += 1; if (start < 0) start = k }
    else if (src[k] === '}') { depth -= 1; if (depth === 0) return src.slice(start, k + 1) }
  }
  return null
}

/** 从单元格里取反引号包住的键名，例如 `turn-ok` / `greet`。 */
function keyOf(cell) {
  const m = /`([^`]+)`/.exec(cell)
  return m ? m[1] : null
}

/** 取出「键 -> 值」的平铺对象（值必须是字符串字面量）。 */
function flatPairs(body) {
  const out = new Map()
  const re = /(?:"([^"]+)"|'([^']+)'|([A-Za-z_$][\w$-]*))\s*:\s*'([^']*)'/g
  let m
  while ((m = re.exec(body))) out.set(m[1] || m[2] || m[3], m[4])
  return out
}

/** 取出「键 -> { kylinzi, xisha }」的嵌套对象。 */
function nestedPairs(body) {
  const out = new Map()
  const re = /(?:"([^"]+)"|'([^']+)'|([A-Za-z_$][\w$-]*))\s*:\s*\{([^}]*)\}/g
  let m
  while ((m = re.exec(body))) {
    const inner = flatPairs('{' + m[4] + '}')
    out.set(m[1] || m[2] || m[3], inner)
  }
  return out
}

/* 代码里两张表：V3b Task 4 之后 LINES_STIMULUS 是诱因面、LINES 是剧本面；
   在那之前 LINES 就是诱因面、剧本面还不存在。 */
const stimBody = literal(CLIENT, 'LINES_STIMULUS') || literal(CLIENT, 'LINES')
const scriptBody = literal(CLIENT, 'LINES_STIMULUS') ? literal(CLIENT, 'LINES') : null
const stimName = stimBody ? (literal(CLIENT, 'LINES_STIMULUS') ? 'LINES_STIMULUS' : 'LINES') : null

test('设定集 5.1 ↔ 代码诱因文案表：双向一致', () => {
  assert.ok(stimName, '代码里找不到诱因文案表（LINES_STIMULUS 或 LINES）')
  const inCode = flatPairs(stimBody)
  const inBible = new Map()
  for (const cells of rows(section('### 5.1'))) {
    const k = keyOf(cells[0])
    if (k) inBible.set(k, cells[1])
  }
  assert.ok(inCode.size > 0, stimName + ' 解析为空')
  for (const [k, v] of inCode) assert.equal(inBible.get(k), v, '代码有而设定集没有/不一致：' + k)
  for (const [k, v] of inBible) assert.equal(inCode.get(k), v, '设定集有而代码没有/不一致：' + k)
})

test('设定集 5.2 ↔ 代码剧本文案表：双向一致（V3b 未落地时跳过并说明理由）', (t) => {
  if (!scriptBody) {
    t.diagnostic('SKIP：代码里还没有剧本文案表（V3b Task 4 未落地）—— 这不是通过，是「尚无可对账之物」。')
    assert.equal(scriptBody, null)
    return
  }
  const inCode = nestedPairs(scriptBody)
  const bibleRows = rows(section('### 5.2'))
  assert.ok(bibleRows.length > 0, '设定集 5.2 表格解析为空')
  for (const cells of bibleRows) {
    const k = keyOf(cells[0])
    if (!k) continue
    const pair = inCode.get(k)
    for (const [idx, pet] of [[1, 'kylinzi'], [2, 'xisha']]) {
      const cellText = cells[idx]
      const none = /^（?无）?$|^\(无\)$/.test(cellText)
      if (none) {
        assert.ok(!pair || !pair.has(pet), '设定集标为「无」但代码里有：' + k + '.' + pet)
      } else {
        assert.ok(pair, '代码里缺剧本条目：' + k)
        assert.equal(pair.get(pet), cellText, '不一致：' + k + '.' + pet)
      }
    }
  }
  for (const k of inCode.keys()) {
    assert.ok(bibleRows.some((c) => keyOf(c[0]) === k), '代码有而设定集 5.2 没有：' + k)
  }
})

test('状态标注不许过期：标为「计划中」的若已进代码，测试 2 就必须已经能对账', () => {
  const hasMark = BIBLE.includes('### 5.2')
  assert.ok(hasMark, '设定集缺少 5.2（计划中）小节 —— 状态标注是这套对账的支点')
})
