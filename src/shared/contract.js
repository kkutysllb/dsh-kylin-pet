/**
 * dsh-kylin-pet v2 共享契约 —— host 侧真源。
 * client（src/stage/client.js）因宿主契约必须是单文件，无法 import 本模块，
 * 因此内部逐字重复一份；test/contract.test.mjs 用 vm 装载 client 并逐键比对：
 * 允许重复、禁止漂移。
 */

/** 宿主路由前缀（除 cordis patch 外的唯一路由真源）。 */
export const ROUTE_PREFIX = '/dsh-kylin-pet-7341'

/** 素材盘几何：640x360 画布、角色高 300、脚底 y=330（实测包围盒，见 spec §4.3）。 */
export const ASSET = Object.freeze({
  W: 640,
  H: 360,
  FOOT_RATIO: 330 / 360,   // 0.91667：盘内脚底线
  CHAR_TOP: 30 / 360,      // 0.08333：命中区上沿（实测并集 y1）
  HIT_X: [0.30, 0.70],     // 命中区横向（实测并集 0.325-0.673，两侧各留 0.025）
  CHAR_RATIO: 300 / 640,   // 角色高 / 盘宽（换算用）
})

/** 行为档 -> 素材文件名（不含扩展名）。19 个名字对应 6 段真实美术（spec 事实 7）。 */
export const CLIPS = Object.freeze({
  idle: ['待机', '状态思考', '状态整理', '碎碎念'],
  walk: ['走路', '状态张望', '状态忙碌'],
  turn: ['转身'],
  held: ['被拎起'],
  sad: ['安抚失败', '余额偏低', '余额告急', '余额见底'],
  happy: ['点击开心', '开心跳跃', '庆祝成功', '余额健康', '余额充裕', '余额正常'],
})

/** 循环播放的档（其余为一次性，播完回 idle）。 */
export const LOOPING = Object.freeze(['idle', 'walk'])

/** 诱因种类：host 产、client 消费。client 逐字镜像一份，由一致性测试钉死。 */
export const KINDS = Object.freeze(['turn-ok', 'turn-fail', 'waiting'])

/** 账本边界（spec §4.5）。夹取与环形上限都从这里取，别在实现里写魔数。 */
export const BOND = Object.freeze({
  AFFINITY_MIN: -100,
  AFFINITY_MAX: 100,
  HISTORY_MAX: 50,
  PAIR_SEP: '|',
})

/** 余额「取不到」的原因（封闭集合）。分类是为了让用户知道该去做什么。 */
export const LEDGER_REASONS = Object.freeze([
  'no-credentials-service',
  'not-configured',
  'network-error',
  'http-error',
  'shape-unrecognized',
  'no-balance-info',
  'unsupported-currency',
])

/** 档位阈值，降序。判定 = 第一个满足 值 >= 阈值 的档；解析不出数字则 tier=null（不猜）。 */
export const BALANCE_TIERS = Object.freeze([
  ['充裕', 100], ['健康', 50], ['正常', 20], ['偏低', 5], ['告急', 1], ['见底', 0],
])

export const ANIM_EXT = '.webm'
export const MEME_EXT = '.png'
