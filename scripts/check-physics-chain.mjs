/**
 * 物理链自检（`npm run check:chain`）。检查的事：
 *
 *   1. 真源 `docs/notes/physics-chain/chain.json` 合法：每个节点都有 Eq 编号与数学性质；
 *      每条边两端都存在、且带 Eq 出处（出处记在数据里、不上图——箭头上的文字只写跨块交付的那个量名，
 *      量 → 量的边不写字，见下面的「箭头上的文字」一节）；
 *      简并条目成对出现；
 *   2. 生成物存在、有内容哈希戳记，且**节点/边与真源逐条对应**（生成器不许自作主张增删）；
 *   3. 真源与源码一致：参数默认值/范围与 `wrapper/inputs.py` 相同（生成器已拦一道，这里再核一遍）；
 *   4. **命名政策**：节点的符号用 P&L 写法（真源说了算）；代码名只能出现在附注字段里；
 *   5. 代码落点可核对：文件存在、行区间合法、区间不倒置；
 *   6. 幂等：重跑生成脚本与磁盘产物逐字一致；
 *   7. **呈现面**：界面出口（标签 / 散文 / 引用落点 / 命中说明 / 模块文档标题）不含内部编号，
 *      而编号仍留在数据里（`stage` / `stages`）；
 *   8. 边界：工程图谱 `data/graph.json` 仍在、本链从不写它；本链唯一的写通道是**手动摆放**
 *      （`data/chain-layout.json`），也只写它——不归档历史、不碰生成物。
 *
 * 用法：`npm run check:chain`（失败退出码 1）
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'
import katex from 'katex'
import { REPO_ROOT } from './lib/atlasDocs.mjs'
import { parseInputStructs } from './lib/pyInputs.mjs'
/**
 * 话题与阶段号的判据在这里**独立重算**（不 import 生成器的常量、也不信产物里的标注）：
 * 「按代码阶段分层」已退场，阶段号只剩"节点属性 + 旁路话题"两个用途，判据短到可以就地复写一遍——
 * 生成器那份被改动了，这里的断言要能独立发现（比如把旁路阶段的量误挂成主链）。
 */
const IMPL_TOPIC_ID = 'topic:impl'
const BYPASS_TOPIC_ID = 'topic:bypass'
/** 旁路 / 诊断出口的代码阶段（真源 `chain.json` 里那批量的 `codeHints` 写着 `S04.x`） */
const BYPASS_STAGE = 'S04'
const stageOfHint = (hints) => String((Array.isArray(hints) ? hints[0] : hints) ?? '').split('.')[0]
const isBypassHint = (hints) => stageOfHint(hints) === BYPASS_STAGE

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT_FILE = path.join(HERE, '..', 'src', 'generated', 'physics-chain.json')
const CHAIN_SOURCE = path.join(REPO_ROOT, 'docs', 'notes', 'physics-chain', 'chain.json')
const PAPER_INDEX = path.join(REPO_ROOT, 'docs', 'notes', 'physics-chain', 'papers.md')
const INPUTS_FILE = path.join(REPO_ROOT, 'src', 'py21cmfast', 'wrapper', 'inputs.py')
const DATA_GRAPH = path.join(HERE, '..', 'data', 'graph.json')
/**
 * 笔记引用的落点锚点：模块文档里「论文出处」那一节的标题。引用期望值按它算 slug，
 * 到盘上那份手写 md 里定位——字面量留在模块级，与生成器同一份口径。
 */
const REFERENCE_SECTION = '论文出处'
/** C 源码目录（代码锚里的文件名都在这里查） */
const SRC_DIR = path.join(REPO_ROOT, 'src', 'py21cmfast', 'src')
/** 按文件名在 C 源码目录里找文件（层锚只写文件名、不写路径）；找不到返回 null */
const findSourceFile = async (name) => fs.stat(path.join(SRC_DIR, name)).then(() => path.join(SRC_DIR, name)).catch(() => null)
/**
 * 落点不限条数、不限跨度（口径与生成器同一处，2026-10-04 废除旧上限）：
 * 旧口径「单条不超过 60 行」「每个成员至多两条」「不许整文件」把模块文档的工程节压成一句话，
 * 现在一条落点可以是整个函数体甚至整份文件，成员有几条核定落点就进几条。
 */
/**
 * 步骤说明的最短字数：`stepSites[].note` 要能把这一步在算什么讲清楚，
 * 三五字的"算温度"这类占位说明按失败处理（长度与句尾标点一起判）。
 */
const NOTE_MIN = 20

/**
 * 把 TS 模块就地打包到 `data/`（已被 git 忽略）再按 ESM 导入——`data:` URL 解析不了裸模块名。
 * 用来**真跑**视图的纯函数（可见集 / 灰显上下文），而不是只查源码字符串（做法同 `check-tabs.mjs`）。
 */
async function loadTs(entry, name) {
  const outfile = path.join(HERE, '..', 'data', `.check-chain-${name}.mjs`)
  await esbuild.build({
    entryPoints: [path.join(HERE, '..', entry)],
    bundle: true,
    format: 'esm',
    outfile,
    platform: 'node',
    logLevel: 'silent',
  })
  return import(`file://${outfile}`)
}

const failures = []
let checks = 0

function ok(condition, label, detail = '') {
  checks += 1
  if (condition) {
    console.log(`  ✓ ${label}`)
    return true
  }
  const line = `${label}${detail ? ` — ${detail}` : ''}`
  failures.push(line)
  console.log(`  ✗ ${line}`)
  return false
}

async function main() {
  console.log('物理链 · 自检')

  console.log('\n[真源：链条完整]')
  const chainRaw = await fs.readFile(CHAIN_SOURCE, 'utf8').catch(() => null)
  ok(Boolean(chainRaw), '真源存在（docs/notes/physics-chain/chain.json）')
  if (!chainRaw) return
  const chain = JSON.parse(chainRaw)
  const ids = new Set([...chain.drivers.map((item) => item.id), ...chain.nodes.map((item) => item.id)])
  ok(chain.drivers.length >= 4, '驱动量在册（≥4）', String(chain.drivers.length))
  ok(chain.nodes.length >= 10, '物理量在册（≥10）', String(chain.nodes.length))
  /**
   * 出处口径（本变更新改）：**要么是论文等式（`eq`），要么是代码锚（`codeRef`）**。
   * 按代码模块切块后，有 4 个盒子产物在 Pritchard & Loeb 2012 里根本没有对应等式
   * （`CosmoTables` / `InitialConditions` / `PerturbedField` / `XraySourceBox`），
   * 硬编一个 Eq 号就是伪造出处，所以允许写代码出处。
   */
  const hasOrigin = (item) => Boolean(String(item.eq ?? '').trim() || String(item.codeRef ?? '').trim())
  const noEq = chain.nodes.filter((node) => !hasOrigin(node)).map((node) => node.id)
  ok(noEq.length === 0, '每个物理量都有出处（论文 Eq 编号 或 代码锚 codeRef，至少一条）', noEq.join(','))
  const noNature = chain.nodes.filter((node) => !String(node.nature?.type ?? '').trim()).map((node) => node.id)
  ok(noNature.length === 0, '每个物理量都有数学性质', noNature.join(','))
  const badEdges = chain.edges.filter((edge) => !ids.has(edge.from) || !ids.has(edge.to) || !hasOrigin(edge))
  ok(badEdges.length === 0, '每条边两端存在且带出处（Eq 或代码锚）', badEdges.slice(0, 3).map((edge) => `${edge.from}->${edge.to}`).join(','))
  ok(chain.degeneracies.length >= 1, '至少记录了 1 处参数简并', String(chain.degeneracies.length))
  const danglingDeps = [...new Set(chain.nodes.flatMap((node) => node.dependsOn).filter((dep) => !ids.has(dep)))]
  ok(danglingDeps.length === 0, '依赖里没有未定义的量', danglingDeps.join(','))
  /**
   * **跨红移回流单列一段（`feedback`）**：它**不能混进 `edges`**——`edges` 是主序 DAG（一个红移内的
   * 调用顺序），而回流是下游指回上游、天然为负位次，混进去会成环。所以真源里它必须单独成段，
   * 且每条都要有：①两端块存在；②两端量存在；③代码出处（哪一行实现的回流）。
   */
  const feedbackItems = chain.feedback ?? []
  ok(feedbackItems.length >= 1, '跨红移回流在册（独立于 edges 的 feedback 段）', String(feedbackItems.length))
  const blockIdsInSource = new Set((chain.blocks?.items ?? []).map((item) => item.id))
  const badFeedback = feedbackItems.filter(
    (item) =>
      !blockIdsInSource.has(item.from) ||
      !blockIdsInSource.has(item.to) ||
      !ids.has(item.fromNode) ||
      !ids.has(item.toNode) ||
      !String(item.codeRef ?? '').trim(),
  )
  ok(badFeedback.length === 0, '每条回流的两端块/量存在且带代码出处', badFeedback.map((item) => `${item.fromNode}->${item.toNode}`).join(','))

  console.log('\n[真源：命名政策（物理量用 P&L 写法）]')
  // 政策：图上的符号取自真源（P&L 口径）；代码名只允许出现在 codeNames / params 的 name 字段
  const symbolLooksLikeCode = chain.nodes
    .filter((node) => /^[A-Z][A-Z0-9_]{3,}$/.test(node.symbol ?? ''))
    .map((node) => `${node.id}=${node.symbol}`)
  ok(symbolLooksLikeCode.length === 0, '节点符号不是代码常量名（大写蛇形）', symbolLooksLikeCode.join(','))
  const paramsSource = chain.params ?? {}
  const declaredGroups = Object.keys(paramsSource).filter((key) => Array.isArray(paramsSource[key]))
  ok(
    declaredGroups.length > 0,
    '参数分组在册（组名由真源声明，生成器与自检都不写死）',
    declaredGroups.map((name) => `${name} ${paramsSource[name].length}`).join(' / '),
  )
  const switchesNoPaper = (paramsSource.effects ?? []).filter((item) => item.switch && !String(item.paper ?? '').trim())
  console.log(`  · 效应开关 ${paramsSource.effects?.length ?? 0} 个；其中 ${switchesNoPaper.length} 个暂时没有来源论文（留空，不编）`)

  // 开关画在箭头上：它门控的每条边都必须真实存在（键 = `from->to`），否则图上那条虚线无处可挂
  const edgeKeys = new Set(chain.edges.map((edge) => `${edge.from}->${edge.to}`))
  const badGates = (paramsSource.effects ?? []).flatMap((item) =>
    (item.gatesEdges ?? []).filter((key) => !edgeKeys.has(key)).map((key) => `${item.name}→${key}`),
  )
  ok(badGates.length === 0, '每个效应开关门控的箭头都真实存在（虚线挂在哪条边上）', badGates.slice(0, 3).join(', '))
  const gated = (paramsSource.effects ?? []).reduce((sum, item) => sum + (item.gatesEdges?.length ?? 0), 0)
  console.log(`  · 门控关系 ${gated} 条（开关画在哪条箭头上）`)

  console.log('\n[生成物：与真源逐条对应]')
  const raw = await fs.readFile(OUT_FILE, 'utf8').catch(() => null)
  ok(Boolean(raw), `产物存在（${path.relative(path.join(HERE, '..'), OUT_FILE)}）`)
  if (!raw) return
  const artifact = JSON.parse(raw)
  ok(/^generated-[0-9a-f]{12}$/.test(artifact.stamp ?? ''), '有内容哈希戳记', artifact.stamp)
  ok(artifact.nodes.length === chain.nodes.length, '物理量条数 = 真源', `${artifact.nodes.length} vs ${chain.nodes.length}`)
  ok(artifact.edges.length === chain.edges.length, '依赖边条数 = 真源', `${artifact.edges.length} vs ${chain.edges.length}`)
  const formulaMismatch = artifact.nodes
    .filter((node) => node.formula !== chain.nodes.find((item) => item.id === node.id)?.formula)
    .map((node) => node.id)
  ok(formulaMismatch.length === 0, '每条公式逐字等于真源（生成器不许改写）', formulaMismatch.join(','))

  /**
   * **摘要位置的公式**：生成物给**带公式的对象**（真源 `docText[id].formula` 非空者：34 个节点 + 4 个驱动量）
   * 逐字带上那份 LaTeX（表面节点上的 `formula` 字段）；块、大框、层里的文件成员 MUST NOT 带。
   * 判据落在**数据**上（有没有这个字段），检查器只按它分流，不按节点种类另写名单。
   *
   * 四条：逐字相同、该带的都带了、产物里 `formula` 不再出现在别处、每条都渲染得出来
   * （`throwOnError: true` 严格试渲染一遍——坏公式在这里判失败，而不是在页面上变红字）。
   */
  console.log('\n[摘要位置的公式：逐字来自真源、渲染得出来]')
  const docText = chain.docText ?? {}
  /** 真源侧的应带名单：`formula` 非空的对象（驱动量与节点同一条路径） */
  const wantFormula = new Set(
    [...chain.drivers, ...chain.nodes].map((item) => item.id).filter((id) => String(docText[id]?.formula ?? '').trim()),
  )
  const formulaNodes = artifact.graph?.nodes ?? []
  const withFormula = formulaNodes.filter((node) => node.formula)
  ok(
    withFormula.every((node) => node.formula === docText[node.id]?.formula),
    `摘要位置带的公式逐字等于真源 \`docText\`（${withFormula.length} 个对象）`,
    withFormula.filter((node) => node.formula !== docText[node.id]?.formula).map((node) => node.id).join(','),
  )
  const missingFormula = [...wantFormula].filter((id) => !withFormula.some((node) => node.id === id))
  ok(
    missingFormula.length === 0,
    '该带公式的对象都带了（真源里有公式的每一个）',
    missingFormula.join(','),
  )
  /** 产物里**别处**不许再出现 `formula`：块 / 大框 / 层成员都不带（含层成员明细那种非节点条目） */
  const strayFormula = []
  const walkFormula = (value, at) => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) {
      value.forEach((item, index) => walkFormula(item, `${at}[${index}]`))
      return
    }
    if ('formula' in value && !wantFormula.has(String(value.id ?? ''))) strayFormula.push(`${at}${value.id ? `（${value.id}）` : ''}`)
    for (const [key, child] of Object.entries(value)) if (key !== 'formula') walkFormula(child, `${at}.${key}`)
  }
  walkFormula(artifact.graph, 'graph')
  ok(
    strayFormula.length === 0,
    '产物里 `formula` 只出现在带公式的对象身上（块 / 大框 / 层里的文件成员都不带）',
    strayFormula.slice(0, 3).join(' | '),
  )
  const badLatex = []
  for (const node of withFormula) {
    try {
      katex.renderToString(node.formula, { displayMode: true, throwOnError: true, strict: 'ignore' })
    } catch (error) {
      badLatex.push(`${node.id}：${String(error?.message ?? error).slice(0, 60)}`)
    }
  }
  ok(badLatex.length === 0, '每条公式都渲染得出来（严格模式试渲染一遍）', badLatex.slice(0, 3).join(' | '))

  console.log('\n[参数：真源与源码一致]')
  const inputs = parseInputStructs(await fs.readFile(INPUTS_FILE, 'utf8'))
  const mismatched = []
  for (const group of Object.keys(artifact.params ?? {})) {
    for (const param of artifact.params[group] ?? []) {
      const source = inputs.get(param.name)
      if (!source) {
        if (param.inCode !== false) mismatched.push(`${param.name}：源码里没有，但产物标成 inCode`)
        continue
      }
      if (JSON.stringify(param.default) !== JSON.stringify(source.default)) mismatched.push(`${param.name}：默认值 ${JSON.stringify(param.default)} ≠ 源码 ${JSON.stringify(source.default)}`)
      if (JSON.stringify(param.range) !== JSON.stringify(source.range)) mismatched.push(`${param.name}：范围不一致`)
    }
  }
  ok(mismatched.length === 0, '每个参数的默认值与范围都与 inputs.py 相同', mismatched.slice(0, 3).join(' | '))

  console.log('\n[代码落点：可核对]')
  const sites = [...artifact.drivers, ...artifact.nodes].flatMap((item) => item.code.sites.map((site) => ({ ...site, owner: item.id })))
  ok(sites.length > 0, '至少给出 1 处落点', String(sites.length))
  const fileCache = new Map()
  const badSites = []
  for (const site of sites) {
    if (!site.file || !site.line) {
      badSites.push(`${site.owner}：缺 file/line`)
      continue
    }
    if (site.endLine && site.endLine < site.line) badSites.push(`${site.owner}：区间倒置 ${site.file}`)
    if (!fileCache.has(site.file)) fileCache.set(site.file, await fs.readFile(path.join(REPO_ROOT, site.file), 'utf8').catch(() => null))
    const text = fileCache.get(site.file)
    if (!text) badSites.push(`${site.owner}：文件不存在 ${site.file}`)
    else if (text.split('\n').length < (site.endLine || site.line)) badSites.push(`${site.owner}：行号越界 ${site.file}:${site.endLine || site.line}`)
  }
  ok(badSites.length === 0, '每个落点的文件与行区间真实合法', badSites.slice(0, 3).join(' | '))

  console.log('\n[代码落点：区间可核]')
  /**
   * 落点的**出处是真源 `codeSites`**（`[{file, symbol, line, endLine, needles}]`），不是 atlas 的「承担者」——
   * 后者是整文件级的说法（`tgamma` 就落在 `Constants.c` 一整个文件上）。这里**独立复算**，不信产物的标注：
   * 逐条读源码，要求区间落在文件里，且 `needles` 里的标识**逐个**都能在该区间里找到——
   * `needles` 就是"这段代码就是它算的"的可证伪依据。区间不限跨度：整个函数体、甚至整份文件都合法。
   */
  const siteText = async (file) => {
    if (!fileCache.has(file)) fileCache.set(file, await fs.readFile(path.join(REPO_ROOT, file), 'utf8').catch(() => null))
    return fileCache.get(file)
  }
  const driverIds = new Set(chain.drivers.map((item) => item.id))
  const members = chain.nodes.filter((node) => !driverIds.has(node.id))
  const noSites = members.filter((node) => !(node.codeSites ?? []).length).map((node) => node.id)
  ok(noSites.length === 0, `每个非驱动量成员都有落点（成员 ${members.length} 个）`, noSites.join(','))
  const siteProblems = []
  let longestSite = { span: 0, at: '（无）' }
  const siteSpan = (site) => (Number.isFinite(site.endLine) ? site.endLine - site.line + 1 : 1)
  for (const node of members) {
    for (const site of node.codeSites ?? []) {
      const at = `${node.id} [${site.file}:${site.line}-${site.endLine}]`
      if (!Number.isFinite(site.line) || !Number.isFinite(site.endLine) || site.line < 1 || site.endLine < site.line) {
        siteProblems.push(`${at} 行区间非法`)
        continue
      }
      const text = await siteText(site.file)
      if (!text) {
        siteProblems.push(`${at} 文件不存在`)
        continue
      }
      const lines = text.split('\n')
      if (site.endLine > lines.length) {
        siteProblems.push(`${at} 行号越界（${site.file} 共 ${lines.length} 行）`)
        continue
      }
      const body = lines.slice(site.line - 1, site.endLine).join('\n')
      const needles = (site.needles ?? []).map(String)
      const missed = needles.filter((needle) => !body.includes(needle))
      if (!needles.length) siteProblems.push(`${at} 没有 needles（区间是不是核心行无从复核）`)
      else if (missed.length) siteProblems.push(`${at} 区间内没有 ${missed.join(',')}`)
      if (siteSpan(site) > longestSite.span) longestSite = { span: siteSpan(site), at }
    }
  }
  ok(
    siteProblems.length === 0,
    '每条落点都可核（区间合法、needles 逐个命中）',
    siteProblems.slice(0, 4).join(' | '),
  )
  /**
   * 产物侧对拍：成员落点必须**逐条等于真源**（atlas 回落不许覆盖真源核定），真源几条就比几条——
   * 不按上限截断（旧上限已废除）。
   */
  const memberProducts = [...artifact.drivers, ...artifact.nodes].filter((item) => !driverIds.has(item.id))
  const siteMismatch = []
  for (const item of memberProducts) {
    const declared = (chain.nodes.find((node) => node.id === item.id)?.codeSites ?? [])
      .map((site) => `${site.file}:${site.line}:${site.endLine}`)
      .sort()
      .join('|')
    const got = (item.code.sites ?? []).map((site) => `${site.file}:${site.line}:${site.endLine ?? ''}`).sort().join('|')
    if (declared !== got) siteMismatch.push(item.id)
  }
  ok(siteMismatch.length === 0, '产物里成员落点逐条等于真源', siteMismatch.join(','))
  const memberSiteList = memberProducts.flatMap((item) => item.code.sites ?? [])
  console.log(
    `  · 成员落点 ${memberSiteList.length} 条（真源核定 ${memberSiteList.filter((site) => site.source === 'chain').length} 条）；` +
      `最长一条 ${longestSite.span} 行：${longestSite.at}`,
  )

  console.log('\n[算法锚点：要么写实，要么显式列为待补]')
  const anchors = artifact.algorithms?.byId ?? {}
  const ANCHOR_FIELDS = ['how', 'when', 'discretization', 'where']
  const incomplete = Object.entries(anchors)
    .filter(([, value]) => ANCHOR_FIELDS.some((field) => !String(value?.[field] ?? '').trim()))
    .map(([id]) => id)
  ok(incomplete.length === 0, '已写锚点的条目四项齐全（怎么算 / 多久一次 / 受哪些离散化参数 / 落在哪）', incomplete.join(','))
  const pending = new Set([...(artifact.algorithmPending?.nodes ?? []), ...(artifact.algorithmPending?.drivers ?? [])])
  const allQuantities = [...artifact.drivers, ...artifact.nodes].map((item) => item.id)
  const silent = allQuantities.filter((id) => !anchors[id] && !pending.has(id))
  ok(silent.length === 0, '没有静默留空的量（要么写实，要么显式列进待补）', silent.slice(0, 6).join(','))
  const edgesAllPending = String(artifact.algorithmPending?.edges ?? '') === 'all'
  const anchoredEdges = Object.keys(anchors).filter((id) => !allQuantities.includes(id))
  ok(anchoredEdges.length > 0 || edgesAllPending, '边的锚点：要么写了，要么显式声明全部待补', artifact.algorithmPending?.edges)
  console.log(
    `  · 已写锚点 ${Object.keys(anchors).length} 条（其中边 ${anchoredEdges.length} 条）；显式待补 ${pending.size} 个量` +
      `；边的待补声明 = ${artifact.algorithmPending?.edges ?? '（无）'}（共 ${allQuantities.length} 个量、${artifact.edges.length} 条边）`,
  )

  console.log('\n[参数 × 节点 矩阵：后端查表]')
  const matrix = artifact.paramMatrix ?? {}
  const declaredNames = Object.values(artifact.params ?? {}).flat().map((param) => param.name)
  const noHit = declaredNames.filter((name) => !matrix[name])
  ok(Object.keys(matrix).length > 0, '矩阵非空（视图靠它把参数高亮到模块）', String(Object.keys(matrix).length))
  console.log(`  · 有归属的参数 ${Object.keys(matrix).length} / ${declaredNames.length} 个`)
  if (noHit.length) console.log(`  · 没有归属的（如实列出，不静默）：${noHit.join(' / ')}`)

  /**
   * 只门控边的开关（矩阵里只有 `edges`、没有 `nodes`）：它在代码里没有读点，改的是**走哪一支**，
   * 所以去处就是那条边的两端。两端必须都落在图上的量上——否则左栏写不出"为真时改走哪几个量那一支"，
   * 也点不过去（只能停在"作用于 0 个量"）。
   */
  const chainNodeIds = new Set([...(artifact.drivers ?? []), ...(artifact.nodes ?? [])].map((item) => item.id))
  const gateOnly = Object.entries(matrix).filter(([, row]) => !(row?.nodes ?? []).length && (row?.edges ?? []).length)
  const gateEndsMissing = gateOnly.flatMap(([name, row]) =>
    row.edges.flatMap((key) => key.split('->')).filter((id) => !chainNodeIds.has(id)).map((id) => `${name}→${id}`),
  )
  ok(
    gateEndsMissing.length === 0,
    '只门控边的开关，边两端都落在图上的量上（左栏就写在这两端）',
    gateEndsMissing.slice(0, 3).join(','),
  )
  console.log(
    gateOnly.length
      ? `  · 只门控边的开关 ${gateOnly.length} 个：${gateOnly.map(([name, row]) => `${name}（${row.edges.join('、')}）`).join('；')}`
      : '  · 没有只门控边的开关（每个参数都有直接落点）',
  )

  console.log('\n[图的形状：与画布一致（否则画布会在 cloneGraph 里崩）]')
  const canvasGraph = artifact.graph
  ok(Boolean(canvasGraph), '存在与画布同形状的图段 graph')
  const metaRequired = ['version', 'name', 'description', 'topics', 'tags']
  const missingMeta = metaRequired.filter((field) => canvasGraph?.meta?.[field] === undefined)
  ok(missingMeta.length === 0, '图元数据字段齐全（version/name/description/topics/tags）', missingMeta.join(','))
  const badTagDetail = (canvasGraph?.nodes ?? []).filter((node) =>
    Object.values(node.tagDetails ?? {}).some((value) => !Array.isArray(value)),
  )
  ok(badTagDetail.length === 0, 'tagDetails 的值是条目数组（TagDetailMap 形状）', badTagDetail.slice(0, 3).map((node) => node.id).join(','))
  const tagIds = new Set((canvasGraph?.meta?.tags ?? []).map((tag) => tag.id))
  const orphanTags = [...new Set((canvasGraph?.nodes ?? []).flatMap((node) => node.tags ?? []))].filter((id) => !tagIds.has(id))
  ok(orphanTags.length === 0, '节点引用的标签都在注册表里', orphanTags.slice(0, 3).join(','))
  const looseArrays = [...(canvasGraph?.nodes ?? []), ...(canvasGraph?.edges ?? [])].filter((item) => !Array.isArray(item.topics ?? []))
  ok(looseArrays.length === 0, '节点与连线的话题字段都是数组', looseArrays.slice(0, 3).map((item) => item.id).join(','))
  const implNodes = (canvasGraph?.nodes ?? []).filter((node) => (node.topics ?? []).includes('topic:impl'))
  ok(implNodes.length > 0, '工程节点挂在「实现细节」话题上（默认收起才有东西可收）', String(implNodes.length))
  ok(
    (canvasGraph?.meta?.topics ?? []).some((topic) => topic.id === 'topic:impl'),
    '「实现细节」话题在注册表里（否则关闭它没有意义）',
  )

  console.log('\n[阶段号：已降级为量的属性，属性页可查]')
  /**
   * 块本身也是节点（`type: 'process'`），但阶段号是**量**的属性：块只带成员并集 `stages`。
   * 容器**只有块**——函数那一级不上图（design.md D1）之后，`step:*` 那种第二类容器已不存在。
   */
  const containerNodeIds = new Set((canvasGraph?.blocks?.items ?? []).map((item) => item.id))
  const isContainerNode = (node) => containerNodeIds.has(node.id)
  /**
   * **段容器是装饰**（`type: 'group'`）：阶段号是**量**的属性，容器既不挂它、也不算"缺它"。
   * 这条与生成器的写前校验是同一处判断（两处一起放行，见 design D8）。
   */
  const isDecorationNode = (node) => node.type === 'group'
  const sourceHints = new Map([...chain.drivers, ...chain.nodes].map((item) => [item.id, (item.codeHints ?? []).map(String)]))
  const surfaceNodes = (canvasGraph?.nodes ?? []).filter((node) => !isContainerNode(node) && !isDecorationNode(node))
  const noStage = surfaceNodes.filter((node) => typeof node.stage !== 'string')
  ok(noStage.length === 0, '每个量都带 `stage` 属性（阶段号降级为属性，属性页才查得到）', noStage.slice(0, 5).map((node) => node.id).join(','))
  const containerWithStage = (canvasGraph?.nodes ?? []).filter((node) => isContainerNode(node) && node.stage !== undefined)
  ok(containerWithStage.length === 0, '块本身不挂 `stage`（块的阶段号是成员并集，放 `stages`）', containerWithStage.map((node) => node.id).join(','))
  const wrongStage = surfaceNodes.filter((node) => node.stage !== stageOfHint(sourceHints.get(node.id) ?? []))
  ok(wrongStage.length === 0, '`stage` 与真源 `codeHints` 逐条对得上（没有手改或漏抄）', wrongStage.slice(0, 5).map((node) => node.id).join(','))
  const stageCount = new Set(surfaceNodes.map((node) => node.stage).filter(Boolean))
  ok(stageCount.size >= 5, '真源里至少出现 5 个代码阶段（S07 起才是物理）', [...stageCount].sort().join(','))
  console.log(
    `  · 量的阶段号分布：${[...stageCount]
      .sort()
      .map((stage) => `${stage}(${surfaceNodes.filter((node) => node.stage === stage).length})`)
      .join(' ')}；没有阶段的（驱动量 / 外部量）${surfaceNodes.filter((node) => !node.stage).length} 个`,
  )

  console.log('\n[图的内容：每个量都有出处（代码 + 文献）]')
  const docRefs = (canvasGraph?.nodes ?? []).filter((node) => (node.refs ?? []).some((ref) => ref.docId))
  ok(docRefs.length > 0, '有文档/论文引用的量（检查器的「看引用」能打开文献）', String(docRefs.length))
  const docIds = [...new Set((canvasGraph?.nodes ?? []).flatMap((node) => (node.refs ?? []).map((ref) => ref.docId)).filter(Boolean))]
  const repoRoot = new URL('../../', import.meta.url).pathname
  const missingDocs = []
  for (const docId of docIds) {
    const found = await fs
      .access(`${repoRoot}docs/notes/${docId}`)
      .then(() => true)
      .catch(() => false)
    if (!found) missingDocs.push(docId)
  }
  ok(missingDocs.length === 0, '文档引用指向的文件真实存在', missingDocs.join(','))
  // 这条只**报告**不判定：现在还有量只有"待补"、没有代码落点，如实显示，不假装完整
  const noCodeRef = (canvasGraph?.nodes ?? []).filter(
    (node) => node.type !== 'group' && !String(node.id).startsWith('block:') && !(node.refs ?? []).some((ref) => ref.file),
  )
  console.log(`  · 还没有代码落点的量：${noCodeRef.length} 个（${noCodeRef.map((node) => node.id).join(',') || '无'}）`)

  console.log('\n[输入量身份：没有代码落点这件事，图上要读得出来]')
  /**
   * 范围：**量**（驱动量 / 物理量）。函数那一级不上图（design.md D1）之后这里只剩一种对象，
   * 判据仍排除块与段容器——它们装在段的成员关系里，本身不是"量"。
   */
  const noCode = (canvasGraph?.nodes ?? []).filter(
    (node) =>
      node.type !== 'group' &&
      !String(node.id).startsWith('block:') &&
      !(node.refs ?? []).some((ref) => ref.file),
  )
  /**
   * 身份由**节点自己**说：没有代码落点的量必须是驱动量（`type: driver`，用户设定的输入）。
   * 从前靠「输入参数 / 外部量」两个身份标签来说——它们与参数名混在同一个注册表里，现在撤掉；
   * 旁路那批量改由 `topic:bypass` 说（同一件事一处实现）。
   */
  const notDriver = noCode.filter((node) => node.type !== 'driver')
  ok(
    notDriver.length === 0,
    '没有代码落点的量都是驱动量（`type: driver`，不另挂身份标签）',
    notDriver.map((node) => node.id).join(','),
  )
  /**
   * atlas 找不到函数体的计算单元（真源 `stats.pendingUnits`）：它们不再有节点，但"没有落点"这件事
   * 仍要在门禁输出里看得见——生成日志与这里两处都印出来，不许静默。
   */
  const pendingUnits = (artifact.stats.pendingUnits ?? []).map((item) => String(item.unit))
  console.log(
    `  · 图上没有函数节点；atlas 找不到函数体、待核定核心行的单元 ${pendingUnits.length} 个` +
      `${pendingUnits.length ? `（${pendingUnits.join('、')}）` : ''}`,
  )
  const registryIds = new Set((canvasGraph?.meta?.tags ?? []).map((tag) => tag.id))
  /** 撤掉的身份标签不许回到注册表：那里只装参数名（一个参数一个标签） */
  const identityTags = ['tag:输入参数', 'tag:外部量', 'tag:旁路出口']
  const backIn = identityTags.filter((tag) => registryIds.has(tag))
  ok(backIn.length === 0, '标签注册表里只有参数名（「输入参数 / 外部量 / 旁路出口」不再作标签）', backIn.join(','))
  console.log(`  · 没有代码落点的量 ${noCode.length} 个：${noCode.map((node) => node.id).join(',') || '无'}`)

  console.log('\n[宇宙学参数：单独一组，且能落到图上]')
  const cosmoNames = (artifact.params?.cosmo ?? []).map((item) => item.name)
  ok(cosmoNames.length > 0, '宇宙学参数单列一组（与天体物理分开）', String(cosmoNames.length))
  const cosmoMapped = cosmoNames.filter((name) => name in (artifact.paramMatrix ?? {}))
  ok(cosmoMapped.length > 0, '其中至少有一部分能落到图上的量（有映射才点得亮）', `${cosmoMapped.length}/${cosmoNames.length}`)
  const registryForCosmo = new Set((canvasGraph?.meta?.tags ?? []).map((tag) => tag.id))
  const cosmoUnregistered = cosmoMapped.filter((name) => !registryForCosmo.has(`tag:${name}`))
  ok(cosmoUnregistered.length === 0, '有映射的宇宙学参数都在标签注册表里', cosmoUnregistered.join(','))
  console.log(`  · 宇宙学参数 ${cosmoNames.length} 个，其中 ${cosmoMapped.length} 个已落到图上的量；未落图的：${cosmoNames.filter((n) => !(n in (artifact.paramMatrix ?? {}))).join(',') || '无'}`)

  console.log('\n[一级的边与摆位：只画块间接口，成员跟着自己的块]')
  /**
   * **段容器**（`type: 'group'`，见 design D8）：有"执行的步"的段各一个（红移循环前 / 逐红移循环）。
   * 它承担"段标题 + 段的范围"，所以必须：① 段的容器齐；② 不与任何边相连；
   * ③ 不可进入、不带标签。段的从属（块装在哪个容器里）在下面的摆位一节里量。
   * 层（`phase: 'layer'`）不是一步，**不出容器**——它那条带上只有层块自己。
   */
  const segContainerNodes = (canvasGraph?.nodes ?? []).filter((node) => node.type === 'group')
  const segPhases = segContainerNodes.map((node) => node.phase).sort()
  ok(
    JSON.stringify(segPhases) === JSON.stringify(['loop', 'prep']),
    '段容器两段齐（红移循环前 / 逐红移循环）',
    segPhases.join(',') || '一个都没有',
  )
  /** 有块的段才出容器：段是给块分组的，没有块的段在图上不留空框 */
  const childlessSegs = segContainerNodes.filter(
    (node) => !(canvasGraph?.nodes ?? []).some((child) => child.parent === node.id),
  )
  ok(childlessSegs.length === 0, '段容器都装着块（不留空框）', childlessSegs.map((node) => node.id).join(','))
  const straySegContainers = segContainerNodes.filter((node) => !String(node.id).startsWith('seg:'))
  ok(
    straySegContainers.length === 0,
    '产物里的容器只许是段容器（按代码阶段分层的阶段框仍然退场）',
    straySegContainers.map((node) => node.id).join(','),
  )
  const segContainerIds = new Set(segContainerNodes.map((node) => node.id))
  const segEdges = (canvasGraph?.edges ?? []).filter((edge) => segContainerIds.has(edge.source) || segContainerIds.has(edge.target))
  const segBusy = segContainerNodes.filter((node) => node.enterable !== false || (node.tags ?? []).length)
  ok(segEdges.length === 0 && segBusy.length === 0, '段容器不参与任何关系、不可进入、不带标签', `${segEdges.length} 条边 / ${segBusy.map((node) => node.id).join(',')}`)
  const flowEdges = (canvasGraph?.edges ?? []).filter((edge) => edge.id.startsWith('flow:'))
  ok(flowEdges.length === 0, '旧的汇总边（`flow:*`，标签写"N 条"）已退场', `还留着 ${flowEdges.length} 条`)
  const strayEdges = (canvasGraph?.edges ?? []).filter(
    (edge) =>
      !edge.focusOnly &&
      edge.kind !== 'feedback' &&
      (String(edge.source).startsWith('block:') || String(edge.target).startsWith('block:')),
  )
  ok(
    strayEdges.length === 0,
    '一级的边只有接口边与回流边（量的边不许连到块上；块 → 块的只许是这两种）',
    strayEdges.slice(0, 4).map((edge) => edge.id).join(','),
  )
  const feedbackBlockEdges = (canvasGraph?.edges ?? []).filter((edge) => edge.kind === 'feedback')
  ok(
    feedbackBlockEdges.every((edge) => String(edge.source).startsWith('block:') && String(edge.target).startsWith('block:')),
    '回流边是块 → 块（它不冒充"量 → 量"的主序依赖，所以不算漏网的跨界边）',
    feedbackBlockEdges.filter((edge) => !String(edge.source).startsWith('block:')).map((edge) => edge.id).join(','),
  )
  const nodeById = new Map((canvasGraph?.nodes ?? []).map((node) => [node.id, node]))
  /**
   * 水平带的不变量（块化之后改了）：**每个成员与自己所属的块同一条带**。
   * 原来的口径是"框外的量不与框内量同带"，现在 39 个量全部有块，这条已经没有对象；
   * 真正要守的是"成员不许漂到别的主序位次去"——同一段里可以并排好几个块（按位次自左向右排）。
   */
  const driftedMembers = [...nodeById.values()].filter((node) => {
    if (!node.parent) return false
    const owner = nodeById.get(node.parent)
    return owner && Math.round(owner.position?.y ?? 0) !== Math.round(node.position?.y ?? 0)
  })
  ok(driftedMembers.length === 0, '每个成员都与自己块同一条水平带（不漂到别的位次）', driftedMembers.slice(0, 4).map((node) => node.id).join(','))
  /**
   * 一级的**带**：层 / 红移循环前 / 逐红移循环（层那条带在最上面，但它不是"执行的步"，没有段框）。
   * 段的次序由名字定（不是位次数字）——`order` 已降级为**段内**横向位次（见 spec「一级按三段骨架与执行序摆放」）。
   */
  const PHASE_RANK = { layer: 0, prep: 1, loop: 2 }
  const PHASE_LABEL = { layer: '层', prep: '红移循环前', loop: '逐红移循环' }
  const phaseRank = (phase) => PHASE_RANK[phase] ?? 9
  const boxRows = new Map()
  for (const node of (canvasGraph?.nodes ?? []).filter((item) => String(item.id).startsWith('block:'))) {
    const phase = node.phase ?? 'prep'
    boxRows.set(phase, [...(boxRows.get(phase) ?? []), node])
  }
  const stacked = [...boxRows.values()].filter((row) => new Set(row.map((node) => Math.round(node.position?.x ?? 0))).size !== row.length)
  ok(stacked.length === 0, '同一段的多个块横向排开、不叠在一起', stacked.map((row) => row.map((node) => node.id).join('+')).join(','))
  /** **段即一条水平带**：同段所有块同一条 y（这条让"顺序由摆放承担"成立） */
  const notFlat = [...boxRows.entries()].filter(([, row]) => new Set(row.map((node) => Math.round(node.position?.y ?? 0))).size !== 1)
  ok(
    notFlat.length === 0,
    '同一段的所有块同一条 y（段即一条水平带）',
    notFlat.map(([phase, row]) => `${phase}:${row.map((node) => `${node.id}@y=${Math.round(node.position?.y ?? 0)}`).join('/')}`).join(' , '),
  )
  /**
   * **块内次序 = 块内边的拓扑序**（分层模型退场后，成员"谁在左"由块自己的数据流决定）：
   * 独立重算一遍 Kahn，与产物里成员的横向次序逐块对拍；并列项按 id 稳定，多一个少一个都失败。
   */
  const blockMemberIds = new Map((canvasGraph?.blocks?.items ?? []).map((item) => [item.id, item.members ?? []]))
  const memberOrderOffenders = []
  for (const [blockId, memberIds] of blockMemberIds) {
    const nodes = memberIds.map((id) => nodeById.get(id)).filter(Boolean)
    if (nodes.length < 2) continue
    const inside = new Set(memberIds)
    const indegree = new Map(memberIds.map((id) => [id, 0]))
    const outs = new Map(memberIds.map((id) => [id, []]))
    for (const edge of canvasGraph?.edges ?? []) {
      if (edge.focusOnly || String(edge.source).startsWith('block:')) continue
      if (!inside.has(edge.source) || !inside.has(edge.target) || edge.source === edge.target) continue
      outs.get(edge.source).push(edge.target)
      indegree.set(edge.target, indegree.get(edge.target) + 1)
    }
    const ready = memberIds.filter((id) => indegree.get(id) === 0).sort()
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
    const expected = [...placed, ...memberIds.filter((id) => !placed.includes(id)).sort()]
    const actual = [...nodes]
      .sort((a, b) => a.position.x - b.position.x || (a.id < b.id ? -1 : 1))
      .map((node) => node.id)
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      memberOrderOffenders.push(`${blockId}: 画上 ${actual.join('→')} / 重算 ${expected.join('→')}`)
    }
  }
  ok(memberOrderOffenders.length === 0, '块内成员自左向右 = 块内边的拓扑序（独立重算逐块对拍）', memberOrderOffenders.slice(0, 2).join(' | '))
  /** 段内次序 = 位次升序（`order` 是段内横向位次，MUST NOT 参与筛人） */
  const badInnerOrder = [...boxRows.entries()].filter(([, row]) => {
    const sorted = [...row].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.id < b.id ? -1 : 1))
    return sorted.some((node, index) => {
      if (index === 0) return false
      return node.position.x < sorted[index - 1].position.x
    })
  })
  ok(
    badInnerOrder.length === 0,
    '段内自左向右 = `order` 升序（横向次序就是执行序）',
    badInnerOrder.map(([phase]) => phase).join(','),
  )
  console.log(
    `  · 一级 ${boxRows.size} 段：${[...boxRows.entries()]
      .sort((a, b) => phaseRank(a[0]) - phaseRank(b[0]))
      .map(([phase, row]) => `${PHASE_LABEL[phase] ?? phase}(${row.length}块)`)
      .join(' ')}`,
  )

  /**
   * **尺寸与距离成比例**（用户 2026-09-30：*初始模块尺寸和距离要成比例，距离过大模块又太小*）。
   *
   * 这一段的框尺寸**用画布自己的口径量**（esbuild 真跑 `src/graph/labels.ts`，不在这里抄一份
   * 公式）：坐标里那个"框有多大"必须与画布上那个"框有多大"是同一个数。旧稿的病根就是两者脱钩——
   * 坐标按写死的 820×300 排，画布却按标签算出 116~240×38（实测版面 940 × 3200），
   * 空隙成了框的 4~7 倍，整版只有缩到 0.19 才看得全，字不到 3px。那才是"模块又太小"。
   *
   * 两条判据（都不看生成器怎么写坐标，只量成品）：
   *   · **等距**：同一排相邻的两块、同一块里的成员、同一成员的步骤、相邻两段的**框**，空隙彼此相等
   *     —— 任何"写死步长"（旧稿的 820 / 300 / 280 / 220 全栽在这条）当场露馅；
   *   · **成比例**：每个空隙不超过相邻两框里**较小的那条短边** —— 空的地方不许比实的地方还大。
   * （这里的名字都带 `layout` / `Gaps` 前缀分量，避开下面几段已用的 `members` / `blockNodes` 等。）
   */
  const { measureBoxSize: boxSizeByView } = await loadTs('src/graph/labels.ts', 'labels')
  const sizeAt = (node) => boxSizeByView(node.label)
  const halfOf = (node, axis) => (axis === 'x' ? sizeAt(node).width : sizeAt(node).height) / 2
  /** 相邻两框（沿某条轴）之间的空隙：`b` 的近边 减 `a` 的远边 */
  const gapBetween = (a, b, axis) => b.position[axis] - halfOf(b, axis) - (a.position[axis] + halfOf(a, axis))
  /** 量一组"依次相邻"的框：空隙既要彼此相等，也不许超过相邻两框里较小的短边 */
  const surveyGaps = (groups, axis) => {
    const gaps = []
    const tooFar = []
    for (const nodes of groups) {
      const ordered = [...nodes].sort((a, b) => a.position[axis] - b.position[axis])
      for (let i = 1; i < ordered.length; i += 1) {
        const [previous, node] = [ordered[i - 1], ordered[i]]
        const gap = gapBetween(previous, node, axis)
        gaps.push(gap)
        const limit = Math.min(sizeAt(previous).width, sizeAt(previous).height, sizeAt(node).width, sizeAt(node).height)
        if (gap > limit + 0.5) tooFar.push(`${previous.id} ↔ ${node.id} 空 ${gap.toFixed(1)}（短边才 ${limit}）`)
      }
    }
    return { gaps, tooFar }
  }
  /**
   * 段与段之间让的是**框**，不是块：块外面还套着段容器，框在块并集之外还要占一圈。这一圈
   * **从样式表读**（`node:parent` 的 `padding`，渲染实测 26——它写在 `node.container` 之后，
   * 于是装了块的容器实取 26，而不是那里声明的 `GROUP_PADDING` 14），不在这里另抄一份：
   * 样式表一改，下面"只有一个间距数字"当场就破。另外画布上的块比模型高 `BADGE_LINE`（`.branch`
   * 徽标「名字 · N」多折一行，尺寸模型只量名字；叠段替这一行留了位），量框要把这一档算进去。
   */
  const { buildStylesheet } = await loadTs('src/graph/styles.ts', 'styles')
  const parentRule = buildStylesheet().find((rule) => rule.selector === 'node:parent')
  const framePadding = Number(parentRule?.style?.padding ?? 0)
  const { FRAME_PADDING, BADGE_LINE } = await import('./lib/boxSize.mjs')
  ok(
    framePadding > 0 && framePadding === FRAME_PADDING,
    '框在子节点之外的那一圈两份口径一致（样式表 `node:parent.padding` = 脚本镜像 `FRAME_PADDING`）',
    `样式表读到 ${parentRule?.style?.padding}，镜像 ${FRAME_PADDING}`,
  )
  /**
   * 一排（= 一个段）的**框**上下边界：本段块并集 + 上下各一圈（框的内边距 + 画布上块多出的半档）。
   * 排距必须量"框边到框边"——量中心距会把框高算进去，只量块边到块边则看不见框压框。
   */
  const bandOf = (row) => ({
    top:
      Math.min(...row.map((node) => node.position.y - sizeAt(node).height / 2)) - framePadding - BADGE_LINE / 2,
    bottom:
      Math.max(...row.map((node) => node.position.y + sizeAt(node).height / 2)) + framePadding + BADGE_LINE / 2,
  })
  const rowsInOrder = [...boxRows.entries()].sort((a, b) => phaseRank(a[0]) - phaseRank(b[0]))
  const bands = rowsInOrder.map(([, row]) => bandOf(row))
  const rowGaps = []
  const rowTooFar = []
  for (let i = 1; i < bands.length; i += 1) {
    const gap = bands[i].top - bands[i - 1].bottom
    rowGaps.push(gap)
    const limit = Math.min(...[...rowsInOrder[i - 1][1], ...rowsInOrder[i][1]].map((node) => sizeAt(node).height))
    if (gap > limit + 0.5) rowTooFar.push(`第${rowsInOrder[i - 1][0]}↔第${rowsInOrder[i][0]}位 空 ${gap.toFixed(1)}（最矮的框才 ${limit} 高）`)
  }
  /**
   * **相邻两段的框本体不许相压**：框是容器，装得住本段之外还得让得开邻段。层那条带不画框，
   * 让位也照框高算（同一个数字，不另起一套）；只按块高让位时，画布上相邻两段的框会纵向叠进来、
   * 框线切过邻段的块。
   */
  ok(
    rowGaps.every((gap) => gap > 0),
    '相邻两段的框不相压（段距按框高让位：块并集 + 上下各一圈内边距）',
    rowGaps.map((gap, i) => `${rowsInOrder[i][0]}↔${rowsInOrder[i + 1][0]} ${gap.toFixed(1)}`).join(' | '),
  )
  /** 有父的对象（父＝段的块、父＝块的成员）按父分组，各自量横向空隙——函数那一级不上图，没有第二组 */
  const groupsByParent = () => {
    const groups = new Map()
    for (const node of nodeById.values()) {
      if (!node.parent) continue
      groups.set(node.parent, [...(groups.get(node.parent) ?? []), node])
    }
    return [...groups.values()]
  }
  const cols = surveyGaps([...boxRows.values()], 'x')
  const memberGaps = surveyGaps(groupsByParent(), 'x')
  const layoutTooFar = [...cols.tooFar, ...memberGaps.tooFar, ...rowTooFar]
  const allGaps = [...cols.gaps, ...memberGaps.gaps, ...rowGaps]
  const gapValues = [...new Set(allGaps.map((gap) => gap.toFixed(1)))].sort()
  /**
   * 量到的空隙**只能是同一个数**：同排的块、同块的成员、同成员的步骤、相邻两段的框——四处的排法
   * 各自独立，却必须落在同一个间距上。这条比"逐组内部相等"强：任何一个地方另起一套步长
   * （旧稿的 820 / 300 / 280 / 220 就是四处各一套）都会让这个集合多出一个数。
   *
   * 附带效应（不是巧合，是这条断言的分内事）：坐标由生成器的**镜像副本**(`lib/boxSize.mjs`)
   * 算、尺寸由画布的 `labels.ts` 量，两份口径一旦漂移（比如只改了一边的字号或折行规则），
   * 空隙就不再是同一个数——所以这条同时盯着"两份副本必须等价"。
   */
  ok(
    gapValues.length <= 1,
    '距离由尺寸定：全图只有**一个**间距数字（同排 / 同块成员 / 同成员步骤 / 相邻两段的框之间都一样，不是写死的步长）',
    `${allGaps.length} 处空隙量到 ${gapValues.join(' / ')}`,
  )
  ok(
    layoutTooFar.length === 0,
    '距离不过大：每个空隙都不超过相邻两框里较小的短边（空的地方不许比实的地方还大）',
    layoutTooFar.slice(0, 3).join(' | '),
  )
  const blockBoxes = [...nodeById.values()].filter((node) => String(node.id).startsWith('block:'))
  const spanOf = (key, axis) =>
    Math.max(...blockBoxes.map((node) => node.position[axis] + sizeAt(node)[key] / 2)) -
    Math.min(...blockBoxes.map((node) => node.position[axis] - sizeAt(node)[key] / 2))
  const rangeOf = (key) => `${Math.min(...blockBoxes.map((node) => sizeAt(node)[key]))}~${Math.max(...blockBoxes.map((node) => sizeAt(node)[key]))}`
  const layoutW = spanOf('width', 'x')
  const layoutH = spanOf('height', 'y')
  console.log(
    `  · 一级版面 ${layoutW.toFixed(1)} × ${layoutH.toFixed(1)}（框 ${rangeOf('width')} 宽 × ${rangeOf('height')} 高，空隙（含段框之间）${gapValues.join('/')}）：` +
      `取景倍数 ≈ 画布高 / ${layoutH.toFixed(1)}，屏幕字号 = 13 × 那个倍数`,
  )

  /**
   * **段容器装下本段的块**（spec「段是容器，不参与关系与导航」）：容器靠 compound 撑开，
   * 几何上必然包住子节点，所以这里量的是**结构**——每个过程块恰有一个段容器作父级、层一个都不装，
   * 且循环容器装下循环段的全部块（自检从 `parent` 独立重算，不信任生成器的分派）。
   */
  const segParentIds = new Set(
    (canvasGraph?.nodes ?? []).filter((node) => node.type === 'group').map((node) => node.id),
  )
  const misParented = (canvasGraph?.nodes ?? []).filter(
    (node) =>
      String(node.id).startsWith('block:') &&
      node.blockKind !== 'layer' &&
      !segParentIds.has(String(node.parent ?? '')),
  )
  ok(
    misParented.length === 0,
    '每个过程块恰有一个段容器作父级（一级的过程块都装在段里）',
    misParented.map((node) => node.id).join(','),
  )
  const nestedLayers = (canvasGraph?.nodes ?? []).filter(
    (node) => node.blockKind === 'layer' && segParentIds.has(String(node.parent ?? '')),
  )
  ok(
    nestedLayers.length === 0,
    '层不装在段容器里（它不是一步：那条带上没有框）',
    nestedLayers.map((node) => node.id).join(','),
  )
  const loopSegBlocks = (canvasGraph?.nodes ?? []).filter(
    (node) => String(node.id).startsWith('block:') && node.parent === 'seg:loop',
  )
  ok(
    segParentIds.has('seg:loop') && loopSegBlocks.length === (boxRows.get('loop') ?? []).length,
    '循环容器装下循环段全部块（少一块、多一块都不算装下）',
    `容器 ${segParentIds.has('seg:loop') ? '在' : '缺失'} / 装 ${loopSegBlocks.length} 块 vs 段内 ${(boxRows.get('loop') ?? []).length} 块`,
  )

  console.log('\n[层级的底：只有块与成员，函数那一级不上图]')
  const allNodeIds = (canvasGraph?.nodes ?? []).map((node) => node.id)
  const dupIds = allNodeIds.filter((id, index) => allNodeIds.indexOf(id) !== index)
  ok(dupIds.length === 0, '节点 id 全局唯一（同一 id 挂两个父节点是非法图）', [...new Set(dupIds)].slice(0, 4).join(','))
  /**
   * **物理链的底就是物理量与物理过程**（design.md D1）：谁把它算出来、切在哪几个函数里，
   * 回答的是"这个量由哪几行算出"，归代码落点管（`stepSites` 仍是唯一产地），不归图层管。
   * 下面两条挡的是那一层**又长回来**：一个 `step:*` 节点、一份 `graph.subgraphs` 索引都不许有。
   */
  const stepNodeIds = allNodeIds.filter((id) => String(id).startsWith('step:'))
  ok(stepNodeIds.length === 0, '图上没有函数子图的节点（`step:*` 已退场）', stepNodeIds.slice(0, 4).join(','))
  ok(
    canvasGraph?.subgraphs === undefined,
    '产物里没有 `graph.subgraphs` 索引（「成员 → 步骤」那层已退场）',
    canvasGraph?.subgraphs ? `又出现了 ${Object.keys(canvasGraph.subgraphs).length} 条索引` : '',
  )
  const blockNodeIds = allNodeIds.filter((id) => String(id).startsWith('block:'))
  const segNodeIds = allNodeIds.filter((id) => String(id).startsWith('seg:'))
  const memberNodeIds = allNodeIds.filter((id) => !blockNodeIds.includes(id) && !segNodeIds.includes(id))
  console.log(
    `  · 节点 ${allNodeIds.length} 个：块 ${blockNodeIds.length} · 成员 ${memberNodeIds.length} · 段容器 ${segNodeIds.length} · 函数子图 0`,
  )
  /** 成员的 `parent` 一律指着它所属的块（子节点数那一处判据在下面「进入子图」一组里真跑） */
  const badMemberParents = memberNodeIds.filter((id) => !String(nodeById.get(id)?.parent ?? '').startsWith('block:'))
  ok(badMemberParents.length === 0, '每个成员都挂在自己的块下（parent 指向块）', badMemberParents.slice(0, 4).join(','))

  console.log('\n[一级：10 个过程块 + 2 个层（划分来自真源 chain.json 的 blocks.items）]')
  const allGraphNodes = canvasGraph?.nodes ?? []
  const blockNodes = allGraphNodes.filter((node) => String(node.id).startsWith('block:'))
  const blockItems = chain.blocks?.items ?? []
  const allQuantityIds = [...chain.drivers, ...chain.nodes].map((item) => item.id)
  /** 量 → 块 的归属表（判据只有一份：真源） */
  const blockOfNode = new Map()
  for (const block of blockItems) for (const member of block.members ?? []) blockOfNode.set(member, block.id)
  const blockEdgesAll = canvasGraph?.edges ?? []
  const interfaceEdges = blockEdgesAll.filter((edge) => edge.focusOnly)
  /**
   * 回流边**不是**"量 → 量"的主序依赖：它是块 → 块的反向边、层差为负，混进下面这组会让
   * "跨块边数 = 接口边数 × 来源"与"块对数"一起算错（回流的两端块对本来不在主序里）。
   */
  const feedbackEdgesAll = blockEdgesAll.filter((edge) => edge.kind === 'feedback')
  const quantityEdges = blockEdgesAll.filter((edge) => !edge.focusOnly && edge.kind !== 'feedback')
  const internalEdges = quantityEdges.filter((edge) => blockOfNode.get(edge.source) === blockOfNode.get(edge.target))
  const crossEdgesAll = quantityEdges.filter((edge) => blockOfNode.get(edge.source) !== blockOfNode.get(edge.target))
  ok(blockItems.length === 11, '真源里恰有 11 个块（10 过程 + 1 层）', String(blockItems.length))
  ok(blockNodes.length === 11, '产物里恰有 11 个块节点（块是普通节点，不是容器）', String(blockNodes.length))
  ok(
    blockNodes.every((node) => node.type === 'process' && !node.chain),
    '块节点不是 `group` 容器（容器之间不许有边，而块间要画接口边）',
    blockNodes.filter((node) => node.type !== 'process').map((node) => `${node.id}=${node.type}`).join(','),
  )
  const processBlocks = blockNodes.filter((node) => node.blockKind === 'process')
  const layerBlocks = blockNodes.filter((node) => node.blockKind === 'layer')
  ok(processBlocks.length === 10, '过程块恰为 10 个（一个块 = 一个 Compute* 步）', String(processBlocks.length))
  ok(layerBlocks.length === 1, '层恰为 1 个（常数与网格）', String(layerBlocks.length))
  ok(
    layerBlocks.every((node) => node.enterable === false),
    '**层不可进入**（层不是过程，进去没有子图）',
    layerBlocks.filter((node) => node.enterable).map((node) => node.id).join(','),
  )
  const unordered = [...blockItems].filter(
    (block, index) => index > 0 && (block.order ?? 0) < (blockItems[index - 1].order ?? 0),
  )
  ok(unordered.length === 0, '块按主序位次（`order`，真源声明）从下往上排', unordered.map((block) => block.id).join(','))
  /**
   * 每个过程块的代码锚都在真源里：`.c` 文件 + `Compute*` 函数 + 输出盒子结构名；
   * **层的锚是文件清单**（spec：层 MUST 带文件清单作为锚——层不是某个 `Compute*` 步，
   * 硬给它编一个函数名就是伪造）。
   * 这里只查"形状齐全"，"锚真的存在"由下面的文件系统断言查（那一条才防伪造）。
   */
  const missingAnchor = blockItems.filter((block) => {
    const anchor = block.codeAnchor ?? {}
    if (block.kind === 'layer') return anchor.kind !== 'files' || !(anchor.files ?? []).length
    return anchor.kind !== 'compute' || !anchor.file || !anchor.function || !anchor.struct
  })
  ok(
    missingAnchor.length === 0,
    '每个过程块都有「.c + Compute* + 输出盒子结构名」的锚，层有文件清单锚',
    missingAnchor.map((block) => block.id).join(','),
  )
  /**
   * **代码锚真的存在**（可证伪）：过程块的文件在磁盘上、且那个 `Compute*` 名字真的出现在该文件里；
   * 层的锚里的文件也逐个在磁盘上。
   * 这一条是"切块判据 = 代码模块"的**唯一硬证据**——不然"代码锚"就只是块上一个好看的字符串，
   * 块与代码脱钩了也没人发现（故意改坏一条锚，这里必须失败）。
   */
  const anchorProblems = (
    await Promise.all(
      blockItems.map(async (block) => {
        const anchor = block.codeAnchor ?? {}
        if (block.kind === 'layer') {
          const problems = []
          for (const name of anchor.files ?? []) {
            const found = await findSourceFile(name)
            if (!found) problems.push(`${block.id} 的成员文件不存在：${name}`)
          }
          return problems.length ? problems.join('；') : null
        }
        const file = path.join(REPO_ROOT, String(anchor.file ?? ''))
        const content = await fs.readFile(file, 'utf8').catch(() => null)
        if (content === null) return `${block.id} 的文件不存在：${anchor.file}`
        if (!content.includes(String(anchor.function ?? ''))) return `${block.id}：${anchor.file} 里找不到「${anchor.function}」`
        return null
      }),
    )
  ).filter(Boolean)
  ok(anchorProblems.length === 0, '每个块的代码锚都真实存在（过程块：文件在磁盘上且函数名出现在该文件里；层：成员文件都在）', anchorProblems.slice(0, 3).join('；'))
  /**
   * 成员纪律（`specs/graphify-physics-chain/spec.md` 的「块成员纪律」）：**物理量**不重不漏。
   * 层的成员 `tgamma` 本身是物理量，跟着一起核；块里不许出现"不是物理量"的成员——文件只在
   * `codeAnchor` 里出现，不挂成员。
   */
  const declaredMembers = blockItems.flatMap((block) => block.members ?? [])
  const duplicatedMembers = declaredMembers.filter((id, index) => declaredMembers.indexOf(id) !== index)
  ok(duplicatedMembers.length === 0, '没有量属于两个块（不重）', [...new Set(duplicatedMembers)].join(','))
  ok(allQuantityIds.length === 41, '物理量共 41 个（37 nodes + 4 drivers）', String(allQuantityIds.length))
  const quantityMemberIds = declaredMembers.filter((id) => allQuantityIds.includes(id))
  const fileMemberIds = declaredMembers.filter((id) => !allQuantityIds.includes(id))
  ok(
    JSON.stringify([...quantityMemberIds].sort()) === JSON.stringify([...allQuantityIds].sort()),
    '块的物理量成员并集 = 全部 41 个物理量（不重不漏；驱动量不再漂在一级）',
    `成员里 ${quantityMemberIds.length} 个是物理量`,
  )
  // 块的成员一律是物理量：文件只在 `codeAnchor` 里出现，不挂成员（所以「文件成员」这一类为空）
  ok(fileMemberIds.length === 0, '块的成员全是物理量，没有文件型成员', fileMemberIds.slice(0, 3).join(','))
  /**
   * **左栏第二个检索面（天体物理过程）**：真源 `processes` 的三条不变量。
   *   · **不重不漏**：12 个过程的并集（+ 兜底名单，现为空），恰好 = 全部 34 个量 + 4 个驱动量。
   *     旧划分之外的四个模块（宇宙学背景与物质功率谱 / 初始条件 / 引力扰动 / X 射线源的历史卷积）
   *     已按模块主题就近立条，所以兜底名单为空；将来再有新模块，还没收编的量仍进这里。
   *   · **成员悬空**：每个成员都必须是图上的量（`allQuantityIds` 里那种 id）。
   *   · **不吃 `order`**：过程面**不是第三条一级轴** —— 过程不许写 `order`（那是块的摆位字段）、
   *     名字不许带序号或 `M*` 形式（同屏已有三套 ⓪…⑨ 与 M1…M10），免得被误读成一级的排位。
   */
  console.log('\n[左栏第二个检索面：天体物理过程（划分来自真源 chain.json 的 processes.items）]')
  const processItems = artifact.processes?.items ?? []
  ok(processItems.length === 12, '过程面共 12 条词条（每条都覆盖一组量）', String(processItems.length))
  ok(
    processItems.every((item) => item.kind === undefined),
    '过程词条不带 `kind`（「带」这一类已退场：成员就近并入相关过程）',
    processItems.map((item) => `${item.id}:${item.kind}`).join(','),
  )
  const processMembers = processItems.flatMap((item) => item.members ?? [])
  const duplicatedProcessMembers = processMembers.filter((id, index) => processMembers.indexOf(id) !== index)
  ok(duplicatedProcessMembers.length === 0, '同一个量不挂在两条过程下（不重）', [...new Set(duplicatedProcessMembers)].join(','))
  const danglingProcessMembers = processMembers.filter((id) => !allQuantityIds.includes(id))
  ok(danglingProcessMembers.length === 0, '过程成员都是图上的量（没有悬空 id）', danglingProcessMembers.slice(0, 3).join(','))
  const uncoveredMembers = artifact.processes?.uncovered?.members ?? []
  const coveredMembers = [...processMembers, ...uncoveredMembers]
  const missingMembers = allQuantityIds.filter((id) => !coveredMembers.includes(id))
  const extraMembers = coveredMembers.filter((id) => !allQuantityIds.includes(id))
  ok(
    missingMembers.length === 0 && extraMembers.length === 0 && duplicatedProcessMembers.length === 0,
    '12 个过程 + 兜底名单 = 全部 38 个物理量（不重不漏；兜底名单现为空）',
    `漏 ${missingMembers.join(',') || '无'} / 多 ${extraMembers.join(',') || '无'} / 重 ${[...new Set(duplicatedProcessMembers)].join(',') || '无'}`,
  )
  const processMembersOutsideBlocks = processMembers.filter((id) => !blockOfNode.has(id))
  ok(
    processMembersOutsideBlocks.length === 0,
    '过程成员在 `blocks` 里都有归属（过程面与代码模块面并存，不是另一套成员表）',
    processMembersOutsideBlocks.slice(0, 3).join(','),
  )
  const processWithOrder = processItems.filter((item) => item.order !== undefined)
  ok(processWithOrder.length === 0, '过程不写 `order`（那是块的摆位字段，过程面不是第三条一级轴）', processWithOrder.map((item) => item.id).join(','))
  const numberedLabels = processItems.filter((item) => /^[⓪①②③④⑤⑥⑦⑧⑨⑩]/.test(item.label) || /^M\d/.test(item.label))
  ok(
    numberedLabels.length === 0,
    '过程名不编号、不用 `M*` 形式（同屏已有三套 ⓪…⑨ 与 M1…M10，避免被误读成一级轴）',
    numberedLabels.map((item) => item.label).join(','),
  )
  const blockIds = new Set(blockItems.map((block) => block.id))
  const wrongPrimary = processItems.filter((item) => !blockIds.has(item.primaryBlock))
  ok(wrongPrimary.length === 0, '每条过程的主块都在 `blocks` 里（点过程要能定位到块）', wrongPrimary.map((item) => `${item.id}:${item.primaryBlock}`).join(','))
  const badFit = processItems.filter((item) => typeof item.fit !== 'string')
  ok(badFit.length === 0, '每条过程的 `fit` 都是字符串（写得清就写，写不出留空）', badFit.map((item) => item.id).join(','))
  console.log(
    `  · 过程面成员 ${processMembers.length} 个 + 兜底 ${uncoveredMembers.length} 个 = ${allQuantityIds.length}${uncoveredMembers.length ? `（${uncoveredMembers.join('、')}）` : ''}；` +
      `写了拟合律的 ${processItems.filter((item) => item.fit).length} 条，留空的 ${processItems.filter((item) => !item.fit).length} 条`,
  )

  /**
   * **过程 ↔ 参数 反查口径同源**（spec 的 Scenario「反查口径同源」）：反查只许走既有的
   * 「参数 × 节点矩阵」，不许有第二份参数归属表。所以这里独立地
   *   ① 用矩阵**两个方向对拍**（成员 → 参数 扫列，参数 → 成员 扫行），结果必须逐条一致；
   *   ② 反查出的参数必须都是真源声明过的参数（没有凭空冒出来的）；
   *   ③ 过程词条里不许另存 `params` 清单（否则就是第二份归属表）；
   *   ④ 逐条打印相关参数数与论文出处数（与左栏词条上那两个数同源），一条都没有的显式记「无」。
   */
  console.log('\n[过程 ↔ 参数：反查口径同源（只走参数 × 节点矩阵）]')
  const paperOfParam = new Map(
    Object.values(artifact.params ?? {})
      .flat()
      .filter((param) => param?.name)
      .map((param) => [param.name, (param.paper ?? '').trim()]),
  )
  /**
   * 参数在图上**碰到的量**：矩阵直接落点 + 门控边两端——与视图 `paramTouchedNodes` 同一判据。
   * 开关改的是走哪一支，那条边的两端就是它与这条过程的关系所系（不这样，视图列出的相关参数
   * 会比这里多一个，两边的数字就对不上了）。
   */
  const touchedNodesOfRow = (row) => {
    const nodes = row?.nodes ?? []
    const direct = new Set(nodes)
    const gated = [...new Set((row?.edges ?? []).flatMap((key) => key.split('->')))].filter((id) => id && !direct.has(id))
    return [...nodes, ...gated]
  }
  /** 量 → 参数（矩阵的列方向，独立聚一遍；行方向直接扫每条参数自己碰到的量） */
  const paramsOfNodeId = new Map()
  for (const [name, row] of Object.entries(matrix)) {
    for (const nodeId of touchedNodesOfRow(row)) {
      if (!paramsOfNodeId.has(nodeId)) paramsOfNodeId.set(nodeId, [])
      paramsOfNodeId.get(nodeId).push(name)
    }
  }
  const processReverse = []
  const reverseMismatch = []
  const undeclaredParamHits = []
  const noParamProcesses = []
  for (const item of processItems) {
    const members = new Set(item.members ?? [])
    const viaColumn = [...new Set([...members].flatMap((id) => paramsOfNodeId.get(id) ?? []))].sort()
    const viaRow = Object.entries(matrix)
      .filter(([, row]) => touchedNodesOfRow(row).some((id) => members.has(id)))
      .map(([name]) => name)
      .sort()
    if (JSON.stringify(viaColumn) !== JSON.stringify(viaRow)) {
      reverseMismatch.push(`${item.id}: 列方向 ${viaColumn.length} 个 vs 行方向 ${viaRow.length} 个`)
    }
    undeclaredParamHits.push(...viaColumn.filter((name) => !paperOfParam.has(name)))
    if (!viaColumn.length) noParamProcesses.push(item.label)
    const papers = new Set(viaColumn.map((name) => paperOfParam.get(name)).filter(Boolean))
    processReverse.push(`${item.label} ${viaColumn.length} 个参数 / ${papers.size} 篇出处`)
  }
  ok(
    reverseMismatch.length === 0,
    '过程 → 参数 与 参数 → 过程 两个方向逐条一致（只有一份归属：参数 × 节点矩阵）',
    reverseMismatch.join('；'),
  )
  ok(
    undeclaredParamHits.length === 0,
    '反查出的参数都在真源声明里（没有凭空冒出来的参数）',
    [...new Set(undeclaredParamHits)].slice(0, 3).join(','),
  )
  ok(
    processItems.filter((item) => item.params !== undefined).length === 0,
    '过程词条里不另存参数清单（那就成了第二份归属表）',
    processItems.filter((item) => item.params !== undefined).map((item) => item.id).join(','),
  )
  console.log(`  · ${processReverse.join('；')}`)
  console.log(
    noParamProcesses.length
      ? `  · 与任何参数都无关系的：${noParamProcesses.join('、')}（左栏对这些词条写明「无相关参数」）`
      : '  · 每一条过程都至少有一个参数读到它',
  )

  const unboxed = [...blockOfNode]
    .filter(([id]) => allGraphNodes.some((node) => node.id === id))
    .filter(([id, blockId]) => allGraphNodes.find((node) => node.id === id)?.parent !== blockId)
  ok(unboxed.length === 0, '每个成员（图上的节点）都挂在自己块的 parent 上（parent 正确）', unboxed.slice(0, 4).map(([id]) => id).join(','))
  const nameless = blockNodes.filter((node) => !node.label)
  ok(nameless.length === 0, '每个块都带名字（取自真源 blocks.items 的 label）', nameless.map((node) => node.id).join(','))
  /**
   * 块级数字（`specs/graphify-physics-chain/spec.md` 的「块级数字可证伪」）：对不上要指出差在哪个数上。
   */
  ok(quantityEdges.length === 58, '量 → 量的主序依赖边恰为 58 条', String(quantityEdges.length))
  ok(internalEdges.length === 26, '块内边恰为 26 条（只进子图，不进主图）', String(internalEdges.length))
  ok(crossEdgesAll.length === 32, '跨块边恰为 32 条（已汇总成接口边）', String(crossEdgesAll.length))
  ok(
    crossEdgesAll.length + internalEdges.length + interfaceEdges.length + feedbackEdgesAll.length ===
      blockEdgesAll.length,
    '一级的边恰好分完：`块内 + 跨块 + 接口 + 回流 = 全部`（没有来路不明的边）',
    `${internalEdges.length} + ${crossEdgesAll.length} + ${interfaceEdges.length} + ${feedbackEdgesAll.length} vs ${blockEdgesAll.length}`,
  )
  /**
   * **箭头上的文字只有一种合法内容：跨块交付的那个量名**（口径见 `docs/notes/graphify/G4-物理链.md` §3.2 / §3.5）。
   *
   *   · 量 → 量的边**不写字**：两端本身就是画布上的量盒，写字只有两种可能——重复一遍盒子名，
   *     或者原先那样写式号（`Eq.6`）；
   *   · 块 → 块的交付边（接口边 / 回流边）写字，且写的必须是**跨块流动的那个量**——
   *     那两条分别由上面接口边与回流边两节各自独立复算，这里不重复。
   *
   * 所以本节查的是它的反面：**不该有字的边一个字都没有**，且**任何边上的文字都不含公式编号**。
   * 出处（`eq`）留在真源里供人查（`hasOrigin` 那条断言管），只是不上图：图上写 `Eq.6`，
   * 读者拿着它去不了任何地方，还得回头翻文档。
   */
  const labelledQuantityEdges = quantityEdges.filter((edge) => String(edge.label ?? '').trim() !== '')
  ok(
    labelledQuantityEdges.length === 0,
    '量 → 量的边不带标签（两端都是图上的量，文字只会重复盒子名或写式号）',
    labelledQuantityEdges.slice(0, 3).map((edge) => `${edge.id}=${edge.label}`).join(','),
  )
  const labelledWithEq = blockEdgesAll.filter((edge) => /Eq\.|§/.test(String(edge.label ?? '')))
  ok(
    labelledWithEq.length === 0,
    '箭头上的文字不含公式编号（`Eq.` / `§`）',
    labelledWithEq.slice(0, 3).map((edge) => `${edge.id}=${edge.label}`).join(','),
  )
  /**
   * 接口边数 = **不同块对数**（同一对块的多条跨界依赖合并成一条、标签把量名都写上），
   * 所以它 ≤ 跨块依赖数：实测 30 条跨块依赖落在 **21 对块**上
   * （如 ⓪环境 → ⑨观测量 有 `T_γ→τ_e` 与 `f*→φ` 两条，合并成一条 `τ_e、φ`）。
   */
  const blockIdSet = new Set(blockItems.map((block) => block.id))
  const pairCount = new Set(crossEdgesAll.map((edge) => `${blockOfNode.get(edge.source)}->${blockOfNode.get(edge.target)}`)).size
  ok(interfaceEdges.length === pairCount, '接口边数 = 不同块对数（同对块合并成一条）', `${interfaceEdges.length} vs ${pairCount}`)
  ok(interfaceEdges.length === 21, '块间接口边恰为 21 条（由 30 条跨块依赖汇总而来）', String(interfaceEdges.length))
  const badInterface = interfaceEdges.filter(
    (edge) => !blockIdSet.has(edge.source) || !blockIdSet.has(edge.target) || edge.source === edge.target,
  )
  ok(badInterface.length === 0, '每条接口边的两端都是块、且分属不同块', badInterface.map((edge) => edge.id).join(','))
  /**
   * 接口边的标签必须是**跨界流动的那个量名**（如 `④ → ⑤ Q_HII`），不是"N 条"这种汇总话术。
   * 独立重算：由跨块的量 → 量边取 source 的符号，按块对合并。
   */
  const symbolOfNode = new Map([...chain.drivers, ...chain.nodes].map((item) => [item.id, item.symbol ?? item.id]))
  const expectedLabels = new Map()
  for (const edge of crossEdgesAll) {
    const key = `${blockOfNode.get(edge.source)}->${blockOfNode.get(edge.target)}`
    const names = expectedLabels.get(key) ?? []
    const name = symbolOfNode.get(edge.source) ?? edge.source
    if (!names.includes(name)) names.push(name)
    expectedLabels.set(key, names)
  }
  const badLabel = interfaceEdges.filter(
    (edge) =>
      edge.id !== `iface:${edge.source}->${edge.target}` ||
      edge.label !== (expectedLabels.get(`${edge.source}->${edge.target}`) ?? []).join('、'),
  )
  ok(badLabel.length === 0, '接口边的标签 = 跨界流动的量名（与跨块依赖独立重算一致）', badLabel.slice(0, 3).map((edge) => `${edge.id}=${edge.label}`).join(','))
  /**
   * 静息不画：**每条**接口边都要带 `focusOnly`，视图据此默认隐藏、悬浮显现。
   * 反过来也要成立：量的边不许带这个标记，否则主图会把块内边也藏起来。
   */
  const notFocusOnly = interfaceEdges.filter((edge) => edge.focusOnly !== true)
  ok(notFocusOnly.length === 0, '每条接口边都标了 `focusOnly`（静息不画、悬浮才显现）', notFocusOnly.map((edge) => edge.id).join(','))
  const focusOnlyQuantities = quantityEdges.filter((edge) => edge.focusOnly)
  ok(focusOnlyQuantities.length === 0, '量的边不许标 `focusOnly`（块内边要照常画）', focusOnlyQuantities.map((edge) => edge.id).join(','))
  /**
   * 接口边的位次差按**真源主序位次 `order`** 算、且一律 ≥1（箭头自上而下，没有回指）。
   * 回流边（层差为负）不走这一条，它另有一段专门查。
   */
  const orderOfBlock = new Map(blockItems.map((block) => [block.id, block.order ?? 0]))
  const badIfaceSpan = interfaceEdges.filter(
    (edge) => (orderOfBlock.get(edge.target) ?? 0) - (orderOfBlock.get(edge.source) ?? 0) < 1,
  )
  ok(badIfaceSpan.length === 0, '交付边的位次一律自增（段内自左向右，`order` 差 ≥1）', badIfaceSpan.slice(0, 3).map((edge) => edge.id).join(','))
  /**
   * `graph.blocks`：块的**完整事实**（成员 / 可进入 / 档位 / 坐标 / 出入接口），视图与状态条都读它。
   * 这里对关键两项（成员并集、块内连通）**独立重算**一遍，不信任生成器写的标记——
   * 否则「⓪⑨ 不可进入」写错了没人发现，视图就会给出一个点进去只有孤盒的入口。
   * 其中「出入接口」**不进界面**，只在这里配对核对。
   */
  const blocksOut = canvasGraph?.blocks ?? {}
  const blockOutItems = blocksOut.items ?? []
  ok(blockOutItems.length === 11, '生成物里有 `graph.blocks.items`（一级划分的完整事实，11 条）', String(blockOutItems.length))
  const membersOut = blockOutItems.flatMap((item) => item.members ?? [])
  const quantityMembersOut = membersOut.filter((id) => allQuantityIds.includes(id))
  ok(
    JSON.stringify([...quantityMembersOut].sort()) === JSON.stringify([...allQuantityIds].sort()),
    '`blocks.items` 的物理量成员并集 = 全部 41 个物理量（不重不漏）',
    `${quantityMembersOut.length} 个物理量 / 全部成员 ${membersOut.length} 项`,
  )
  ok(
    membersOut.length === blockOutItems.reduce((sum, item) => sum + (item.memberCount ?? 0), 0),
    '每块的 `memberCount` = 成员表条数（物理量成员与文件成员一起数）',
    `${membersOut.length} vs ${blockOutItems.reduce((sum, item) => sum + (item.memberCount ?? 0), 0)}`,
  )
  const wrongMembers = blockOutItems.filter(
    (item) =>
      (item.members ?? []).length !== item.memberCount ||
      (item.members ?? []).filter((id) => allQuantityIds.includes(id)).length !== item.quantityMemberCount ||
      (item.members ?? []).some((id) => blockOfNode.get(id) !== item.id),
  )
  ok(wrongMembers.length === 0, '每块的成员数（总/物理量）= 成员表 = 节点上的 parent（三方一致）', wrongMembers.map((item) => item.id).join(','))
  /** 独立重算连通性：只用块内边做并查集，不看生成器给的 `enterable` */
  const componentsIn = (members) => {
    const parent = new Map(members.map((id) => [id, id]))
    const find = (x) => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x)))
    for (const edge of internalEdges) {
      if (!parent.has(edge.source) || !parent.has(edge.target)) continue
      const a = find(edge.source)
      const b = find(edge.target)
      if (a !== b) parent.set(a, b)
    }
    return new Set(members.map((id) => find(id))).size
  }
  /**
   * 可进入性**不再**由"块内连通"决定（旧口径会把 M4 这种成员分两簇的过程块判成"带"，用户进不去），
   * 改由真源声明的 `kind` 决定：`process` 且有成员 → 可进入；`layer` → 一定不可进入。
   * 这里独立重算 `components` 只为核对生成器**如实报告**了"成员连不连"，两者不再混为一谈。
   */
  const wrongEnterable = blockOutItems.filter(
    (item) => item.enterable !== (item.kind !== 'layer' && (item.quantityMemberCount ?? 0) > 0),
  )
  ok(wrongEnterable.length === 0, '`enterable` 与真源的 `kind`（process / layer）一致，不再由连通性推断', wrongEnterable.map((item) => item.id).join(','))
  const wrongComponents = blockOutItems.filter((item) => {
    const quantityMembers = (item.members ?? []).filter((id) => allQuantityIds.includes(id))
    return item.components !== componentsIn(quantityMembers)
  })
  ok(
    wrongComponents.length === 0,
    '块上报告的 `components`（成员分几簇）与块内边的独立重算一致',
    wrongComponents.map((item) => `${item.id}:${item.components}`).join(','),
  )
  const enterableButSplit = blockOutItems.filter((item) => item.enterable && (item.components ?? 0) > 1)
  console.log(
    `  · 可进入的块里有 ${enterableButSplit.length} 个"成员分多簇"（旧口径会判它们不可进入）：` +
      enterableButSplit.map((item) => `${item.id}(${item.components}簇)`).join(' '),
  )
  /**
   * 块的阶段号（`stages`）= 成员 `stage` 的并集：属性页直接读它显示"这个块算在哪几段代码里"，
   * 所以由成员的 `stage` 独立重算一遍（不信任块上写的），对不上要指出差在哪。
   */
  const stageOfOutNode = new Map(allGraphNodes.map((node) => [node.id, node.stage]))
  const wrongStages = blockOutItems.filter((item) => {
    const union = [...new Set((item.members ?? []).map((id) => stageOfOutNode.get(id)).filter(Boolean))].sort()
    return JSON.stringify([...(item.stages ?? [])].sort()) !== JSON.stringify(union)
  })
  ok(
    wrongStages.length === 0,
    '块的 `stages` = 成员阶段号的并集（属性页要显示它）',
    wrongStages.slice(0, 3).map((item) => `${item.id}:${(item.stages ?? []).join('/')}`).join(','),
  )
  /**
   * **块的标签 = 成员标签的并集**。块**没有自己的标签**——"这个块涉及参数 X"完全由成员决定，所以它跟
   * `stages` 走同一条口径，也由成员**独立重算**一遍（不信任生成器写的）；多一个少一个都报出来。
   *
   * 两个出口（块节点上的 `tags` 与 `blocks.items[].tags`）必须是**同一份事实**：视图读节点画红点、
   * 自检读清单查归属，两边不一致就会出现"清单里有、画布上不亮"。
   */
  const tagsOfOutNode = new Map(allGraphNodes.map((node) => [node.id, [...(node.tags ?? [])].sort()]))
  const unionTagsOfBlock = (item) =>
    [...new Set((item.members ?? []).flatMap((id) => tagsOfOutNode.get(id) ?? []))].sort()
  const wrongBlockTags = blockOutItems.filter((item) => {
    const union = unionTagsOfBlock(item)
    const onItem = [...(item.tags ?? [])].sort()
    return JSON.stringify(onItem) !== JSON.stringify(union) || JSON.stringify(tagsOfOutNode.get(item.id) ?? []) !== JSON.stringify(union)
  })
  ok(
    wrongBlockTags.length === 0,
    '块的 `tags` = 成员标签的并集（块节点与 blocks.items 两处一致）',
    wrongBlockTags.slice(0, 3).map((item) => `${item.id}:${(item.tags ?? []).join('/') || '空'}`).join(','),
  )
  /**
   * "选中参数一级要亮"的**可判定形式**是「**有成员带标签 ⇒ 块必须亮**」，不是「每个过程块都非空」。
   *
   * 为什么不能要求全非空：按代码模块切块后（一个 `.c` + `Compute*` + 盒子 = 一个块）出现 4 个
   * **单成员块**，而它们那个成员在落点函数体里**一个声明参数都没读**——
   *   · `matter_power` / `vcb` 的落点是 `ComputeInitialConditions`（0 个 `->参数` 命中）；
   *   · `perturb_field` 的落点是 `ComputePerturbedField`（0 个）；
   *   · `filtered_xray` 的落点 `UpdateXraySourceBox` 读了两个参数，但落点是**单元级** hint（`S14.3.1`），
   *     而 `paramHints` 只挂**阶段与子过程**两个键（生成器里写明"参数归属的口径不跟着改"）→ 也空。
   * 空并集是**事实**（这些量确实不按名字读参数），硬要求非空只会逼着编一个假标签；
   * 但空必须是**成员解释得了的**：成员里有带标签的量、块却不亮，就是真 bug（原意所在）。
   * 层同理（层的成员是常数，带不了参数标签）。
   */
  const processBlockItems = blockOutItems.filter((item) => item.kind !== 'layer')
  const hasTaggedMember = (item) => (item.members ?? []).some((id) => (tagsOfOutNode.get(id) ?? []).length)
  const mutedBlocks = blockOutItems.filter((item) => item.kind !== 'layer' && !(item.tags ?? []).length)
  const unexplainedMuted = mutedBlocks.filter((item) => hasTaggedMember(item))
  const unexplainedTagged = processBlockItems.filter((item) => (item.tags ?? []).length && !hasTaggedMember(item))
  ok(
    unexplainedMuted.length === 0 && unexplainedTagged.length === 0,
    '有成员带标签的过程块必须亮（`tags` 非空）；空并集必须由"成员都没带标签"解释',
    `该亮不亮：${unexplainedMuted.map((item) => item.id).join(',') || '无'}；该空不空：${unexplainedTagged.map((item) => item.id).join(',') || '无'}`,
  )
  console.log(
    `  · 标签并集为空的过程块：${mutedBlocks.map((item) => `${item.id}(${(item.members ?? []).join(',')})`).join(' ') || '无'}` +
      `（这 ${mutedBlocks.length} 个块的成员在落点函数体里读不到声明参数，不是"该亮没亮"）`,
  )
  /** 后面查"块引用的标签都在注册表里"时按过程块算（层的并入集本来就是空） */
  const taggedBlocks = processBlockItems.filter((item) => (item.tags ?? []).length)
  const badBlockTagDetail = allGraphNodes.filter(
    (node) =>
      String(node.id).startsWith('block:') &&
      [...(node.tags ?? [])].some((tagId) => !Array.isArray(node.tagDetails?.[tagId]) || node.tagDetails[tagId].length === 0),
  )
  ok(
    badBlockTagDetail.length === 0,
    '块上每个标签都有明细条目（点红点能读到"成员里谁带着它"）',
    badBlockTagDetail.slice(0, 3).map((node) => node.id).join(','),
  )
  const blockTagUnregistered = [...new Set(taggedBlocks.flatMap((item) => item.tags ?? []))].filter(
    (tagId) => !registryIds.has(tagId),
  )
  ok(blockTagUnregistered.length === 0, '块引用的标签都在注册表里（不许自造）', blockTagUnregistered.slice(0, 3).join(','))
  /**
   * `stages` 允许为空——**但只允许一种情况**：那个块装的全是没有 `codeHints` 的量（驱动量与外部量
   * 本来就不属于任何代码阶段，⓪ 环境就是这种）。真源里冒出一个"成员有代码、块却查不到阶段"的块，
   * 说明 `codeHints` 漏写了，要在这里报出来。
   */
  const emptyStages = blockOutItems.filter((item) => !(item.stages ?? []).length)
  const emptyButCoded = emptyStages.filter((item) => (item.members ?? []).some((id) => (sourceHints.get(id) ?? []).length))
  ok(
    emptyButCoded.length === 0,
    '`stages` 为空的块，成员全是没有 `codeHints` 的输入 / 外部量（不是漏抄阶段号）',
    emptyButCoded.map((item) => item.id).join(','),
  )
  ok(
    emptyStages.length <= 1 && emptyStages.every((item) => item.kind === 'layer'),
    '没有代码阶段的块只会是层（常数与网格本身不是某一段计算）',
    emptyStages.map((item) => `${item.id}(${item.kind})`).join(','),
  )
  const notEnterable = blockOutItems.filter((item) => !item.enterable)
  ok(
    notEnterable.length === 1 && notEnterable.every((item) => item.kind === 'layer'),
    '恰有 1 个块不可进入，且是层（常数与网格）',
    notEnterable.map((item) => `${item.id}(${item.kind})`).join(','),
  )
  /** 对外接口：21 条 `iface:*` 每条恰被一端的 `interfaceOut` 与另一端的 `interfaceIn` 各认领一次 */
  const claimed = blockOutItems.flatMap((item) => [...(item.interfaceOut ?? []), ...(item.interfaceIn ?? [])])
  ok(
    claimed.length === interfaceEdges.length * 2 && new Set(claimed).size === interfaceEdges.length,
    '每条接口边恰好被两端各自的出入接口表认领一次（不重不漏）',
    `${claimed.length} 次 / ${new Set(claimed).size} 条`,
  )
  const statsOut = blocksOut.stats ?? {}
  ok(
    JSON.stringify(statsOut) ===
      JSON.stringify({ blocks: 11, processBlocks: 10, layerBlocks: 1, members: 41, fileMembers: 0, interfaceEdges: 21 }),
    '一级口径数字（11 块 / 10 过程 / 1 层 / 41 物理量成员 / 0 文件成员 / 21 接口）与重算一致',
    JSON.stringify(statsOut),
  )
  console.log(
    `  · 11 块（过程 ${processBlocks.length} / 层 ${blockItems.length - processBlocks.length}）· 物理量成员 ${quantityMembersOut.length} + 文件成员 ${membersOut.length - quantityMembersOut.length} ·` +
      ` 接口 ${interfaceEdges.length} 条 · 回流 ${feedbackEdgesAll.length} 条 · 块内边 ${internalEdges.length} 条 · 可进入 ${blockOutItems.length - notEnterable.length} 个（不可进入：${notEnterable.map((item) => item.id.replace('block:', '')).join('、')}）`,
  )

  console.log('\n[分层：一级只讲物理（一级默认可见集 = 11 个块）]')
  {
    const allGraphNodes = canvasGraph?.nodes ?? []
    /**
     * 独立重算一级的可见集，**一个话题都不关**（视图也不再关，见下面「视图纪律」里的源码断言）：
     * 规则同 `src/lib/topics.ts` 的 tabVisibleIds —— 遍历只在**容器**（`type: 'group'`）上下钻。
     *
     * 根节点是两个**段容器** + 层块自己（层没有容器），下钻一层拿到它们的块（块是普通节点，不再往下钻）。
     * "一级恰好 11 个块 + 2 个段容器"因此是**结构**保证的：41 个物理量成员挂在块下、
     * 步骤挂在成员下，三层各自不越界；而不是靠"默认收起几个话题"过滤出来的。
     */
    const containers = allGraphNodes.filter((node) => node.type === 'group')
    const strayContainers = containers.filter((node) => !String(node.id).startsWith('seg:'))
    ok(
      strayContainers.length === 0,
      '容器只许是段容器（`seg:*`：一级的干净由结构保证，按代码阶段分层的阶段框仍然退场）',
      strayContainers.map((node) => node.id).join(','),
    )
    const members = allGraphNodes
    const memberById = new Map(members.map((node) => [node.id, node]))
    const childrenOf = new Map()
    for (const node of members) {
      if (!node.parent) continue
      childrenOf.set(node.parent, [...(childrenOf.get(node.parent) ?? []), node.id])
    }
    const visible = new Set()
    const queue = members.filter((node) => !node.parent).map((node) => node.id)
    while (queue.length) {
      const id = queue.shift()
      if (visible.has(id)) continue
      visible.add(id)
      if (memberById.get(id)?.type !== 'group') continue
      for (const child of childrenOf.get(id) ?? []) if (!visible.has(child)) queue.push(child)
    }
    const visibleBlocks = [...visible].filter((id) => String(id).startsWith('block:'))
    /** 段容器在一级上是在场的（它就是段标题与段的范围），但它是装饰、不是对象——只许它这一类多出来 */
    const visibleSegs = [...visible].filter((id) => memberById.get(id)?.type === 'group')
    ok(
      visibleBlocks.length === 11 && visible.size === 11 + visibleSegs.length && visibleSegs.length === 2,
      '一级默认可见集 = 11 个块 + 2 个段容器（成员、工程项都不露）',
      `可见 ${visible.size} 个，其中块 ${visibleBlocks.length} 个`,
    )
    const leakedQuantities = [...visible].filter((id) => blockOfNode.has(id))
    ok(leakedQuantities.length === 0, '没有任何物理量漏在一级（38 个全装在块里）', leakedQuantities.join(','))
    const leakedEngineering = [...visible].filter((id) => memberById.get(id)?.type === 'engineering')
    ok(leakedEngineering.length === 0, '工程项不在默认可见集里（实现细节默认收起）', leakedEngineering.join(','))
    // —— 话题归属纪律：工程项与「实现细节」话题必须一一对应（不许混）——
    const engNodes = allGraphNodes.filter((node) => node.type === 'engineering')
    ok(engNodes.length > 0, '工程项在图上存在（收起的是真东西，不是空架子）', String(engNodes.length))
    const engWithoutTopic = engNodes.filter((node) => !(node.topics ?? []).includes(IMPL_TOPIC_ID)).map((node) => node.id)
    ok(engWithoutTopic.length === 0, `每个工程项都挂在「实现细节」（${IMPL_TOPIC_ID}）上`, engWithoutTopic.join(','))
    const nonEngWithTopic = allGraphNodes
      .filter((node) => node.type !== 'engineering' && (node.topics ?? []).includes(IMPL_TOPIC_ID))
      .map((node) => node.id)
    ok(nonEngWithTopic.length === 0, '非工程项不挂「实现细节」话题（话题含义不许被稀释）', nonEngWithTopic.join(','))
    /**
     * 旁路话题：注册表里还在（`φ`/`τ_e` 的**实现步骤**仍靠它标着"这是诊断出口"），
     * 但**一级不该有对象挂它** —— 那两个量已归 ⑨观测量；而且这些步骤的"不露"由结构保证
     * （它们挂在模块下面），不再依赖"默认收起"这个动作。
     */
    ok(
      (canvasGraph?.meta?.topics ?? []).some((topic) => topic.id === BYPASS_TOPIC_ID),
      `「旁路与后处理接口」（${BYPASS_TOPIC_ID}）仍在话题注册表里（标着诊断出口那批步骤）`,
      '注册表里找不到它',
    )
    const bypassAtTop = allGraphNodes.filter((node) => !node.parent && (node.topics ?? []).includes(BYPASS_TOPIC_ID))
    ok(bypassAtTop.length === 0, '一级没有节点挂旁路话题（φ/τ_e 已归 ⑨观测量）', bypassAtTop.map((node) => node.id).join(','))

    /**
     * —— 一级零工程零代码（文本层；名字与摘要里不许露出文件行号 / Python / 后端）——
     * 切块改成"一个块 = 一个代码模块"之后，代码事实（文件、`Compute*`、行号）**都在
     * `codeAnchor` 与关系边的 `codeRef` 里**（属性页与关系栏显示），一级的**摘要文字**仍然只讲物理：
     * 块与代码同构，不等于把文件行号写在块脸上。
     */
    const CODEY = /\.(c|h|py):\d|Python|后端/
    const leakyText = [...visible]
      .map((id) => memberById.get(id))
      .filter(Boolean)
      .filter((node) => CODEY.test(`${node.label ?? ''} ${node.summary ?? ''}`))
      .map((node) => node.id)
    ok(leakyText.length === 0, '一级节点的名字与摘要里没有工程/代码痕迹（文件行号、Python、后端）', leakyText.slice(0, 4).join(','))
    console.log(
      `  · 一级看得到 ${visible.size} 个节点（全是块）· 成员 ${allGraphNodes.filter((node) => blockOfNode.has(node.id)).length} 个在块里 ·` +
        ' 工程项与实现步骤靠 parent 藏在块内，话题（topic:impl / topic:bypass）只用来标来源',
    )
  }

  console.log('\n[视图纪律：复用模板，不复用数据]')
  const viewFile = 'src/components/PhysicsChainView.tsx'
  const viewSource = await fs.readFile(viewFile, 'utf8').catch(() => '')
  ok(viewSource.length > 0, '物理链页存在（可读到源码）')
  ok(
    !viewSource.includes('useGraphStore'),
    '物理链页不碰画布的共享 store（数据各用各的）',
    '它 import 了 useGraphStore',
  )
  ok(viewSource.includes('GraphSourceProvider'), '物理链页通过「图数据源」提供自己的数据', '')
  ok(
    /onEnterSubgraph=\{(?!readOnlyNotice)/.test(viewSource),
    '双击模块能进子图（onEnterSubgraph 不是只读提示）',
    '被接成了只读提示 ⇒ 一个子图都进不去',
  )
  ok(viewSource.includes('TabBar'), '有子图标签条（进去之后能切回上一层）', '')
  /**
   * **一级不靠过滤**：视图不再按话题隐藏任何东西（`topicFilter` 一律 null）。
   * 一级的干净是**结构**决定的（`block:*` 是普通节点，只有容器才内联展开后代），
   * 所以这里挡的是"把过滤加回来"——那会让"一级只有 10 个块"重新变成一件要靠开关维持的事。
   */
  ok(
    viewSource.includes('topicFilter={null}') && !viewSource.includes('topicVisibility'),
    '视图不做话题过滤（一级的干净由结构保证）',
    '视图里又出现了话题过滤',
  )
  /**
   * **不可进入的对象不给入口**：层（`Constants.c` 里那个常数）没有子图，进去只有孤盒。
   * 判据读生成物的 `enterable`（不是视图自己猜"有没有子节点"）。
   */
  ok(
    viewSource.includes('block.enterable'),
    '「进入子图」与双击都看生成物的 `enterable`（层不给入口）',
    '视图自己按"有没有子节点"判断能不能进',
  )
  /**
   * **子节点数只数"这个对象自己的"**：块＝它自己的成员数（层不给入口 → 0），
   * **成员一律 0**——函数那一级不上图（design.md D1），入口因此只出现在块上。
   * `blockOf` 回答的是"这个量**装在**哪个块里"——拿它当成员自己的子节点数，
   * ⑨观测量 里的 `p21` 就会报出「3 个子节点」（＝ M10 的成员数），点进去却是一张空画布。
   * 这里**真跑** lib 的 `subgraphSizeOf`（按钮上的数字与"能不能进"共用它这一处判据）。
   */
  {
    const { subgraphSizeOf } = await loadTs('src/lib/physicsChain.ts', 'physicsChain')
    const obsBlock = (canvasGraph?.blocks?.items ?? []).find((block) => block.id === 'block:obs')
    const cases = [
      ['block:obs', obsBlock ? obsBlock.memberCount : -1, '过程块数自己的成员'],
      ['block:const', 0, '层不给入口'],
      ['eps_heat', 0, '成员一律 0（不数它自己的实现步骤）'],
      ['p21', 0, '成员一律 0（也不数它所属块的成员数）'],
    ]
    for (const [id, want, what] of cases) {
      ok(
        subgraphSizeOf(id) === want,
        `子节点数 · ${what}（\`${id}\` → ${want}）`,
        `\`${id}\` 数成了 ${subgraphSizeOf(id)}`,
      )
    }
    ok(
      viewSource.includes('subgraphSizeOf') && !viewSource.includes('blockOf(id)'),
      '子节点数与「进入子图」走同一处判据（`subgraphSizeOf`），没有按"装在哪个块里"数',
      '视图又按 `blockOf` 自己数了一遍子节点',
    )
    ok(
      !/\.subgraphs\b/.test(viewSource),
      '视图不读已退场的 `graph.subgraphs` 索引',
      '视图还在读 `.subgraphs`',
    )
  }

  ok(viewSource.includes('<Inspector'), '右侧检查器复用第一页的组件（不是自己另画一个）', '')
  ok(viewSource.includes('CodePreviewDrawer') && viewSource.includes('MdReaderDrawer'), '源码预览与文档阅读复用第一页的抽屉', '')
  /**
   * **块属性页**（task 3.3）：块不是"名字 + 摘要"的盒子——它要能回答"装了哪些量、算在哪段代码里"。
   * 成员明细由**页面**把生成物里的事实喂给检查器（`blockDetail`），检查器自己不认物理链
   * （不 import 它），所以画布页那份用法一个字都不用改。
   * 「算在哪段代码里」不再由点不开的摘要回答：
   * 改由两个引用入口回答，下面有一条反面断言守着它们不回来。
   *
   * **不列对外接口**：跨块送了什么在画布上悬浮块时就看得见，
   * 右侧栏再铺一张进出清单是重复——下面有一条反面断言守着它长不回来。
   */
  /** 把注释去掉再查：注释写口径（例："本页不列对外接口"）不算界面内容，JSX / 字符串才算 */
  const stripComments = (source) =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  const inspectorFile = 'src/components/Inspector.tsx'
  const inspectorSource = await fs.readFile(inspectorFile, 'utf8').catch(() => '')
  /** 去注释后的检查器源码：下面的界面断言都查它（注释里写明口径不算界面内容） */
  const inspectorCode = stripComments(inspectorSource)
  ok(inspectorSource.length > 0, '检查器源码可读（块属性页就复用这一个组件）')
  /** 标签明细里也印着"出处"（同一栏、同一口径：只给文件名，见下面那条反面断言） */
  const nodeTagsSource = await fs.readFile('src/components/NodeTags.tsx', 'utf8').catch(() => '')
  ok(
    viewSource.includes('blockDetail={blockDetail}'),
    '块属性页的事实由页面喂给检查器（成员明细）',
    '页面没把块的事实递进来 ⇒ 块属性页还只是"名字 + 摘要"',
  )
  ok(
    !/from '\.\.\/lib\/physicsChain'/.test(inspectorSource),
    '检查器不 import 物理链（仍是通用模板，画布页原样可用）',
    '检查器里混进了物理链的依赖',
  )
  ok(
    stripComments(inspectorSource).includes('成员明细'),
    '块属性页给出「成员明细」（成员可点：点一下即选中该成员）',
    '块属性页少了成员明细',
  )
  /**
   * **摘要位置按 `formula` 分流**：带公式的对象（产物逐字带着真源那份 LaTeX）读到排过版的公式，
   * 其余对象走原来的输入框。判据是**一个字段**（`node.formula`），不按节点种类另写名单；
   * 检查器也不因此 import 物理链（上面那条断言继续管着）。
   *
   * 查的是**去注释后的源码**：注释里说明口径不算界面内容。两条一起看才有意义——
   * 有公式的那一支是 `Formula`，且它排在输入框**前面**（三元的第一支），
   * 也就是「有公式就不出输入框」。
   */
  const summaryBranch = (() => {
    const at = inspectorCode.indexOf('node.formula')
    return at < 0 ? '' : inspectorCode.slice(at, at + 800)
  })()
  ok(
    Boolean(summaryBranch),
    '摘要位置接了 `formula`（有公式的对象不走通用形态）',
    '摘要位置没接公式',
  )
  ok(
    summaryBranch.includes('<Formula') && summaryBranch.indexOf('<Formula') < summaryBranch.indexOf('<Textarea'),
    '有公式的那一支渲染公式、输入框只在另一支（有公式时不出输入框）',
    '公式没顶掉输入框（或公式那一支没走 `Formula`）',
  )
  /** 公式那一处只讲物理：不许顺带印文件名、行号或阶段号（它是这一页的物理，不是代码坐标） */
  const formulaSource = await fs.readFile('src/components/Formula.tsx', 'utf8').catch(() => '')
  ok(formulaSource.length > 0, '公式渲染件存在（`src/components/Formula.tsx`）')
  ok(
    !/\.sites|codeAnchor|\bstage\b|refLocationShort/.test(stripComments(formulaSource)),
    '公式那一处不带代码坐标（文件名 / 行号 / 阶段号）',
    '公式渲染件里混进了代码坐标',
  )
  /**
   * **反面断言：块的一级注释不印两遍**。
   *
   * 那句话（真源 `blocks.items[].note`：为什么这么切 + 量化事实）退场的是**成员明细区那一处出口**；
   * 它仍在**摘要位置**读到——产物里块的 `summary` 就是它（下面第一条断言逐块对拍），
   * 字段本身也仍在真源与产物里。查的是去注释后的源码：注释里写明口径不算界面内容。
   */
  const blockNoteMismatch = (chain.blocks?.items ?? [])
    .filter((block) => {
      const summary = (artifact.graph?.nodes ?? []).find((node) => node.id === block.id)?.summary
      return summary !== block.note
    })
    .map((block) => block.id)
  ok(
    blockNoteMismatch.length === 0,
    '块的一级注释仍在摘要位置读到（产物里块节点的 `summary` 逐块等于真源 `blocks.items[].note`）',
    blockNoteMismatch.join(','),
  )
  ok(
    !inspectorCode.includes('block.note'),
    '成员明细区不再印一遍块的一级注释（只在摘要位置读一次）',
    '块属性页又把块的一级注释印了一遍',
  )
  ok(
    !stripComments(viewSource).includes('note: block.note'),
    '页面不再把块注释递进检查器（那一处出口已退场）',
    '页面还在把块注释递进去',
  )
  /**
   * **反面断言：右侧栏不设"点不开的摘要"**。
   *
   * 从前的两行——块的「代码锚」（`SpinTemperatureBox.c · ComputeTsBox()`）与「阶段号」（`S14`）——
   * 没有行号、点不开，读的人拿不到可核验的落点；现在"这块 / 这个量算在哪段代码里"只由那条小标签页回答
   * （「源码」标签的文件 + 行区间，「文献」标签的文档）。字段本身仍在生成物里、仍被本脚本逐条断言，
   * 删掉的只是**界面出口**。
   *
   * 查的是**去注释后的源码**，且只认"成行的那种写法"（`>阶段号</div>`、`label="代码锚"`）：
   * 注释里写明口径不算界面内容，散文里出现"锚到某个节点上"这类说法也不算一行摘要。
   */
  const digestRows = [
    ...stripComments(inspectorSource).matchAll(/>\s*(代码锚|阶段号)\s*</g),
    ...stripComments(inspectorSource).matchAll(/label="(代码锚|阶段号)"/g),
  ].map((match) => match[1])
  ok(
    digestRows.length === 0,
    '右侧栏不出现「代码锚 / 阶段号」这类点不开的摘要（两者仍在生成物里，只是没有界面出口）',
    `长回来了：${[...new Set(digestRows)].join(',')}`,
  )
  /**
   * **反面断言：证据入口是一条小标签页，不是一排"看 XX（N）"的按钮**。
   *
   * 从前是两行全宽按钮：「看实现（12）」+ 行尾「展开 / 收起」，话多、占地方。现在收成**一条**
   * 分段标签页：标签上只有类别与数量（`源码 12` / `文献 3`），选中才铺开**那一类**，
   * 两类不同时铺开。查的是**去注释后的源码**：标签页要在（`role="tablist"` + `role="tab"`），
   * 那两句啰嗦文案不许长回来（"展开 / 收起"在页面别处仍有正当用处，故这里只钉这两个词）。
   */
  ok(
    /role="tablist"/.test(stripComments(inspectorSource)) && /role="tab"/.test(stripComments(inspectorSource)),
    '右侧栏的两类引用收在一条小标签页里（切换着看，不同时铺开）',
    '标签页没了：又变回一行行的入口按钮',
  )
  const noisyEvidenceCopy = ['看实现', '看文献'].filter((text) => stripComments(inspectorSource).includes(text))
  ok(
    noisyEvidenceCopy.length === 0,
    '证据入口不再有「看实现 / 看文献」这类话（类别与数量直接写在标签上）',
    noisyEvidenceCopy.join(','),
  )
  /**
   * **反面断言：卡片上的落点只给不带目录的文件名**。
   * `SpinTemperatureBox.c:120-145`、`thermal.md#members`——一眼要看的是"哪个文件、哪几行 / 哪一节"，
   * 目录前缀（`src/py21cmfast/src/`、`physics-chain/modules/`）是噪声。完整路径不丢，退到 `title` 里。
   * 查的是**去注释后的代码**：两处显示引用落点的地方都必须走 `refLocationShort`。
   */
  ok(
    /refLocationShort\(/.test(stripComments(inspectorSource)) &&
      /refLocationShort\(/.test(stripComments(nodeTagsSource)),
    '引用卡片与标签明细只印不带目录的文件名（完整路径退到 title）',
    '又在界面上印完整路径了',
  )
  /**
   * **反面断言：物理链页的「源码」清单按文件归并**。
   *
   * 一个模块的落点常挤在同一个文件里（M8 的 19 条落点里有 7 条在 `heating_helper_progs.c`、
   * 6 条在 `SpinTemperatureBox.c`），一条引用一张卡就是十几张同样开头的卡；主行还要重印成员名——
   * 而成员明细就在同一面板上方。所以：同一文件的区间合成一条，**主行只印文件名**
   * （`codeRefFileName`），行区间逐条列出（`codeRefLineRange`）、每条自己可点。
   * 画布页（可编辑引用）保持一条一张卡，故这里只钉三个记号在 `Inspector` 里。
   */
  ok(
    /codeGroups\(/.test(stripComments(inspectorSource)) &&
      /codeRefFileName\(/.test(stripComments(inspectorSource)) &&
      /codeRefLineRange\(/.test(stripComments(inspectorSource)),
    '物理链页「源码」清单按文件归并（主行＝文件名、行区间逐条可点）',
    '又一条引用一张卡了（同一文件被拆成多张，主行还印成员名）',
  )
  ok(
    viewSource.includes('block.members') && !viewSource.includes('block.stages'),
    '块属性页只从生成物读成员（块的阶段号并集已无界面出口）',
    '页面自己编了成员，或又把块阶段号读了回来',
  )
  /**
   * **反面断言：右侧栏不列对外接口**。
   * 跨块接口由画布上的接口边承载（静息不画、悬浮显现）；属性页再铺一张进出清单是重复。
   * 数据侧的对应关系仍在生成物里（`interfaceIn` / `interfaceOut`），由上面那条"每条接口边
   * 恰被两端认领一次"的断言守着——删掉的是**界面**，不是这份可核对的事实。
   *
   * 查的是**去注释后的代码**：注释里写"本页不列对外接口"是把口径说清楚，它渲染不出东西来。
   */
  ok(
    !/对外接口/.test(stripComments(inspectorSource)) && !/interfaceOut|interfaceIn/.test(stripComments(viewSource)),
    '块属性页不列对外接口（跨块接口只在画布上悬浮显现）',
    '右侧栏又长回了「对外接口」段',
  )
  /**
   * **块属性页要能走进去**：点成员＝选中它；成员名取自生成物（`labelOf` 解标签），不是手抄的。
   * 成员行里没有阶段号那一列（撤掉的那一列由下面的「呈现面」一节守着，不许长回来）。
   */
  ok(
    /onSelectNode=/.test(viewSource) && /labelOf\(/.test(viewSource),
    '成员可点选中，成员名取自生成物的标签（不是手写的名字）',
    '块属性页里的成员点不动，或名字是手写的',
  )
  /**
   * 反例：这一页一切名字都读生成物；源码里出现具体块名 / 量名，说明界面把内容写死了。
   * **只查代码，不查注释**——注释里举例说明口径是允许的（它进不了界面）；
   * 真正的写死是在 JSX / 字符串里。
   */
  const codeOnly = `${stripComments(viewSource)}\n${stripComments(inspectorSource)}`
  const hardcodedNames = ['Q_HII', 'T_γ', '电离史', '气体热史'].filter((name) => codeOnly.includes(name))
  ok(hardcodedNames.length === 0, '界面代码里没有写死的块名 / 量名（全从生成物读）', hardcodedNames.join(','))

  /**
   * **跨红移回流：默认不画的那一类边**（开关关 ＝ 画布上没有它们）。
   *
   * 按**同一个字段**（边的种类标记）把边分成两组，独立重算两件可证伪的事，都不信任生成器的标注：
   *   · 关（默认可见组，`kind !== 'feedback'`）＝ 有向环 **0** 个；
   *   · 开（加回回流组）＝ **恰好 1** 个环簇，且每条回流边的两端块都落在环簇里。
   * 环簇的成员与条数都从产物算出来（今天 4 个块），不写死是哪几个块——回流段增删一条，这里跟着变。
   * 另有一条反向断言：工程图谱 `data/graph.json` 里没有这类边（画布页因此零影响，也不该有那个开关）。
   */
  console.log('\n[跨红移回流：默认不画、只辖产物标记的边]')
  {
    const edges = canvasGraph?.edges ?? []
    const nodeById = new Map(allGraphNodes.map((node) => [node.id, node]))
    const feedbackEdges = edges.filter((edge) => edge.kind === 'feedback')
    const defaultVisible = edges.filter((edge) => edge.kind !== 'feedback')
    ok(feedbackEdges.length >= 1, '产物里有标为跨红移回流的边（否则开关没有可管对象）', String(feedbackEdges.length))
    /**
     * 标记要自洽：`kind` 是 `feedback`（生成器与视图同读这一个标记）、
     * `crossLink` 为真（它绕开树脊画弧）、`surface` 为真（要出现在画布上）、**不带 `focusOnly`**
     * ——它归开关管（连同它在弧两端块子图里的落点与落点那些盒子），不借接口边那套"静息不画、悬浮才显现"。
     */
    const badMarks = feedbackEdges.filter(
      (edge) =>
        edge.kind !== 'feedback' || edge.crossLink !== true || edge.surface !== true || edge.focusOnly === true,
    )
    ok(
      badMarks.length === 0,
      '回流边的标记自洽（kind = feedback、crossLink 与 surface 为真、不带 focusOnly）',
      badMarks.slice(0, 3).map((edge) => edge.id).join(','),
    )
    /**
     * **只有回流边带回流标记**：视图按这个标记摘边，多标一条就等于顺手藏掉一条主序边。
     * 「默认可见 ⊎ 回流 = 全部边」是同一件事的另一面：关掉开关少掉的恰好是这几条。
     */
    const declaredFeedback = edges.filter((edge) => edge.kind === 'feedback')
    ok(
      declaredFeedback.length === feedbackEdges.length && declaredFeedback.every((edge) => edge.kind === 'feedback'),
      '带回流种类标记的边恰是这一类（关掉开关时少掉的只有它们）',
      `kind ${declaredFeedback.length} vs 回流 ${feedbackEdges.length}`,
    )
    const bothSides = [...defaultVisible, ...feedbackEdges].map((edge) => edge.id).sort()
    ok(
      JSON.stringify(bothSides) === JSON.stringify(edges.map((edge) => edge.id).sort()),
      '「默认可见 ⊎ 回流 = 全部边」（一条不多一条不少）',
      `${defaultVisible.length} + ${feedbackEdges.length} vs ${edges.length}`,
    )
    /**
     * **标签只写这条弧交付的那个量**（与接口边同一条口径：写**来源端**的量名，如 `T_S(z)`），
     * 不写 `T_S(z) → Ṅ_ion(z)` 这种两端并列——收方那个量在它的子图里就是落点边的端点，
     * 箭头上再写一遍等于把两个盒子名抄到一条线上（口径见 `docs/notes/graphify/G4-物理链.md` §2.2）。
     * 期望值在这里从真源节点表现算，所以真源换了端量而产物没跟着换，这里就报出来。
     */
    const wantLabel = new Map(
      (chain.feedback ?? []).map((item) => [
        `feedback:${item.from}->${item.to}`,
        symbolOfNode.get(item.fromNode) ?? item.fromNode,
      ]),
    )
    const badLabel = feedbackEdges.filter((edge) => edge.label !== wantLabel.get(edge.id))
    ok(
      badLabel.length === 0,
      '回流边的标签 = 交付的那个量（来源端符号，与真源 feedback 段逐字一致）',
      badLabel.slice(0, 3).map((edge) => `${edge.id}=${edge.label}｜期望 ${wantLabel.get(edge.id)}`).join(','),
    )
    /**
     * **弧画在一级、关系落进子图**：弧的两端是一级块（父级是**段容器**，因此这条弧本身进不了任何子图），
     * 但同一件事在子图里要讲得出来——收方块的成员确实读上一轮的那个量，来源块的成员也确实把它送了出去。
     * 两件事分开查。
     */
    const segParentOf = (id) => String(nodeById.get(id)?.parent ?? '')
    const notTopLevel = feedbackEdges.filter(
      (edge) =>
        !String(edge.source).startsWith('block:') ||
        !String(edge.target).startsWith('block:') ||
        !segParentOf(edge.source).startsWith('seg:') ||
        !segParentOf(edge.target).startsWith('seg:'),
    )
    ok(
      notTopLevel.length === 0,
      '每条回流边的两端都是一级块（父级是段容器，弧画在一级，不冒充实现在某个块里）',
      notTopLevel.slice(0, 3).map((edge) => edge.id).join(','),
    )
    /**
     * **回流在子图里的落点**（一级讲回声，进到块里指着两个量说）。
     *
     * 视图把每条回流边按产物的 `fromNode` / `toNode` 落成**成员级边**，方向恒为 `fromNode → toNode`，
     * 并在**弧两端块各派一条**（同一个端点对、同一档样式，靠 `subgraphOf` 分别收口）：
     *   · 收方块那侧（`subgraphOf: target`）：讲"这一步把它读进来"——它是本块的对外输入；
     *   · 来源块那侧（`subgraphOf: source`）：讲"上一轮把它送出去"——它是本块的对外输出。
     * 两侧都要把对面那个量并进本块的对外输入去灰显（收方块并 `fromNode`、来源块并 `toNode`），
     * 否则这条成员级边在那一侧根本没有第二个端点。这里不信任生成器的标注，从块表反查四件事：
     *   · 两端量各就各位：`toNode` 是**收方块**的成员、`fromNode` 是**来源块**的成员，且互不越界；
     *   · 两端块的子图里两端都在（两侧的成员级边都画得出来），搭伴的盒子不会缺一半；
     *   · 别的块的子图里，任何一条回流的两端**不同时**在场（派生边不串台）；
     *   · 一一对应：每条回流边恰好落进**两个**块（`target` 与 `source` 各一条），不多不少。
     *
     * 这里算的是**投影**（哪些盒子进哪个块），与浮层上那个开关的状态无关：显隐是同一件事的视图面，
     * 落在样式层——开关只切类名，投影与坐标都不动（源码侧由下面「关闭态一条辖三样」那几条断言守）。
     */
    const memberOf = new Map(blockOutItems.map((item) => [item.id, new Set(item.members ?? [])]))
    const misplacedEnds = feedbackEdges.filter(
      (edge) =>
        !memberOf.get(edge.target)?.has(edge.toNode) ||
        !memberOf.get(edge.source)?.has(edge.fromNode) ||
        memberOf.get(edge.target)?.has(edge.fromNode) ||
        memberOf.get(edge.source)?.has(edge.toNode),
    )
    ok(
      misplacedEnds.length === 0,
      '回流的两端量各就各位（`toNode` 只属收方块、`fromNode` 只属来源块，互不越界）',
      misplacedEnds.map((edge) => `${edge.id}:${edge.fromNode}->${edge.toNode}`).join(','),
    )
    const inGraph = new Set(allGraphNodes.map((node) => node.id))
    /**
     * 子图可见集（与视图同一条公式）：成员 + 焦点声明的对外输入 + **回流的两端**
     * （上一轮送来的量、上一轮送出去的量的目的地）。
     */
    const subgraphVisibleOf = (item) =>
      new Set([
        ...(item.members ?? []).filter((id) => inGraph.has(id)),
        ...(item.contexts ?? []),
        ...feedbackEdges.filter((edge) => edge.target === item.id).map((edge) => edge.fromNode),
        ...feedbackEdges.filter((edge) => edge.source === item.id).map((edge) => edge.toNode),
      ])
    const projected = []
    const stranded = []
    /**
     * 别的块的子图里也同时有这两端的情形：那时画的是**那个块自己的关系**（如电离史里
     * `Ṅ_ion → Q_HII` 是本轮的正向依赖，方向与回流相反）。所以要查的是——那两个盒子在那里
     * 不能孤零零地并排：本块至少有一条别的边连着它们。只声明给两端块收口（`subgraphOf`）当然也要有，
     * 那是视图侧的类名断言；这里查的是"别处的这两个盒子本来就有自己的说法"。
     */
    const elsewhere = []
    const lonePair = []
    for (const item of blockOutItems) {
      const visible = subgraphVisibleOf(item)
      for (const edge of feedbackEdges) {
        const bothEnds = visible.has(edge.fromNode) && visible.has(edge.toNode)
        /** 这条弧在**这一块**的标签页里落到哪一侧：收方块讲"读进来的"、来源块讲"送出去的"，别处不画 */
        const side = item.id === edge.target ? 'input' : item.id === edge.source ? 'output' : null
        if (side) {
          const where = `${item.id}:${edge.fromNode}->${edge.toNode}#${side}`
          if (bothEnds) projected.push(where)
          else stranded.push(where)
        } else if (bothEnds) {
          const ends = new Set([edge.fromNode, edge.toNode])
          const own = blockEdgesAll.some(
            (other) =>
              other.kind !== 'feedback' &&
              ends.has(other.source) &&
              ends.has(other.target) &&
              visible.has(other.source) &&
              visible.has(other.target),
          )
          elsewhere.push(`${item.id}:${edge.id}`)
          if (!own) lonePair.push(`${item.id}:${edge.id}`)
        }
      }
    }
    ok(
      projected.length === feedbackEdges.length * 2 && stranded.length === 0,
      '每条回流边在弧两端块的子图里各落成一条成员级边（收方块侧讲"读进来的"、来源块侧讲"送出去的"）',
      `${projected.length} vs ${feedbackEdges.length * 2}；缺 ${stranded.slice(0, 3).join(',')}`,
    )
    ok(
      lonePair.length === 0,
      '别的块子图里也出现这两端时，那里已经有一条本块自己的关系连着它们（不靠这条回流，也不是两个孤盒）',
      lonePair.slice(0, 3).join(','),
    )
    /**
     * **同一张子图里不许有两条同端点对、都走直线的边**。两条直线画在同一个端点对上会**完全叠住**——
     * cytoscape 的自动错开只在**同一种 `curve-style`** 的平行边之间生效，而产物边那档走的是基础档的
     * `straight`（两框中心连线，方向可预读），叠起来读成"这里只有一条关系"，反向的那个箭头被盖掉。
     *
     * 今天出现的正是这种叠法：本轮的 `Ṅ_ion → Q_HII`（网格化源项里算 `Ṅ_ion` 要用 `Q_HII`）与落点
     * `Q_HII → Ṅ_ion`（上一轮的 `Q_HII` 被送了过来），网格化源项与电离场两张子图里各一对，端点对相同、
     * 方向相反。落点边那档已显式换成 `unbundled-bezier` 鼓开（样式表里的 `edge.feedback-input`，
     * 源码侧由下面那条断言守），所以判据落在**坏的那一种**上：两条**都是产物边**才判失败——
     * 那条路没有曲线可用，得去改样式表；"产物边 + 落点边"是今天正常且必需的分开画法。
     */
    const overlapping = []
    const sameEndPairs = []
    for (const item of blockOutItems) {
      const visible = subgraphVisibleOf(item)
      const drawn = [
        ...blockEdgesAll
          .filter((edge) => edge.kind !== 'feedback' && visible.has(edge.source) && visible.has(edge.target))
          .map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, made: '产物边' })),
        ...feedbackEdges
          .filter(
            (edge) =>
              (edge.target === item.id || edge.source === item.id) &&
              visible.has(edge.fromNode) &&
              visible.has(edge.toNode),
          )
          .map((edge) => ({
            id: `${edge.id}#${edge.target === item.id ? 'input' : 'output'}`,
            source: edge.fromNode,
            target: edge.toNode,
            made: '落点边',
          })),
      ]
      for (let i = 0; i < drawn.length; i += 1) {
        for (let j = i + 1; j < drawn.length; j += 1) {
          const [a, b] = [drawn[i], drawn[j]]
          const sameEnds =
            (a.source === b.source && a.target === b.target) || (a.source === b.target && a.target === b.source)
          if (sameEnds) {
            sameEndPairs.push(`${item.id}:${a.id}|${b.id}`)
            if (a.made === '产物边' && b.made === '产物边') overlapping.push(`${item.id}:${a.id}|${b.id}`)
          }
        }
      }
    }
    ok(
      overlapping.length === 0,
      '子图里没有两条同端点对、都走直线的产物边（那种叠法只能靠曲线分开，得去样式表再弯一条）',
      overlapping.slice(0, 3).join(','),
    )
    console.log(
      `  · 子图里的落点 ${projected.length} 条（例：${projected[0] ?? '（无）'}），两端量一并灰显` +
        (elsewhere.length ? `；另有 ${elsewhere.length} 处两端同场（本块自己的关系，方向未必相同）：${elsewhere.join(' ')}` : '') +
        (sameEndPairs.length ? `；同端点对的边对 ${sameEndPairs.length} 处靠曲线分开：${sameEndPairs.join(' ')}` : ''),
    )
    /**
     * **关 ＝ 0 环、开 ＝ 恰好 1 个环簇**：强连通分量在这里独立重算（Tarjan），节点取产物的全部节点、
     * 边按上面那两组分头喂进去。环簇必须是回流接上的：每条回流边的两端块都得落在那唯一的环簇里，
     * 否则"回声"就是从别处冒出来的。成员不许有量——块间的环只由块与接口边构成。
     */
    const ringClusters = (edgeList) => {
      const index = new Map()
      const low = new Map()
      const onStack = new Set()
      const stack = []
      const clusters = []
      const out = new Map()
      for (const edge of edgeList) {
        if (!out.has(edge.source)) out.set(edge.source, [])
        out.get(edge.source).push(edge.target)
      }
      let counter = 0
      const walk = (node) => {
        index.set(node, counter)
        low.set(node, counter)
        counter += 1
        stack.push(node)
        onStack.add(node)
        for (const next of out.get(node) ?? []) {
          if (!index.has(next)) {
            walk(next)
            low.set(node, Math.min(low.get(node), low.get(next)))
          } else if (onStack.has(next)) low.set(node, Math.min(low.get(node), index.get(next)))
        }
        if (low.get(node) === index.get(node)) {
          const cluster = []
          let popped
          do {
            popped = stack.pop()
            onStack.delete(popped)
            cluster.push(popped)
          } while (popped !== node)
          if (cluster.length > 1) clusters.push(cluster)
        }
      }
      for (const node of allGraphNodes) if (!index.has(node.id)) walk(node.id)
      return clusters
    }
    const closedRings = ringClusters(defaultVisible)
    ok(
      closedRings.length === 0,
      '关：默认可见边没有有向环（强连通分量独立重算）',
      closedRings.map((ring) => ring.join('>')).slice(0, 3).join(' '),
    )
    const openRings = ringClusters(edges)
    ok(openRings.length === 1, '开：加回回流边后恰好 1 个环簇（"关＝0 环、开＝回声"是可证伪的口径）', `实际 ${openRings.length} 个`)
    const ring = openRings[0] ?? []
    const ringSet = new Set(ring)
    const outsideRing = feedbackEdges.filter((edge) => !ringSet.has(edge.source) || !ringSet.has(edge.target))
    ok(
      outsideRing.length === 0,
      '每条回流边的两端块都在环簇里（环是回流接上的，不是别处冒出来的）',
      outsideRing.map((edge) => edge.id).join(','),
    )
    const ringNonBlock = ring.filter((id) => !String(id).startsWith('block:'))
    ok(ringNonBlock.length === 0, '环簇成员全是一级块（量不进块间的环）', ringNonBlock.slice(0, 3).join(','))
    /**
     * **反向断言**：工程图谱（画布页）里没有这类边——开关对那一页零影响，那一页也就不该出现这个开关。
     */
    const legacyRaw = await fs.readFile(DATA_GRAPH, 'utf8').catch(() => null)
    const legacyEdges = legacyRaw ? (JSON.parse(legacyRaw).edges ?? []) : []
    const legacyFeedback = legacyEdges.filter((edge) => edge.kind === 'feedback' || edge.kind === 'feedback')
    ok(Boolean(legacyRaw) && legacyFeedback.length === 0, '工程图谱 data/graph.json 里没有回流边（画布页零影响）', String(legacyFeedback.length))
    console.log(
      `  · 关：0 环 · 开：1 个环簇（${ring.length} 个块：${ring.join('、')}）· 回流 ${feedbackEdges.length} 条 / 默认可见 ${defaultVisible.length} 条`,
    )
  }

  console.log('\n[子图：成员 + 块内边 + 对外输入（灰显的上下文）]')
  {
    /**
     * **块子图的可见集**：与视图同一条公式（`graph/hierarchy.ts` 的 `tabVisibleIds` 用在块上）
     * —— 成员的直系子节点 + 焦点声明的**对外输入**；成员的子节点**不再往下一层钻**。
     * 这里独立重算，用来钉两件互为反面的事：块内边要看得见（4.1）、实现步骤不铺开（4.4）。
     */
    /**
     * 子图的可见集 = 成员 + 对外输入，再按"真的在图上的 id"过一遍：块的成员都是物理量、本来就在图上，
     * 这层过滤是为"成员指向了还没画出来的量"兜底，免得拿不存在的 id 去跟画布对账。
     */
    const graphNodeIds = new Set(allGraphNodes.map((node) => node.id))
    /**
     * **视图喂给渲染器的那份投影**（`PhysicsChainView` 的 `feedbackInputs`）：块的对外输入 = 产物声明的
     * `contexts` + **回流的两端**（上一轮送进来的量、上一轮送出去那个量的目的地）——两侧都要在场，
     * 派生出来的成员级边才画得出来。判据仍在产物上——哪一条回流指进这一块，它的 `fromNode` 就属于
     * 这一块的对外输入；哪一条从这一块出去，它的 `toNode` 就属于这一块的对外输入（上一节逐条对过）。
     * 本块已声明为对外输入的不重复并进去（电离场声明了 `Ṅ_ion`，同时上一轮又把 `Ṅ_ion` 送了出去）。
     * 下面按这份投影建层级、重算可见集，真跑 `tabVisibleIds` / `tabContextIds` 才对得上。
     */
    const lastRoundInputs = new Map()
    const sentToNextRound = new Map()
    for (const edge of feedbackEdgesAll) {
      lastRoundInputs.set(edge.target, [...(lastRoundInputs.get(edge.target) ?? []), edge.fromNode])
      sentToNextRound.set(edge.source, [...(sentToNextRound.get(edge.source) ?? []), edge.toNode])
    }
    const projectedContextsOf = (item) => {
      const declared = item.contexts ?? []
      const extra = [...(lastRoundInputs.get(item.id) ?? []), ...(sentToNextRound.get(item.id) ?? [])]
      return [...declared, ...extra.filter((id) => !declared.includes(id))]
    }
    /** 子图可见集 = 成员（真的是节点的那些）+ 对外输入 */
    const subgraphIds = (item) =>
      new Set([...(item.members ?? []).filter((id) => graphNodeIds.has(id)), ...projectedContextsOf(item)])
    const internalOf = new Map(blockOutItems.map((item) => [item.id, []]))
    for (const edge of internalEdges) internalOf.get(blockOfNode.get(edge.source))?.push(edge)
    const enterableOut = blockOutItems.filter((item) => item.enterable)

    // —— 4.1 双击可进入的块打开子图（成员 + 块内边）——
    const invisibleInternal = []
    for (const item of blockOutItems) {
      const visible = subgraphIds(item)
      for (const edge of internalOf.get(item.id) ?? []) {
        if (!visible.has(edge.source) || !visible.has(edge.target)) invisibleInternal.push(`${item.id}:${edge.source}->${edge.target}`)
      }
    }
    ok(
      invisibleInternal.length === 0,
      '每条块内边的两端都在本块子图的可见集里（进得去就一定看得见，箭头不会指到看不见的节点）',
      invisibleInternal.join(','),
    )
    const wrongInternalCount = blockOutItems.filter((item) => (item.internalEdgeCount ?? -1) !== (internalOf.get(item.id) ?? []).length)
    ok(
      wrongInternalCount.length === 0,
      '块上记的 `internalEdgeCount` = 独立重算的块内边条数',
      wrongInternalCount.map((item) => item.id).join(','),
    )
    const memberNotVisible = enterableOut.filter((item) => (item.members ?? []).some((id) => !subgraphIds(item).has(id)))
    ok(
      memberNotVisible.length === 0,
      '每个成员都在自己块的子图可见集里（10 个过程块的成员一个不漏）',
      memberNotVisible.map((item) => item.id).join(','),
    )
    /**
     * **子图必须有结构**：成员下限与一条块内关系都落在"可进入"这一侧。判据不落在"块内连通"
     * （成员分两簇的过程块照旧可进入，见上面 `components` 那一节），只要求进得去之后有东西看。
     * 第三个断言说的是反面包：子图只对过程块开，所以层（常数与网格）没有子图，
     * 层里的成员（只在层里出现的那个量）不会作为成员铺进任何子图。
     */
    const thinBlocks = enterableOut.filter((item) => (item.members ?? []).filter((id) => graphNodeIds.has(id)).length < 2)
    ok(
      thinBlocks.length === 0,
      '可进入的块至少 2 个成员（进去不会只看到一个孤盒）',
      thinBlocks.map((item) => `${item.id}(${(item.members ?? []).length})`).join(','),
    )
    const edgelessBlocks = enterableOut.filter((item) => (internalOf.get(item.id) ?? []).length === 0)
    ok(
      edgelessBlocks.length === 0,
      '可进入的块至少 1 条两端都是本块成员的关系（子图里画得出箭头）',
      edgelessBlocks.map((item) => item.id).join(','),
    )
    ok(
      enterableOut.every((item) => item.kind === 'process'),
      '子图只对过程块开（层没有子图，层里的成员不进任何子图）',
      enterableOut.filter((item) => item.kind !== 'process').map((item) => item.id).join(','),
    )
    /**
     * 4.1 的验收点（可证伪的那一个）：热史块（M8）的子图里能看到 `ε_heat → T_K`（**块内边**、方向向下），
     * 而 `L_X → ε_heat` **不在块内**——`L_X` 由 M5 的星系属性算出，在 M8 的子图里是灰显的对外输入。
     * 这一对"一条在里面、一条在外面"正是"块边界 = 代码模块边界"的直接证据：旧稿把 `L_X` 与 `ε_heat`
     * 装在同一块里（所以旧口径根本看不到这条接口），新口径下它们是两个 `Compute*` 步之间的接口。
     */
    const thermalBlock = blockOutItems.find((item) => ['eps_heat', 'tk'].every((id) => (item.members ?? []).includes(id)))
    const thermalChain = (thermalBlock ? internalOf.get(thermalBlock.id) ?? [] : [])
      .map((edge) => `${edge.source}->${edge.target}`)
      .sort()
    ok(
      Boolean(thermalBlock) && thermalChain.includes('eps_heat->tk') && !thermalChain.includes('lx->eps_heat'),
      'M8 的子图里 `ε_heat → T_K` 是块内边，而 `L_X → ε_heat` 是跨块接口（`L_X` 属 M5，在此灰显）',
      thermalBlock ? `${thermalBlock.id} 的块内边 = ${thermalChain.join(' ')}` : '没有块同时装 ε_heat / T_K',
    )
    const lxToEpsIface = interfaceEdges.find((edge) => edge.id === 'iface:block:galaxy->block:thermal')
    ok(
      Boolean(lxToEpsIface) && lxToEpsIface.label.includes(symbolOfNode.get('lx')),
      '`L_X → ε_heat`（与 `ρ* → J_α`）被汇总成 M5 → M8 的一条接口边，标签写着跨界流动的量名',
      lxToEpsIface ? lxToEpsIface.label : '没有 M5 → M8 的接口边',
    )

    // —— 4.2 灰显的对外输入（上下文节点），且保持只读 ——
    /**
     * 独立重算：对外输入 = 跨块依赖的**源量**（`A → B` 里 A 端那个量，B 才"读"它）。
     * 逐块与生成物的 `contexts` 对账——对不上说明灰显的东西跟"这一块读了什么"不是一回事。
     */
    const expectedContexts = new Map(blockOutItems.map((item) => [item.id, new Set()]))
    for (const edge of crossEdgesAll) expectedContexts.get(blockOfNode.get(edge.target))?.add(edge.source)
    const wrongContexts = blockOutItems.filter(
      (item) => [...new Set(item.contexts ?? [])].sort().join(',') !== [...expectedContexts.get(item.id)].sort().join(','),
    )
    ok(
      wrongContexts.length === 0,
      '每块的 `contexts` = 独立重算的"块外指进来的量"（跨块依赖的源量，逐块对账）',
      wrongContexts.slice(0, 3).map((item) => `${item.id}:${(item.contexts ?? []).join('/')}`).join(','),
    )
    const foreignContexts = []
    for (const item of blockOutItems) {
      for (const id of item.contexts ?? []) {
        if (!blockOfNode.has(id)) foreignContexts.push(`${item.id}:${id}(不是图里的量)`)
        else if (blockOfNode.get(id) === item.id) foreignContexts.push(`${item.id}:${id}(自家成员)`)
      }
    }
    ok(
      foreignContexts.length === 0,
      '对外输入一定是"块外"的真实量（不是自己的成员，也不是幽灵 id）',
      foreignContexts.slice(0, 4).join(','),
    )
    const contextIds = blockOutItems.flatMap((item) => item.contexts ?? [])
    const uniqueContexts = [...new Set(contextIds)]
    /**
     * **不新增对象**（4.2 的验收点）：灰显的对外输入就是主图里那个量**本身**——
     * 全图 id 唯一、`parent` 仍指向它自己的块。于是主图里 `T_γ` 仍然只有一个：
     * 它属于 ⓪环境，只是在 ⑤/⑦/⑧/⑨ 的标签页里额外显形。
     */
    const idCount = new Map()
    allGraphNodes.forEach((node) => idCount.set(node.id, (idCount.get(node.id) ?? 0) + 1))
    const duplicateNodes = [...idCount].filter(([, count]) => count > 1).map(([id]) => id)
    ok(duplicateNodes.length === 0, '对外输入不复制节点（全图 id 唯一，灰显的是同一个对象）', duplicateNodes.join(','))
    const movedParents = uniqueContexts.filter((id) => allGraphNodes.find((node) => node.id === id)?.parent !== blockOfNode.get(id))
    ok(
      movedParents.length === 0,
      '对外输入不改层级（`parent` 仍指向自己的块 ⇒ 主图 / 层级条 / 「N 个子节点」计数都不受影响）',
      movedParents.join(','),
    )
    const orphanContexts = uniqueContexts.filter((id) => !allGraphNodes.find((node) => node.id === id)?.parent)
    ok(
      orphanContexts.length === 0,
      '对外输入都不是一级节点（主图静息仍只有 11 个块，`T_γ` 不会多出来一个）',
      orphanContexts.join(','),
    )
    const contextWithoutHost = uniqueContexts.filter((id) => !blockOutItems.some((item) => (item.contexts ?? []).includes(id)))
    ok(contextWithoutHost.length === 0, '每个对外输入都至少被一个块声明（没有白列的量）', contextWithoutHost.join(','))
    console.log(
      `  · 对外输入 ${contextIds.length} 处 / 去重 ${uniqueContexts.length} 个量（不新增节点）` +
        (uniqueContexts.length
          ? `；例：${symbolOfNode.get(uniqueContexts[0]) ?? uniqueContexts[0]} 属于 ${blockOfNode.get(uniqueContexts[0])}，` +
            `在 ${blockOutItems.filter((item) => (item.contexts ?? []).includes(uniqueContexts[0])).map((item) => item.id).join(' / ')} 的子图里灰显`
          : ''),
    )
    /**
     * **只读**（4.2「保持只读」）：灰显的对外输入是**别的块的量**，在别人的子图里改不动。
     * 本页的编辑类回调本来就一律接成只读提示（一套数据一份写入权），这里把这条纪律钉死在源码上。
     */
    const inspectorMutations = [
      'onPatchNode',
      'onPatchEdge',
      'onRemoveNode',
      'onRemoveEdge',
      'onEditEdge',
      'onConnectFrom',
      'onRemoveRef',
      'onAddCodeRef',
      'onCreateTag',
    ]
    const looseMutations = inspectorMutations.filter((name) => !viewSource.includes(`${name}={readOnlyNotice}`))
    ok(
      looseMutations.length === 0,
      '检查器上的编辑类回调全接成只读提示（子图里点灰显的对外输入改不动任何东西）',
      looseMutations.join(','),
    )
    const stylesSource = await fs.readFile('src/graph/styles.ts', 'utf8').catch(() => '')
    const setupSource = await fs.readFile('src/graph/cytoscapeSetup.ts', 'utf8').catch(() => '')
    ok(
      stylesSource.includes('node.context') && stylesSource.includes('edge.context-edge'),
      '灰显样式落在样式表里（节点 + 由它指进来的那条边；不用虚线：虚线已归「条件/可选」）',
      '样式表里找不到 `node.context` / `edge.context-edge`',
    )
    ok(
      setupSource.includes('tabContextIds') && setupSource.includes("toggleClass('context'"),
      '渲染器按焦点声明的对外输入灰显，并豁免 compound 级联隐藏（否则它们会被自己真正的父块一起藏掉）',
      '渲染器没接上下文这条通路',
    )
    /**
     * **跨红移回流的开合落在类名上**（与 `show-label` 同一套手法）：样式表给出回流关系的独立样式
     * 与它的关闭态，渲染器把边种类映射成类名、并按开关切「关闭态」类——不增删元素，坐标因此不动。
     *
     * ⚠ **顺序**：关闭态那条必须写在 `edge[?focusOnly]` **之后**——cytoscape 后写的规则胜，
     * 排在前面会被它盖掉。这条只能查源码顺序，画布行为靠实走与上面那节的两态环数守。
     */
    const overlaySource = await fs.readFile('src/components/CanvasOverlays.tsx', 'utf8').catch(() => '')
    const canvasSource = await fs.readFile('src/components/GraphCanvas.tsx', 'utf8').catch(() => '')
    const feedbackRuleAt = stylesSource.indexOf('edge.feedback')
    const focusOnlyRuleAt = stylesSource.indexOf('edge[?focusOnly]')
    const feedbackOffRuleAt = stylesSource.indexOf('edge.feedback.feedback-off')
    ok(
      feedbackRuleAt >= 0 && feedbackOffRuleAt >= 0,
      '样式表里有回流关系的独立样式与它的关闭态（`edge.feedback` / `edge.feedback.feedback-off`）',
      '样式表里找不到这两条规则',
    )
    /**
     * **关闭态一条辖住这件事的全部视图面**：一级的弧、它在弧两端块子图里的落点、落点那些盒子里
     * 只因回流才进这一块的。三样分开列选择器（弧与落点画在不同层、另有 `subgraphOf` 收口），
     * 只有"关着就不画"这一条共用——合成一个类名会看不出"这是同一件事的三个视图面"。
     */
    ok(
      /selector: '[^']*edge\.feedback-input\.feedback-off[^']*node\.feedback-context\.feedback-off[^']*'/.test(
        stylesSource,
      ),
      '关闭态一条辖住三样：一级的弧、子图里两端块的落点边、落点那些盒子',
      '关闭态没把子图那两样圈进去',
    )
    ok(
      focusOnlyRuleAt >= 0 && feedbackOffRuleAt > focusOnlyRuleAt,
      '**关闭态那条写在 `edge[?focusOnly]` 之后**（后写的规则胜，排在前面会被它盖掉）',
      `focusOnly@${focusOnlyRuleAt} / 关闭态@${feedbackOffRuleAt}`,
    )
    ok(
      setupSource.includes("toggleClass('feedback'") && setupSource.includes('setFeedbackVisible'),
      '渲染器把回流的边种类映射成类名，并按开关切「关闭态」类（只切类名、不重建元素）',
      '渲染器没接回流这条通路',
    )
    /**
     * **子图里的落点由视图派生、不写回产物**：一级的弧是"块 → 块"，进到块里得是"量 → 量"。
     * 一条弧在**两端块各派一条**（同一个端点对），靠 `subgraphOf` 分别收口 —— 收方块那侧讲"读进来的"、
     * 来源块那侧讲"送出去的"，否则来源块的子图里根本没有这条关系（只有本轮的 `nion → q_hii` 反向边）。
     * 三处接得上才算通：页面按 `fromNode` / `toNode` 派生两次并各声明 `subgraphOf`；渲染器认这个类名
     * 并在别的标签页里收口；样式表给它与一级那档同一份外观。
     */
    ok(
      viewSource.includes('flatMap') &&
        viewSource.includes('#input') &&
        viewSource.includes('#output') &&
        viewSource.includes('subgraphOf: arc.target') &&
        viewSource.includes('subgraphOf: arc.source'),
      '回流在子图里的落点由**视图按产物派生**（同一条弧在两端块各派一条成员级边 + `subgraphOf` 分别收口）',
      '页面没在两端块各派一条落点边',
    )
    ok(
      setupSource.includes("edge.kind === 'feedback-input'") && setupSource.includes("data('subgraphOf')"),
      '渲染器接这两条：子图落点的类名映射 + 「只在所属块的标签页里显形」的收口',
      '渲染器没接子图落点这条通路',
    )
    ok(
      /selector: 'edge\.feedback, edge\.feedback-input'/.test(stylesSource),
      '子图里的落点与一级的弧同一档样式（一眼认得出是同一条关系）',
      '样式表里没有 `edge.feedback-input`',
    )
    /**
     * **落点边在子图里鼓开一格**：它与本轮的产物边常是**同端点对、方向相反**（`Ṅ_ion → Q_HII` 与
     * `Q_HII → Ṅ_ion`），而产物边那档走基础档的 `straight`——两条直线会完全叠住。cytoscape 的自动
     * 错开只在同一种 `curve-style` 的平行边之间生效，所以落点边必须自己换成 `unbundled-bezier`
     * 并给一个固定控制点偏移（`bezier` 的控制点是算出来的只读值，手动指定走不了那一档）。
     */
    ok(
      /selector: 'edge\.feedback-input'[\s\S]{0,240}?'curve-style': 'unbundled-bezier'[\s\S]{0,120}?'control-point-distances':/.test(
        stylesSource,
      ),
      '落点边显式鼓开（`unbundled-bezier` + 固定控制点偏移）：与本轮的产物边同端点对时两条都走直线会完全叠住',
      '样式表没给落点边换曲线（同一张子图里两条同端点对的边会重合）',
    )
    /**
     * **落点不穿"灰细"那件外衣**：`context-edge` 是"从对外输入指进本块"的弱化样式，会把落点那档
     * 品红长划压掉——那条关系在一级与子图里就不像一件事了。所以 `context-edge` 必须排除 `feedback-input`。
     */
    ok(
      /toggleClass\(\s*'context-edge',\s*!edge\.hasClass\('feedback-input'\)/.test(setupSource),
      '回流的落点不挂 `context-edge`（灰细那档会压掉它自己的样式，同一条关系两处看起来会不像一件事）',
      '`context-edge` 没排除落点边',
    )
    ok(
      setupSource.includes("edges('.feedback, .feedback-input')") && setupSource.includes("nodes('.feedback-context')"),
      '渲染器按开关切这三样的「关闭态」类（只切类名、不重建元素，坐标因此不动）',
      '开关的取元素范围没覆盖子图里的落点边与两端盒子',
    )
    ok(
      setupSource.includes("toggleClass('feedback-context'") &&
        setupSource.includes("data('feedbackInputOf')") &&
        setupSource.includes("data('feedbackOutputOf')"),
      '子图里落点两端那些盒子由渲染器按产物标注（`feedbackInputOf` / `feedbackOutputOf`）在当前块里挂类名',
      '渲染器没按当前块标出落点两端那些盒子',
    )
    ok(
      viewSource.includes('...feedbackInputs.edges') && viewSource.includes('feedbackInputOf') && viewSource.includes('feedbackOutputOf'),
      '关掉开关只是切类名：落点边与两端盒在页面交给画布的那份图里始终都在（开关状态不进投影）',
      '页面按开关增删了元素，或没标出落点两端',
    )
    /**
     * **两端量并进对外输入前要去重**：本块可能早就声明了它（电离场声明了 `Ṅ_ion`，同时上一轮又把
     * `Ṅ_ion` 送了出去）——重复并进去会在属性页的对外输入清单里列两遍。
     */
    ok(
      /\.\.\.\(sentOut \?\? \[\]\)\]\.filter\(\(id\) => !\(node\.contexts \?\? \[\]\)\.includes\(id\)\)/.test(viewSource),
      '并进对外输入的两端量先去重（本块已声明过的不重复列）',
      '并进投影时没去重',
    )
    ok(
      /if \(!state\) return null/.test(overlaySource) &&
        canvasSource.includes('CrossRedshiftFeedbackToggle state={props.crossRedshiftFeedback}'),
      '开关按"不传就不画"的可选 prop 惯例（画布页不传 ⇒ 浮层上没有它）',
      '开关不是可选的，或画布没把它接进浮层',
    )
    ok(
      overlaySource.includes('产物里没有标为回流的边') && overlaySource.includes('已藏起'),
      '开关自己报出口径（开着 / 关着、藏了几条；产物里没有回流边时写明原因，不摆一个永远为空的开关）',
      '开关的文案没报口径',
    )
    ok(
      /kind === 'feedback'/.test(viewSource),
      '物理链页的条数从产物算（不写死名单与条数）',
      '页面把回流边写死了',
    )
    ok(
      viewSource.includes('contextNote={contextNote}') && inspectorSource.includes('contextNote'),
      '属性页写明"这是外部输入、只读"（文案由页面算好递给检查器，检查器不认物理链）',
      '页面没把灰显身份递进来 ⇒ 用户看到的就是"点开什么都没有的灰盒子"',
    )
    ok(
      /contexts\?\.includes\(selectedNode\.id\)/.test(viewSource),
      '灰显身份由生成物的 `block.contexts` 判定（页面不自己猜上下游）',
      '页面自己重算了"谁是外部输入"',
    )

    // —— 4.3 不可进入的块（层：常数与网格）不给双击与「进入子图 ↗」——
    ok(
      notEnterable.every((item) => (item.members ?? []).length > 0),
      '层真的装着成员（"不可进入"不是空块：`Constants.c` 里那个常数）',
      notEnterable.filter((item) => !(item.members ?? []).length).map((item) => item.id).join(','),
    )
    /**
     * **层只出不进**：层的 `T_γ` 是根部的输入，它当然有出边（→ M8 / M10 的灰显上下文）；
     * 该守的是**没人把层当成下游**——层不该从别的块收接口边（收了就说明它被当成了主序里的一步）。
     */
    const layerIncoming = interfaceEdges.filter((edge) => notEnterable.some((item) => item.id === edge.target))
    ok(
      layerIncoming.length === 0,
      '**层只出不进**：没有块把层当下游（层不是主序里的一步）',
      layerIncoming.map((edge) => `${edge.source}->${edge.target}`).join(','),
    )
    console.log(
      `  · 层的接口边（只出不进）：${interfaceEdges
        .filter((edge) => notEnterable.some((item) => item.id === edge.source))
        .map((edge) => `${edge.source}->${edge.target}(${edge.label})`)
        .join(' ') || '无'}`,
    )
    const layerWithContexts = notEnterable.filter((item) => (item.contexts ?? []).length > 0)
    ok(
      layerWithContexts.length === 0,
      '层没有"对外输入"（灰显上下文是过程块之间的接口才有的）',
      layerWithContexts.map((item) => `${item.id}:${(item.contexts ?? []).join('/')}`).join(' '),
    )
    ok(
      viewSource.includes('!block.enterable'),
      '双击与「进入子图」都拦在 `!block.enterable` 上（层只出只读提示、不开标签页）',
      '视图没拦不可进入的块',
    )
    ok(
      setupSource.includes('enterable: node.enterable !== false') && setupSource.includes("node.data('enterable') === false"),
      '画布按 `enterable` 决定"能不能进去"的信号（层不挂光晕 / 粒子，属性页也不给入口）',
      '画布没按 `enterable` 收信号',
    )

    const hierarchySource = await fs.readFile('src/graph/hierarchy.ts', 'utf8').catch(() => '')
    const tabVisibleBody = hierarchySource.slice(
      hierarchySource.indexOf('export function tabVisibleIds'),
      hierarchySource.indexOf('export function tabContextIds'),
    )
    const contextsLoop = tabVisibleBody.slice(tabVisibleBody.indexOf('if (focusId !== null)'))
    ok(
      contextsLoop.includes('contextsOf.get(focusId)') && !contextsLoop.includes('queue.push'),
      '可见集只多出"对外输入"这一种来源、且只 add 不再下钻（成员的实现步骤不进块子图）',
      '可见集里混进了会下钻的来源',
    )

    // —— 真跑视图的纯函数（`src/graph/hierarchy.ts`）：上面那些独立重算与它逐块对账 ——
    const { buildHierarchy, tabVisibleIds, tabContextIds } = await loadTs('src/graph/hierarchy.ts', 'hierarchy')
    const hierarchy = buildHierarchy(
      allGraphNodes.map((node) => ({
        id: node.id,
        parent: node.parent || null,
        frame: node.type === 'group',
        // 与视图同一份投影：块的对外输入里含回流两端送进 / 送出的那一份（节点只有块会带 contexts，加的是同一批）
        contexts: projectedContextsOf(node),
      })),
    )
    const sameIds = (a, b) => [...a].sort().join(',') === [...b].sort().join(',')
    const visibleMismatch = blockOutItems.filter((item) => !sameIds(tabVisibleIds(hierarchy, item.id), subgraphIds(item)))
    ok(
      visibleMismatch.length === 0,
      '真跑 `tabVisibleIds`：每个块的可见集恰好 = 成员 + 对外输入（与独立重算逐块一致）',
      visibleMismatch.slice(0, 3).map((item) => item.id).join(','),
    )
    /** 灰显的**判据也只认对外输入**（产物 `contexts` + 回流两端那份）：多一个（比如按"块外邻居"现算）会让不该灰的也灰掉 */
    const greyMismatch = blockOutItems.filter((item) => !sameIds(tabContextIds(hierarchy, item.id), new Set(projectedContextsOf(item))))
    ok(
      greyMismatch.length === 0,
      '真跑 `tabContextIds`：灰显的就是对外输入那批（不多不少，含回流两端送进与送出的那两份）',
      greyMismatch.slice(0, 3).map((item) => item.id).join(','),
    )
    const mainVisible = tabVisibleIds(hierarchy, null)
    const mainBlocks = [...mainVisible].filter((id) => String(id).startsWith('block:'))
    const mainSegs = [...mainVisible].filter((id) => nodeById.get(id)?.type === 'group')
    ok(
      mainBlocks.length === 11 && mainVisible.size === 11 + mainSegs.length && mainSegs.length === 2,
      '主图的可见集 = 11 个块 + 2 个段容器（对外输入不进主图）',
      `可见 ${mainVisible.size}（块 ${mainBlocks.length} / 段容器 ${mainSegs.length}）`,
    )
    const thermalForeign = [...tabVisibleIds(hierarchy, thermalBlock.id)]
      .filter((id) => blockOfNode.get(id) !== thermalBlock.id)
      .sort()
      .join(',')
    ok(
      thermalForeign === [...projectedContextsOf(thermalBlock)].sort().join(','),
      'M8 子图里"不属于本块"的只有那几个对外输入（其余全是自家成员）',
      `外来量 = ${thermalForeign || '无'}`,
    )
  }

  console.log('\n[论文索引：与清单对得上]')
  const papers = await fs.readFile(PAPER_INDEX, 'utf8').catch(() => null)
  ok(Boolean(papers), '论文清单存在（docs/notes/physics-chain/papers.md）')
  if (papers) {
    const allParams = Object.values(artifact.params ?? {}).flat()
    const cited = allParams.filter((item) => String(item.paper ?? '').trim())
    /** 一处出处里可能同时写了多篇（如「Greig+2018 / Park+2018」），逐个带年份的标识符都要能在清单里找到 */
    const missingInIndex = []
    for (const param of cited) {
      const tokens = String(param.paper).match(/[\w&+.\-]*(?:19|20)\d{2}[\w.\-]*/g) ?? []
      const absent = tokens.filter((token) => !papers.includes(token))
      if (absent.length) missingInIndex.push(`${param.name}(${absent.join('/')})`)
    }
    ok(missingInIndex.length === 0, '参数上写的每一篇出处都能在论文清单里找到', missingInIndex.slice(0, 3).join(', '))
    console.log(`  · 有来源论文的参数 ${cited.length} 个；清单里本地缺正文的那批见 papers.md 第三节`)
  }

  /**
   * **引用：一个对象一份自己的**（design D6 的四条断言）。
   *
   * 对拍的口径与生成器那一处是同一条（生成器那边写着"自检脚本照这段话**独立实现一遍**再逐条对拍"）：
   *   · **每个对象只写自己那一份**：量 = `code.sites`（与属性页那个条数是同一份）**∪ 它全部实现步骤的
   *     核定落点**（函数那一级不上图之后，落点并进成员自己）∪ **所在模块那篇**文档里的笔记引用
   *     （它自己那一节那条 + 论文出处那条）；块 = 本模块那篇的笔记（层再带整文件级落点）；
   *   · **祖先不并子节点的**：块不再把成员的十几种落点抄上来一遍——那件事由**模块那篇 md** 承担
   *     （逐成员一节、带代码解析），引用清单里再铺一遍就是同一批落点出现两次。
   *     层里那 16 个成员是文件名、不在图上，层的整文件级落点由真源的层声明
   *     **直接给出**（`kind === 'files'`）；
   *   · **去重键** `file:line:endLine` / `docId#anchor`（**不含 `label`**）；**排序逐字符**
   *     （`localeCompare` 会随运行环境的 ICU 变、产物会抖）。
   * 多一条、少一条、顺序不对都要指名对象与那一条。
   */
  console.log('\n[引用：一个对象一份自己的（祖先不并子节点的）]')
  {
    /** 锚点口径：必须与 `Graphify/src/lib/slug.ts`（前端拿它定位小节）同一条 */
    const refSlug = (text) =>
      String(text ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s\-_]/gu, '')
        .replace(/[\s\u3000]+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '')
    /**
     * **标题的序号是排版，不进锚点**：`## 八、<成员标签>` 的锚点仍是 `<成员标签>` 的 slug
     * （否则成员那几条笔记引用会当场落空）。与前端 `src/lib/slug.ts` 的 `headingSlug` 同一条规则。
     */
    const headingSlug = (text) => refSlug(String(text ?? '').replace(/^[一二三四五六七八九十百]+[、.．]\s*/, ''))
    const refKeyOf = (ref) => (ref.file ? `file:${ref.file}:${ref.line ?? ''}:${ref.endLine ?? ''}` : `doc:${ref.docId}#${ref.anchor}`)
    const byChars = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
    /** 去重（先到先得）+ 排序：代码引用在前、笔记引用在后 */
    const canonRefs = (lists) => {
      const merged = new Map()
      for (const list of lists) for (const ref of list ?? []) if (ref && !merged.has(refKeyOf(ref))) merged.set(refKeyOf(ref), ref)
      return [...merged.values()].sort((a, b) => {
        const aCode = Boolean(a.file)
        if (aCode !== Boolean(b.file)) return aCode ? -1 : 1
        if (aCode) return byChars(a.file, b.file) || (a.line ?? 0) - (b.line ?? 0) || (a.endLine ?? 0) - (b.endLine ?? 0)
        return byChars(String(a.docId), String(b.docId)) || byChars(String(a.anchor), String(b.anchor))
      })
    }
    const refNodes = canvasGraph?.nodes ?? []
    const refNodeById = new Map(refNodes.map((node) => [node.id, node]))
    /** 量的产物条目（`code.sites` 在这里；真源 chain.json 里没有落点清单） */
    const quantityOf = new Map([...artifact.drivers, ...artifact.nodes].map((item) => [item.id, item]))
    const sourceOf = new Map([...chain.drivers, ...chain.nodes].map((item) => [item.id, item]))
    /** 量 → 块（真源成员表，唯一归属来源） */
    const ownerOf = new Map()
    for (const block of blockItems) for (const memberId of block.members ?? []) ownerOf.set(memberId, block)
    /**
     * **路径规则**（任务 2.3）：一条模块一篇——路径只由块 id 决定（去掉 `block:` 前缀），
     * 成员不再有自己的文件。与生成器 `docPathOf` **各写一份**（互不 import）：改歪一处，这一节的路径对拍立刻红。
     */
    const docKeyOfBlock = (blockId) => String(blockId).replace(/^block:/, '')
    const docPathOf = (blockId) => `physics-chain/modules/${docKeyOfBlock(blockId)}.md`
    /**
     * **实现步骤归谁**（与生成器 `stepUnitsOf` 同一条，独立实现）：真源成员的 `codeHints` 展开到更细一级、
     * 且在 `stepSites` 里核定过的单元，**先到先得**（`S14.2.*` 同挂在 `jalpha` / `xalpha` 上，不认领就会落进两处）。
     */
    const stepUnits = (() => {
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
    })()
    /** 笔记引用：**对象所在模块那篇**里的某个标题；锚点 = 标题的 slug，而标题就是节点标签本身 */
    const noteOf = (docId, heading) => ({ file: '', docId, anchor: refSlug(heading) })
    /**
     * **实现步骤的核定落点**（design D5）：函数那一级不上图，它那几条落点并进**成员自己**——
     * 与生成器同一取法（`stepUnits` 的归属 + 真源 `stepSites`），标签仍是成员符号（步骤名只活在文档里）。
     */
    const stepSiteRefs = (memberId) =>
      (stepUnits.byMember.get(String(memberId)) ?? []).flatMap((unit) =>
        (chain.stepSites[unit] ?? [])
          .filter((site) => Number.isFinite(site.line))
          .map((site) => ({
            file: String(site.file ?? ''),
            line: site.line,
            endLine: Number.isFinite(site.endLine) ? site.endLine : null,
          })),
      )
    /**
     * 自身那几条（不含从别的对象汇总来的）：论文出处（真源 `reviewSection`）+ 代码落点
     * （`code.sites` ∪ 它全部实现步骤的核定落点）+ 自己那一节的笔记。
     */
    const ownRefs = (node) => {
      const own = []
      const owner = ownerOf.get(node.id)
      /** 论文出处那条引用点落在**对象所在模块那篇**的 `## 论文出处` 上（锚点 = 那节的 slug），不另开论文清单 */
      if (owner && String(sourceOf.get(node.id)?.reviewSection ?? '').trim()) {
        own.push({ file: '', docId: docPathOf(owner.id), anchor: refSlug(REFERENCE_SECTION) })
      }
      for (const site of quantityOf.get(node.id)?.code?.sites ?? []) {
        if (Number.isFinite(site.line)) own.push({ file: site.file, line: site.line, endLine: site.endLine ?? null })
      }
      own.push(...stepSiteRefs(node.id))
      if (owner) own.push(noteOf(docPathOf(owner.id), String(node.label)))
      return own
    }
    const own = new Map()
    for (const node of refNodes) if (!String(node.id).startsWith('block:')) own.set(node.id, ownRefs(node))
    /**
     * 块自身那几条：本模块那篇的笔记（锚点 = 那篇 H1 的 slug，即块标签）+ 层的**整文件级**代码落点
     * ——后者的行区间 = 1 到文件末尾（行数自己数一遍，不抄产物里的数：这一步正是"直接给出"与"汇总"的分界）。
     * 块**还要并上成员的引用**（README §九「模块 = 成员的并集」）：成员那份由上面 `ownRefs` 独立重算
     * （含它那一节的笔记引用，点开同一篇、落在它自己那节上）。
     */
    for (const block of blockItems) {
      const refs = [noteOf(docPathOf(block.id), String(block.label))]
      if (block.codeAnchor?.kind === 'files') {
        for (const name of block.codeAnchor.files ?? []) {
          const text = await fs.readFile(path.join(SRC_DIR, name), 'utf8').catch(() => null)
          refs.push({ file: `src/py21cmfast/src/${name}`, line: 1, endLine: text === null ? null : text.split('\n').length })
        }
      }
      for (const memberId of (block.members ?? []).map(String)) {
        const memberNode = refNodeById.get(memberId)
        if (memberNode) refs.push(...ownRefs(memberNode))
      }
      own.set(block.id, refs)
    }
    /**
     * **期望值 = 自身 ∪ 子节点的并集**：成员自己那份（代码落点 ∪ 步骤落点 ∪ 自己那篇）已在 `own` 里，
     * 块那份在上一段里把成员并了进去，所以这里只按 `canonRefs` 收一遍重复与顺序。
     */
    const expectedOf = (id) => canonRefs([own.get(id) ?? []])
    const refMismatch = []
    for (const node of refNodes) {
      /** **段容器是装饰**：它自己不带引用、也不作汇总节点（引用只在**对象**之间往上走，见 design D8） */
      if (node.type === 'group') continue
      const want = expectedOf(node.id).map(refKeyOf)
      const got = (node.refs ?? []).map(refKeyOf)
      if (JSON.stringify(want) === JSON.stringify(got)) continue
      const wantSet = new Set(want)
      const gotSet = new Set(got)
      const missing = want.filter((key) => !gotSet.has(key))
      const extra = got.filter((key) => !wantSet.has(key))
      const at = want.findIndex((key, index) => key !== got[index])
      const parts = []
      if (missing.length) parts.push(`少 ${missing.slice(0, 2).join(' ')}`)
      if (extra.length) parts.push(`多 ${extra.slice(0, 2).join(' ')}`)
      if (!parts.length) parts.push(`顺序 / 重复不一致（第 ${at + 1} 条：产物 ${got[at] ?? '（没有）'} vs 重算 ${want[at] ?? '（没有）'}）`)
      refMismatch.push(`${node.id}：${parts.join(' / ')}`)
    }
    ok(
      refMismatch.length === 0,
      '每个对象的引用 = 自身 ∪ 直接子节点的并集（块 = 成员的并集；自检独立重算、逐条对拍，多一条也失败）',
      `${refMismatch.length} 个对不上：${refMismatch.slice(0, 3).join(' | ')}`,
    )
    const moduleEmpty = blockItems.filter((block) => {
      const refs = refNodeById.get(block.id)?.refs ?? []
      /** 两类证据都不空：「文献」= 块自己那篇（层另有成员文件那几篇）；「源码」= 成员与步骤汇总来的落点（层是整文件级落点） */
      return !refs.some((ref) => ref.docId) || !refs.some((ref) => ref.file)
    })
    ok(
      moduleEmpty.length === 0,
      '11 个模块两类证据都不空（自己那篇笔记 + 成员与步骤汇总来的代码落点；层的整文件级落点由真源声明直接给出）',
      moduleEmpty.map((block) => `${block.id}(${block.kind})`).join(','),
    )
    const bothEmpty = refNodes.filter(
      (node) =>
        node.type !== 'group' &&
        !String(node.id).startsWith('block:') &&
        !(node.refs ?? []).some((ref) => ref.file) &&
        !(node.refs ?? []).some((ref) => ref.docId),
    )
    ok(
      bothEmpty.length === 0,
      '其余对象不同时为空（没有代码落点的驱动量 / 外部量至少带一条笔记引用）',
      bothEmpty.slice(0, 5).map((node) => node.id).join(','),
    )
    /**
     * **标签上的条数与铺出来的卡片同源**（任务 6.4 的"数量标号与条数一致"）：
     * 页面把同一份 `refs` 按 `isCodeRef`（`file` 非空）分成两组（`Inspector.renderRefs`），
     * 「源码」数落点条数、「文献」数**文档数**（同一篇笔记上的多个锚点归并成一条，见 `Inspector` 的
     * `codeGroups` / `docGroups`）。所以数据侧要守的不变量是——**每条引用恰好归一组**：
     * `file` 与 `docId` 恰有一个非空。否则会出现"标签说 3 条、卡片只铺出 2 条"
     * （既不进「源码」也不进「文献」的那条永远看不见）。
     * 归并发生在页面侧、只减少卡片数：它按 `docId` 合并，不会把某一条排除在两组之外。
     * `code.count / code.sites` 是量自己的那份落点清单（`sites` 就是真源核定的全部落点），页面不读它，
     * 两个数本来就不必相等——别拿它当"数量标号"。
     */
    const strayRefs = refNodes.flatMap((node) =>
      (node.refs ?? [])
        .filter((ref) => Boolean(ref.file) === Boolean(ref.docId))
        .map((ref) => `${node.id} → ${refKeyOf(ref)}`),
    )
    ok(
      strayRefs.length === 0,
      '每条引用恰好归入「源码」或「文献」一组（两组条数之和 = 清单长度，没有两处都不显示的引用）',
      strayRefs.slice(0, 3).join(' | '),
    )
    /**
     * **笔记引用可开**（design D6 第 3 条）：既有那条只查"文件存在"，这条再往前一步——
     * 打开文档、按标题算出 slug，锚点必须真落在某个小节上（标题被改坏 → 引用就"点不开、停在文档顶部"）。
     * 文档打不开的情形不在这里重复报（上一条断言已经指名那个 `docId`）。
     */
    const docHeadings = new Map()
    const headingsIn = async (docId) => {
      if (!docHeadings.has(docId)) {
        const text = await fs.readFile(path.join(REPO_ROOT, 'docs', 'notes', docId), 'utf8').catch(() => null)
        docHeadings.set(
          docId,
          text === null
            ? null
            : String(text)
                .split(/\r?\n/)
                .flatMap((line) => {
                  const match = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
                  return match && match[2].trim() ? [{ depth: match[1].length, text: match[2].trim(), slug: headingSlug(match[2].trim()) }] : []
                }),
        )
      }
      return docHeadings.get(docId)
    }
    const anchorMiss = []
    for (const node of refNodes) {
      for (const ref of (node.refs ?? []).filter((item) => item.docId && String(item.anchor ?? '').trim())) {
        const headings = await headingsIn(String(ref.docId))
        if (headings === null) continue
        if (!headings.some((heading) => heading.slug === ref.anchor)) anchorMiss.push(`${node.id} → ${ref.docId}#${ref.anchor}`)
      }
    }
    ok(
      anchorMiss.length === 0,
      '每条笔记引用的锚点都能在该文档里定位到小节（标题被改坏 / 锚点写错都当场失败）',
      `${anchorMiss.length} 条落空：${anchorMiss.slice(0, 3).join(' | ')}`,
    )
    /**
     * **路径与对象树同构**（任务 5.2）：沿对象树独立重算每篇的路径，与磁盘逐条对拍——
     * 多一篇、少一篇、放错位置都指名。路径规则见上面的 `docPathOf`（与生成器各写一份，互不 import）：
     * **一个块一篇**（`modules/<块>.md`），成员不再各占一个文件。
     * 篇数两处各数一遍（磁盘上 `*.md` 的条数 vs 树上的块数）：这个数不写死在这里。
     */
    const expectedDocs = new Map()
    for (const block of blockItems) expectedDocs.set(docPathOf(block.id), String(block.label))
    const listed = []
    const walkDocs = async (dir) => {
      const entries = await fs.readdir(path.join(REPO_ROOT, 'docs', 'notes', dir), { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        const next = `${dir}/${entry.name}`
        if (entry.isDirectory()) await walkDocs(next)
        else if (entry.name.endsWith('.md')) listed.push(next)
      }
    }
    await walkDocs('physics-chain/modules')
    const pathMismatch = [
      ...listed.filter((docId) => !expectedDocs.has(docId)).map((docId) => `${docId}：不在对象树上`),
      ...[...expectedDocs.keys()].filter((docId) => !listed.includes(docId)).map((docId) => `${docId}：树上应有、磁盘上没有`),
    ]
    ok(
      pathMismatch.length === 0,
      `文档路径与对象树同构：磁盘上恰好 ${expectedDocs.size} 篇，一个块一篇（多一篇 / 少一篇 / 放错位置都失败）`,
      pathMismatch.slice(0, 3).join(' | ') || `磁盘 ${listed.length} 篇 vs 树上 ${expectedDocs.size} 篇`,
    )
    const withCode = refNodes.filter((node) => (node.refs ?? []).some((ref) => ref.file)).length
    const withDoc = refNodes.filter((node) => (node.refs ?? []).some((ref) => ref.docId)).length
    const refBlank = refNodes.filter((node) => !(node.refs ?? []).length).length
    const uniqueRefs = new Set(refNodes.flatMap((node) => (node.refs ?? []).map(refKeyOf)))
    console.log(
      `  · ${refNodes.length} 个对象里：有代码引用 ${withCode} 个 / 有笔记引用 ${withDoc} 个 / 零引用 ${refBlank} 个；去重后共 ${uniqueRefs.size} 条`,
    )
    console.log(
      `  · 11 个模块的引用条数：${blockItems.map((block) => `${block.id.replace('block:', '')}(${(refNodeById.get(block.id)?.refs ?? []).length})`).join(' ')}`,
    )
  }

  /**
   * **呈现面：名字与落点不带内部编号**。
   *
   * 判据是"这句话是给读者看的，还是给核对用的"：给读者看的（框上的字、散文、命中的说明、引用的落点、
   * 模块文档的标题）一律不含编号（`L0` / `M1…M10` / `S14.3.1`）；给核对用的（`stage` / `codeHints` /
   * `codeAnchor` / `algorithms`）留在数据里。
   *
   * 做法是**在生成物与真源上重算出口字符串**（真源与产物都重新读一遍，不借上面几节的作用域）：
   * 掩码（渲染前裁掉前缀）也能骗过"源码里有没有写死编号"这类检查，却会造出"真源一个名字、
   * 界面另一个名字"——那正是要避免的。所以这里查的是**出口上的字符串本身**。
   */
  console.log('\n[呈现面：名字与落点不含内部编号]')
  {
    /** 内部编号的形状：模块前缀 `L` / `M` / `S` + 数字（`L0`、`M8`、`S14.3.1`）。大小写都算——`m8-thermal` 这种写法同样不合格 */
    const codeShape = (text) => /(?:^|[^A-Za-z0-9])[MLS]\d/i.test(String(text ?? ''))
    const unique = (list) => [...new Set(list.filter(Boolean))]
    const truth = JSON.parse(await fs.readFile(CHAIN_SOURCE, 'utf8'))
    const out = JSON.parse(await fs.readFile(OUT_FILE, 'utf8'))
    const outGraph = out.graph ?? {}
    /** 注册表里的参数名（`## 参数语境` 那些小节的标题就是它们；`m22` 这种真名不该被当成模块码） */
    const paramNames = new Set((outGraph.meta?.tags ?? []).map((item) => item?.name).filter(Boolean))
    const truthBlocks = truth.blocks?.items ?? []

    /** 1) 标签面：块 / 量 / 步骤 / 过程词条的标签 */
    const labelOffenders = unique([
      ...truthBlocks.map((block) => (codeShape(block.label) ? `${block.id}：${block.label}` : '')),
      ...(outGraph.nodes ?? []).map((node) => (codeShape(node.label) ? `${node.id}：${node.label}` : '')),
      ...(truth.processes?.items ?? []).map((item) => (codeShape(item.label) ? `${item.id}：${item.label}` : '')),
    ])
    ok(
      labelOffenders.length === 0,
      '界面上的名字是纯名字：块 / 量 / 步骤 / 过程词条的标签都不带阶段号与模块码',
      labelOffenders.slice(0, 3).join(' | '),
    )

    /** 2) 落点面：笔记引用的 `docId` / 锚点 / 标签，以及源码引用的文件路径 */
    const refOffenders = unique(
      [...(outGraph.nodes ?? []), ...(outGraph.edges ?? [])].flatMap((node) =>
        (node.refs ?? []).flatMap((ref) => {
          if (!ref.docId) return codeShape(ref.file) ? [`${node.id}：源码路径 ${ref.file}`] : []
          return ['docId', 'anchor', 'label']
            .filter((key) => codeShape(ref[key]))
            .map((key) => `${node.id}：笔记引用的 ${key} ＝ ${ref[key]}`)
        }),
      ),
    )
    ok(
      refOffenders.length === 0,
      '引用卡片上的落点不带编号（`thermal.md#updatexraysourcebox`：真实文件名 + 真有的小节）',
      refOffenders.slice(0, 3).join(' | '),
    )

    /**
     * 3) 散文面：真源里**成句的散文**（顶层说明 / 块注 / 过程面注 / 边注 / 兜底注）。
     *
     * 只扫这几处、不做全量字段扫描：账本字段（`stage` / `codeHints` / `codeAnchor` / `implementedAs` /
     * `theory` / `algorithms`）本来就是给核对用的，编号留在这里是它的本职；而量的符号名（如 FDM 粒子质量
     * 参数 `m22`）长得就像编号形状，全量扫会被误伤。扫散文，就够守住"提到别的块时写块名"。
     */
    const prose = [
      ['note', truth.note],
      ['blocks.note', truth.blocks?.note],
      ...truthBlocks.map((block) => [`blocks.items[${block.id}].note`, block.note]),
      ['processes.note', truth.processes?.note],
      ...(truth.processes?.items ?? []).flatMap((item) => [
        [`processes.items[${item.id}].fit`, item.fit],
        [`processes.items[${item.id}].note`, item.note],
      ]),
      ['processes.uncovered.note', truth.processes?.uncovered?.note],
      ...(truth.edges ?? []).map((edge, index) => [`edges[${index}].note`, edge.note]),
    ]
    const proseOffenders = unique(
      prose.filter(([, text]) => codeShape(text)).map(([where, text]) => `${where}：${String(text).slice(0, 40)}…`),
    )
    ok(
      proseOffenders.length === 0,
      '真源散文里提到别的块时写块名（顶层说明 / 块注 / 过程面注 / 边注 / 兜底注都不含编号）',
      proseOffenders.slice(0, 3).join(' | '),
    )

    /**
     * 4) 模块文档面：路径上的每一段（块目录 / 成员文件名）+ `#`–`###` 标题。这里查的是**内部编号**
     * （`L0` / `M8` / `S14.3.1`）；标题可以带中文序号（`## 八、<成员标签>`），那条是排版、不是名字，
     * 算锚点时剥掉（口径见本文件上面的 `headingSlug` 与 `docs/notes/physics-chain/README.md` §九「锚点」）。
     */
    const docOffenders = []
    const docPaths = []
    const walkDocs = async (dir) => {
      const entries = await fs.readdir(path.join(REPO_ROOT, 'docs', 'notes', dir), { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        const next = `${dir}/${entry.name}`
        if (entry.isDirectory()) await walkDocs(next)
        else if (entry.name.endsWith('.md')) docPaths.push(next)
      }
    }
    await walkDocs('physics-chain/modules')
    for (const docId of docPaths) {
      if (docId.split('/').some((part) => codeShape(part))) docOffenders.push(`${docId}：路径里有带编号的一段`)
      const text = await fs.readFile(path.join(REPO_ROOT, 'docs', 'notes', docId), 'utf8').catch(() => null)
      if (text === null) {
        docOffenders.push(`${docId}：文档打不开`)
        continue
      }
      for (const line of text.split('\n')) {
        if (!/^#{1,3} /.test(line)) continue
        const title = line.slice(line.indexOf(' ') + 1).trim()
        /**
         * 参数名是名字，不是编号：`m22` 这种写法与"模块码 + 数字"同形（`codeShape` 会把 `m22` 读成 `M` + `22`），
         * 但它就是暗物质粒子质量那个参数的真名，`## 参数语境` 下的小节标题写的就是它。放行的只有注册表里的
         * 参数名本身，名单外一律照旧算编号——放行一个真名，不等于开口子。
         */
        if (paramNames.has(title)) continue
        if (codeShape(title)) docOffenders.push(`${docId}：${line.trim()}`)
      }
    }
    ok(
      docOffenders.length === 0,
      `模块文档的路径（${docPaths.length} 篇）与标题（\`#\`–\`###\`）不带编号（标题＝名字，锚点由它算出来）`,
      docOffenders.slice(0, 3).join(' | '),
    )

    /** 5) 命中说明面：真跑一次检索——编号仍是**命中面**（按 `S14` 查得到它算在哪段代码里），只是不印在说明里 */
    const { searchChain } = await loadTs('src/lib/physicsChain.ts', 'search')
    const stageHits = searchChain('S14')
    ok(
      stageHits.hits.length > 0,
      '按阶段号检索仍能命中（编号是命中面，去掉的是它在文案里的呈现）',
      '按 `S14` 一条都查不到',
    )
    const detailOffenders = unique(
      stageHits.hits.filter((hit) => codeShape(hit.detail)).map((hit) => `${hit.label}：${hit.detail}`),
    )
    ok(
      detailOffenders.length === 0,
      '命中说明里不印阶段号（说明只写"属于哪个块"）',
      detailOffenders.slice(0, 3).join(' | '),
    )

    /** 6) 反面断言：说明的拼装不许把 `stage` 读回来；成员行也不许再印它（查去注释后的源码） */
    const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    const libSource = strip(await fs.readFile('src/lib/physicsChain.ts', 'utf8').catch(() => ''))
    const detailBuilds = libSource.split('\n').filter((line) => /detail:/.test(line))
    ok(
      detailBuilds.length > 0 && !detailBuilds.some((line) => /stage/.test(line)),
      '命中说明的拼装不读 `stage`（编号只进命中面，不进文案）',
      `读了回来：${detailBuilds.filter((line) => /stage/.test(line)).length} 处`,
    )
    ok(
      !/member\.stage/.test(strip(await fs.readFile('src/components/Inspector.tsx', 'utf8').catch(() => ''))),
      '成员明细不再印阶段号（那一列已撤，阶段号只剩数据与检索两个用途）',
      '成员行右列长回来了',
    )
    const panelSource = strip(await fs.readFile('src/components/ChainSearchPanel.tsx', 'utf8').catch(() => ''))
    const placeholder = panelSource.match(/placeholder="([^"]*)"/)?.[1] ?? ''
    ok(
      placeholder.length > 0 && !codeShape(placeholder),
      '检索框的占位文案不带编号示例',
      placeholder || '占位文案没找到',
    )

    /** 7) 反向断言：编号仍是**数据**——去的是界面出口，不是事实 */
    const outBlocks = outGraph.blocks?.items ?? []
    const stagesKept = outBlocks.filter((block) => (block.stages ?? []).length).length
    const stageKept = (outGraph.nodes ?? []).filter((node) => codeShape(node.stage)).length
    ok(
      stagesKept >= 8 && stageKept > 0,
      '编号仍在数据里（块的 `stages` 并集与每个量自己的 `stage`）',
      `带阶段的块 ${stagesKept} 个 / 带阶段属性的量 ${stageKept} 个`,
    )
    console.log(
      `  · 出口自查：标签 / 落点 / 散文 / 模块文档 / 命中说明都不含编号；按 \`S14\` 命中 ${stageHits.hits.length} 条且说明里没有它；` +
        `编号留在 ${stagesKept} 个块的 \`stages\` 与 ${stageKept} 个量的 \`stage\` 里`,
    )
  }

  console.log('\n[幂等：重跑生成脚本逐字一致]')
  const rerun = spawnSync(process.execPath, [path.join(HERE, 'build-physics-chain.mjs'), '--stdout'], {
    cwd: path.join(HERE, '..'),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  ok(rerun.status === 0, '重跑生成脚本成功', rerun.stderr?.split('\n').slice(-2).join(' '))
  ok(JSON.stringify(JSON.parse(rerun.stdout || '{}')) === JSON.stringify(artifact), '重跑结果与磁盘产物一致（幂等）')

  console.log('\n[边界：工程图谱只读]')
  const legacy = await fs.readFile(DATA_GRAPH, 'utf8').catch(() => null)
  ok(Boolean(legacy), '工程视角图谱 data/graph.json 仍在（本链不改它）')

  /*
    本链唯一的写通道是**手动摆放**（`data/chain-layout.json`）。下面几条钉住它不越界：
    不写画布的工作文件、不归档历史、不碰生成物——这是"位置可改、数据仍逐字来自生成物"的落地。
    对应实现：`server/lib/chainLayout.mjs`（读写）、`server/routes/chainLayout.mjs`（接口）、
    `src/state/chainLayoutStore.ts`（前端那份状态）。
  */
  const layoutLib = await fs.readFile(path.join(HERE, '..', 'server', 'lib', 'chainLayout.mjs'), 'utf8').catch(() => null)
  const layoutRoute = await fs.readFile(path.join(HERE, '..', 'server', 'routes', 'chainLayout.mjs'), 'utf8').catch(() => null)
  const layoutStore = await fs.readFile(path.join(HERE, '..', 'src', 'state', 'chainLayoutStore.ts'), 'utf8').catch(() => null)
  ok(Boolean(layoutLib && layoutRoute && layoutStore), '手动摆放那一套（lib / 路由 / 前端 store）都在')
  const layoutStack = `${layoutLib ?? ''}\n${layoutRoute ?? ''}\n${layoutStore ?? ''}`
  /*
    这里判的是**代码**（import 与调用），不是文案：注释里必然会提到 `data/graph.json`
    与历史目录——那正是在解释"为什么不碰它们"。
  */
  const layoutPathsImport = /import \{([^}]*)\} from '\.\/paths\.mjs'/.exec(layoutLib ?? '')?.[1] ?? ''
  ok(
    layoutPathsImport.includes('CHAIN_LAYOUT_FILE') && !/GRAPH_FILE|HISTORY/.test(layoutPathsImport),
    '它只从 paths 里取自己那份文件（不取画布的工作文件、不取历史目录）',
  )
  ok(!/archive|pushHistory|saveGraph/.test(layoutStack), '摆放这条路不归档历史、不调画布那些写接口')
  ok(!/^\s*import[^\n]*generated/m.test(layoutStack), '摆放这条路不 import 生成物（更不会写它）')
  ok(
    /readChainLayout/.test(layoutRoute ?? '') && /writeChainLayout/.test(layoutRoute ?? ''),
    '接口只有读、写两个动作（读回覆盖层 / 整份替换）',
  )
  const serverIndex = await fs.readFile(path.join(HERE, '..', 'server', 'index.mjs'), 'utf8').catch(() => null)
  ok(
    /app\.use\('\/api\/chain-layout'/.test(serverIndex ?? ''),
    '接口挂在 /api/chain-layout 上（与画布的 /api/graph 分开两条路）',
  )

  /*
    前端：落点只记在本机（`chainLayoutStore`），保存才写盘；保存按钮两页都在，但状态与说明
    跟着视图走——不然物理链页会报画布那张图的「已保存 / 有未保存改动」。
  */
  const chainViewSource = await fs.readFile(path.join(HERE, '..', 'src', 'components', 'PhysicsChainView.tsx'), 'utf8').catch(() => '')
  const chainTopBarSource = await fs.readFile(path.join(HERE, '..', 'src', 'components', 'TopBar.tsx'), 'utf8').catch(() => '')
  const chainAppSource = await fs.readFile(path.join(HERE, '..', 'src', 'App.tsx'), 'utf8').catch(() => '')
  ok(
    chainViewSource.includes('onPositionsSettled={noteChainPositions}'),
    '拖完一个节点只记在本机（onPositionsSettled 接的是摆放 store，不是只读提示）',
  )
  ok(
    /saveHint \?\? '另存为一份保留副本/.test(chainTopBarSource),
    '保存按钮的说明跟着页面走（画布那句只是缺省，按钮本身两页都在）',
  )
  ok(
    /view === 'chain' \? saveChainLayout : sync\.saveNow/.test(chainAppSource),
    '顶栏保存按视图分流：画布存那张图，物理链存这一页的摆放',
  )
  ok(
    /onSave: saveChainLayout/.test(chainAppSource),
    'Ctrl/Cmd + S 在这一页保存的也是摆放（不再是只读说明）',
  )
}

await main()

console.log('')
if (failures.length) {
  console.error(`✗ 物理链自检失败：${failures.length} / ${checks} 项`)
  for (const line of failures) console.error(`  · ${line}`)
  process.exit(1)
}
console.log(`✓ 物理链自检通过（${checks} 项断言）`)
