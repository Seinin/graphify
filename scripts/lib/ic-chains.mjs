/**
 * 初始条件（S09）子图的**产物链**定义——唯一真源（脚本侧）。
 *
 * 这一段是"改名换内容"：从前的 `ic-blocks.mjs` 描述的是**三块骨架**
 * （初始加载 / 核心计算 / 产物与收尾）；现在描述的是**五块、按产物链分**。
 * 四个脚本（重组 / 导入 / 重置 / 断言）都从这里取成员表与关系计划，各写一份必然漂移。
 *
 * 为什么改成按产物链分
 * --------------------
 * 旧的三块把「四个产物的尾段」与「它们共用的前缀」塞进同一个容器，于是
 * `实空间化` 那一步挂了 4 条出边（→ 低分辨 / 一阶速度 / 相对速度 / 二阶修正），
 * 读图要顺着同一堆箭头来回找。拆开之后每条链在自己的容器里自足：
 * 需要哪一步就在这条链里出现一次（同名、靠容器区分）。
 *
 * 五块怎么分（证据在 `src/py21cmfast/src/InitialConditions.c` 的 ComputeInitialConditions，:547–:776）
 * ---------------------------------------------------------------------------------------------
 *   · 前置（`ic:g-load`）：`seed_rng_threads`(:572，定义 rng.c:30)、两个 k 空间工作盒
 *     malloc(:608/:610)、`init_ps()`(:619，定义 cosmology.c:536)；这些资源在收尾被释放。
 *   · 密度链（`ic:g-dens`）：抽样③(:667-669) → 共轭修正④(同处，给出**完整 δ_k**) →
 *     实空间化⑤ `dft_c2r_cube`(:673) 得 `hires_density` → 低分辨⑥ `filter_box`(:703，
 *     仅 DIM!=HII_DIM) + `dft_c2r`(:710) + 采样(:715-732) 得 `lowres_density`。
 *   · 速度链（`ic:g-vel`）：同一份前缀（③④，本链各一份）→ 一阶 ZA ⑦
 *     `compute_velocity_fields`(:740，函数 :299-364) → 二阶 ⑨ `compute_velocity_fields_2LPT`
 *     (:752，函数 :366-544)；⑨ 会在 `:507` **覆写 δ_k 工作盒**，所以它排在本链末尾。
 *   · vcb 链（`ic:g-vcb`）：同一份前缀 → 相对速度 ⑧ `compute_relative_velocities`
 *     (:735，函数 :141-238)，它自己滤波(:198)、反变换(:205)、采样累加平方(:208-226)。
 *   · 收尾（`ic:g-out`）：deallocate(:760-770) + 5 个输出交给下游（文档 §1.5）。
 *
 * 关键事实（旧图记错、本次按代码改对）
 * -----------------------------------
 * `HIRES_box_saved` 是**完整 δ_k**（k 空间）的副本，产生于 :667-669（或外部密度分支 :660-665），
 * **不是** `dft_c2r_cube`(:673) 之后的实空间产物；尾段前又用 `:699 memcpy` 把它拷回工作盒。
 * 所以真正的分歧点在 **④（完整 δ_k）**，⑥⑦⑧⑨ 四条尾段全部由它派生、各自再做滤波/反变换/采样。
 * 旧图里 `实空间化 → vcb`（HIRES_box_saved）那条边因此是错的，本次改由 ④ 接出。
 *
 * 重复份的口径
 * ------------
 * 抽样③、共轭④ 在**速度链与 vcb 链里各有一份副本**（`ic:vel:*` / `ic:vcb:*`）：id 不同、
 * `parent` 不同，其余字段（label / summary / refs / tags / topics / conditional）**逐字复制**
 * 原份——所以图上同名，读者靠容器区分。密度链那一份**沿用原 id**，原 id 上的文档锚点与
 * 源码引用因此零改动。这条"剖分图内可以出现重复展示份"的边界由
 * `graphify-code-topology` 的一条要求守着。
 *
 * 收尾只接"首次出现的那一份"
 * --------------------------
 * 资源只被创建一次，所以清理的 4 条入边接 前置的种子/功率谱 + 密度链的抽样/实空间化，
 * 不按链各接一条（否则清理节点又变成多入边枢纽）。
 *
 * 用法
 * ----
 *   import { applyIcChains, IC_BLOCKS, IC_MEMBER_BLOCK } from './lib/ic-chains.mjs'
 *   const next = applyIcChains(graph.nodes, graph.edges)   // 幂等：已是目标形状时结果等价
 */
export { applyIcChains, layoutIcChains, icPlanIssues }

/** 焦点模块：五块挂在它下面（它的直接子节点就是这五块） */
export const ICS = 'atlas:fig1:prep:ics'

/** 历史遗留：曾用一个大框兜住 13 个 S09 步骤；遇到它一律删掉 */
export const LEGACY_IC_FRAME = 'atlas:ic-frame'

/** 被本次撤掉的旧容器：它把四个尾段与共用前缀塞在一起 */
export const IC_RETIRED_BLOCK_IDS = ['ic:g-core']

export const IC_BLOCKS = [
  {
    id: 'ic:g-load',
    label: '前置（输入 · 种子 · 功率谱）',
    atlas: 'S09.1 + S09.2',
    refSource: 'ic:proc-seed',
    summary:
      '整条链的一次性准备：派生逐线程种子、把宇宙学参数整理成 cosmo_consts 与 P(k)。' +
      '这些资源在收尾被释放，所以三条链都从这里取依赖，但**只有这一份**（不按链重复）。' +
      '证据：InitialConditions.c:572（seed_rng_threads，定义 rng.c:30）、:608/:610（两个 k 空间工作盒）、' +
      ':619（init_ps，定义 cosmology.c:536）。',
    members: ['ic:art-inputs', 'ic:proc-seed', 'ic:proc-ps'],
  },
  {
    id: 'ic:g-dens',
    label: '密度链（高分辨密度 · 低分辨密度）',
    atlas: 'S09.2 + S09.3',
    refSource: 'ic:proc-sample',
    summary:
      '从种子与 P(k) 抽样 k 空间高斯场 → 共轭对称修正得到**完整 δ_k** → 反变换得高分辨密度 δ_hires；' +
      '同一份 δ_k 再经顶帽滤波与采样得低分辨密度 δ_lowres。两条产物在同一条链里，因为它们共用的前缀到 ④ 为止，' +
      '分歧只在末段（反变换 vs 滤波+采样）。证据：:667-669（抽样与共轭，同时存下完整 δ_k）、' +
      ':673（dft_c2r_cube）、:702-703/:710/:715-732（滤波与低分辨采样）。',
    members: ['ic:proc-sample', 'ic:proc-conj', 'ic:proc-realize', 'ic:proc-lowres'],
  },
  {
    id: 'ic:g-vel',
    label: '速度链（一阶 ZA · 二阶 2LPT）',
    atlas: 'S09.4',
    refSource: 'ic:proc-2lpt-v',
    summary:
      '本链自带一份前缀（抽样与共轭，与原份同名）：从完整 δ_k 出发，k 空间求梯度得 Zel’dovich 速度；' +
      '再按 Scoccimarro(1998) 附录 D 合成 φ₂ 得二阶位移对应速度。2LPT 会把 φ₂ 写回 δ_k 工作盒（:507），' +
      '所以它必须排在一阶速度之后。证据：:740（compute_velocity_fields，函数 :299-364，可选滤波 :332）、' +
      ':751-752（PERTURB_ALGORITHM==2 时才进；compute_velocity_fields_2LPT，函数 :366-544）。',
    members: ['ic:vel:proc-sample', 'ic:vel:proc-conj', 'ic:proc-v1', 'ic:proc-2lpt-phi', 'ic:proc-2lpt-v'],
  },
  {
    id: 'ic:g-vcb',
    label: 'vcb 链（重子-暗物质相对速度）',
    atlas: 'S09.4',
    refSource: 'ic:proc-vcb',
    summary:
      '本链自带一份前缀（抽样与共轭，与原份同名）：对三个方向按 v_i(k)=δ_k·i·k_i/k·sqrt(P_vcb/P)·c_kms 求场，' +
      '**自己**滤波到低分辨（:198）再反变换（:205）、采样累加三个分量的平方得到 lowres_vcb。' +
      '只在 USE_RELATIVE_VELOCITIES 时进入（:734）。',
    members: ['ic:vcb:proc-sample', 'ic:vcb:proc-conj', 'ic:proc-vcb'],
  },
  {
    id: 'ic:g-out',
    label: '产物与收尾（交付下游 · 资源回收）',
    atlas: 'S09.5',
    refSource: 'ic:proc-downstream',
    summary:
      '收束这一层：五个产物交给下游（S10 微扰场与速度），随后回收资源——清 FFTW 线程与计划、' +
      '释放两个 k 空间工作盒、free_ps()、free_rng_threads()。清理只发生一次，所以它的入边只接' +
      '**首次出现的那一份**（前置的种子与功率谱、密度链的抽样与实空间化）。' +
      '证据：:760-770（deallocate）；资源创建处 :572 / :608 / :610 / :619，FFTW 计划首次由 :673 建立。',
    members: ['ic:proc-cleanup', 'ic:proc-downstream'],
  },
]

export const IC_BLOCK_IDS = IC_BLOCKS.map((block) => block.id)

/** 成员（含重复份）→ 所属块：归位与断言都用它，避免两处各写一遍对应关系 */
export const IC_MEMBER_BLOCK = new Map(
  IC_BLOCKS.flatMap((block) => block.members.map((id) => [id, block.id])),
)

/**
 * 重复份 → 原份：副本除 `id` / `parent` / `position` / 时间戳外**逐字复制**原份。
 * 只给"被两条以上链依赖"的步骤建副本（抽样③、共轭④ 各两份）。
 */
export const IC_DUPLICATES = new Map([
  ['ic:vel:proc-sample', 'ic:proc-sample'],
  ['ic:vel:proc-conj', 'ic:proc-conj'],
  ['ic:vcb:proc-sample', 'ic:proc-sample'],
  ['ic:vcb:proc-conj', 'ic:proc-conj'],
])

/**
 * 哪几个重复份**自身**也属于可选支路（vcb 链整条只在 USE_RELATIVE_VELOCITIES 开启时存在）。
 *
 * 为什么单列一个集合：重复份是 `{ ...原份 }` 复制出来的，而原份（抽样 / 共轭）是必走的，
 * 复制出来的 `conditional` 自然是 false。不显式声明的话，每次重建都会把 vcb 支路
 * 悄悄变回实线——那类"标注在构建里被重置"的问题就是这么来的。
 */
export const IC_CONDITIONAL_DUPLICATES = new Set(['ic:vcb:proc-sample', 'ic:vcb:proc-conj'])

/**
 * IC 内部的关系计划（重建时以它为准）。
 *
 * - `id` 沿用原有边 id（`ic:e01` / `atlas:e:flow:…`）以便保留既有的 `note` 与时间戳；
 *   新边按同一命名法取 id（`atlas:e:flow:<源短名>=><目标短名>:<产物>`，重复份的短名带链前缀）。
 * - `type`：两条前置边是 `depends_on`（"要用到"），其余是 `derives_from`（"由它派生"）。
 * - 产物写在 `label` 上，不占节点。
 */
export const IC_CHAIN_EDGES = [
  // 前置
  { id: 'ic:e01', source: 'ic:art-inputs', target: 'ic:proc-seed', label: '提供 random_seed', type: 'depends_on' },
  { id: 'ic:e02', source: 'ic:art-inputs', target: 'ic:proc-ps', label: '提供 DIM / BOX_LEN / 功率谱开关', type: 'depends_on' },

  // 密度链
  { id: 'atlas:e:flow:proc-seed=>proc-sample:art-seeds', source: 'ic:proc-seed', target: 'ic:proc-sample', label: '种子池', type: 'derives_from' },
  { id: 'atlas:e:flow:proc-ps=>proc-sample:art-pk', source: 'ic:proc-ps', target: 'ic:proc-sample', label: 'cosmo_consts 与 P(k)', type: 'derives_from' },
  { id: 'atlas:e:flow:proc-sample=>proc-conj:art-dk', source: 'ic:proc-sample', target: 'ic:proc-conj', label: 'δ_k（半空间）', type: 'derives_from' },
  { id: 'atlas:e:flow:proc-conj=>proc-realize:art-dkfull', source: 'ic:proc-conj', target: 'ic:proc-realize', label: 'δ_k（完整）', type: 'derives_from' },
  { id: 'atlas:e:flow:proc-conj=>proc-lowres:art-dkfull', source: 'ic:proc-conj', target: 'ic:proc-lowres', label: 'δ_k（完整）', type: 'derives_from' },
  { id: 'atlas:e:flow:proc-realize=>proc-downstream:art-hires', source: 'ic:proc-realize', target: 'ic:proc-downstream', label: 'δ_hires（高分辨密度）', type: 'derives_from' },
  { id: 'atlas:e:flow:proc-lowres=>proc-downstream:art-lowres', source: 'ic:proc-lowres', target: 'ic:proc-downstream', label: 'δ_lowres（低分辨密度）', type: 'derives_from' },

  // 速度链（前半段是本链自己的重复份）
  { id: 'atlas:e:flow:proc-seed=>vel-proc-sample:art-seeds', source: 'ic:proc-seed', target: 'ic:vel:proc-sample', label: '种子池', type: 'derives_from' },
  { id: 'atlas:e:flow:proc-ps=>vel-proc-sample:art-pk', source: 'ic:proc-ps', target: 'ic:vel:proc-sample', label: 'cosmo_consts 与 P(k)', type: 'derives_from' },
  { id: 'atlas:e:flow:vel-proc-sample=>vel-proc-conj:art-dk', source: 'ic:vel:proc-sample', target: 'ic:vel:proc-conj', label: 'δ_k（半空间）', type: 'derives_from' },
  { id: 'atlas:e:flow:vel-proc-conj=>proc-v1:art-dkfull', source: 'ic:vel:proc-conj', target: 'ic:proc-v1', label: 'δ_k（完整）', type: 'derives_from' },
  // 2LPT 支路：只有 PERTURB_ALGORITHM == "2LPT" 时才成立——节点与边都要标（画布虚线）
  { id: 'atlas:e:flow:vel-proc-conj=>proc-2lpt-phi:art-dkfull', source: 'ic:vel:proc-conj', target: 'ic:proc-2lpt-phi', label: 'δ_k（完整）', type: 'derives_from', conditional: true },
  { id: 'atlas:e:flow:proc-2lpt-phi=>proc-2lpt-v:art-phi2', source: 'ic:proc-2lpt-phi', target: 'ic:proc-2lpt-v', label: '∇²φ₂（k 空间场）', type: 'derives_from', conditional: true },
  { id: 'atlas:e:flow:proc-v1=>proc-downstream:art-v1', source: 'ic:proc-v1', target: 'ic:proc-downstream', label: 'ZA 速度 vx / vy / vz', type: 'derives_from' },
  { id: 'atlas:e:flow:proc-2lpt-v=>proc-downstream:art-2lpt', source: 'ic:proc-2lpt-v', target: 'ic:proc-downstream', label: '2LPT 速度', type: 'derives_from', conditional: true },

  // vcb 链（前半段是本链自己的重复份）：整条只在 USE_RELATIVE_VELOCITIES 开启时才成立
  { id: 'atlas:e:flow:proc-seed=>vcb-proc-sample:art-seeds', source: 'ic:proc-seed', target: 'ic:vcb:proc-sample', label: '种子池', type: 'derives_from', conditional: true },
  { id: 'atlas:e:flow:proc-ps=>vcb-proc-sample:art-pk', source: 'ic:proc-ps', target: 'ic:vcb:proc-sample', label: 'cosmo_consts 与 P(k)', type: 'derives_from', conditional: true },
  { id: 'atlas:e:flow:vcb-proc-sample=>vcb-proc-conj:art-dk', source: 'ic:vcb:proc-sample', target: 'ic:vcb:proc-conj', label: 'δ_k（半空间）', type: 'derives_from', conditional: true },
  { id: 'atlas:e:flow:vcb-proc-conj=>proc-vcb:art-dkfull', source: 'ic:vcb:proc-conj', target: 'ic:proc-vcb', label: 'δ_k（完整）', type: 'derives_from', conditional: true },
  { id: 'atlas:e:flow:proc-vcb=>proc-downstream:art-vcb', source: 'ic:proc-vcb', target: 'ic:proc-downstream', label: 'lowres_vcb（相对速度）', type: 'derives_from', conditional: true },

  // 收尾：清理只接首次出现的那一份（资源只被创建一次）
  { id: 'atlas:e:flow:proc-seed=>proc-cleanup:art-seeds', source: 'ic:proc-seed', target: 'ic:proc-cleanup', label: '种子池', type: 'derives_from' },
  { id: 'atlas:e:flow:proc-ps=>proc-cleanup:art-pk', source: 'ic:proc-ps', target: 'ic:proc-cleanup', label: '功率谱表', type: 'derives_from' },
  { id: 'atlas:e:flow:proc-sample=>proc-cleanup:art-dk', source: 'ic:proc-sample', target: 'ic:proc-cleanup', label: '两个 k 空间工作盒', type: 'derives_from' },
  { id: 'atlas:e:flow:proc-realize=>proc-cleanup:art-saved', source: 'ic:proc-realize', target: 'ic:proc-cleanup', label: 'FFTW 计划缓存', type: 'derives_from' },
]

/* ---------------- 尺寸估计与网格（与 src/graph/{labels,pack}.ts 同口径） ---------------- */

const NODE_FONT = 13
const GROUP_FONT = 18
const GROUP_PADDING = 14
const LINE_HEIGHT = 1.2
const GAP = 24
/** 容器内部单行横排的数量上限；超过就折成固定 4 列（与 pack.ts 同口径） */
const MAX_ROW_LEAVES = 7
/** 五块之间的竖直间距：比块内间距大，读得出"几块"而不是一块 */
const BLOCK_GAP = 46

const textWidth = (text, fontSize) => {
  const value = String(text ?? '')
  const cjk = (value.match(/[\u3000-\u9fff\uff00-\uffef]/g) ?? []).length
  return cjk * fontSize + (value.length - cjk) * fontSize * 0.55
}

function boxSizeOf(node) {
  const natural = textWidth(node.label, NODE_FONT) + 20
  const width = Math.round(Math.min(240, Math.max(116, natural)))
  const wrapWidth = width - 20
  let lines = 1
  let current = ''
  for (const char of String(node.label ?? '')) {
    const next = current + char
    if (current && textWidth(next, NODE_FONT) > wrapWidth) {
      lines += 1
      current = char
    } else {
      current = next
    }
  }
  return { width, height: Math.max(38, Math.round(lines * NODE_FONT * LINE_HEIGHT) + 14) }
}

const round1 = (value) => Math.round(value * 10) / 10

/** 按给定列数排一块：列宽取该列最宽、行高取该行最高（与 pack.ts 的 gridByColumns 同口径） */
function layoutByColumns(sizes, cols) {
  const rows = Math.ceil(sizes.length / cols)
  const colWidths = Array.from({ length: cols }, (_, col) =>
    Math.max(...sizes.filter((_, index) => index % cols === col).map((size) => size.width)),
  )
  const rowHeights = Array.from({ length: rows }, (_, row) =>
    Math.max(...sizes.slice(row * cols, row * cols + cols).map((size) => size.height)),
  )
  const totalW = colWidths.reduce((sum, width) => sum + width, 0) + GAP * Math.max(0, cols - 1)
  const totalH = rowHeights.reduce((sum, height) => sum + height, 0) + GAP * Math.max(0, rows - 1)
  return { cols, rows, colWidths, rowHeights, totalW, totalH }
}

/** 框的高度估计：子块高度 + 两倍内边距 + 一行标题（与 restructure-tabs 的带高口径一致） */
const frameHeightOf = (innerHeight) =>
  innerHeight + GROUP_PADDING * 2 + Math.round(GROUP_FONT * LINE_HEIGHT) + 12

/**
 * 五块竖排、块内横排（>7 折 4 列）、整块纵向居中，返回 id → position。
 * `resolve(id)` 给一个带 `label` 的对象——重复份的 label 与原份相同，调用方直接把原份传进来即可。
 *
 * 坐标必须**互不相同**：渲染器会把"一批共享同一坐标的节点"判为占位数据并触发 `.enter` 过渡，
 * 断言会读到过渡中间值（`check-canvas.mjs` 里有记录）。
 */
function layoutIcChains(resolve) {
  const positions = new Map()
  let cursorY = 0
  IC_BLOCKS.forEach((block, index) => {
    const children = block.members.map((id) => resolve(id))
    const sizes = children.map((node) => boxSizeOf(node))
    const cols = children.length <= MAX_ROW_LEAVES ? children.length : 4
    const shape = layoutByColumns(sizes, cols)
    const colX = []
    let cursorX = -shape.totalW / 2
    shape.colWidths.forEach((width) => {
      colX.push(cursorX + width / 2)
      cursorX += width + GAP
    })
    const rowY = []
    let innerY = -shape.totalH / 2
    shape.rowHeights.forEach((height) => {
      rowY.push(innerY + height / 2)
      innerY += height + GAP
    })
    const blockCenterY = cursorY + frameHeightOf(shape.totalH) / 2
    children.forEach((node, childIndex) => {
      positions.set(block.members[childIndex], {
        x: round1(colX[childIndex % shape.cols]),
        y: round1(blockCenterY + rowY[Math.floor(childIndex / shape.cols)]),
      })
    })
    positions.set(block.id, { x: 0, y: round1(blockCenterY) })
    cursorY += frameHeightOf(shape.totalH) + (index < IC_BLOCKS.length - 1 ? BLOCK_GAP : 0)
  })
  // 整块居中：把纵向偏移分摊到两侧
  const shiftY = -cursorY / 2
  positions.forEach((value, id) => positions.set(id, { x: value.x, y: round1(value.y + shiftY) }))
  return positions
}

/** 计划自身的毛病（成员重复、重复份与成员撞 id、边的端点不在计划里、refSource 不在成员里） */
function icPlanIssues() {
  const issues = []
  const seen = new Map()
  for (const [id, blockId] of IC_MEMBER_BLOCK) {
    if (seen.has(id)) issues.push(`成员 ${id} 同时在 ${seen.get(id)} 与 ${blockId}`)
    seen.set(id, blockId)
  }
  for (const [dupId, sourceId] of IC_DUPLICATES) {
    if (IC_MEMBER_BLOCK.has(dupId) === false) issues.push(`重复份 ${dupId} 不在任何块里`)
    if (!IC_MEMBER_BLOCK.has(sourceId)) issues.push(`重复份 ${dupId} 的原份 ${sourceId} 不在任何块里`)
    if (IC_MEMBER_BLOCK.get(dupId) === IC_MEMBER_BLOCK.get(sourceId)) {
      issues.push(`重复份 ${dupId} 与原件同块，重复没有意义`)
    }
  }
  for (const block of IC_BLOCKS) {
    if (!block.members.includes(block.refSource)) issues.push(`${block.id} 的 refSource 不在成员里`)
  }
  const ids = new Set(IC_CHAIN_EDGES.map((edge) => edge.id))
  if (ids.size !== IC_CHAIN_EDGES.length) issues.push('关系计划的 id 有重复')
  for (const edge of IC_CHAIN_EDGES) {
    if (!IC_MEMBER_BLOCK.has(edge.source)) issues.push(`关系 ${edge.id} 的起点不在成员表里：${edge.source}`)
    if (!IC_MEMBER_BLOCK.has(edge.target)) issues.push(`关系 ${edge.id} 的终点不在成员表里：${edge.target}`)
  }
  return issues
}

/**
 * 把一张图迁移成"按产物链分块"的形状。幂等：已是目标形状时结果与输入等价。
 *
 * 只动 IC 子树：`atlas:*` 与其它子树一个节点都不碰。IC 内部的关系**整体按计划重建**
 * （端点都在 IC 里的旧边先删掉），仍然存在的边保留它的 `note` 与 `createdAt`。
 */
function applyIcChains(nodes, edges, { stamp = new Date().toISOString() } = {}) {
  const issues = icPlanIssues()
  if (issues.length) throw new Error(`链定义自身有问题：${issues.join('；')}`)

  const byId = new Map(nodes.map((node) => [node.id, node]))
  /** 重复份没有实体节点时，用原份顶上（复制字段与估尺寸都够用） */
  const resolve = (id) => (IC_DUPLICATES.has(id) ? byId.get(IC_DUPLICATES.get(id)) : byId.get(id))
  const missing = [...IC_MEMBER_BLOCK.keys()].filter((id) => !resolve(id))
  if (missing.length) throw new Error(`成员节点缺失：${missing.join(', ')}`)
  if (!byId.has(ICS)) throw new Error(`缺少焦点模块：${ICS}`)

  const positions = layoutIcChains(resolve)
  const retired = new Set([LEGACY_IC_FRAME, ...IC_RETIRED_BLOCK_IDS])

  // 节点：删旧容器与旧重复份 → 成员归位 → 复制重复份 → 建/刷新五个容器
  const next = nodes
    .filter((node) => !retired.has(node.id) && !IC_DUPLICATES.has(node.id))
    .map((node) => {
      if (!IC_MEMBER_BLOCK.has(node.id)) return node
      // 整节点展开：标签、可选性等标注原样保留，重建只动归属与坐标
      return { ...node, parent: IC_MEMBER_BLOCK.get(node.id), position: positions.get(node.id), updatedAt: stamp }
    })
  for (const [dupId, sourceId] of IC_DUPLICATES) {
    const source = resolve(sourceId)
    next.push({
      ...source,
      id: dupId,
      parent: IC_MEMBER_BLOCK.get(dupId),
      position: positions.get(dupId),
      // 可选性跟着**副本自身**走（见 IC_CONDITIONAL_DUPLICATES），不能照原份复制
      conditional: IC_CONDITIONAL_DUPLICATES.has(dupId) || Boolean(source.conditional),
      createdAt: stamp,
      updatedAt: stamp,
    })
  }
  for (const block of IC_BLOCKS) {
    const ref = (resolve(block.refSource)?.refs ?? []).find((item) => item.docId === 'INITIAL_CONDITIONS.md') ?? null
    const existing = byId.get(block.id)
    const frame = {
      id: block.id,
      label: block.label,
      type: 'group',
      summary: block.summary,
      // 容器不挂标签：schema 规定「标签只长在叶子上」，父模块展示的是子图标签的并集
      tags: [],
      tagDetails: {},
      refs: ref ? [{ ...ref }] : [],
      topics: [],
      parent: ICS,
      conditional: false,
      position: positions.get(block.id),
      createdAt: existing?.createdAt ?? stamp,
      updatedAt: stamp,
    }
    const index = next.findIndex((node) => node.id === block.id)
    if (index >= 0) next[index] = frame
    else next.push(frame)
  }

  // 关系：IC 内部整体重建；端点有一头在 IC 外的边（若有）原样保留
  const icIds = new Set([...IC_MEMBER_BLOCK.keys(), ...IC_BLOCK_IDS])
  const isIcEdge = (edge) => icIds.has(edge.source) && icIds.has(edge.target)
  const planned = new Map(IC_CHAIN_EDGES.map((edge) => [edge.id, edge]))
  const previous = new Map()
  for (const edge of edges) {
    if (isIcEdge(edge) && planned.has(edge.id)) previous.set(edge.id, edge)
  }
  const nextEdges = edges.filter((edge) => !isIcEdge(edge))
  for (const plan of IC_CHAIN_EDGES) {
    const before = previous.get(plan.id)
    nextEdges.push({
      id: plan.id,
      source: plan.source,
      target: plan.target,
      label: plan.label,
      type: plan.type,
      directed: true,
      note: plan.note ?? before?.note ?? '',
      sourcePort: null,
      targetPort: null,
      // 计划里声明了可选就直接用；没声明时**保留既有值**，别把数据里的虚线抹成实线
      conditional: plan.conditional === true || before?.conditional === true,
      createdAt: before?.createdAt ?? stamp,
      updatedAt: stamp,
    })
  }

  return { nodes: next, edges: nextEdges }
}
