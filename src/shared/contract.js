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

/**
 * 「任务在忙」播的那一段（V5）。
 *
 * 它在 `walk` 档里 —— 该档是**循环档**，所以长时间重复播它是预期行为，不是卡帧。
 * 提成具名常量而不是在实现里写中文字面量：素材名是会改的（M0 的资产管线重烘过一轮），
 * 而「忙碌时播哪一段」是一个**设计决定**，应当有名字。
 */
export const BUSY_CLIP = '状态忙碌'

/** 诱因种类：host 产、client 消费。client 逐字镜像一份，由一致性测试钉死。
 *
 * `working` / `working-done` 是 V5 加的「执行期」面：前三个都在**回合边界**，
 * 回合开始到结束之间原本没有任何信号，所以任务执行时两只宠完全安静。
 */
export const KINDS = Object.freeze(['turn-ok', 'turn-fail', 'waiting', 'working', 'working-done'])

/**
 * 工具分类表 —— **唯一真源**。host 用它分类、client 用它出文案，两边都不许各写一份。
 *
 * 为什么单独强调：本片之前踩过「同一语义两处各写一份、各自都对、合起来恒假」的坑
 * （`NEAR_RADIUS` host 150 / client 156.8，靠漂移门才发现）。分类表比它更容易分叉 ——
 * 它是**枚举**不是数值，分叉了不会有任何测试红，只会让某类工具悄悄说错话。
 *
 * 名字按真实拼写收录（`Read` 与 `web_search` 并存，因为不同工具族的命名本就不同源）。
 */
export const TOOL_CLASS = Object.freeze({
  read: Object.freeze(['Read', 'Glob', 'Grep', 'read_image', 'read']),
  write: Object.freeze(['Write', 'Edit', 'edit', 'write']),
  exec: Object.freeze(['Bash', 'bash', 'task']),
  web: Object.freeze(['WebSearch', 'WebFetch', 'web_search', 'web_fetch']),
  agent: Object.freeze(['Task', 'subagent', 'dispatch']),
  other: Object.freeze([]),
})

/** 反查表：模块加载时建一次 ⇒ 分类 O(1)（`tools/pre-execute` 是热路径）。 */
const CLASS_OF = new Map()
for (const cls of Object.keys(TOOL_CLASS)) {
  for (const tool of TOOL_CLASS[cls]) CLASS_OF.set(tool, cls)
}

/**
 * 工具名 → 类别。**未知一律落 `other`，不猜** —— 猜错比不说更糟。
 * @param {unknown} name
 * @returns {string}
 */
export function classifyTool(name) {
  if (typeof name !== 'string' || name === '') return 'other'
  return CLASS_OF.get(name) || 'other'
}

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

/** 意图族 → 候选。独处 4 个 + 社交 9 个 = 13 个候选（spec §5）。 */
export const INTENTS = Object.freeze({
  solo: ['idle', 'walk', 'nap', 'look'],
  social: ['approach', 'greet', 'gift', 'tease', 'comfort', 'shoulder', 'chase', 'reconcile', 'contest'],
})

/** 权重与门限。所有魔数只能出现在这里。 */
/** 点击反应池：**独立于 CLIPS.happy** —— 那一档混着「余额充裕」等余额播报段，
 *  参考实现把 clicks（点击反应）与 events.balance（余额）分成两个池，点一下桌宠
 *  冒出「余额充裕」是语义错位。余额播报仍走 tierClip → CLIPS，互不相干。 */
export const CLICKS = Object.freeze(['点击开心', '开心跳跃', '庆祝成功'])

export const TUNING = Object.freeze({
  TICK_SEC: 1,                 // 与 /state 轮询对齐（spec §5：每拍约 1s）
  SOCIAL_RADIUS: 360,          // px：超出这个距离的社交候选改判为 approach 或淘汰
  NEAR_RADIUS: 300,            // px：算「已经在旁边」。**必须大于 separate() 的下限 156.8**
                               // （(280+280)*0.28），否则 near/veryNear 恒假、approach 永不结束。见 client.js 同名字段。
  DRAG_THRESHOLD: 5,           // px：按下后位移 ≥ 此值才算拖拽，小于它松开 = 点击（参考实现 constants.ts 同名常量同值）。client 侧有镜像，漂移门对齐。
  ENERGY_DRAIN: 0.012,         // 每拍衰减
  ENERGY_RECOVER: 0.02,        // 每拍恢复（sleep 时）
  MOOD_REGRESS: 0.01,          // 每拍向 0 回归（spec §4.5：缓慢回归）
  COOLDOWN_SEC: {              // 每个剧本的冷却（**同一对**之间）
    greet: 45, gift: 120, tease: 90, comfort: 150,
    shoulder: 180, chase: 90, reconcile: 300, contest: 120,
  },
  WEIGHT: {
    affinity: 0.02,            // 每点 affinity 对社交候选的加成
    familiarity: 0.01,         // 每点 familiarity 的加成
    moodMatch: 0.6,            // 候选与 mood 的匹配度
    energy: 0.8,               // 精力对独处候选的影响
    distance: 0.4,             // 距离惩罚
    jitter: 0.15,              // 抖动，防止两只永远同拍
  },
  UNLOCK: {                    // spec §7 的解锁条件
    gift: { familiarity: 3 },
    tease: { familiarity: 5 },
    shoulder: { affinity: 20 },
    reconcile: { affinityMax: -1 },
  },
  EFFECT: {                    // spec §7 的关系效果
    greet: { affinity: 2, familiarity: 1 },
    gift: { affinity: 3, familiarity: 1 },
    giftIgnored: { affinity: -1, familiarity: 0 },
    tease: { affinity: -3, familiarity: 1 },
    comfort: { affinity: 5, familiarity: 1 },
    shoulder: { affinity: 3, familiarity: 1 },
    chase: { affinity: 2, familiarity: 1 },
    reconcile: { affinity: 8, familiarity: 2 },
    contest: { affinity: 2, familiarity: 1 },
  },
  PHASE_TIMEOUT_SEC: { approach: 6, open: 2, exchange: 6, settle: 2 },
  MEMORY_MAX: 8,
})
