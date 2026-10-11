#!/usr/bin/env node
/**
 * 把动画与表情包从「用户素材目录」收敛进包内 assets/pet/。
 * 用法: node scripts/import-assets.mjs [源目录]   默认 $DSH_HOME/dsh-kylin-pet/pet
 */
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'

const home = process.env.DSH_HOME || join(homedir(), '.dsh')
const src = resolve(process.argv[2] || join(home, 'dsh-kylin-pet', 'pet'))
const dst = resolve(import.meta.dirname, '..', 'assets', 'pet')

/** 目录 -> 期望文件数（不含隐藏文件） */
const EXPECT = { 'main-animation': 19, 'whale-animation': 19, 'main-memes': 9 }
/** 已知缺口：出厂配置引用它，但来源不存在 —— WARN 不报错 */
const OPTIONAL = { 'whale-memes': 9 }

const list = (dir) => readdirSync(dir).filter((f) => !f.startsWith('.'))

if (!existsSync(src)) {
  console.error('源目录不存在: ' + src)
  process.exit(2)
}

let total = 0
for (const [dir, want] of Object.entries(EXPECT)) {
  const from = join(src, dir)
  if (!existsSync(from)) { console.error('缺目录 ' + dir + '（源: ' + from + '）'); process.exit(1) }
  const files = list(from)
  if (files.length !== want) { console.error(dir + ': ' + files.length + ' 个文件，期望 ' + want); process.exit(1) }
  const to = join(dst, dir)
  mkdirSync(to, { recursive: true })
  for (const f of files) cpSync(join(from, f), join(to, f))
  console.log('OK   ' + dir + ': ' + files.length)
  total += files.length
}
for (const [dir, want] of Object.entries(OPTIONAL)) {
  const from = join(src, dir)
  if (existsSync(from) && list(from).length === want) {
    const to = join(dst, dir); mkdirSync(to, { recursive: true })
    for (const f of list(from)) cpSync(join(from, f), join(to, f))
    console.log('OK   ' + dir + ': ' + want); total += want
  } else {
    console.warn('WARN ' + dir + ' 无来源 —— 出厂配置引用它，相关剧本会降级（已知缺口）')
  }
}
console.log(''); console.log('共入册 ' + total + ' 个文件 -> ' + dst)
