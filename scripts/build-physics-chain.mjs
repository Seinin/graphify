#!/usr/bin/env node
/**
 * 生成「物理链」——应用「物理视角」页的数据源。
 *
 * 与另两份数据的边界（本脚本只读它们、一行都不写）：
 *   · `data/graph.json`                  工程视角图谱（画布页）；
 *   · `docs/notes/physics-chain/chain.json`  **本脚本的真源**（从两份 PDF 逐字转录的物理链）。
 *
 * 口径（用户 2026-09-29 明确）：
 *   · **物理量按 P&L 2012 的写法显示**，不追代码变量名；代码名只作为附注字段；
 *   · 代码参数里"控制要考虑哪些效应"的开关，**只要挂一条来源论文链接**即可，论文本身以后再说；
 *   · 真源里没有的一律留空，**不编造**（来源论文只在代码注释里真实写着时才填）。
 *
 * 三份输入：真源（物理量/公式/依赖） + `wrapper/inputs.py`（参数默认值与校验） + atlas L3（代码落点）。
 *
 * 用法：
 *   node scripts/build-physics-chain.mjs            # 写产物
 *   node scripts/build-physics-chain.mjs --dry-run  # 只打印统计
 *   node scripts/build-physics-chain.mjs --stdout   # JSON 到 stdout（自检用）
 *
 * **模块文档不由本脚本产**：`docs/notes/physics-chain/modules/**` 是手写 md，站点按 `docId`
 * 直接渲染；本脚本只给它们提供引用入口（`docPathOf` 算出的 `docId` + 锚点）。
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { REPO_ROOT, codeSpans, docTargetOf, isSubprocessCode, isUnitCode, loadAtlas, sourcePathOf } from './lib/atlasDocs.mjs'
import { findSymbolBodies, readSource } from './lib/paramScan.mjs'
import { parseInputStructs } from './lib/pyInputs.mjs'
/**
 * 方框尺寸与间距的**唯一口径**（`GAP` + 按标签算宽高）。画布用同一套数：
 * 坐标必须长在尺寸上，不许自己编一个"框有多大"（见下面排版那段的说明）。
 */
import { BADGE_LINE, FRAME_PADDING, GAP, measureBoxSize, stackCenters } from './lib/boxSize.mjs'
/**
 * 代码阶段的**残余用途**（判据就地写在这里，不再单开一份名单文件）。
 *
 * 「按代码阶段分层」那套已随块口径整体退场：一级的划分来自真源 `blocks.items`（见 design.md D2/D7），
 * 而不是"哪段代码算的"。阶段号还剩两件事，都不再是分层：
 *   · **节点属性**：`codeHints` 的第一段（`S14.2` → `S14`）写成节点的 `stage`，供应属性页查看；
 *   · **话题标记**：工程节点挂 `topic:impl`，旁路 / 诊断出口那批挂 `topic:bypass`（收起用）。
 * 自检**不** import 这里：它按真源自己复算，这份判据被改动了要能被独立发现。
 */
const IMPL_TOPIC_ID = 'topic:impl'
const BYPASS_TOPIC_ID = 'topic:bypass'
/** 旁路 / 诊断出口的代码阶段：只用来打话题，**不决定分层** */
const BYPASS_STAGE = 'S04'
/** `codeHints`（如 `['S14.2']`）→ 阶段号（`S14`）；驱动量没有 hint，给空串 */
const stageOfHint = (hints) => String((Array.isArray(hints) ? hints[0] : hints) ?? '').split('.')[0]
/** 落在这个阶段里的量是诊断出口（算完顺手给出的），不在主链上 —— 与图上 `topic:bypass` 同源 */
const isBypassHint = (hints) => stageOfHint(hints) === BYPASS_STAGE

/**
 * 标题锚点口径：**必须与 `Graphify/src/lib/slug.ts` 逐字同一条规则**（服务端 `mdIndex.mjs`
 * 与前端 `slug.ts` 是同一条）。骨架文档的小节标题就是节点标签本身，锚点由这里反推——
 * 两处一旦不一致，笔记本里的引用就会"点不开、停在文档顶部"（自检会打开文档核锚点）。
 */
const slugify = (text) =>
  String(text ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s\-_]/gu, '')
    .replace(/[\s\u3000]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')

const HERE = path.dirname(new URL(import.meta.url).pathname)
const OUT_FILE = path.join(HERE, '..', 'src', 'generated', 'physics-chain.json')
const CHAIN_SOURCE = path.join(REPO_ROOT, 'docs', 'notes', 'physics-chain', 'chain.json')
const INPUTS_FILE = path.join(REPO_ROOT, 'src', 'py21cmfast', 'wrapper', 'inputs.py')

const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
/** `--stdout` 时统计走 stderr，保证 stdout 只有纯 JSON（自检要逐字比对） */
const toStderr = flag('stdout')
const say = toStderr ? (...parts) => console.error(...parts) : (...parts) => console.log(...parts)

/**
 * 落点不再限条数、不限跨度：真源核定的落点**逐条全给**，一条可以覆盖整个函数体、甚至整份文件。
 * 旧口径「每个物理量至多两条、单条不超过 60 行、整个函数体不进文档」已废除——它把模块文档的工程节
 * 压成一句话：文档要讲清"这个量怎么算出来"，就得能引用它经过的整段代码，而不是几行核心片段。
 */

/**
 * 代码落点（**回落路线**）：按 atlas L3 的「承担者」取函数体行区间（与画布口径一致：C 按花括号、Python 按缩进）。
 * 返回 `stageCode → [{unit, symbol, file, line, endLine, fileWide}]`。
 *
 * 口径：真源的 `codeSites` 是落点的**出处**（见 `withSites`），这条路只在真源没给时兜底。
 * 兜底找不到函数体（承担者写成"各函数""函数组"，或符号名对不上）时**不再**把 `1-文件末行` 当落点——
 * 那既不是核心行，也让"这个量算在哪几行"变成空话；改为挂一条 `pending`（`line: null`），
 * 折进 `code.pending` 并由生成日志与自检报出来（待补，不许静默）。
 */
async function buildCodeSites(paramNames, stepSites = {}) {
  const { subprocesses, units } = await loadAtlas()
  const subprocessByAnchor = new Map(subprocesses.filter((entry) => isSubprocessCode(entry.code)).map((entry) => [entry.anchor, entry]))
  const sourceCache = new Map()
  /** 读源码（带缓存）：核定过的落点可能落在单元所属文件之外，按落点自己的文件取 */
  const cachedSource = (file, language) => {
    const absolute = path.join(REPO_ROOT, file)
    if (!sourceCache.has(absolute)) sourceCache.set(absolute, readSource(absolute, language).catch(() => null))
    return sourceCache.get(absolute)
  }
  const byStage = new Map()
  /** hint（阶段或子过程）→ 在这个单元里被读到的参数名 */
  const paramHints = new Map()
  const stats = { units: 0, located: 0, pending: [], missed: [] }

  for (const unit of units.filter((entry) => isUnitCode(entry.code))) {
    const subprocess = subprocessByAnchor.get(docTargetOf(unit.fields['所属子过程'])?.anchor ?? '')
    if (!subprocess) continue
    const stageCode = subprocess.code.split('.')[0]
    const file = sourcePathOf(unit.fields['承担者'])
    if (!file) continue
    stats.units += 1

    const language = file.endsWith('.py') ? 'python' : 'c'
    const source = await cachedSource(file, language)
    if (!source) {
      stats.missed.push(`${unit.code}（读不到 ${file}）`)
      continue
    }

    const carrier = unit.fields['承担者']?.raw ?? ''
    const symbols = codeSpans(carrier).filter((item) => !/\.(c|h|py)$/.test(item))
    const bodies = symbols.flatMap((symbol) => findSymbolBodies(source.maskedLines.join('\n'), symbol, language))
    const unresolved = bodies.length === 0 || /各函数|等函数|函数组/.test(carrier)
    /**
     * 这个单元的核心行在真源里核定过（`stepSites`，键是单元码）就以它为准：atlas 的「承担者」
     * 只给到函数体，而"这一步到底算在哪几行"要读源码才能定。核不出来的单元照旧挂 `pending`。
     */
    const declared = stepSites[unit.code] ?? []
    const sites = declared.length
      ? declared.map((site) => ({ ...site, fileWide: false, source: 'chain' }))
      : unresolved
        ? [{ symbol: symbols.join('、'), line: null, endLine: null, fileWide: false, pending: true }]
        : bodies.map((body) => ({ symbol: symbols.join('、'), line: body.startLine, endLine: body.endLine, fileWide: false }))
    if (declared.length || !unresolved) stats.located += 1
    else stats.pending.push({ unit: unit.code, file })

    const entries = sites.map((site) => ({ ...site, unit: unit.code, unitName: unit.name, file: site.file ?? file }))
    /**
     * 参数归属的扫描窗口 = **核定的核心行 ∪ 单元函数体**（落点口径不受此影响，`entries` 照旧）。
     * 只认核定行会漏：核定的常常只是主干那几行（`scaling_relations.c` 记的是 84-101，
     * 而同一个函数在 46-65 就已在读参数）；「承担者」写成「…与各函数」这类泛指时，
     * 函数体照样解析得出来，窗口也不因此作废。整文件落点（`fileWide`）仍不参与——范围太宽。
     */
    const scanWindows = [...entries, ...bodies.map((body) => ({ file, line: body.startLine, endLine: body.endLine }))]
      .filter((window) => window.line && !window.fileWide)
      .filter(
        (window, index, all) =>
          all.findIndex((item) => item.file === window.file && item.line === window.line && item.endLine === window.endLine) === index,
      )
    /**
     * 落点挂**三个**键：阶段（`S12`）、子过程（`S12.1`）、计算单元（`S12.1.1`）。
     * 真源的 `codeHints` 写哪个粒度都能对上，越细越准：单元级 = 「源码」标签页恰好落在那一个函数上，
     * 而不是该子过程的前 8 个。**三个键缺一不可**——2026-10-01 之前只挂了前两个，
     * 于是 4 个盒子产物（`matter_power` / `vcb` / `perturb_field` / `filtered_xray`）
     * 那几条**故意写成三段单元码**的 hint 一个都查不到，`refs` 空着（`algorithmPending` 里那批）。
     * **参数归属与落点用同一套键**：两级时，凡是把锚点写成三段单元码的量在矩阵里永远查不到参数
     * ——落点对得上、归属全空（`filtered_xray` 的 `S14.3.1` 那 10 个量就是这批）。
     * 两条路读同一份 `codeHints`，键的粒度就必须一致，否则真源写得越细、归属越是空的。
     */
    for (const key of new Set([stageCode, subprocess.code, unit.code])) {
      byStage.set(key, [...(byStage.get(key) ?? []), ...entries])
    }

    /*
      参数归属（后端查表：参数 × 节点）：在扫描窗口里找参数读取，认三种写法——
      `->NAME`（`astro_params_global->F_STAR10`）、`.NAME`（`self.F_STAR10`）、
      以及 **Python 窗口里的引号字面量** `"NAME"` / `'NAME'`：`CosmoParams` 的私有字段在做功率谱那段
      是按字符串键取的（`classy_output.get_current_derived_parameters(["A_s"])["A_s"]` ——
      `A_s` 与 `sigma_8` 二选一的判定也走字符串键），只认属性写法就会漏掉它。
      C 侧不加这一条：那里参数一律走 `->NAME`，引号字面量在 C 里是日志/文件名字符串，不是读取。
      这只是"出现在这个函数体里"，不等于"这个参数改变了这一步"——够用且可核对，不做更玄的推断。
    */
    if (paramNames.length) {
      for (const window of scanWindows) {
        /** 核定过的单元可能落在另一个文件里（`xcoll_HI` 在 `heating_helper_progs.c` 而单元挂 `thermochem.c`）：按窗口自己的文件切 */
        const windowFile = window.file ?? file
        const windowIsPython = windowFile.endsWith('.py')
        const windowSource = windowFile === file ? source : await cachedSource(windowFile, windowIsPython ? 'python' : 'c')
        if (!windowSource) continue
        const body = windowSource.lines.slice(window.line - 1, window.endLine ?? window.line).join('\n')
        for (const name of paramNames) {
          const read = windowIsPython
            ? body.includes(`->${name}`) || body.includes(`.${name}`) || body.includes(`"${name}"`) || body.includes(`'${name}'`)
            : body.includes(`->${name}`) || body.includes(`.${name}`)
          if (!read) continue
          for (const key of new Set([stageCode, subprocess.code, unit.code])) {
            if (!paramHints.has(key)) paramHints.set(key, new Set())
            paramHints.get(key).add(name)
          }
        }
      }
    }
  }
  return { byStage, paramHints, stats }
}

/** 写前校验：只查结构性不变量（内容口径交给自检脚本深查） */
function assertShape(artifact) {
  const problems = []
  const ids = new Set([...artifact.drivers.map((item) => item.id), ...artifact.nodes.map((item) => item.id)])
  for (const node of artifact.nodes) {
    if (!node.symbol || !node.name) problems.push(`节点 ${node.id} 缺符号或名字`)
    /**
     * 出处要么是论文等式（`eq`），要么是代码锚（`codeRef`）：按代码模块切块后，有些盒子产物
     * 在 Pritchard & Loeb 2012 里**没有**对应等式（`CosmoTables` / `InitConditions` /
     * `PerturbedField` / `XraySourceBox`），硬编一个 Eq 号就是伪造，所以允许写代码出处。
     */
    if (!node.eq && !node.codeRef) {
      problems.push(`节点 ${node.id} 缺出处（论文等式 eq 或代码锚 codeRef，至少一条）`)
    }
    if (!node.nature?.type) problems.push(`节点 ${node.id} 缺数学性质`)
    /**
     * 分层纪律（README 第一节）：图上只有一级（块）与二级（成员），**最底层就是物理量与物理过程**——
     * 函数那一级不上图。`layer` 于是只剩一个合法取值，留着只为让旧数据里的第二级当场报出来，
     * 而不是被静默忽略。
     */
    if (node.layer !== undefined && node.layer !== 'surface') {
      problems.push(`节点 ${node.id} 的 layer 取值非法：${node.layer}（函数那一级已不上图，只有 surface）`)
    }
    // 种类（颜色按它分）：物理量 / 谱 / 函数 / 过程 / 工程项。
    // 注意：种类与"层级"（layer：表面/子图）是两件事——子图里可以是更细的物理，也可以是工程项。
    if (!['quantity', 'spectrum', 'function', 'process', 'engineering'].includes(node.kind)) {
      problems.push(`节点 ${node.id} 的 kind 不在册：${node.kind}（应为 quantity / spectrum / function / process / engineering）`)
    }
  }
  for (const edge of artifact.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) problems.push(`边 ${edge.from}->${edge.to} 指向不存在的东西`)
    if (!edge.eq && !edge.codeRef) {
      problems.push(`边 ${edge.from}->${edge.to} 缺出处（Eq 或代码锚 codeRef，至少一条）`)
    }
  }
  /**
   * **边的结构不变量**（深查在 `check-physics-chain.mjs`，这里只拦"漏出处"）：
   *   · 回流边（`kind: 'feedback'`）必须有代码出处；
   *   · 量 → 量的依赖边走块内直连（不标 `focusOnly`）。
   */
  for (const edge of artifact.graph?.edges ?? []) {
    if (edge.kind === 'feedback' && !edge.codeRef) problems.push(`反馈边 ${edge.id} 缺代码出处 codeRef`)
  }
  /**
   * **左栏第二个检索面（天体物理过程）**：真源 `processes` 的形状。这里只拦"整段漏了 / 成员写成空 /
   * 成员不是图上的量"；深查（不重不漏、不吃 `order`）在 `check-physics-chain.mjs`。
   */
  if (!artifact.processes?.items?.length) {
    problems.push('缺 processes.items 段（左栏过程面的唯一来源）')
  } else {
    for (const item of artifact.processes.items) {
      if (!item.id || !item.label) problems.push(`过程 ${item.id ?? '(无 id)'} 缺 id 或 label`)
      if (!item.members?.length) problems.push(`过程 ${item.id} 没有成员`)
      for (const member of item.members ?? []) {
        if (!ids.has(member)) problems.push(`过程 ${item.id} 的成员 ${member} 不是图上的量`)
      }
    }
    for (const member of artifact.processes.uncovered?.members ?? []) {
      if (!ids.has(member)) problems.push(`兜底名单里的 ${member} 不是图上的量`)
    }
  }
  /**
   * 节点属性与块归属（阶段号已**降级为节点属性**，不再承担分层）：
   *   · **量**的节点都要带 `stage`（阶段号，允许空串：驱动量 / 外部量不属于任何代码阶段）；
   *   · **容器**（块 / 子图步骤）不挂 `stage`——块的阶段号是成员的并集，放 `stages` 里；
   *   · 每个块的 `stages` 必须等于成员 `stage` 的并集——属性页直接读这个字段，对不上就是生成时漏了；
   *   · 话题纪律照旧：工程项必须挂「实现细节」，否则视图默认收起之后它仍留在表面。
   */
  const containerIds = new Set((artifact.graph?.blocks?.items ?? []).map((item) => item.id))
  for (const node of artifact.graph?.nodes ?? []) {
    /**
     * 容器 = **块**。判据不能写成"有 `parent` 的就是容器"：成员的 `parent` 指着它所属的块，
     * 而阶段号恰恰是**成员**的属性（块的阶段号是它成员的并集）。
     */
    const isContainer = containerIds.has(node.id)
    /**
     * **段容器是装饰**（`type: 'group'`，见 design D8）：它既不是量、也不是代码单元——阶段号是**量**的
     * 属性，所以它不挂阶段号；它也不是块 / 步骤，所以不受"容器不许挂阶段号"那条管。
     * 两条例外都写在这一处，别处不再重复判断（自检里同样两处一起放行）。
     */
    const isDecoration = node.type === 'group'
    if (isContainer && node.stage !== undefined) problems.push(`容器 ${node.id} 挂着阶段号：阶段号是量的属性，块的阶段号该放 stages`)
    if (!isContainer && !isDecoration && typeof node.stage !== 'string') problems.push(`节点 ${node.id} 缺阶段号属性 stage（阶段号已降级为普通属性）`)
    const isEngineering = node.type === 'engineering'
    if (isEngineering !== (node.topics ?? []).includes(IMPL_TOPIC_ID)) {
      problems.push(
        isEngineering
          ? `工程项 ${node.id} 没挂 ${IMPL_TOPIC_ID} 话题（默认收不起来）`
          : `非工程项 ${node.id} 挂了 ${IMPL_TOPIC_ID} 话题（话题含义被稀释）`,
      )
    }
  }
  const stageOfNode = new Map((artifact.graph?.nodes ?? []).map((node) => [node.id, node.stage]))
  for (const block of artifact.graph?.blocks?.items ?? []) {
    const union = [...new Set((block.members ?? []).map((id) => stageOfNode.get(id)).filter(Boolean))].sort()
    const stated = [...(block.stages ?? [])].sort()
    if (stated.length !== union.length || stated.some((stage, index) => stage !== union[index])) {
      problems.push(
        `块 ${block.id} 的阶段号与成员对不上：块上写着「${stated.join('/') || '空'}」，成员实为「${union.join('/') || '空'}」`,
      )
    }
    /**
     * 对外输入（进子图时灰显的上下文）只能是**块外的真实节点**：
     * 写成不存在的 id ⇒ 子图里那个灰盒子点开是空的；写成自己的成员 ⇒ 同一个量既是要算的东西又是外部输入。
     */
    for (const id of block.contexts ?? []) {
      if (!stageOfNode.has(id)) problems.push(`块 ${block.id} 的对外输入 ${id} 不是图里的节点`)
      else if ((block.members ?? []).includes(id)) problems.push(`块 ${block.id} 把成员 ${id} 又列成了对外输入`)
    }
  }
  for (const group of Object.keys(artifact.params ?? {})) {
    for (const param of artifact.params[group] ?? []) {
      if (!param.name) problems.push(`${group} 里有条目缺 name`)
      if (param.switch !== undefined && typeof param.switch !== 'boolean') problems.push(`${param.name} 的 switch 不是布尔`)
    }
  }
  return problems
}

/** 站点文档下的模块目录（`docId` 相对 `docs/notes/`） */
const MODULES_DIR = 'physics-chain/modules'
/** 路径键（design D2）：块用 `id`（去掉 `block:` 前缀） */
const docKeyOfBlock = (blockId) => String(blockId).replace(/^block:/, '')
/**
 * **一个模块一篇**（design D2）：块与它的全部成员共用这一篇 `modules/<块>.md`，
 * 成员那几节就是这篇里的 `## <成员标签>`——引用卡片点开同一篇、落在各节上，盘上不再有按成员分家的文件。
 */
const docPathOf = (blockId) => `${MODULES_DIR}/${docKeyOfBlock(blockId)}.md`
/** 真源 `docText` 的键（design D6）：对象 id；层里的头文件成员用 `file:<文件名>` */
const docTextKeyOf = (memberId, isFileMember) => (isFileMember ? `file:${memberId}` : String(memberId))
/**
 * 笔记引用的落点锚点：模块文档里「论文出处」那一节的标题。引用卡片上的 `anchor` 就是这节的 slug，
 * 视图按它跳到那一节——所以这个字面量留在模块级，建引用的地方读它。
 */
const REFERENCE_SECTION = '论文出处'

/**
 * **摘要位置的公式**（本次变更 design D1）：真源 `docText[id].formula` 逐字转录进产物，
 * 视图只渲染、不转抄。**只有成员对象**（量 / 驱动量）有这份公式——块与层里的文件成员在真源里就是空的
 * （`buildModuleDocs` 的写前校验按条断言过），所以这里不写字段、不给空串：
 * 「带不带 `formula`」就是视图判断"是不是一个可求值的量"的**唯一判据**（不按 `kind` 另写名单）。
 */
const formulaFieldOf = (docText, id) => {
  const formula = String(docText?.[docTextKeyOf(id, false)]?.formula ?? '').trim()
  return formula ? { formula } : {}
}

/**
 * **实现步骤归谁**（design D5）：真源成员的 `codeHints`（`S14.3` 这种带点的一级）展开到更细一级、
 * 且在真源 `stepSites` 里核定过的**单元**（`S14.3.1`）。
 *
 * 一个单元只归**第一个**认领它的量（真源顺序）：`S14.2.*` 同时挂在 `jalpha` 与 `xalpha` 的 hint 上、
 * `S14.6.*` 同时挂在 `ts` 与 `xc` 上——不认领的话同一段落会落进两篇文档与两份引用清单
 * （引用清单有去重，文档的段落没有）。没人认领的单元不上图、也不进文档，自检把条数印出来，不静默。
 *
 * 生成器与自检**各写一份**（互不 import），改一处另一处立刻红。
 */
function stepUnitsOf(chain) {
  const claimed = new Set()
  const byMember = new Map()
  const allUnits = Object.keys(chain.stepSites ?? {}).sort()
  for (const item of [...(chain.drivers ?? []), ...(chain.nodes ?? [])]) {
    const hints = (item.codeHints ?? []).map(String).filter((text) => text.includes('.'))
    const mine = []
    for (const unit of allUnits) {
      if (claimed.has(unit) || !(chain.stepSites[unit] ?? []).length) continue
      if (!hints.some((hint) => unit.startsWith(`${hint}.`))) continue
      claimed.add(unit)
      mine.push(unit)
    }
    if (mine.length) byMember.set(String(item.id), mine)
  }
  return { byMember, unclaimed: allUnits.filter((unit) => !claimed.has(unit)) }
}


async function main() {
  const chain = JSON.parse(await fs.readFile(CHAIN_SOURCE, 'utf8'))
  const inputsText = await fs.readFile(INPUTS_FILE, 'utf8')
  const inputs = parseInputStructs(inputsText)
  /** 真源里声明的全部参数名（组名由数据声明） */
  const declaredParams = Object.keys(chain.params ?? {})
    .filter((key) => Array.isArray(chain.params[key]))
    .flatMap((key) => chain.params[key].map((param) => param.name))
  const { byStage, paramHints, stats: siteStats } = await buildCodeSites(declaredParams, chain.stepSites ?? {})
  /*
    参数 × 节点 矩阵（**后端查表**，供视图做「选中参数 → 高亮相关模块」）：
    归属 = 这个参数被读到时所在的单元（`paramHints`）+ 开关自己声明的 `gatesEdges`。
    没有归属的参数不进表（自检会把它们列出来，不静默）。
  */
  const paramMatrix = {}
  for (const group of Object.keys(chain.params ?? {})) {
    if (!Array.isArray(chain.params[group])) continue
    for (const param of chain.params[group]) {
      const nodes = [...chain.drivers, ...chain.nodes]
        .filter((item) => (item.codeHints ?? []).some((hint) => paramHints.get(hint)?.has(param.name)))
        .map((item) => item.id)
      const edges = param.gatesEdges ?? []
      if (nodes.length || edges.length) paramMatrix[param.name] = { nodes, edges }
    }
  }

  /** 参数：以真源为准，但**默认值/范围若源码有写就以源码校对**；不一致直接报错（防手工抄错） */
  const problems = []
  const groups = {}
  /*
    参数分组由真源声明（`params.order`），生成器**不写死组名**——
    写死会让新加的组被静默丢掉：既不进产物，也没人报错（天体物理那 58 个、宇宙学常量就是这么被丢的）。
    没声明时退回历史三组，行为与以前完全一致（`check:chain` 的幂等断言守住这一点）。
  */
  for (const group of chain.params?.order ?? ['drivers', 'numeric', 'effects']) {
    groups[group] = (chain.params?.[group] ?? []).map((param) => {
      const mine = inputs.get(param.name)
      if (!mine) return { ...param, inCode: false }
      if (param.default !== null && param.default !== undefined && JSON.stringify(param.default) !== JSON.stringify(mine.default)) {
        problems.push(`${param.name} 的默认值与源码不一致：真源 ${JSON.stringify(param.default)} vs 源码 ${JSON.stringify(mine.default)}`)
      }
      return {
        ...param,
        inCode: true,
        group: mine.group,
        default: mine.default,
        log10: mine.log10,
        range: mine.range,
        choices: mine.choices,
      }
    })
  }
  /**
   * 参数名 → 类别：`inputs.py` 里定义它的那个 `InputStruct` 子类。
   * 标签注册表的 `group` 用它——与画布页同一口径，同一个参数在两页不许有两个分类。
   */
  const groupOfParam = new Map(Object.values(groups).flat().map((param) => [param.name, param.group]))
  if (problems.length) {
    say('✗ 真源与源码对不上：')
    for (const problem of problems) say(`   · ${problem}`)
    process.exitCode = 1
    return
  }

  /**
   * **落点的出处**：真源 `codeSites`（`[{file, symbol, line, endLine, needles}]`，逐条读源码核定的核心行）
   * 优先；只有真源没给（还没核定的成员、驱动量）才回落到 atlas「承担者」的函数体（`buildCodeSites`）。
   * 为什么以真源为准：atlas 的「承担者」是**整文件级**的说法（`tgamma` 就落在 `Constants.c` 一整个文件上），
   * 而"这个量由哪几行算出"只有读源码才能定。
   */
  const sitesOf = (item) => {
    const declared = Array.isArray(item.codeSites) ? item.codeSites : []
    if (declared.length) {
      return declared.map((site) => ({
        symbol: String(site.symbol ?? item.symbol ?? ''),
        file: String(site.file ?? ''),
        line: Number.isFinite(site.line) ? site.line : null,
        endLine: Number.isFinite(site.endLine) ? site.endLine : null,
        needles: (site.needles ?? []).map(String),
        fileWide: false,
        source: 'chain',
      }))
    }
    return (item.codeHints ?? []).flatMap((stage) => byStage.get(stage) ?? []).map((site) => ({ ...site, source: 'atlas' }))
  }
  /**
   * `sites` 只收**带行号**的落点（视图与自检都按 `file:line` 点开），真源核定了几条就给几条——
   * 不截断（整函数体、整文件都允许，口径见模块文档的工程节）；
   * 回落路线里找不到函数体的那些（`pending`）单列一份文件名清单，挂到 `code.pending`，
   * 由生成日志与自检报出来——既不混进 `sites` 假装有落点，也不静默丢掉。
   */
  const withSites = (item) => {
    const all = sitesOf(item)
    const sites = all.filter((site) => Number.isFinite(site.line))
    const pending = [...new Set(all.filter((site) => site.pending).map((site) => site.file))]
    return { count: sites.length, sites, ...(pending.length ? { pending } : {}) }
  }

  /**
   * **层（`kind: 'layer'`）的代码引用直接取真源的层声明**（design D4）——代码锚写着
   * `kind: 'files'` 的，逐个文件给一条**整文件落点**（`fileWide`，行区间 = 1 到文件末尾，
   * 与 `buildCodeSites` 里整文件落点的口径一致）。为什么不从成员汇总：层的成员 `tgamma`
   * 是常数、真源里本就没有 `codeHints`（`Constants.c:.T_cmb` 是它的出处，但那是整文件级），
   * 汇总一定是空的。实测（2026-10-01）：只靠汇总，层的「源码」标签页是空的，与"每个模块
   * 当下两类证据都不空"直接冲突——所以层的代码引用走这条直接给出分支。
   */
  const layerFileSites = new Map()
  for (const block of chain.blocks?.items ?? []) {
    if (block.codeAnchor?.kind !== 'files') continue
    const sites = []
    for (const name of block.codeAnchor.files ?? []) {
      const relative = `src/py21cmfast/src/${name}`
      const source = await readSource(path.join(REPO_ROOT, relative), 'c').catch(() => null)
      sites.push({ file: relative, label: name, line: 1, endLine: source ? source.lines.length : null, fileWide: true, source: 'chain' })
    }
    layerFileSites.set(block.id, sites)
  }

  /**
   * 引用汇总的三个纯函数（design D2）。**口径只写在这一处**：
   *   · 去重键 —— 代码引用 `file:line:endLine`、笔记引用 `docId#anchor`。**不含 `label`**：
   *     同一条落点会同时挂在父与子（`hmf.c:502` 既在 `mmin` 上也在它的步骤上），
   *     标签不同就永远去不掉重，模块清单会出现重复行、条数与清单长度对不上。
   *   · 排序 —— 代码引用在前（`file` → `line` → `endLine` 升序），笔记引用在后
   *     （`docId` → `anchor` 升序）。用逐字符比较（`cmpText`）而不是 `localeCompare`：
   *     产物要求逐字稳定，不能随运行环境的 locale 变。
   * 自检脚本照这段话**独立实现一遍**再逐条对拍（它不 import 这里、也不信产物里的标注）。
   */
  const refKey = (ref) => (ref.file ? `file:${ref.file}:${ref.line}:${ref.endLine ?? ''}` : `doc:${ref.docId}#${ref.anchor}`)
  /** 逐字符升序：与运行环境的 locale 无关（`localeCompare` 会随 ICU 变，产物就不稳了） */
  const cmpText = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
  const canonicalRefs = (lists) => {
    const merged = new Map()
    for (const list of lists) for (const ref of list ?? []) if (ref && !merged.has(refKey(ref))) merged.set(refKey(ref), ref)
    return [...merged.values()].sort((a, b) => {
      const aCode = Boolean(a.file)
      if (aCode !== Boolean(b.file)) return aCode ? -1 : 1
      if (aCode) return cmpText(a.file, b.file) || (a.line ?? 0) - (b.line ?? 0) || (a.endLine ?? 0) - (b.endLine ?? 0)
      return cmpText(String(a.docId), String(b.docId)) || cmpText(String(a.anchor), String(b.anchor))
    })
  }
  /** 笔记引用：对象**自己那篇**模块文档的标题。`anchor` = 标题的 slug，而标题就是该对象的标签本身 */
  const noteRefOf = (docId, heading) => ({
    docId,
    anchor: slugify(heading),
    label: `模块笔记：${heading}`,
    file: '',
    line: null,
    endLine: null,
  })
  /** 实现步骤归谁（`S14.3.1` 这种单元归哪个量）：文档与引用两处读同一份，见 `stepUnitsOf` */
  const chainSteps = stepUnitsOf(chain)

  const artifact = {
    version: 1,
    source: {
      derivation: chain.sources?.primary?.file ?? '',
      review: chain.sources?.review?.file ?? '',
      chainSource: path.relative(REPO_ROOT, CHAIN_SOURCE),
      note: chain.note ?? '',
    },
    // 驱动量在真源里是顶层数组、不带 `kind`；产物里补上（视图按种类取色，缺了会炸）
    drivers: chain.drivers.map((driver) => ({ ...driver, kind: driver.kind ?? 'driver', code: withSites(driver) })),
    nodes: chain.nodes.map((node) => ({ ...node, code: withSites(node) })),
    edges: chain.edges,
    degeneracies: chain.degeneracies,
    /**
     * 与画布同形状的图（`{meta, nodes, edges}`）：物理链页直接复用画布那套渲染与交互，
     * 只是节点用物理语言（符号 + 中文名）、连线用公式语言（Eq 号），代码落点放 `refs`（默认收起）。
     * 形状按 `data/graph.json` 对齐：节点的 `type` 决定颜色与中文名，连线的 `conditional` 表示带开关。
     */
    graph: (() => {
      const nodes = [
        ...chain.drivers.map((item) => ({ ...item, kind: item.kind ?? 'driver' })),
        ...chain.nodes,
      ]
      /**
       * 参数词条：把 `paramMatrix`（参数 → 它作用的物理量/边，代码扫出来的）搬到节点的 `tags` 上，
       * 于是"按天体物理参数名检索 / 选中参数高亮相关模块"直接用画布既有的标签机制，不用另造一套。
       * `tagDetails` 的 `kind` 用真源里的角色判：驱动量 / 开关 / 数值 / 参数。
       */
      const allParams = [...chain.params.drivers, ...chain.params.astro, ...chain.params.numeric, ...chain.params.effects]
      const paramMeta = new Map(allParams.map((item) => [item.name, item]))
      const driverNames = new Set(chain.params.drivers.map((item) => item.name))
      const tagsOf = (node) => {
        /**
         * 两类来源：① `paramMatrix`（参数 → 它作用的物理量，代码扫出来的）；
         * ② 节点自带的 `codeNames`（驱动量节点本来就写着它对应哪些代码参数，如 `f* → ALPHA_STAR / F_STAR10`）。
         * 后者很关键：没有它，按 `F_STAR10` 检索能点亮它作用的模块，却找不到"这个量本身"那个节点。
         */
        const fromMatrix = Object.entries(paramMatrix)
          .filter(([, value]) => (value.nodes ?? []).includes(node.id))
          .map(([name]) => name)
        const names = [...new Set([...fromMatrix, ...(node.codeNames ?? [])])].sort()
        return {
          tags: names.map((name) => `tag:${name}`),
          tagDetails: Object.fromEntries(
            names.map((name) => {
              const meta = paramMeta.get(name)
              const kind = meta?.switch
                ? '开关'
                : driverNames.has(name)
                  ? '驱动量'
                  : !groupOfParam.has(name)
                    ? '非模型参数'
                    : String(meta?.role ?? '').startsWith('数值')
                      ? '数值'
                      : '参数'
              return [
                `tag:${name}`,
                // 形状必须与画布一致：`node.tagDetails[tagId]` 是**条目数组**（TagDetailMap）
                [{ label: name, kind, note: meta?.role ?? '', ref: { docId: '', anchor: '', label: '', file: '', line: null, endLine: null } }],
              ]
            }),
          ),
        }
      }
      /**
       * **表面 = 全部量**：函数那一级不再上图（design.md D1），原先靠 `layer === 'subgraph'`
       * 扣掉的那几个工程项（`hmf_impl` / `source_grid`）如今就是普通的成员，照样在表面上。
       */
      const surfaceIds = new Set(nodes.map((item) => item.id))
      /**
       * 对象 → 它所属的子图：引用里「论文出处」那条要指向**对象所在模块那篇**的 `## 论文出处` 小节
       * （`modules/<块>.md#论文出处`），所以建节点时就得查得到块。
       */
      const memberBlockOf = new Map()
      for (const block of chain.blocks?.items ?? []) {
        for (const memberId of block.members ?? []) memberBlockOf.set(String(memberId), String(block.id))
      }
      const gNodes = nodes.map((item) => ({
        id: item.id,
        label: `${item.symbol} · ${item.name}`,
        type: item.kind,
        summary: item.formula ? String(item.formula) : (item.nature?.type ?? item.name),
        /**
         * 摘要位置的**公式**（LaTeX，真源 `docText.formula` 逐字转录）：带它的是**可求值的量**，
         * 视图据此渲染公式而不是给一个输入框；块与层里的文件成员不带这个字段。
         */
        ...formulaFieldOf(chain.docText, item.id),
        layer: 'surface',
        /**
         * **阶段号**（代码阶段，如 `S14`）：已是普通属性，**不再决定分层**——一级怎么划分看真源的
         * `blocks.items`（同一个物理过程常被拆在好几个代码阶段里）。留着是为了属性页能查到
         * "这个量算在哪段代码里"。驱动量与外部量没有 `codeHints`，给空串。
         */
        stage: stageOfHint(item.codeHints),
        parent: item.parent ?? null,
        observable: Boolean(item.observable),
        /**
         * 话题列表恒为数组（画布的形状要求）。两类话题，页面默认**全部关掉**：
         *   · 工程项 → 「实现细节」（`topic:impl`）；
         *   · 旁路 / 诊断出口那批量 → 「旁路与后处理接口」（`topic:bypass`）。
         * 用的是画布既有的过滤机制，不另造一套隐藏逻辑；判据就在本文件顶部那两行常量里。
         */
        topics: [
          ...(item.kind === 'engineering' ? [IMPL_TOPIC_ID] : []),
          ...(isBypassHint(item.codeHints) ? [BYPASS_TOPIC_ID] : []),
        ],
        /**
         * 标签注册表装的是**参数名**（一个参数一个标签）。「没有代码落点」这件事不再靠身份标签说：
         * 驱动量的身份由 `type: driver` 与它的摘要给出，旁路那批量由 `topic:bypass` 给出——
         * 同一件事只有一处实现，也不让「输入参数」这类词混进参数名册。
         */
        tags: [...tagsOf(item).tags],
        tagDetails: { ...tagsOf(item).tagDetails },
        refs: [
          /**
           * 论文侧出口：真源里每个量都带 `reviewSection`（论文节号）。这条**落在对象所在模块那篇**的
           * `## 论文出处` 小节上（锚点 = 那节的 slug）——点开是同一篇文档，与它的物理、工程一起读，
           * 不再跳到另一篇论文清单。
           */
          ...(item.reviewSection
            ? [
                {
                  docId: docPathOf(memberBlockOf.get(item.id)),
                  anchor: slugify(REFERENCE_SECTION),
                  label: `论文出处：${item.reviewSection}`,
                  file: '',
                  line: null,
                  endLine: null,
                },
              ]
            : []),
          /**
           * 代码落点 = **`code.sites` 那一条清单本身**（`withSites` 已把真源核定的落点全取上）。
           * 此前这里按每个 hint 各自 `slice(0, 6)`、而 `code.sites` 另有一个上限——
           * 同一件事两个上限，于是「源码」标签页的条数与属性页上那个数对不上；更要紧的是自检没法从
           * `code.sites` 独立复算这一份（两处数不一致，"对拍"就永远说不清）。2026-10-01 合成一处。
           */
          ...withSites(item)
            .sites.filter((site) => Number.isFinite(site.line))
            .map((site) => ({
              docId: '',
              anchor: '',
              label: item.symbol,
              file: site.file,
              line: site.line,
              endLine: site.endLine ?? null,
            })),
          /**
           * **它全部实现步骤的核定落点**（design D5）：函数那一级不再上图，原先靠子节点汇总上来的
           * 落点现在显式并进成员自己。这里不出现步骤名（`label` 仍是成员符号）——步骤名只活在成员
           * 那篇文档的工程一节里；去重与排序交给下面的 `canonicalRefs`。
           */
          ...(chainSteps.byMember.get(item.id) ?? [])
            .flatMap((unit) => chain.stepSites[unit] ?? [])
            .filter((site) => Number.isFinite(site.line))
            .map((site) => ({
              docId: '',
              anchor: '',
              label: item.symbol,
              file: String(site.file ?? ''),
              line: site.line,
              endLine: Number.isFinite(site.endLine) ? site.endLine : null,
            })),
        ],
      }))
      /**
       * **箭头上的文字只写跨块交付的那个量名，量 → 量的边不写字**。
       *
       * 这一层全是量 → 量的依赖：两端本身就是画布上的两个量盒，再写一遍只有两种可能——
       * 抄一遍盒子名（重复），或者原先那样写式号（`Eq.6`：读者拿着它去不了任何地方，
       * 出处本该在数据与文档表格里）。所以这一层一律空标签；跨块交付边（接口边 / 回流边）
       * 才写量名，见下面的 `label: item.names.join('、')` 与回流那一段。
       * 真源的 `eq` 字段保留：它是这条边的**出处**，自检按「每条边都带出处」核对，只是不上图。
       */
      const gEdges = chain.edges.map((edge) => {
        const key = `${edge.from}->${edge.to}`
        const gates = [...chain.params.effects].filter((param) => (param.gatesEdges ?? []).includes(key))
        return {
          id: key,
          source: edge.from,
          target: edge.to,
          label: '',
          type: 'depends_on',
          directed: true,
          conditional: gates.length > 0,
          note: [edge.note ?? '', gates.length ? `开关：${gates.map((p) => p.name).join('、')}` : '']
            .filter(Boolean)
            .join('；'),
          sourcePort: null,
          targetPort: null,
          /** 两端都在表面的才画在表面；连到子图的归子图内部 */
          surface: surfaceIds.has(edge.from) && surfaceIds.has(edge.to),
        }
      })
      /**
       * `meta` 必须写全 `GraphMeta` 的字段（缺了画布会在 `cloneGraph` 里炸）：
       * `version / name / description / topics / tags / updatedAt`。
       * `tags` 是**标签注册表**——节点的 `tags` 引用其中的 id，缺了注册表就等于引用了不存在的东西。
       * `updatedAt` 刻意留空：写时间戳会让每次生成的产物都不同，破坏幂等自检。
       */
      const tagRegistry = [
        // 注册表里只有**参数名**：一个参数一个标签，不放身份说明那类词
        ...new Set([...Object.keys(paramMatrix), ...nodes.flatMap((item) => item.codeNames ?? [])]),
      ]
        .sort()
        .map((name) => ({
          id: `tag:${name}`,
          name,
          description: paramMeta.get(name)?.role ?? '',
          /**
           * 类别就写进注册表：**不写**，视图只能把它们全归进「未分类」，
           * 一排标签挤在一顶看不懂的标题下。
           * 取 `inputs.py` 的类名；真源参数表里没有的代码名（分析侧自选的 `K_TARGET` 之类，
           * 真源已声明「不是模型参数」）单列一类。
           */
          group: groupOfParam.get(name) ?? '非模型参数',
        }))
      /** 标签 id → 显示名：块级标签明细要用**同一份名字**（不另起一套命名） */
      const tagNameOf = new Map(tagRegistry.map((tag) => [tag.id, tag.name]))
      /**
       * 坐标：按"从驱动量出发要走多少步"分层，**观测量在上、参数在下**（与页面的自顶向下口径一致）。
       * 目的有二：① 一打开就看得见东西（不依赖画布是否自动排布）；② 排布是确定性的，幂等自检不受影响。
       */
      /**
       * 自顶向下的多叉树，**在"过程框"这一级排**：
       *   ① 先算框的层号（一个框的消费者在上、它的上游在下）；同层框按 id 稳定排序、横向铺开；
       *   ② 每个框里再摆它自己的量（按全局层号排成几行），于是框是整齐的一格一格，不会互相压。
       * 不在任何框里的量（输入/分析那一批）单独摆到最下面一行——**它们不该占顶层**。
       */
      /**
       * **块成员**：一级（主图）的划分来自真源 `chain.json` 的 `blocks.items`（天体物理过程），
       * **不再按 `codeHints` 里的代码阶段归并**——同一个物理过程会被拆在好几个代码阶段里，
       * 于是"⑤气体热史"这种过程横跨 3 个框、同一层里混着 4 个过程（见 proposal.md 的实测）。
       * 判据只有一份（真源），生成器、自检、视图都读它。
       */
      const blockItems = chain.blocks?.items ?? []
      if (!blockItems.length) throw new Error('真源 chain.json 缺 blocks.items：一级划分没有来源')
      const blockMembers = new Map(blockItems.map((item) => [item.id, [...(item.members ?? [])]]))
      const blockOfNode = new Map()
      for (const [blockId, members] of blockMembers) for (const id of members) blockOfNode.set(id, blockId)
      /**
       * **位置（`order`）＝主序位次**，只决定 y 坐标。真源手写的因果档位（旧 `tier`）已退场：
       * 代码里没有层级，只有「一个红移内的调用顺序」与「跨红移回流」（见 design.md D4）。
       */
      const blockOrder = new Map(blockItems.map((item) => [item.id, item.order ?? 0]))
      const boxIds = blockItems.map((item) => item.id)
      /**
       * **块间接口边**：主图唯一的边（**21 条**：32 条跨块依赖落在 21 对块上）。两端分属不同块的"量 → 量"依赖汇总而来，
       * 同一对块只留一条，**标签写跨界流动的那个量的符号**（如 `④ → ⑤ Q_HII`，见 design.md D5）。
       * 静息不画：`focusOnly: true` —— 悬浮两端任一块时才显现。
       */
      const symbolOf = new Map([...chain.drivers, ...chain.nodes].map((item) => [item.id, item.symbol ?? item.id]))
      const boxOut = new Map(boxIds.map((id) => [id, []]))
      /**
       * **块的「对外输入」**（＝块外指进来的量）：进这个块的子图时它们会**灰显**在旁边，
       * 回答"这一块的成员读了块外的哪个量"（`contexts`，见 design.md 的「主图 / 子图职责划分」）。
       * 它们是**别的块的成员本人**（同一个 id，不是复制出来的节点）——只改可见集、不新增对象，
       * 所以主图里 `T_γ` 仍然只有一个（自检钉住这条）。
       */
      const blockInputs = new Map(boxIds.map((id) => [id, []]))
      const interfaceMap = new Map()
      for (const edge of gEdges) {
        const from = blockOfNode.get(edge.source)
        const to = blockOfNode.get(edge.target)
        if (!from || !to || from === to) continue
        boxOut.get(from).push(to)
        /** 跨界依赖的**源量**就是目标块的对外输入（同一对块可能有多条，去重） */
        const inputs = blockInputs.get(to)
        if (!inputs.includes(edge.source)) inputs.push(edge.source)
        const key = `${from}->${to}`
        const item = interfaceMap.get(key) ?? { from, to, names: [], relations: [] }
        const name = symbolOf.get(edge.source) ?? edge.source
        if (!item.names.includes(name)) item.names.push(name)
        item.relations.push(`${edge.source}→${edge.target}`)
        interfaceMap.set(key, item)
      }
      const interfaceEdges = [...interfaceMap.entries()].map(([key, item]) => {
        return {
          id: `iface:${key}`,
          source: item.from,
          target: item.to,
          label: item.names.join('、'),
          type: 'depends_on',
          directed: true,
          conditional: false,
          surface: true,
          /** 静息隐藏，悬浮两端任一块时显现（视图读这个字段，见 design.md D5） */
          focusOnly: true,
          /**
           * 接口边是**汇总边**：它由那几条更细的"量 → 量"依赖汇总而来（`note` 里列着）。
           * 这里只留方向：`order(to) > order(from)`——画法交给视图（悬浮显现的箭头）。
           */
          crossLink: true,
          note: `块间接口：由这些跨界依赖汇总而来 —— ${item.relations.join('、')}；段内第 ${blockOrder.get(item.from)} 位 → 第 ${blockOrder.get(item.to)} 位`,
        }
      })
      /**
       * **块间交付边的方向**：位次必须递增（自左向右 / 自上而下，没有回指）——这里只留这条
       * "不许写反"的写前校验。
       */
      for (const edge of interfaceEdges) {
        const span = (blockOrder.get(edge.target) ?? 0) - (blockOrder.get(edge.source) ?? 0)
        if (!Number.isInteger(span) || span < 1) {
          throw new Error(
            `接口边 ${edge.id} 的位次差是 ${span}：主序边必须自左向右/自上而下、跨正位次（真源 order 写反了？回流请写进 feedback 段）`,
          )
        }
      }
      /**
       * **反馈边（跨红移回流）**：真源 `feedback` 段单列，三条都回到「网格化源项」块（`HaloBox.c:487/495/496`）。
       * 它们**不进主序**：主序边必须跨正位次，而回流天然跨负位次，混在一起会成环（`HaloBox` 与 `IonizedBox`
       * 互为上下游），所以单独一张名单 + 独立样式。视图把箭头朝上画，图例写明"下游的量在下一红移回到上游阈值"。
       */
      const feedbackItems = chain.feedback ?? []
      if (!feedbackItems.length) throw new Error('真源 chain.json 缺 feedback 段：跨红移回流没有来源')
      const feedbackEdges = feedbackItems.map((item) => {
        /** 与接口边同一套算号：`order(to) − order(from)`；正数=顺主序，负数=回流 */
        const span = (blockOrder.get(item.to) ?? 0) - (blockOrder.get(item.from) ?? 0)
        if (!Number.isInteger(span) || span >= 0) {
          throw new Error(
            `反馈边 ${item.from} -> ${item.to} 的位次差是 ${span}：回流必须自下游指回上游（from 的 order 必须大于 to）`,
          )
        }
        const fromSymbol = symbolOf.get(item.fromNode) ?? item.fromNode
        return {
          id: `feedback:${item.from}->${item.to}`,
          source: item.from,
          target: item.to,
          /** 两端的具体量（回流落在哪个量上是块级的执行细节，写进数据供图例、检查器与自检读） */
          fromNode: item.fromNode,
          toNode: item.toNode,
          /** 标签与接口边同一条口径：只写**交付的那个量**（来源端那个），不写 `A → B` 那种两端并列 */
          label: fromSymbol,
          type: 'depends_on',
          directed: true,
          optional: false,
          conditional: false,
          surface: true,
          /** 一级常显（不像接口边那样要悬浮）：反馈环是这套图唯一能表达"跨红移"的边，藏起来就没了 */
          focusOnly: false,
          /** 与接口边区分：`feedback` 走独立样式，箭头朝上 */
          kind: 'feedback',
          crossLink: true,
          /** 代码出处（自检要求三类跨块关系都带）：文件 + 行号 */
          codeRef: item.codeRef,
          note: `跨红移回流（${item.codeRef}）：${item.note}`,
        }
      })
      /**
       * 块的主序位次：直接来自真源、**不做拓扑重算**（重算会把反馈边算进去成环）；
       * 它现在是**段内**的横向位次，顺序由摆放承担。
       */
      const boxOrder = new Map(blockItems.map((item) => [item.id, item.order ?? 0]))
      /**
       * **段（`phase`）与段序**：一级按段摆放——段自上而下竖摞，**段内按位次（`order`）自左向右**排开
       * （段即一条水平带，同段同一条 y）。于是顺序完全由摆放表达：不画「下一步」连线，也不再需要脊轨、
       * 步序刻度这类替代品（见 spec「一级按三段骨架与执行序摆放」）。真源里出现未登记的段名时，
       * 排在已知段之后（稳定兜底）。
       *
       * **层（`phase: 'layer'`）占一条带、但不出段框**：它是"全程只读、不属于任何一步"的参照物，
       * 没有"这一步"可以包，所以容器那一节跳过它——块自己单独占最上面那条带。
       */
      const boxPhase = new Map(blockItems.map((item) => [item.id, item.phase ?? 'prep']))
      const KNOWN_PHASES = ['layer', 'prep', 'loop']
      /** 层（`kind:'layer'`）不是过程：不画成过程块、不可进入、不计入过程数（用户 2026-09-30 定的 A 方案） */
      const layerIds = new Set(blockItems.filter((item) => item.kind === 'layer').map((item) => item.id))
      /**
       * **尺寸与距离同源**（用户 2026-09-30：*初始模块尺寸和距离要成比例，距离过大模块又太小*）。
       *
       * 病根在这里：早先坐标是按写死的 `BOX_W = 820 / BOX_H = 300` 排的，可画布上的框根本不是
       * 这个尺寸——它由 `labels.ts` 按标签算出来（块实际是 116~240 宽、38 高）。于是间隙是框的
       * 4~7 倍，一取景整屏缩到 0.16 倍（字不到 2px）。"距离过大模块又太小"就是这么来的：
       * **坐标里那个"框有多大"和画布上那个"框有多大"是两套数**。
       *
       * 现在只有两个数：框的宽高**问尺寸口径**（`lib/boxSize.mjs`，与画布同一套公式），间距**恒为
       * 常数 `GAP`**。于是"间隙 = 24"在数据里成立、与框大小无关——框大则整片跟着大，取景后字大。
       */
      const blockSizeOf = (id) => measureBoxSize(blockItems.find((item) => item.id === id)?.label ?? id)
      const boxRows = new Map()
      // 段内次序 = 位次（`order`）；并列时按 id 稳定排序（幂等）
      for (const id of [...boxIds].sort(
        (a, b) => (boxOrder.get(a) ?? 0) - (boxOrder.get(b) ?? 0) || (a < b ? -1 : 1),
      )) {
        const phase = boxPhase.get(id) ?? 'prep'
        boxRows.set(phase, [...(boxRows.get(phase) ?? []), id])
      }
      /**
       * 每段中心的 y：段高取该段**最高的块**，但让位按**框高**——块外面还套着段容器，
       * 框 = 本段块并集 + 上下各一圈 `FRAME_PADDING`，画布上块还比模型高 `BADGE_LINE`。
       * 于是"框与框之间恒为 `GAP`"：与段内块距、成员距、步骤距是同一个数，段距不是另一套步长。
       * （只按块高让位时，画布上相邻两段的框会纵向压进来——框线切过邻段的块。）
       */
      const rowY = new Map()
      let rowsBottom = 0
      const phaseOrder = [
        ...KNOWN_PHASES,
        ...[...boxRows.keys()].filter((phase) => !KNOWN_PHASES.includes(phase)).sort(),
      ]
      for (const phase of phaseOrder) {
        const ids = boxRows.get(phase)
        if (!ids?.length) continue
        const height = Math.max(...ids.map((id) => blockSizeOf(id).height))
        const frameHeight = height + BADGE_LINE + FRAME_PADDING * 2
        rowY.set(phase, rowsBottom + frameHeight / 2)
        rowsBottom += frameHeight + GAP
      }
      const boxCenter = new Map()
      for (const [phase, ids] of boxRows) {
        /**
         * **段 = 一条水平带**：段往下走（y），段内自左向右（x）；同段按**各自的宽**依次让开。
         *
         * 这里**只按块自己的宽**排——不按"块 + 它那些成员"的横铺宽度。理由：成员只在自己块的
         * 子图标签页里出现，不同块的成员**永不同屏**，因此它们即使在同一 y 上横向重叠也不可见；
         * 而按包围宽度排会把段内块间距撑到几百，直接打破"全图只有一个间距"那条不变量
         * （成员与自己的块同一条 y 是另一条不变量，两者在"块能否排得下自己的成员"上并不冲突）。
         */
        const xs = stackCenters(ids.map((id) => blockSizeOf(id)), 'x', 0)
        ids.forEach((id, index) => boxCenter.set(id, { x: xs[index], y: rowY.get(phase) }))
      }
      /**
       * **段容器**（`type: 'group'`，design D8 / spec「段是容器，不参与关系与导航」）：有块的段各出一个
       * 容器，块是它的子节点——"哪些块在同一步"由**包含**表达，静息即读得出来（容器的标题在任何
       * 缩放下都留着）。容器不参与关系、标签、进入、命中，也不进图例：与画布页那些大框同一套口径。
       *
       * 尺寸与坐标**都不在这里给**：容器由子节点包围盒撑开（样式表只给下限 `min-width / min-height`）、
       * 坐标由子节点推导（`cytoscapeSetup` 的"容器的坐标一律由子节点推导"）。
       * 没有块的段**不出容器**：空框没有子节点可推导，也没有内容可包。
       */
      /**
       * 段标题取**短名**：容器标题贴着框的左上角、任何缩放下都在，写长了会压住块。
       * 完整那句进 `summary`，在属性页读——说的是**这一段在做什么**（只算一次 / 每个红移重算），
       * 不写代码坐标：`all_redshifts` 这类名字在这一页没有落点，读的人拿不到可核验的东西。
       */
      const SEG_LABELS = {
        prep: '红移循环前',
        loop: '逐红移循环',
      }
      const SEG_SUMMARIES = {
        prep: '与红移无关的底子：只算一次，之后每个红移都在它上面接着算',
        loop: '每个红移重算一遍：沿时间从高红移往低红移推进',
      }
      /**
       * **段的容器只给"执行的步"**：`layer` 那条带上只放层（它不是一步），所以不出容器——
       * 于是容器数 = 段数（红移循环前 / 逐红移循环），层块自己挂在顶层。
       */
      const SEG_PHASES = new Set(['prep', 'loop'])
      const segNodes = []
      for (const phase of phaseOrder) {
        if (!SEG_PHASES.has(phase)) continue
        const ids = boxRows.get(phase)
        if (!ids?.length) continue
        const label = SEG_LABELS[phase] ?? phase
        const segNode = {
          id: `seg:${phase}`,
          label,
          type: 'group',
          /** 段名（数据侧，供自检与视图按段说话） */
          phase,
          layer: 'surface',
          summary: SEG_SUMMARIES[phase] ?? '',
          refs: [],
          tags: [],
          topics: [],
          parent: null,
          enterable: false,
          observable: false,
          conditional: false,
        }
        /**
         * 只留一份**兜底**坐标（段的中心）：视图一律按子节点包围盒推导、用不到它，
         * 留一份是为了产物本身自洽——离线工具与自检可以直接拿坐标说话。
         */
        segNodes.push({ ...segNode, position: { x: 0, y: Math.round(rowY.get(phase)) } })
      }

      /**
       * **块内边**（两端同属一个块）：块内次序与连通分量都读它。块内边**不进主图**，
       * 只在这个块的子图里画（`internalEdgesOf` 供视图与自检取用）。
       * 定义在这里（而不是原来靠后的位置）是因为**成员排布**先要用它。
       */
      const internalEdgesOf = new Map(boxIds.map((id) => [id, []]))
      for (const edge of gEdges) {
        const from = blockOfNode.get(edge.source)
        const to = blockOfNode.get(edge.target)
        if (from && from === to) internalEdgesOf.get(from).push(edge)
      }
      /**
       * **块内次序 = 块内边的拓扑序**（Kahn，从入到出）：分层模型退场后，"成员谁在左"不再由层号决定，
       * 而由**这个块自己的数据流**决定——读起来就是这一步先算什么、后算什么。并列项按 id 稳定排序（幂等）；
       * 万一有环或悬空，兜底把剩下的按 id 接在后面，**不许丢成员**。
       */
      const memberOrderOf = (ids, edges) => {
        const inside = new Set(ids)
        const indegree = new Map(ids.map((id) => [id, 0]))
        const outs = new Map(ids.map((id) => [id, []]))
        for (const edge of edges) {
          if (!inside.has(edge.source) || !inside.has(edge.target) || edge.source === edge.target) continue
          outs.get(edge.source).push(edge.target)
          indegree.set(edge.target, indegree.get(edge.target) + 1)
        }
        const ready = ids.filter((id) => indegree.get(id) === 0).sort()
        const placed = []
        while (ready.length) {
          const id = ready.shift()
          placed.push(id)
          for (const next of outs.get(id)) {
            indegree.set(next, indegree.get(next) - 1)
            if (indegree.get(next) !== 0) continue
            const at = ready.findIndex((item) => item > next)
            if (at < 0) ready.push(next)
            else ready.splice(at, 0, next)
          }
        }
        return [...placed, ...ids.filter((id) => !placed.includes(id)).sort()]
      }
      const membersOfBox = new Map(boxIds.map((id) => [id, [...(blockMembers.get(id) ?? [])]]))
      for (const [boxId, ids] of membersOfBox) {
        const center = boxCenter.get(boxId)
        const ordered = memberOrderOf(ids, internalEdgesOf.get(boxId) ?? [])
        // 同一块里的量：也按**各自的宽**让开，间距同样是那个常数（这块的标签页取景时字才够大）
        const xs = stackCenters(
          ordered.map((id) => measureBoxSize(gNodes.find((item) => item.id === id)?.label)),
          'x',
          center?.x ?? 0,
        )
        ordered.forEach((id, index) => {
          const node = gNodes.find((item) => item.id === id)
          if (!node || !center) return
          /**
           * **同一深度等高**：一个框里的量全部排在同一行（y 相同），不再上下错开——
           * 于是每一层就是一条水平带，层与层的关系一眼看得出来。（自检逐条核这条不变量。）
           */
          node.position = { x: xs[index], y: center.y }
        })
      }
      const insideIds = new Set([...membersOfBox.values()].flat())
      const outsideNodes = gNodes.filter((node) => !insideIds.has(node.id))
      // 不在框里的量（输入/分析）：单独一条带放在**所有行之下**，与上面最后一行也只隔一个 `GAP`
      if (outsideNodes.length) {
        const outsideSizes = outsideNodes.map((node) => measureBoxSize(node.label))
        const outsideY = rowsBottom + GAP + Math.max(...outsideSizes.map((size) => size.height)) / 2
        const xs = stackCenters(outsideSizes, 'x', 0)
        outsideNodes.forEach((node, index) => {
          node.position = { x: xs[index], y: outsideY }
        })
      }

      /**
       * **块内连通分量**：可进入判据（成员非空且分量 = 1）与块级数字断言都读它。
       * `internalEdgesOf` 已在上面的成员排布处定义（那里先用到了它）。
       */
      /**
       * 成员分几簇（并查集）。**只数"是图上节点"的成员**：层的成员里有文件（L1 的 16 个头文件），
       * 它们不在图上、也不参与块内边，混进来会把 L1 报成"16 簇"这种没法解释的数。
       * 这个数只作信息（属性页显示"成员连不连"），**可进入性由 `kind` 决定**，不再由它推断。
       */
      const componentsOf = (blockId, memberIds = blockMembers.get(blockId) ?? []) => {
        const parent = new Map(memberIds.map((id) => [id, id]))
        const find = (x) => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x)))
        for (const edge of internalEdgesOf.get(blockId) ?? []) {
          if (!parent.has(edge.source) || !parent.has(edge.target)) continue
          const a = find(edge.source)
          const b = find(edge.target)
          if (a !== b) parent.set(a, b)
        }
        return new Set(memberIds.map((id) => find(id))).size
      }
      /**
       * **一级 = 11 个块**（10 个过程块 + 1 个层）：块是 `type: 'process'` 的**普通节点**、
       * 不是 `group` 容器——容器之间不许有边，而块间要画 21 条接口边
       * （见 design.md D1）。反过来说明它必须是普通节点：成员靠 `parent` 指向它，画布
       * "焦点只看直系子节点"那套现成机制于是直接生效——一级天然只剩 11 个块，块内成员不同屏。
       * 位置取成员包围盒的中心，尺寸交给画布。
       */
      const blockNodes = []
      for (const block of blockItems) {
        const ids = blockMembers.get(block.id) ?? []
        const members = gNodes.filter((node) => ids.includes(node.id))
        for (const member of members) member.parent = block.id
        /**
         * **块的标签 = 成员标签的并集**。块**没有自己的标签**——"这个块涉及参数 X"完全由成员决定，所以它跟
         * `stages` 是同一条口径：块只写成员的并集，由成员独立重算得出来（写前自检会核一遍）。
         */
        const memberTags = [...new Set(members.flatMap((member) => member.tags ?? []))].sort()
        const components = componentsOf(
          block.id,
          members.map((member) => member.id),
        )
        const center = boxCenter.get(block.id)
        blockNodes.push({
          id: block.id,
          label: block.label,
          type: 'process',
          summary: block.note ?? '',
          // `layer` 只在册的两值里取：块在一级，属于 surface（子图里的步骤才是 subgraph）
          layer: 'surface',
          /**
           * `process` = 一个 Compute* 步（可进入）；`layer` = 层（不可进入、不计入过程数、不装进段容器）。
           * 判据来自真源声明的 `kind`，旧稿那套"成员连通性推断"（`band`）已退场——它会把 M4 这种
           * 成员分两簇的过程块误判成带。
           */
          blockKind: block.kind ?? 'process',
          order: block.order ?? 0,
          /**
           * **段**：这块在代码流程的哪一段（真源声明）——`layer` 层（不属任何一步）/ `prep` 预备（一次性）/ `loop` 逐红移循环。
           * 一级按段摆放（段即一条水平带），顺序由摆放承担、不再画「下一步」连线；
           * `flowStep` 是它在主循环里的第几步（只有循环段的块有），供自检与主循环调用序对拍。
           */
          phase: block.phase ?? 'prep',
          flowStep: block.flowStep ?? null,
          /** 代码锚（`.c` + `Compute*` + 盒子结构名）：属性页显示"这一块是哪段代码"，自检逐条断言它真实存在 */
          codeAnchor: block.codeAnchor ?? null,
          /**
           * 成员数（= 真源声明的成员条数，含层里的**文件**成员）；`quantityMemberCount` 只数其中的**物理量**。
           * 两个数分开：L1 的成员是 16 个头文件，它们不是图上的节点，用 `members.length` 一个数会
           * 得出"成员 16 个、可进入为假"这种自相矛盾的组合（旧稿就是这么错的）。
           */
          memberCount: (blockMembers.get(block.id) ?? []).length,
          quantityMemberCount: members.length,
          /** 块内成员分几簇（并查集）：只作信息，属性页显示"成员连不连"（可进入性已改由 `kind` 决定） */
          components,
          internalEdgeCount: (internalEdgesOf.get(block.id) ?? []).length,
          /**
           * **成员涉及的代码阶段号**（并集，去重排序）：属性页显示"这个块算在哪几段代码里"。
           * 由成员节点各自的 `stage` 汇总而来，写前校验会核一遍对得上（对不上就是生成时漏了）。
           */
          stages: [...new Set(members.map((member) => member.stage).filter(Boolean))].sort(),
          /**
           * 可进入 = 它是一个过程块（真源 `kind === 'process'`）。层**一定不可进入**（L0/L1 没子图可进）。
           * `components` 只作信息留着（属性页显示"成员分几簇"），不再参与这个判断。
           */
          enterable: block.kind !== 'layer' && members.length > 0,
          /**
           * **对外输入**（灰显上下文）：块外指进来的量 id。进这个块的子图时按它显形。
           * ① 暗物质晕质量函数 / ② 晕质量阈值 没有上游 → 空数组（子图里就只剩自己的成员）。
           */
          contexts: [...(blockInputs.get(block.id) ?? [])].sort(),
          /**
           * **父级 = 段容器**（design D8）：过程块装在它那一段的容器里，"哪些块在同一步"由包含表达；
           * **层没有容器**（它不是一步），所以父级为空、单独挂在顶层。
           * 一级的可见集因此是"顶层容器 + 装进去的块 + 层自己"（`hierarchy.ts` 的装饰容器后代递归）——
           * 与"一级 = 11 个块"那条口径一致：容器是装饰，块才是对象。
           */
          parent: block.kind === 'layer' ? null : `seg:${block.phase ?? 'prep'}`,
          observable: false,
          conditional: false,
          topics: [],
          /**
           * 块的标签 = 成员标签并集（见上面 `memberTags` 的说明）。
           * 明细里写明"成员里有 N 个量带着它"——否则点块上的红点会读成"块本身有这个参数"。
           */
          tags: memberTags,
          tagDetails: Object.fromEntries(
            memberTags.map((tagId) => {
              const owners = members.filter((member) => (member.tags ?? []).includes(tagId))
              const shown = owners.slice(0, 6).map((owner) => owner.label).join('、')
              return [
                tagId,
                [
                  {
                    label: tagNameOf.get(tagId) ?? tagId.replace(/^tag:/, ''),
                    kind: '块',
                    note: `成员里有 ${owners.length} 个量带着它：${shown}${owners.length > 6 ? ' 等' : ''}`,
                    ref: null,
                  },
                ],
              ]
            }),
          ),
          /**
           * **块自身的引用**（成员的并集在下面「引用汇总」那段里并进来，这里只写"块自己的"）：
           * 指向 `modules/<块>.md`（锚点 = 文档 H1 的 slug，即块标签）；层再加整文件级的代码落点
           * （`layerFileSites`，见那里的说明）。
           * 块上必须有落点：选中一个块要能回答"这一块算在哪几行"，而属性页只列非空的那一类——
           * 「源码」空着的话那个标签页根本不出现，等于没有代码入口。
           */
          refs: [
            /** 块自己的那篇（design D4）：指向 `modules/<块>.md`，锚点 = 那篇的 H1，即块标签 */
            noteRefOf(docPathOf(block.id), String(block.label)),
            ...(layerFileSites.get(block.id) ?? []).map((site) => ({
              docId: '',
              anchor: '',
              label: site.label,
              file: site.file,
              line: site.line,
              endLine: site.endLine,
            })),
          ],
          position: { x: center?.x ?? 0, y: center?.y ?? 0 },
        })
      }

      /**
       * （原「子图层」整段已退场：**函数那一级不再上图**。物理链的底是物理量与物理过程——谁把它算出来、
       *   切在哪几个函数里，回答的是"这个量由哪几行算出"，归代码落点管（`stepSites` 仍是唯一产地），
       *   不归图层管。步骤的直接后果有两处：成员节点的直接引用并进它全部步骤的核定落点（见成员节点构造处），
       *   模块文档的工程一节按步骤成小节（手写那批，见 design.md D1 / D5）。）
       */

      /**
       * **笔记承载：一个模块一篇、成员各占一节**（design D2 / D4）：成员指向
       * `modules/<块>.md`，锚点 = 它那一节的标题，而那个标题就是节点标签本身——于是"补写笔记正文"
       * 不用改一行页面代码；反过来，谁把标题改坏了，自检打开文档时当场失败。
       */
      for (const [blockId, memberIds] of blockMembers) {
        for (const memberId of memberIds) {
          const member = gNodes.find((node) => node.id === memberId)
          if (member) member.refs = [...member.refs, noteRefOf(docPathOf(blockId), member.label)]
        }
      }

      /**
       * **引用汇总**（design D2）：`refs(块) = 去重排序( 块自身那几条 ∪ ⋃ refs(它的每个成员) )`。
       * 成员归属的唯一来源是真源 `blocks.items[].members`（块**不**从 `parent` 取成员）。
       * 层的成员里有**文件名**（L1 的 16 个公共头文件）：它们不在图上、取不到引用，按空处理——
       * 层那份整文件级落点已由上面的 `layerFileSites` 直接给出。
       * 成员自己那份已经是"自己的核心行 ∪ 它全部实现步骤的核定落点 ∪ 自己那篇笔记"，往上只有块这一层，
       * 所以这里只并块。去重与排序照 `canonicalRefs`（去重键不含 `label`：同一处落点只留一份）。
       */
      for (const block of blockNodes) {
        block.refs = canonicalRefs([
          block.refs,
          ...(blockMembers.get(block.id) ?? []).map(
            (memberId) => gNodes.find((node) => node.id === memberId)?.refs ?? [],
          ),
        ])
      }
      /** 同一节点内部的重复仍要收成一份（块上那几条上面已去过重，这里是幂等的） */
      for (const node of [...gNodes, ...blockNodes]) node.refs = canonicalRefs([node.refs])

      /**
       * （原「顶层流程 `stageEdges`」整段已退场：一级不再用"过程框之间的汇总边"。
       *   取而代之的是上面那 20 条 `interfaceEdges` —— 标签从"N 条"改成**跨界流动的量名**，
       *   且静息不画、悬浮显现。见 design.md D5 与 tasks.md 3.6。）
       */

      return {
        meta: {
          id: 'physics-chain',
          version: 1,
          name: '物理链',
          description: '物理视角：观测量往下追到参数；节点是物理量（标签＝符号 · 中文名，描述＝公式），连线的标签是 Eq 号。只读生成物。',
          topics: [
            {
              id: IMPL_TOPIC_ID,
              name: '实现细节',
              description:
                '把某个物理量「算出来」的那段实现（如质量函数的算法、源项的积分）。默认收起：表面只放物理环节，需要时一键展开。',
            },
            {
              id: BYPASS_TOPIC_ID,
              name: '旁路与后处理接口',
              description:
                'S04：算完顺手给出的诊断出口（光度函数 φ(M)、光深 τ_e 等）。默认收起：它们不在物理主链上，看不看都不改变后面的结果。',
            },
          ],
          tags: tagRegistry,
          updatedAt: '',
        },
        nodes: [...gNodes, ...blockNodes, ...segNodes],
        /**
         * 一级（主图）的边 = **21 条块间接口**（`iface:*`）：静息不画，悬浮两端任一块时才显现
         * （`focusOnly` 字段，）。`gEdges` 那 58 条"量 → 量"仍留在数据里：
         * 块内 26 条留给子图画，块间 32 条已**汇总成 21 条**接口边（同一对块合并成一条）。
         * 视图按 `parent` 聚焦，一级只看得到块。
         */
        edges: [...gEdges, ...interfaceEdges, ...feedbackEdges],
        /**
         * **块（一级的 10 个过程块 + 1 个层）**：一级划分的事实全在这一处，视图与自检都读它、不各自重算。
         *   · `members`：那 41 个物理量（不重不漏，自检逐块核）；层的成员（`tgamma`）也是物理量，照常计入；
         *   · `enterable`：`kind === 'process'` 才可进入；层不可进入（进去没有子图）；
         *   · `codeAnchor`：`.c` + `Compute*` + 盒子结构名，自检逐条断言真实存在；
         *   · `interfaceIn` / `interfaceOut`：对外接口是哪几条 `iface:*`（**只供自检**核对
         *     "每条接口边恰被两端各认领一次"；界面不列这份清单——，
         *     跨块送了什么由悬浮块时显现的接口边承载）。
         */
        blocks: {
          items: blockNodes.map((node) => ({
            id: node.id,
            label: node.label,
            kind: node.blockKind,
            order: node.order,
            /** 段与红移内步序：与块节点上那两份是同一份事实的两个出口（视图读节点、自检读这里） */
            phase: node.phase,
            flowStep: node.flowStep,
            codeAnchor: node.codeAnchor,
            note: node.summary,
            members: blockMembers.get(node.id) ?? [],
            memberCount: node.memberCount,
            /** 成员里真正是"物理量"的个数（层里除了 L0 的 T_γ 之外全是头文件，不算物理量） */
            quantityMemberCount: node.quantityMemberCount,
            components: node.components,
            internalEdgeCount: node.internalEdgeCount,
            enterable: node.enterable,
            /** 成员涉及的代码阶段号并集（属性页显示"这个块算在哪几段代码里"） */
            stages: node.stages,
            /**
             * 成员标签的并集（与块节点上那份 `tags` 同一份事实的两个出口：视图读节点、自检读这里）。
             * 块不自造标签——`stages` 的并集口径相同。
             */
            tags: node.tags,
            position: node.position,
            /**
             * 块自己的引用（代码 + 笔记）。与块节点上那份是**同一份事实的两个出口**（视图读节点、自检读这里）。
             * 与 `stages` / `tags` 不同：那两样是成员的并集，引用**不是**——块的证据是它那篇 md，
             * 成员各自的落点各归各。
             */
            refs: node.refs,
            interfaceIn: interfaceEdges.filter((edge) => edge.target === node.id).map((edge) => edge.id),
            interfaceOut: interfaceEdges.filter((edge) => edge.source === node.id).map((edge) => edge.id),
            /** 块外指进来的量（进子图时灰显的上下文节点），见块节点上的 `contexts` */
            contexts: node.contexts ?? [],
          })),
          /** 一级的口径数字：状态条直接读它，自检直接比它（都不各自重算） */
          stats: {
            blocks: blockNodes.length,
            processBlocks: blockNodes.filter((node) => node.blockKind === 'process').length,
            layerBlocks: blockNodes.filter((node) => node.blockKind === 'layer').length,
            /** 物理量成员数（= 真源 nodes + drivers 的总数，不重不漏） */
            members: blockNodes.reduce((sum, node) => sum + node.quantityMemberCount, 0),
            /** 文件成员数（成员里不是物理量的那些：层不再挂文件，所以恒为 0） */
            fileMembers: blockNodes.reduce((sum, node) => sum + (node.memberCount - node.quantityMemberCount), 0),
            interfaceEdges: interfaceEdges.length,
          },
        },
        /**
         * 骨干树 + 交叉边的分类（视图与自检都读它）：`levels` 是层号，`parentOf` 是主父表，
         * 后面五个名单把每条非骨干边按成因归位 —— 「为什么会出现跨层」在数据里就有答案。
         */
      }
    })(),
    /** 参数 × 节点／边 的查表（后端算好，视图直接读） */
    paramMatrix,
    /** 算法锚点与「待补」名单：原样透传（自检会查有没有静默留空） */
    algorithms: chain.algorithms ?? {},
    algorithmPending: chain.algorithmPending ?? {},
    /**
     * **左栏第二个检索面（天体物理过程）**：真源 `processes` **原样透传** —— 口径、转录来源、
     * `fit` 的收条标准都写在真源里，生成器不解读、不重算（深查在 `check-physics-chain.mjs` 的
     * 「不重不漏」那条）。视图按它渲染过程面，MUST NOT 在视图里写死名单。
     */
    processes: chain.processes ?? {},
    params: groups,
    stats: {
      drivers: chain.drivers.length,
      nodes: chain.nodes.length,
      edges: chain.edges.length,
      degeneracies: chain.degeneracies.length,
      params: Object.values(groups).reduce((sum, list) => sum + list.length, 0),
      codeSites: 0,
    },
  }

  /** 落点去重后计数（在 artifact 建好之后再算，避免读取尚未初始化的变量） */
  artifact.stats.codeSites = [
    ...new Set([...artifact.drivers, ...artifact.nodes].flatMap((item) => item.code.sites.map((site) => `${site.file}:${site.line}`))),
  ].length
  /** 落点来源与"待补"：真源核定的条数、atlas 回落的条数、待核定核心行的单元数（生成日志与自检都读这一处） */
  const allSites = [...artifact.drivers, ...artifact.nodes].flatMap((item) => item.code.sites)
  artifact.stats.codeSitesFromChain = allSites.filter((site) => site.source === 'chain').length
  artifact.stats.codeSitesPending = [...artifact.drivers, ...artifact.nodes].flatMap((item) => item.code.pending ?? []).length
  /** atlas 找不到函数体的单元（步骤节点因此没有核心行）：清单进产物，"待补"不许只留在生成日志里 */
  artifact.stats.pendingUnits = siteStats.pending

  const shapeProblems = assertShape(artifact)
  if (shapeProblems.length) {
    say('✗ 写前校验未通过：')
    for (const problem of shapeProblems.slice(0, 20)) say(`   · ${problem}`)
    process.exitCode = 1
    return
  }

  /** 戳记 = 内容哈希（文档与源码不变时产物逐字不变） */
  artifact.stamp = `generated-${createHash('sha1')
    .update(JSON.stringify({ ...artifact, stamp: '' }))
    .digest('hex')
    .slice(0, 12)}`

  say('物理链 · 生成')
  say(`  驱动量 ${artifact.stats.drivers} · 物理量 ${artifact.stats.nodes} · 依赖边 ${artifact.stats.edges} · 简并 ${artifact.stats.degeneracies}`)
  say(`  参数 ${artifact.stats.params}（${Object.entries(groups).map(([name, list]) => `${name} ${list.length}`).join(' / ')}）`)
  say(
    `  代码落点 ${artifact.stats.codeSites} 处（真源核定 ${artifact.stats.codeSitesFromChain}，atlas 回落 ${allSites.length - artifact.stats.codeSitesFromChain}` +
      `；atlas 定位到函数体的单元 ${siteStats.located}，待核定核心行 ${siteStats.pending.length}，读不到文件 ${siteStats.missed.length}）`,
  )
  if (siteStats.pending.length) {
    say(`  ⚠ atlas 找不到函数体、待核定核心行（不许静默）：${siteStats.pending.map((item) => `${item.unit}（${item.file}）`).join('、')}`)
  }
  say(
    `  块间交付边 ${(artifact.graph?.edges ?? []).filter((edge) => edge.focusOnly).length} 条 ·` +
      ` 跨红移回流 ${(artifact.graph?.edges ?? []).filter((edge) => edge.kind === 'feedback').length} 条`,
  )
  say(`  戳记 ${artifact.stamp}`)

  if (flag('stdout')) {
    process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`)
    return
  }

  if (flag('dry-run')) {
    say('  （dry-run：没有写文件）')
    return
  }

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true })
  const before = await fs.readFile(OUT_FILE, 'utf8').catch(() => null)
  const payload = `${JSON.stringify(artifact, null, 2)}\n`
  if (before === payload) {
    console.log('  产物无变化（幂等）')
  } else {
    if (before) await fs.writeFile(`${OUT_FILE}.bak`, before, 'utf8')
    await fs.writeFile(`${OUT_FILE}.tmp`, payload, 'utf8')
    await fs.rename(`${OUT_FILE}.tmp`, OUT_FILE)
    console.log(`  已写入 ${path.relative(path.join(HERE, '..'), OUT_FILE)}${before ? '（旧版留在 .bak）' : ''}`)
  }

}

await main()
