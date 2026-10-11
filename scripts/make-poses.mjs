#!/usr/bin/env node
// 静帧姿势 → 透明动画组装（上游视频管线 chroma_step02/normalize_step03/encode_thumbs 的静帧版）：
//   ① HSV 色相抠像（照抄上游判定：绿相 70–170、饱和/明度下限、6° 羽化——蓝白角色零误伤）
//   ② alphaextract,bbox 内容边界 → 裁剪 → 等比缩放到目标身高 → 640×360 画布、脚底 y=330、水平居中
//   ③ 双帧循环（待机/走路）与静帧（表情）组装，libvpx-vp9 yuva420p CRF40 编码（-auto-alt-ref 0 保 alpha）
// 用法：node scripts/make-poses.mjs <posesDir> <outDir> [身高px=300]
// 产出：待机/走路/转身/被拎起/点击开心/安抚失败 六个 .webm（事件档名由调用方拷贝）。
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const FFMPEG = '/opt/homebrew/bin/ffmpeg';
const [posesDir, outDir, heightArg] = process.argv.slice(2);
if (!posesDir || !outDir) {
  console.error('用法: make-poses.mjs <posesDir> <outDir> [身高px]');
  process.exit(1);
}
const HEIGHT = Number(heightArg ?? 300);
const W = 640, H = 360, FEET_Y = 330;
mkdirSync(outDir, { recursive: true });
const tmp = (n) => join(outDir, '.tmp-' + n);

/** ① 抠像：png → rgba 原始像素 → HSV 判定 → 透明 png */
function chroma(pngIn, pngOut) {
  const p = spawnSync(FFMPEG, ['-y', '-v', 'error', '-i', pngIn, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 64 * 1024 * 1024 });
  if (p.status !== 0) throw new Error('decode fail: ' + p.stderr);
  const px = p.stdout;
  const n = px.length / 4;
  for (let i = 0; i < n; i++) {
    const r = px[i * 4] / 255, g = px[i * 4 + 1] / 255, b = px[i * 4 + 2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let a = 255;
    if (d !== 0 && mx >= 0.15) {
      let hue;
      if (mx === r) hue = 60 * (((g - b) / d) % 6);
      else if (mx === g) hue = 60 * ((b - r) / d + 2);
      else hue = 60 * ((r - g) / d + 4);
      if (hue < 0) hue += 360;
      const sat = d / mx;
      // 上游判定：绿相 70–170 且 sat≥0.15、val≥0.15 判背景；hue ±6° 线性羽化
      if (sat >= 0.15 && mx >= 0.15 && hue >= 70 && hue <= 170) {
        const edge = Math.min(hue - 70, 170 - hue);
        a = edge < 6 ? Math.round((edge / 6) * 255) : 0;
      }
    }
    px[i * 4 + 3] = a;
  }
  const enc = spawnSync(FFMPEG, ['-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W0}x${H0}`, '-i', '-', '-frames:v', '1', pngOut], { input: px, maxBuffer: 64 * 1024 * 1024 });
  if (enc.status !== 0) throw new Error('encode fail: ' + enc.stderr);
}
// 原始尺寸探针（chroma 需要回写同尺寸）
function probeSize(file) {
  const p = spawnSync('/opt/homebrew/bin/ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]);
  const [w, h] = p.stdout.toString().trim().split(',');
  return { w: Number(w), h: Number(h) };
}

/** ② bbox → 裁剪缩放 → 画布（脚底 y=330 居中） */
function toCanvas(keyed, canvasOut) {
  const p = spawnSync(FFMPEG, ['-v', 'info', '-i', keyed, '-vf', 'alphaextract,bbox', '-f', 'null', '-']);
  const m = p.stderr.toString().match(/x1:(\d+) x2:(\d+) y1:(\d+) y2:(\d+)/);
  if (!m) throw new Error('bbox 失败: ' + p.stderr.slice(-300));
  const x1 = +m[1], x2 = +m[2], y1 = +m[3], y2 = +m[4];
  const cw = x2 - x1 + 1, ch = y2 - y1 + 1;
  // 裁剪 → 等比缩放 → format=rgba → pad 到 640×360（水平居中、脚底对齐 FEET_Y）。
  // 不用 overlay："[1]overlay" 会把唯一指定的 [1] 当主输入、色底被 auto-connect 到第二输入，
  // 产物尺寸=裁剪尺寸（真踩过），concat 要求全部输入同尺寸即炸。pad 的 x/y 表达式引用
  // iw/ih（缩放后实际宽高），颜色 black@0.0 = 全透明底。
  const e = spawnSync(FFMPEG, ['-y', '-v', 'error', '-i', keyed, '-vf',
    `crop=${cw}:${ch}:${x1}:${y1},scale=-2:${HEIGHT}:flags=lanczos,format=rgba,pad=${W}:${H}:(ow-iw)/2:${FEET_Y}-ih:color=black@0.0`,
    '-frames:v', '1', canvasOut]);
  if (e.status !== 0) throw new Error('canvas fail: ' + e.stderr);
}

/** ③ 帧序列 → webm（durations 为每帧显示秒数，循环到 ≥minDur） */
function encode(frames, durations, out, minDur) {
  let total = 0;
  const seq = [];
  while (total < minDur) {
    frames.forEach((f, i) => { seq.push({ f, d: durations[i] }); total += durations[i]; });
  }
  const args = [];
  const fc = seq.map((s, i) => { args.push('-loop', '1', '-t', String(s.d), '-i', s.f); return `[${i}]`; }).join('');
  const chain = `${fc}concat=n=${seq.length}:v=1,settb=AVTB,fps=24,format=yuva420p`;
  args.push('-filter_complex', chain, '-c:v', 'libvpx-vp9', '-crf', '40', '-b:v', '0', '-auto-alt-ref', '0', '-row-mt', '1', '-an', '-y', out);
  const e = spawnSync(FFMPEG, args, { maxBuffer: 32 * 1024 * 1024 });
  if (e.status !== 0) throw new Error('encode ' + out + ': ' + e.stderr.slice(-400));
}

const need = ['pose-idle-a.png', 'pose-idle-b.png', 'pose-walk-a.png', 'pose-walk-b.png', 'pose-happy.png', 'pose-sad.png', 'pose-drag.png', 'pose-turn.png'];
for (const f of need) if (!existsSync(join(posesDir, f))) throw new Error('缺姿势图: ' + f);

let W0 = 0, H0 = 0;
const canvas = {};
for (const f of need) {
  const keyed = tmp('keyed-' + f);
  const sz = probeSize(join(posesDir, f));
  W0 = sz.w; H0 = sz.h;
  chroma(join(posesDir, f), keyed);
  const cv = tmp('canvas-' + f);
  toCanvas(keyed, cv);
  canvas[f.replace('.png', '')] = cv;
}
// 组装：待机=呼吸双帧循环 4.8s；走路=双帧循环 2.88s；其余静帧 2.5s
encode([canvas['pose-idle-a'], canvas['pose-idle-b']], [1.2, 1.2], join(outDir, '待机.webm'), 4.8);
encode([canvas['pose-walk-a'], canvas['pose-walk-b']], [0.36, 0.36], join(outDir, '走路.webm'), 2.88);
encode([canvas['pose-turn']], [2.5], join(outDir, '转身.webm'), 2.5);
encode([canvas['pose-drag']], [2.5], join(outDir, '被拎起.webm'), 2.5);
encode([canvas['pose-happy']], [2.5], join(outDir, '点击开心.webm'), 2.5);
encode([canvas['pose-sad']], [2.5], join(outDir, '安抚失败.webm'), 2.5);
for (const f of need) { for (const t of ['keyed-' + f, 'canvas-' + f]) { try { unlinkSync(tmp(t)); } catch {} } }
console.log('完成 →', outDir);
