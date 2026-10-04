/**
 * 节点类型 = **要素种类**（不是所在层）：画布上同类要素同色，一眼分清函数、参数、数据、产物……
 *
 * 代码流程图的六类主线要素：
 *   · method   函数 / 过程（compute_halo_grid、_redshift_loop_generator…）
 *   · driver   驱动 / 入口（cli、run_coeval、三个顶层驱动）
 *   · variable 参数 / 变量（InputParameters、evolve_input_structs、容器对象）
 *   · dataset  数据 / 场（δ_k、密度场、速度场；本图多数已文本化为边标签）
 *   · artifact 交付产物（Coeval 快照 / LightCone / GlobalEvolution、OutputCache 落盘）
 * 其余为通用类型（概念/文档/章节/结论/问题/工具）与大框（装饰容器）。
 */
export type NodeType =
  | 'concept'
  | 'doc'
  | 'section'
  | 'method'
  | 'driver'
  | 'variable'
  | 'dataset'
  | 'artifact'
  | 'result'
  | 'question'
  | 'tool'
  /**
   * 物理链专用种类（物理视角那页用；工程视角的 data/graph.json 不出现这些取值）：
   * 让「物理量 / 功率谱 / 函数关系 / 工程与装配」各自的颜色不同——这是该页的既定要求。
   */
  | 'quantity'
  | 'spectrum'
  | 'function'
  | 'engineering'
  /**
   * 物理链的**块**（一级那 11 个块 = 10 个天体物理过程 + 1 个层）：`type = 'process'` 的**普通**节点，
   * 不是容器——块的成员挂在它的 `parent` 下，只在块自己的子图里出现。
   * 与 `method`（"函数/过程"，代码侧的一个函数）区分开：这里是"天体物理上的一站"。
   */
  | 'process'
  /**
   * 大框：装饰容器（compound 父节点），子节点直接画在框里。只作分组，不参与语义。
   * 物理链页一级的**段容器**（`seg:*`）走的也是这一类：全站只有这一种"框住一批东西"的类型，
   * 画布页的层带与链页的段因此同色、同口径（见 `graphify-physics-chain` 的「段是容器」）。
   */
  | 'group'

/** 箭头吸附端口 = 方框的四条边中点；null / 缺省表示「自动吸到最近的边」 */
export type ArrowPort = 'n' | 'e' | 's' | 'w'

export const ARROW_PORTS: ArrowPort[] = ['n', 'e', 's', 'w']

export const ARROW_PORT_LABELS: Record<ArrowPort, string> = {
  n: '上',
  e: '右',
  s: '下',
  w: '左',
}

export type EdgeType =
  | 'depends_on'
  | 'relates_to'
  | 'derives_from'
  | 'references'
  | 'contradicts'
  | 'extends'

/**
 * 话题：图谱级视图。同一节点可归属多个话题，切换话题即切换整张画布。
 * 注册表存在 meta.topics，节点侧只存 id 列表；不在注册表里的 id 会被服务端校验拒绝。
 */
export interface Topic {
  id: string
  name: string
  description: string
}

/**
 * 节点对知识库的引用。两类目标共用一个结构：
 *   · notes 文档：`docId` + `anchor`（章节锚点）
 *   · 源代码：`file`（相对仓库根的路径）+ `line` / `endLine`（行区间）
 * 两类的 `label` 都是给界面显示的可读名。判定用 isCodeRef / isDocRef。
 */
export interface GraphRef {
  docId: string
  anchor: string
  label: string
  /** 源码引用的文件路径（相对仓库根，POSIX 分隔符） */
  file?: string
  /** 源码引用的起始行（1 起）；为 null / 缺省时从第 1 行预览 */
  line?: number | null
  /** 源码引用的结束行（含）；用于高亮一段而不是一行 */
  endLine?: number | null
}

/** 是否为源码引用（有文件路径即算，notes 引用没有该字段） */
export const isCodeRef = (ref: GraphRef): boolean => Boolean(ref.file && ref.file.trim())

/** 是否为 notes 引用 */
export const isDocRef = (ref: GraphRef): boolean => Boolean(ref.docId && ref.docId.trim())

/**
 * 源码引用的**行区间**（不带文件名）：`120-145` / `120`；没有行号时是空串。
 *
 * 与 `codeRefFileName` 配对使用：清单按文件归并时，文件名当主行、行区间逐条列在下面。
 */
export const codeRefLineRange = (ref: GraphRef): string => {
  if (!isCodeRef(ref)) return ''
  const start = Number(ref.line) > 0 ? Number(ref.line) : null
  const end = Number(ref.endLine) > 0 ? Number(ref.endLine) : null
  if (start && end && end > start) return `${start}-${end}`
  if (start) return String(start)
  return ''
}

/** 源码引用的**文件名**（不带目录）：`SpinTemperatureBox.c` */
export const codeRefFileName = (ref: GraphRef): string => {
  const path = String(ref.file ?? '')
  const cut = path.lastIndexOf('/')
  return cut === -1 ? path : path.slice(cut + 1)
}

/** 源码引用的显示名：`路径:行` 或 `路径:起-止` */
export const codeRefLocation = (ref: GraphRef): string => {
  if (!isCodeRef(ref)) return ''
  const range = codeRefLineRange(ref)
  return range ? `${ref.file}:${range}` : String(ref.file)
}

/**
 * 引用的**完整落点**（两类共用）：源码 = `路径:行`（或 `路径:起-止`）；notes = `文档路径#锚点`。
 *
 * 它是"这一条引用到底是哪一处"的**身份**，用在去重、比较、`title` 与提示里；
 * 界面上要显示给人看的短名见 `refLocationShort`。
 */
export const refLocation = (ref: GraphRef): string =>
  isCodeRef(ref) ? codeRefLocation(ref) : `${ref.docId}${ref.anchor ? `#${ref.anchor}` : ''}`

/**
 * 引用在界面上的**短落点**：只留文件名，不带目录前缀——
 * `SpinTemperatureBox.c:120-145`、`thermal.md#members`。
 *
 * 目录前缀（`src/py21cmfast/src/`、`physics-chain/modules/`）对读的人是噪声：一眼要看的是
 * "哪个文件、哪几行 / 哪一节"。完整路径不丢，只是退到 `title` 里，且打开文件仍用完整路径
 * （`onOpenRef` 拿的是 `ref` 本身，与显示无关）。
 */
export const refLocationShort = (ref: GraphRef): string => {
  const full = refLocation(ref)
  const cut = full.lastIndexOf('/')
  return cut === -1 ? full : full.slice(cut + 1)
}

/**
 * 全局标签注册表项。
 *
 * 与话题同一套模式：**id 与显示名分离**——节点只存 id，名称/说明/颜色放注册表，
 * 因此改名不会让任何节点的归属失效。
 */
export interface TagDefinition {
  id: string
  name: string
  description: string
  /**
   * 分类（可选）：参照代码里的参数划分（inputs.py 的 InputStruct 子类名，如 SimulationOptions）。
   * 顶栏参数弹层按它分组；**右侧属性面板按它上色**（见 `graph/palette.ts` 的 `TAG_GROUP_COLORS`）；
   * 不是模型参数的代码名（如分析侧自选的 `K_TARGET`）归「非模型参数」；为空归入「未分类」。
   * 后两者都不在配色表里，用中性灰兜底。
   */
  group?: string
  /** 标签对应的 notes 文档（相对 docs/notes 的路径）：点标签即打开它。每个标签都必须有一篇 */
  docId?: string
  /**
   * 标签主色（#RRGGBB）：**右侧属性面板按它上色**；画布上的红点仍是固定玫红
   * （`graph/palette.ts` 的 `TAG_DOT_COLOR`），不跟着变。
   *
   * 缺省时前端按 `group` 派生（`tagAccentOf`），所以新建标签不必手工配色；
   * 数据里的这一份由 `scripts/color-tags.mjs` 按同一张表 seed，`npm run check:canvas`
   * 有一条断言要求它与 `group` 的表值一致（防止两处漂移）。
   */
  color?: string
}

/**
 * 标签明细条目：标签在**这个节点**上具体是什么。
 *   · label：参数名 / 子过程名 / 条目名
 *   · kind：该标签在此节点的角色（如「赋值」「入公式」「开关」）
 *   · note：补一句说明
 *   · ref：出处（源码 file + line，或 notes docId + anchor），可点开对照
 */
export interface TagDetailItem {
  label: string
  kind: string
  note: string
  ref?: GraphRef | null
}

/** 某个标签在某个节点上的明细列表：`node.tagDetails[tagId]` */
export type TagDetailMap = Record<string, TagDetailItem[]>

export interface NodePosition {
  x: number
  y: number
}

/**
 * 物理链页的**手动摆放**（`data/chain-layout.json`）：节点 id → 坐标覆盖层。
 *
 * 只存位置：这一页的数据由生成物驱动，本机能改的就是"谁摆在哪儿"。
 * `updatedAt` 为 null 表示这份覆盖层还没写过（页面照生成物烘好的默认摆位显示）。
 */
export interface ChainLayout {
  graph: string
  updatedAt: string | null
  positions: Record<string, NodePosition>
}

export interface GraphNode {
  id: string
  label: string
  type: NodeType
  summary: string
  /**
   * **摘要位置的公式**：排版的 LaTeX（如 `\dot\rho_\star=…`），逐字来自真源 `docText[id].formula`。
   *
   * 与 `summary` 的分工：`summary` 仍是一句话 / 纯文本（检索命中说明读它）；这个字段是**排过版的数学**。
   * 只有物理链页**带公式的对象**（真源里恰好每个成员一条：34 个节点 + 5 个驱动量）带它，
   * 画布页的数据里没有这个字段——检查器见到它就渲染公式、不再出输入框（见 `Inspector`）。
   */
  formula?: string
  /**
   * 全局**标签 id** 列表（不是自由文本）——id 必须存在于 `meta.tags` 注册表，改名不动归属。
   * 编辑入口是注册表多选（见 Inspector），自由文本输入已移除。
   */
  tags: string[]
  /** 标签明细：标签在该节点上具体是什么（键必须是本节点 tags 里的 id） */
  tagDetails: TagDetailMap
  refs: GraphRef[]
  /** 所属话题 id 列表；空数组表示不参与话题过滤（旧图 / 全库骨架视图） */
  topics: string[]
  /**
   * 层级父节点 id；null 表示顶层。
   *
   * 父节点的类型决定这一层关系怎么呈现（装饰容器 vs 模块，见 graph/hierarchy.ts）：
   *   · 父节点是 `group`（大框 / 装饰容器）→ 子节点直接画在框里（compound），框不可进入；
   *   · 父节点是模块（非 group 但有子节点）→ 子节点不与它同屏，
   *     只在它自己的子图标签页里出现（双击或属性页入口进入）。
   */
  parent: string | null
  /**
   * 是否「条件/可选」：对应流程图里**虚线框**表达的含义（例如「仅 lagrangian 源模型时才执行」）。
   * 与 `.branch`（未展开分支）共用虚线描边样式，但语义不同，互不覆盖。
   */
  conditional?: boolean
  position: NodePosition | null
  createdAt: string
  updatedAt: string
  /**
   * **代码阶段号**（如 `S14`），只由生成物写入、界面只读：**已降级为普通属性，不再决定分层**
   * （一级怎么划分看生成物里的 `blocks`，同一个物理过程常被拆在好几个代码阶段里）。
   * 属性页拿它回答"这个量算在哪段代码里"；驱动量 / 外部量不属于任何阶段 → 空串。
   */
  stage?: string
  /**
   * **段名**（`layer` 层 / `prep` 红移循环前 / `loop` 逐红移循环）：
   * 只有**块**与**段容器**带它。段的从属由**包含**表达（块装在段容器里），这个字段留在数据里
   * 供离线工具与自检按段说话——视图不读它（`check:chain` 的段内计数正是按它重算的）。
   */
  phase?: string
  /** 块节点（`type: 'process'`）上那份"成员涉及哪几段代码"的并集（量各自的在 `stage` 上） */
  stages?: string[]
  /**
   * **对外输入（灰显的上下文节点）**：块节点上列出"块外指进来"的量 id。
   * 进这个块的子图时，这些量会**额外显形并灰显**——它们是**别的块的成员本人**（同一个 id、同一个 `parent`），
   * 不是复制出来的节点，所以主图里同一个量仍然只有一个；`parent` 不变，层级、层级条、
   * 「进入子图（N 个子节点）」计数都不受它影响，只有可见集与样式读它（见 `graph/hierarchy.ts`）。
   */
  contexts?: string[]
  /**
   * **回流在这个视图面上的来处**：这个量是这些块"这一步读的上一轮那份"（值是**读它的块 id**）。
   * 与 `GraphEdge.subgraphOf` 同一路——只在物理链页的派生视图上有，产物里没有这个字段。
   *
   * 它进这一块的子图只因"这一步读上一轮的它"，所以浮层上那个开关一并管着它：关着时这个盒子也不画
   * （渲染器按当前聚焦的块切 `feedback-off`）。已经写进 `contexts`（本块声明的对外输入）的量不写在这里
   * ——关掉开关它仍该在场。
   */
  feedbackInputOf?: string[]
  /**
   * **回流在这个视图面上的去处**：这个量是这些块"上一轮算出来、被别的块读走"的那一份
   * （值是**送出它的块 id**）——回流弧的另一端，同样只在物理链页的派生视图上有。
   *
   * 它进这一块的子图只因"上一轮把本块的它送了出去"，所以浮层上那个开关一并管着它：关着时这个盒子也不画。
   * 与 `feedbackInputOf` 同理，已经写进 `contexts`（本块声明的对外输入）的量不写在这里。
   */
  feedbackOutputOf?: string[]
  /**
   * 块节点是否可进入子图。`false` = 「层」（常数与网格：
   * 没有一条属于自己的主序流，它的成员是常数、进不出什么东西来）：
   * 画布不挂"可进入"的信号（光晕 / 呼吸 / 双击进入），属性页也不给「进入子图 ↗」。
   * 其它节点不写这个字段（按可进入处理）。
   */
  enterable?: boolean
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  label: string
  type: EdgeType
  directed: boolean
  note: string
  /** 起点吸附端口；null / 缺省 = 自动吸到离目标最近的那条边 */
  sourcePort?: ArrowPort | null
  /** 终点吸附端口；null / 缺省 = 自动吸到离起点最近的那条边 */
  targetPort?: ArrowPort | null
  /**
   * 是否「条件/可选」流动：对应流程图里的**虚线路**（例如「只有 lagrangian 源模型才有这条数据流」）。
   * 打开后连线走虚线，与按关系类型（relates_to）自带的虚线是两回事。
   */
  conditional?: boolean
  /** 块间交付边（走总线的那一档）：视图按它把线画成折线，与子图里的直连区分开 */
  crossLink?: boolean
  /**
   * 回流的种类标记（生成器与视图同读这一份）：
   *   · `feedback`：一级上那条**块间回流弧**（上一轮指回下一轮那一步，与主序反向）；
   *   · `feedback-input`：**回流在子图里的落点**（`fromNode → toNode` 那条成员级输入边）。
   *     它**不在产物里**：由物理链页按产物那条块间弧派生（见 `subgraphOf`），在**弧两端块**的标签页里各显形一次
   *     ——收方块那侧讲"我读进来的"，来源块那侧讲"我送出去的"。
   *
   * 分层模型（层差 / 骨干树 / 跨层成因）整体退场后，**`kind` 是这一族里唯一的标记**：
   * "跨了几步"不再由数据说，而由几何（道深）说。
   */
  kind?: 'feedback' | 'feedback-input'
  /**
   * 跨红移回流记的两端量（只有回流边有）：`fromNode` 是**上一轮**送出去的那个量，`toNode` 是这一步真正读它的量。
   * 主图上的弧记的是两端**块**（`source` / `target`）；进到子图里这条关系落在**成员级**，
   * 视图据这两个字段派生一条 `fromNode → toNode` 的输入边（`kind: 'feedback-input'`）。
   */
  fromNode?: string
  toNode?: string
  /**
   * **这条边只属于哪个块的标签页**：`block:x` ＝ 只在聚焦 `block:x` 的子图里显形，主图与别的子图都不画。
   * 只有视图派生的回流落点边用它（产物里没有这个字段）；一条弧在两端块各派一条，两条靠这个字段分别收口。
   */
  subgraphOf?: string
  createdAt: string
  updatedAt: string
}

export interface GraphMeta {
  version: number
  name: string
  description: string
  /** 话题注册表；节点通过 GraphNode.topics 引用其中的 id */
  topics: Topic[]
  /** 全局标签注册表；节点通过 GraphNode.tags 引用其中的 id */
  tags: TagDefinition[]
  updatedAt: string
}

export interface Graph {
  meta: GraphMeta
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface MdHeading {
  depth: number
  text: string
  slug: string
  line: number
}

export interface MdDoc {
  docId: string
  fileName: string
  folder: string
  title: string
  summary: string
  headings: MdHeading[]
  chars: number
  updatedAt: string
}

export interface MdDocContent extends MdDoc {
  absolutePath: string
  content: string
}

// ---------- 源码索引（/api/code） ----------

/** 源码索引里的一条文件记录 */
export interface CodeFile {
  /** 相对仓库根的路径（POSIX），与 GraphRef.file 同一口径 */
  path: string
  name: string
  dir: string
  ext: string
  /** Prism 语言名，供语法高亮使用 */
  language: string
  size: number
  updatedAt: string
}

export interface CodeLine {
  /** 1 起的行号 */
  n: number
  text: string
}

/**
 * 词法前缀：一段窗口想要"从正确状态开始高亮"所需的那一行原文。
 *
 * 窗口是按段取的，起点可能落在某个跨行的字符串 / 注释内部（例如 Python 的 `r"""` 文档串
 * 开了 49 行，而窗口从中间开始）。语法高亮是逐窗口做词法分析的，没有这一行的话，
 * 窗口里那个本该是**闭引号**的 `"""` 会被当成开引号，它往后整片都会被染色。
 *
 * 它**只参与语法分析，不参与显示**（服务端见 `server/lib/lexState.mjs`）。
 */
export interface LexPrefix {
  /** 开启那个跨行构造的行号（1 起） */
  start: number
  /** 那一行的原文 */
  text: string
}

/** 一次行窗口读取的结果：`highlight*` 是要强调的区间，`lines` 是含上下文的全窗口 */
export interface CodeWindow {
  path: string
  absolutePath: string
  name: string
  language: string
  totalLines: number
  windowStart: number
  windowEnd: number
  highlightStart: number
  highlightEnd: number
  /** 请求区间是否被文件长度或单次上限夹过 */
  clamped: boolean
  bytes: number
  oversized: boolean
  /**
   * 「这个文件大到需要说明一句」的原因（字节超上限 / 行数超过按段浏览阈值）；
   * 正常文件为 null。界面据此说明「按段加载」，而不是静默只给一小段。
   */
  oversizedReason: string | null
  /** 本段实际返回的行范围（分页语义的名字，与 windowStart / windowEnd 同值） */
  segmentStart: number
  segmentEnd: number
  /** 本段之前 / 之后还有没有内容：决定滚到边界时要不要续段 */
  hasPrev: boolean
  hasNext: boolean
  /**
   * 让本段首行处于正确词法状态的那一行（开引号 / 块注释起始行）；不需要时是 null。
   * 只参与语法分析，不显示——详见 `LexPrefix`。
   */
  lexPrefix: LexPrefix | null
  updatedAt: string
  lines: CodeLine[]
}

export interface GraphVersion {
  id: string
  reason: string
  savedAt: string
  size: number
  nodes: number
  edges: number
  /**
   * 保留副本（手动"另存为"产出的那一份）：不参与快照轮转，可单独删除。
   * 自动快照是 false，受轮转上限管理。
   */
  pinned: boolean
}

export interface ImportPreview {
  applied: { nodes: number; edges: number }
  createdNodes: { id: string; label: string }[]
  updatedNodeIds: string[]
  createdEdges: { id: string; label: string }[]
  updatedEdgeIds: string[]
  errors: { index: number; reason: string }[]
}

export type SelectionKind = 'node' | 'edge' | null

export interface Selection {
  kind: SelectionKind
  id: string | null
}

export const NODE_TYPE_ORDER: NodeType[] = [
  'group',
  'driver',
  'method',
  'variable',
  'dataset',
  'artifact',
  'section',
  'concept',
  'doc',
  'result',
  'question',
  'tool',
  // 物理链专用：图例里排在工程视角那批之后，先物理后工程（块排最前——它是一级的那个东西）
  'process',
  'quantity',
  'spectrum',
  'function',
  'engineering',
]

export const NODE_TYPE_LABELS: Record<NodeType, string> = {
  group: '大框',
  concept: '概念',
  doc: '文档',
  section: '章节',
  method: '函数/过程',
  driver: '驱动/入口',
  variable: '参数/变量',
  dataset: '数据/场',
  artifact: '交付产物',
  result: '结论',
  question: '问题',
  tool: '工具',
  process: '天体物理过程',
  quantity: '物理量',
  spectrum: '功率谱',
  function: '函数关系',
  engineering: '工程与装配',
}

/**
 * 要素种类色。浅色主题下整体加深一档：节点以 0.16 透明度填充 + 1.6px 实描边呈现，
 * 原来的浅亮色（为深色画布挑选）在白底上对比不足。
 *
 * 六类主线要素刻意选在色相环的不同区间：函数紫 / 驱动蓝 / 参数青 / 数据天蓝 / 产物品红 / 容器墨绿，
 * 同层内并列时也能一眼分开（天蓝与青相邻，靠深浅差区分）。
 */
export const NODE_TYPE_COLORS: Record<NodeType, string> = {
  group: '#0F766E',
  section: '#64748B',
  method: '#7C3AED',
  driver: '#2563EB',
  variable: '#0E7490',
  dataset: '#0284C7',
  artifact: '#BE185D',
  concept: '#4F46E5',
  doc: '#0891B2',
  result: '#16A34A',
  question: '#D97706',
  tool: '#DB2777',
  // 物理链：物理量（琥珀）/ 功率谱（品红）/ 函数关系（橙）/ 工程与装配（中性灰，表示"不属于物理链"）
  /**
   * 块取**容器墨绿**：段容器是淡底的框（填充 0.05、压在最底），块是画在框里的实体（填充 0.16）——
   * 同一色相靠填充深浅分开，与画布页"层带 + 框内节点"同一套读法（见 `palette.ts` 的大框底色）。
   */
  process: '#0F766E',
  quantity: '#B45309',
  spectrum: '#C026D3',
  function: '#EA580C',
  engineering: '#6B7280',
}

/** 大框判定：容器节点（compound 父节点）只负责圈层，不参与语义关系 */
export const isGroupNode = (node: { type: NodeType } | null | undefined): boolean => node?.type === 'group'

/**
 * 某节点的全部后代 id（含多层）。用于「大框不能塞进自己的子孙」这类校验，
 * 以及检查器里的父节点候选过滤。父子成环的数据在意料之外，因此带访问集防护。
 */
export function descendantIdsOf(
  nodes: readonly { id: string; parent: string | null }[],
  id: string,
): Set<string> {
  const childrenOf = new Map<string, string[]>()
  nodes.forEach((node) => {
    if (!node.parent) return
    const bucket = childrenOf.get(node.parent)
    if (bucket) bucket.push(node.id)
    else childrenOf.set(node.parent, [node.id])
  })
  const out = new Set<string>()
  const queue = [...(childrenOf.get(id) ?? [])]
  while (queue.length) {
    const current = queue.shift() as string
    if (out.has(current) || current === id) continue
    out.add(current)
    queue.push(...(childrenOf.get(current) ?? []))
  }
  return out
}

export const EDGE_TYPE_ORDER: EdgeType[] = [
  'depends_on',
  'relates_to',
  'derives_from',
  'references',
  'contradicts',
  'extends',
]

export const EDGE_TYPE_LABELS: Record<EdgeType, string> = {
  depends_on: '依赖',
  relates_to: '相关',
  derives_from: '源自',
  references: '引用',
  contradicts: '相斥',
  extends: '扩展',
}

export const emptyGraph = (): Graph => ({
  meta: {
    version: 1,
    name: '未命名图谱',
    description: '',
    topics: [],
    tags: [],
    updatedAt: new Date().toISOString(),
  },
  nodes: [],
  edges: [],
})

export const cloneGraph = (graph: Graph): Graph => {
  const ids = new Set(graph.nodes.map((node) => node.id))
  return {
    // topics / tags 都是对象数组，必须逐项复制：否则编辑副本的注册表会连带改到原图
    meta: {
      ...graph.meta,
      topics: (graph.meta.topics ?? []).map((topic) => ({ ...topic })),
      tags: (graph.meta.tags ?? []).map((tag) => ({ ...tag })),
    },
    nodes: graph.nodes.map((node) => ({
      ...node,
      // 层级父节点必须真实存在；悬空或自指时降级为顶层，避免层级模型出现断链
      parent: node.parent && node.parent !== node.id && ids.has(node.parent) ? node.parent : null,
      tags: [...node.tags],
      // 明细是「标签 id → 条目数组」的嵌套结构，逐层复制，否则撤销栈里的快照会被后续编辑改到
      tagDetails: Object.fromEntries(
        Object.entries(node.tagDetails ?? {}).map(([tagId, items]) => [
          tagId,
          items.map((item) => ({ ...item, ref: item.ref ? { ...item.ref } : item.ref })),
        ]),
      ),
      refs: node.refs.map((ref) => ({ ...ref })),
      topics: [...(node.topics ?? [])],
      position: node.position ? { ...node.position } : null,
    })),
    edges: graph.edges.map((edge) => ({ ...edge })),
  }
}
