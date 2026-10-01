#!/usr/bin/env node
/**
 * 代码逻辑拓扑大纲导出器：把人工撰写的框架文档（docs/notes/CODE_TOPOLOGY.md）编译成图谱大纲（v2）。
 *
 * 为什么要有这一层：框架文档是唯一的人工来源，181 个节点的「层级 + 话题 + 摘要」如果手工誊抄进大纲，
 * 改一次文档就要对一次账。这里让文档自己说话——
 *   · 标题层级 → parent：`##` 是阶段（话题根），`###`/`####`/`#####`/`######` 依次是子过程、
 *     计算单元、关键过程；H1 是文档标题、`## 附录…` 整段不建节点；
 *   · 阶段标题 → 话题注册表：映射表写死在本文件里，出现没登记的阶段即报错，避免「改了标题话题悄悄丢」；
 *   · 每节首段 → 节点摘要：只取标题后的第一段散文，`关键函数`/`关键量` 条目属于末端细节，不进摘要；
 *   · 节点引用 → 该节标题本身（写正则，slug 由生成器回填，绝不手写锚点）。
 *
 * 用法：
 *   node scripts/export-code-outline.mjs            # 写 data/code.outline.json
 *   node scripts/export-code-outline.mjs --stdout   # 只打印统计与逐话题成员数，不落盘
 *   node scripts/export-code-outline.mjs --out=a.json
 *
 * 产物由 scripts/build-code-graph.mjs 消费（校验 + 锚点回填 + 生成草案）。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DOC_PATH = path.join(ROOT, '..', 'docs', 'notes', 'CODE_TOPOLOGY.md')
const OUT_PATH = path.join(ROOT, 'data', 'code.outline.json')
const DOC_ID = 'CODE_TOPOLOGY.md'

/** 层级深度上限（含阶段根）：H2 算第 1 层，故 H6 是第 5 层 */
const MAX_DEPTH = 5
/** 节点摘要取首段，截断长度（schema 上限 600，这里留足余量） */
const SUMMARY_MAX = 300
/** 与 server/lib/schema.mjs、生成器同口径的上限，越界一律报错而不是截断 */
const LIMITS = { nodeId: 80, label: 140, topicId: 40, topicName: 60, topicDescription: 200 }

/**
 * 阶段标题 → 话题。**新增或改名阶段必须同步这张表**，否则导出直接报错退出。
 * 话题名直接取阶段标题，描述说明该话题下能看到什么。
 */
const TOPICS = {
  输入与全局配置: {
    id: 'code-inputs',
    description: '整条链共用的参数与常量：哪些量在运行时被广播成全局，哪些常量用户改不了。',
  },
  宇宙学背景: {
    id: 'code-cosmo',
    description: '线性功率谱、增长因子、质量方差，以及被反复查询的插值表与前端直接积分入口。',
  },
  质量函数与统计工具: {
    id: 'code-hmf',
    description: '解析质量函数、塌缩阈值与积分引擎，以及模糊暗物质对功率谱与质量函数的抑制。',
  },
  初始条件: {
    id: 'code-ic',
    description: '高斯随机密度场的抽样与实空间化、速度场与相对速度场，以及随机数与傅里叶基建。',
  },
  微扰场与速度: {
    id: 'code-perturb',
    description: '按红移把初始密度演化成非线性密度场与速度场，并统一到低分辨率网格。',
  },
  晕目录与位移: {
    id: 'code-structure',
    description: '在网格上识别晕或随机采样晕、对晕位置做速度位移、把质量与属性映射到欧拉网格。',
  },
  天体物理源: {
    id: 'code-sources',
    description: '从晕质量到恒星质量与各类发射量的标度关系、源项网格化，以及光度函数诊断。',
  },
  电离与复合: {
    id: 'code-ion',
    description: '多尺度滤波与塌缩分数积分、游程集电离判据与气泡标记、复合与自屏蔽、电离区温度。',
  },
  热与自旋温度: {
    id: 'code-thermal',
    description: '源场滤波、X 射线频率积分表、逐格点电子分数与温度演化，直到自旋温度求解。',
  },
  亮温输出: {
    id: 'code-output',
    description: '把中性分数与密度换成信号幅度，再经 21cm 光学深度得到最终亮温。',
  },
  跨阶段基建与校准: {
    id: 'code-crosscut',
    description: '被多个阶段共用的底层件：光子守恒红移校准、网格索引、规则网格表与调试输出。',
  },
}

/** 层级 → 画布上的节点类型（让阶段、实现单元与关键过程在配色上分得开） */
const TYPE_BY_DEPTH = { 2: 'concept', 3: 'concept', 4: 'tool', 5: 'method', 6: 'method' }
/** 层级 → 标签，供画布筛选与图例阅读 */
const TAG_BY_DEPTH = { 2: '阶段', 3: '子过程', 4: '计算单元', 5: '关键过程', 6: '关键过程' }
/** 附录段落不建节点 */
const APPENDIX_PREFIX = '附录'

const errors = []

function fail(message) {
  errors.push(message)
}

/** 与 server/lib/mdIndex.mjs 的 slugify 同口径：中文保留，其余标点去掉 */
function slugify(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s\-_]/gu, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/** 正则转义：大纲里的引用是正则，标题里的 `.` 之类必须转义后才能精确命中 */
function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 压平 markdown 记号，只留纯文本（对标生成器的 cleanText） */
function cleanText(text) {
  return String(text || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`/g, '')
    .replace(/\*\*/g, '')
    .replace(/^>\s?/gm, '')
    .replace(/[\s\u3000]+/g, ' ')
    .trim()
}

/** 扫描文档：抽出标题与其「本节首段」 */
async function parseDoc() {
  const lines = (await fs.readFile(DOC_PATH, 'utf8')).split(/\r?\n/)
  const sections = []
  let inFence = false
  let current = null
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      current = { depth: heading[1].length, text: heading[2].trim(), prose: [], line: sections.length + 1 }
      sections.push(current)
      continue
    }
    if (current) current.prose.push(line)
  }
  return sections
}

/** 本节首段：标题之后、下一个标题之前的第一段散文；`关键函数`/`关键量` 等条目属于末端细节，不进摘要 */
function firstParagraph(prose) {
  const chunks = []
  for (const line of prose) {
    const trimmed = line.trim()
    if (!trimmed) {
      if (chunks.length) break
      continue
    }
    if (/^[-*]\s/.test(trimmed) || /^关键(函数|量)/.test(trimmed)) break
    if (/^>/.test(trimmed)) continue
    chunks.push(trimmed)
  }
  return cleanText(chunks.join(''))
}

/** 没有散文的节（标题下直接就是子节）用子节点名兜底，保证摘要非空 */
function summaryFromChildren(children) {
  if (!children.length) return ''
  return cleanText(`本节的下一层拆成：${children.map((child) => `「${child.text}」`).join('、')}。`)
}

async function main() {
  const argv = process.argv.slice(2)
  const stdoutOnly = argv.includes('--stdout')
  const outArg = argv.find((item) => item.startsWith('--out='))
  const outPath = outArg ? path.resolve(ROOT, outArg.split('=')[1].trim()) : OUT_PATH

  const sections = await parseDoc()
  const stages = sections.filter((section) => section.depth === 2)
  if (!stages.length) fail('文档中找不到任何阶段标题（## 级）')

  const registry = []
  const registryIds = new Map()
  for (const stage of stages) {
    if (stage.text.startsWith(APPENDIX_PREFIX)) continue
    const topic = TOPICS[stage.text]
    if (!topic) {
      fail(`阶段「${stage.text}」没有登记话题，请在 scripts/export-code-outline.mjs 的 TOPICS 里补上`)
      continue
    }
    if (registryIds.has(topic.id)) fail(`话题 id 重复：${topic.id}`)
    if (topic.id.length > LIMITS.topicId) fail(`话题 id「${topic.id}」超过 ${LIMITS.topicId} 字符`)
    if (stage.text.length > LIMITS.topicName) fail(`话题名「${stage.text}」超过 ${LIMITS.topicName} 字符`)
    if (topic.description.length > LIMITS.topicDescription) {
      fail(`话题「${topic.id}」描述超过 ${LIMITS.topicDescription} 字符`)
    }
    registryIds.set(topic.id, true)
    registry.push({ id: topic.id, name: stage.text, description: topic.description })
  }

  // ---------- 建树：H1 与附录之外的每个标题都是一个节点 ----------
  const nodes = []
  const usedIds = new Set()
  const stack = []
  let skipped = false
  for (const section of sections) {
    if (section.depth === 1) {
      skipped = true
      stack.length = 0
      continue
    }
    if (section.depth === 2) skipped = section.text.startsWith(APPENDIX_PREFIX)
    if (skipped) continue
    // 栈里比较的是 markdown 标题级（H2..H6），不是图谱深度：两者差一个偏移，混用会让下一个阶段挂进上一个阶段
    while (stack.length && stack[stack.length - 1]._level >= section.depth) stack.pop()
    const parent = stack.length ? stack[stack.length - 1] : null
    const topicId = parent
      ? parent.topics[0]
      : TOPICS[section.text]
        ? TOPICS[section.text].id
        : ''
    if (!topicId) {
      fail(`节点「${section.text}」找不到所属话题（阶段标题可能未登记）`)
      continue
    }
    const depth = parent ? parent._depth + 1 : 1
    if (depth > MAX_DEPTH) {
      const chain = []
      for (let cursor = parent; cursor; cursor = cursor._parent) chain.unshift(`${cursor.label}(L${cursor._depth})`)
      fail(`节点「${section.text}」深度 ${depth} 超过上限 ${MAX_DEPTH}（父链：${chain.join(' → ')}）`)
    }
    if (section.text.length > LIMITS.label) fail(`节点「${section.text}」标题超过 ${LIMITS.label} 字符`)

    let id = `${topicId}:${slugify(section.text)}`.slice(0, LIMITS.nodeId)
    let suffix = 2
    while (usedIds.has(id)) {
      const tail = `-${suffix}`
      id = `${id.slice(0, LIMITS.nodeId - tail.length)}${tail}`
      suffix += 1
    }
    usedIds.add(id)

    const node = {
      id,
      label: section.text,
      type: TYPE_BY_DEPTH[section.depth] || 'concept',
      topics: [topicId],
      parent: parent ? parent.id : null,
      summary: '',
      tags: [TAG_BY_DEPTH[section.depth] || '关键过程'],
      refs: [{ docId: DOC_ID, heading: `^${escapeRegExp(section.text)}$` }],
      _depth: depth,
      _level: section.depth,
      _prose: section.prose,
      _children: [],
      _parent: parent,
    }
    if (parent) parent._children.push(node)
    nodes.push(node)
    stack.push(node)
  }

  for (const node of nodes) {
    const own = firstParagraph(node._prose)
    node.summary = (own || summaryFromChildren(node._children)).slice(0, SUMMARY_MAX)
    if (!node.summary) fail(`节点「${node.label}」既没有首段散文也没有子节点，无法生成摘要`)
    if (node.summary.length > LIMITS.summary) fail(`节点「${node.id}」摘要超过 ${LIMITS.summary} 字符`)
  }

  if (errors.length) {
    console.error('导出失败：')
    errors.forEach((line) => console.error(`  - ${line}`))
    process.exitCode = 1
    return
  }

  const meta = {
    name: '21cmFAST 代码逻辑拓扑',
    description:
      '以 src/py21cmfast/src 的 C 端核心计算链为对象、自顶向下拆出的逻辑拓扑森林：11 个阶段各是一个话题根，简单分支到「由哪个计算单元负责」收尾，复杂分支继续深到关键过程与关键量，全树零关系边。大纲由 scripts/export-code-outline.mjs 从 docs/notes/CODE_TOPOLOGY.md 导出，节点引用只写标题，slug 由生成器回填。',
    maxDepth: MAX_DEPTH,
  }
  const outline = {
    meta,
    topics: registry,
    nodes: nodes.map((node) => ({
      id: node.id,
      label: node.label,
      type: node.type,
      topics: node.topics,
      parent: node.parent,
      summary: node.summary,
      tags: node.tags,
      refs: node.refs,
    })),
  }

  // ---------- 报告：逐话题成员数与深度分布，人工核对用 ----------
  const byTopic = new Map(registry.map((topic) => [topic.id, []]))
  nodes.forEach((node) => byTopic.get(node.topics[0]).push(node))
  const depthHistogram = new Map()
  nodes.forEach((node) => depthHistogram.set(node._depth, (depthHistogram.get(node._depth) || 0) + 1))
  const widest = Math.max(...[...byTopic.values()].map((list) => list.length))
  console.log(`文档：${path.relative(ROOT, DOC_PATH)}`)
  console.log(`  话题 ${registry.length} 个 · 节点 ${nodes.length} 个 · 引用 ${nodes.length} 条`)
  console.log(
    `  深度分布：${[...depthHistogram.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([depth, count]) => `L${depth}×${count}`)
      .join(' · ')}（上限 ${MAX_DEPTH} 层）`,
  )
  console.log(`  逐话题成员数（上限 25）：`)
  registry.forEach((topic) => {
    const list = byTopic.get(topic.id)
    console.log(`    ${String(list.length).padStart(3)}  ${topic.id.padEnd(16)} ${topic.name}`)
  })
  if (widest > 25) console.warn(`  警告：最宽话题有 ${widest} 个成员，超过画布单次可见上限 25`)
  if (meta.description.length > 400) fail('meta.description 超过 400 字符')

  if (stdoutOnly) {
    console.log('  （--stdout：不落盘）')
    return
  }
  await fs.writeFile(outPath, `${JSON.stringify(outline, null, 2)}\n`, 'utf8')
  console.log(`  已写入：${path.relative(ROOT, outPath)}`)
}

main().catch((err) => {
  console.error('导出失败：', err.message)
  process.exitCode = 1
})
