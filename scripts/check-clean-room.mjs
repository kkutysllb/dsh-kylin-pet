#!/usr/bin/env node
/**
 * clean-room 门（两条独立判据）：
 *  A 结构：上游工作树（staging/**）不得进入 git 索引；
 *  B 特征串：源码面（src/ tools/ scripts/）零命中上游标识。
 * 例外：README / package.json / plans 里的 PC2005-cloud/dsh-pet 是 MIT 出处的正当
 * 注明（披露机制来源），故**不在扫描面内** —— 这条例外必须留在代码注释里。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const NL = String.fromCharCode(10)
const SOURCE_GLOBS = ['src', 'tools', 'scripts']
/**
 * 门禁自身必须排除（自指）：它的 DENY 表与注释里必然逐字出现这些特征串，
 * 不排除则门永远红。这不是放水 —— 别的文件出现同样的字面量照样被抓。
 */
const SELF = 'scripts/check-clean-room.mjs'
const DENY = [
  'PC2005',          // 上游仓库作者
  'dsh-pet',         // 上游包名（本仓叫 dsh-kylin-pet，不含该子串）
  'whale-poses',     // 上游素材目录命名
  'KylinPetHost',    // 上游类名
]

/**
 * 源码面 = 已入册文件 ∪ 未跟踪但未被忽略的文件。
 * 为什么带上 --others：门要判的是「本仓可见的源码面是否干净」，
 * 而只在受控文件里判，会让「尚未 git add 的在飞源码 / 负对照诱饵」免疫 —— 绿得没有判别力。
 * staging/（上游工作树）与 node_modules 由 .gitignore 挡在 --exclude-standard 外。
 */
/**
 * -c core.untrackedCache=false：关掉未跟踪缓存。实测有一次刚建好的诱饵没被列出来
 * （目录 mtime 粒度内的缓存陈旧），门因此放过它 —— 一个会偶发漏看的门是不可信的。
 */
const listed = execFileSync('git', ['-c', 'core.untrackedCache=false', 'ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split(NL).filter(Boolean)
const leaked = listed.filter((p) => p.startsWith('staging/'))
const files = listed
  .filter((p) => SOURCE_GLOBS.some((g) => p === g || p.startsWith(g + '/')))
  .filter((p) => p !== SELF)

const hits = []
const missing = []
for (const f of files) {
  // 索引里可能留着「已删除但尚未重建索引」的源码文件（清仓期有 11 个上游遗留，实测会 ENOENT 崩）：
  // 磁盘上已不存在 ⇒ 不构成源码面，跳过而不是崩。Task 4 重建索引后这里恒为空。
  if (!existsSync(f)) { missing.push(f); continue }
  readFileSync(f, 'utf8').split(NL).forEach((line, i) => {
    for (const d of DENY) if (line.includes(d)) hits.push(f + ':' + (i + 1) + '  ' + d + '  | ' + line.trim().slice(0, 100))
  })
}

let bad = 0
if (leaked.length) { bad++; console.log('FAIL 结构：上游工作树入册 ' + leaked.length + ' 条'); leaked.slice(0, 5).forEach((p) => console.log('      - ' + p)) }
else console.log('PASS 结构：git 索引内无 staging/**')
if (missing.length) console.log('NOTE 跳过 ' + missing.length + ' 个索引内已删除的源文件（' + missing.slice(0, 3).join(', ') + ' …）；重建索引后应归零')
if (hits.length) { bad++; console.log('FAIL 特征串：源码面命中 ' + hits.length + ' 处'); hits.slice(0, 10).forEach((h) => console.log('      - ' + h)) }
else console.log('PASS 特征串：' + files.length + ' 个源码文件 / ' + DENY.length + ' 条特征串，零命中')

process.exit(bad ? 1 : 0)
