#!/usr/bin/env node
// 麒麟仔专属表情包安装器：assets/pet/main-memes（正本）→ $DSH_HOME/dsh-kylin-pet/pet/main-memes（种类独占目录）。
// 独占目录存在后，麒麟仔（素材根 main）的梗图池只认自己这 9 张，不再与鲸鱼娘共用包内默认池。
// 注意取 home 用 os.homedir()（HOME 环境变量缺失时回落 passwd 记录，勿直接读 process.env.HOME）。
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
const src = new URL('../assets/pet/main-memes/', import.meta.url).pathname;
const home = process.env.DSH_HOME ?? join(homedir(), '.kcoder');
const dst = join(home, 'dsh-kylin-pet', 'pet', 'main-memes');
mkdirSync(dst, { recursive: true });
const files = readdirSync(src).filter((f) => f.endsWith('.png'));
for (const f of files) copyFileSync(join(src, f), join(dst, f));
console.log('installed ' + files.length + ' memes -> ' + dst);
