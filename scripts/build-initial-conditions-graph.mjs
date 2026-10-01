#!/usr/bin/env node
/**
 * 初始条件链生成器：把 docs/notes/INITIAL_CONDITIONS.md 里那条链转成 Graphify 导入草案。
 *
 * 形状（与既有几份图的根本区别）：
 *   · 节点分两类，靠 node.type 自动分色——「过程」= method（紫 #7C3AED），「产物」= dataset（蓝 #0284C7）；
 *   · 边**全部有向**（directed=true），且只在过程与产物之间：
 *       过程 → 产物   = derives_from（产出）
 *       产物 → 过程   = depends_on （依赖 / 被消费）
 *     于是"过程"被对象化成一串节点，链靠"产物"在中间接起来；
 *   · 不用 parent（全部顶层）：这条链是交替序列而不是树，套 parent 反而会误导折叠。
 *
 * 锚点不硬编码编号：脚本实时读文档标题，按 key 子串匹配后取真实 slug（与 /api/md 同源）。
 * 文档改了标题或措辞导致 key 失配时，这里**报错退出**，而不是静默留下悬空引用。
 *
 * 用法：
 *   node scripts/build-initial-conditions-graph.mjs            # 生成 data/initial-conditions-draft.json
 *   node scripts/build-initial-conditions-graph.mjs --stdout    # 只打印统计与清单，不落盘
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readDoc } from '../server/lib/mdIndex.mjs'
import { EDGE_TYPES, NODE_TYPES } from '../server/lib/schema.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_PATH = path.join(ROOT, 'data', 'initial-conditions-draft.json')

const DOC_ID = 'INITIAL_CONDITIONS.md'
/** 过程节点顺带挂一条 atlas 计算单元的引用；解析不到只记警告 */
const ATLAS_L3 = 'atlas/L3-units.md'
const ATLAS_L1 = 'atlas/L1-stages.md'

const LIMITS = {
  name: 120,
  description: 400,
  topics: 12,
  topicId: 40,
  topicName: 60,
  topicDesc: 200,
  id: 80,
  label: 140,
  summary: 600,
  refs: 48,
  edgeLabel: 80,
  note: 400,
}

const TOPICS = [
  {
    id: 'ic-pre',
    name: '① 输入与前置',
    description: '参数集、随机种子与功率谱：链启动前必须先就位的东西。',
  },
  {
    id: 'ic-density',
    name: '② 密度场',
    description: '从 k 空间高斯实现到高低分辨密度：抽样、共轭修正、反变换、滤波与降采样。',
  },
  {
    id: 'ic-velocity',
    name: '③ 速度场',
    description: '一阶（ZA）、相对速度 vcb 与二阶 2LPT：三条各自独立的可选支路。',
  },
  {
    id: 'ic-boundary',
    name: '④ 回收与下游',
    description: '内部中间量在这里被释放，存活下来的输出在这里被下游消费。',
  },
]

/** 过程节点：type=method。refKey 是文档标题里的稳定子串（不含编号，改编号不会失配） */
const PROCESSES = [
  {
    id: 'ic:proc-seed',
    label: '过程① 逐线程种子派生',
    refKey: '步骤 ①：逐线程种子派生',
    atlas: { doc: ATLAS_L3, key: 'S09.1.1 seed_rng_threads' },
    topics: ['ic-pre'],
    summary:
      '由 random_seed 派生 N_THREADS 个互不相同的种子（从 INT_MAX/16 个整数里 choose 再 shuffle），按 5 种 GSL 生成器轮换，给每个线程一条自己的流。全链只有这一处用到随机数。',
  },
  {
    id: 'ic:proc-ps',
    label: '过程② 功率谱就绪',
    refKey: '步骤 ②：功率谱就绪',
    topics: ['ic-pre'],
    summary:
      'init_ps() 把宇宙学参数整理成 cosmo_consts（omhh、theta_cmb、f_nu、f_baryon…），供 power_in_k 逐模求值；对应的释放是收尾的 free_ps()。',
  },
  {
    id: 'ic:proc-sample',
    label: '过程③ k 空间高斯抽样',
    refKey: '步骤 ③：k 空间高斯抽样',
    atlas: { doc: ATLAS_L3, key: 'S09.3.1 sample_ic_modes' },
    topics: ['ic-density'],
    summary:
      '逐独立 k 模（只遍历 z 方向一半）取 box(k) = sqrt(V·P(k)/2)·(a + i·b)，a、b 为两个独立标准正态；P(k) 里已含相对速度压制项与 FDM 的 T_F²。',
  },
  {
    id: 'ic:proc-conj',
    label: '过程④ 共轭对称修正',
    refKey: '步骤 ④：共轭对称修正',
    topics: ['ic-density'],
    summary:
      '把只填了半空间的 k 盒补成共轭对称：7 个自共轭角点取实部、DC 模置零、再处理两条切片与 i 角点行——保证反变换出来是实场。改动风险高，是纯索引技巧。',
  },
  {
    id: 'ic:proc-realize',
    label: '过程⑤ 实空间化（高分辨密度）',
    refKey: '步骤 ⑤：实空间化与高分辨密度',
    atlas: { doc: ATLAS_L3, key: 'S09.2.1 dft_r2c_cube' },
    topics: ['ic-density'],
    summary:
      'c2r 反变换后除 VOLUME 得 hires_density；同时把 δ_k memcpy 进 HIRES_box_saved 作只读副本——后面所有速度场都从这块副本派生。',
  },
  {
    id: 'ic:proc-lowres',
    label: '过程⑥ 滤波与低分辨密度',
    refKey: '步骤 ⑥：滤波与低分辨密度',
    atlas: { doc: ATLAS_L3, key: 'S09.3.2 filter_box' },
    topics: ['ic-density'],
    summary:
      '从副本 memcpy 恢复工作盒 → 仅在 DIM≠HII_DIM 时做顶帽滤波（R = l_factor·BOX_LEN/HII_DIM）→ 反变换 → 用 resample_index 采样到低分辨（维度比未必是整数，故在输出格点上加 0.5 再取整）。',
  },
  {
    id: 'ic:proc-v1',
    label: '过程⑦ 一阶速度场（ZA）',
    refKey: '步骤 ⑦：一阶速度场',
    atlas: { doc: ATLAS_L3, key: 'S09.4.1 compute_velocity_fields' },
    topics: ['ic-velocity'],
    summary:
      '对三个方向各做一次 v_i(k) = δ_k·i·k_i/k²（DC 模单独置零，否则除零出 NaN）→ 按 PERTURB_ON_HIGH_RES 决定是否先滤波 → 反变换 → 采样并除 V。',
  },
  {
    id: 'ic:proc-vcb',
    label: '过程⑧ 相对速度 vcb（可选）',
    refKey: '步骤 ⑧：相对速度 vcb',
    atlas: { doc: ATLAS_L3, key: 'S09.4.3 compute_relative_velocities' },
    /** 可选支路：只有 USE_RELATIVE_VELOCITIES 开启时才执行（画布虚线） */
    conditional: true,
    topics: ['ic-velocity'],
    summary:
      '用 v_i(k) = δ_k·i·k_i/k·sqrt(P_vcb/P)·c_kms 构造三个方向，先滤波到低分辨再反变换，最后取模 sqrt(Σv_i²)/V。只支持 CLASS 功率谱，并且它会同时改变 P(k)。',
  },
  {
    id: 'ic:proc-2lpt-phi',
    label: '过程⑨a 合成 φ₂ 的 k 空间场',
    refKey: '步骤 ⑨：二阶修正 2LPT',
    atlas: { doc: ATLAS_L3, key: 'S09.4.2 compute_velocity_fields_2LPT' },
    /** 可选支路：只有 PERTURB_ALGORITHM == "2LPT" 时才执行（画布虚线） */
    conditional: true,
    topics: ['ic-velocity'],
    summary:
      '对 (00)(11)(22) 求 φ₁ 对角分量（借用 hires_v*_2LPT 当工作区，省一次大分配），再对 (01)(02)(12) 就地合成 ∇²φ₂ = Σ(φ_ii·φ_jj − φ_ij²)，归一化 /(V²·N)。',
  },
  {
    id: 'ic:proc-2lpt-v',
    label: '过程⑨b 由 φ₂ 得二阶速度',
    refKey: '步骤 ⑨：二阶修正 2LPT',
    atlas: { doc: ATLAS_L3, key: 'S09.4.2 compute_velocity_fields_2LPT' },
    /** 可选支路：同上，只在 PERTURB_ALGORITHM == "2LPT" 时执行 */
    conditional: true,
    topics: ['ic-velocity'],
    summary:
      '把 ∇²φ₂ 变换回 k 空间并覆写 HIRES_box_saved，然后与 ZA 同路：求梯度 → 必要时滤波 → 反变换 → 采样得二阶速度。',
  },
  {
    id: 'ic:proc-cleanup',
    label: '过程⑩ 收尾与资源回收',
    refKey: '步骤 ⑩：收尾与资源回收',
    atlas: { doc: ATLAS_L3, key: 'S09.5.1 ComputeInitialConditions' },
    topics: ['ic-boundary'],
    summary:
      '清 FFTW 线程与计划、释放两个工作盒、free_ps()（含 CLASS 插值器）、free_rng_threads()。顺序有讲究：free_ps 必须排在 2LPT 支路之后。',
  },
  {
    id: 'ic:proc-downstream',
    label: '下游｜S10 微扰场与源项（消费方）',
    refKey: '已有 ICs：拿到它才能往下算',
    atlas: { doc: ATLAS_L1, key: 'S10 微扰场与速度' },
    topics: ['ic-boundary'],
    summary:
      '本链的 5 个输出在这里被消费：perturb_field 做降采样 / 平滑 / 速度位移，低分辨 vcb 供自旋温度阶段使用。这是"产物作为联系"的下游端点——链在这里离开本专题。',
  },
]

/** 产物节点：type=dataset */
const PRODUCTS = [
  {
    id: 'ic:art-inputs',
    label: '输入｜InputParameters（P01）',
    refKey: '参数怎么影响结果',
    topics: ['ic-pre'],
    summary:
      'DIM / HII_DIM / BOX_LEN / NON_CUBIC_FACTOR、random_seed，以及三个开关：PERTURB_ON_HIGH_RES（速度场落哪一档）、PERTURB_ALGORITHM（1LPT/2LPT）、USE_RELATIVE_VELOCITIES（是否算 vcb）。',
  },
  {
    id: 'ic:art-seeds',
    label: '产物｜逐线程种子池',
    refKey: '随机数链',
    topics: ['ic-pre'],
    summary:
      'N_THREADS 个互不相同的种子与轮换的 5 种 GSL 生成器。只被抽样步骤使用，但它决定"同一 seed 下线程数一变、实现就变"。',
  },
  {
    id: 'ic:art-pk',
    label: '产物｜cosmo_consts 与 P(k)',
    refKey: '步骤 ②：功率谱就绪',
    topics: ['ic-pre'],
    summary:
      'init_ps 整理的全局查表 cosmo_consts；power_in_k 在它之上再乘相对速度的平均压制高斯（A_VCB_PM / KP_VCB_PM / SIGMAK_VCB_PM）与 FDM 的 T_F(k)²。',
  },
  {
    id: 'ic:art-dk',
    label: '产物｜δ_k 高斯实现（半空间）',
    refKey: '步骤 ③：k 空间高斯抽样',
    topics: ['ic-density'],
    summary:
      '抽样得到的 k 空间实现，此时只填了 z 方向一半（实场条件）。它被共轭修正就地改写，最终内容以完整实现为准。',
  },
  {
    id: 'ic:art-dkfull',
    label: '产物｜δ_k 完整实现（共轭补全后）',
    refKey: '步骤 ④：共轭对称修正',
    topics: ['ic-density'],
    summary:
      '补全共轭关系之后的 δ_k，已是"反变换即得实场"的状态；DC 模为 0（零均值是"密度对比"的定义域要求）。',
  },
  {
    id: 'ic:art-saved',
    label: '产物｜δ_k 只读副本 HIRES_box_saved',
    refKey: '数据流',
    topics: ['ic-density'],
    summary:
      'δ_k 的只读副本：一阶速度、vcb、2LPT 三路都从它派生。2LPT 分支最后会把它覆写成 φ₂——同一块内存换了内容，这是全链最容易看错的一处。',
  },
  {
    id: 'ic:art-hires',
    label: '产物｜hires_density 高分辨密度',
    refKey: '它到底产出了哪些数组',
    topics: ['ic-density'],
    summary:
      'δ(x) = FFT⁻¹(δ_k)/V，形状 (DIM, DIM, DIM·NON_CUBIC_FACTOR)。若用户传入了非零的 initial_density，则跳过抽样、由外部密度正向变换而来（此时不写回该数组）。',
  },
  {
    id: 'ic:art-lowres',
    label: '产物｜lowres_density 低分辨密度',
    refKey: '步骤 ⑥：滤波与低分辨密度',
    topics: ['ic-density'],
    summary:
      '只在 DIM≠HII_DIM 时经顶帽滤波后采样得到；顶帽半径取"与一个低分辨格点等体积的球半径"，故它不只是降采样。',
  },
  {
    id: 'ic:art-v1',
    label: '产物｜一阶速度 vx / vy / vz',
    refKey: '它到底产出了哪些数组',
    topics: ['ic-velocity'],
    summary:
      '三支速度场。落高分辨还是低分辨由 PERTURB_ON_HIGH_RES 二选一（两组数组只存在一组），这直接决定它们的形状。',
  },
  {
    id: 'ic:art-vcb',
    label: '产物｜lowres_vcb（相对速度）',
    refKey: '边界与坑',
    topics: ['ic-velocity'],
    summary:
      '重子-暗物质相对速度场。采样路径与本链其他量不同（先滤波再反变换），形状始终在低分辨；它同时会改变 P(k)，且只支持 CLASS 功率谱。',
  },
  {
    id: 'ic:art-phi2',
    label: '产物｜φ₂ 的 k 空间场 ∇²φ₂',
    refKey: '步骤 ⑨：二阶修正 2LPT',
    topics: ['ic-velocity'],
    summary:
      '归一化 /(V²·N) 后 r2c 变换得到的 ∇²φ₂；它被写回 HIRES_box_saved，随后被求梯度取用。生命周期与被覆写的副本完全重合。',
  },
  {
    id: 'ic:art-2lpt',
    label: '产物｜2LPT 速度（*_v*_2LPT）',
    refKey: '它到底产出了哪些数组',
    topics: ['ic-velocity'],
    summary:
      'hires_v*_2LPT 或 lowres_v*_2LPT；仅在 PERTURB_ALGORITHM == "2LPT" 时存在，且对角分量数组曾被当工作区借用——中途失败时里面会是中间量而不是结果。',
  },
]

/** 边：只在过程与产物之间，全部有向 */
const DERIVES = 'derives_from'
const DEPENDS = 'depends_on'
const EDGES = [
  { from: 'ic:art-inputs', to: 'ic:proc-seed', label: '提供 random_seed', type: DEPENDS, note: '主函数签名只有 random_seed 与结构体两个入参。' },
  { from: 'ic:art-inputs', to: 'ic:proc-ps', label: '提供 DIM / BOX_LEN / 功率谱开关', type: DEPENDS },
  { from: 'ic:proc-seed', to: 'ic:art-seeds', label: '产出 N_THREADS 条独立随机流', type: DERIVES },
  { from: 'ic:proc-ps', to: 'ic:art-pk', label: '产出 cosmo_consts 与 P(k) 求值', type: DERIVES },
  { from: 'ic:art-seeds', to: 'ic:proc-sample', label: '每个线程取自己那条流', type: DEPENDS, note: 'r[omp_get_thread_num()]，故线程之间不共享也不争夺随机数。' },
  { from: 'ic:art-pk', to: 'ic:proc-sample', label: '提供 P(k) 幅度', type: DEPENDS },
  { from: 'ic:proc-sample', to: 'ic:art-dk', label: '产出半空间高斯实现', type: DERIVES },
  { from: 'ic:art-dk', to: 'ic:proc-conj', label: '补全另一半并置零 DC 模', type: DEPENDS },
  { from: 'ic:proc-conj', to: 'ic:art-dkfull', label: '产出可反变换的完整 δ_k', type: DERIVES },
  { from: 'ic:art-dkfull', to: 'ic:proc-realize', label: '反变换并按 1/V 归一', type: DEPENDS },
  { from: 'ic:proc-realize', to: 'ic:art-hires', label: '产出 δ_hires', type: DERIVES },
  { from: 'ic:proc-realize', to: 'ic:art-saved', label: '顺手存下只读副本', type: DERIVES },
  { from: 'ic:art-saved', to: 'ic:proc-lowres', label: '拷贝后顶帽滤波再降采样', type: DEPENDS },
  { from: 'ic:proc-lowres', to: 'ic:art-lowres', label: '产出 δ_lowres（仅 DIM≠HII_DIM）', type: DERIVES },
  { from: 'ic:art-saved', to: 'ic:proc-v1', label: '作为速度场的种子', type: DEPENDS },
  { from: 'ic:proc-v1', to: 'ic:art-v1', label: '产出 ZA 速度', type: DERIVES },
  { from: 'ic:art-saved', to: 'ic:proc-vcb', label: '作为三种子之一（速度差的两端）', type: DEPENDS },
  { from: 'ic:art-pk', to: 'ic:proc-vcb', label: '提供 P_vcb(k)/P(k) 之比', type: DEPENDS },
  { from: 'ic:proc-vcb', to: 'ic:art-vcb', label: '产出相对速度（取模后）', type: DERIVES },
  { from: 'ic:art-saved', to: 'ic:proc-2lpt-phi', label: '作为 φ₁ 的种子', type: DEPENDS, note: '该内存随后会被 ∇²φ₂ 覆写。' },
  { from: 'ic:proc-2lpt-phi', to: 'ic:art-phi2', label: '产出 ∇²φ₂ 并归一化', type: DERIVES },
  { from: 'ic:art-phi2', to: 'ic:proc-2lpt-v', label: '求梯度得二阶位移速度', type: DEPENDS },
  { from: 'ic:proc-2lpt-v', to: 'ic:art-2lpt', label: '产出 2LPT 速度', type: DERIVES },
  { from: 'ic:art-hires', to: 'ic:proc-downstream', label: '被 perturb_field 消费', type: DEPENDS },
  { from: 'ic:art-lowres', to: 'ic:proc-downstream', label: '被降采样 / 平滑消费', type: DEPENDS },
  { from: 'ic:art-v1', to: 'ic:proc-downstream', label: '被速度位移消费', type: DEPENDS },
  { from: 'ic:art-vcb', to: 'ic:proc-downstream', label: '被携带至自旋温度阶段', type: DEPENDS },
  { from: 'ic:art-2lpt', to: 'ic:proc-downstream', label: '被速度位移消费', type: DEPENDS },
  { from: 'ic:art-seeds', to: 'ic:proc-cleanup', label: 'free_rng_threads 回收', type: DEPENDS },
  { from: 'ic:art-pk', to: 'ic:proc-cleanup', label: 'free_ps 释放（含 CLASS 插值器）', type: DEPENDS },
  { from: 'ic:art-dk', to: 'ic:proc-cleanup', label: '工作盒 HIRES_box 在此释放', type: DEPENDS },
  { from: 'ic:art-saved', to: 'ic:proc-cleanup', label: '工作盒 HIRES_box_saved 在此释放', type: DEPENDS, note: '2LPT 支路下这块内存里装的是 ∇²φ₂，随之一起释放。' },
]

/** 标题里的行内 markdown 去掉，得到可读的引用标签 */
function plainHeading(text) {
  return String(text ?? '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/[\s\u3000]+/g, ' ')
    .trim()
    .slice(0, 160)
}

/** 按子串匹配标题，取最具体（最深）的一条；命中多条不报错，命中零条返回 null */
function resolveHeading(doc, key) {
  const hits = doc.headings.filter((heading) => heading.text.includes(key))
  if (!hits.length) return null
  return [...hits].sort((a, b) => b.depth - a.depth)[0]
}

async function main() {
  const dryRun = process.argv.includes('--stdout')
  const errors = []
  const warnings = []

  const doc = await readDoc(DOC_ID).catch(() => null)
  if (!doc) {
    console.error(`读取失败：docs/notes/${DOC_ID} 不存在或用例解析失败`)
    process.exitCode = 1
    return
  }

  const atlasL3 = await readDoc(ATLAS_L3).catch(() => null)
  const atlasL1 = await readDoc(ATLAS_L1).catch(() => null)
  const atlas = { [ATLAS_L3]: atlasL3, [ATLAS_L1]: atlasL1 }
  if (!atlasL3 || !atlasL1) warnings.push('atlas 引用文件缺失，过程节点只挂专题引用')

  const nodes = []
  const seenIds = new Set()
  const seenLabels = new Map()
  let anchorHits = 0
  let atlasHits = 0

  const pushNode = (spec, type) => {
    if (seenIds.has(spec.id)) errors.push(`节点 id 重复：${spec.id}`)
    seenIds.add(spec.id)
    if (spec.id.length > LIMITS.id) errors.push(`节点 id 过长（>${LIMITS.id}）：${spec.id}`)
    if (!spec.label || spec.label.length > LIMITS.label) errors.push(`节点 label 越界（1-${LIMITS.label}）：${spec.label}`)
    const lower = spec.label.toLowerCase()
    if (seenLabels.has(lower)) errors.push(`节点 label 重复（忽略大小写）：${spec.label} 与 ${seenLabels.get(lower)}`)
    seenLabels.set(lower, spec.id)
    if (!spec.summary || spec.summary.length > LIMITS.summary) errors.push(`节点 summary 越界（1-${LIMITS.summary}）：${spec.label}`)
    if (!NODE_TYPES.includes(type)) errors.push(`节点 type 不在枚举内：${type}`)

    /**
     * 闸门：「可选」必须是数据——标题里写了「（可选）」却没给 `conditional`，
     * 画布就会把条件步骤画成必走步骤（vcb 当年只写在标题里、2LPT 连标题都没写）。
     *
     * 标签不在这里校验：标签只服务**参数**，由 `scan-param-tags.mjs` 从节点源码引用
     * 扫出后写入（见 scripts/prune-tags.mjs 的政策）。生成器不声明标签，
     * 因此没有源码引用的节点可以没有标签，这不是错误。
     */
    if (/（可选）/.test(spec.label) && spec.conditional !== true) {
      errors.push(`节点标题写了「（可选）」但 conditional 不为真：${spec.label}`)
    }

    const topics = spec.topics || []
    if (!topics.length) errors.push(`节点未归属任何话题：${spec.label}`)
    if (topics.length > LIMITS.topics) errors.push(`节点话题数超过 ${LIMITS.topics}：${spec.label}`)
    const registered = new Set(TOPICS.map((topic) => topic.id))
    topics.forEach((topic) => {
      if (!registered.has(topic)) errors.push(`节点引用了未注册话题 ${topic}：${spec.label}`)
    })

    // 主引用：专题文档
    const hit = resolveHeading(doc, spec.refKey)
    const refs = []
    if (!hit) {
      errors.push(`锚点解析失败：在 ${DOC_ID} 中找不到含「${spec.refKey}」的标题（${spec.label}）`)
    } else {
      anchorHits += 1
      refs.push({ docId: DOC_ID, anchor: hit.slug, label: plainHeading(hit.text) })
    }

    // 附加引用：atlas
    if (spec.atlas) {
      const target = atlas[spec.atlas.doc]
      const atlasHit = target ? resolveHeading(target, spec.atlas.key) : null
      if (atlasHit) {
        atlasHits += 1
        refs.push({ docId: spec.atlas.doc, anchor: atlasHit.slug, label: plainHeading(atlasHit.text) })
      } else {
        warnings.push(`atlas 引用未命中：${spec.atlas.doc} 中找不到「${spec.atlas.key}」（${spec.label}）`)
      }
    }

    if (refs.length > LIMITS.refs) errors.push(`节点 refs 超过 ${LIMITS.refs} 条：${spec.label}`)

    nodes.push({
      id: spec.id,
      label: spec.label,
      type,
      summary: spec.summary,
      /** 标签由 scan-param-tags 从源码引用扫出后写入；生成器不声明标签 */
      tags: [],
      refs,
      topics,
      parent: null,
      /** 条件 / 可选（画布虚线）：spec 里显式声明，别只写在标题里 */
      conditional: spec.conditional === true,
    })
  }

  PROCESSES.forEach((spec) => pushNode(spec, 'method'))
  PRODUCTS.forEach((spec) => pushNode(spec, 'dataset'))

  const seenEdges = new Set()
  const edges = []
  EDGES.forEach((spec, index) => {
    if (!seenIds.has(spec.from)) errors.push(`边 #${index} 的 source 不存在：${spec.from}`)
    if (!seenIds.has(spec.to)) errors.push(`边 #${index} 的 target 不存在：${spec.to}`)
    if (!spec.label || spec.label.length > LIMITS.edgeLabel) errors.push(`边 #${index} 的 label 越界（1-${LIMITS.edgeLabel}）：${spec.label}`)
    if (!EDGE_TYPES.includes(spec.type)) errors.push(`边 #${index} 的 type 不在枚举内：${spec.type}`)
    if (spec.note && spec.note.length > LIMITS.note) errors.push(`边 #${index} 的 note 超过 ${LIMITS.note}`)
    const signature = `${spec.from}|${spec.type}|${spec.to}|${spec.label}`
    if (seenEdges.has(signature)) errors.push(`边重复（source+type+target+label）：${signature}`)
    seenEdges.add(signature)
    edges.push({
      id: `ic:e${String(index + 1).padStart(2, '0')}`,
      source: spec.from,
      target: spec.to,
      label: spec.label,
      type: spec.type,
      directed: true,
      note: spec.note || '',
    })
  })

  // 话题覆盖：每个话题至少一个成员，且至少一个节点把它当主话题
  TOPICS.forEach((topic) => {
    const members = nodes.filter((node) => node.topics.includes(topic.id))
    if (!members.length) errors.push(`话题没有任何成员：${topic.id}`)
  })

  // 产物必须至少有一条出边或入边，不允许孤岛
  const touched = new Set()
  edges.forEach((edge) => {
    touched.add(edge.source)
    touched.add(edge.target)
  })
  nodes.forEach((node) => {
    if (!touched.has(node.id)) errors.push(`孤立节点（没有任何边）：${node.label}`)
  })

  const meta = {
    name: '初始条件（S09）· 过程与产物',
    description:
      '初始条件这一条链的有向视图：12 个过程步骤（method，紫）与 12 个产物（dataset，蓝）交替，边全部有向——过程→产物 = 产出（derives_from），产物→过程 = 依赖/消费（depends_on）。产物即中间的联系；被回收的内部中间量与存活到下游的 5 个输出在此图上可直接分辨。',
    topics: TOPICS,
  }

  if (meta.name.length > LIMITS.name) errors.push(`meta.name 超过 ${LIMITS.name}`)
  if (meta.description.length > LIMITS.description) errors.push(`meta.description 超过 ${LIMITS.description}`)

  const draft = { mode: 'replace', meta, nodes, edges }

  const counts = {
    process: nodes.filter((node) => node.type === 'method').length,
    product: nodes.filter((node) => node.type === 'dataset').length,
    derives: edges.filter((edge) => edge.type === DERIVES).length,
    depends: edges.filter((edge) => edge.type === DEPENDS).length,
  }

  console.log(`[统计] 节点 ${nodes.length}（过程 ${counts.process} · 产物 ${counts.product}）· 边 ${edges.length}（产出 ${counts.derives} · 依赖 ${counts.depends}）`)
  console.log(
    `[话题] ${TOPICS.map((topic) => `${topic.id} ${nodes.filter((node) => node.topics.includes(topic.id)).length}`).join(' · ')}`,
  )
  console.log(`[锚点] 专题 ${anchorHits}/${nodes.length} 命中 · atlas ${atlasHits} 条附加引用`)
  warnings.forEach((line) => console.log(`  [警告] ${line}`))

  if (dryRun) {
    console.log('\n[节点]')
    nodes.forEach((node) => console.log(`  ${node.type === 'method' ? '过程' : '产物'}  ${node.id.padEnd(22)} ${node.label}`))
    console.log('\n[边]（全部有向）')
    edges.forEach((edge) => console.log(`  ${edge.source} --${edge.label}--> ${edge.target}  (${edge.type})`))
  }

  if (errors.length) {
    console.error('\n生成失败：')
    errors.forEach((line) => console.error(`  - ${line}`))
    process.exitCode = 1
    return
  }

  if (!dryRun) {
    await fs.mkdir(path.dirname(OUT_PATH), { recursive: true })
    await fs.writeFile(OUT_PATH, `${JSON.stringify(draft, null, 2)}\n`, 'utf8')
    console.log(`[已写入] ${path.relative(ROOT, OUT_PATH)}`)
  }

  console.log(`校验：id/label/summary/类型长度全部合规 · 边有向且在过程-产物之间 · 锚点 ${anchorHits} 条全部命中 · 无孤立节点 · 错误 0 · 警告 ${warnings.length}`)
}

main().catch((err) => {
  console.error('生成失败：', err.message)
  process.exitCode = 1
})
