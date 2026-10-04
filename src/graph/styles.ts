import type { StylesheetStyle } from 'cytoscape'
import { ARROW_PORTS, NODE_TYPE_COLORS, type ArrowPort, type NodeType } from '../lib/types'
import {
  CONTEXT_EDGE_COLOR,
  CONTEXT_NODE_COLOR,
  CONTRADICTS_COLOR,
  CROSS_LINK_COLOR,
  EDGE_COLOR,
  EDGE_LABEL_COLOR,
  EDGE_LABEL_OUTLINE_COLOR,
  FEEDBACK_COLOR,
  GROUP_BACKGROUND_OPACITY,
  GROUP_COLOR,
  GROUP_TITLE_COLOR,
  HIGHLIGHT_COLOR,
  HIGHLIGHT_LABEL_COLOR,
  LABEL_COLOR,
  LABEL_OUTLINE_COLOR,
  LABEL_OUTLINE_OPACITY,
  SELECTION_BOX_COLOR,
  SELECTION_COLOR,
  SNAP_COLOR,
  TAG_DOT_COLOR,
} from './palette'
import { EDGE_FONT_SIZE, GROUP_PADDING, GROUP_TITLE_FONT_SIZE, NODE_FONT_SIZE } from './labels'

const TYPE_ENTRIES = Object.entries(NODE_TYPE_COLORS) as [NodeType, string][]

type Rule = StylesheetStyle

/**
 * 端口 → cytoscape 端点值。
 *
 * 只能写成**节点相对百分比**（`x% y%`，左上为 `0% 0%`）：
 * `source-endpoint` / `target-endpoint` 的类型是 `edgeEndpoint`（multiple + 数值 + 单位），
 * 它只认 `inside-to-node` / `outside-to-node` 等 5 个枚举值或坐标/百分比——
 * 写成 `north` / `east` 这类方位词会被判为非法值，而该类型是 multiple，
 * 非法 token 会让解析器拿到 null 并**直接在构造 Core 时抛 TypeError**（踩过一次）。
 * 这里的四组百分比就是四条边的中点。
 */
const PORT_ENDPOINT: Record<ArrowPort, string> = {
  n: '50% 0%',
  e: '100% 50%',
  s: '50% 100%',
  w: '0% 50%',
}

/**
 * 画布样式表。键名沿用 cytoscape 的 kebab-case 属性名。
 *
 * 表达方式（v2）：
 *   · **方框**：节点是写着一行标题的圆角方框（不再是纯色小块 + 框外标签），
 *     所以文字在框内垂直居中、按框宽折行；
 *   · **大框套小框**：`type = "group"` 的节点是容器，子节点用 compound 关系被真正包进去
 *     （`node.container` / `node:parent` 两组规则）；
 *   · **箭头吸附**：边的两个端点默认 `outside-to-node`（自动吸到离对端最近的那条边），
 *     存了端口（`sourcePort` / `targetPort`）时吸到指定边的中点；
 *   · **悬浮放大**：`node.hovered` 把方框按 NODE_HOVER_SCALE 放大一档。
 *
 * 状态类由 GraphRenderer 在交互时切换：
 *   .highlighted 邻居高亮 / .dimmed 非邻居弱化（只压线、不压文字）/
 *   .connect-target 连线吸附目标 / .hovered 指针所在 / .enter 新节点淡入 / .branch 还有未展开的直系子节点
 */
export function buildStylesheet(): Rule[] {
  const typeRules: Rule[] = TYPE_ENTRIES.filter(([type]) => type !== 'group').map(([type, color]) => ({
    selector: `node[type = "${type}"]`,
    style: {
      'background-color': color,
      'background-opacity': 0.16,
      'border-color': color,
      'border-width': 1.6,
      'underlay-color': color,
      'underlay-opacity': 0,
      'underlay-padding': 10,
      color: LABEL_COLOR,
    } as Rule['style'],
  }))

  const rules: Rule[] = [
    {
      selector: 'core',
      style: {
        'active-bg-opacity': 0.12,
        'active-bg-size': 0,
        'selection-box-color': SELECTION_BOX_COLOR,
        'selection-box-opacity': 0.12,
        'selection-box-border-color': SELECTION_BOX_COLOR,
        'selection-box-border-width': 1,
      } as Rule['style'],
    },
    {
      selector: 'node',
      style: {
        /**
         * 宽高与折行宽度都由**数据**给出（渲染器按名称算，见 labels.ts 的 measureBoxSize）。
         * 这样一屏里的框宽高互不相同、却都与内容成比例，而不是所有节点一个尺寸。
         */
        width: 'data(boxW)',
        height: 'data(boxH)',
        shape: 'round-rectangle',
        'background-color': '#6366F1',
        'background-opacity': 0.16,
        'border-width': 1.6,
        'border-color': '#6366F1',
        'corner-radius': 8,
        label: 'data(label)',
        color: LABEL_COLOR,
        // 字号是**模型单位常量**：框高就是照它算的（见 graph/labels.ts），缩放时与框一起变。
        // 不再按 zoom 反算「恒屏字号」——那条路会让整层视图缩到 0.5 时字只剩 6px。
        'font-size': NODE_FONT_SIZE,
        'font-family': 'PingFang SC, Noto Sans SC, sans-serif',
        'font-weight': 500,
        // 标签写在框内：水平垂直都居中，按框宽折行
        'text-valign': 'center',
        'text-halign': 'center',
        'text-margin-y': 0,
        'text-wrap': 'wrap',
        // 每个框自己的折行宽度（= 框宽 - 内边距，模型单位）：不随 zoom 变，换行位置才不会随缩放跳
        'text-max-width': 'data(textMaxW)',
        'text-outline-width': 0,
        'text-outline-color': LABEL_OUTLINE_COLOR,
        'text-outline-opacity': LABEL_OUTLINE_OPACITY,
        'overlay-opacity': 0,
        'transition-property': 'background-opacity, border-width, underlay-opacity, opacity, width, height',
        'transition-duration': '180ms',
        'z-index': 10,
      } as unknown as Rule['style'],
    },
    ...typeRules,
    /**
     * 大框（容器节点）。
     *
     * 尺寸交给 cytoscape 由子节点撑开（compound 语义），因此这里只声明下限与内边距：
     * 空框也有可见的大小，装了子节点则自动长大。标题贴左上角，像一层带标签的带子。
     */
    {
      selector: 'node.container',
      style: {
        // 下限由标题长度给出（渲染器算进 data），真正的大小仍由子节点撑开
        'min-width': 'data(boxW)',
        'min-height': 'data(boxH)',
        // 内边距与 labels.ts 的 GROUP_PADDING 同源：空框高度 = 标题行高 + 两倍内边距，
        // 只有标题的层带因此能压到 52 单位高（旧值 30 → 120 单位高，五条层带就装不下一屏）
        padding: GROUP_PADDING,
        shape: 'round-rectangle',
        'corner-radius': 12,
        'background-color': GROUP_COLOR,
        'background-opacity': GROUP_BACKGROUND_OPACITY,
        'border-color': GROUP_COLOR,
        'border-width': 1.6,
        // 实线 = 这一层一定会执行；虚线留给「条件/可选」（见 node.conditional），两者语义不要混
        'border-style': 'solid',
        color: GROUP_TITLE_COLOR,
        'font-size': GROUP_TITLE_FONT_SIZE,
        'font-weight': 700,
        'text-valign': 'top',
        'text-halign': 'left',
        'text-margin-x': GROUP_PADDING - 2,
        'text-margin-y': GROUP_PADDING - 4,
        'text-wrap': 'none',
        'text-max-width': '320px',
        'text-outline-width': 0,
        // 容器画在子节点之下：否则半透明的大框会把里面的小框压灰
        'z-compound-depth': 'bottom',
        'z-index': 1,
        'overlay-opacity': 0,
        'transition-property': 'background-opacity, border-width, border-color',
        'transition-duration': '180ms',
      } as unknown as Rule['style'],
    },
    /**
     * 有子节点但不是大框类型的父节点（历史数据的 parent 链）：同样按容器渲染，
     * 否则 cytoscape 会把它画成一个普通小方块，子节点却从它身体里长出来——看起来像 bug。
     */
    {
      selector: 'node:parent',
      style: {
        'background-opacity': 0.04,
        'border-opacity': 0.6,
        // 同样是实线：虚线专表「条件/可选」（见 node.conditional），不要在这里再造一个含义
        'border-style': 'solid',
        'corner-radius': 12,
        padding: 26,
        'text-valign': 'top',
        'text-halign': 'left',
        'text-margin-x': 10,
        'text-margin-y': 8,
        'text-wrap': 'none',
        'z-compound-depth': 'bottom',
        'z-index': 1,
      } as unknown as Rule['style'],
    },
  ]

  /**
   * 可进入子图的模块标记：一圈柔和光晕 —— 标签就是模块名本身，**尾巴上不带数字**。
   *
   * 只挂在**模块**（非大框但有子节点）上——它的子节点不与它同屏，
   * 双击或属性页入口会在新标签页里打开。装饰容器（大框）不挂这个标记：
   * 框里的内容本来就摊在框内，没有「还能进入」一说。
   *
   * **刻意不用虚线**：虚线在这张画布上已经被「条件/可选」占用（见 `node.conditional`），
   * 两处都用虚线会让「这一步是可选的」和「这里可以进入」变成同一个视觉信号。
   * 文本仍走 `branchLabel`（`GraphRenderer` 写，等值于模块名），避免在样式里做算术。
   */
  const branchRules: Rule[] = [
    {
      selector: 'node.branch',
      style: {
        label: 'data(branchLabel)',
        'underlay-opacity': 0.12,
        'underlay-padding': 6,
      } as unknown as Rule['style'],
    },
  ]

  /**
   * 「层」（`blockKind = "layer"`：常数与网格）：**不可进入**。
   *
   * 与"过程块"的区别只落在一处：把 `.branch` 那圈光晕收掉——
   * 在这一页光晕就是"双击还能进去"的信号，层没有可进的东西（它的成员是常数），不该带这个信号。
   *
   * **刻意不用虚线**：虚线已被「条件/可选」占用（见 `node.conditional` 与 `node.container` 的注释），
   * 同一个形状承担两种含义就没人分得清了。
   */
  const layerRules: Rule[] = [
    {
      selector: 'node[blockKind = "layer"]',
      style: { 'underlay-opacity': 0, 'background-opacity': 0.08 } as unknown as Rule['style'],
    },
  ]

  /**
   * **灰显的对外输入（上下文节点）**：进到某个块的子图里时，块外指进来的量会在旁边显形
   * （`contexts`，见 `graph/hierarchy.ts` 的 `tabContextIds`）。
   *
   * 它们**不是这一块要算的东西**——本块只是读它。所以画灰、画淡、压到下面一层；
   * 而它的来处仍然是主图里那个量本身（同一个 id、同一份数据，没有第二份），
   * 点开属性页会写明"这是外部输入、只读"。
   *
   * **刻意不用虚线**：虚线在这张画布上已被「条件/可选」占用（见 `node.conditional`）。
   */
  const contextRules: Rule[] = [
    {
      selector: 'node.context',
      style: {
        'background-color': CONTEXT_NODE_COLOR,
        'background-opacity': 0.06,
        'border-color': CONTEXT_EDGE_COLOR,
        'border-opacity': 0.7,
        color: CONTEXT_NODE_COLOR,
        opacity: 0.72,
        // 压在成员之下：读的顺序是"这一块算什么"在前，"它读了什么"在后
        'z-index': 6,
      } as unknown as Rule['style'],
    },
    {
      selector: 'edge.context-edge',
      style: {
        'line-color': CONTEXT_EDGE_COLOR,
        'target-arrow-color': CONTEXT_EDGE_COLOR,
        'line-opacity': 0.55,
        width: 1.2,
        color: CONTEXT_EDGE_COLOR,
      } as Rule['style'],
    },
  ]

  /**
   * 端口规则：存了端口就吸到那条边的中点；没存则沿用基类的 `outside-to-node`。
   * 用属性选择器而不是类名，省掉「渲染器要记得同步类名」这条容易漏的链路。
   */
  const portRules: Rule[] = ARROW_PORTS.flatMap((port) => [
    {
      selector: `edge[sourcePort = "${port}"]`,
      style: { 'source-endpoint': PORT_ENDPOINT[port] } as Rule['style'],
    },
    {
      selector: `edge[targetPort = "${port}"]`,
      style: { 'target-endpoint': PORT_ENDPOINT[port] } as Rule['style'],
    },
  ])

  const stateRules: Rule[] = [
    { selector: 'node:active', style: { 'overlay-opacity': 0 } as Rule['style'] },
    /**
     * 悬浮放大：方框按固定倍数放大一档，描边加粗、填充加深，并抬到邻居之上。
     * 只对非容器节点改尺寸——容器的尺寸由子节点决定，硬写宽高会被 compound 覆盖成抖动。
     */
    {
      /**
       * 模块（以及普通节点）的悬浮突出：放大 + 描边加粗 + 填充加深 + 一圈光晕，并抬到邻居之上。
       *
       * **宽高不在这里写**。每个框的基准尺寸都由名称算出（`data(boxW)`），
       * 固定一档会把小框撑大、大框压小；等比放大由渲染器写在行内样式里（applyHoverSize，
       * 倍数见 palette 的 NODE_BOX_HOVER_SCALE）。
       */
      selector: 'node.hovered',
      style: {
        // 描边、填充、光晕三样一起加，配合 1.32 倍的等比放大才有「跳出来」的效果
        'border-width': 3.6,
        'background-opacity': 0.42,
        'underlay-opacity': 0.34,
        'underlay-padding': 12,
        // 抬到最高一档：虚化的邻居、关系名、白底片都不会盖到它头上
        'z-index': 60,
      } as unknown as Rule['style'],
    },
    /**
     * 容器（大框）**刻意没有悬停规则**。
     *
     * 层带 / S09 框 / E lane 是大片背景，悬停时改填充色会让整条带子突然变色（难看且没有信息量）。
     * 渲染器侧已让容器不进入悬停态（见 GraphRenderer.setHoveredId），这里也不留规则——
     * 谁要是把 `.hovered` 加到容器上，一眼就能看出样式缺失，而不是被一条「看起来正常」的规则盖住。
     * 选中态仍然保留（选中它才好在检查器里改名字 / 放进别的框）。
     */
    {
      selector: 'node:selected',
      style: {
        'background-opacity': 0.42,
        'border-width': 2.4,
        'underlay-opacity': 0.22,
        'z-index': 40,
      } as Rule['style'],
    },
    /**
     * 邻居（与悬停节点直接相连的模块）：给一点强调，让「它连到谁」看得清，
     * 但不做放大——放大的只有指针真正指着的那一个。
     */
    {
      selector: 'node.highlighted',
      style: {
        'border-width': 2,
        'background-opacity': 0.34,
        'underlay-opacity': 0.16,
        'text-opacity': 1,
      } as Rule['style'],
    },
    {
      /**
       * 大框选中态：**只加粗描边，不改填充**。
       * 填充强调（GROUP_EMPHASIS_OPACITY）会让整条层带泛青色——大片面积变色太扎眼，
       * 不要这个特效；描边加粗已足够表达「它被选中了」。
       */
      selector: 'node.container:selected, node:parent:selected',
      style: {
        'border-width': 2.4,
        'border-style': 'solid',
      } as unknown as Rule['style'],
    },
    /**
     * 虚化档：**连文字一起淡下去**——悬停某个模块时，别的模块只有真虚化掉，
     * 被指着那一个的名字才读得清（早先只压填充与描边、留着满屏黑字，反而更花）。
     * 用 `text-opacity` 而不是元素级 `opacity`：后者是乘子，会把描边、光晕一起乘没。
     */
    {
      selector: 'node.dimmed',
      style: {
        'background-opacity': 0.05,
        'border-opacity': 0.2,
        'underlay-opacity': 0,
        'text-opacity': 0.22,
      } as Rule['style'],
    },
    {
      selector: 'node.container.dimmed, node:parent.dimmed',
      style: {
        'background-opacity': 0.02,
        'border-opacity': 0.2,
      } as unknown as Rule['style'],
    },
    {
      selector: 'node.connect-target',
      style: {
        'border-width': 3,
        'border-color': SNAP_COLOR,
        'background-opacity': 0.4,
        'underlay-color': SNAP_COLOR,
        'underlay-opacity': 0.3,
      } as Rule['style'],
    },
    {
      selector: 'node.enter',
      style: { opacity: 0, width: 8, height: 8 } as Rule['style'],
    },
    {
      selector: 'edge',
      style: {
        width: 1.4,
        'line-color': EDGE_COLOR,
        'target-arrow-color': EDGE_COLOR,
        'target-arrow-shape': 'triangle',
        'arrow-scale': 0.9,
        /**
         * 直线，而不是贝塞尔弧。
         *
         * 弧线在方框之间绕，方向和落点都不可预期（一条线从哪个角进、从哪个角出，没人猜得到），
         * 一屏十几条弧叠起来就是一团乱麻。改成**直线**后语义变得可以预读：
         * 连线方向 = 两个方框中心的连线方向，只把方框之外的那一段画出来——
         * 也就是「取中心到中心的向量，只露在框外的部分」（`outside-to-node` 端点 +
         * `edge-distances: intersection` 就是这件事的官方写法）。
         * 端口（sourcePort/targetPort）仍然生效：存了端口就吸到那条边的中点。
         */
        'curve-style': 'straight',
        'edge-distances': 'intersection',
        // 默认端点吸到方框边界（沿两端连线方向投影），箭头因此永远贴着框边而不是扎进框心
        'source-endpoint': 'outside-to-node',
        'target-endpoint': 'outside-to-node',
        label: 'data(label)',
        color: EDGE_LABEL_COLOR,
        // 字号归 labels.ts 的 EDGE_FONT_SIZE 管（12）：产物名要看得清，不能靠凑近屏幕
        'font-size': EDGE_FONT_SIZE,
        'font-family': 'PingFang SC, Noto Sans SC, sans-serif',
        /**
         * 关系名**一律水平，与线的朝向无关**。
         *
         * 原来用 `autorotate`：标签跟着线转，水平线上的字横着、垂直线上的字被转 90°，
         * 同一张图里两种朝向混在一起，读起来得不停扭头。现在固定水平（`none`），
         * 再垫一层白底圆角片（图纸里产物标签的样子），线从文字后面穿过也被盖住，任何朝向都读得清。
         */
        'text-rotation': 'none',
        'text-margin-x': 0,
        'text-margin-y': 0,
        'text-background-color': EDGE_LABEL_OUTLINE_COLOR,
        'text-background-opacity': 0.96,
        'text-background-padding': 3,
        'text-background-shape': 'roundrectangle',
        'text-outline-width': 0,
        /**
         * 关系名**默认不显示**，按需出现，让画布先干净：一屏几十个关系名会把方框和箭头全压住。
         * 三种显示时机（与 `edge.hovered` / `edge.highlighted` / `edge:selected` 三条规则配套）：
         *   · 指针停在某个节点上 → 这个节点相邻的关系名全部显示（`.highlighted`）；
         *   · 指针停在某条线上 → 只显示这一条（`.hovered`）；
         *   · 选中某条线 → 一直显示（`:selected`），便于对照检查器里的属性。
         */
        'text-opacity': 0,
        'overlay-opacity': 0,
        'transition-property': 'line-color, width, opacity, text-opacity',
        'transition-duration': '180ms',
        'z-index': 5,
      } as unknown as Rule['style'],
    },
    ...portRules,
    /**
     * 条件 / 可选（虚线）。这是流程图里最容易被误读的一档，因此与「大框实线」「必执行实线」严格区分：
     *   · 节点虚线框 = 这一步只在某些配置下才存在（如「仅 lagrangian 源模型」）；
     *   · 边虚线   = 这条数据流只在某些配置下才成立（如「halobox 可能是 None」）。
     * 放在类型规则之后，保证虚线能压过按类型给出的实线描边。
     */
    {
      selector: 'node.conditional',
      style: { 'border-style': 'dashed', 'border-width': 1.8 } as Rule['style'],
    },
    {
      selector: 'edge.conditional',
      style: { 'line-style': 'dashed', width: 1.5 } as Rule['style'],
    },
    /**
     * **提供 / 数据流动**（物理链页）：一条真实的依赖，但它跳过了若干层（层差 >1）。
     *
     * 为什么不能删也不能藏：它是公式里实打实的依赖（`T_K → T_S` 就是 T_S 公式里的一项），
     * 只是没落在分层用的那条最长路径上。画成**实线 + 弧线 + 一档自己的颜色**，一眼分清
     * 「树脊（直线）」与「跳层那一档（弧线）」——否则读者会以为树的层级画错了。
     *
     * **线型用实线**：这张画布上虚线只有一个含义——条件 / 可选（见 `edge.conditional`），
     * 而这一档讲的是"跳了几层"、不是"有时才有"，两者混用会让线型失去含义。区分靠**弧线与颜色**：
     * 弧线说"绕过去了"，紫灰说"不是主序那一档"，线型不参与表达（大框与必然执行的流都还是实线）。
     */
    {
      selector: 'edge.cross-link',
      style: {
        'line-style': 'solid',
        'line-color': CROSS_LINK_COLOR,
        'target-arrow-color': CROSS_LINK_COLOR,
        'curve-style': 'bezier',
        // 弧线往外鼓一格，让它明显绕开树脊上的直线，不然两条会叠成一条
        'control-point-step-size': 90,
        width: 1.3,
        'line-opacity': 0.75,
      } as Rule['style'],
    },
    /**
     * **跨红移回流**（物理链页）：下一轮指回上一轮，方向与自上而下的主序相反。
     *
     * 与「提供 / 数据流动」分属两种跨法（见 palette 里 `FEEDBACK_COLOR` 的说明），因此样式也另起一档，
     * 三处都不与邻居共用：
     *   · 颜色：品红（跳层那一档是紫灰、主序是灰、条件/可选还是灰）；
     *   · 线型：**长划**虚线（虚线已被 `edge.conditional` 与 `relates_to` 占用、点线已被 `contradicts` 占用、
     *     实线是主序与跳层那一档共用的底）；
     *   · 箭头：显式画三角并放大一号 —— 方向靠箭头表达，不靠线型暗示。
     * 弧线比跳层那一档鼓得更开：两端块之间通常还有一条正向接口边，两条要能分开看。
     *
     * 标签常显（其余边仍按悬停 / 选中 / 工具条开关显示）：回流就一两条，而它要读的正是两端的量名。
     * 渲染器只在边带 `feedback` 类时命中本规则；"默认不画"由下面的 `feedback-off` 管。
     *
     * **`feedback-input` 是它在子图里的落点**（`fromNode → toNode`，物理链页按产物那条弧派生、在弧两端块
     * 各派一条）：同一条关系在同一档样式下出现，进到块里一眼认得出是它。它与落点两端那些盒子是同一件事
     * 的另两个视图面，因此**与一级那条弧同进同出**——开关关着时一起不画（见下面的关闭态规则）。
     * 类名与主图那档分开，只为区分谁在一级、谁在子图。
     *
     * 这档 MUST NOT 被 `context-edge`（从对外输入指进本块的灰细样式）压过去：来源块那侧的落点正好
     * 一端是灰显的对外输入，让弱化样式盖上来，同一条关系在一级与子图里就不像一件事了——
     * 渲染器按 `!edge.hasClass('feedback-input')` 排除它。
     */
    {
      selector: 'edge.feedback, edge.feedback-input',
      style: {
        'line-style': 'dashed',
        'line-dash-pattern': [10, 5],
        width: 2,
        'line-color': FEEDBACK_COLOR,
        'target-arrow-color': FEEDBACK_COLOR,
        'target-arrow-shape': 'triangle',
        'arrow-scale': 1.15,
        'curve-style': 'bezier',
        'control-point-step-size': 140,
        'line-opacity': 0.95,
        'text-opacity': 1,
        color: FEEDBACK_COLOR,
      } as Rule['style'],
    },
    /**
     * **落点边在子图里鼓开一格**：它常常与**产物边同端点对、方向相反**——
     * `Ṅ_ion → Q_HII`（这一步算 `Ṅ_ion` 要用 `Q_HII`）与落点 `Q_HII → Ṅ_ion`（上一快照的 `Q_HII`
     * 被送了过来），网格化源项与电离场两张子图里各出现一对。
     *
     * 为什么不能靠上面那档的 `bezier` 自动错开：cytoscape 的错开只在**同一种 `curve-style`** 的
     * 平行边之间生效。产物边走基础档的 `straight`（两框中心连线，方向可预读），落点边若是孤零零的
     * 一条 bezier，控制点就落在两端中点、画出来还是直线——两条完全叠住，读成"这里只有一条关系"，
     * 反向的那个箭头被盖掉。
     *
     * 所以落点边显式换成 `unbundled-bezier` 并给一个固定偏移（`bezier` 的控制点是算出来的只读值，
     * 手动指定必须走这一档）：产物边照旧走直线，两条一弯一直分开。偏移量与一级那条弧同一量级
     * （那里是 `control-point-step-size: 140`），落点两端通常就是两个相邻的盒子，鼓这么多足够分开。
     */
    {
      selector: 'edge.feedback-input',
      style: {
        'curve-style': 'unbundled-bezier',
        'control-point-distances': [80],
        'control-point-weights': [0.5],
      } as Rule['style'],
    },
    /**
     * 对外输入的灰显样式：放在基础 `edge` 规则之后，才能压过它的线宽与颜色。
     * （节点的 `.context` 同理：要压过按 `type` 给的描边颜色。）
     */
    ...contextRules,
    {
      selector: 'edge[type = "relates_to"]',
      style: { 'line-style': 'dashed' } as Rule['style'],
    },
    {
      selector: 'edge[type = "contradicts"]',
      style: {
        'line-style': 'dotted',
        'line-color': CONTRADICTS_COLOR,
        'target-arrow-color': CONTRADICTS_COLOR,
      } as Rule['style'],
    },
    {
      /**
       * 无向关系不画箭头。
       *
       * 这里用 `[!directed]` 而不是原本写的 `[directed = false]`：后者在 cytoscape 的选择器
       * 语法里是**非法 token**（布尔字面量不加引号不被接受），引擎会打印 "is invalid" 并把
       * 整条规则丢掉——即「无向边仍然画箭头」这个 bug 一直没生效过。`[!directed]` 是
       * 「该字段为假/缺省」的官方写法，实测只命中 directed 为 false 的边。
       */
      selector: 'edge[!directed]',
      style: { 'target-arrow-shape': 'none' } as Rule['style'],
    },
    /**
     * 常显边标签（工具条的开关）。
     *
     * 产物名写在边标签上（产物不再是方框），默认仍按「按需显示」的规则走；
     * 需要一次读完整条数据流时，把整个画布的边标签打开——比逐条悬停快得多。
     */
    {
      selector: 'edge.show-label',
      style: { 'text-opacity': 1 } as Rule['style'],
    },
    {
      selector: 'edge:selected',
      style: {
        width: 2.6,
        'line-color': SELECTION_COLOR,
        'target-arrow-color': SELECTION_COLOR,
        'text-opacity': 1,
        color: HIGHLIGHT_LABEL_COLOR,
        'z-index': 30,
      } as Rule['style'],
    },
    /**
     * 指针直接停在某条线上：只显示这一条的关系名，并把线加粗提亮，
     * 让人确认「指的是这一条」。线很细，命中靠 cytoscape 自带的边命中（渲染器绑 mouseover/mouseout）。
     */
    {
      /**
       * 关系悬浮突出：线加粗、箭头相应变大、颜色提到高亮档，并把关系名显示出来——
       * 「这条线被指到了」要一眼看得出来，和模块一样有放大突出的手感。
       */
      selector: 'edge.hovered',
      style: {
        width: 3,
        'arrow-scale': 1.05,
        'line-color': HIGHLIGHT_COLOR,
        'target-arrow-color': HIGHLIGHT_COLOR,
        'text-opacity': 1,
        color: HIGHLIGHT_LABEL_COLOR,
        'z-index': 28,
      } as Rule['style'],
    },
    {
      /**
       * 悬停模块时它的**连接关系一起放大跳出**：线加粗、箭头变大、显示关系名，并抬到虚化元素之上——
       * 与模块的放大配套，读法变成「一个模块 + 它的出入参数」跳出来，其余退到背景里。
       */
      selector: 'edge.highlighted',
      style: {
        width: 2.6,
        'arrow-scale': 1.05,
        'line-color': HIGHLIGHT_COLOR,
        'target-arrow-color': HIGHLIGHT_COLOR,
        'text-opacity': 1,
        color: HIGHLIGHT_LABEL_COLOR,
        'z-index': 34,
      } as Rule['style'],
    },
    // 虚化的关系：线淡下去，标签也一起淡（常显边标签模式下同样退到背景）
    {
      selector: 'edge.dimmed',
      style: { 'line-opacity': 0.22, 'text-opacity': 0.15 } as Rule['style'],
    },
    /**
     * **接口边（`focusOnly`）：静息不画，悬浮它两端的块时才显现**。
     *
     * 一级只有 11 个块，块间那 21 条接口边若常显，画布会被箭头与量名糊满；
     * 把它们压到 0、只留"指针停在某个块上"这一刻读取——读法变成
     * 「一个块 + 它的进出口」，与模块那套（`.highlighted` 放大 + 亮边）是同一个手势。
     *
     * ⚠ 必须写在 `edge.dimmed` **之后**：cytoscape 是"后写的规则胜"，
     * 放在前面会被 `dimmed` 的 `line-opacity: 0.22` 盖回来，未悬浮的接口边会一直露着。
     * 反过来 `.highlighted`（悬浮时挂上的类）要能压过这里的 0，所以它的规则排在更后面。
     */
    {
      selector: 'edge[?focusOnly]',
      style: { opacity: 0, 'line-opacity': 0, 'text-opacity': 0, events: 'no' } as Rule['style'],
    },
    {
      selector: 'edge[?focusOnly].highlighted',
      style: { opacity: 1, 'line-opacity': 1, 'text-opacity': 1, events: 'yes' } as Rule['style'],
    },
    /**
     * **跨红移回流 · 关闭态：整条不画**（默认关，开关在物理链页的浮层上）。
     *
     * 一条规则管住这件事的**全部视图面**，三样同进同出：
     *   · `edge.feedback`：一级上那条块 → 块的弧；
     *   · `edge.feedback-input`：它在弧两端块标签页里的落点（上一轮送出的量 → 这一步读它的量）；
     *   · `node.feedback-context`：落点两端那些盒子——它们进这一块只因落在这条回流上。
     * 分开列而不是合成一个类名：弧与落点画在不同层，另有各自的规则（`subgraphOf` 收口），
     * 只有"关着就不画"这一条是共用的。
     *
     * 用 `display: none` 而不是 `opacity: 0`：后者元素仍在命中测试里（所以 `focusOnly` 那档还要补
     * `events: 'no'`），而这里要的是**不占位**——不渲染、不入选、不遮挡下面的标签、不参与取景。
     *
     * ⚠ 位置：压在 `edge[?focusOnly]` **之后**、本段最末。cytoscape 是"后写的规则胜"，
     * 上面任何针对 `edge` 与 `node` 的规则（线色、线宽、不透明度）都压不翻这一条。
     * 与 `focusOnly` 那条不命中同一批边（回流边的 `focusOnly` 为假），排在一起的用意是
     * 让两档"某类边默认不画"挨着，读的人不必翻上去比先后。
     */
    {
      selector: 'edge.feedback.feedback-off, edge.feedback-input.feedback-off, node.feedback-context.feedback-off',
      style: { display: 'none' } as unknown as Rule['style'],
    },
    /**
     * 标签隐藏档：标签已写进方框，因此**不再按重叠省略**（方框里的文字就是框的内容，
     * 省略了只会得到一排空框）。这里保留该类是为了兼容旧的选择器与「叠加显示」链路：
     * 渲染器不会再给节点挂上它，除非将来重新启用省略策略。
     */
    /**
     * 全局标签标记：持有**被勾选标签**的模块。
     *
     * 红点本体是 DOM 徽标（见 GraphCanvas / palette.ts 里的说明）；这里只给节点加一圈
     * 柔和红晕，让「这个模块命中了筛选」在画布上也有一层可辨的底色，
     * 缩得很小时即使徽标叠在一起也能看出是哪些模块。
     */
    {
      selector: 'node.tagged',
      style: {
        'underlay-color': TAG_DOT_COLOR,
        'underlay-opacity': 0.16,
        'underlay-padding': 6,
      } as unknown as Rule['style'],
    },
    { selector: 'node.label-off', style: { 'text-opacity': 0 } as Rule['style'] },
    { selector: 'node.label-pinned', style: { 'z-index': 60 } as Rule['style'] },
    {
      selector: ':grabbed',
      style: { 'underlay-opacity': 0.32, 'z-index': 50 } as Rule['style'],
    },
    { selector: ':active', style: { 'overlay-opacity': 0 } as Rule['style'] },
  ]

  return [...rules, ...branchRules, ...layerRules, ...stateRules]
}
