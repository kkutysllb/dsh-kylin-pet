// 动作名对账：用户层 config.animations 引用的全部名字 vs 两宠独占目录实有文件
import { readFileSync, readdirSync } from 'node:fs';
const cfg = JSON.parse(readFileSync('/Users/libing/.kcoder/dsh-kylin-pet/main-config.jsonc', 'utf8'));
const a = cfg.animations;
const names = new Set();
const add = (x) => {
  if (typeof x === 'string') names.add(x);
  else if (Array.isArray(x)) x.forEach((y) => names.add(typeof y === 'string' ? y : y.name));
};
add(a.idle); add(a.turn); add(a.drag); add(a.clicks); add(a.moves.actions.map((x) => x.name));
a.categories.forEach((c) => add(c.actions));
Object.values(a.events).forEach(add);
for (const pet of ['main-animation', 'whale-animation']) {
  const have = new Set(readdirSync('/Users/libing/.kcoder/dsh-kylin-pet/pet/' + pet).map((f) => f.replace(/\.webm$/, '')));
  const missing = [...names].filter((n) => !have.has(n));
  const extra = [...have].filter((n) => !names.has(n));
  console.log(pet + ' 缺:' + (missing.length ? missing.join(',') : '无') + ' | 多余:' + (extra.length ? extra.join(',') : '无'));
}
