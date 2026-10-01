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
 *   node scripts/build-physics-chain.mjs             # 写产物
 *   node scripts/build-physics-chain.mjs --dry-run   # 只打印统计
 *   node scripts/build-physics-chain.mjs --stdout    # JSON 到 stdout（自检用）
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
import { GAP, measureBoxSize, stackCenters } from './lib/boxSize.mjs'
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
/** 旁路 / 诊断出口的代码阶段：只用来打话题与身份标签，**不决定分层** */
const BYPASS_STAGE = 'S04'
/** `codeHints`（如 `['S14.2']`）→ 阶段号（`S14`）；驱动量没有 hint，给空串 */
const stageOfHint = (hints) => String((Array.isArray(hints) ? hints[0] : hints) ?? '').split('.')[0]
/** 落在这个阶段里的量是诊断出口（算完顺手给出的），不在主链上 —— 与图上 `tag:旁路出口` 同源 */
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
const say = flag('stdout') ? (...parts) => console.error(...parts) : (...parts) => console.log(...parts)

/** 每个物理量最多列几个代码落点（真源里的 codeHints 是"去哪些阶段找"，不是精确函数） */
const MAX_SITES = 8

/**
 * 代码落点：按 atlas L3 的「承担者」取函数体行区间（与画布口径一致：C 按花括号、Python 按缩进）。
 * 返回 `stageCode → [{unit, symbol, file, line, endLine, fileWide}]`
 */
async function buildCodeSites(paramNames) {
  const { subprocesses, units } = await loadAtlas()
  const subprocessByAnchor = new Map(subprocesses.filter((entry) => isSubprocessCode(entry.code)).map((entry) => [entry.anchor, entry]))
  const sourceCache = new Map()
  const byStage = new Map()
  /** hint（阶段或子过程）→ 在这个单元里被读到的参数名 */
  const paramHints = new Map()
  const stats = { units: 0, located: 0, fileWide: 0, missed: [] }

  for (const unit of units.filter((entry) => isUnitCode(entry.code))) {
    const subprocess = subprocessByAnchor.get(docTargetOf(unit.fields['所属子过程'])?.anchor ?? '')
    if (!subprocess) continue
    const stageCode = subprocess.code.split('.')[0]
    const file = sourcePathOf(unit.fields['承担者'])
    if (!file) continue
    stats.units += 1

    const absolute = path.join(REPO_ROOT, file)
    const language = file.endsWith('.py') ? 'python' : 'c'
    if (!sourceCache.has(absolute)) sourceCache.set(absolute, readSource(absolute, language).catch(() => null))
    const source = await sourceCache.get(absolute)
    if (!source) {
      stats.missed.push(`${unit.code}（读不到 ${file}）`)
      continue
    }

    const carrier = unit.fields['承担者']?.raw ?? ''
    const symbols = codeSpans(carrier).filter((item) => !/\.(c|h|py)$/.test(item))
    const bodies = symbols.flatMap((symbol) => findSymbolBodies(source.maskedLines.join('\n'), symbol, language))
    const fileWide = bodies.length === 0 || /各函数|等函数|函数组/.test(carrier)
    const sites = fileWide
      ? [{ symbol: symbols.join('、'), line: 1, endLine: source.lines.length, fileWide: true }]
      : bodies.map((body) => ({ symbol: symbols.join('、'), line: body.startLine, endLine: body.endLine, fileWide: false }))
    if (fileWide) stats.fileWide += 1
    else stats.located += 1

    const entries = sites.map((site) => ({ ...site, unit: unit.code, unitName: unit.name, file }))
    /**
     * 落点挂**三个**键：阶段（`S12`）、子过程（`S12.1`）、计算单元（`S12.1.1`）。
     * 真源的 `codeHints` 写哪个粒度都能对上，越细越准：单元级 = 「源码」标签页恰好落在那一个函数上，
     * 而不是该子过程的前 8 个。**三个键缺一不可**——2026-10-01 之前只挂了前两个，
     * 于是 4 个盒子产物（`matter_power` / `vcb` / `perturb_field` / `filtered_xray`）
     * 那几条**故意写成三段单元码**的 hint 一个都查不到，`refs` 空着（`algorithmPending` 里那批）。
     * 注意：`paramHints` 只挂阶段与子过程两个键（参数归属的口径不跟着改，避免一次动两处口径）。
     */
    for (const key of new Set([stageCode, subprocess.code, unit.code])) {
      byStage.set(key, [...(byStage.get(key) ?? []), ...entries])
    }

    /*
      参数归属（后端查表：参数 × 节点）：在这个单元的**函数体**里找参数读取，认 `->NAME` / `.NAME`
      这两种写法——代码里就是 `astro_params_global->F_STAR10`、`self.F_STAR10`。
      整文件落点（fileWide）不参与：范围太宽，会把不相关的参数一起算进来。
      这只是"出现在这个函数体里"，不等于"这个参数改变了这一步"——够用且可核对，不做更玄的推断。
    */
    if (!fileWide && paramNames.length) {
      for (const site of sites) {
        const body = source.lines.slice(site.line - 1, site.endLine ?? site.line).join('\n')
        for (const name of paramNames) {
          if (!body.includes(`->${name}`) && !body.includes(`.${name}`)) continue
          for (const key of new Set([stageCode, subprocess.code])) {
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
    // 分层纪律（README 第一节）：表面只放物理，工程实现进子图；子图节点必须写明挂在哪条公式/过程下面
    if (node.layer !== undefined && !['surface', 'subgraph'].includes(node.layer)) {
      problems.push(`节点 ${node.id} 的 layer 取值非法：${node.layer}`)
    }
    if (node.layer === 'subgraph' && !node.parent) {
      problems.push(`子图节点 ${node.id} 没写父节点（它挂在哪个物理量/过程的下面）`)
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
   * 骨干树 + 跨层分类的结构不变量（深查在 `check-physics-chain.mjs`，这里只拦"漏标/写反"）：
   *   · 每条边都要有层差，且层差 ≥1（箭头永远自上而下，不存在回指）；
   *   · 骨干边的层差必须 = 1 —— 这就是"骨干是一棵真正的多叉树、结构上不跨层"的可证伪断言；
   *   · 非骨干边必须有成因；层差 1 只能标 `sibling`，层差 >1 不能标 `sibling`。
   */
  const SPAN_KINDS = ['sibling', 'coarse', 'bypass', 'gap', 'feedback']
  for (const edge of artifact.graph?.edges ?? []) {
    /**
     * **反馈边（跨红移回流）反向**：它在签名里由 `previous_*` 决定（`ComputeHaloBox` 收上一个红移的
     * TsBox / IonizedBox），所以层差必须是负数，且不受"箭头永远自上而下"那条约束。它必须有代码出处。
     */
    if (edge.spanKind === 'feedback') {
      if (!Number.isInteger(edge.levelSpan) || edge.levelSpan >= 0) {
        problems.push(`反馈边 ${edge.id} 的层差异常：${edge.levelSpan}（回流必须为负）`)
      }
      if (!edge.codeRef) problems.push(`反馈边 ${edge.id} 缺代码出处 codeRef`)
      continue
    }
    if (!Number.isInteger(edge.levelSpan) || edge.levelSpan < 1) {
      problems.push(`边 ${edge.id} 的层差异常：${edge.levelSpan}`)
      continue
    }
    if (edge.backbone) {
      if (edge.levelSpan !== 1) problems.push(`骨干边 ${edge.id} 跨了 ${edge.levelSpan} 层（骨干必须层差 1）`)
      continue
    }
    if (!SPAN_KINDS.includes(edge.spanKind)) problems.push(`交叉边 ${edge.id} 缺成因分类：${edge.spanKind}`)
    if (edge.levelSpan === 1 && edge.spanKind !== 'sibling') problems.push(`层差 1 的交叉边 ${edge.id} 应标 sibling，实为 ${edge.spanKind}`)
    if (edge.levelSpan > 1 && edge.spanKind === 'sibling') problems.push(`跨 ${edge.levelSpan} 层的边 ${edge.id} 不能标 sibling`)
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
      if (!['process', 'band'].includes(item.kind)) {
        problems.push(`过程 ${item.id} 的 kind 不在册：${item.kind}（应为 process / band）`)
      }
      if (!item.members?.length) problems.push(`过程 ${item.id} 没有成员`)
      for (const member of item.members ?? []) {
        if (!ids.has(member)) problems.push(`过程 ${item.id} 的成员 ${member} 不是图上的量`)
      }
    }
    for (const member of artifact.processes.uncovered?.members ?? []) {
      if (!ids.has(member)) problems.push(`兜底名单里的 ${member} 不是图上的量`)
    }
  }
  const crossLevel = artifact.graph?.crossLevel
  if (!crossLevel) problems.push('缺 crossLevel 段（骨干树 + 跨层成因的分类）')
  else {
    const listed = [
      ...crossLevel.backbone,
      ...crossLevel.sibling,
      ...crossLevel.coarse,
      ...crossLevel.bypass,
      ...crossLevel.gap,
      ...(crossLevel.feedback ?? []),
    ]
    const allEdges = (artifact.graph?.edges ?? []).map((edge) => edge.id)
    const missing = allEdges.filter((id) => !listed.includes(id))
    if (missing.length) problems.push(`这些边没进 crossLevel 任何名单：${missing.slice(0, 5).join(',')}`)
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
     * 容器 = **块**或**子图步骤**（`step:*`）。判据不能拿 `layer === 'subgraph'` 顶替：
     * `hmf_impl` / `source_grid` 这类**量**也标着 `subgraph`（"该移进子图、还没动手"），
     * 它们照样要带阶段号。
     */
    const isContainer = containerIds.has(node.id) || String(node.id).startsWith('step:')
    if (isContainer && node.stage !== undefined) problems.push(`容器 ${node.id} 挂着阶段号：阶段号是量的属性，块的阶段号该放 stages`)
    if (!isContainer && typeof node.stage !== 'string') problems.push(`节点 ${node.id} 缺阶段号属性 stage（阶段号已降级为普通属性）`)
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

async function main() {
  const chain = JSON.parse(await fs.readFile(CHAIN_SOURCE, 'utf8'))
  const inputsText = await fs.readFile(INPUTS_FILE, 'utf8')
  const inputs = parseInputStructs(inputsText)
  /** 真源里声明的全部参数名（组名由数据声明） */
  const declaredParams = Object.keys(chain.params ?? {})
    .filter((key) => Array.isArray(chain.params[key]))
    .flatMap((key) => chain.params[key].map((param) => param.name))
  const { byStage, paramHints, stats: siteStats } = await buildCodeSites(declaredParams)
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
  if (problems.length) {
    say('✗ 真源与源码对不上：')
    for (const problem of problems) say(`   · ${problem}`)
    process.exitCode = 1
    return
  }

  const withSites = (hints = []) => {
    const sites = hints.flatMap((stage) => byStage.get(stage) ?? [])
    return { count: sites.length, sites: sites.slice(0, MAX_SITES) }
  }

  /**
   * **层（`kind: 'layer'`）的代码引用直接取真源的层声明**（design D4）——代码锚写着
   * `kind: 'files'` 的，逐个文件给一条**整文件落点**（`fileWide`，行区间 = 1 到文件末尾，
   * 与 `buildCodeSites` 里整文件落点的口径一致）。为什么不从成员汇总：L1 的 16 个成员是
   * 公共头文件名、**不是图上节点**（没有 `parent` 子节点可汇总，汇总一定是空的）；L0 的成员
   * `tgamma` 是常数，真源里本就没有 `codeHints`（`Constants.c:.T_cmb` 是它的出处，但那是整文件级）。
   * 实测（2026-10-01）：只靠汇总，L0 / L1 两个层的「源码」标签页都是空的，与"12 个模块当下
   * 两类证据都不空"直接冲突——所以两层的代码引用都走这条直接给出分支。
   */
  const layerFileSites = new Map()
  for (const block of chain.blocks?.items ?? []) {
    if (block.codeAnchor?.kind !== 'files') continue
    const sites = []
    for (const name of block.codeAnchor.files ?? []) {
      const relative = `src/py21cmfast/src/${name}`
      const source = await readSource(path.join(REPO_ROOT, relative), 'c').catch(() => null)
      sites.push({ file: relative, label: name, line: 1, endLine: source ? source.lines.length : null })
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
  /** 笔记引用：模块骨架文档里的一个小节。`anchor` = 小节标题的 slug，而那个标题就是节点标签本身 */
  const noteRefOf = (docId, heading) => ({
    docId,
    anchor: slugify(heading),
    label: `模块笔记：${heading}`,
    file: '',
    line: null,
    endLine: null,
  })

  const artifact = {
    version: 1,
    source: {
      derivation: chain.sources?.primary?.file ?? '',
      review: chain.sources?.review?.file ?? '',
      chainSource: path.relative(REPO_ROOT, CHAIN_SOURCE),
      note: chain.note ?? '',
    },
    // 驱动量在真源里是顶层数组、不带 `kind`；产物里补上（视图按种类取色，缺了会炸）
    drivers: chain.drivers.map((driver) => ({ ...driver, kind: driver.kind ?? 'driver', code: withSites([]) })),
    nodes: chain.nodes.map((node) => ({ ...node, code: withSites(node.codeHints) })),
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
              const kind = meta?.switch ? '开关' : driverNames.has(name) ? '驱动量' : String(meta?.role ?? '').startsWith('数值') ? '数值' : '参数'
              return [
                `tag:${name}`,
                // 形状必须与画布一致：`node.tagDetails[tagId]` 是**条目数组**（TagDetailMap）
                [{ label: name, kind, note: meta?.role ?? '', ref: { docId: '', anchor: '', label: '', file: '', line: null, endLine: null } }],
              ]
            }),
          ),
        }
      }
      const surfaceIds = new Set(nodes.filter((item) => item.layer !== 'subgraph').map((item) => item.id))
      /**
       * 这个量在仓库里到底有没有代码落点？判据是 `codeHints` 能查到带行号的落点，
       * **不是**看它有没有 `refs`（真源里根本没有 refs，那是下面才生成的）。
       */
      const hasCodeSite = (item) =>
        (item.codeHints ?? []).some((hint) => (byStage.get(hint) ?? []).some((site) => Number.isFinite(site.line)))
      const gNodes = nodes.map((item) => ({
        id: item.id,
        label: `${item.symbol} · ${item.name}`,
        type: item.kind,
        summary: item.formula ? String(item.formula) : (item.nature?.type ?? item.name),
        layer: item.layer ?? 'surface',
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
         * 「没有代码落点」不等于「缺落点」：驱动量（用户设定）与外部量（如 CMB 温度常数）
         * **本来就不来自某段代码**。给它们挂身份标签，点击即读到这句话，免得被误当缺口。
         * 判据：该节点确实没有任何代码落点（`refs` 里没有 file）——不是按名字猜。
         */
        tags: [
          ...tagsOf(item).tags,
          // 按**性质**摆：落在旁路阶段（S04 旁路与后处理接口）里的量是诊断出口，不在主链上 —— 挂身份标签说明
          ...(isBypassHint(item.codeHints) ? ['tag:旁路出口'] : []),
          ...(hasCodeSite(item) ? [] : [item.kind === 'driver' ? 'tag:输入参数' : 'tag:外部量']),
        ],
        tagDetails: {
          ...tagsOf(item).tagDetails,
          ...(isBypassHint(item.codeHints)
            ? {
                'tag:旁路出口': [
                  {
                    label: item.symbol,
                    kind: '旁路',
                    note: '**旁路**：算完顺手给出的诊断（光度函数、光深等），**不在主链上**——看不看它，后面的结果都一样。子图里是它那几段工程实现。',
                    ref: null,
                  },
                ],
              }
            : {}),
          ...(hasCodeSite(item)
            ? {}
            : item.kind === 'driver'
              ? {
                  'tag:输入参数': [
                    {
                      label: item.symbol,
                      kind: '输入',
                      note: item.note ?? '由用户设定的输入量：不在某段代码里，因此没有代码落点。',
                      ref: null,
                    },
                  ],
                }
              : {
                  'tag:外部量': [
                    { label: item.symbol, kind: '外部', note: item.note ?? '外部给定的量：不来自本仓库的代码。', ref: null },
                  ],
                }),
        },
        refs: [
          /**
           * 论文侧出口：真源里每个量都带 `reviewSection`（论文节号），此前没进图，
           * 于是检查器的「看引用」永远只能开源码、看不了文献。这里把它作为**文档引用**挂上，
           * 指向本链自己的论文清单（`docs/notes/physics-chain/papers.md`，自检查它存在）。
           */
          ...(item.reviewSection
            ? [
                {
                  docId: 'physics-chain/papers.md',
                  anchor: '',
                  label: `论文出处：${item.reviewSection}`,
                  file: '',
                  line: null,
                  endLine: null,
                },
              ]
            : []),
          /**
           * 代码落点 = **`code.sites` 那一条清单本身**（`withSites` 已按 `MAX_SITES` 取好）。
           * 此前这里按每个 hint 各自 `slice(0, 6)`、而 `code.sites` 用的是 `MAX_SITES = 8`——
           * 同一件事两个上限，于是「源码」标签页的条数与属性页上那个数对不上；更要紧的是自检没法从
           * `code.sites` 独立复算这一份（两处数不一致，"对拍"就永远说不清）。2026-10-01 合成一处。
           */
          ...withSites(item.codeHints)
            .sites.filter((site) => Number.isFinite(site.line))
            .map((site) => ({
              docId: '',
              anchor: '',
              label: item.symbol,
              file: site.file,
              line: site.line,
              endLine: site.endLine ?? null,
            })),
        ],
      }))
      const gEdges = chain.edges.map((edge) => {
        const key = `${edge.from}->${edge.to}`
        const gates = [...chain.params.effects].filter((param) => (param.gatesEdges ?? []).includes(key))
        return {
          id: key,
          source: edge.from,
          target: edge.to,
          label: edge.eq ?? '',
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
        // 后两个是「身份标签」：给没有代码落点的量说明它们本来就不来自代码
        ...new Set([...Object.keys(paramMatrix), ...nodes.flatMap((item) => item.codeNames ?? []), '输入参数', '外部量', '旁路出口']),
      ]
        .sort()
        .map((name) => ({ id: `tag:${name}`, name, description: paramMeta.get(name)?.role ?? '' }))
      /** 标签 id → 显示名：块级标签明细要用**同一份名字**（不另起一套命名） */
      const tagNameOf = new Map(tagRegistry.map((tag) => [tag.id, tag.name]))
      /**
       * 坐标：按"从驱动量出发要走多少步"分层，**观测量在上、参数在下**（与页面的自顶向下口径一致）。
       * 目的有二：① 一打开就看得见东西（不依赖画布是否自动排布）；② 排布是确定性的，幂等自检不受影响。
       */
      /**
       * 坐标：**自顶向下的多叉树布局**——从"链条终点的产物"（没有下游的节点）开始，
       * 往下逐层展开"它由什么决定"。层号 = 到终点的步数（终点 0，越往下越大）；
       * 同层内按**父节点的位置取重心**排序，免得同一支的几块被拆散。
       * 这是 v1：交叉不做全局最优，但不重叠、方向正确、且完全确定（幂等自检不受影响）。
       */
      const level = new Map(gNodes.map((node) => [node.id, 0]))
      for (let pass = 0; pass < gNodes.length; pass += 1) {
        let moved = false
        for (const edge of gEdges) {
          const next = (level.get(edge.target) ?? 0) + 1
          if (next > (level.get(edge.source) ?? 0)) {
            level.set(edge.source, next)
            moved = true
          }
        }
        if (!moved) break
      }
      /**
       * **骨干树 + 交叉边**（回答"为什么会出现跨层"）。
       *
       * 分层是按**最长路径**算的：`level(s) = 1 + max{level(t) : s→t}`，于是每条边 `s→t` 的层差恒 ≥1，
       * 且**层差 = 1 当且仅当这条边落在某条最长路径上**。所以"跨层箭头"不是数据错：
       * 依赖本身是 **DAG**（一个量常常有好几个上游），把它硬画成树，就只有落在最长路径上的那条能层差 1，
       * 其余的必然跨层。
       *
       * 解法不是删边（每条边都是真实公式依赖，删掉就是篡改物理），而是**把树和交叉边分开画**：
       *   · **骨干边**：每个量挑**一个**主父（出边里 `level(target)` 最大的那条，即最长路径父，层差恒 = 1）
       *     —— 骨干上每个节点恰好一个父，骨干就是一棵**真正的多叉树**，结构上不可能跨层；
       *   · **交叉边**：其余依赖照留，但按**成因**标出来（判据全取自数据，不新造）：
       *       - `sibling`：层差 1 的第二个父（多父的直接后果，画在骨干旁边）；
       *       - `coarse`：层差 >1 且**存在间接路径**——这条直连依赖同时被更细的链条蕴含（粗粒度/"汇总"边）；
       *       - `bypass`：层差 >1、无间接路径，但目标是 **S04 旁路出口**（诊断量，如 τ_e、φ(M_1500)）
       *         —— 诊断量本来就是输出时直接由上游算出来的，**不在主链上**，跨层是它应有的样子；
       *       - `gap`：层差 >1、无间接路径、也不是旁路 ⇒ **链条上确实缺了中间量**，显式登记（不许静默）。
       * 判据"是不是旁路出口"与节点上 `tag:旁路出口` 同源（`codeHints[0]` 以 `S04` 开头）。
       */
      const rawById = new Map(nodes.map((item) => [item.id, item]))
      const outAdj = new Map(gNodes.map((node) => [node.id, []]))
      for (const edge of gEdges) outAdj.get(edge.source)?.push(edge.target)
      /** 从 `from` 出发能不能走到 `to`（深度优先，节点数十来个，不需要更聪明的做法） */
      const reaches = (from, to) => {
        const seen = new Set([from])
        const queue = [from]
        while (queue.length) {
          const current = queue.shift()
          for (const next of outAdj.get(current) ?? []) {
            if (next === to) return true
            if (seen.has(next)) continue
            seen.add(next)
            queue.push(next)
          }
        }
        return false
      }
      /** 有没有"绕一圈也能到"的更细链条：source 还有别的出边，那些出边能走到 target */
      const hasIndirectPath = (edge) =>
        (outAdj.get(edge.source) ?? []).some((other) => other !== edge.target && reaches(other, edge.target))
      /** 目标是不是旁路/诊断出口（S04 旁路与后处理接口）—— 与节点身份标签同源判据 */
      const isBypassTarget = (edge) => isBypassHint(rawById.get(edge.target)?.codeHints)
      /** 主父：出边里 level 最大的那条（层差恒 = 1）；并列时按 target 名字稳定取一个 */
      const backboneOf = new Map()
      for (const node of gNodes) {
        const outs = gEdges.filter((edge) => edge.source === node.id)
        if (!outs.length) continue
        const best = [...outs].sort((a, b) => (level.get(b.target) ?? 0) - (level.get(a.target) ?? 0) || (a.target < b.target ? -1 : 1))[0]
        best.backbone = true
        best.levelSpan = 1
        backboneOf.set(node.id, best.target)
      }
      const crossLevel = {
        levels: {},
        backbone: [],
        sibling: [],
        coarse: [],
        bypass: [],
        gap: [],
        /** 跨红移回流单列一张名单：它反向、不进主序拓扑（见 design.md D3②） */
        feedback: [],
        stats: {},
      }
      for (const node of gNodes) crossLevel.levels[node.id] = level.get(node.id) ?? 0
      /** 主父表（量 → 它在骨干树上的父）：自检用它验证"每个量恰好一个父" */
      crossLevel.parentOf = Object.fromEntries([...backboneOf.entries()].sort(([a], [b]) => (a < b ? -1 : 1)))
      for (const edge of gEdges) {
        const span = (level.get(edge.source) ?? 0) - (level.get(edge.target) ?? 0)
        edge.levelSpan = edge.levelSpan ?? span
        if (edge.backbone) {
          crossLevel.backbone.push(edge.id)
          continue
        }
        edge.crossLink = true
        if (span === 1) {
          edge.spanKind = 'sibling'
          crossLevel.sibling.push(edge.id)
        } else if (hasIndirectPath(edge)) {
          edge.spanKind = 'coarse'
          crossLevel.coarse.push(edge.id)
        } else if (isBypassTarget(edge)) {
          edge.spanKind = 'bypass'
          crossLevel.bypass.push(edge.id)
        } else {
          edge.spanKind = 'gap'
          crossLevel.gap.push(edge.id)
        }
        /**
         * 跨层这件事要**在图上一眼读得出来**：层差与成因写进边的说明（检查器直接显示这段）。
         * 成因不写成"推测"——`coarse` / `bypass` 都是上面按数据判的。
         */
        const CAUSE = {
          sibling: '同层的第二个上游（多父，不是跨层）',
          coarse: '跨层：这条直连依赖已被更细的链条蕴含（汇总边），不是缺环节',
          bypass: '跨层：目标是旁路/诊断出口（S04），诊断量本来就不在主链上',
          gap: '跨层且无间接路径：链条上缺中间量（待补，见 crossLevel.gap）',
        }
        edge.note = [
          edge.note,
          `第 ${level.get(edge.source) ?? 0} 层 → 第 ${level.get(edge.target) ?? 0} 层（跨 ${span} 层）｜${CAUSE[edge.spanKind]}`,
        ]
          .filter(Boolean)
          .join('；')
      }
      crossLevel.stats = {
        edges: gEdges.length,
        backbone: crossLevel.backbone.length,
        sibling: crossLevel.sibling.length,
        coarse: crossLevel.coarse.length,
        bypass: crossLevel.bypass.length,
        gap: crossLevel.gap.length,
      }
      /** 每条非骨干边都必须有成因（漏标就是静默），写前校验与自检都会再查一遍 */
      for (const edge of gEdges) {
        if (!edge.backbone && !edge.spanKind) throw new Error(`边 ${edge.id} 既不是骨干边，也没有成因分类`)
      }
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
       * **块间接口边**：主图唯一的边（**20 条**：24 条跨块依赖落在 20 对块上）。两端分属不同块的"量 → 量"依赖汇总而来，
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
        const span = (blockOrder.get(item.to) ?? 0) - (blockOrder.get(item.from) ?? 0)
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
           * 位次差按**真源主序位次**算（`order`）：接口边本身就是"汇总边"——它由那几条更细的
           * "量 → 量"依赖汇总而来（`note` 里列着）。相邻的按规矩标 `sibling`（写前校验与自检都查这一条）。
           */
          levelSpan: span,
          spanKind: span === 1 ? 'sibling' : 'coarse',
          crossLink: true,
          note: `块间接口：由这些跨界依赖汇总而来 —— ${item.relations.join('、')}；主序第 ${blockOrder.get(item.from)} 位 → 第 ${blockOrder.get(item.to)} 位（跨 ${span} 位）`,
        }
      })
      /**
       * 接口边也要进 `crossLevel` 的分类名单：写前校验要求"graph.edges 里每条边都在某个名单里"，
       * 不登记就会报"这些边没进 crossLevel 任何名单"。
       */
      for (const edge of interfaceEdges) {
        if (!Number.isInteger(edge.levelSpan) || edge.levelSpan < 1) {
          throw new Error(
            `接口边 ${edge.id} 的位次差是 ${edge.levelSpan}：主序边必须自上而下、跨正位次（真源 order 写反了？反馈边请写进 feedback 段）`,
          )
        }
        ;(edge.spanKind === 'sibling' ? crossLevel.sibling : crossLevel.coarse).push(edge.id)
      }
      crossLevel.stats.interfaceEdges = interfaceEdges.length
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
        const toSymbol = symbolOf.get(item.toNode) ?? item.toNode
        return {
          id: `feedback:${item.from}->${item.to}`,
          source: item.from,
          target: item.to,
          /** 两端的具体量：悬浮时标签写它（如 `T_S → Ṅ_ion`），因为回流落在哪个量上是块级的执行细节 */
          fromNode: item.fromNode,
          toNode: item.toNode,
          label: `${fromSymbol} → ${toSymbol}`,
          type: 'depends_on',
          directed: true,
          optional: false,
          conditional: false,
          surface: true,
          /** 一级常显（不像接口边那样要悬浮）：反馈环是这套图唯一能表达"跨红移"的边，藏起来就没了 */
          focusOnly: false,
          /** 与接口边区分：`feedback` 走独立样式，箭头朝上 */
          kind: 'feedback',
          levelSpan: span,
          spanKind: 'feedback',
          crossLink: true,
          /** 代码出处（自检要求三类跨块关系都带）：文件 + 行号 */
          codeRef: item.codeRef,
          note: `跨红移回流（${item.codeRef}）：${item.note}`,
        }
      })
      for (const edge of feedbackEdges) crossLevel.feedback.push(edge.id)
      crossLevel.stats.feedbackEdges = feedbackEdges.length
      /**
       * 块的主序位次：直接来自真源、**不做拓扑重算**（重算会把反馈边算进去成环，见 design.md D4）；
       * `levels` 是"量"的层号，两者不是一回事，分开放。
       */
      crossLevel.blockOrder = Object.fromEntries([...blockOrder.entries()].sort(([a], [b]) => (a < b ? -1 : 1)))
      const boxLevel = new Map(blockItems.map((item) => [item.id, item.order ?? 0]))
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
      for (const id of boxIds) {
        const lvl = boxLevel.get(id) ?? 0
        boxRows.set(lvl, [...(boxRows.get(lvl) ?? []), id])
      }
      /** 每行中心的 y：行高取该行**最高的框**，行距恒为 `GAP`（框高变了不用改间距） */
      const rowY = new Map()
      let rowsBottom = 0
      for (const lvl of [...boxRows.keys()].sort((a, b) => a - b)) {
        const height = Math.max(...boxRows.get(lvl).map((id) => blockSizeOf(id).height))
        rowY.set(lvl, rowsBottom + height / 2)
        rowsBottom += height + GAP
      }
      const boxCenter = new Map()
      for (const [lvl, ids] of boxRows) {
        // **自顶向下**：层往下走（y），同一位次的块往右排（x）；同排按**各自的宽**依次让开
        const xs = stackCenters(ids.map((id) => blockSizeOf(id)), 'x', 0)
        ids.forEach((id, index) => boxCenter.set(id, { x: xs[index], y: rowY.get(lvl) }))
      }

      const membersOfBox = new Map(boxIds.map((id) => [id, [...(blockMembers.get(id) ?? [])]]))
      for (const [boxId, ids] of membersOfBox) {
        const center = boxCenter.get(boxId)
        const ordered = [...ids].sort((a, b) => (level.get(a) ?? 0) - (level.get(b) ?? 0) || (a < b ? -1 : 1))
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
       * **块内边与连通分量**：可进入判据（成员非空且分量 = 1）与块级数字断言都读它。
       * 块内边**不进主图**，只在这个块的子图里画（`internalEdgesOf` 供视图与自检取用）。
       */
      const internalEdgesOf = new Map(boxIds.map((id) => [id, []]))
      for (const edge of gEdges) {
        const from = blockOfNode.get(edge.source)
        const to = blockOfNode.get(edge.target)
        if (from && from === to) internalEdgesOf.get(from).push(edge)
      }
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
       * **一级 = 12 个块**（10 个过程块 + 2 个层）：块是 `type: 'process'` 的**普通节点**、
       * 不是 `group` 容器——容器之间不许有边（你 2026-09-30 的口径），而块间要画 21 条接口边
       * （见 design.md D1）。反过来说明它必须是普通节点：成员靠 `parent` 指向它，画布
       * "焦点只看直系子节点"那套现成机制于是直接生效——一级天然只剩 12 个块，块内成员不同屏。
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
           * `process` = 一个 Compute* 步（可进入）；`layer` = 非常数/共享内核层（不可进入、不计入过程数）。
           * 判据来自真源声明的 `kind`，旧稿那套"成员连通性推断"（`band`）已退场——它会把 M4 这种
           * 成员分两簇的过程块误判成带。
           */
          blockKind: block.kind ?? 'process',
          order: block.order ?? 0,
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
          parent: null,
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
           *   · 一条**模块笔记**：指向自己的骨架文档（锚点 = 文档 H1 的 slug，即块标签）；
           *   · 层的话再加整文件级的代码落点（`layerFileSites`，见那里的说明）。
           * 块此前是**写死的空数组**——页面于是有一个"点不开"的入口（两类引用都空）。
           */
          refs: [
            ...(block.noteDoc ? [noteRefOf(String(block.noteDoc), String(block.label))] : []),
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
       * **子图层**：模块内部的**步骤**。来源是 atlas 更深一级的单元——
       * 比如 `scaling_relations` 的 hint 是 `S12.1`，那么 `S12.1.1`、`S12.1.2` 这些单元就是它里面的步骤。
       * 步骤节点挂成模块的**子节点**（`parent`），于是双击模块进去（画布现成的聚焦/子图行为）就能看到它们。
       * 只收比 hint 更深一级的单元；没有更深单元的模块**不进子图**（不凭空造步骤）。
       */
      const subgraphNodes = []
      const subgraphIndex = {}
      /** 步骤节点 id 全局唯一：同一个单元只归一个模块（先到先得），避免"一节点两父" */
      const usedStepIds = new Set()
      for (const node of nodes) {
        const hints = (node.codeHints ?? []).map(String)
        if (!hints.length) continue
        const byUnit = new Map()
        for (const hint of hints) {
          /**
           * **只有更细一级的 hint 才收内部步骤**：`S12.1` → `S12.1.1 / S12.1.2` ✓。
           * 阶段级 hint（`S11` 这种不带点的）**不收**：否则会把整个阶段的所有单元都算成这一个量的内部步骤，
           * 还会在两个量之间重复建同名节点（同一个 id 挂两个父节点 = 非法图）。宁缺勿滥。
           */
          if (!hint.includes('.')) continue
          for (const site of byStage.get(hint) ?? []) {
            const unit = String(site.unit ?? '')
            if (!unit || unit === hint || !unit.startsWith(`${hint}.`)) continue
            if (usedStepIds.has(`step:${unit}`)) continue
            byUnit.set(unit, [...(byUnit.get(unit) ?? []), site])
          }
        }
        if (!byUnit.size) continue
        const stepIds = []
        const anchor = gNodes.find((item) => item.id === node.id)?.position ?? { x: 0, y: 0 }
        const stepEntries = [...byUnit.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        /** 步骤之间同样是「实测框宽 + 常数间距」，围绕所属的量居中（第三层标签页取景时字才够大） */
        const stepXs = stackCenters(
          stepEntries.map(([, sites]) => measureBoxSize(sites[0].unitName ?? '')),
          'x',
          anchor.x,
        )
        stepEntries.forEach(([unit, sites], index) => {
          const stepId = `step:${unit}`
          usedStepIds.add(stepId)
          stepIds.push(stepId)
          subgraphNodes.push({
            id: stepId,
            // 标签只写步骤名：`unit`（阶段号）是代码坐标，留在 stepId / refs 的 label 里，不上框
            label: sites[0].unitName ?? '',
            type: 'method',
            summary: sites[0].unitName ?? '',
            layer: 'subgraph',
            parent: node.id,
            observable: false,
            conditional: false,
            // 旁路阶段内部的步骤同样挂旁路话题（进子图看它时与一级口径一致）
            topics: isBypassHint(node.codeHints) ? [BYPASS_TOPIC_ID] : [],
            tags: [],
            tagDetails: {},
            refs: sites
              .filter((site) => Number.isFinite(site.line))
              .slice(0, 4)
              .map((site) => ({
                docId: '',
                anchor: '',
                label: unit,
                file: site.file,
                line: site.line,
                endLine: site.endLine ?? null,
              })),
            position: { x: stepXs[index], y: anchor.y },
          })
        })
        subgraphIndex[node.id] = { steps: stepIds }
      }

      /**
       * **模块笔记承载**（design D3）：一个模块一份骨架文档（真源 `blocks.items[].noteDoc`），
       * 成员、步骤各写自己的小节；锚点 = 小节标题的 slug，而**小节标题就是节点标签本身**。
       * 于是"补写笔记正文"不用改一行页面代码；反过来，谁把标题改坏了，自检打开文档时当场失败。
       * 步骤的归属走真源成员表（`blockOfNode`），与它的父节点同属一个模块。
       */
      const noteDocOfBlock = new Map(blockItems.map((block) => [block.id, String(block.noteDoc ?? '')]))
      for (const [blockId, memberIds] of blockMembers) {
        const docId = noteDocOfBlock.get(blockId) ?? ''
        if (!docId) continue
        for (const memberId of memberIds) {
          const member = gNodes.find((node) => node.id === memberId)
          if (member) member.refs = [...member.refs, noteRefOf(docId, member.label)]
        }
      }
      for (const node of subgraphNodes) {
        const docId = noteDocOfBlock.get(blockOfNode.get(node.parent)) ?? ''
        if (docId) node.refs = [...node.refs, noteRefOf(docId, node.label)]
      }

      /**
       * **引用汇总**（design D2）：
       *   `refs(节点) = 去重排序( 自身引用 ∪ ⋃ refs(直接子节点) )`
       *   `refs(块)   = 去重排序( 块自身引用 ∪ ⋃ refs(它的每个成员) )`
       * 子节点用 `parent` 的反向表算——图上**没有子节点**的就是叶子（实测恰好是 21 个 `step:*`），
       * 不另立"层级"概念。块**不**从 `parent` 取成员：成员归属的唯一来源是真源 `blocks.items[].members`。
       * 记忆化递归（`rolled`）：同一处落点会被父与子同时引用，合并前先按去重键收成一份。
       * **漏一层就会静默少显示**，所以自检要独立重算一遍双向对拍（多一条也失败）。
       */
      const childIdsOf = new Map()
      for (const node of [...gNodes, ...subgraphNodes]) {
        if (!node.parent) continue
        childIdsOf.set(node.parent, [...(childIdsOf.get(node.parent) ?? []), node.id])
      }
      const nodeById = new Map([...gNodes, ...subgraphNodes, ...blockNodes].map((node) => [node.id, node]))
      const rolled = new Map()
      const refsOf = (id) => {
        if (rolled.has(id)) return rolled.get(id)
        const own = nodeById.get(id)?.refs ?? []
        const merged = canonicalRefs([own, ...(childIdsOf.get(id) ?? []).map((childId) => refsOf(childId))])
        rolled.set(id, merged)
        return merged
      }
      for (const node of [...gNodes, ...subgraphNodes]) node.refs = refsOf(node.id)
      for (const block of blockNodes) {
        // 层的成员里有**文件名**（L1 的 16 个公共头文件）：它们不在图上、`rolled` 里没有，按空处理
        block.refs = canonicalRefs([
          block.refs,
          ...(blockMembers.get(block.id) ?? []).map((memberId) => rolled.get(memberId) ?? []),
        ])
      }

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
        nodes: [...gNodes, ...blockNodes, ...subgraphNodes],
        /**
         * 一级（主图）的边 = **20 条块间接口**（`iface:*`）：静息不画，悬浮两端任一块时才显现
         * （`focusOnly` 字段，）。`gEdges` 那 34 条"量 → 量"仍留在数据里：
         * 块内 10 条留给子图画，块间 24 条已**汇总成 20 条**接口边（同一对块合并成一条）。
         * 视图按 `parent` 聚焦，一级只看得到块。
         */
        edges: [...gEdges, ...interfaceEdges, ...feedbackEdges],
        /** 子图索引：模块 id → 它内部的步骤（子节点 id 列表）。视图与自检都读它，不另算 */
        subgraphs: subgraphIndex,
        /**
         * **块（一级的 10 个过程块 + 2 个层）**：一级划分的事实全在这一处，视图与自检都读它、不各自重算。
         *   · `members`：那 28 个物理量（不重不漏，自检逐块核）；层（`kind:'layer'`）的成员是**文件**
         *     （L1 是公共头文件），不算物理量，所以层不参与"28 个对象"的覆盖核对；
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
             * 汇总后的引用（代码 + 笔记）。与块节点上那份是**同一份事实的两个出口**
             * （视图读节点、自检读这里），口径同 `stages` / `tags`：块不自造，全部由成员汇总而来。
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
            /** 文件成员数（层的成员：L1 的公共头文件） */
            fileMembers: blockNodes.reduce((sum, node) => sum + (node.memberCount - node.quantityMemberCount), 0),
            interfaceEdges: interfaceEdges.length,
          },
        },
        /**
         * 骨干树 + 交叉边的分类（视图与自检都读它）：`levels` 是层号，`parentOf` 是主父表，
         * 后面五个名单把每条非骨干边按成因归位 —— 「为什么会出现跨层」在数据里就有答案。
         */
        crossLevel,
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
  say(`  代码落点 ${artifact.stats.codeSites} 处（按函数体定位的单元 ${siteStats.located}，整文件 ${siteStats.fileWide}，未定位 ${siteStats.missed.length}）`)
  const cross = artifact.graph.crossLevel
  say(
    `  骨干树 ${cross.stats.backbone} 条（层差恒 1，每个量恰一个父）· 交叉边 ${cross.stats.sibling + cross.stats.coarse + cross.stats.bypass + cross.stats.gap} 条` +
      `（同级多父 ${cross.stats.sibling} / 更细链条已蕴含 ${cross.stats.coarse} / 旁路诊断 ${cross.stats.bypass} / 缺中间量 ${cross.stats.gap}）`,
  )
  if (cross.stats.gap) say(`  ⚠ 缺中间量的跨层边（待补，不许静默）：${cross.gap.join('、')}`)
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
    return
  }
  if (before) await fs.writeFile(`${OUT_FILE}.bak`, before, 'utf8')
  await fs.writeFile(`${OUT_FILE}.tmp`, payload, 'utf8')
  await fs.rename(`${OUT_FILE}.tmp`, OUT_FILE)
  console.log(`  已写入 ${path.relative(path.join(HERE, '..'), OUT_FILE)}${before ? '（旧版留在 .bak）' : ''}`)
}

await main()
