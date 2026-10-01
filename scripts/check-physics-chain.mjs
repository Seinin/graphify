/**
 * 物理链自检（`npm run check:chain`）。检查的事：
 *
 *   1. 真源 `docs/notes/physics-chain/chain.json` 合法：每个节点都有 Eq 编号与数学性质；
 *      每条边两端都存在、且带 Eq 出处（图上用 Eq 当边的标签，缺了就没法看）；
 *      简并条目成对出现；
 *   2. 生成物存在、有内容哈希戳记，且**节点/边与真源逐条对应**（生成器不许自作主张增删）；
 *   3. 真源与源码一致：参数默认值/范围与 `wrapper/inputs.py` 相同（生成器已拦一道，这里再核一遍）；
 *   4. **命名政策**：节点的符号用 P&L 写法（真源说了算）；代码名只能出现在附注字段里；
 *   5. 代码落点可核对：文件存在、行区间合法、区间不倒置；
 *   6. 幂等：重跑生成脚本与磁盘产物逐字一致；
 *   7. **呈现面**：界面出口（标签 / 散文 / 引用落点 / 命中说明 / 骨架标题）不含内部编号，
 *      而编号仍留在数据里（`stage` / `stages` / 步骤 id / 源码引用标签）；
 *   8. 边界：工程图谱 `data/graph.json` 仍在（本链只读它）。
 *
 * 用法：`npm run check:chain`（失败退出码 1）
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'
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
/** C 源码目录（代码锚与共享内核层的引用面都在这里查） */
const SRC_DIR = path.join(REPO_ROOT, 'src', 'py21cmfast', 'src')
/** 按文件名在 C 源码目录里找文件（层锚只写文件名、不写路径）；找不到返回 null */
const findSourceFile = async (name) => fs.stat(path.join(SRC_DIR, name)).then(() => path.join(SRC_DIR, name)).catch(() => null)

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
  console.log(`  · 门控关系 ${gated} 条；其中标了 basis 的 ${(paramsSource.effects ?? []).filter((item) => String(item.basis ?? '').trim()).length} 个（code = 代码可作证，inference = 我推断待你纠）`)

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
   * 容器 = 块或子图步骤（`step:*`）；`layer === 'subgraph'` 不能当容器判据——
   * `hmf_impl` / `source_grid` 这类**量**也标着 `subgraph`，它们照样要带阶段号。
   */
  const containerNodeIds = new Set((canvasGraph?.blocks?.items ?? []).map((item) => item.id))
  const isContainerNode = (node) => containerNodeIds.has(node.id) || String(node.id).startsWith('step:')
  const sourceHints = new Map([...chain.drivers, ...chain.nodes].map((item) => [item.id, (item.codeHints ?? []).map(String)]))
  const surfaceNodes = (canvasGraph?.nodes ?? []).filter((node) => !isContainerNode(node))
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
  const INPUT_TAGS = ['tag:输入参数', 'tag:外部量']
  const noCode = (canvasGraph?.nodes ?? []).filter(
    (node) => node.type !== 'group' && !String(node.id).startsWith('block:') && !(node.refs ?? []).some((ref) => ref.file),
  )
  const unlabelled = noCode.filter((node) => !(node.tags ?? []).some((tag) => INPUT_TAGS.includes(tag)))
  ok(unlabelled.length === 0, '每个没有代码落点的量都有身份标签（输入量 / 外部量）', unlabelled.map((node) => node.id).join(','))
  const registryIds = new Set((canvasGraph?.meta?.tags ?? []).map((tag) => tag.id))
  const missingTags = INPUT_TAGS.filter((tag) => !registryIds.has(tag))
  ok(missingTags.length === 0, '这两个身份标签在注册表里（否则标签等于悬空）', missingTags.join(','))
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
  const noGroupNodes = (canvasGraph?.nodes ?? []).filter((node) => node.type === 'group')
  ok(noGroupNodes.length === 0, '产物里不再有容器节点（阶段框退场，块是普通节点）', noGroupNodes.map((node) => node.id).join(','))
  const flowEdges = (canvasGraph?.edges ?? []).filter((edge) => edge.id.startsWith('flow:'))
  ok(flowEdges.length === 0, '旧的汇总边（`flow:*`，标签写"N 条"）已退场', `还留着 ${flowEdges.length} 条`)
  const strayEdges = (canvasGraph?.edges ?? []).filter(
    (edge) =>
      !edge.focusOnly &&
      edge.spanKind !== 'feedback' &&
      (String(edge.source).startsWith('block:') || String(edge.target).startsWith('block:')),
  )
  ok(
    strayEdges.length === 0,
    '一级的边只有接口边与回流边（量的边不许连到块上；块 → 块的只许是这两种）',
    strayEdges.slice(0, 4).map((edge) => edge.id).join(','),
  )
  const feedbackBlockEdges = (canvasGraph?.edges ?? []).filter((edge) => edge.spanKind === 'feedback')
  ok(
    feedbackBlockEdges.every((edge) => String(edge.source).startsWith('block:') && String(edge.target).startsWith('block:')),
    '回流边是块 → 块（它不冒充"量 → 量"的主序依赖，所以不算漏网的跨界边）',
    feedbackBlockEdges.filter((edge) => !String(edge.source).startsWith('block:')).map((edge) => edge.id).join(','),
  )
  const nodeById = new Map((canvasGraph?.nodes ?? []).map((node) => [node.id, node]))
  /**
   * 水平带的不变量（块化之后改了）：**每个成员与自己所属的块同一条带**。
   * 原来的口径是"框外的量不与框内量同带"，现在 39 个量全部有块，这条已经没有对象；
   * 真正要守的是"成员不许漂到别的主序位次去"——同一位次可以并排好几个块（两个层都在位次 0）。
   */
  const driftedMembers = [...nodeById.values()].filter((node) => {
    if (!node.parent || String(node.id).startsWith('step:')) return false
    const owner = nodeById.get(node.parent)
    return owner && Math.round(owner.position?.y ?? 0) !== Math.round(node.position?.y ?? 0)
  })
  ok(driftedMembers.length === 0, '每个成员都与自己块同一条水平带（不漂到别的位次）', driftedMembers.slice(0, 4).map((node) => node.id).join(','))
  const boxRows = new Map()
  for (const node of (canvasGraph?.nodes ?? []).filter((item) => String(item.id).startsWith('block:'))) {
    boxRows.set(node.order, [...(boxRows.get(node.order) ?? []), node])
  }
  const stacked = [...boxRows.values()].filter((row) => new Set(row.map((node) => Math.round(node.position?.x ?? 0))).size !== row.length)
  ok(stacked.length === 0, '同一位次的多个块横向排开、不叠在一起', stacked.map((row) => row.map((node) => node.id).join('+')).join(','))
  console.log(
    `  · 主序位次 ${boxRows.size} 条：${[...boxRows.entries()].sort((a, b) => a[0] - b[0]).map(([order, row]) => `第${order}位(${row.length}块)`).join(' ')}`,
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
   *   · **等距**：同一排相邻的两块、同一块里的成员、同一成员的步骤、相邻两排，空隙彼此相等
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
  /** 一排的上下边界（这排里最高的框说了算）：排距要量"边界到边界"，量中心距会把框高算进去 */
  const bandOf = (row) => ({
    top: Math.min(...row.map((node) => node.position.y - sizeAt(node).height / 2)),
    bottom: Math.max(...row.map((node) => node.position.y + sizeAt(node).height / 2)),
  })
  const rowsInOrder = [...boxRows.entries()].sort((a, b) => a[0] - b[0])
  const bands = rowsInOrder.map(([, row]) => bandOf(row))
  const rowGaps = []
  const rowTooFar = []
  for (let i = 1; i < bands.length; i += 1) {
    const gap = bands[i].top - bands[i - 1].bottom
    rowGaps.push(gap)
    const limit = Math.min(...[...rowsInOrder[i - 1][1], ...rowsInOrder[i][1]].map((node) => sizeAt(node).height))
    if (gap > limit + 0.5) rowTooFar.push(`第${rowsInOrder[i - 1][0]}↔第${rowsInOrder[i][0]}位 空 ${gap.toFixed(1)}（最矮的框才 ${limit} 高）`)
  }
  /** 成员（父＝块）与步骤（父＝量）：按父分组，各自量横向空隙 */
  const groupsByParent = (wantSteps) => {
    const groups = new Map()
    for (const node of nodeById.values()) {
      if (!node.parent || String(node.id).startsWith('step:') !== wantSteps) continue
      groups.set(node.parent, [...(groups.get(node.parent) ?? []), node])
    }
    return [...groups.values()]
  }
  const cols = surveyGaps([...boxRows.values()], 'x')
  const memberGaps = surveyGaps(groupsByParent(false), 'x')
  const stepGaps = surveyGaps(groupsByParent(true), 'x')
  const layoutTooFar = [...cols.tooFar, ...memberGaps.tooFar, ...stepGaps.tooFar, ...rowTooFar]
  const allGaps = [...cols.gaps, ...memberGaps.gaps, ...stepGaps.gaps, ...rowGaps]
  const gapValues = [...new Set(allGaps.map((gap) => gap.toFixed(1)))].sort()
  /**
   * 量到的空隙**只能是同一个数**：同排的块、同块的成员、同成员的步骤、相邻两排——四处的排法
   * 各自独立，却必须落在同一个间距上。这条比"逐组内部相等"强：任何一个地方另起一套步长
   * （旧稿的 820 / 300 / 280 / 220 就是四处各一套）都会让这个集合多出一个数。
   *
   * 附带效应（不是巧合，是这条断言的分内事）：坐标由生成器的**镜像副本**(`lib/boxSize.mjs`)
   * 算、尺寸由画布的 `labels.ts` 量，两份口径一旦漂移（比如只改了一边的字号或折行规则），
   * 空隙就不再是同一个数——所以这条同时盯着"两份副本必须等价"。
   */
  ok(
    gapValues.length <= 1,
    '距离由尺寸定：全图只有**一个**间距数字（同排 / 同块成员 / 同成员步骤 / 相邻两排都一样，不是写死的步长）',
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
    `  · 一级版面 ${layoutW.toFixed(1)} × ${layoutH.toFixed(1)}（框 ${rangeOf('width')} 宽 × ${rangeOf('height')} 高，空隙 ${gapValues.join('/')}）：` +
      `取景倍数 ≈ 画布高 / ${layoutH.toFixed(1)}，屏幕字号 = 13 × 那个倍数`,
  )

  console.log('\n[分层：骨干树 + 跨层成因（回答"为什么会出现跨层"）]')
  /**
   * 这一段**独立重算**，不信任生成物里的标注：层号按最长路径重算、成因按可达性重判，
   * 再把生成器的标注与重算结果对照。于是"骨干不跨层""跨层成因不许瞎标"都是可证伪的。
   */
  {
    const allEdges = canvasGraph?.edges ?? []
    /**
     * 一级的边分三种，这一段只查**量 → 量**的那种：
     *   · `graphEdges`：两端都是物理量的主序依赖 —— 骨干树、跨层成因、层差都在这里查；
     *   · `interfaceEdges`：21 条块间接口（`focusOnly: true`，由 28 条跨块依赖汇总）—— 位次差按真源 `order` 算、
     *     成因一律是"汇总"，不适用下面的可达性判据，另有一段专门查（见「一级：10 个过程块 + 2 个层」）；
     *   · `feedbackEdges`：跨红移回流（层差为**负**）—— **必须从下面的分层重算里摘掉**，否则
     *     "上游 ← 下游"与"上游 → 下游"同时存在、最长路径会成环（层号在每轮迭代里无限加），
     *     报出一堆假的"层差与重算结果不一致"。回流单独查（见下）。
     * 不分流就会拿"最长路径层差"去量块间接口与回流，报出一堆假失败。
     */
    const interfaceEdges = allEdges.filter((edge) => edge.focusOnly)
    const feedbackEdges = allEdges.filter((edge) => edge.spanKind === 'feedback')
    const graphEdges = allEdges.filter((edge) => !edge.focusOnly && edge.spanKind !== 'feedback')
    /** 块节点（`block:*`）不是"量"：它们不参与量→量的分层，重心/层号都另算 */
    const blockIds = new Set((canvasGraph?.nodes ?? []).filter((node) => String(node.id).startsWith('block:')).map((node) => node.id))
    /**
     * 参与分层的节点集 = **所有非容器、非块的节点**，与生成器同口径。
     * 不能按 `layer !== 'subgraph'` 收窄：标了 `subgraph` 的**源节点**（如 `source_grid`，账本第一节"待改 ①"
     * 说它该移进子图、尚未动手）现在仍然有边在链上，把它排除会让"骨干边数 = 有下游的量数"假失败。
     * 子图里的 `step:*` 节点与边无关（边只连真源里的量），进来也不改变任何层号。
     */
    const quantityIds = (canvasGraph?.nodes ?? [])
      .filter((node) => node.type !== 'group' && !blockIds.has(node.id))
      .map((node) => node.id)
    const level = new Map(quantityIds.map((id) => [id, 0]))
    for (let pass = 0; pass < quantityIds.length; pass += 1) {
      let moved = false
      for (const edge of graphEdges) {
        const next = (level.get(edge.target) ?? 0) + 1
        if (next > (level.get(edge.source) ?? 0)) {
          level.set(edge.source, next)
          moved = true
        }
      }
      if (!moved) break
    }
    const mismatchedSpan = graphEdges.filter(
      (edge) => edge.levelSpan !== (level.get(edge.source) ?? 0) - (level.get(edge.target) ?? 0),
    )
    ok(mismatchedSpan.length === 0, '每条边的层差与重算结果一致', mismatchedSpan.slice(0, 3).map((edge) => edge.id).join(','))
    const descending = graphEdges.filter((edge) => !Number.isInteger(edge.levelSpan) || edge.levelSpan < 1)
    ok(descending.length === 0, '箭头一律自上而下（层差 ≥ 1，没有回指上游的边）', descending.slice(0, 3).map((edge) => edge.id).join(','))
    /**
     * **回流恰恰要"回指上游"**：层差必须是负的、必须两端都是块、必须有代码出处。
     * 这三条合起来说明它是"从下游指回上游"，而不是有人把主序边写反了（写反会被上一条抓住）。
     */
    const badFeedbackEdges = feedbackEdges.filter(
      (edge) =>
        !Number.isInteger(edge.levelSpan) ||
        edge.levelSpan >= 0 ||
        !String(edge.source).startsWith('block:') ||
        !String(edge.target).startsWith('block:') ||
        !String(edge.codeRef ?? '').trim(),
    )
    ok(badFeedbackEdges.length === 0, '回流边的层差为负、两端是块、带代码出处（HaloBox.c 行号）', badFeedbackEdges.slice(0, 3).map((edge) => edge.id).join(','))
    const wantFeedbackIds = feedbackItems.map((item) => `feedback:${item.from}->${item.to}`).sort()
    const gotFeedbackIds = feedbackEdges.map((edge) => edge.id).sort()
    ok(
      JSON.stringify(wantFeedbackIds) === JSON.stringify(gotFeedbackIds),
      '回流边与真源 feedback 段逐条对应（不多不少）',
      `真源 ${wantFeedbackIds.length} 条 / 画布 ${gotFeedbackIds.length} 条`,
    )

    const crossLevel = canvasGraph?.crossLevel ?? {}
    const backboneEdges = graphEdges.filter((edge) => edge.backbone)
    const outNodes = quantityIds.filter((id) => graphEdges.some((edge) => edge.source === id))
    ok(backboneEdges.length === outNodes.length, '骨干边数 = 有下游的量数（每个量恰好一个主父）', `${backboneEdges.length} vs ${outNodes.length}`)
    const spanningBackbone = backboneEdges.filter((edge) => edge.levelSpan !== 1)
    ok(spanningBackbone.length === 0, '**骨干边层差恒为 1** —— 骨干就是一棵真正的多叉树，结构上不可能跨层', spanningBackbone.slice(0, 3).map((edge) => edge.id).join(','))
    // 主父表必须让每个量恰好上溯一级：`parentOf[s]` 的层号 = s 的层号 − 1，且沿它上溯能走到层 0
    const parentOf = crossLevel.parentOf ?? {}
    const badParent = outNodes.filter((id) => {
      const parent = parentOf[id]
      return !parent || (level.get(parent) ?? -1) !== (level.get(id) ?? 0) - 1
    })
    ok(badParent.length === 0, '主父表 parents 逐级正确（父的层号 = 子的层号 − 1）', badParent.slice(0, 4).join(','))

    const reaches = (from, to) => {
      const seen = new Set([from])
      const queue = [from]
      while (queue.length) {
        const current = queue.shift()
        for (const edge of graphEdges.filter((item) => item.source === current)) {
          if (edge.target === to) return true
          if (seen.has(edge.target)) continue
          seen.add(edge.target)
          queue.push(edge.target)
        }
      }
      return false
    }
    /** 目标是不是旁路 / 诊断出口（按真源的 `codeHints` 判，判据在本文件顶部就地复写了一份） */
    const chainHints = new Map([...chain.drivers, ...chain.nodes].map((item) => [item.id, (item.codeHints ?? []).map(String)]))
    const isBypass = (edge) => isBypassHint(chainHints.get(edge.target))
    const hasIndirect = (edge) =>
      graphEdges.some((other) => other.source === edge.source && other.target !== edge.target && reaches(other.target, edge.target))

    const crossEdges = graphEdges.filter((edge) => !edge.backbone)
    const wrongCoarse = crossEdges.filter((edge) => (edge.spanKind === 'coarse') !== (edge.levelSpan > 1 && hasIndirect(edge)))
    ok(wrongCoarse.length === 0, '「更细链条已蕴含」的标注与可达性重算一致（coarse 必须真有间接路径，反之亦然）', wrongCoarse.slice(0, 3).map((edge) => edge.id).join(','))
    const wrongBypass = crossEdges.filter((edge) => (edge.spanKind === 'bypass') !== (edge.levelSpan > 1 && !hasIndirect(edge) && isBypass(edge)))
    ok(wrongBypass.length === 0, '「旁路/诊断出口」的标注与真源的 S04 归属一致', wrongBypass.slice(0, 3).map((edge) => edge.id).join(','))
    const wrongSibling = crossEdges.filter((edge) => (edge.spanKind === 'sibling') !== (edge.levelSpan === 1))
    ok(wrongSibling.length === 0, '「同层第二个父」只标在层差 1 的边上', wrongSibling.slice(0, 3).map((edge) => edge.id).join(','))
    const silent = crossEdges.filter((edge) => !['sibling', 'coarse', 'bypass', 'gap'].includes(edge.spanKind))
    ok(silent.length === 0, '每条交叉边都有成因（没有静默的跨层箭头）', silent.slice(0, 3).map((edge) => edge.id).join(','))
    const listed = [
      ...(crossLevel.backbone ?? []),
      ...(crossLevel.sibling ?? []),
      ...(crossLevel.coarse ?? []),
      ...(crossLevel.bypass ?? []),
      ...(crossLevel.gap ?? []),
      ...(crossLevel.feedback ?? []),
    ]
    const duplicated = listed.filter((id, index) => listed.indexOf(id) !== index)
    ok(duplicated.length === 0, '每条边只进一个名单（骨干 / 同级多父 / 可传递 / 旁路 / 缺中间量 / 回流 互不重叠）', [...new Set(duplicated)].slice(0, 3).join(','))
    ok(listed.length === allEdges.length, '全部边（含 21 条块间接口与回流）都被分到某一类里', `${listed.length} vs ${allEdges.length}`)
    const declaredGaps = [...(crossLevel.gap ?? [])].sort()
    const actualGaps = crossEdges.filter((edge) => edge.spanKind === 'gap').map((edge) => edge.id).sort()
    ok(JSON.stringify(declaredGaps) === JSON.stringify(actualGaps), '缺中间量的边与名单一致（待补项不许漏报）', declaredGaps.join(','))
    console.log(
      `  · 骨干 ${backboneEdges.length} 条；交叉边 ${crossEdges.length} 条：同级多父 ${(crossLevel.sibling ?? []).length}` +
        ` / 更细链条已蕴含 ${(crossLevel.coarse ?? []).length} / 旁路诊断 ${(crossLevel.bypass ?? []).length} / 缺中间量 ${actualGaps.length}`,
    )
    console.log(`  · 跨红移回流 ${feedbackEdges.length} 条（层差为负、单列不参与主序分层）：${gotFeedbackIds.join('、')}`)
    if (actualGaps.length) console.log(`  · ⚠ 缺中间量的跨层边（待补，不静默）：${actualGaps.join('、')}`)
    const worstSpan = Math.max(0, ...graphEdges.map((edge) => edge.levelSpan ?? 0))
    console.log(
      `  · 最大层差 ${worstSpan} 层；层差分布 ${JSON.stringify(
        graphEdges.reduce((acc, edge) => ({ ...acc, [edge.levelSpan]: (acc[edge.levelSpan] ?? 0) + 1 }), {}),
      )}`,
    )
  }

  console.log('\n[子图：模块内部的步骤，且图是合法的]')
  const allNodeIds = (canvasGraph?.nodes ?? []).map((node) => node.id)
  const dupIds = allNodeIds.filter((id, index) => allNodeIds.indexOf(id) !== index)
  ok(dupIds.length === 0, '节点 id 全局唯一（同一 id 挂两个父节点是非法图）', [...new Set(dupIds)].slice(0, 4).join(','))
  const subgraphs = canvasGraph?.subgraphs ?? {}
  const subgraphParents = Object.keys(subgraphs)
  ok(subgraphParents.length > 0, '至少有一个模块有子图（双击能进去看步骤）', '一个都没有')
  const orphanSteps = Object.values(subgraphs)
    .flatMap((info) => info.steps)
    .filter((id) => !(canvasGraph?.nodes ?? []).some((node) => node.id === id))
  ok(orphanSteps.length === 0, '子图索引里的步骤都是真实的节点', orphanSteps.slice(0, 4).join(','))
  const badParents = Object.entries(subgraphs)
    .flatMap(([parent, info]) => info.steps.map((stepId) => ({ parent, stepId })))
    .filter(({ parent, stepId }) => {
      const step = (canvasGraph?.nodes ?? []).find((node) => node.id === stepId)
      return step?.parent !== parent
    })
  ok(badParents.length === 0, '每个步骤都挂在自己的模块下（parent 指向模块）', badParents.slice(0, 4).map((item) => item.stepId).join(','))
  console.log(`  · 有子图的模块 ${subgraphParents.length} 个：${subgraphParents.map((id) => `${id}(${subgraphs[id].steps.length}步)`).join(' ')}`)

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
  const feedbackEdgesAll = blockEdgesAll.filter((edge) => edge.spanKind === 'feedback')
  const quantityEdges = blockEdgesAll.filter((edge) => !edge.focusOnly && edge.spanKind !== 'feedback')
  const internalEdges = quantityEdges.filter((edge) => blockOfNode.get(edge.source) === blockOfNode.get(edge.target))
  const crossEdgesAll = quantityEdges.filter((edge) => blockOfNode.get(edge.source) !== blockOfNode.get(edge.target))
  ok(blockItems.length === 12, '真源里恰有 12 个块（10 过程 + 2 层）', String(blockItems.length))
  ok(blockNodes.length === 12, '产物里恰有 12 个块节点（块是普通节点，不是容器）', String(blockNodes.length))
  ok(
    blockNodes.every((node) => node.type === 'process' && !node.chain),
    '块节点不是 `group` 容器（容器之间不许有边，而块间要画接口边）',
    blockNodes.filter((node) => node.type !== 'process').map((node) => `${node.id}=${node.type}`).join(','),
  )
  const processBlocks = blockNodes.filter((node) => node.blockKind === 'process')
  const layerBlocks = blockNodes.filter((node) => node.blockKind === 'layer')
  ok(processBlocks.length === 10, '过程块恰为 10 个（一个块 = 一个 Compute* 步）', String(processBlocks.length))
  ok(layerBlocks.length === 2, '层恰为 2 个（L0 常数与网格 / L1 共享内核）', String(layerBlocks.length))
  ok(
    layerBlocks.every((node) => node.enterable === false),
    '**层不可进入**（L0/L1 进去没有子图）',
    layerBlocks.filter((node) => node.enterable).map((node) => node.id).join(','),
  )
  const unordered = [...blockItems].filter(
    (block, index) => index > 0 && (block.order ?? 0) < (blockItems[index - 1].order ?? 0),
  )
  ok(unordered.length === 0, '块按主序位次（`order`，真源声明）从下往上排', unordered.map((block) => block.id).join(','))
  /**
   * 每个过程块的代码锚都在真源里：`.c` 文件 + `Compute*` 函数 + 输出盒子结构名；
   * **层的锚是成员文件清单**（spec：层 MUST 带成员文件清单作为锚——L1 的头文件没有 `Compute*`，
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
    '每个过程块都有「.c + Compute* + 输出盒子结构名」的锚，每个层都有成员文件清单锚',
    missingAnchor.map((block) => block.id).join(','),
  )
  /**
   * **代码锚真的存在**（可证伪）：过程块的文件在磁盘上、且那个 `Compute*` 名字真的出现在该文件里；
   * 层的成员文件也逐个在磁盘上（L1 的头文件还要求真被 `.c` 引用过，见引用面那一条）。
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
   * 层的成员是**文件**（L1 的 16 个公共头文件）——它们不是图上的节点，所以"28 个物理量"这条
   * 只对物理量成员核对；文件成员另立一条（只许出现在层里）。
   */
  const declaredMembers = blockItems.flatMap((block) => block.members ?? [])
  const duplicatedMembers = declaredMembers.filter((id, index) => declaredMembers.indexOf(id) !== index)
  ok(duplicatedMembers.length === 0, '没有量属于两个块（不重）', [...new Set(duplicatedMembers)].join(','))
  ok(allQuantityIds.length === 39, '物理量共 39 个（34 nodes + 5 drivers）', String(allQuantityIds.length))
  const quantityMemberIds = declaredMembers.filter((id) => allQuantityIds.includes(id))
  const fileMemberIds = declaredMembers.filter((id) => !allQuantityIds.includes(id))
  ok(
    JSON.stringify([...quantityMemberIds].sort()) === JSON.stringify([...allQuantityIds].sort()),
    '块的物理量成员并集 = 全部 39 个物理量（不重不漏；驱动量不再漂在一级）',
    `成员里 ${quantityMemberIds.length} 个是物理量`,
  )
  ok(fileMemberIds.length === 16, '非物理量成员恰为 16 个（L1 的公共头文件）', String(fileMemberIds.length))
  const fileMembersOutsideLayers = blockItems
    .filter((block) => block.kind !== 'layer')
    .flatMap((block) => (block.members ?? []).filter((id) => !allQuantityIds.includes(id)).map((id) => `${block.id}:${id}`))
  ok(fileMembersOutsideLayers.length === 0, '文件成员只出现在层里（过程块的成员必须都是物理量）', fileMembersOutsideLayers.slice(0, 3).join(','))
  const declaredLayerFiles = blockItems
    .filter((block) => block.kind === 'layer')
    .flatMap((block) => (block.members ?? []).filter((id) => id.endsWith('.h')))
  ok(
    declaredLayerFiles.every((id) => !id.includes('/') && id.endsWith('.h')),
    '层的文件成员写成「不过路径的头文件名」（视图按名字查引用它的 .c 个数）',
    declaredLayerFiles.filter((id) => id.includes('/')).slice(0, 3).join(','),
  )
  /**
   * **左栏第二个检索面（天体物理过程）**：真源 `processes` 的三条不变量。
   *   · **不重不漏**：8 个过程 + 2 条带 + 兜底名单的并集，恰好 = 全部 34 个量 + 5 个驱动量。
   *     旧划分之外的 `matter_power` / `vcb` / `perturb_field` / `filtered_xray` 进**兜底名单**，
   *     不替它们硬编过程名（本仓"不凭印象补"的纪律：缺口要显示出来，不能被合并粉饰）。
   *   · **成员悬空**：每个成员都必须是图上的量（`allQuantityIds` 里那种 id）。
   *   · **不吃 `order`**：过程面**不是第三条一级轴** —— 过程不许写 `order`（那是块的摆位字段）、
   *     名字不许带序号或 `M*` 形式（同屏已有三套 ⓪…⑨ 与 M1…M10），免得被误读成一级的排位。
   */
  console.log('\n[左栏第二个检索面：天体物理过程（划分来自真源 chain.json 的 processes.items）]')
  const processItems = artifact.processes?.items ?? []
  ok(processItems.length === 10, '过程面共 10 条词条（8 个过程 + 2 条带）', String(processItems.length))
  ok(
    processItems.filter((item) => item.kind === 'process').length === 8 && processItems.filter((item) => item.kind === 'band').length === 2,
    '8 条是过程、2 条是带（带不是过程：成员之间没有块内边，进不去子图）',
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
    '8 过程 + 2 带 + 兜底名单 = 全部 39 个物理量（不重不漏）',
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
  ok(badFit.length === 0, '每条过程的 `fit` 都是字符串（查不到就留空，不推断）', badFit.map((item) => item.id).join(','))
  console.log(
    `  · 过程面成员 ${processMembers.length} 个 + 兜底 ${uncoveredMembers.length} 个 = ${allQuantityIds.length}（${uncoveredMembers.join('、')}）；` +
      `有论文拟合律的 ${processItems.filter((item) => item.fit).length} 条，留空待核的 ${processItems.filter((item) => !item.fit).length} 条`,
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
  /** 量 → 参数（矩阵的列方向，独立聚一遍；行方向直接扫每条参数自己的 `nodes`） */
  const paramsOfNodeId = new Map()
  for (const [name, row] of Object.entries(matrix)) {
    for (const nodeId of row?.nodes ?? []) {
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
      .filter(([, row]) => (row?.nodes ?? []).some((id) => members.has(id)))
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

  /**
   * **共享内核层的量化呈现要能证伪**（spec 的 Scenario「共享内核层量化呈现」）：
   * 单独读一遍源码里的 `#include`，重算每个头文件被几个 `.c` 引用，然后断言
   *   ① 成员顺序 = 引用面降序（层里就是按这个排的，不是随手排的）；
   *   ② 每个成员都被至少 1 个 `.c` 真引用（不是把无关文件塞进层里凑数）；
   *   ③ 注释里写的「文件名 计数」每一对都与重算一致（防手写的数字慢慢漂）。
   */
  const kernelBlock = blockItems.find((block) => block.kind === 'layer' && (block.members ?? []).some((id) => id.endsWith('.h')))
  const kernelHeaders = (kernelBlock?.members ?? []).filter((id) => id.endsWith('.h'))
  const srcNames = await fs.readdir(SRC_DIR).catch(() => [])
  const includeCount = new Map()
  for (const name of srcNames.filter((item) => item.endsWith('.c'))) {
    const text = await fs.readFile(path.join(SRC_DIR, name), 'utf8').catch(() => '')
    for (const match of new Set([...text.matchAll(/^\s*#\s*include\s+"([^"]+)"/gm)].map((item) => item[1]))) {
      includeCount.set(match, (includeCount.get(match) ?? 0) + 1)
    }
  }
  ok(kernelHeaders.length === 16, '共享内核层有 16 个头文件成员', String(kernelHeaders.length))
  ok(
    kernelHeaders.every((id) => includeCount.has(id)),
    '每个头文件成员都真的被某个 `.c` #include（层里不塞没人用的文件）',
    kernelHeaders.filter((id) => !includeCount.has(id)).join(','),
  )
  const countSeq = kernelHeaders.map((id) => includeCount.get(id) ?? 0)
  const notDescending = countSeq.filter((count, index) => index > 0 && count > countSeq[index - 1])
  ok(
    notDescending.length === 0,
    '成员顺序 = 引用面降序（cosmology.h 21 → … → LuminosityFunction.h 1，独立重算）',
    countSeq.join(' '),
  )
  const declaredCounts = [...String(kernelBlock?.note ?? '').matchAll(/([A-Za-z_]+\.h)\s+(\d+)/g)].map((match) => [
    match[1],
    Number(match[2]),
  ])
  const wrongCounts = declaredCounts.filter(([name, count]) => (includeCount.get(name) ?? -1) !== count)
  ok(
    wrongCounts.length === 0 && declaredCounts.length === kernelHeaders.length,
    '注释里写的每个「头文件 计数」都与源码重算一致（16 个，一个不落）',
    wrongCounts.map(([name, count]) => `${name}:写 ${count} / 实测 ${includeCount.get(name) ?? 0}`).join('，') ||
      `注释里只写了 ${declaredCounts.length} 对`,
  )
  /** 文件成员不是图上的节点：它们没有 `parent` 可言，下面的 parent 断言只对"真的是节点"的成员做 */
  const fileMemberNodes = fileMemberIds.filter((id) => allGraphNodes.some((node) => node.id === id))
  ok(fileMemberNodes.length === 0, '文件成员不在图上（层的成员是文件，不是节点；所以不进画布也不参与布局）', fileMemberNodes.join(','))
  const unboxed = [...blockOfNode]
    .filter(([id]) => allGraphNodes.some((node) => node.id === id))
    .filter(([id, blockId]) => allGraphNodes.find((node) => node.id === id)?.parent !== blockId)
  ok(unboxed.length === 0, '每个成员（图上的节点）都挂在自己块的 parent 上（parent 正确）', unboxed.slice(0, 4).map(([id]) => id).join(','))
  const nameless = blockNodes.filter((node) => !node.label)
  ok(nameless.length === 0, '每个块都带名字（取自真源 blocks.items 的 label）', nameless.map((node) => node.id).join(','))
  /**
   * 块级数字（`specs/graphify-physics-chain/spec.md` 的「块级数字可证伪」）：对不上要指出差在哪个数上。
   */
  ok(quantityEdges.length === 55, '量 → 量的主序依赖边恰为 55 条', String(quantityEdges.length))
  ok(internalEdges.length === 25, '块内边恰为 25 条（只进子图，不进主图）', String(internalEdges.length))
  ok(crossEdgesAll.length === 30, '跨块边恰为 30 条（已汇总成接口边）', String(crossEdgesAll.length))
  ok(
    crossEdgesAll.length + internalEdges.length + interfaceEdges.length + feedbackEdgesAll.length ===
      blockEdgesAll.length,
    '一级的边恰好分完：`块内 + 跨块 + 接口 + 回流 = 全部`（没有来路不明的边）',
    `${internalEdges.length} + ${crossEdgesAll.length} + ${interfaceEdges.length} + ${feedbackEdgesAll.length} vs ${blockEdgesAll.length}`,
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
    (edge) => edge.levelSpan !== (orderOfBlock.get(edge.target) ?? 0) - (orderOfBlock.get(edge.source) ?? 0) || edge.levelSpan < 1,
  )
  ok(badIfaceSpan.length === 0, '接口边的位次差 = 两端块的 `order` 差，且一律 ≥1（全部自下而上）', badIfaceSpan.slice(0, 3).map((edge) => edge.id).join(','))
  /**
   * `graph.blocks`：块的**完整事实**（成员 / 可进入 / 档位 / 坐标 / 出入接口），视图与状态条都读它。
   * 这里对关键两项（成员并集、块内连通）**独立重算**一遍，不信任生成器写的标记——
   * 否则「⓪⑨ 不可进入」写错了没人发现，视图就会给出一个点进去只有孤盒的入口。
   * 其中「出入接口」**不进界面**，只在这里配对核对。
   */
  const blocksOut = canvasGraph?.blocks ?? {}
  const blockOutItems = blocksOut.items ?? []
  ok(blockOutItems.length === 12, '生成物里有 `graph.blocks.items`（一级划分的完整事实，12 条）', String(blockOutItems.length))
  const membersOut = blockOutItems.flatMap((item) => item.members ?? [])
  const quantityMembersOut = membersOut.filter((id) => allQuantityIds.includes(id))
  ok(
    JSON.stringify([...quantityMembersOut].sort()) === JSON.stringify([...allQuantityIds].sort()),
    '`blocks.items` 的物理量成员并集 = 全部 39 个物理量（不重不漏）',
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
   * 层同理（成员是头文件，并集天然为空）。
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
    emptyStages.length <= 2 && emptyStages.every((item) => item.kind === 'layer'),
    '没有代码阶段的块只会是层（L0 常数 / L1 头文件本身不是某一段计算）',
    emptyStages.map((item) => `${item.id}(${item.kind})`).join(','),
  )
  const notEnterable = blockOutItems.filter((item) => !item.enterable)
  ok(
    notEnterable.length === 2 && notEnterable.every((item) => item.kind === 'layer'),
    '恰有 2 个块不可进入，且都是层（L0 / L1）',
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
      JSON.stringify({ blocks: 12, processBlocks: 10, layerBlocks: 2, members: 39, fileMembers: 16, interfaceEdges: 21 }),
    '一级口径数字（12 块 / 10 过程 / 2 层 / 39 物理量成员 / 16 文件成员 / 21 接口）与重算一致',
    JSON.stringify(statsOut),
  )
  console.log(
    `  · 12 块（过程 ${processBlocks.length} / 层 ${blockItems.length - processBlocks.length}）· 物理量成员 ${quantityMembersOut.length} + 文件成员 ${membersOut.length - quantityMembersOut.length} ·` +
      ` 接口 ${interfaceEdges.length} 条 · 回流 ${feedbackEdgesAll.length} 条 · 块内边 ${internalEdges.length} 条 · 可进入 ${blockOutItems.length - notEnterable.length} 个（不可进入：${notEnterable.map((item) => item.id.replace('block:', '')).join('、')}）`,
  )

  console.log('\n[分层：一级只讲物理（一级默认可见集 = 12 个块）]')
  {
    const allGraphNodes = canvasGraph?.nodes ?? []
    /**
     * 独立重算一级的可见集，**一个话题都不关**（视图也不再关，见下面「视图纪律」里的源码断言）：
     * 规则同 `src/lib/topics.ts` 的 tabVisibleIds —— 遍历只在**容器**（`type: 'group'`）上下钻。
     *
     * 产物里已经没有任何容器（块是普通节点），于是可见集 = 根节点集合。
     * "一级恰好 12 个块"因此是**结构**保证的：39 个物理量成员与 16 个文件成员挂在块下、
     * 步骤挂在成员下，三层各自不越界；而不是靠"默认收起几个话题"过滤出来的。
     */
    const containers = allGraphNodes.filter((node) => node.type === 'group')
    ok(
      containers.length === 0,
      '产物里没有容器节点（一级的干净由结构保证，不靠话题过滤）',
      containers.map((node) => node.id).join(','),
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
    ok(
      visible.size === 12 && visibleBlocks.length === 12,
      '一级默认可见集恰好是 12 个块（成员、步骤、工程项都不露）',
      `可见 ${visible.size} 个，其中块 ${visibleBlocks.length} 个`,
    )
    const leakedQuantities = [...visible].filter((id) => blockOfNode.has(id))
    ok(leakedQuantities.length === 0, '没有任何物理量漏在一级（39 个全装在块里）', leakedQuantities.join(','))
    const leakedSteps = [...visible].filter((id) => String(id).startsWith('step:'))
    ok(leakedSteps.length === 0, '实现步骤不在默认可见集里（证据默认收起）', leakedSteps.join(','))
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
   * **不可进入的带不给入口**：⓪ 环境 / ⑨ 观测量 的成员互不相连，进去只有孤盒。
   * 判据读生成物的 `enterable`（不是视图自己猜"有没有子节点"）。
   */
  ok(
    viewSource.includes('block.enterable'),
    '「进入子图」与双击都看生成物的 `enterable`（两条带不给入口）',
    '视图自己按"有没有子节点"判断能不能进',
  )
  /**
   * **子节点数只数"这个对象自己的"**：块＝它自己的成员数（层不给入口 → 0），
   * 成员＝它自己的实现步骤数。`blockOf` 回答的是"这个量**装在**哪个块里"——
   * 拿它当成员自己的子节点数，⑨观测量 里的 `p21` / `k_target`（没有实现步骤）就会报出
   * 「4 个子节点」（＝ M10 的成员数），点进去却是一张空画布。
   * 这里**真跑** lib 的 `subgraphSizeOf`（按钮上的数字与"能不能进"共用它这一处判据）。
   */
  {
    const { subgraphSizeOf } = await loadTs('src/lib/physicsChain.ts', 'physicsChain')
    const obsBlock = (canvasGraph?.blocks?.items ?? []).find((block) => block.id === 'block:obs')
    const cases = [
      ['block:obs', obsBlock ? obsBlock.memberCount : -1, '过程块数自己的成员'],
      ['block:const', 0, '层不给入口'],
      ['eps_heat', (canvasGraph?.subgraphs?.eps_heat?.steps ?? []).length, '成员数自己的实现步骤'],
      ['p21', 0, '没有实现步骤的成员——不是它所属的 ⑨观测量 的成员数'],
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
   *   · 关（默认可见组，`spanKind !== 'feedback'`）＝ 有向环 **0** 个；
   *   · 开（加回回流组）＝ **恰好 1** 个环簇，且每条回流边的两端块都落在环簇里。
   * 环簇的成员与条数都从产物算出来（今天 4 个块），不写死是哪几个块——回流段增删一条，这里跟着变。
   * 另有一条反向断言：工程图谱 `data/graph.json` 里没有这类边（画布页因此零影响，也不该有那个开关）。
   */
  console.log('\n[跨红移回流：默认不画、只辖产物标记的边]')
  {
    const edges = canvasGraph?.edges ?? []
    const nodeById = new Map(allGraphNodes.map((node) => [node.id, node]))
    const feedbackEdges = edges.filter((edge) => edge.spanKind === 'feedback')
    const defaultVisible = edges.filter((edge) => edge.spanKind !== 'feedback')
    ok(feedbackEdges.length >= 1, '产物里有标为跨红移回流的边（否则开关没有可管对象）', String(feedbackEdges.length))
    /**
     * 标记要自洽：`kind` 与 `spanKind` 都是 `feedback`（生成器的种类标记 / 视图读的边种类）、
     * `crossLink` 为真（它绕开树脊画弧）、`surface` 为真（要出现在画布上）、**不带 `focusOnly`**
     * ——它归开关管（连同它在弧两端块子图里的落点与落点那些盒子），不借接口边那套"静息不画、悬浮才显现"。
     */
    const badMarks = feedbackEdges.filter(
      (edge) =>
        edge.kind !== 'feedback' ||
        edge.spanKind !== 'feedback' ||
        edge.crossLink !== true ||
        edge.surface !== true ||
        edge.focusOnly === true,
    )
    ok(
      badMarks.length === 0,
      '回流边的标记自洽（kind / spanKind = feedback、crossLink 与 surface 为真、不带 focusOnly）',
      badMarks.slice(0, 3).map((edge) => edge.id).join(','),
    )
    /**
     * **只有回流边带回流标记**：视图按这个标记摘边，多标一条就等于顺手藏掉一条主序边。
     * 「默认可见 ⊎ 回流 = 全部边」是同一件事的另一面：关掉开关少掉的恰好是这几条。
     */
    const declaredFeedback = edges.filter((edge) => edge.kind === 'feedback')
    ok(
      declaredFeedback.length === feedbackEdges.length && declaredFeedback.every((edge) => edge.spanKind === 'feedback'),
      '带回流种类标记的边恰是这一类（关掉开关时少掉的只有它们）',
      `kind ${declaredFeedback.length} vs spanKind ${feedbackEdges.length}`,
    )
    const bothSides = [...defaultVisible, ...feedbackEdges].map((edge) => edge.id).sort()
    ok(
      JSON.stringify(bothSides) === JSON.stringify(edges.map((edge) => edge.id).sort()),
      '「默认可见 ⊎ 回流 = 全部边」（一条不多一条不少）',
      `${defaultVisible.length} + ${feedbackEdges.length} vs ${edges.length}`,
    )
    /**
     * **标签给出的是回流的两个端量**（`fromNode` 的符号 → `toNode` 的符号），与真源逐字一致。
     * 期望值在这里从真源节点表现算，所以真源换了端量而产物没跟着换，这里就报出来。
     */
    const wantLabel = new Map(
      (chain.feedback ?? []).map((item) => [
        `feedback:${item.from}->${item.to}`,
        `${symbolOfNode.get(item.fromNode)} → ${symbolOfNode.get(item.toNode)}`,
      ]),
    )
    const badLabel = feedbackEdges.filter((edge) => edge.label !== wantLabel.get(edge.id))
    ok(
      badLabel.length === 0,
      '回流边的标签 = 两端量的符号（与真源 feedback 段逐字一致）',
      badLabel.slice(0, 3).map((edge) => `${edge.id}=${edge.label}｜期望 ${wantLabel.get(edge.id)}`).join(','),
    )
    /**
     * **弧画在一级、关系落进子图**：弧的两端是没有 `parent` 的一级块（这条弧本身进不了任何子图），
     * 但同一件事在子图里要讲得出来——收方块的成员确实读上一轮的那个量，来源块的成员也确实把它送了出去。
     * 两件事分开查。
     */
    const notTopLevel = feedbackEdges.filter((edge) => nodeById.get(edge.source)?.parent || nodeById.get(edge.target)?.parent)
    ok(
      notTopLevel.length === 0,
      '每条回流边的两端都是没有 `parent` 的一级块（弧画在一级，不冒充实现在某个块里）',
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
              other.spanKind !== 'feedback' &&
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
          .filter((edge) => edge.spanKind !== 'feedback' && visible.has(edge.source) && visible.has(edge.target))
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
    const legacyFeedback = legacyEdges.filter((edge) => edge.kind === 'feedback' || edge.spanKind === 'feedback')
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
     * 子图的可见集 = 成员 + 对外输入。**但成员的"文件成员"（L1 的 16 个头文件）不是图上的节点**，
     * 不可能出现在画布上，所以这里按"真的是节点的成员"算——否则 L1 的可见集会拿 16 个不存在的 id
     * 去跟画布对账，报一堆假失败。
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
     * 第三个断言说的是反面包：子图只对过程块开，所以层（L0 常数与网格 / L1 共享内核）没有子图，
     * 层里的成员（16 个公共头文件，以及只在常数层里出现的量）不会作为成员铺进任何子图。
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
      '对外输入都不是一级节点（主图静息仍只有 12 个块，`T_γ` 不会多出来一个）',
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
      setupSource.includes("edge.spanKind === 'feedback-input'") && setupSource.includes("data('subgraphOf')"),
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
      /spanKind === 'feedback'/.test(viewSource),
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

    // —— 4.3 不可进入的块（L0 / L1 两个层）不给双击与「进入子图 ↗」——
    ok(
      notEnterable.every((item) => (item.members ?? []).length > 0),
      '两个层都真的装着成员（"不可进入"不是空块：L0 一个物理量 + L1 十六个头文件）',
      notEnterable.filter((item) => !(item.members ?? []).length).map((item) => item.id).join(','),
    )
    /**
     * **层只出不进**：L0 的 `T_γ` 是根部的输入，它当然有出边（→ M8 / M10 的灰显上下文）；
     * 该守的是**没人把层当成下游**——层不该从别的块收接口边（收了就说明它被当成了主序里的一步）。
     * L1 更彻底：头文件不是物理量，一条接口边都不该有。
     */
    const layerIncoming = interfaceEdges.filter((edge) => notEnterable.some((item) => item.id === edge.target))
    ok(
      layerIncoming.length === 0,
      '**层只出不进**：没有块把层当下游（层是横切的，不是主序里的一步）',
      layerIncoming.map((edge) => `${edge.source}->${edge.target}`).join(','),
    )
    const kernelIface = interfaceEdges.filter((edge) => edge.source === 'block:kernel' || edge.target === 'block:kernel')
    ok(
      kernelIface.length === 0,
      '共享内核层一条接口边都没有（头文件不是物理量，没有什么"流"过它）',
      kernelIface.map((edge) => edge.id).join(','),
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
      '双击与「进入子图」都拦在 `!block.enterable` 上（带只出只读提示、不开标签页）',
      '视图没拦不可进入的块',
    )
    ok(
      setupSource.includes('enterable: node.enterable !== false') && setupSource.includes("node.data('enterable') === false"),
      '画布按 `enterable` 决定"能不能进去"的信号（带不挂光晕 / 粒子，属性页也不给入口）',
      '画布没按 `enterable` 收信号',
    )

    // —— 4.4 成员自己的子节点（实现步骤）不随块子图铺开 ——
    const stepNodes = allGraphNodes.filter((node) => String(node.id).startsWith('step:'))
    const stepOnBlock = stepNodes.filter((node) => blockIdSet.has(node.parent)).map((node) => node.id)
    ok(
      stepOnBlock.length === 0,
      '实现步骤挂在自己的成员（量）下、不挂块（层级上就不可能出现在块子图里）',
      stepOnBlock.join(','),
    )
    const leakedSteps = blockOutItems.flatMap((item) =>
      stepNodes.filter((step) => subgraphIds(item).has(step.id)).map((step) => `${item.id}:${step.id}`),
    )
    ok(
      leakedSteps.length === 0,
      '块子图的可见集里没有任何实现步骤（成员的子节点不再往下钻）',
      leakedSteps.slice(0, 4).join(','),
    )
    const dtbBlock = blockOutItems.find((item) => (item.members ?? []).includes('dtb'))
    const dtbSteps = stepNodes.filter((node) => node.parent === 'dtb').map((node) => node.id)
    ok(
      dtbSteps.length > 0 && Boolean(dtbBlock) && !subgraphIds(dtbBlock).has(dtbSteps[0]),
      '⑧亮温方程 的子图里看不到 `dtb` 自己的实现步骤（步骤真实存在，只是不铺进块子图）',
      `⑧ 子图可见 ${subgraphIds(dtbBlock ?? {}).size} 个 / dtb 名下 ${dtbSteps.length} 个步骤`,
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
    ok(tabVisibleIds(hierarchy, null).size === 12, '主图的可见集仍是 12 个块（对外输入不进主图）', String(tabVisibleIds(hierarchy, null).size))
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
   * **引用：一处口径**（design D6 的四条断言）。
   *
   * 对拍的口径与生成器那一处函数是同一条（生成器那边写着"自检脚本照这段话**独立实现一遍**再逐条对拍"）：
   *   · **起点（原子）**：实现步骤（叶子）的代码落点（产物里那几条——生成器按单元收的，自检不复造）
   *     与每个量自己的 `code.sites`（与属性页那个条数是同一份）；
   *   · **只有两个来源**：自身那几条 + 直接子节点的（按 `parent` 反向表）；块**不看 `parent`**，
   *     成员取自真源 `blocks.items[].members`（归属的唯一来源）。层里那 16 个成员是文件名、
   *     不在图上 → 按"没有贡献"处理，层的代码引用由真源的层声明**直接给出**（`kind === 'files'`）；
   *   · **去重键** `file:line:endLine` / `docId#anchor`（**不含 `label`**：同一条落点会同时挂在父与子，
   *     标签不同就永远去不掉重）；**排序逐字符**（`localeCompare` 会随运行环境的 ICU 变、产物会抖）。
   * 多一条、少一条、顺序不对都要指名对象与那一条；汇总时**漏一层**必然在这里露馅。
   */
  console.log('\n[引用：一处口径（叶子最细、祖先 = 并集、模块 = 成员的并集）]')
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
    /** 笔记引用：模块骨架文档里的一个小节；锚点 = 小节标题的 slug，而那个标题就是节点标签本身 */
    const noteOf = (docId, heading) => ({ file: '', docId, anchor: refSlug(heading) })
    /** 自身那几条（不含从子节点汇总来的） */
    const ownRefs = (node) => {
      const isStep = String(node.id).startsWith('step:')
      /**
       * 笔记承载的归属：量看**自己的块**；步骤看**它挂在哪个量下、那个量属于哪个块**——
       * 步骤不是块成员（真源成员表里没有它），但它的小节写在同一份模块文档里。
       */
      const docId = String(ownerOf.get(isStep ? String(node.parent ?? '') : node.id)?.noteDoc ?? '')
      const own = []
      if (isStep) {
        // 叶子：代码落点是原子——生成器按单元收的（`byUnit`），自检不复造，只要求"那一条笔记不少"
        own.push(...(node.refs ?? []).filter((ref) => ref.file))
      } else {
        // 论文出处（真源 `reviewSection`）+ 代码落点（`code.sites` 那一条清单本身）
        if (String(sourceOf.get(node.id)?.reviewSection ?? '').trim()) own.push({ file: '', docId: 'physics-chain/papers.md', anchor: '' })
        for (const site of quantityOf.get(node.id)?.code?.sites ?? []) {
          if (Number.isFinite(site.line)) own.push({ file: site.file, line: site.line, endLine: site.endLine ?? null })
        }
      }
      if (docId) own.push(noteOf(docId, node.label))
      return own
    }
    const own = new Map()
    for (const node of refNodes) if (!String(node.id).startsWith('block:')) own.set(node.id, ownRefs(node))
    /**
     * 块自身那一条：模块笔记（锚点 = 文档 H1 的 slug，即块标签）；层再加**整文件级**代码落点——
     * 直接取真源的层声明（`codeAnchor.kind === 'files'`），行区间 = 1 到文件末尾（行数自己数一遍，
     * 不抄产物里的数：这一步正是"直接给出"与"汇总"的分界）。
     */
    for (const block of blockItems) {
      const refs = []
      if (String(block.noteDoc ?? '').trim()) refs.push(noteOf(String(block.noteDoc), String(block.label)))
      if (block.codeAnchor?.kind === 'files') {
        for (const name of block.codeAnchor.files ?? []) {
          const text = await fs.readFile(path.join(SRC_DIR, name), 'utf8').catch(() => null)
          refs.push({ file: `src/py21cmfast/src/${name}`, line: 1, endLine: text === null ? null : text.split('\n').length })
        }
      }
      own.set(block.id, refs)
    }
    const refChildren = new Map()
    for (const node of refNodes) {
      if (!node.parent) continue
      refChildren.set(node.parent, [...(refChildren.get(node.parent) ?? []), node.id])
    }
    const expectedMemo = new Map()
    const expectedOf = (id) => {
      if (expectedMemo.has(id)) return expectedMemo.get(id)
      const memberIds = String(id).startsWith('block:')
        ? (blockItems.find((block) => block.id === id)?.members ?? []).filter((memberId) => own.has(memberId))
        : (refChildren.get(id) ?? [])
      const merged = canonRefs([own.get(id) ?? [], ...memberIds.map((childId) => expectedOf(childId))])
      expectedMemo.set(id, merged)
      return merged
    }
    const refMismatch = []
    for (const node of refNodes) {
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
      '每个对象的引用 = 自身 ∪ 直接子节点的（自检从叶子独立重算、逐条对拍；多一条也失败）',
      `${refMismatch.length} 个对不上：${refMismatch.slice(0, 3).join(' | ')}`,
    )
    const moduleEmpty = blockItems.filter((block) => {
      const refs = refNodeById.get(block.id)?.refs ?? []
      return !refs.some((ref) => ref.file) || !refs.some((ref) => ref.docId)
    })
    ok(
      moduleEmpty.length === 0,
      '12 个模块各自至少 1 条代码引用 + 1 条笔记引用（层的代码引用由真源的层声明直接给出，不靠汇总凑）',
      moduleEmpty.map((block) => `${block.id}(${block.kind})`).join(','),
    )
    const bothEmpty = refNodes.filter(
      (node) =>
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
     * 标签上的数字直接数数组长度。所以数据侧要守的不变量是——**每条引用恰好归一组**：
     * `file` 与 `docId` 恰有一个非空。否则会出现"标签说 3 条、卡片只铺出 2 条"
     * （既不进「源码」也不进「文献」的那条永远看不见）。
     * `code.count / code.sites` 是量自己的那份落点清单（`sites` 按 `MAX_SITES` 截断），页面不读它，
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
                  return match && match[2].trim() ? [{ depth: match[1].length, text: match[2].trim(), slug: refSlug(match[2].trim()) }] : []
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
     * **骨架形状**（design 的风险项）：12 份骨架 MUST 有标题 + 逐成员 `##` + 逐步骤 `###`，
     * 且与它承载的成员 / 步骤**逐条一致**（空文件、漏写一节、标题写错都失败）。
     * 标题就是节点标签本身（锚点由它算出来），所以这里比的是**标签清单**、不是"够不够几个"。
     * 层的成员是文件名（不在图上），按 id 原样比。
     */
    const shapeProblems = []
    for (const block of blockItems) {
      const docId = String(block.noteDoc ?? '')
      const headings = docId ? await headingsIn(docId) : null
      if (!headings) {
        shapeProblems.push(`${block.id}：骨架文档打不开（noteDoc=${docId || '（空）'}）`)
        continue
      }
      const atDepth = (depth) => headings.filter((heading) => heading.depth === depth).map((heading) => heading.text)
      const labelOf = (id) => String(refNodeById.get(id)?.label ?? id)
      const stepLabels = (block.members ?? []).flatMap((memberId) =>
        ((canvasGraph?.subgraphs ?? {})[memberId]?.steps ?? []).map((stepId) => labelOf(stepId)),
      )
      const wants = [
        [1, [String(block.label)], 'H1'],
        [2, (block.members ?? []).map((memberId) => labelOf(memberId)), '## 成员'],
        [3, stepLabels, '### 步骤'],
      ]
      for (const [depth, want, name] of wants) {
        const got = atDepth(depth)
        if (JSON.stringify(got) === JSON.stringify(want)) continue
        const firstOff = want.findIndex((text, index) => got[index] !== text)
        shapeProblems.push(
          `${docId}：${name} 与所承载的节点不一致（应 ${want.length} 节 / 实 ${got.length} 节；` +
            `先差在「${firstOff < 0 ? (got[want.length] ?? '多出来的小节') : want[firstOff]}」）`,
        )
      }
    }
    ok(
      shapeProblems.length === 0,
      '12 份骨架的形状：标题 + 逐成员 `##` + 逐步骤 `###`（空文件、漏写一节、标题写错都失败）',
      shapeProblems.slice(0, 3).join(' | '),
    )
    const withCode = refNodes.filter((node) => (node.refs ?? []).some((ref) => ref.file)).length
    const withDoc = refNodes.filter((node) => (node.refs ?? []).some((ref) => ref.docId)).length
    const refBlank = refNodes.filter((node) => !(node.refs ?? []).length).length
    const uniqueRefs = new Set(refNodes.flatMap((node) => (node.refs ?? []).map(refKeyOf)))
    console.log(
      `  · ${refNodes.length} 个对象里：有代码引用 ${withCode} 个 / 有笔记引用 ${withDoc} 个 / 零引用 ${refBlank} 个；去重后共 ${uniqueRefs.size} 条`,
    )
    console.log(
      `  · 12 个模块的引用条数：${blockItems.map((block) => `${block.id.replace('block:', '')}(${(refNodeById.get(block.id)?.refs ?? []).length})`).join(' ')}`,
    )
  }

  /**
   * **呈现面：名字与落点不带内部编号**。
   *
   * 判据是"这句话是给读者看的，还是给核对用的"：给读者看的（框上的字、散文、命中的说明、引用的落点、
   * 骨架的标题）一律不含编号（`L0` / `M1…M10` / `S14.3.1`）；给核对用的（`stage` / `codeHints` /
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

    /** 4) 骨架面：文件名 + `#` / `##` / `###` 标题（标题就是名字，锚点由它算出来） */
    const docOffenders = []
    for (const block of truthBlocks) {
      const docId = String(block.noteDoc ?? '')
      if (!docId) continue
      if (codeShape(path.basename(docId))) docOffenders.push(`${docId}：文件名带编号`)
      const text = await fs.readFile(path.join(REPO_ROOT, 'docs', 'notes', docId), 'utf8').catch(() => null)
      if (text === null) {
        docOffenders.push(`${docId}：文档打不开`)
        continue
      }
      for (const line of text.split('\n')) {
        if (/^#{1,3} /.test(line) && codeShape(line.slice(line.indexOf(' ') + 1))) docOffenders.push(`${docId}：${line.trim()}`)
      }
    }
    ok(
      docOffenders.length === 0,
      '12 份骨架的文件名与标题不带编号（标题＝名字，锚点由它算出来）',
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
    const stepIdsKept = (outGraph.nodes ?? []).filter((node) => /^step:[A-Z]\d/.test(String(node.id))).length
    const codeRefLabels = unique(
      (outGraph.nodes ?? []).flatMap((node) => (node.refs ?? []).filter((ref) => ref.file).map((ref) => String(ref.label ?? ''))),
    )
    const codedRefLabels = codeRefLabels.filter((label) => codeShape(label))
    ok(
      stagesKept >= 8 && stepIdsKept > 0 && codedRefLabels.length > 0,
      '编号仍在数据里（块的 `stages`、步骤 id、源码引用的标签都还带阶段号）',
      `带阶段的块 ${stagesKept} 个 / 带码的步骤 id ${stepIdsKept} 个 / 带码的源码引用标签 ${codedRefLabels.length} 种`,
    )
    console.log(
      `  · 出口自查：标签 / 落点 / 散文 / 骨架 / 命中说明都不含编号；按 \`S14\` 命中 ${stageHits.hits.length} 条且说明里没有它；` +
        `编号留在 ${stagesKept} 个块的 \`stages\` 与 ${codedRefLabels.length} 种源码引用标签里`,
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
}

await main()

console.log('')
if (failures.length) {
  console.error(`✗ 物理链自检失败：${failures.length} / ${checks} 项`)
  for (const line of failures) console.error(`  · ${line}`)
  process.exit(1)
}
console.log(`✓ 物理链自检通过（${checks} 项断言）`)
