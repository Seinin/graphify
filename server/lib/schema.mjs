import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { MAX_EDGES, MAX_NODES } from './paths.mjs'

/**
 * 节点类型 = 要素种类（不是所在层）：画布按它取色，图例按它分组。
 * 六类主线要素：函数/过程、驱动/入口、参数/变量、数据/场、交付产物 + 装饰容器（大框）。
 */
export const NODE_TYPES = [
  'concept',
  'doc',
  'section',
  'method',
  /** 驱动 / 入口：顶层调用者（cli、run_coeval / run_lightcone / run_global_evolution） */
  'driver',
  /** 参数 / 变量：输入参数与运行时变量、容器对象（InputParameters…） */
  'variable',
  /** 数据 / 场：数组、密度场、速度场等中间数据 */
  'dataset',
  /** 交付产物：对外交付的结果（Coeval / LightCone / GlobalEvolution…） */
  'artifact',
  'result',
  'question',
  'tool',
  /** 大框：装饰容器（compound 父节点），子节点直接画在框里 */
  'group',
]

/** 箭头吸附端口：方框四条边的中点 */
export const ARROW_PORTS = ['n', 'e', 's', 'w']

/** 关系类型：决定边的语义与虚线样式 */
export const EDGE_TYPES = [
  'depends_on',
  'relates_to',
  'derives_from',
  'references',
  'contradicts',
  'extends',
]

export const NODE_TYPE_LABELS = {
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
  group: '大框',
}

export const EDGE_TYPE_LABELS = {
  depends_on: '依赖',
  relates_to: '相关',
  derives_from: '源自',
  references: '引用',
  contradicts: '相斥',
  extends: '扩展',
}

const looseString = (max) => z.string().trim().max(max).default('')

/** 节点可归属的话题数量上限（与前端选择器、生成器共用同一个口径） */
export const MAX_TOPICS = 12

/**
 * 数组元素数上限：cap 为 undefined 时用 fallback（保持原行为），为 null 时**不加 .max()**。
 *
 * 「关掉上限」只能这么实现：zod 没有「无穷」这个上限值，写 .max(Infinity) 不被接受，
 * 所以不设上限 == 根本不挂 .max()。开关来自 GRAPHIFY_MAX_NODES / GRAPHIFY_MAX_EDGES。
 */
const cappedArray = (item, fallback, cap) => {
  const limit = cap === undefined ? fallback : cap
  const array = z.array(item)
  return limit === null ? array : array.max(limit)
}

/**
 * 当前生效的节点/边上限（三态：undefined 未设置、null 不设上限、正整数）。
 * 供 /api/graph/schema 回调真实上限用——静态 schema 文件里写的是默认值。
 */
export const effectiveCaps = { nodes: MAX_NODES, edges: MAX_EDGES }

/**
 * 话题：图谱级视图。节点只存 id 列表，名称与说明集中在 meta.topics 注册表，
 * 因此改名不会让节点归属失效。
 */
export const topicSchema = z.object({
  id: z.string().trim().min(1, '话题 id 不能为空').max(40),
  name: z.string().trim().min(1, '话题名称不能为空').max(60),
  description: looseString(200),
})

/** 一张图最多注册多少个全局标签 */
export const MAX_TAGS = 60

/**
 * 全局标签注册表项。
 *
 * 与话题同一套模式：**id 与显示名分离**——节点只存 id，名称/说明/颜色集中在 meta.tags，
 * 因此改名不会让任何节点的归属失效（这是「全局标签」相对自由文本标签的核心区别）。
 */
export const tagDefinitionSchema = z.object({
  id: z.string().trim().min(1, '标签 id 不能为空').max(60),
  name: z.string().trim().min(1, '标签名称不能为空').max(60),
  description: looseString(400),
  /**
   * 分类（可选）：参照**代码里的参数划分**（如 inputs.py 里 InputStruct 的子类名），
   * 以及描述天体物理过程的 `AstroPhysics`。顶栏标签弹层按它分组显示；为空归入「未分类」。
   */
  group: looseString(40),
  /**
   * 标签对应的 notes 文档（相对 `docs/notes` 的路径，如 `XRAY_physics_manual.md`）。
   *
   * **每个标签都必须有文档**：没有就建一篇（空的也算），不允许出现「有标签、没处可查」。
   * 由 superRefine 强制校验；UI 上点标签直接打开这篇文档。
   */
  docId: looseString(160),
  /** 预留：标签自身的主色（十六进制）。当前红点用固定色，这里先存着 */
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, '颜色要写成 #RRGGBB')
    .optional(),
})

/**
 * 节点对知识库的引用。两种目标共用一条记录：
 *   · notes 文档：docId + anchor
 *   · 源代码：file（相对仓库根）+ line / endLine
 * 两者可以只有一个非空（源码引用常常没有 docId），因此这里不做「docId 必填」的交叉校验，
 * 由 graph.mjs 的 pickRefs 负责「至少有一个目标」。
 */
export const refSchema = z.object({
  docId: z.string().trim().max(240).default(''),
  anchor: looseString(160),
  label: looseString(160),
  /** 源码路径（相对仓库根，POSIX 分隔符） */
  file: z.string().trim().max(300).default(''),
  /** 起始行（1 起） */
  line: z.number().int().positive().nullable().default(null),
  /** 结束行（含）；等于 line 时按单行高亮 */
  endLine: z.number().int().positive().nullable().default(null),
})

/**
 * 标签明细条目：标签在**这个节点**上具体是什么。
 *   · label：参数名 / 子过程名 / 条目名（必填）
 *   · kind：该标签在此节点的角色（如「赋值」「入公式」「开关」），可选
 *   · note：补一句说明，可选
 *   · ref：出处（源码文件 + 行区间，或 notes 文档锚点），可点开对照
 *
 * 定义放在 refSchema 之后：它要引用 refSchema，而模块级 const 不能提前取用。
 */
export const tagDetailItemSchema = z.object({
  label: z.string().trim().min(1, '明细条目名不能为空').max(120),
  kind: looseString(20),
  note: looseString(300),
  ref: refSchema.nullable().optional(),
})

export const positionSchema = z.object({
  x: z.number(),
  y: z.number(),
})

const stamp = z.string().trim().min(1)

export const nodeSchema = z.object({
  id: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1, '节点名称不能为空').max(140),
  type: z.enum(NODE_TYPES).default('concept'),
  summary: looseString(600),
  /**
   * 全局**标签 id** 列表（不是自由文本）——id 必须存在于 meta.tags（见 graphSchema 的交叉校验）。
   * 这是从「自由文本标签」迁移过来的语义：改名不会让归属失效。
   */
  tags: z.array(z.string().trim().min(1).max(60)).max(24).default([]),
  /**
   * 标签明细：标签在**这个节点**上具体是什么。
   * 键必须是本节点 tags 里的 id（交叉校验），值是该标签在此节点的条目列表。
   */
  tagDetails: z
    .record(z.string().trim().min(1).max(60), z.array(tagDetailItemSchema).max(200))
    .default({}),
  refs: z.array(refSchema).max(48).default([]),
  /** 所属话题 id 列表；空数组表示不参与话题过滤。id 必须存在于 meta.topics（见 graphSchema 的交叉校验） */
  topics: z.array(z.string().trim().min(1).max(40)).max(MAX_TOPICS).default([]),
  /** 父节点 id：用于画布 compound 分组与折叠；null 表示顶层 */
  parent: z.string().trim().max(80).nullable().default(null),
  /** 条件/可选节点：画布上用虚线框表达（见 types.ts 与 styles.ts） */
  conditional: z.boolean().default(false),
  position: positionSchema.nullable().default(null),
  createdAt: stamp,
  updatedAt: stamp,
})

export const edgeSchema = z.object({
  id: z.string().trim().min(1).max(80),
  source: z.string().trim().min(1).max(80),
  target: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1, '关系名称不能为空').max(80),
  type: z.enum(EDGE_TYPES).default('relates_to'),
  directed: z.boolean().default(true),
  note: looseString(400),
  /** 箭头吸附端口：null 表示自动吸到最近的边 */
  sourcePort: z.enum(ARROW_PORTS).nullable().default(null),
  targetPort: z.enum(ARROW_PORTS).nullable().default(null),
  /** 条件/可选流动：画布上用虚线表达 */
  conditional: z.boolean().default(false),
  createdAt: stamp,
  updatedAt: stamp,
})

export const graphSchema = z
  .object({
    meta: z
      .object({
        version: z.number().int().positive().default(1),
        name: z.string().trim().min(1).max(120).default('未命名图谱'),
        description: looseString(400),
        /** 话题注册表；节点只引用 id，改名称不会让归属失效 */
        topics: z.array(topicSchema).max(MAX_TOPICS).default([]),
        /** 全局标签注册表；节点只引用 id，改名称/说明不会让归属失效 */
        tags: z.array(tagDefinitionSchema).max(MAX_TAGS).default([]),
        updatedAt: stamp,
      })
      .default({
        version: 1,
        name: '未命名图谱',
        description: '',
        topics: [],
        tags: [],
        updatedAt: new Date().toISOString(),
      }),
    nodes: cappedArray(nodeSchema, 5000, MAX_NODES).default([]),
    edges: cappedArray(edgeSchema, 20000, MAX_EDGES).default([]),
  })
  .superRefine((graph, ctx) => {
    // 交叉校验：节点声明的话题 / 标签必须已在对应注册表中登记。
    // 放在这里而不是 nodeSchema，是因为只有整图才看得到 meta.topics / meta.tags。
    const knownTopics = new Set(graph.meta.topics.map((topic) => topic.id))
    const knownTags = new Set(graph.meta.tags.map((tag) => tag.id))

    // 每个标签都必须有一篇对应文档（空的也算，先建上）——不允许「有标签、没处可查」
    graph.meta.tags.forEach((tag, index) => {
      if (String(tag.docId || '').trim()) return
      ctx.addIssue({
        code: 'custom',
        path: ['meta', 'tags', index, 'docId'],
        message: `标签「${tag.name}」没有对应文档：每个标签都必须有一篇 notes 文档（空的也要建）`,
      })
    })

    // 谁有子节点（= 谁的标签来自子图，而不是自己挂）
    const parents = new Set(graph.nodes.map((node) => node.parent).filter(Boolean))

    graph.nodes.forEach((node, index) => {
      node.topics.forEach((topicId) => {
        if (knownTopics.has(topicId)) return
        ctx.addIssue({
          code: 'custom',
          path: ['nodes', index, 'topics'],
          message: `节点「${node.label}」(${node.id}) 引用了未注册的话题：${topicId}`,
        })
      })
      node.tags.forEach((tagId) => {
        if (knownTags.has(tagId)) return
        ctx.addIssue({
          code: 'custom',
          path: ['nodes', index, 'tags'],
          message: `节点「${node.label}」(${node.id}) 引用了未注册的标签：${tagId}`,
        })
      })
      // 明细只能挂在已归属的标签上：避免出现「有明细却没人认领」的悬空数据
      Object.keys(node.tagDetails || {}).forEach((tagId) => {
        if (node.tags.includes(tagId)) return
        ctx.addIssue({
          code: 'custom',
          path: ['nodes', index, 'tagDetails'],
          message: `节点「${node.label}」(${node.id}) 的标签明细不属于它：${tagId}`,
        })
      })
      /**
       * 标签只长在**叶子**上：有子节点的模块不自己挂标签。
       * 它的标签是「子图上所有叶子标签的并集」，由前端派生展示——这样「子图有某标签 → 父亲必然引用它」
       * 永远成立，不需要两边同步。
       */
      if (parents.has(node.id) && (node.tags.length || Object.keys(node.tagDetails || {}).length)) {
        ctx.addIssue({
          code: 'custom',
          path: ['nodes', index, 'tags'],
          message: `模块「${node.label}」(${node.id}) 有子节点，不该自己挂标签：标签只长在叶子上，父模块展示子图标签的并集`,
        })
      }
    })
  })

/** LLM / 脚本导入草案：id 与 position 可省略，source/target 允许写节点名称 */
export const draftNodeSchema = z.object({
  id: z.string().trim().max(80).optional(),
  label: z.string().trim().min(1, '节点名称不能为空').max(140),
  type: z.enum(NODE_TYPES).default('concept'),
  summary: looseString(600),
  tags: z.array(z.string().trim().min(1).max(40)).max(24).default([]),
  refs: z.array(refSchema).max(48).default([]),
  /** 所属话题 id 列表；合并进图谱时由 graphSchema 统一校验是否已注册 */
  topics: z.array(z.string().trim().min(1).max(40)).max(MAX_TOPICS).optional(),
  /** 父节点 id 或名称；null/空串表示显式声明为顶层，未命中则降级为顶层并记一条警告 */
  parent: z.string().trim().max(140).nullable().optional(),
  /** 条件/可选节点（画布虚线框） */
  conditional: z.boolean().optional(),
  /** 初始坐标：给了就按它落位（迁移既有图纸时「导入即摆好版面」）；合并已有节点时不覆盖其坐标 */
  position: positionSchema.nullable().optional(),
})

export const draftEdgeSchema = z.object({
  id: z.string().trim().max(80).optional(),
  source: z.string().trim().min(1, 'source 不能为空').max(140),
  target: z.string().trim().min(1, 'target 不能为空').max(140),
  label: z.string().trim().min(1, '关系名称不能为空').max(80),
  type: z.enum(EDGE_TYPES).default('relates_to'),
  directed: z.boolean().default(true),
  note: looseString(400),
  /** 条件/可选流动（画布虚线） */
  conditional: z.boolean().optional(),
})

export const importDraftSchema = z.object({
  mode: z.enum(['merge', 'replace']).default('merge'),
  dryRun: z.boolean().default(false),
  meta: z
    .object({
      name: z.string().trim().min(1).max(120).optional(),
      description: looseString(400).optional(),
      /** 话题注册表：replace 模式下必须随草案一起给出，否则节点的话题归属会校验失败 */
      topics: z.array(topicSchema).max(MAX_TOPICS).optional(),
    })
    .optional(),
  nodes: cappedArray(draftNodeSchema, 2000, MAX_NODES).default([]),
  edges: cappedArray(draftEdgeSchema, 6000, MAX_EDGES).default([]),
})

export const newId = (prefix) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 10)}`

export const nowIso = () => new Date().toISOString()

export function emptyGraph() {
  return {
    meta: { version: 1, name: '未命名图谱', description: '', topics: [], updatedAt: nowIso() },
    nodes: [],
    edges: [],
  }
}

/** 校验并补全默认值；失败时抛出带可读信息的错误 */
export function parseGraph(input) {
  const result = graphSchema.safeParse(input)
  if (!result.success) {
    throw new ValidationError('图谱数据校验失败', result.error.issues)
  }
  return result.data
}

/** 非抛出式校验：读取磁盘数据时用它做兜底，避免损坏文件拖垮服务 */
export function tryParseGraph(input) {
  const result = graphSchema.safeParse(input)
  if (result.success) return { ok: true, graph: result.data }
  return { ok: false, issues: normalizeIssues(result.error.issues) }
}

export function normalizeIssues(issues) {
  return (issues || []).map((issue) => ({
    path: Array.isArray(issue.path) ? issue.path.join('.') : String(issue.path ?? ''),
    message: issue.message,
  }))
}

/**
 * 字段别名归一化。
 *
 * Python 侧管线（docling-graph 由 JSON Schema 生成的 Pydantic 模板、以及多数 LLM 的默认输出）
 * 习惯 snake_case，并且会把 `type` 规范成 `category`、`label` 规范成 `name_label`。
 * 在入库前统一映射一次，调用方就不必为命名风格买单；同名字段以规范名为准。
 */
const FIELD_ALIASES = {
  name_label: 'label',
  category: 'type',
  identifier: 'id',
  doc_id: 'docId',
  dry_run: 'dryRun',
}

export function applyFieldAliases(value) {
  if (Array.isArray(value)) return value.map(applyFieldAliases)
  if (!value || typeof value !== 'object') return value

  const result = {}
  const pending = []
  for (const [key, raw] of Object.entries(value)) {
    const canonical = FIELD_ALIASES[key]
    if (canonical) pending.push([canonical, raw])
    else result[key] = applyFieldAliases(raw)
  }
  // 规范名优先：只有在其缺失时才用别名补齐
  for (const [canonical, raw] of pending) {
    if (result[canonical] !== undefined) continue
    if (raw === undefined || raw === null || raw === '') continue
    result[canonical] = applyFieldAliases(raw)
  }
  return result
}

export function parseDraft(input) {
  const result = importDraftSchema.safeParse(input)
  if (!result.success) {
    throw new ValidationError('导入草案校验失败', result.error.issues)
  }
  return result.data
}

export class ValidationError extends Error {
  constructor(message, issues = []) {
    super(message)
    this.name = 'ValidationError'
    this.issues = issues.map((issue) => ({
      path: Array.isArray(issue.path) ? issue.path.join('.') : String(issue.path ?? ''),
      message: issue.message,
    }))
  }
}
