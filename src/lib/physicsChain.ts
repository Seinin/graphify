/**
 * 物理链的数据层：把 `src/generated/physics-chain.json` 读成视图要用的形状。
 *
 * 口径来自 `docs/notes/physics-chain/README.md`（账本），本文件只做**取数与规则编码**，不做判断：
 *   · **层级**（layer）：表面 / 子图 —— 表面只放物理（公式、物理量、谱、函数、过程），
 *     工程实现与实现选择沉到它所属节点的子图里；**子图不是"工程的去处"**，里面也可以再是物理。
 *   · **种类**（kind）：物理量 / 谱 / 函数 / 过程 / 工程项 —— 颜色按它分。
 *   · **观测量**（observable）：不占颜色，视图上用重边框表示（`δT_b` 既是量又是出口，一个节点只能有一种颜色）。
 *   · **开关**：挂在**边**上（虚线箭头 + 箭头上的虚线框）；`gatesEdges` 里的 `from->to` 就是它门控的边。
 */
import raw from '../generated/physics-chain.json'
import type { Graph } from './types'

export type NodeKind = 'quantity' | 'spectrum' | 'function' | 'process' | 'engineering' | 'driver'
export type NodeLayer = 'surface' | 'subgraph'

export interface ChainNature {
  type?: string
  homogeneity?: string
  coupling?: string
  nonlocal?: string
  degenerate?: string
}

export interface CodeSite {
  file: string
  line: number
  endLine?: number
  symbol?: string
  unit?: string
  unitName?: string
  fileWide?: boolean
  /** 落点出处：真源核定（`chain`）还是 atlas 回落（`atlas`） */
  source?: 'chain' | 'atlas'
  /** 该行区间内必须出现的代码标识（真源核定时给出，自检按它复核区间是不是核心行） */
  needles?: string[]
}

export interface ChainChoice {
  name: string
  desc: string
}

export interface ChainNode {
  id: string
  symbol: string
  name: string
  kind: NodeKind
  layer?: NodeLayer
  parent?: string
  parentNote?: string
  observable?: boolean
  eq?: string
  page?: number
  formula?: string
  dependsOn?: string[]
  nature?: ChainNature
  sections?: string[]
  codeHints?: string[]
  /** `pending` = 待核定核心行的文件名清单（atlas 找不到函数体，不许拿"整文件"充数） */
  code?: { count: number; sites: CodeSite[]; pending?: string[] }
  choices?: ChainChoice[]
  theory?: string
  surfaceNote?: string
  implementedAs?: string
  reviewSection?: string
}

export interface ChainEdge {
  from: string
  to: string
  eq?: string
  page?: number
  note?: string
}

export interface ChainParam {
  name: string
  pl2012?: string
  role?: string
  default?: unknown
  log10?: boolean
  range?: [number | null, number | null] | null
  paper?: string
  switch?: boolean
  gatesEdges?: string[]
  inCode?: boolean
  group?: string
  choices?: string[]
}

export interface ChainAlgorithm {
  how: string
  when: string
  discretization: string
  where: string
}

/** 生成物里与画布同形状的那份图（视图、顶栏检索、来源标注都读它） */
interface ChainGraphNode {
  id: string
  label: string
  type: string
  summary?: string
  /**
   * **摘要位置的公式**（排版的 LaTeX）：生成器从真源 `docText[id].formula` 逐字转录。
   * 块与层里的文件成员不带它——视图见不到这个字段就照旧走摘要输入框那条路
   * （判据落在数据上，`Inspector` 不按种类另写一份名单）。
   */
  formula?: string
  parent?: string
  topics?: string[]
  tags?: string[]
  /** 块节点（`type: 'process'` 的**普通**节点，不是容器）上的一级划分事实 */
  blockKind?: 'process' | 'layer'
  /** 块在主序里的位次（真源手写，只决定 y 坐标，不携带逻辑含义）；层是 0 */
  order?: number
  /** 块下辖的成员条数 */
  memberCount?: number
  /** 成员里**物理量**的条数（块里只有物理量，与 `memberCount` 相等） */
  quantityMemberCount?: number
  /** 能不能进去看：**过程块**才有子图可进；层一定不可进入 */
  enterable?: boolean
  /**
   * 代码阶段号（如 `S14`），**已是普通属性、不再决定分层**：一级怎么划分看 `blocks.items`。
   * 驱动量 / 外部量不属于任何代码阶段 → 空串。
   * **属性页上不再有这一行**：它是点不开的摘要；检索命中说明里仍写着它
   * （按 `S14` 能查到、一眼看得出命中算在哪段代码里），"这个量算在哪段代码里"改由「源码」标签页的落点回答。
   */
  stage?: string
  /** 块上那份"成员涉及哪几个代码阶段"的并集（块的阶段号，量各自的在 `stage` 上）。**无界面出口**，自检仍断言 */
  stages?: string[]
}

interface ChainGraphEdge {
  id: string
  source: string
  target: string
  label?: string
  /** 静息不画、悬浮两端任一块时才显现（一级那 21 条块间接口边） */
  focusOnly?: boolean
}

/**
 * 块的**代码锚**：这块在代码里到底是哪个文件、哪个函数、哪个结构体。
 *
 * 这是本次"与代码同构"口径的落点——一级划分不再是散文，而是一句可证伪的断言：
 * 自检会打开 `file` 去找 `function`（找不到就失败）。
 * **属性页不再展示它**：
 * 现在它只作数据与自检的依据，视图不读它、也不自己推。
 */
export type ChainCodeAnchor =
  | { kind: 'compute'; file: string; function: string; struct?: string }
  | { kind: 'files'; files: string[]; struct?: string }

/** 块（一级的 10 个天体物理过程 + 2 个层）：生成物 `graph.blocks.items` 给的一份，视图只读、不自己重算 */
export interface ChainBlock {
  id: string
  label: string
  kind: 'process' | 'layer'
  /** 主序位次（1..10；两个层都是 0，它们横切主序、不在主序上占位） */
  order: number
  /** 代码锚（文件 / 函数 / 结构体）：回答"这块凭什么算一个块"。**属性页不再展示**，自检逐条打开核对 */
  codeAnchor?: ChainCodeAnchor
  note?: string
  /** 成员清单：过程块里是物理量 id，层里是文件名（如 `cosmology.h`） */
  members: string[]
  /** 成员条数（含文件成员） */
  memberCount: number
  /** 成员里物理量的条数（层的文件成员不算） */
  quantityMemberCount: number
  internalEdgeCount: number
  enterable: boolean
  /** 成员涉及的代码阶段号（并集）：属性页显示"这个块算在哪几段代码里" */
  stages: string[]
  /**
   * **成员标签的并集**（与块节点上的 `tags` 是同一份事实的两个出口）：块不自造标签——
   * "这个块涉及参数 X"完全由成员决定。选中一个参数时一级要亮的就是它。
   */
  tags: string[]
  position: { x: number; y: number }
  /**
   * 对外接口：入 / 出各是哪几条 `iface:*`。**界面不列它**；保留在数据里只供自检核对"每条边恰被两端认领一次"。
   */
  interfaceIn: string[]
  interfaceOut: string[]
  /**
   * **对外输入**（进这个块的子图时灰显的上下文节点）：块外指进来的量 id。
   * 它们是别的块的成员**本人**（同一个 id）——只是在这个块的标签页里额外显形，不新增节点。
   */
  contexts: string[]
}

interface ChainGraph {
  nodes: ChainGraphNode[]
  edges: ChainGraphEdge[]
  /** 一级划分（11 个块）的完整事实 + 口径数字 */
  blocks?: { items: ChainBlock[]; stats: Record<string, number> }
  /** 块内的模块 → 它内部的步骤（块自己不在里面：块的成员直接挂在块的 `parent` 下） */
  subgraphs?: Record<string, { steps: string[] }>
}

interface ChainArtifact {
  drivers: ChainNode[]
  nodes: ChainNode[]
  edges: ChainEdge[]
  params: Record<string, unknown>
  algorithms?: { byId?: Record<string, ChainAlgorithm> }
  paramMatrix?: Record<string, { nodes: string[]; edges: string[] }>
  algorithmPending?: { nodes?: string[]; drivers?: string[]; edges?: string }
  degeneracies?: unknown[]
  stats?: Record<string, number>
  graph?: ChainGraph
  /**
   * **左栏第二个检索面**：天体物理过程（旧的一级轴，现与本页的代码模块面并存）。
   * 口径与转录来源都写在 `note` 里（真源同一句话），视图只读、不解读。
   */
  processes?: {
    note: string
    items: ChainProcess[]
    /** 兜底名单：还没收编进过程面的量（现为空——新增模块已按模块主题就近立条） */
    uncovered?: { note: string; members: string[] }
  }
}

const chain = raw as unknown as ChainArtifact

/** 生成物里的图：内部按本页要用的少数字段读，对外按画布那份 `Graph` 的形状给出 */
const graph = (chain.graph ?? { nodes: [], edges: [] }) as unknown as ChainGraph

/** 生成物里那份与画布同形状的图（顶栏检索直接读它） */
export const CHAIN_GRAPH: Graph = graph as unknown as Graph

/**
 * 驱动量与物理量合在一起取（视图上都要画，只是种类/层级不同）。
 *
 * 注意：真源里 `drivers` 是**顶层数组**、`nodes` 才带 `kind` ——所以这里给驱动量补上
 * `kind: 'driver'`（它就是一种独立的种类：可调的输入）。不补会让视图按下标取颜色时炸掉。
 */
export const allNodes = (): ChainNode[] => [
  ...chain.drivers.map((node) => ({ ...node, kind: node.kind ?? ('driver' as NodeKind) })),
  ...chain.nodes,
]

/**
 * 表面节点：自顶向下那条链。函数那一级不上图之后（`design.md` D1），
 * **全部量都在表面上**——原先靠 `layer === 'subgraph'` 收起来的那两个工程项也不例外。
 */
export const surfaceNodes = (): ChainNode[] => allNodes()

export const nodeById = (id: string): ChainNode | undefined => allNodes().find((node) => node.id === id)

export const edgeKey = (edge: ChainEdge): string => `${edge.from}->${edge.to}`

/** 表面上的边：两端都在表面的才算"这条链上的箭"（如今两端都是量，判据仍在，防的是悬空的边） */
export const surfaceEdges = (): ChainEdge[] => {
  const ids = new Set(surfaceNodes().map((node) => node.id))
  return chain.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to))
}

export const incomingEdges = (id: string): ChainEdge[] => surfaceEdges().filter((edge) => edge.to === id)
export const outgoingEdges = (id: string): ChainEdge[] => surfaceEdges().filter((edge) => edge.from === id)

/** 这个节点在链条上的上游（谁决定它）——来自 dependsOn，取存在的节点 */
export const upstreamOf = (id: string): ChainNode[] =>
  (nodeById(id)?.dependsOn ?? []).map((dep) => nodeById(dep)).filter((node): node is ChainNode => Boolean(node))

/** 下游（它决定谁） */
export const downstreamOf = (id: string): ChainNode[] =>
  surfaceEdges()
    .filter((edge) => edge.from === id)
    .map((edge) => nodeById(edge.to))
    .filter((node): node is ChainNode => Boolean(node))

export const algorithmOf = (id: string): ChainAlgorithm | null => chain.algorithms?.byId?.[id] ?? null

export const degeneracies = (): unknown[] => chain.degeneracies ?? []

export const statsOf = (): Record<string, number> => chain.stats ?? {}

/* ---------------- 种类与颜色（颜色只表示"它是什么"，观测量用重边框） ---------------- */

export const KIND_LABELS: Record<NodeKind, string> = {
  quantity: '物理量',
  spectrum: '谱',
  function: '函数 / 关系',
  process: '物理过程',
  engineering: '工程项',
  driver: '驱动量',
}

/** 每个种类一个色相；子图节点统一压暗（仍保留自己的色相，便于分辨种类） */
export const KIND_STYLES: Record<NodeKind, { dot: string; border: string; text: string; bg: string }> = {
  quantity: { dot: 'bg-sky-500', border: 'border-sky-300', text: 'text-sky-900', bg: 'bg-sky-50' },
  spectrum: { dot: 'bg-indigo-500', border: 'border-indigo-300', text: 'text-indigo-900', bg: 'bg-indigo-50' },
  function: { dot: 'bg-violet-500', border: 'border-violet-300', text: 'text-violet-900', bg: 'bg-violet-50' },
  process: { dot: 'bg-emerald-500', border: 'border-emerald-300', text: 'text-emerald-900', bg: 'bg-emerald-50' },
  engineering: { dot: 'bg-slate-400', border: 'border-slate-300', text: 'text-slate-700', bg: 'bg-slate-100' },
  driver: { dot: 'bg-amber-500', border: 'border-amber-300', text: 'text-amber-900', bg: 'bg-amber-50' },
}

/** 取样式时一律走这里：认不出的种类降级成工程项那种暗色，**不抛错**（页面不该因为一个字段崩掉） */
export const kindStyleOf = (node: ChainNode): (typeof KIND_STYLES)[NodeKind] =>
  KIND_STYLES[node.kind] ?? KIND_STYLES.engineering

/** 种类显示名，同样兜底 */
export const kindLabelOf = (node: ChainNode): string => KIND_LABELS[node.kind] ?? String(node.kind ?? '未标种类')

export const isObservable = (node: ChainNode): boolean => Boolean(node.observable)

/** 观测量在视图上用重边框；其余用普通边框 */
export const nodeFrameClass = (node: ChainNode): string => (isObservable(node) ? 'border-2 shadow-sm' : 'border')

/* ---------------- 开关：挂在边上 ---------------- */

interface EffectParam extends ChainParam {
  switch?: boolean
  gatesEdges?: string[]
}

export const effectParams = (): EffectParam[] => (chain.params.effects as EffectParam[] | undefined) ?? []

/** 门控这条边的开关（可能不止一个） */
export const switchesForEdge = (key: string): EffectParam[] =>
  effectParams().filter((param) => (param.gatesEdges ?? []).includes(key))

/** 还没定挂点的开关（账本要求：不许静默留空） */
export const unplacedSwitches = (): EffectParam[] =>
  effectParams().filter((param) => !(param.gatesEdges ?? []).length)

/* ---------------- 参数（抽屉用） ---------------- */

export interface ParamGroup {
  name: string
  label: string
  params: ChainParam[]
}

const GROUP_LABELS: Record<string, string> = {
  drivers: '驱动量',
  astro: '天体物理参数',
  cosmo: '宇宙学参数',
  numeric: '数值与精度',
  effects: '效应开关',
}

/**
 * 分组＝产物 `params` 里所有数组型键，顺序即键序（生成器按真源 `params.order` 依次写入）。
 * 这里**不写死组名**：写死会让新加的组被静默丢掉——既进不了侧栏，也没有任何地方报错。
 */
export const paramGroups = (): ParamGroup[] => {
  const source = chain.params as unknown as Record<string, unknown>
  return Object.keys(source)
    .filter((name) => Array.isArray(source[name]))
    .map((name) => ({
      name,
      label: GROUP_LABELS[name] ?? name,
      params: source[name] as ChainParam[],
    }))
}

export const allParams = (): ChainParam[] => paramGroups().flatMap((group) => group.params)

/** 抽屉检索：按代码名、P&L 写法、中文角色说明匹配 */
export const searchParams = (query: string): ChainParam[] => {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return allParams().filter((param) =>
    [param.name, param.pl2012 ?? '', param.role ?? ''].some((field) => field.toLowerCase().includes(q)),
  )
}

/** 这个参数是不是某个开关：是的话，视图可以用它高亮它门控的边 */
export const gateEdgesOfParam = (param: ChainParam): string[] => param.gatesEdges ?? []

/**
 * 参数 → 模块 的查表（**后端算好的**，见生成器里的参数 × 节点矩阵）。
 * 视图拿它做「选中参数 → 高亮相关模块」：`nodes` 是它被读到的那些节点，`edges` 是开关门控的边。
 * 没有归属的参数不在表里（自检会列出它们，不静默）。
 */
export const paramMatrixOf = (name: string): { nodes: string[]; edges: string[] } | null => {
  const matrix = chain.paramMatrix as Record<string, { nodes: string[]; edges: string[] }> | undefined
  return matrix?.[name] ?? null
}

/** 参数默认值的显示文本（空就是空，不补） */
export const defaultTextOfParam = (param: ChainParam): string => {
  if (param.default === null || param.default === undefined) return '—'
  if (typeof param.default === 'boolean') return param.default ? 'true' : 'false'
  return String(param.default)
}

/* ---------------- 侧栏词条：按**代码里的类名**分组 ---------------- */

/**
 * 侧栏词条：**登记在册的参数都有一条**（包括在参数 × 节点矩阵里没有条目的那些）。
 *
 * 没落点的不静默丢掉：`located` 为假、`note` 写明是**哪一种**「无」（见 `paramAbsenceReason`）——
 * 于是列表里翻得到、检索里也在，只是点了点不亮任何量。丢掉它等于让人以为这个参数不存在。
 *
 * 分组名取自生成物的 `param.group`，**不按生成物里的数组名分组**：同一份参数在不同数组里
 * 可以是不同的类（`R_MAX_TS` 在 `numeric` 数组里，`group` 是 `AstroParams`），
 * 按数组名分只会让人对不上代码。
 */
export interface ChainParamEntry {
  name: string
  /** P&L 2012 里那个符号（没有就空） */
  pl2012?: string
  /** 代码里的类名（`AstroParams` / `CosmoParams` / `AstroOptions`…），分组名就是它 */
  group: string
  /** 它作用的模块数（参数 × 节点矩阵里数出来） */
  nodeCount: number
  /** 它门控的边数（开关类才有） */
  edgeCount: number
  /** 它门控的边的人话两端（如 `恒星形成效率 → 标度关系`）；不是开关就空 */
  gateLabels: string[]
  /** 门控边两端的量数（开关类才有）：它为真时改的是这几个量那一支 */
  gatedNodeCount: number
  /** 在参数 × 节点矩阵里有条目（点了点得亮）；为假时原因写在 `note` 里 */
  located: boolean
  /** 没有落点时的原因（有落点则缺省） */
  note?: string
}

/** 类名缺失时的兜底分组名（不许把词条静默丢掉） */
export const PARAM_GROUP_FALLBACK = '未标类'

export interface ChainParamClassGroup {
  /** 代码里的类名 */
  group: string
  entries: ChainParamEntry[]
}

/** 词条清单：**登记参数全收**（含没有落点的），按名字排序（生成物是静态的，算一次留用） */
let paramEntryCache: ChainParamEntry[] | null = null
export const paramEntries = (): ChainParamEntry[] => {
  paramEntryCache ??= allParams()
    .map((param): ChainParamEntry => {
      const matrix = paramMatrixOf(param.name)
      return {
        name: param.name,
        pl2012: param.pl2012,
        group: (param.group ?? '').trim() || PARAM_GROUP_FALLBACK,
        nodeCount: matrix?.nodes.length ?? 0,
        edgeCount: matrix?.edges.length ?? 0,
        gateLabels: paramGateLabels(param.name),
        gatedNodeCount: paramGatedNodes(param.name).length,
        located: Boolean(matrix),
        note: matrix ? undefined : paramAbsenceReason(param.name),
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
  return paramEntryCache
}

/**
 * 按代码类名分组：组顺序按**条数从多到少**（名字兜底），所以视图不必写死任何类名清单——
 * 代码里加了新类，这里自然多一组。
 */
export const paramClassGroups = (): ChainParamClassGroup[] => {
  const buckets = new Map<string, ChainParamEntry[]>()
  paramEntries().forEach((entry) => {
    buckets.set(entry.group, [...(buckets.get(entry.group) ?? []), entry])
  })
  return [...buckets.entries()]
    .map(([group, entries]) => ({ group, entries }))
    .sort((a, b) => b.entries.length - a.entries.length || a.group.localeCompare(b.group))
}

/** 名 → 词条（详情行显示"所属类名 + 作用模块数"时用它，不必再算一遍矩阵） */
export const paramEntryOf = (name: string): ChainParamEntry | undefined =>
  paramEntries().find((entry) => entry.name === name)

/**
 * 门控边两端的量（开关类才有）：矩阵的 `edges` 存的是 `from->to` 键，这里拆开、去掉已经算
 * "直接作用"的那些，保序去重。
 *
 * 为什么要有这个：开关（如 `USE_UPPER_STELLAR_TURNOVER`）在代码里**没有读点**——它改的不是某个值，
 * 是**走哪一支**，所以矩阵里只有边没有节点。可那条边在图上是有两端的
 * （`fstar -> scaling_relations`，边注就写着它在这里改高质端的取值）："作用于 0 个量"是实话却没用，
 * 开关的去处就是这条边所在的过程与产物，写到这两端才点得亮东西。**不新增数据**——两端从边键里读。
 */
export const paramGatedNodes = (name: string): string[] => {
  const matrix = paramMatrixOf(name)
  if (!matrix?.edges.length) return []
  const direct = new Set(matrix.nodes)
  return [...new Set(matrix.edges.flatMap((key) => key.split('->')))].filter((id) => id && !direct.has(id))
}

/**
 * 门控边的人话（`fstar->scaling_relations` → `f* → 标度关系(M_h)`）：检索说明与悬停提示共用。
 * 两端只用**符号那一半**——节点的显示名是 `符号 · 名字` 两段，取 ` · ` 前那段；
 * 一句提示里塞两个全名会读不清，全名在脚上区那两个 chip 上。
 */
export const paramGateLabels = (name: string): string[] =>
  (paramMatrixOf(name)?.edges ?? []).map((key) =>
    key
      .split('->')
      .map((id) => {
        const label = labelOfGraphNode(id)
        return label.split(' · ')[0] || label
      })
      .join(' → '),
  )

/**
 * 参数在图上**碰到的量**：矩阵里的直接落点（代码扫出来的读点）+ 门控边两端（开关类）。
 * 块归属、两面互查、脚上区都走这一处——口径只有一份，否则"点过程列出的参数"与"点参数列出的过程"会对不上。
 */
export const paramTouchedNodes = (name: string): string[] => [
  ...(paramMatrixOf(name)?.nodes ?? []),
  ...paramGatedNodes(name),
]

/**
 * 参数在图上没有落点时，如实写原因——光写「作用于 无」说不清是**哪一种**无：
 * ① `inCode` 为假：源码的参数结构里根本没有它（口径与自检一致："源码里没有，但产物标成 inCode" 才算错）；
 * ② 其余：代码里有读点，但链上没有任何量落在读到它的那段代码上——缺的是量声明或承担者的实名，不是渲染。
 * 只门控边的开关**不算没有落点**：它的落点就是那条边的两端（见 `paramGatedNodes`）。
 */
export const paramAbsenceReason = (name: string): string => {
  const param = allParams().find((item) => item.name === name)
  if (param?.inCode === false) return '代码里没有它'
  return '链上没有量落在读到它的那段代码上'
}

/**
 * 参数落在哪几个块（由参数 × 节点矩阵反查 `blocks.items`，**不新增数据**）。
 * 用来把"这个参数点亮了哪些天体物理过程"直接写在检索结果里——门控边的两端也算（开关落在哪条过程上）。
 */
export const paramBlocks = (name: string): string[] => [
  ...new Set(paramTouchedNodes(name).map((id) => blockLabelOf(id)).filter((label): label is string => Boolean(label))),
]

/* ============ 一级划分：11 个块（读生成物的 `graph.blocks`，不按 parent 重算） ============ */

/**
 * **不属于物理链**的那些话题：`topic:impl`（实现细节＝工程节点），以及挂在它们身上的参数。
 *
 * 它们已经**不再是一层可展开/收起的东西**——一级只有 11 个块（10 个过程块 + 1 个层），工程项贴在块
 * **内部**的成员层，走进块才看得到（`task 3.5`）。这份清单因此只剩一个用途：**检索命中时标来源**，
 * 让人知道"这个词读得到，但它不在物理链上"。
 */
export const ENGINEERING_TOPIC_IDS: readonly string[] = ['topic:impl']

/** 来源徽标的文案（一个定义处：本页检索与顶栏检索共用这一句，各自不再写一遍） */
export const ENGINEERING_LABEL = '实现细节'

const graphNodes = (): ChainGraphNode[] => graph.nodes
const graphEdges = (): ChainGraphEdge[] => graph.edges

/** 一级的 11 个块：**只读生成物**给的那份（成员 / 可进入 / 主序位次 / 接口都在里面） */
export const chainBlocks = (): ChainBlock[] => graph.blocks?.items ?? []

/** 一级的口径数字（状态条与自检读同一份）：块数 / 过程块 / 层 / 物理量成员 / 文件成员 / 接口边 */
export const chainBlockStats = (): Record<string, number> => graph.blocks?.stats ?? {}

/** 量 → 块 的反查表（归属只有一份来源：生成物的 `blocks.items[].members`） */
const blockOfMember = new Map(chainBlocks().flatMap((block) => block.members.map((id) => [id, block])))

/** 这个量装在哪个块里（不是成员、或还没归块时为 undefined） */
export const blockOf = (nodeId: string): ChainBlock | undefined => blockOfMember.get(nodeId)

/** 块的显示名（检索命中与检查器共用这一句） */
export const blockLabelOf = (nodeId: string): string | null => blockOfMember.get(nodeId)?.label ?? null

/**
 * 这个对象「进去」能看到几个**子对象**：块＝它自己的**成员数**（层不给入口 → 0），
 * **成员一律 0**——函数那一级不上图（`design.md` D1）：谁把它算出来、切在哪几个函数里，
 * 回答的是"这个量由哪几行算出"，归代码落点管，不归图层管。
 *
 * 两件事别混：`blockOf` 回答的是"这个量**装在**哪个块里"——拿它当成员自己的子节点数，
 * 会让 ⑨观测量 里的 `p21` 也报出「3 个子节点」（＝ M10 的成员数），点进去是一张空画布。
 * 数字与"能不能进"共用这一个判据，两处不会各说各话。
 */
export const subgraphSizeOf = (nodeId: string | null): number => {
  if (!nodeId) return 0
  const block = chainBlocks().find((item) => item.id === nodeId)
  if (!block) return 0
  return block.enterable ? block.memberCount : 0
}

const hasEngineeringTopic = (id: string): boolean =>
  (graphNodes().find((node) => node.id === id)?.topics ?? []).some((topicId) =>
    ENGINEERING_TOPIC_IDS.includes(topicId),
  )

/**
 * 这个对象是不是**工程侧**的（挂在「实现细节」话题下）。
 * 两处检索用它给命中项标来源：「这个词读得到，但它不属于物理链」——不藏、也不用它把一级弄脏。
 */
export const isEngineeringObject = (kind: 'node' | 'edge', id: string): boolean => {
  if (kind === 'node') return hasEngineeringTopic(id)
  const edge = graphEdges().find((item) => item.id === id)
  return edge ? hasEngineeringTopic(edge.source) || hasEngineeringTopic(edge.target) : false
}

/* ============ 左栏第二个检索面：天体物理过程（读生成物的 `processes`，不另建归属表） ============ */

/**
 * 过程面的一条词条（**旧的一级轴**，2026-09-30 起降级为左栏的检索面）。
 *
 * 口径与转录来源都写在生成物的 `processes.note` 里（真源同一句话）：
 *   · 划分依据 = **天体物理过程**（一个过程 = 一组按等式串起来的量，能独立读懂）；
 *   · 与本页的 `blocks`（代码模块面）**并存**，且是**多对一**——三个过程同属一个代码模块是常态。
 *
 * `fit` 是**这条过程用到的公式 / 近似**：写得清就写（能带 `文件:行` 出处更好），写不出就留空，
 * 不硬凑、不推断；名字与口径求"相近、看得懂"，不追逐条可核。
 */
export interface ChainProcess {
  id: string
  label: string
  members: string[]
  /** 主块 id（点过程时定位到它）；过程跨块时取成员最多的那个 */
  primaryBlock: string
  /** 这条过程用到的公式 / 近似（空 = 没写出来） */
  fit: string
  note?: string
}

export const chainProcesses = (): ChainProcess[] => chain.processes?.items ?? []

/** 过程面的口径（真源同一句：划分依据 + 与代码模块面的关系 + `fit` 的收条标准） */
export const chainProcessNote = (): string => chain.processes?.note ?? ''

/** 兜底名单：还没收编进过程面的量（现为空——新增模块已按模块主题就近立条） */
export const processUncovered = (): { note: string; members: string[] } =>
  chain.processes?.uncovered ?? { note: '', members: [] }

/** 量 → 它挂在哪些过程下（反向：点一个量就能点亮过程面；一个量可以挂在不止一条下） */
const processesOfMember = new Map<string, ChainProcess[]>()
for (const item of chainProcesses()) {
  for (const member of item.members) processesOfMember.set(member, [...(processesOfMember.get(member) ?? []), item])
}
export const processesOf = (nodeId: string): ChainProcess[] => processesOfMember.get(nodeId) ?? []

/**
 * **过程 → 参数**的反查（口径只有一份：走既有的「参数 × 节点矩阵」，不另造参数归属表）。
 * 判据：某参数在图上**碰到的量**（矩阵落点 + 门控边两端，见 `paramTouchedNodes`）与这条过程下辖的
 * 量有交集 → 它被算作"与这条过程相关"（开关落在哪条过程上，靠的就是门控边那两端）。
 * 视图（点亮参数面、为空时写「无」）与自检（口径同源那条）都从这一处取。
 */
export const paramsOfProcess = (processId: string): string[] => {
  const item = chainProcesses().find((process) => process.id === processId)
  if (!item) return []
  const members = new Set(item.members)
  return allParams()
    .filter((param) => paramTouchedNodes(param.name).some((id) => members.has(id)))
    .map((param) => param.name)
}

/**
 * 过程面的**词条**（左栏直接渲染的一行）：过程名 + 下辖量数 + 论文出处数 + 相关参数数 + 拟合律口径。
 * 三个数字都在这里数好，面板只管显示（它与 `ChainParamEntry` 是同一种东西的两个出口）。
 *
 * **故意不带主块的显示名**：词条上只出现过程名，不出现 `M8 气体热与自旋温度` 这类代码模块块名
 * （过程面不是一级轴，点到哪儿由 `primaryBlock` 决定，落到画布上自然看得见）。
 */
export interface ChainProcessEntry {
  id: string
  label: string
  /** 下辖物理量的条数 */
  memberCount: number
  /** 与它相关的参数个数（走「参数 × 节点矩阵」反查；0 = 参数面里没人读到它，UI 要写「无」） */
  paramCount: number
  /** 论文出处数：挂在它成员上的参数引用的**不重复**出处（空的不算） */
  paperCount: number
  /** 主块 id（点它定位过去；显示名不出现在词条上，见上） */
  primaryBlock: string
  /** 这条过程用到的公式 / 近似（空 = 没写出来） */
  fit: string
  note?: string
  /** 下辖量的清单（词条展开时列出来；点每一项定位到那个量） */
  members: { id: string; label: string }[]
}

/** 量的显示名：读生成物里那份与画布同形状的图（`ChainNode` 上没有 `label`，只有符号与名字） */
const labelOfGraphNode = (id: string): string => graphNodes().find((node) => node.id === id)?.label ?? id

/** 这条过程用到的**论文出处数**：它相关参数引用的出处原文去重（空的不算，与本页「文献」那一路同源） */
const processPaperCount = (processId: string): number => {
  const names = new Set(paramsOfProcess(processId))
  return new Set(
    allParams()
      .filter((param) => names.has(param.name))
      .map((param) => (param.paper ?? '').trim())
      .filter(Boolean),
  ).size
}

export const chainProcessEntries = (): ChainProcessEntry[] =>
  chainProcesses().map((item) => ({
    id: item.id,
    label: item.label,
    memberCount: item.members.length,
    paramCount: paramsOfProcess(item.id).length,
    paperCount: processPaperCount(item.id),
    primaryBlock: item.primaryBlock,
    fit: item.fit,
    note: item.note,
    members: item.members.map((id) => ({ id, label: labelOfGraphNode(id) })),
  }))

/* ============ 四路检索：参数 / 物理量 / 过程名 / 论文出处 ============ */

export type ChainHitKind = 'param' | 'quantity' | 'process' | 'paper'

export interface ChainHit {
  kind: ChainHitKind
  /** 稳定键：参数名 / 节点 id / 出处原文（一处出处可能被多个参数引，聚合后按原文作键） */
  id: string
  label: string
  /** 命中理由与**数量说明**（都从生成物里数出来，不写死） */
  detail: string
  /** 是不是默认收起的那一层（实现细节）：命中后视图给个来源徽标 */
  collapsed: boolean
  /** 命中后该选中谁；没有可选中对象的（如只在出处里出现的参数）为 null */
  focus: { kind: 'node' | 'edge'; id: string } | null
}

export interface ChainSearchResult {
  hits: ChainHit[]
  counts: Record<ChainHitKind, number>
}

const matches = (fields: (string | undefined)[], query: string): boolean =>
  fields.some((field) => (field ?? '').toLowerCase().includes(query))

/** 图节点上的种类显示名（与 `kindLabelOf` 同一张表，只是入参是字符串的 `type`） */
const kindLabelOfType = (type: string): string => KIND_LABELS[type as NodeKind] ?? type

/**
 * 本页检索：**四路都收**——参数（代码名 / P&L 写法 / 中文角色）、物理量（符号 · 名字 · 公式）、
 * 过程名（过程框 / 过程 / 函数 / 步骤，摘要里"我想知道…"的问法也算命中面）、论文出处。
 *
 * 每条命中都带 `collapsed`（是不是默认收起的实现细节，由视图给个来源徽标）
 * 与数量说明。命中口径**以生成物为准**：作用范围走 `paramMatrix`，归属走 `blocks.items`。
 */
export const searchChain = (query: string): ChainSearchResult => {
  const q = query.trim().toLowerCase()
  const hits: ChainHit[] = []
  const counts: Record<ChainHitKind, number> = { param: 0, quantity: 0, process: 0, paper: 0 }
  if (!q) return { hits, counts }
  const push = (hit: ChainHit) => {
    hits.push(hit)
    counts[hit.kind] += 1
  }
  const focusOf = (nodeId: string | undefined): ChainHit['focus'] =>
    nodeId ? { kind: 'node', id: nodeId } : null

  // 一路：参数。命中后给出它所属的代码类、落到哪几个块、作用于多少个量、门控多少条边
  searchParams(q).forEach((param) => {
    const matrix = paramMatrixOf(param.name)
    const nodes = matrix?.nodes ?? []
    const edges = matrix?.edges ?? []
    const gated = paramGatedNodes(param.name)
    const blocks = paramBlocks(param.name)
    push({
      kind: 'param',
      id: param.name,
      label: param.pl2012 ? `${param.name} · ${param.pl2012}` : param.name,
      /**
       * 说明的次序：**代码类 → 落到哪几个块 → 多少个量 → 门控哪几条边**。
       * 块名由矩阵反查 `blocks.items`（不新增数据）；量还没归块时如实说"还没落到任何块"。
       * 开关类没有直接落点时写"为真时改走哪几个量那支"：那条边的两端就是它的去处（见 `paramGatedNodes`）。
       */
      detail: [
        paramEntryOf(param.name)?.group ?? PARAM_GROUP_FALLBACK,
        blocks.length ? `落在 ${blocks.join('、')}` : '还没落到任何块',
        nodes.length
          ? `作用于 ${nodes.length} 个物理量`
          : gated.length
            ? `不改量的值，为真时改走 ${gated.length} 个量那支`
            : `作用于 0 个物理量（${paramAbsenceReason(param.name)}）`,
        ...(edges.length ? [`门控 ${paramGateLabels(param.name).join('、')}`] : []),
      ].join(' · '),
      collapsed: nodes.length ? isEngineeringObject('node', nodes[0]) : false,
      // 没有直接落点时取门控边的上游端：检索命中能飞到那条边挂着的量上，而不是飞无可飞
      focus: focusOf(nodes[0] ?? gated[0]),
    })
  })

  // 二路 / 三路：物理量 与 过程名（图上的对象一律可检索；块也在内，于是检索块名就能直达）
  graphNodes().forEach((node) => {
    // 阶段号（如 `S14`）也是命中面：量算在哪段代码里是能直接查的东西
    if (!matches([node.label, node.summary, node.stage], q)) return
    const quantity = node.type === 'quantity' || node.type === 'spectrum'
    /**
     * 归属说明（检索命中的"块标注"）：块自己报层/过程与主序位次，成员报它装在哪个块里。
     * 判据只有一份——生成物的 `blocks.items`，视图不按 `parent` 另算。
     */
    const belongs = String(node.id).startsWith('block:')
      ? node.blockKind === 'layer'
        ? '层'
        : `过程块 · 主序第 ${node.order ?? 0} 步`
      : `属于 ${blockLabelOf(node.id) ?? '（未归块）'}`
    push({
      kind: quantity ? 'quantity' : 'process',
      id: node.id,
      label: node.label,
      // 说明里只写归属、不印阶段号：编号是代码坐标（命中面仍含它，按 `S14` 照旧能查出这条）
      detail: `${quantity ? '物理量' : kindLabelOfType(node.type)} · ${belongs}`,
      collapsed: isEngineeringObject('node', node.id),
      focus: focusOf(node.id),
    })
  })

  /**
   * 四路：**过程面词条**（旧的一级轴，现在是一条检索面）。命中它的名字、拟合律口径、注释，
   * 或它下辖的任何一个量，都算命中。命中后定位到它的**主块**——过程面不是第三套节点，
   * 定位落回代码模块面的块上（这正是"两条轴并存"在交互上的样子）。
   */
  chainProcessEntries().forEach((entry) => {
    if (!matches([entry.label, entry.fit, entry.note, ...entry.members.map((member) => member.label)], q)) return
    push({
      kind: 'process',
      id: entry.id,
      label: entry.label,
      detail: [
        '过程·按论文等式划分',
        `下辖 ${entry.memberCount} 个量`,
        entry.paramCount ? `${entry.paramCount} 个相关参数` : '无相关参数',
        entry.paperCount ? `${entry.paperCount} 篇出处` : '没查到出处',
      ].join(' · '),
      collapsed: false,
      focus: { kind: 'node', id: entry.primaryBlock },
    })
  })

  // 四路：论文出处（按出处原文聚合，给出"引它的参数数 + 这些参数落到的量数"）
  const byPaper = new Map<string, ChainParam[]>()
  allParams().forEach((param) => {
    const paper = (param.paper ?? '').trim()
    if (!paper || !matches([paper], q)) return
    byPaper.set(paper, [...(byPaper.get(paper) ?? []), param])
  })
  byPaper.forEach((params, paper) => {
    const nodes = new Set(params.flatMap((param) => paramMatrixOf(param.name)?.nodes ?? []))
    push({
      kind: 'paper',
      id: paper,
      label: paper,
      detail: `${params.length} 个参数引它，落在 ${nodes.size} 个物理量上`,
      collapsed: nodes.size ? isEngineeringObject('node', [...nodes][0]) : false,
      focus: focusOf([...nodes][0]),
    })
  })

  return { hits, counts }
}

/* ============ 本页规模（状态条用；四个数都从生成物里数出来） ============ */

export interface ChainStats {
  /** 过程块：一级 11 个块里"过程"那 10 个（常数与网格是层，不算过程） */
  processBlocks: number
  /** 物理量：一级 11 个块的成员里**物理量**的条数（39 个，不重不漏；块里只有物理量，文件不挂成员） */
  quantities: number
  /** 参数：生成物里登记的全部参数（驱动量 + 天体物理 + 宇宙学 + 数值 + 开关） */
  params: number
  /** 文献：参数上出现的不重复出处数 */
  papers: number
}

export const chainStats = (): ChainStats => {
  const blocks = chainBlocks()
  const stats = chainBlockStats()
  return {
    processBlocks: blocks.filter((block) => block.kind === 'process').length,
    /**
     * 数物理量只数 `quantityMemberCount`（不是 `members.length`）：块里还混着工程节点，
     * 拿成员条数当"物理量数"会把它们一起算进去。
     */
    quantities: stats.members ?? blocks.reduce((sum, block) => sum + block.quantityMemberCount, 0),
    params: allParams().length,
    papers: new Set(allParams().map((param) => (param.paper ?? '').trim()).filter(Boolean)).size,
  }
}
