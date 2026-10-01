/**
 * 把 atlas 图纸（图一 主调度链 / 图二 三个顶层驱动）搬成 Graphify 的图数据。
 *
 * 映射约定（与画布的读法一致）：
 *   · 图纸里的**层带**（① 入口层、④ 红移循环…）→ `group` 大框：点它才能展开看里面的步骤；
 *   · 图纸里的**方框** → 节点：标题进 `label`（框上只写标题，框才不会被长文字撑成高条），
 *     其余说明（输入、条件、位置行）进 `summary`（检查器里看）；
 *   · 图纸里方框第三行的 `coeval.py:743 → single_field.py:285` → **源码引用**（file + line），
 *     点一下就能在预览抽屉里看那几行；
 *   · 图纸里的箭头 → 边，箭头上的**青色产物标签** → 边的 label；
 *   · 图纸里的**虚线**（条件步骤 / 条件数据流）→ `conditional: true`。
 *
 * 位置由脚本算好写进数据（手动摆放模式下这是初始版面）：同一层里按节点宽度依次横排，
 * 各层竖着堆叠。宽度用与画布同一套规则（CJK 按 12px、其余按 0.55×12px 估）并留出富余间距，
 * 保证浏览器里量出的（略宽或略窄的）真实宽度也不会互相压住。
 *
 * 输出：data/atlas-pipeline-draft.json（供 `npm run import` 或 /api/graph/import 使用）
 * 用法：npm run build:atlas
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const OUT = path.join(root, 'data', 'atlas-pipeline-draft.json')

/** 源码根：引用一律相对仓库根（与 /api/code 的口径一致） */
const SRC = 'src/py21cmfast'
const ref = (file, line, endLine = null, label = '') => ({
  docId: '',
  anchor: '',
  label: label || `${file}:${line}`,
  file: `${SRC}/${file}`,
  line,
  endLine,
})

/* ------------------------------------------------------------------ *
 * 尺寸与排版（与画布同一套规则，留富余间距）
 * ------------------------------------------------------------------ */

const CHAT_PX = 12
const measure = (text) => {
  let width = 0
  for (const char of String(text)) {
    width += /[\u3000-\u9fff\uff00-\uffef]/.test(char) ? CHAT_PX : CHAT_PX * 0.55
  }
  return width
}

/** 与 labels.ts 的 measureBoxSize 同一口径（上限 240 / 下限 120） */
function boxSize(label) {
  const natural = measure(label) + 24
  const width = Math.round(Math.min(240, Math.max(120, natural)))
  const textMaxWidth = width - 24
  // 折行行数
  let lines = 1
  let current = ''
  for (const char of label) {
    const next = current + char
    if (current && measure(next) > textMaxWidth) {
      lines += 1
      current = char
    } else current = next
  }
  const height = Math.round(Math.max(40, lines * CHAT_PX * 1.25 + 16))
  return { width, height }
}

const GAP_X = 72 // 同一行内节点间距（比画布需要的更宽，抵掉量字误差）
const GAP_Y = 56 // 行与行 / 块与块之间的纵向间距
const GROUP_PAD = 30 // 大框内边距（与样式表 padding 一致）
const MAX_ROW_WIDTH = 1180 // 一行最宽：超过就换行，避免出现一条超长带子

/**
 * 递归排版。`axis` 决定子块的排列方向，这是版面「像图纸」的关键：
 *   · `column`：子块竖着堆叠 —— 图一的五层、图二的三条 lane 都用它（图纸里就是自上而下）；
 *   · `row`（默认）：子块横着流 —— 层带的四个步骤、lane 里的步骤序列（图纸里就是自左向右），
 *     一行放不下（超过 MAX_ROW_WIDTH）就换行。
 *
 * 容器尺寸 = 包住所有子块的外框（含内边距与标题条），父块据此继续排。
 */
function layout(block) {
  const kids = block.children ?? []
  if (!kids.length) {
    block.size = boxSize(block.label)
    return block.size
  }
  kids.forEach((kid) => layout(kid))
  const axis = block.axis ?? 'row'

  let innerWidth = 0
  let innerHeight = 0
  if (axis === 'column') {
    innerWidth = Math.max(...kids.map((kid) => kid.size.width))
    // 竖向堆叠也要**以原点为中心**：否则子树的重心偏离原点，
    // 顶层大框（位置由子节点包围盒中心推出）就会落在意外的位置，两图对不齐
    const total = kids.reduce((sum, kid) => sum + kid.size.height, 0) + (kids.length - 1) * GAP_Y
    let y = -total / 2
    kids.forEach((kid) => {
      kid.offset = { x: 0, y: y + kid.size.height / 2 }
      y += kid.size.height + GAP_Y
    })
    innerHeight = total
  } else {
    const rows = [[]]
    let rowWidth = 0
    kids.forEach((kid) => {
      const current = rows[rows.length - 1]
      const extra = current.length ? GAP_X + kid.size.width : kid.size.width
      if (current.length && rowWidth + extra > MAX_ROW_WIDTH) {
        rows.push([kid])
        rowWidth = kid.size.width
      } else {
        current.push(kid)
        rowWidth += extra
      }
    })
    const rowWidths = rows.map((row) => row.reduce((sum, kid) => sum + kid.size.width, 0) + (row.length - 1) * GAP_X)
    const rowHeights = rows.map((row) => Math.max(...row.map((kid) => kid.size.height)))
    innerWidth = Math.max(...rowWidths)
    innerHeight = rowHeights.reduce((sum, h) => sum + h, 0) + (rows.length - 1) * GAP_Y
    let y = -innerHeight / 2
    rows.forEach((row, rowIndex) => {
      const height = rowHeights[rowIndex]
      let x = -innerWidth / 2
      row.forEach((kid) => {
        kid.offset = { x: x + kid.size.width / 2, y: y + height / 2 }
        x += kid.size.width + GAP_X
      })
      y += height + GAP_Y
    })
  }

  block.size = {
    width: innerWidth + GROUP_PAD * 2 + 40,
    height: innerHeight + GROUP_PAD * 2 + 34, // 上方给标题留一条
  }
  return block.size
}

/* ------------------------------------------------------------------ *
 * 图一 · 主调度链
 * ------------------------------------------------------------------ */

const fig1 = {
  id: 'atlas:fig1',
  label: '图一 · 主调度链',
  kind: 'group',
  topic: 'atlas-fig1',
  // 五层自上而下堆叠（图纸里就是竖着的五条带），每层内部的步骤横着流
  axis: 'column',
  children: [
    {
      id: 'atlas:fig1:entry',
      label: '① 入口层',
      kind: 'group',
      children: [
        {
          id: 'atlas:fig1:entry:cli',
          label: '入口 · 命令行 / Python API',
          summary:
            '命令行：21cmfast run coeval | lightcone | ics；Python API：import py21cmfast → run_coeval / run_lightcone / run_global_evolution',
          refs: [ref('cli.py', 63, null, 'cli.py:63'), ref('__init__.py', 1, null, '__init__.py')],
        },
      ],
    },
    {
      id: 'atlas:fig1:orchestrate',
      label: '② 编排层（选一条）',
      kind: 'group',
      children: [
        {
          id: 'atlas:fig1:orchestrate:a',
          label: '入口 A · 21cmfast run ics',
          summary: '只造 ICs 就结束（缓存里已有则跳过，:418-428）；不进备料层其余步骤、不进红移循环',
          refs: [ref('cli.py', 393, null, 'cli.py:393')],
        },
        {
          id: 'atlas:fig1:orchestrate:b',
          label: '入口 B · 三个顶层驱动',
          summary: 'run_coeval / run_lightcone / run_global_evolution（跑完整流水线）',
          refs: [
            ref('drivers/coeval.py', 632, null, 'coeval.py:632'),
            ref('drivers/lightcone.py', 691, null, 'lightcone.py:691'),
            ref('drivers/global_evolution.py', 230, null, 'global_evolution.py:230'),
          ],
        },
        {
          id: 'atlas:fig1:orchestrate:setup',
          label: '_setup_ics_and_pfs_for_scrolling',
          summary: '三条流水线共用同一份备料实现',
          refs: [ref('drivers/coeval.py', 837, null, 'coeval.py:837')],
        },
      ],
    },
    {
      id: 'atlas:fig1:prep',
      label: '③ 备料层（只做一次，与红移无关）',
      kind: 'group',
      children: [
        {
          id: 'atlas:fig1:prep:ics',
          label: 'compute_initial_conditions',
          summary: '造初始条件；已有则跳过',
          refs: [ref('drivers/single_field.py', 37, null, 'single_field.py:37')],
        },
        {
          id: 'atlas:fig1:prep:photoncons',
          label: 'setup_photon_cons',
          summary: '可选步骤：必须在 perturb_field 之前跑；备料层调用',
          conditional: true,
          refs: [ref('drivers/photoncons.py', 202, null, 'photoncons.py:202')],
        },
        {
          id: 'atlas:fig1:prep:perturb',
          label: 'perturb_field × len(all_redshifts)',
          summary: '每个红移一份微扰场；产物名 PerturbedField[]',
          refs: [ref('drivers/single_field.py', 112, null, 'single_field.py:112')],
        },
        {
          id: 'atlas:fig1:prep:evolve',
          label: 'evolve_halos（仅 has_discrete_halos）',
          summary: '只在离散晕（DEXM-ESF / CHMF-SAMPLER）时执行；产物名 HaloCatalog[]',
          conditional: true,
          refs: [ref('drivers/coeval.py', 390, null, 'coeval.py:390')],
        },
      ],
    },
    {
      id: 'atlas:fig1:loop',
      label: '④ 红移循环（每红移重复，z 由高到低）',
      kind: 'group',
      children: [
        {
          id: 'atlas:fig1:loop:entry',
          label: '每轮入口（iz）',
          summary:
            'this_perturbed_field = perturbed_field[iz] + load_all()；仅离散晕时 this_halofield = halofield_list[iz] + load_all()',
          refs: [
            ref('drivers/coeval.py', 736, 737, 'coeval.py:736-737'),
            ref('drivers/coeval.py', 741, 742, 'coeval.py:741-742'),
          ],
        },
        {
          id: 'atlas:fig1:loop:halo',
          label: '① compute_halo_grid',
          summary:
            '输入：微扰场[iz]、晕目录[iz]、上一红移 Ts·电离（仅 lagrangian 源模型）→ 产出 HaloBox',
          conditional: true,
          refs: [
            ref('drivers/coeval.py', 743, null, 'coeval.py:743'),
            ref('drivers/single_field.py', 285, null, 'single_field.py:285'),
          ],
        },
        {
          id: 'atlas:fig1:loop:xray',
          label: '② compute_xray_source_field',
          summary: '输入：累计 HaloBox 列表 [z, zmax]（仅 USE_TS_FLUCT 且 lagrangian）→ 产出 XraySourceBox',
          conditional: true,
          refs: [
            ref('drivers/coeval.py', 756, null, 'coeval.py:756'),
            ref('drivers/single_field.py', 460, null, 'single_field.py:460'),
          ],
        },
        {
          id: 'atlas:fig1:loop:ts',
          label: '③ compute_spin_temperature',
          summary:
            '输入：微扰场、上一红移 TsBox ＋ XrayBox（仅 lagrangian）；仅 USE_TS_FLUCT → 产出 TsBox',
          conditional: true,
          refs: [
            ref('drivers/coeval.py', 763, null, 'coeval.py:763'),
            ref('drivers/single_field.py', 588, null, 'single_field.py:588'),
          ],
        },
        {
          id: 'atlas:fig1:loop:ion',
          label: '④ compute_ionization_field',
          summary:
            '无条件执行（每轮必跑）：输入微扰场、TsBox ＋ HaloBox（仅 lagrangian 源模型，否则传 None）＋上一红移电离·微扰场 → 产出 IonizedBox',
          refs: [
            ref('drivers/coeval.py', 776, null, 'coeval.py:776'),
            ref('drivers/single_field.py', 662, null, 'single_field.py:662'),
          ],
        },
        {
          id: 'atlas:fig1:loop:bt',
          label: '⑤ brightness_temperature',
          summary: '无条件执行：输入微扰场、TsBox、IonizedBox → 产出 BrightnessTemp',
          refs: [
            ref('drivers/coeval.py', 788, null, 'coeval.py:788'),
            ref('drivers/single_field.py', 783, null, 'single_field.py:783'),
          ],
        },
        {
          id: 'atlas:fig1:loop:assemble',
          label: '⑥ Coeval 装配与收尾',
          summary:
            '装配 7 样 / purge 上一轮微扰场 / HaloBox 备下次快照 / 仅在 node_redshifts 上推进 prev_coeval 与 hbox_arr / yield；XraySourceBox 算完立刻 purge(force=True)（coeval.py:774）',
          refs: [ref('drivers/coeval.py', 800, 834, 'coeval.py:800-834')],
        },
      ],
    },
    {
      id: 'atlas:fig1:out',
      label: '⑤ 输出层',
      kind: 'group',
      children: [
        {
          id: 'atlas:fig1:out:snapshots',
          label: 'Coeval 快照 / LightCone 光锥 / GlobalEvolution 全局历史',
          summary: '每个红移装配一个结果对象；三条流水线各自的容器类型',
          refs: [
            ref('drivers/coeval.py', 61, null, 'coeval.py:61'),
            ref('drivers/lightcone.py', 49, null, 'lightcone.py:49'),
            ref('drivers/global_evolution.py', 110, null, 'global_evolution.py:110'),
          ],
        },
        {
          id: 'atlas:fig1:out:cache',
          label: 'OutputCache 落盘（按 CacheConfig 分类开关）',
          summary: '写盘与裁内存由 CacheConfig 决定；每步之后都可能落盘',
          refs: [ref('io/caching.py', 31, null, 'io/caching.py:31')],
        },
      ],
    },
  ],
}

/** 图一的箭头（产物名写在 label 上，就是图纸里箭头上的青色标签） */
const fig1Edges = [
  ['atlas:fig1:entry:cli', 'atlas:fig1:orchestrate:a', '命令行', false],
  ['atlas:fig1:entry:cli', 'atlas:fig1:orchestrate:b', 'Python API', false],
  ['atlas:fig1:orchestrate:b', 'atlas:fig1:orchestrate:setup', '调用', false],
  ['atlas:fig1:orchestrate:setup', 'atlas:fig1:prep:ics', '备料', false],
  ['atlas:fig1:prep:ics', 'atlas:fig1:prep:photoncons', 'ICs', false],
  ['atlas:fig1:prep:photoncons', 'atlas:fig1:prep:perturb', '校准曲线', false],
  ['atlas:fig1:prep:perturb', 'atlas:fig1:prep:evolve', '晕目录[]', false],
  ['atlas:fig1:prep:perturb', 'atlas:fig1:loop:entry', '微扰场[iz]', false],
  ['atlas:fig1:prep:evolve', 'atlas:fig1:loop:entry', '晕目录[iz]', false],
  ['atlas:fig1:loop:entry', 'atlas:fig1:loop:halo', '微扰场[iz]', false],
  ['atlas:fig1:loop:halo', 'atlas:fig1:loop:xray', 'HaloBox', true],
  ['atlas:fig1:loop:xray', 'atlas:fig1:loop:ts', 'XrayBox', true],
  ['atlas:fig1:loop:ts', 'atlas:fig1:loop:bt', 'TsBox', true],
  ['atlas:fig1:loop:halo', 'atlas:fig1:loop:ion', 'HaloBox', true],
  ['atlas:fig1:loop:ion', 'atlas:fig1:loop:bt', 'IonizedBox', false],
  ['atlas:fig1:loop:bt', 'atlas:fig1:loop:assemble', 'BrightnessTemp', false],
  ['atlas:fig1:loop:assemble', 'atlas:fig1:out:snapshots', '每红移一个 Coeval', false],
  ['atlas:fig1:out:snapshots', 'atlas:fig1:out:cache', '按 CacheConfig', false],
]

/* ------------------------------------------------------------------ *
 * 图二 · 三个顶层驱动（剖分 fig1 的 ② 编排层）
 * ------------------------------------------------------------------ */

const lane = (id, label, summary, steps) => ({
  id,
  label,
  summary,
  kind: 'group',
  children: steps.map(([stepLabel, stepRefs, stepSummary], index) => ({
    id: `${id}:step${index + 1}`,
    label: stepLabel,
    summary: stepSummary ?? '',
    refs: stepRefs,
  })),
})

const fig2 = {
  id: 'atlas:fig2',
  label: '图二 · 三个顶层驱动（剖分图一的 ② 编排层）',
  kind: 'group',
  topic: 'atlas-fig2',
  // 三条 lane 自上而下，lane 内的步骤序列自左向右
  axis: 'column',
  children: [
    lane(
      'atlas:fig2:e1',
      'E1 · run_coeval（coeval.py:632，薄壳 :639 → generate_coeval :478）',
      '最常用的一条：红移表 → 备料 → 断点续算 → 循环 → yield 过滤',
      [
        ['① 红移表 _get_required_redshifts_coeval', [ref('drivers/coeval.py', 572, null, 'coeval.py:572')], '决定这次要算哪些红移'],
        ['② 备料（三条共用）_setup_ics_and_pfs_for_scrolling', [ref('drivers/coeval.py', 837, null, 'coeval.py:837')], '三条流水线共用同一份实现'],
        ['③ 断点续算 _obtain_starting_point_for_scrolling', [ref('drivers/coeval.py', 598, null, 'coeval.py:598')], '从已有缓存里找起点'],
        ['④ 循环（三条共用）_redshift_loop_generator', [ref('drivers/coeval.py', 691, null, 'coeval.py:691')], '红移循环本体'],
        ['⑤ yield 过滤 → Coeval 列表', [ref('drivers/coeval.py', 624, null, 'coeval.py:624')], '只交出 out_redshifts 里的那些'],
      ],
    ),
    lane(
      'atlas:fig2:e2',
      'E2 · run_lightcone（lightcone.py:691，薄壳 :698 → generate_lightcone :575）',
      '光锥：在同一套循环上每红移切一片',
      [
        ['① lightconer 校验', [ref('drivers/lightcone.py', 644, null, 'lightcone.py:644'), ref('drivers/lightcone.py', 652, null, 'lightcone.py:652')], 'validate_options / _check_desired_arrays_exist'],
        ['② 备料（三条共用）_setup_ics_and_pfs_for_scrolling', [ref('drivers/coeval.py', 837, null, 'coeval.py:837')], '与 E1 同一份'],
        ['③ 建 LightCone setup_lightcone_instance', [ref('drivers/lightcone.py', 430, null, 'lightcone.py:430')], '按 lightconer 规格建容器'],
        ['④ 断点续算 _obtain_starting_point_for_scrolling', [ref('drivers/lightcone.py', 443, null, 'lightcone.py:443')], '与 E1 同一策略'],
        ['⑤ 循环（三条共用）_redshift_loop_generator', [ref('drivers/coeval.py', 691, null, 'coeval.py:691')], '红移循环本体'],
        ['⑥ 每红移切片 → LightCone', [ref('drivers/lightcone.py', 508, null, 'lightcone.py:508')], 'make_lightcone_slices'],
      ],
    ),
    lane(
      'atlas:fig2:e3',
      'E3 · run_global_evolution（global_evolution.py:230，唯一不是薄壳的）',
      '全局历史：单格演化，最后逐红移取均值',
      [
        ['① source_model 校验', [ref('drivers/global_evolution.py', 285, 296, 'global_evolution.py:285-296')], '不允许离散晕模型'],
        ['② 单格参数 evolve_input_structs', [ref('drivers/global_evolution.py', 309, 324, 'global_evolution.py:309-324')], '把网格参数压成一个格子'],
        ['③ 建容器 GlobalEvolution', [ref('drivers/global_evolution.py', 326, 333, 'global_evolution.py:326-333')], '装全局历史'],
        ['④ 备料（三条共用）_setup_ics_and_pfs_for_scrolling', [ref('drivers/coeval.py', 837, null, 'coeval.py:837')], '与 E1 同一份'],
        ['⑤ 循环（三条共用）_redshift_loop_generator', [ref('drivers/coeval.py', 691, null, 'coeval.py:691')], '红海循环本体（单格）'],
        ['⑥ 逐红移均值 quantities[q][iz] = mean', [ref('drivers/global_evolution.py', 368, null, 'global_evolution.py:368')], '把单格结果记进时间序列'],
        ['⑦ return → GlobalEvolution', [ref('drivers/global_evolution.py', 376, null, 'global_evolution.py:376')], '交回全局历史'],
      ],
    ),
  ],
}

/** 图二的箭头：lane 内逐步串起来（label 是这一步「交出去的东西」） */
const fig2Edges = [
  ['atlas:fig2:e1', ['红移表', 'ICs / 微扰场', '起始 iz', 'Coeval']],
  ['atlas:fig2:e2', ['校验结果', 'ICs / 微扰场', 'LightCone', '起始 iz', '每红移切片']],
  ['atlas:fig2:e3', ['source_model', '单格参数', 'GlobalEvolution', 'ICs / 微扰场', '单格结果', '时间序列']],
]

/* ------------------------------------------------------------------ *
 * 组装
 * ------------------------------------------------------------------ */

const nodes = []
const edges = []

/**
 * 边的 id 由**两端推出**，而不是用递增序号。
 *
 * 用序号时，草案内容一改动（增删一条边）后面所有 id 都会平移，重跑导入就会在库里
 * 留下一批「逻辑相同、id 不同」的重复边（踩过：重跑一次多出 3 条）。由端点推出的 id
 * 对同一对端点永远相同，因此导入是幂等的。
 */
const edgeId = (source, target) =>
  `atlas:e:${source.replace(/^atlas:/, '')}=>${target.replace(/^atlas:/, '')}`

const walk = (block, parent, topic, origin) => {
  /**
   * 坐标：子块用「树内偏移 + 本图原点」；**根块没有偏移**（它不是谁的子块），
   * 但要显式落在原点上——否则顶层大框会变成「没有坐标」，画布只能把它临时摆到视口中心，
   * 三个大框就会叠在一起（踩过：一级视图三框全重叠）。
   */
  const position = block.offset
    ? { x: Math.round(origin.x + block.offset.x), y: Math.round(origin.y + block.offset.y) }
    : parent === null
      ? { x: Math.round(origin.x), y: Math.round(origin.y) }
      : null
  nodes.push({
    id: block.id,
    label: block.label,
    type: block.kind === 'group' ? 'group' : 'method',
    summary: block.summary ?? '',
    tags: [],
    refs: block.refs ?? [],
    topics: [topic],
    parent,
    conditional: Boolean(block.conditional),
    position,
  })
  ;(block.children ?? []).forEach((kid) => walk(kid, block.id, topic, origin))
}

const build = (tree, edgeSpecs, origin) => {
  layout(tree)
  walk(tree, null, tree.topic, origin)
  edgeSpecs.forEach(([source, target, label, conditional]) => {
    edges.push({
      id: edgeId(source, target),
      source,
      target,
      label,
      type: 'depends_on',
      directed: true,
      note: conditional ? '条件性数据流（只在特定配置下成立）' : '',
      conditional: Boolean(conditional),
    })
  })
}

// 两张图并排：图一在左、图二在右，之间留一条通道。
build(fig1, fig1Edges, { x: 0, y: 0 })
/**
 * 图二的原点：横坐标接在图一右侧，纵坐标**与图一同为 0**。
 *
 * 「让两张图顶边对齐」是个错误目标：一级视图里大框是收拢的（只有标题那么大），
 * 决定它们是否在同一排的是**中心**——树的排版本来就以原点为中心，所以两个原点等高，
 * 两个收拢的大框就自然在同一水平线上。（展开时只会展开其中一张，另一张不在钻取范围里。）
 */
const fig2Origin = { x: Math.round(fig1.size.width + 240), y: 0 }
// 图二没有「跨块边」，它的箭头是 lane 内逐步相连（见下面的循环）——这里必须传空数组：
// fig2Edges 是 lane 规格（[laneId, labels[]]），喂给通用边处理器会生成 target 为数组的畸形边
build(fig2, [], fig2Origin)

// 图二 lane 内逐步相连
fig2Edges.forEach(([laneId, labels]) => {
  const laneBlock = fig2.children.find((item) => item.id === laneId)
  const steps = laneBlock.children
  for (let i = 0; i < steps.length - 1; i += 1) {
    edges.push({
      id: edgeId(steps[i].id, steps[i + 1].id),
      source: steps[i].id,
      target: steps[i + 1].id,
      label: labels[i] ?? '下一步',
      type: 'depends_on',
      directed: true,
      note: '',
      conditional: false,
    })
  }
})

const draft = {
  mode: 'merge',
  meta: {
    name: '21cmFAST 主调度链（图一 / 图二）',
    description:
      '由 docs/notes/atlas 的图一（主调度链）与图二（三个顶层驱动）迁移而来：层带 = 大框，点进去看该层的步骤；虚线 = 条件/可选。节点的源码引用可直接预览对应行。',
    topics: [
      { id: 'atlas-fig1', name: '图一 · 主调度链', description: '五层主干：入口 / 编排 / 备料 / 红移循环 / 输出。' },
      { id: 'atlas-fig2', name: '图二 · 三个顶层驱动', description: 'run_coeval / run_lightcone / run_global_evolution 各自的步骤序列。' },
    ],
  },
  nodes,
  edges,
}

await fs.mkdir(path.dirname(OUT), { recursive: true })
await fs.writeFile(OUT, `${JSON.stringify(draft, null, 2)}\n`, 'utf8')

const groups = nodes.filter((node) => node.type === 'group')
const level1 = groups.filter((node) => node.parent === null)
console.log(`已写出 ${path.relative(root, OUT)}`)
console.log(`  节点 ${nodes.length}（大框 ${groups.length}）· 边 ${edges.length} · 源码引用 ${nodes.reduce((n, node) => n + node.refs.length, 0)} 处`)
console.log(`  一级（初始画面可见）: ${level1.length} 个 —— ${level1.map((node) => node.label).join(' / ')}`)
console.log(`  条件（虚线）节点 ${nodes.filter((n) => n.conditional).length} 个 · 条件边 ${edges.filter((e) => e.conditional).length} 条`)
const box = {
  w: Math.round(fig1.size.width + 240 + fig2.size.width),
  h: Math.round(Math.max(fig1.size.height, fig2.size.height)),
}
console.log(`  预计版面 ${box.w} × ${box.h} 模型单位（一级视图取景后应为一屏可读的大小）`)
