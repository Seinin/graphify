/**
 * 图谱结构重构：从「单一画布 + 原地展开」迁移到「装饰容器 + 模块 + 子图标签页」，
 * 并按**要素种类**给节点分类着色、把交付产物收进边标签。
 *
 * 做什么
 * ------
 * 1. 归位（按 id 前缀，幂等：被拖走的节点也收得回来）：
 *      · `ic:*` 按产物链归位（`ic:g-load` / `ic:g-dens` / `ic:g-vel` / `ic:g-vcb` / `ic:g-out`，见 IC_BLOCKS）——
 *        含 `ic:art-inputs` 这个 S09 图的输入参数（它属于「前置」块）；
 *      · `atlas:fig2:eN:*` → 对应的 `atlas:fig2:eN` lane；
 *      · `atlas:fig1:<lane>:*` → 对应的层带。
 *        （`ic:art-inputs` 曾经被留在 ④ 红移循环里，理由是「它是循环的输入参数」——数据不支持这个假设：
 *         它只与 S09 的过程①②相连，留在循环里两条箭头都成了跨标签页、哪里都看不见。）
 * 2. 结构（图一的逻辑：**层是容器，模块是类 / 函数**）：
 *      · 五个层带是**装饰容器**（`group`）：带里放这一层的模块框，直接提升为**根节点**；
 *        原来把它们圈在一起的 `图一` 大框是多余的，解散；
 *      · 初始条件的五块产物链（`ic:g-*`）挂到 compute_initial_conditions（prep:ics）下，ics 挂回 ③ 备料层；
 *        历史上曾用一个 `atlas:ic-frame` 大框把 13 个步骤全兜住——那样这一层只挂一个子节点、
 *        不给出任何分解信息（违反「递归同构」与「无填充节点」）；先拆成三块，再按产物链拆成五块；
 *      · E1/E2/E3 三个 lane 挂到「入口 B · 三个顶层驱动」下；`图二` 早已解散；
 *      · 可进入的模块 = 带子结构的类 / 函数（本图只有 compute_initial_conditions 与 入口 B），
 *        层带本身不可进入。
 * 3. 要素种类（画布按要素着色，不按所在层）：
 *      函数/过程 method、驱动/入口 driver、参数/变量 variable、数据/场 dataset、
 *      交付产物 artifact、装饰容器 group。逐节点白名单见 TYPE_BY_ID。
 * 4. 交付产物不吃方框：`ic:art-*`（种子池、P(k)、δ_k、密度场、速度场…）解散成
 *      「生产步骤 → 消费步骤」的边标签（图纸里产物本来就画在箭头上）。
 * 5. 容器不参与关系：任何一端是大框的边一律撤掉（层与层之间的「谁接谁」由模块级流向表达）。
 * 6. 逐视图布局（每个标签页一套坐标）：主图 = 五条层带竖排、带内模块横排（图一的读法）；
 *      入口 B 三条 lane 横带竖排、步骤按序号横排一行；初始条件五块竖排、块内横排（>7 折 4 列）。
 *
 * 断言（任一失败则不写回）：无孤儿；根层恰为五个层模块；无外层大框；无 `ic:art-*` 中间产物节点（已解散成边标签；交付产物 artifact 节点保留）；
 * 容器子数白名单（入口 1 / 编排 3 / 备料 4 / 循环 8 / 输出 2 / 入口B 3 / E lanes 5,6,7 /
 * ics 5 / 初始条件五块 3·4·5·3·2——后两项直接取自 IC_BLOCKS，不另抄一份）；节点类型全部在白名单内。
 *
 * 脚本幂等，可重复执行。用法：node scripts/restructure-tabs.mjs [baseUrl]
 */
// 初始条件按产物链分块的唯一定义（与重组 / 导入 / 重置 / 断言脚本共用一份，避免成员表漂移）
import { IC_BLOCKS, IC_BLOCK_IDS, IC_MEMBER_BLOCK, ICS, LEGACY_IC_FRAME } from './lib/ic-chains.mjs'

const BASE = process.argv[2] || 'http://127.0.0.1:5178'

/** 已解散的外层大框（幂等：不存在就跳过） */
const FIG1 = 'atlas:fig1'
const FIG2 = 'atlas:fig2'
/**
 * 初始条件（S09）的三块骨架、焦点模块 `ICS` 与遗留旧框 `LEGACY_IC_FRAME`
 * 都从 `./lib/ic-chains.mjs` 导入（见文件顶部的 import）。
 */
const ENTRY_B = 'atlas:fig1:orchestrate:b'
const LANES = [
  'atlas:fig1:entry',
  'atlas:fig1:orchestrate',
  'atlas:fig1:prep',
  'atlas:fig1:loop',
  'atlas:fig1:out',
]
const E_LANES = ['atlas:fig2:e1', 'atlas:fig2:e2', 'atlas:fig2:e3']

/**
 * 要素种类白名单：逐节点指定（默认按 id 规则给 method）。
 * 只列「不是函数/过程」的那些；装饰容器与层由结构决定。
 */
const TYPE_BY_ID = {
  // 驱动 / 入口
  'atlas:fig1:entry:cli': 'driver',
  'atlas:fig1:orchestrate:a': 'driver',
  'atlas:fig1:orchestrate:b': 'driver',
  // 参数 / 变量
  'ic:art-inputs': 'variable',
  'atlas:fig2:e2:step3': 'variable',
  'atlas:fig2:e3:step2': 'variable',
  'atlas:fig2:e3:step3': 'variable',
  // 交付产物
  'atlas:fig1:out:snapshots': 'artifact',
  'atlas:fig2:e1:step5': 'artifact',
  'atlas:fig2:e2:step6': 'artifact',
  'atlas:fig2:e3:step7': 'artifact',
}

/**
 * 产物节点 → 短名。这些节点会被解散，名字写到「生产步骤 → 消费步骤」的边标签上。
 * 短名要能独立读懂（悬停边时就是这句话）。
 */
const ARTIFACT_LABELS = {
  'ic:art-seeds': '种子池',
  'ic:art-pk': 'cosmo_consts 与 P(k)',
  'ic:art-dk': 'δ_k（半空间）',
  'ic:art-dkfull': 'δ_k（完整）',
  'ic:art-saved': 'HIRES_box_saved',
  'ic:art-hires': 'δ_hires（高分辨密度）',
  'ic:art-lowres': 'δ_lowres（低分辨密度）',
  'ic:art-v1': 'ZA 速度 vx / vy / vz',
  'ic:art-vcb': 'lowres_vcb（相对速度）',
  'ic:art-phi2': '∇²φ₂（k 空间场）',
  'ic:art-2lpt': '2LPT 速度',
}

const ALLOWED_TYPES = new Set([
  'group',
  'section',
  'method',
  'driver',
  'variable',
  'dataset',
  'artifact',
  'concept',
  'doc',
  'result',
  'question',
  'tool',
])

/* ---------------- 尺寸估计（与 src/graph/labels.ts 同口径） ---------------- */
const NODE_FONT = 13
const GROUP_FONT = 18
const GROUP_PADDING = 14
const LINE_HEIGHT = 1.2

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

/* ---------------- 网格排版参数（与 src/graph/pack.ts 同口径） ---------------- */
const GAP = 24
/** 容器内部单行横排的数量上限；超过就折成固定 4 列的网格（与 src/graph/pack.ts 同口径） */
const MAX_ROW_LEAVES = 7
const round1 = (value) => Math.round(value * 10) / 10

/** 按给定列数排一块：各列宽取该列最宽、各行高取该行最高（与 pack.ts 的 gridByColumns 同口径） */
function layoutByColumns(sizes, cols) {
  const rows = Math.ceil(sizes.length / cols)
  const colWidths = Array.from({ length: cols }, (_, col) =>
    Math.max(...sizes.filter((_, index) => index % cols === col).map((s) => s.width)),
  )
  const rowHeights = Array.from({ length: rows }, (_, row) =>
    Math.max(...sizes.slice(row * cols, row * cols + cols).map((s) => s.height)),
  )
  const totalW = colWidths.reduce((sum, w) => sum + w, 0) + GAP * Math.max(0, cols - 1)
  const totalH = rowHeights.reduce((sum, h) => sum + h, 0) + GAP * Math.max(0, rows - 1)
  return { cols, rows, colWidths, rowHeights, totalW, totalH }
}

function extentOf(items, posOf) {
  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity
  items.forEach((item) => {
    const size = item.size
    const position = posOf(item)
    x1 = Math.min(x1, position.x - size.width / 2)
    x2 = Math.max(x2, position.x + size.width / 2)
    y1 = Math.min(y1, position.y - size.height / 2)
    y2 = Math.max(y2, position.y + size.height / 2)
  })
  return { x1, y1, x2, y2, w: x2 - x1, h: y2 - y1, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2 }
}

async function main() {
  const res = await fetch(`${BASE}/api/graph`)
  if (!res.ok) throw new Error(`读取失败：HTTP ${res.status}`)
  const graph = (await res.json()).graph
  let nodes = graph.nodes
  const byId = new Map(nodes.map((n) => [n.id, n]))

  const need = [...IC_BLOCK_IDS, ICS, ENTRY_B, ...LANES, ...E_LANES]
  need.forEach((id) => {
    if (!byId.has(id)) throw new Error(`缺少关键节点：${id}`)
  })

  const stamp = new Date().toISOString()
  const setParent = (id, parent) => {
    const node = byId.get(id)
    if (!node) throw new Error(`归位目标缺失：${id}`)
    if ((node.parent ?? null) !== parent) {
      node.parent = parent
      node.updatedAt = stamp
    }
  }
  const setType = (id, type) => {
    const node = byId.get(id)
    if (!node) return
    if (node.type !== type) {
      node.type = type
      node.updatedAt = stamp
    }
  }

  /* ---------------- 1. 归位（前缀规则，幂等） ---------------- */
  /**
   * 初始条件的 13 个成员按**三块骨架**归位；历史遗留的 `atlas:ic-frame` 一旦出现就删掉
   * （它已被三块取代：那时这一层只挂一个子节点，不给出任何分解信息，见文件头说明）。
   */
  IC_MEMBER_BLOCK.forEach((blockId, nodeId) => setParent(nodeId, blockId))
  if (byId.has(LEGACY_IC_FRAME)) {
    nodes = nodes.filter((node) => node.id !== LEGACY_IC_FRAME)
    byId.delete(LEGACY_IC_FRAME)
    graph.nodes = nodes
  }
  const PREFIX_HOMES = [
    [/^atlas:fig2:e1:/, 'atlas:fig2:e1'],
    [/^atlas:fig2:e2:/, 'atlas:fig2:e2'],
    [/^atlas:fig2:e3:/, 'atlas:fig2:e3'],
    [/^atlas:fig1:entry:/, 'atlas:fig1:entry'],
    [/^atlas:fig1:orchestrate:/, 'atlas:fig1:orchestrate'],
    [/^atlas:fig1:prep:/, 'atlas:fig1:prep'],
    [/^atlas:fig1:loop:/, 'atlas:fig1:loop'],
    [/^atlas:fig1:out:/, 'atlas:fig1:out'],
  ]
  nodes.forEach((node) => {
    for (const [pattern, home] of PREFIX_HOMES) {
      if (pattern.test(node.id)) {
        setParent(node.id, home)
        break
      }
    }
  })

  /* ---------------- 2. 结构：层提升为根、装饰容器归位、要素分类 ---------------- */
  /**
   * 五个层是**容器**（按图一的逻辑：层带是框，框里放这一层的模块），
   * 不是可进入的模块——「模块」指类 / 函数（compute_initial_conditions、run_coeval…）。
   * 没有外层大框，所以它们直接是主图的根节点。
   */
  LANES.forEach((id) => {
    setParent(id, null)
    setType(id, 'group')
  })
  setParent(ICS, 'atlas:fig1:prep')
  IC_BLOCK_IDS.forEach((id) => {
    setParent(id, ICS)
    setType(id, 'group')
  })
  E_LANES.forEach((id) => {
    setParent(id, ENTRY_B)
    setType(id, 'group')
  })
  // 逐节点要素分类：白名单之外的函数/过程一律 method
  nodes.forEach((node) => {
    if (node.type === 'group' || LANES.includes(node.id)) return
    setType(node.id, TYPE_BY_ID[node.id] ?? 'method')
  })

  /* ---------------- 3. 交付产物解散为边标签 ---------------- */
  const collapsed = []
  Object.entries(ARTIFACT_LABELS).forEach(([artifactId, artifactLabel]) => {
    const artifact = byId.get(artifactId)
    if (!artifact) return // 幂等：第二次运行时它已经解散
    const inbound = graph.edges.filter((edge) => edge.target === artifactId)
    const outbound = graph.edges.filter((edge) => edge.source === artifactId)
    const doomed = new Set([...inbound, ...outbound])
    graph.edges = graph.edges.filter((edge) => !doomed.has(edge))
    inbound.forEach((from) => {
      outbound.forEach((to) => {
        // 同一对节点可能因多个产物而重复：标签合并，不叠两条平行的线
        const existing = graph.edges.find((edge) => edge.source === from.source && edge.target === to.target)
        if (existing) {
          if (!existing.label.includes(artifactLabel)) existing.label = `${existing.label} / ${artifactLabel}`
          return
        }
        graph.edges.push({
          id: `atlas:e:flow:${from.source.split(':').pop()}=>${to.target.split(':').pop()}:${artifactId.split(':').pop()}`,
          source: from.source,
          target: to.target,
          label: artifactLabel,
          type: 'derives_from',
          directed: true,
          note: `产物「${artifact.label}」的流向（重构脚本由产物节点合并而来）`,
          sourcePort: null,
          targetPort: null,
          conditional: false,
          createdAt: stamp,
          updatedAt: stamp,
        })
      })
    })
    collapsed.push(`${artifactLabel}（${inbound.length}进 × ${outbound.length}出）`)
  })

  /* ---------------- 4. 解散外层大框（图一 / 图二） ---------------- */
  const dissolved = []
  ;[FIG1, FIG2].forEach((frameId) => {
    if (!byId.has(frameId)) return
    const dropped = graph.edges.filter((edge) => edge.source === frameId || edge.target === frameId)
    graph.edges = graph.edges.filter((edge) => edge.source !== frameId && edge.target !== frameId)
    nodes = nodes.filter((node) => node.id !== frameId)
    byId.delete(frameId)
    dissolved.push(`${frameId}${dropped.length ? `（连带 ${dropped.map((e) => e.id).join(', ')}）` : ''}`)
  })

  const removedArtifacts = nodes.filter((node) => node.id.startsWith('ic:art-') && node.id !== 'ic:art-inputs')
  nodes = nodes.filter((node) => !(node.id.startsWith('ic:art-') && node.id !== 'ic:art-inputs'))
  removedArtifacts.forEach((node) => byId.delete(node.id))
  graph.nodes = nodes

  /* ---------------- 5. 不允许容器参与关系 ---------------- */
  /**
   * 大框（层带 / S09 框 / E lane）是**容器**，只作视觉分组：它们身上不挂关系。
   * 层与层之间的「谁接谁」由模块级流向表达（如 `cli → 入口 A`、`_setup_ics… → compute_initial_conditions`），
   * 所以早期在层带之间补的那几条「主链」边在这里统一撤掉。
   */
  const containerIds = new Set(nodes.filter((node) => node.type === 'group').map((node) => node.id))
  const containerEdges = graph.edges.filter(
    (edge) => containerIds.has(edge.source) || containerIds.has(edge.target),
  )
  graph.edges = graph.edges.filter((edge) => !containerIds.has(edge.source) && !containerIds.has(edge.target))

  /* ---------------- 6. 断言 ---------------- */
  const finalNodes = graph.nodes
  const finalById = new Map(finalNodes.map((n) => [n.id, n]))
  const childrenOf = (id) => finalNodes.filter((node) => node.parent === id).map((node) => node.id)
  const failures = []
  const assert = (ok, message) => {
    if (!ok) failures.push(message)
  }

  const orphans = finalNodes.filter((node) => node.parent && !finalById.has(node.parent))
  assert(orphans.length === 0, `存在孤儿节点：${orphans.map((n) => n.id).join(', ')}`)
  const roots = finalNodes.filter((node) => !node.parent).map((node) => node.id)
  assert(
    roots.length === LANES.length && LANES.every((id) => roots.includes(id)),
    `根层应恰为五个层模块，实际：${roots.join(', ')}`,
  )
  assert(!finalById.has(FIG1) && !finalById.has(FIG2), '外层大框（图一/图二）应已解散')
  const leftoverArtifacts = finalNodes.filter((n) => n.id.startsWith('ic:art-') && n.id !== 'ic:art-inputs')
  assert(leftoverArtifacts.length === 0, `产物节点应已解散：${leftoverArtifacts.map((n) => n.id).join(', ')}`)
  const badTypes = finalNodes.filter((n) => !ALLOWED_TYPES.has(n.type)).map((n) => `${n.id}=${n.type}`)
  assert(badTypes.length === 0, `出现白名单外的节点类型：${badTypes.join(', ')}`)
  // 容器不参与关系：任何一端是大框的边都必须已经清掉
  const remainingContainerEdges = graph.edges.filter(
    (edge) => finalById.get(edge.source)?.type === 'group' || finalById.get(edge.target)?.type === 'group',
  )
  assert(
    remainingContainerEdges.length === 0,
    `仍存在涉及容器（大框）的关系：${remainingContainerEdges.map((e) => e.id).join(', ')}`,
  )

  const expectChildren = (id, want, label) => {
    const got = childrenOf(id)
    assert(got.length === want, `${label} 子节点数应为 ${want}，实际 ${got.length}（${got.join(', ')}）`)
  }
  expectChildren('atlas:fig1:entry', 1, '①入口层')
  expectChildren('atlas:fig1:orchestrate', 3, '②编排层')
  expectChildren('atlas:fig1:prep', 4, '③备料层')
  // ④ 红移循环 = 每轮入口 + ①…⑥ 六个步骤（图一的循环带就是这 7 格）
  expectChildren('atlas:fig1:loop', 7, '④红移循环')
  expectChildren('atlas:fig1:out', 2, '⑤输出层')
  expectChildren(ENTRY_B, 3, '入口 B')
  expectChildren('atlas:fig2:e1', 5, 'E1')
  expectChildren('atlas:fig2:e2', 6, 'E2')
  expectChildren('atlas:fig2:e3', 7, 'E3')
  // 初始条件（S09）：模块下恰是三块骨架；每块的成员数与归属**精确相等**（不多不少）
  expectChildren(ICS, IC_BLOCKS.length, 'compute_initial_conditions')
  IC_BLOCKS.forEach((block) => {
    expectChildren(block.id, block.members.length, block.label)
    const got = childrenOf(block.id)
    assert(
      block.members.every((id) => got.includes(id)) && got.length === block.members.length,
      `${block.label} 的成员与 IC_BLOCKS 不一致：${got.join(', ')}`,
    )
  })
  // ic:* 必须全部落在 compute_initial_conditions 的**子树内**（不再要求同一个框）
  const icOutside = finalNodes.filter((node) => {
    if (!node.id.startsWith('ic:') || node.type === 'group') return false
    return node.parent !== ICS && !IC_BLOCK_IDS.includes(node.parent)
  })
  assert(
    icOutside.length === 0,
    `ic:* 节点应全部落在 compute_initial_conditions 子树内：${icOutside.map((n) => n.id).join(', ')}`,
  )
  // 输入参数与它指向的过程必须**同块**，否则它的箭头会变成跨标签页、看不见
  const inputArrows = graph.edges.filter((edge) => edge.source === 'ic:art-inputs')
  assert(inputArrows.length > 0, 'InputParameters 应当至少有一条输出边')
  inputArrows.forEach((edge) => {
    assert(edge.target !== LEGACY_IC_FRAME, 'InputParameters 的箭头不应指向容器')
  })
  assert(
    inputArrows.every((edge) => IC_MEMBER_BLOCK.get(edge.target) === IC_MEMBER_BLOCK.get('ic:art-inputs')),
    'InputParameters 的输出边应落在**同一块**里的过程上（同块才画得出来）',
  )
  LANES.forEach((id) => {
    assert(finalById.get(id).type === 'group', `层应为装饰容器（group）：${id}`)
    assert(childrenOf(id).length > 0, `层带里应当有模块：${id}`)
  })
  // 「模块」= 类 / 函数：有子结构的（compute_initial_conditions、入口 B）可进入子图，但不是大框
  ;[ICS, ENTRY_B].forEach((id) => {
    assert(finalById.get(id).type !== 'group', `模块不应是大框：${id}`)
    assert(childrenOf(id).length > 0, `模块应带子结构（可进入子图）：${id}`)
  })
  assert(finalById.get('atlas:fig1:entry:cli').type === 'driver', 'cli 应为 driver')
  assert(finalById.get(ENTRY_B).type === 'driver', '入口 B 应为 driver')
  assert(finalById.get('ic:art-inputs').type === 'variable', 'InputParameters 应为 variable')
  assert(finalById.get('atlas:fig1:out:snapshots').type === 'artifact', '输出层交付物应为 artifact')
  assert(
    finalById.get('atlas:fig1:loop:halo').type === 'method',
    '红移循环步骤应为 method',
  )
  // 每个产物名至少落在一条边的标签里（解散不丢信息）
  Object.values(ARTIFACT_LABELS).forEach((label) => {
    assert(
      graph.edges.some((edge) => edge.label.includes(label)),
      `产物「${label}」没有出现在任何边标签里`,
    )
  })

  if (failures.length) {
    console.error('断言失败，未写回：')
    failures.forEach((message) => console.error(`  ✗ ${message}`))
    process.exit(1)
  }

  /* ---------------- 7. 逐视图布局 ---------------- */
  const itemsOf = (ids) =>
    ids.map((id) => {
      const node = finalById.get(id)
      return {
        node,
        size: boxSizeOf(node),
        position: { x: node.position?.x ?? 0, y: node.position?.y ?? 0 },
      }
    })

  // 7a. 主图（图一的逻辑）：五条层带**竖排**，每条带里是这一层的模块（左→右读，装不下才折行）
  const layerBandGap = 34
  const bands = LANES.map((laneId) => {
    const items = itemsOf(childrenOf(laneId))
    const ordered = [...items].sort((a, b) => {
      const tolerance = Math.min(a.size.height, b.size.height) / 2
      if (Math.abs(a.position.y - b.position.y) > tolerance) return a.position.y - b.position.y
      return a.position.x - b.position.x
    })
    const sizes = ordered.map((i) => i.size)
    /**
     * 层带要宽而扁（图纸的样子）：一排最多 7 个模块——够就整排铺开（① 1 个、② 3 个、③ 4 个、⑤ 2 个），
     * 不够（④ 红移循环 8 个）才折成固定 4 列的网格（两排）。
     * 不能用 pickColumns：它按「整层取景后字最大」挑列数，会把 8 个模块挑成 2 列 × 4 行的竖条。
     */
    const cols = ordered.length <= MAX_ROW_LEAVES ? ordered.length : 4
    return { laneId, items: ordered, shape: layoutByColumns(sizes, cols) }
  })
  const totalBandH =
    bands.reduce((sum, band) => sum + band.shape.totalH, 0) + layerBandGap * (bands.length - 1)
  let layerBandY = -totalBandH / 2
  bands.forEach((band) => {
    const { shape, items } = band
    const colX = []
    let cursorX = -shape.totalW / 2
    shape.colWidths.forEach((w) => {
      colX.push(cursorX + w / 2)
      cursorX += w + GAP
    })
    const rowY = []
    let cursorRow = layerBandY
    shape.rowHeights.forEach((h) => {
      rowY.push(cursorRow + h / 2)
      cursorRow += h + GAP
    })
    items.forEach((item, index) => {
      item.node.position = {
        x: round1(colX[index % shape.cols]),
        y: round1(rowY[Math.floor(index / shape.cols)]),
      }
    })
    // 层带的坐标是「子节点包围盒中心」的派生值：写对能让嵌套与合围有锚点
    const extent = extentOf(items, (item) => item.node.position)
    finalById.get(band.laneId).position = { x: round1(extent.cx), y: round1(extent.cy) }
    layerBandY += shape.totalH + layerBandGap
  })

  // 7b. 入口 B 视图：三条 lane 横带竖排，每条 lane 的步骤按序号横排一行
  let bandY = 0
  const bandGap = 46
  E_LANES.forEach((laneId, laneIndex) => {
    const steps = childrenOf(laneId).sort((a, b) => {
      const na = Number(/step(\d+)/.exec(a)?.[1] ?? 0)
      const nb = Number(/step(\d+)/.exec(b)?.[1] ?? 0)
      return na - nb
    })
    const stepItems = itemsOf(steps)
    const row = layoutByColumns(stepItems.map((i) => i.size), stepItems.length)
    let cursorX = -row.totalW / 2
    stepItems.forEach((item, index) => {
      const w = row.colWidths[index]
      item.node.position = { x: round1(cursorX + w / 2), y: bandY }
      cursorX += w + GAP
    })
    const extent = extentOf(stepItems, (item) => item.node.position)
    const lane = finalById.get(laneId)
    lane.position = { x: round1(extent.cx), y: bandY }
    const bandH = extent.h + GROUP_PADDING * 2 + Math.round(GROUP_FONT * LINE_HEIGHT) + 12
    if (laneIndex < E_LANES.length - 1) bandY += bandH + bandGap
  })
  const bandShift = -bandY / 2
  E_LANES.forEach((laneId) => {
    const lane = finalById.get(laneId)
    lane.position = { x: lane.position.x, y: round1(lane.position.y + bandShift) }
    childrenOf(laneId).forEach((stepId) => {
      const step = finalById.get(stepId)
      step.position = { x: step.position.x, y: round1(step.position.y + bandShift) }
    })
  })

  // 7c. 初始条件三块骨架：块间竖排、块内横排（>7 折 4 列）；每块框居中合围
  const icBlockGap = 46
  const icBands = IC_BLOCKS.map((block) => {
    const items = itemsOf(childrenOf(block.id))
    // 块内顺序按 IC_BLOCKS 的成员表（那就是代码里的执行顺序），不依赖旧坐标
    const ordered = [...items].sort(
      (a, b) => block.members.indexOf(a.node.id) - block.members.indexOf(b.node.id),
    )
    const cols = ordered.length <= MAX_ROW_LEAVES ? ordered.length : 4
    return { block, ordered, shape: layoutByColumns(ordered.map((i) => i.size), cols) }
  })
  const totalIcH =
    icBands.reduce((sum, band) => sum + band.shape.totalH, 0) + icBlockGap * (icBands.length - 1)
  let icBandY = -totalIcH / 2
  icBands.forEach((band) => {
    const colX = []
    let cursorX = -band.shape.totalW / 2
    band.shape.colWidths.forEach((w) => {
      colX.push(cursorX + w / 2)
      cursorX += w + GAP
    })
    const rowY = []
    let cursorY = -band.shape.totalH / 2
    band.shape.rowHeights.forEach((h) => {
      rowY.push(cursorY + h / 2)
      cursorY += h + GAP
    })
    band.ordered.forEach((item, index) => {
      item.node.position = {
        x: round1(colX[index % band.shape.cols]),
        y: round1(icBandY + rowY[Math.floor(index / band.shape.cols)]),
      }
    })
    const extent = extentOf(band.ordered, (item) => item.node.position)
    finalById.get(band.block.id).position = { x: round1(extent.cx), y: round1(extent.cy) }
    icBandY += band.shape.totalH + icBlockGap
  })



  /* ---------------- 8. 写回 ---------------- */
  const put = await fetch(`${BASE}/api/graph`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ graph, reason: 'restructure:elements' }),
  })
  if (!put.ok) {
    const payload = await put.json().catch(() => ({}))
    throw new Error(`写入失败：HTTP ${put.status} ${payload.error ?? ''}`)
  }

  console.log('重构完成：')
  console.log(`  节点 ${finalNodes.length}；关系 ${graph.edges.length}`)
  console.log(`  解散外层大框：${dissolved.length ? dissolved.join('；') : '（无）'}`)
  console.log(`  产物解散为边标签 ${collapsed.length} 个：${collapsed.join('；')}`)
  console.log(
    `  撤掉涉及容器的关系 ${containerEdges.length} 条${containerEdges.length ? `：${containerEdges.map((e) => e.id).join(', ')}` : ''}`,
  )
  console.log('  要素分类：函数/过程 method、驱动/入口 driver、参数/变量 variable、交付产物 artifact、容器/层 group')
  console.log('  布局：主图五条层带（带内模块横排）/ 入口 B 三带 / S09 网格')
}

main().catch((error) => {
  console.error('重构失败：', error.message)
  process.exit(1)
})
