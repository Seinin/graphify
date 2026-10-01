import cytoscape, { type Core, type EventObject, type NodeSingular, type Position } from 'cytoscape'
import fcose from 'cytoscape-fcose'
import { buildStylesheet } from './styles'
import { DEFAULT_LAYOUT_KIND, runLayout, type LayoutKind } from './layout'
import {
  NODE_BOX_HEIGHT,
  NODE_BOX_HOVER_SCALE,
  NODE_BOX_WIDTH,
  TAG_DOT_INSET,
  TAG_DOT_SIZE,
} from './palette'
import { hitTestNode, measureBoxSize, measureGroupSize } from './labels'
import { buildHierarchy, tabContextIds, tabVisibleIds, type Hierarchy, type HierarchyNode } from './hierarchy'
import { packVisible } from './pack'
import { runOrderedLayout } from './ordered'
import { ignoredPositionIds } from './positions'
import { NODE_TYPE_LABELS, type ArrowPort, type Graph, type NodeType } from '../lib/types'
import { tagDisplayOf } from '../lib/tagEdit'
import type { TopicVisibility } from '../lib/topics'

/** 呼吸周期（毫秒）与幅度：与 index.css 里光晕的 3.2s 同周期，幅度 5%（看得出来，又不跳） */
const PULSE_PERIOD_MS = 3200
const PULSE_AMPLITUDE = 0.05

/**
 * 端口吸附半径（屏幕像素）：指针离方框边中点多近才算「吸上去」。
 * 太小则很难精准吸到，太大则四个端口会互相抢——36px 大约是方框短边的可视范围。
 */
export const PORT_SNAP_RADIUS_PX = 36
/** 拖入大框时用的判定：节点中心离大框内边至少留这么多像素，避免「贴边即入框」 */
const CONTAINER_DROP_INSET_PX = 6
/**
 * 取景缩放的下限 / 上限。
 *
 * 下限是这一版的关键：早先取景只按「把内容全塞进画布」算，24 个节点散在 3364×3652 里时
 * 会给出 zoom 0.13 —— 屏幕上字只剩 1.6px，「全都看得见」于是等于「全都看不见」。
 * 宁可让内容溢出画布（用户平移看局部，或换到更细分的标签页），也不接受低于 0.85 的取景：
 * 在这个缩放下 13 单位的文字正好是 11px，还在可读区间。
 */
const FIT_MIN_ZOOM = 0.85
/** 上限：一屏只有两个节点时不要把框撑成一堵墙 */
const FIT_MAX_ZOOM = 1.45
/**
 * LOD 阈值：低于这个缩放，小框文字开始不可读，只留大框标题。
 * 0.5 × 13 单位 ≈ 6.5px —— 到这个程度，留着字只是一层灰雾。
 */
const LOD_LABEL_ZOOM = 0.5

/** 端口在方框上的归一化偏移（左上为 0,0，右下为 1,1） */
const PORT_OFFSET: Record<ArrowPort, { fx: number; fy: number }> = {
  n: { fx: 0.5, fy: 0 },
  e: { fx: 1, fy: 0.5 },
  s: { fx: 0.5, fy: 1 },
  w: { fx: 0, fy: 0.5 },
}

/**
 * 是否开发构建。
 * 写成 `typeof` 保护：这个模块也会被无头自检脚本（esbuild 直出、没有 Vite 注入）加载，
 * 那里 `import.meta.env` 是 undefined，直接读 `.DEV` 会抛错。
 */
const IS_DEV =
  typeof import.meta !== 'undefined' && Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV)

let extensionsReady = false

function ensureExtensions() {
  if (extensionsReady) return
  cytoscape.use(fcose)
  extensionsReady = true
}

/** 当前标签页的可见节点数：状态条与顶栏话题按钮显示用 */
export interface VisibilityInfo {
  visible: number
}

/** 一次端口吸附的结果：吸到哪个节点、哪条边、屏幕上的落点 */
export interface PortSnap {
  id: string
  port: ArrowPort | null
  /** 容器坐标（渲染坐标）下的落点：吸到端口时是边中点，否则是节点中心 */
  point: Position
  /** 是否真的吸到了某个端口（false = 只命中节点，箭头自动选边） */
  snapped: boolean
}

export interface RendererHandlers {
  onSelectNode: (id: string) => void
  onSelectEdge: (id: string) => void
  onClearSelection: () => void
  /** 双击模块（非装饰容器且带子节点）：打开它的子图标签页 */
  onEnterSubgraph?: (id: string) => void
  /** 点中了节点左上角的标签红点：上层选中该节点并在属性面板展开这个标签的明细 */
  onOpenTagDetail?: (nodeId: string, tagId: string) => void
  onNodeDragStart: (id: string) => void
  onNodeDragEnd: (id: string, position: Position) => void
  /**
   * 节点被拖进 / 拖出大框后上报（两个 id 相等或都为空时不会回调）。
   * 渲染器只负责几何判定，是否真的改父子关系由上层决定（要进撤销栈、要落盘）。
   */
  onNodeReparent?: (id: string, containerId: string | null) => void
  onHoverNode: (id: string | null) => void
  onNodeContextMenu: (id: string, client: Position) => void
  onEdgeContextMenu: (id: string, client: Position) => void
  onCanvasContextMenu: (client: Position, model: Position | null) => void
  onZoomChange: (zoom: number) => void
  onLayoutSettled: (positions: Record<string, Position>) => void
  /** 布局执行失败时回调，由 UI 层决定如何提示 */
  onLayoutError?: (error: unknown) => void
  /** 可见集变化后回调，供状态条显示当前视图节点数 */
  onVisibilityChange?: (info: VisibilityInfo) => void
}

/**
 * 图谱渲染器：一个实例对应**一个固定的标签页**（主图 focusId = null，或某个模块的子图）。
 *
 * 可见性是静态推导：焦点的直系子节点 + 其中装饰容器（大框）的后代（递归内联）。
 * 模块的子节点不出现在这里——它们属于模块自己的标签页（另一个渲染器实例）。
 * 因此本类没有「展开集合 / 钻取路径 / 每屏预算」这套状态，只有同步、可见性套用与交互分发。
 */
export class GraphRenderer {
  private cy: Core | null = null
  private handlers: RendererHandlers
  /** 标签页焦点：null = 主图；否则是某个模块的 id（构造后不变） */
  readonly focusId: string | null
  /**
   * 标签口径（构造后不变）：`true` = 有子图的模块用**当前子树叶子并集**（画布页，与属性面板同一份）；
   * `false` = 照读数据里那份（物理链页：它的块标签是生成物烘好的并集，见 `lib/tagEdit.ts` 的 `tagDisplayOf`）。
   */
  readonly tagUnion: boolean
  private pulseFrame: number | null = null
  private pulseNodeId: string | null = null
  private pulseStart = 0
  /** 标签省略重算的合帧句柄：缩放 / 平移一帧内只算一次 */
  private labelsFrame: number | null = null
  /** 当前悬停的节点：它的标签必须无条件显示 */
  private hoveredId: string | null = null
  /** 最近一次标签筛选结果（显示的标签集合），供叠加显示退出时恢复 */
  private shownLabels: ReadonlySet<string> = new Set<string>()
  /** 当前被「叠加显示」的标签所属节点（悬停 / 选中）：不参与筛选，也不被筛选结果覆盖 */
  private pinnedIds = new Set<string>()
  /**
   * 已排布的节点（坐标有真实来源：被一次布局排过，或用户拖过）。
   * 回存坐标时只认这个集合——cytoscape 给未排布元素的默认坐标是原点，
   * 把它写回数据就会变成占位坐标（见 graph/positions.ts 的说明）。
   */
  private placedIds = new Set<string>()
  /** 正在进行的布局：避免同一次揭示重复触发补排 */
  private layoutInFlight = false

  /** 最近一次同步的节点（只读层级来源，话题过滤下再按成员集收窄） */
  private hierarchyNodes: readonly HierarchyNode[] = []
  /** 层级 / 可见集模型：可见性全部由它派生 */
  private hierarchy: Hierarchy | null = null
  /** 最近一次同步的原始图（话题过滤变化时重挂 compound 父级用） */
  private lastGraph: Graph | null = null
  /** 大框（装饰容器）id 集合：compound 父级只认它们 */
  private groupIds = new Set<string>()
  /**
   * 话题过滤：null 表示不过滤（显示全部节点）。
   * 元素始终留在图上、只切 display：删元素会连 position 一起丢，
   * 而位置必须跨话题保持一致。hierParentOf 是话题视图下的层级父级。
   */
  private topicFilter: { members: Set<string>; hierParentOf: Map<string, string | null> } | null = null
  /**
   * 被收起关系的模块集合（纯视图状态，来源是 store 的本机偏好）。
   * 命中的模块，其语义关系连线用 `display:none` 收起——节点、坐标与层级结构都不动。
   * 集合留在渲染器上，因此 `sync()` 之后重算可见性时这条规则照样生效
   * （与话题过滤同一生命周期口径）。
   */
  private hiddenRelationIds = new Set<string>()
  /**
   * 跨红移回流是否显现（纯视图状态，来源是物理链页的开关；缺省显现）。
   * 关闭时这件事的**全部视图面**一起挂上 `feedback-off`（`display: none`）：
   * 一级上那条块 → 块的弧、它在弧两端块子图里的落点边、落点那些盒子（三样见 `applyFeedbackVisibility`）。
   * 与「收起关系」同一套「留在图上、只切显示」的手法，元素集合与坐标都不动，开合往返天然逐字复原。
   * 状态留在渲染器上，因此 `sync()` 之后照样生效（与话题过滤、收起关系同一生命周期口径）。
   */
  private feedbackVisible = true
  /** 当前使用的布局算法 */
  private layoutKind: LayoutKind = DEFAULT_LAYOUT_KIND
  /**
   * 打开图谱后「按当前布局重排一次」是否还没做。
   * 存档坐标可能来自别的布局，照搬会与当前布局不符；
   * 数据与话题两条时序谁先到都只消费一次。
   */
  private pendingInitialLayout = true
  /** dblclick 监听的容器（destroy 时解绑） */
  private containerEl: HTMLElement | null = null
  private dblclickHandler: ((event: MouseEvent) => void) | null = null
  /** 当前勾选的全局标签（纯视图状态，来自 store）：命中的模块左上角亮红点 */
  private activeTagIds: string[] = []
  /** 有子图的模块：呼吸动画（模块自己的尺寸周期性地膨胀收缩，与光晕同周期） */
  private breatheIds: string[] = []
  private breatheFrame: number | null = null
  private breatheStartedAt = 0
  private breatheScale = 1
  /** 红点上的 pointerdown 守卫（destroy 时解绑） */
  private tagGuardHandler: ((event: PointerEvent) => void) | null = null

  constructor(handlers: RendererHandlers, options: { focusId?: string | null; tagUnion?: boolean } = {}) {
    this.handlers = handlers
    this.focusId = options.focusId ?? null
    // 缺省按并集算：画布页是主场景，链页显式传 false 照读生成物
    this.tagUnion = options.tagUnion ?? true
  }

  mount(container: HTMLElement) {
    ensureExtensions()
    this.cy = cytoscape({
      container,
      style: buildStylesheet(),
      elements: [],
      minZoom: 0.12,
      maxZoom: 3.4,
      // 滚轮缩放的灵敏度：0.22 → 0.6 仍偏慢，提到 1.5 让一次滚动能看到明显变化
      wheelSensitivity: 1.5,
      boxSelectionEnabled: false,
      autounselectify: false,
      textureOnViewport: true,
      motionBlur: false,
      pixelRatio: 'auto',
      selectionType: 'single',
    })
    this.bindEvents()
    this.bindDoubleClick(container)
    this.bindTagDotGuard(container)
    return this.cy
  }

  get core() {
    return this.cy
  }

  private containerRect() {
    const container = this.cy?.container() as HTMLElement | undefined
    return container?.getBoundingClientRect() ?? { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0 }
  }

  /** 取事件的页面坐标；触摸或无原生事件时按容器偏移换算 */
  private clientPoint(event: EventObject): Position {
    const original = event.originalEvent as MouseEvent | undefined
    if (original && typeof original.clientX === 'number') {
      return { x: original.clientX, y: original.clientY }
    }
    const position = event.renderedPosition || event.position
    const rect = this.containerRect()
    return { x: rect.left + position.x, y: rect.top + position.y }
  }

  /** 容器坐标 -> 模型坐标 */
  modelPositionAt(containerPoint: Position): Position | null {
    const cy = this.cy
    if (!cy) return null
    const pan = cy.pan()
    return { x: (containerPoint.x - pan.x) / cy.zoom(), y: (containerPoint.y - pan.y) / cy.zoom() }
  }

  /**
   * 双击 = 进入模块的子图标签页。
   *
   * 不用 cytoscape 的 tap 序列自己数双击：原生 dblclick 与单击 tap 的判定由浏览器完成，
   * 命中测试与悬停共用同一套几何（方框矩形，装饰框永远排在子节点之后）。
   * 装饰容器与叶子节点双击不产生导航（命中后静默忽略）。
   */
  /**
   * 红点上的拖拽守卫。
   *
   * 点红点的语义是「看明细」，不是「拖节点」；但红点画在节点左上角、指针按下时命中测试
   * 仍是那个节点，cytoscape 会立刻开始拖拽。这里在**捕获阶段**（早于 cytoscape 的事件处理）
   * 检查按下点是否落在红点区域：是的话临时 `autoungrabify(true)`，松手后再恢复，
   * 于是这一下按不拖节点，而正常的点选靠随后的 tap 事件完成。
   */
  private bindTagDotGuard(container: HTMLElement) {
    const handler = (event: PointerEvent) => {
      const cy = this.cy
      if (!cy || !this.activeTagIds.length) return
      const rect = container.getBoundingClientRect()
      const point = { x: event.clientX - rect.left, y: event.clientY - rect.top }
      if (!this.tagDotAt(point)) return
      cy.autoungrabify(true)
      window.addEventListener('pointerup', () => cy.autoungrabify(false), { once: true })
    }
    container.addEventListener('pointerdown', handler, true)
    this.tagGuardHandler = handler
  }

  /**
   * 某个节点上**被勾选**的标签 id（按 activeTagIds 顺序）。
   *
   * 容器（大框）一律返回空：层带 / S09 框 / E lane 只作分组、不参与标签，
   * 所以既不亮红点也不参与红点命中（与「容器不参与关系」同一条原则）。
   */
  private activeTagsOf(nodeId: string): string[] {
    if (!this.activeTagIds.length) return []
    const node = this.cy?.getElementById(nodeId)
    if (!node || !node.length) return []
    /**
     * **装饰容器不参与标签**：画布页的大框（层带 / `ic:g-*`）是 `type: 'group'` 的装饰，
     * 它们不参与关系，也不参与标签（`check-canvas` 里有这条断言）。
     *
     * 判据是**类型**而不是"是不是父节点"——物理链页的块（`type: 'process'`）同样是父节点
     * （成员挂在它下面），但它是天体物理过程本身：——选中一个参数要能
     * 高亮"有这个标签的产物**或者**天体物理过程"，一级只有块，挡住父节点就等于一级永远不亮。
     */
    if (node.data('type') === 'group') return []
    const tagIds = (node.data('tagIds') as string[] | undefined) ?? []
    const active = new Set(this.activeTagIds)
    return tagIds.filter((tagId) => active.has(tagId))
  }

  /** 把「是否亮红点」落到 `node.tagged` 类上（只有持有被勾选标签的模块才亮） */
  private applyTagMarks() {
    const cy = this.cy
    if (!cy) return
    cy.batch(() => {
      cy.nodes().forEach((node) => {
        node.toggleClass('tagged', this.activeTagsOf(node.id()).length > 0)
      })
    })
  }

  /** 勾选的全局标签（store → 渲染器）；红点标记与命中都以此为准 */
  setActiveTags(ids: readonly string[]) {
    const next = [...new Set(ids)]
    if (next.length === this.activeTagIds.length && next.every((id, index) => id === this.activeTagIds[index])) {
      return
    }
    this.activeTagIds = next
    this.applyTagMarks()
  }

  /**
   * 画布上当前「亮着红点」的模块列表（浮标定位用）：节点 id、第一个被勾选的标签、节点左上角渲染坐标。
   *
   * 红点交给 **DOM 徽标**画（见 GraphCanvas），不再用节点的 `background-image`：
   * 位图在 `devicePixelRatio ≠ 1` 的屏幕上会画歪/画不出来（实测 1.5 倍缩放下节点角上没有红点），
   * DOM 用同一套 CSS 像素定位，缩放、平移、高分屏都一致，还能直接点。
   */
  /**
   * 画布上「**有子图的模块**」的位置（浮层呼吸光晕 + 粒子用）：
   * 非装饰框、有子节点、且当前可见。返回渲染坐标（CSS 像素，相对画布容器）。
   */
  subgraphMarks(): Array<{ nodeId: string; x: number; y: number; w: number; h: number }> {
    const cy = this.cy
    if (!cy) return []
    const marks: Array<{ nodeId: string; x: number; y: number; w: number; h: number }> = []
    cy.nodes().forEach((node) => {
      if (!node.visible() || node.isParent()) return
      if (Number(node.data('childCount')) <= 0) return
      /**
       * 「层」（`enterable: false`）不挂光晕与粒子：这些动效在这一页就是"双击还能进去"的信号，
       * 而层横切各块、没有自己的子图（L1 的成员是头文件，压根不在图上，见 `block.enterable`）。
       */
      if (node.data('enterable') === false) return
      const box = node.renderedBoundingBox({ includeLabels: false, includeOverlays: false })
      if (![box.x1, box.y1, box.w, box.h].every((value) => Number.isFinite(value))) return
      marks.push({ nodeId: node.id(), x: box.x1, y: box.y1, w: box.w, h: box.h })
    })
    return marks
  }

  tagMarks(): Array<{ nodeId: string; tagId: string; x: number; y: number; zoom: number }> {
    const cy = this.cy
    if (!cy || !this.activeTagIds.length) return []
    const marks: Array<{ nodeId: string; tagId: string; x: number; y: number; zoom: number }> = []
    cy.nodes().forEach((node) => {
      if (!node.visible()) return
      const tagIds = this.activeTagsOf(node.id())
      if (!tagIds.length) return
      const box = node.renderedBoundingBox({ includeLabels: false, includeOverlays: false })
      if (!Number.isFinite(box.x1) || !Number.isFinite(box.y1)) return
      marks.push({ nodeId: node.id(), tagId: tagIds[0], x: box.x1, y: box.y1, zoom: cy.zoom() })
    })
    return marks
  }

  /**
   * 命中红点：指针（容器坐标）落在某个**亮着红点**的节点左上角小方区里时，
   * 返回该节点与它第一个被勾选的标签。区域比红点略大一圈，免得要像素级对准。
   *
   * 现在红点是 DOM 按钮，点击不再经过这里；这个方法留给快捷键/测试等按坐标判定的场景。
   */
  private tagDotAt(point: Position): { nodeId: string; tagId: string } | null {
    const cy = this.cy
    if (!cy || !this.activeTagIds.length) return null
    let hit: { nodeId: string; tagId: string } | null = null
    const spread = 2
    cy.nodes().forEach((node) => {
      if (hit || !node.visible() || !node.hasClass('tagged')) return
      const box = node.renderedBoundingBox({ includeLabels: false, includeOverlays: false })
      if (!Number.isFinite(box.x1) || !Number.isFinite(box.y1)) return
      const x1 = box.x1 + TAG_DOT_INSET - spread
      const y1 = box.y1 + TAG_DOT_INSET - spread
      if (point.x < x1 || point.x > x1 + TAG_DOT_SIZE + spread * 2) return
      if (point.y < y1 || point.y > y1 + TAG_DOT_SIZE + spread * 2) return
      const tagId = this.activeTagsOf(node.id())[0]
      if (tagId) hit = { nodeId: node.id(), tagId }
    })
    return hit
  }

  private bindDoubleClick(container: HTMLElement) {
    const handler = (event: MouseEvent) => {
      const cy = this.cy
      if (!cy) return
      const rect = container.getBoundingClientRect()
      const point = { x: event.clientX - rect.left, y: event.clientY - rect.top }
      const id = hitTestNode(cy, point)
      if (!id) return
      const node = cy.getElementById(id)
      if (!node.length) return
      const childCount = Number(node.data('childCount')) || 0
      if (childCount === 0 || node.data('type') === 'group') return
      this.handlers.onEnterSubgraph?.(id)
    }
    container.addEventListener('dblclick', handler)
    this.containerEl = container
    this.dblclickHandler = handler
  }

  private bindEvents() {
    const cy = this.cy
    if (!cy) return

    cy.on('tap', 'node', (event: EventObject) => {
      /**
       * 先选中节点，再判断是否点中了红点。
       *
       * 顺序不能反：属性面板只在「有选中对象」时才渲染，若点红点时直接 return，
       * 事件里的明细就没人接住——表现是「点红点什么都没发生，右侧面板也不开」。
       */
      this.handlers.onSelectNode(event.target.id())
      const dot = event.renderedPosition ? this.tagDotAt(event.renderedPosition) : null
      if (dot && dot.nodeId === event.target.id()) {
        this.handlers.onOpenTagDetail?.(dot.nodeId, dot.tagId)
      }
    })
    cy.on('tap', 'edge', (event: EventObject) => {
      this.handlers.onSelectEdge(event.target.id())
    })
    cy.on('tap', (event: EventObject) => {
      if (event.target === cy) this.handlers.onClearSelection()
    })

    // 悬停只有一个来源：核心级 mousemove + 命中测试（节点方块 + 已显示的标签矩形）。
    // 不用节点级 `mouseover, 'node'`：标签挂在节点下方，指针落在名称文字上时那套事件不会触发，
    // 反而会命中文字下方另一个节点——那正是「悬停这个节点却变成另一个名字」的放大器。
    cy.on('mousemove', (event: EventObject) => {
      // 事件里没有渲染坐标时不动悬停态（宁可保持现状，也不要按原点误命中）
      const point = event.renderedPosition
      if (!point) return
      this.setHoveredId(hitTestNode(cy, point))
    })
    cy.on('mouseout', () => this.setHoveredId(null))

    /**
     * 指针直接停在某条线上：给这条边加 `.hovered`，只显示它的关系名（并把线提亮）。
     *
     * 边的几何命中太难写（线宽 1.4px，还要考虑曲线与箭头），因此这里用 cytoscape 自带的
     * 边命中事件——它按渲染出的线做判定，比手写几何可靠。
     */
    cy.on('mouseover', 'edge', (event: EventObject) => {
      event.target.addClass('hovered')
    })
    cy.on('mouseout', 'edge', (event: EventObject) => {
      event.target.removeClass('hovered')
    })

    cy.on('grab', 'node', (event: EventObject) => {
      this.handlers.onNodeDragStart(event.target.id())
    })
    cy.on('free', 'node', (event: EventObject) => {
      const node = event.target as NodeSingular
      // 用户拖动也是一次真实的坐标来源
      this.placedIds.add(node.id())
      this.handlers.onNodeDragEnd(node.id(), node.position())
      // 拖进大框 = 建立层级关系：松手时按几何判定归属，由上层决定是否落盘
      this.reportDropInto(node)
    })

    cy.on('cxttap', 'node', (event: EventObject) => {
      this.handlers.onNodeContextMenu(event.target.id(), this.clientPoint(event))
    })
    cy.on('cxttap', 'edge', (event: EventObject) => {
      this.handlers.onEdgeContextMenu(event.target.id(), this.clientPoint(event))
    })
    cy.on('cxttap', (event: EventObject) => {
      if (event.target !== cy) return
      const client = this.clientPoint(event)
      const rect = this.containerRect()
      this.handlers.onCanvasContextMenu(
        client,
        this.modelPositionAt({ x: client.x - rect.left, y: client.y - rect.top }),
      )
    })

    cy.on('zoom', () => {
      this.handlers.onZoomChange(cy.zoom())
      // 字号必须跟着缩放同步写：迟一帧就会看到「先糊后清」的抖动
      this.applyLabelScale()
      this.scheduleLabels()
    })
    // 平移不改变标签之间的相对位置，但节点坐标换了，仍然要按新的渲染坐标重算一次
    cy.on('pan', () => this.scheduleLabels())
  }

  /* ---------------- 层级 / 可见性 ---------------- */

  /**
   * 重建层级模型。话题过滤下只用成员建层级：非成员不在可见集里，
   * 若一并参与，roots 会混进不属于本话题的节点，可见集就会算错。
   */
  private rebuildHierarchy() {
    const filter = this.topicFilter
    const nodes = filter ? this.hierarchyNodes.filter((node) => filter.members.has(node.id)) : this.hierarchyNodes
    this.hierarchy = buildHierarchy(nodes, filter?.hierParentOf ?? null)
  }

  /**
   * 节点的 compound 父级：**只有装饰容器（大框）才能当 compound 父节点**。
   *
   * 模块（非大框但有子节点）的子节点属于它自己的标签页，绝不与它同屏，因此不挂 compound。
   * 话题过滤把大框关掉时，子节点改挂到「最近的可见祖先」——前提同样是那位祖先是大框。
   */
  private compoundParentOf(nodeId: string): string | null {
    const graph = this.lastGraph
    if (!graph) return null
    const raw = graph.nodes.find((node) => node.id === nodeId)?.parent ?? null
    if (!raw || !this.groupIds.has(raw)) {
      // 直接父级不是大框（或不存在）：话题过滤下试试「最近的可见祖先」是不是大框
      const lifted = this.topicFilter?.hierParentOf.get(nodeId) ?? null
      return lifted && this.groupIds.has(lifted) ? lifted : null
    }
    if (this.topicFilter && !this.topicFilter.members.has(raw)) {
      const lifted = this.topicFilter.hierParentOf.get(nodeId) ?? null
      return lifted && this.groupIds.has(lifted) ? lifted : null
    }
    return raw
  }

  /**
   * 把可见性幂等地落到元素上：先全部还原，再按可见集隐藏。
   * 可见集 = 焦点子节点 + 装饰框后代（递归）+ 焦点声明的**对外输入**（灰显上下文），
   * 再与 compound 约束求交（父不可见则子不可见——话题过滤把大框关掉时会命中这条）。
   *
   * 对外输入是这条交集的**唯一豁免**：它们的真实父级是别的块（在本标签页里被藏了），
   * 若照规矩级联下去它们会跟着消失——那样"这一块读了块外什么"就又看不见了。
   */
  private applyVisibility(): Set<string> {
    const cy = this.cy
    const hierarchy = this.hierarchy
    if (!cy || !hierarchy) return new Set()

    const visible = tabVisibleIds(hierarchy, this.focusId)
    const contextIds = tabContextIds(hierarchy, this.focusId)
    const filter = this.topicFilter

    const hidden = new Set<string>()
    cy.nodes().forEach((node) => {
      if (!visible.has(node.id())) hidden.add(node.id())
    })
    // compound 硬约束：沿 cy 父链补一刀，父被隐藏的子节点一起藏（对外输入豁免，见上）
    cy.nodes().forEach((node) => {
      if (contextIds.has(node.id())) return
      let cursor = this.parentIdOf(node as NodeSingular)
      while (cursor) {
        if (hidden.has(cursor)) {
          hidden.add(node.id())
          break
        }
        const parent = cy.getElementById(cursor)
        if (!parent.length || !parent.isNode()) break
        cursor = this.parentIdOf(parent as NodeSingular)
      }
    })

    cy.batch(() => {
      cy.nodes().forEach((node) => {
        node.removeStyle('display')
        /**
         * 灰显的对外输入：类名幂等切换（换标签页时自然生效）。
         * 它们与别的节点共用同一套元素——**不复制节点**，所以主图、检索、属性页看到的都是同一个对象。
         */
        node.toggleClass('context', contextIds.has(node.id()))
        /**
         * 回流的两端（本块这一步读上一轮的它 / 本块上一轮把它的它送了出去）：这个盒子进这一块的子图，
         * 只因它落在回流上——于是浮层那个开关一并管着它，挂上 `feedback-context`，与一级那条弧、
         * 子图里那两条落点边同进同出（见 `applyFeedbackVisibility`）。
         * 判据只有节点数据这两份（`feedbackInputOf` / `feedbackOutputOf`）。
         */
        const onFeedback =
          this.focusId !== null &&
          [
            ...((node.data('feedbackInputOf') as string[] | undefined) ?? []),
            ...((node.data('feedbackOutputOf') as string[] | undefined) ?? []),
          ].includes(this.focusId)
        node.toggleClass('feedback-context', onFeedback)
        if (hidden.has(node.id())) node.style('display', 'none')
      })
      cy.edges().forEach((edge) => {
        edge.removeStyle('display')
        const source = edge.data('source') as string
        const target = edge.data('target') as string
        /**
         * 从对外输入指进本块的那条依赖：本块子图里它是"外部来的"，画细一点（样式表 `.context-edge`）。
         * **回流的落点除外**——它自带一档样式（品红长划）；让这条"灰细"压上去，同一条关系在一级与
         * 子图里就不像一件事了。
         */
        edge.toggleClass(
          'context-edge',
          !edge.hasClass('feedback-input') && (contextIds.has(source) || contextIds.has(target)),
        )
        /**
         * **只在某一个块的标签页里显形的边**（`subgraphOf`：物理链页把产物的块间回流弧落成的成员级落点边）：
         * 主图与别的块子图都不画它。一条弧在两端块各派一条（收方块那侧讲"读进来的"、来源块那侧讲
         * "送出去的"），两条靠这个字段分别收口，所以同一时刻只有所在的那一块画得出它。
         */
        const scope = edge.data('subgraphOf') as string | undefined
        if (scope && this.focusId !== scope) {
          edge.style('display', 'none')
          return
        }
        // 端点任一不可见时 cytoscape 本来就不会画这条边；这里只处理话题过滤
        if (filter && (!filter.members.has(source) || !filter.members.has(target))) {
          edge.style('display', 'none')
          return
        }
        /**
         * 按模块收起关系（纯视图）：端点命中集合的**语义关系连线**不画。
         * 层级不是边元素（父子关系走 compound 的 `move({ parent })`），
         * 所以这条规则碰不到层级结构——不需要额外按类名跳过什么。
         */
        if (!this.hiddenRelationIds.size) return
        if (this.hiddenRelationIds.has(source) || this.hiddenRelationIds.has(target)) {
          edge.style('display', 'none')
        }
      })
    })

    const effective = new Set([...visible].filter((id) => !hidden.has(id)))
    this.scheduleLabels()
    return effective
  }

  private emitVisibility(visible: ReadonlySet<string>) {
    this.handlers.onVisibilityChange?.({ visible: visible.size })
  }

  /* ---------------- 数据同步 ---------------- */

  /** 增量同步元素：保留既有坐标，仅为新节点触发布局 */
  sync(graph: Graph, options: { relayout?: boolean } = {}) {
    const cy = this.cy
    if (!cy) return

    this.lastGraph = graph
    const activeNodeIds = new Set(graph.nodes.map((node) => node.id))
    this.hierarchyNodes = graph.nodes.map((node) => ({
      id: node.id,
      parent: node.parent || null,
      frame: node.type === 'group',
      /** 块声明的对外输入：进它的标签页时这些节点额外显形并灰显（物理链的块子图用它） */
      contexts: node.contexts,
    }))
    this.rebuildHierarchy()
    this.groupIds = new Set(graph.nodes.filter((node) => node.type === 'group').map((node) => node.id))

    // 模块标记按**原始数据**的直系子节点数算（与话题过滤无关）：徽标含义是「进去能看到几个」
    const childCountOf = new Map<string, number>()
    graph.nodes.forEach((node) => {
      if (!node.parent) return
      childCountOf.set(node.parent, (childCountOf.get(node.parent) ?? 0) + 1)
    })

    // 加载自愈：一批节点共享同一坐标，说明它们是「从没排布过」的占位坐标（cytoscape 默认原点），
    // 原样显示会叠成一堆、指针也会命中最上面那个。这里把它们当未排布，交给开场布局排开。
    const ignoredPositions = ignoredPositionIds(graph.nodes)
    // 记账随数据增删同步：已不存在的节点出账；本次带着合法坐标进来的节点入账
    this.placedIds.forEach((id) => {
      if (!activeNodeIds.has(id)) this.placedIds.delete(id)
    })

    /**
     * 容器的坐标一律**由子节点推导**（取子节点坐标的包围盒中心）：
     * 直接吃存档坐标不行——cytoscape 里「设置父节点坐标会带动子节点平移」，
     * 存档值与子节点实际中心一旦不一致，加载时整个子树就会被拽偏。
     * 空框（还没有子节点）没有可推导的对象，才用存档坐标——否则新建的空框会跑到原点。
     */
    const childBoxOf = new Map<string, { minX: number; maxX: number; minY: number; maxY: number }>()
    graph.nodes.forEach((child) => {
      if (!child.parent || !child.position) return
      const box = childBoxOf.get(child.parent)
      if (!box) {
        childBoxOf.set(child.parent, {
          minX: child.position.x,
          maxX: child.position.x,
          minY: child.position.y,
          maxY: child.position.y,
        })
        return
      }
      box.minX = Math.min(box.minX, child.position.x)
      box.maxX = Math.max(box.maxX, child.position.x)
      box.minY = Math.min(box.minY, child.position.y)
      box.maxY = Math.max(box.maxY, child.position.y)
    })

    const added: string[] = []
    cy.batch(() => {
      graph.nodes.forEach((node) => {
        const element = cy.getElementById(node.id)
        const isGroup = this.groupIds.has(node.id)
        const childCount = childCountOf.get(node.id) ?? 0
        // 模块 = 非大框但有子节点：紧凑框 + 「· N」可进入徽标（样式表 .branch 规则）
        const isModule = !isGroup && childCount > 0
        /**
         * 尺寸按名称算出来写进 data，样式表用 `width: data(boxW)` 取值：
         * 一屏里的框因此互不相同、但都由内容决定（「大小成比例」的来源）。
         * 大框的最小尺寸也一并算，避免空框塌成一条线。
         */
        const size = isGroup ? measureGroupSize(node.label) : measureBoxSize(node.label)
        /**
         * 红点 / 命中用的标签：与属性面板取的是**同一份口径**（`tagDisplayOf`）——
         * 有子图的模块拿的是**当前子树叶子并集**，于是「在叶子上勾一个参数」时它的祖先立刻亮红点，
         * 叶子删光就整片灭掉。容器不参与标签，一律不给（装饰容器 MUST NOT 显示红点）。
         * `tagUnion === false`（物理链页）时照读数据里那份——那里的块标签是生成物烘好的并集。
         */
        const display = this.tagUnion ? tagDisplayOf(graph.nodes, node) : null
        const tagIds = isGroup ? [] : [...(display ? display.tags : node.tags)]
        const data = {
          id: node.id,
          label: node.label,
          type: node.type,
          typeLabel: NODE_TYPE_LABELS[node.type as NodeType] || node.type,
          summary: node.summary,
          refCount: node.refs.length,
          tagCount: tagIds.length,
          /** 全局标签 id：红点标记与命中都以此为准（勾选集合在渲染器里） */
          tagIds,
          childCount,
          /**
           * 能不能进去：`enterable !== false`。块以外的节点不带这个字段（＝可进入），
           * 判据只有一处（生成物里的 `block.enterable`），画布不自己重算连通性。
           */
          enterable: node.enterable !== false,
          branchLabel: `${node.label} · ${childCount}`,
          boxW: size.width,
          boxH: size.height,
          textMaxW: size.textMaxWidth,
          /**
           * 回流在这个视图面上的两端（物理链页派的 `feedbackInputOf` / `feedbackOutputOf`：
           * 这些块在这一步读上一轮的它 / 上一轮把它的它送了出去）：写进 data 供可见性收口按当前块判定
           * （与边的 `subgraphOf` 同一路）。为空时不写这个键。
           */
          ...(node.feedbackInputOf?.length ? { feedbackInputOf: node.feedbackInputOf } : {}),
          ...(node.feedbackOutputOf?.length ? { feedbackOutputOf: node.feedbackOutputOf } : {}),
        }
        // 坐标有真实来源（未被判为占位）才算「已排布」，占位的按无坐标处理
        const stored = node.position && !ignoredPositions.has(node.id) ? node.position : null
        const childBox = childBoxOf.get(node.id)
        const derived = childBox
          ? { x: (childBox.minX + childBox.maxX) / 2, y: (childBox.minY + childBox.maxY) / 2 }
          : null
        const position = isGroup ? derived ?? stored : stored
        if (position) this.placedIds.add(node.id)
        if (element.length && element.isNode()) {
          element.data(data)
          element.toggleClass('container', isGroup)
          element.toggleClass('branch', isModule)
          element.toggleClass('conditional', Boolean(node.conditional))
          // 悬停放大是行内宽高（见 applyHoverSize）：名称变了尺寸也跟着变，
          // 先清掉旧的行内值，正在悬停的那个再按新尺寸重新放大一次
          ;(element as NodeSingular).removeStyle('width')
          ;(element as NodeSingular).removeStyle('height')
          if (this.hoveredId === node.id) this.applyHoverSize(element as NodeSingular)
          return
        }
        added.push(node.id)
        cy.add({
          group: 'nodes',
          data,
          // 容器用「子节点包围盒中心」推出来的坐标，空框用存档坐标（见 childBoxOf 的说明）
          position: position ?? undefined,
          classes: [
            isGroup ? 'container' : '',
            isModule ? 'branch' : '',
            node.conditional ? 'conditional' : '',
            position || isGroup ? '' : 'enter',
          ]
            .filter(Boolean)
            .join(' '),
        })
      })

      cy.nodes().forEach((node) => {
        if (!activeNodeIds.has(node.id())) node.remove()
      })

      const activeEdgeIds = new Set(graph.edges.map((edge) => edge.id))
      graph.edges.forEach((edge) => {
        const element = cy.getElementById(edge.id)
        const data = {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          label: edge.label,
          type: edge.type,
          directed: edge.directed,
          note: edge.note,
          /**
           * 端口必须写进 data：样式表里 `edge[sourcePort = "n"]` 这类属性选择器靠它命中。
           * 为空时**不写这个键**（而不是写 null），否则 `[sourcePort]` 存在性判断也会命中空值。
           */
          ...(edge.sourcePort ? { sourcePort: edge.sourcePort } : {}),
          ...(edge.targetPort ? { targetPort: edge.targetPort } : {}),
          /**
           * 只在某一个块的标签页里显形的边（物理链页派生的回流输入边）：写进 data，供可见性收口按块判定。
           * 与端口同理，为空时不写这个键。
           */
          ...(edge.subgraphOf ? { subgraphOf: edge.subgraphOf } : {}),
        }
        if (element.length && element.isEdge()) {
          element.data(data)
          element.toggleClass('conditional', Boolean(edge.conditional))
          // 跨层捷径（只有物理链页会带 crossLink 字段，工程图谱因此完全不受影响）
          element.toggleClass('cross-link', Boolean(edge.crossLink))
          // 跨红移回流（同样只有物理链页会带这个标记）：独立类名，样式与「默认不画」都按它判
          element.toggleClass('feedback', edge.spanKind === 'feedback')
          // 它在子图里的落点：与上面那档同一样式，「关着就不画」也共用同一条规则
          // （选择器 `edge.feedback-input.feedback-off`）；类名分开只为区分谁在一级、谁在子图
          element.toggleClass('feedback-input', edge.spanKind === 'feedback-input')
          return
        }
        if (!cy.getElementById(edge.source).length || !cy.getElementById(edge.target).length) return
        cy.add({
          group: 'edges',
          data,
          classes: [
            edge.conditional ? 'conditional' : '',
            edge.crossLink ? 'cross-link' : '',
            edge.spanKind === 'feedback' ? 'feedback' : '',
            edge.spanKind === 'feedback-input' ? 'feedback-input' : '',
          ]
            .filter(Boolean)
            .join(' '),
        })
      })

      cy.edges().forEach((edge) => {
        if (!activeEdgeIds.has(edge.id())) edge.remove()
      })
    })

    // 父子关系单独一趟：compound 要求父节点已经存在于图上，
    // 与节点同批写入时（子先于父）cytoscape 会直接抛错
    this.syncCompoundParents()

    const visible = this.applyVisibility()
    this.emitVisibility(visible)
    // 数据变了（新增/删除节点、改了标签归属）就重算红点
    this.applyTagMarks()
    // 新加的边默认显现，而开关可能正处在关闭态：这里补一次，免得"同步一次就露出来"
    this.applyFeedbackVisibility()

    /**
     * 手动摆放不跑自动布局，而「摘进场态」这件事原本挂在自动布局上（`runLayout` 开头）。
     * 这里统一兜底：否则一批新节点会永远停在 `opacity: 0`，整张画布看起来是空的。
     */
    if (this.layoutKind === 'manual') this.clearEnterClass()

    const needsLayout = added.some((id) => {
      const node = graph.nodes.find((item) => item.id === id)
      // 容器的坐标是派生值（由子节点算出来），不算「缺坐标」
      if (node?.type === 'group') return false
      return !node?.position || ignoredPositions.has(id)
    })

    if (options.relayout) {
      // 这一次整图重排本身就是「打开即按当前布局排布」，不必再来一次
      this.pendingInitialLayout = false
      this.runLayout(this.layoutKind)
      return
    }

    if (needsLayout) {
      /**
       * 手动布局下绝不自动重排：手摆好的图被一次「自动整理」冲掉是不可接受的。
       * 缺坐标的新节点就近摆到它所属大框（或视口中心）旁边，其余节点位置分毫不动。
       */
      if (this.layoutKind === 'manual') {
        this.placeUnplacedNodes()
        this.layoutIfPending()
        return
      }
      // 首屏把这次机会让给紧随其后的布局消费（layoutIfPending），避免两次布局
      if (this.pendingInitialLayout) return
      this.runLayout(this.layoutKind)
      return
    }

    cy.resize()
    // 存档坐标可能来自别的布局，首屏按当前布局重排一次
    this.layoutIfPending()
  }

  /**
   * 把节点按「装饰容器」规则挂进 compound 容器（见 compoundParentOf）。
   *
   * 单独一趟的必要性见 sync 里的注释（父必须先存在）。已经一致的链路直接跳过，
   * 避免每次同步都做一次全量 reparent（那会让 cytoscape 反复重算包围盒）。
   * 成环的数据在服务端已被拦下，这里再兜一层：出错就跳过这一条，不让整次同步失败。
   */
  private syncCompoundParents() {
    const cy = this.cy
    const graph = this.lastGraph
    if (!cy || !graph) return
    cy.batch(() => {
      graph.nodes.forEach((node) => {
        const element = cy.getElementById(node.id)
        if (!element.length || !element.isNode()) return
        const desired = this.compoundParentOf(node.id)
        if (this.parentIdOf(element as NodeSingular) === desired) return
        try {
          ;(element as NodeSingular).move({ parent: desired })
        } catch (error) {
          console.warn('[graphify] 父子关系写入失败，已跳过：', node.id, '→', desired, error)
        }
      })
    })
  }

  /** 节点的 compound 父节点 id（没有则 null）；用一个方法收口，避免到处写集合判空 */
  private parentIdOf(node: NodeSingular): string | null {
    const parents = node.parent()
    if (!parents.length) return null
    let id: string | null = null
    parents.forEach((parent) => {
      id = parent.id()
    })
    return id
  }

  /**
   * 摘掉进场态 `.enter`。
   *
   * 它由 `sync()` 给「没有存档坐标、等着被排布」的新节点挂上（样式是 `opacity: 0` + 8×8），
   * 原本只由 `runLayout()` 在起跑前清掉——因为这套「先透明、排布时淡入」是给自动布局配套的。
   * **手动摆放不跑自动布局**，于是这些节点会永远停在透明状态：整张画布看起来什么都没有。
   */
  private clearEnterClass(collection?: cytoscape.CollectionReturnValue) {
    const target = collection ?? this.cy?.nodes()
    target?.filter((element) => element.hasClass('enter')).removeClass('enter')
  }

  /**
   * 手动布局下给「从未排布过」的节点就近安家：优先摆进它所属的大框，
   * 没有父框时摆到当前视口中心，并按方框尺寸的网格错开。
   *
   * 特例：如果**所有**可见节点都没排布过，成片塞在视口中心会叠成一坨。
   * 这种情况先做一次确定性网格打包（与「整理布局」同一算法），再交回手动。
   */
  private placeUnplacedNodes(): boolean {
    const cy = this.cy
    if (!cy) return false
    const unplaced = cy.nodes().filter((node) => node.visible() && !this.placedIds.has(node.id()))
    if (!unplaced.length) return false
    // 手动摆放没有「排布后淡入」这一步，进场态必须在这里就摘掉（见 clearEnterClass 说明）
    this.clearEnterClass(unplaced)

    const visibleCount = cy.nodes().filter((node) => node.visible()).length
    if (unplaced.length > 1 && unplaced.length === visibleCount) {
      packVisible(cy)
      this.markVisibleAsPlaced()
      this.emitPositions()
      this.scheduleLabels()
      return true
    }

    const center = this.viewportCenterModel()
    // 网格步长按方框尺寸留出空隙（140×40 → 168×62），否则新节点会互相压住
    const step = { x: NODE_BOX_WIDTH + 28, y: NODE_BOX_HEIGHT + 22 }
    cy.batch(() => {
      unplaced.forEach((node, index) => {
        const parentId = this.parentIdOf(node as NodeSingular)
        const base = (parentId ? this.modelPosition(parentId) : null) ?? center
        node.position({
          x: base.x + ((index % 4) - 1.5) * step.x,
          y: base.y + (Math.floor(index / 4) - 0.5) * step.y,
        })
        this.placedIds.add(node.id())
      })
    })
    this.emitPositions()
    this.scheduleLabels()
    return true
  }

  /** 当前视口中心对应的模型坐标；拿不到尺寸时退回原点 */
  private viewportCenterModel(): Position {
    const cy = this.cy
    if (!cy) return { x: 0, y: 0 }
    const pan = cy.pan()
    const zoom = cy.zoom() || 1
    return { x: (cy.width() / 2 - pan.x) / zoom, y: (cy.height() / 2 - pan.y) / zoom }
  }

  /**
   * 松手时判定「这个节点现在待在哪个大框里」，与当前父子关系不同就上报。
   *
   * 判定用**节点中心**而不是包围盒相交：包围盒只要蹭到框边就算入框，拖到旁边也会被吞进去。
   * 容器自己、以及它自己的子孙都不算候选（大框不能塞进自己身体里）。
   */
  private reportDropInto(node: NodeSingular) {
    const handler = this.handlers.onNodeReparent
    if (!handler) return
    const cy = this.cy
    if (!cy || node.isParent()) return
    const container = this.containerAt(node.position(), [node.id(), ...node.descendants().map((item) => item.id())])
    const next = container?.id ?? null
    if (this.parentIdOf(node) === next) return
    handler(node.id(), next)
  }

  /**
   * 整图重排（当前标签页的可见内容）。
   *
   * `manual` 走确定性网格打包（graph/pack.ts）：装饰框自底向上合围、主图单列竖链——
   * 这就是「整理布局」按钮在手动模式下的含义。其余算法交给 cytoscape 布局。
   * 排完一律取景（打开 / 切换布局 / 工具条重排都是用户显式动作）。
   */
  async runLayout(kind: LayoutKind) {
    const cy = this.cy
    if (!cy) return
    this.layoutKind = kind
    cy.nodes().removeClass('enter')
    if (kind === 'manual') {
      packVisible(cy)
      this.markVisibleAsPlaced()
      this.fit()
      this.emitPositions()
      this.scheduleLabels()
      return
    }
    // 分层对齐（graph/ordered.ts）：自研算法，不走 cytoscape 的内置布局
    if (kind === 'flow') {
      runOrderedLayout(cy)
      this.markVisibleAsPlaced()
      this.fit()
      this.emitPositions()
      this.scheduleLabels()
      return
    }
    this.layoutInFlight = true
    try {
      // 布局一律不自己取景（见 layout.ts）：取景统一由渲染器的 fit() 负责
      await runLayout(cy, kind, (error) => this.handlers.onLayoutError?.(error), { fit: false })
    } finally {
      this.layoutInFlight = false
    }
    // 这次排布覆盖的就是当时可见的节点：它们从此有了真实坐标
    this.markVisibleAsPlaced()
    this.fit()
    this.emitPositions()
    this.scheduleLabels()
  }

  /**
   * 把当前可见节点登记为「已排布」。布局刚覆盖过它们，坐标可以回存。
   */
  private markVisibleAsPlaced() {
    this.cy?.nodes().forEach((node) => {
      if (node.visible()) this.placedIds.add(node.id())
    })
  }

  /**
   * 打开（或整体替换数据）后按当前布局重排一次。
   * 返回 true 表示本次已经开始重排，调用方不必再取景。
   */
  layoutIfPending(): boolean {
    if (!this.pendingInitialLayout) return false
    const cy = this.cy
    if (!cy) return false
    // 还没有可见节点时不消费标志：数据与话题两条时序谁后到就由谁触发
    if (!cy.nodes().filter((node) => node.visible()).length) return false
    this.pendingInitialLayout = false
    /**
     * 手动摆放模式下「首屏按当前布局重排一次」这件事不成立：
     * 存档坐标就是用户摆的位置，照单全收即可，只补一次取景。
     */
    if (this.layoutKind === 'manual') {
      this.fit()
      return true
    }
    this.runLayout(this.layoutKind)
    return true
  }

  /**
   * 保证「可见的节点都已排布」：话题开关把从未排布过的节点显示出来时，
   * 它们会停在 cytoscape 的默认原点叠成一堆，必须补一次重排把它们放到位。
   *
   * 首屏那次交给 `layoutIfPending()`（只排一次），这里直接让位。
   */
  private ensurePlaced(): boolean {
    if (this.pendingInitialLayout || this.layoutInFlight) return false
    const cy = this.cy
    if (!cy) return false
    const unplaced = cy.nodes().filter((node) => node.visible() && !this.placedIds.has(node.id()))
    if (!unplaced.length) return false
    // 手动摆放：只给新露面的节点就近安家，不碰已有版面
    if (this.layoutKind === 'manual') return this.placeUnplacedNodes()
    this.runLayout(this.layoutKind)
    return true
  }

  /* ---------------- 话题过滤 ---------------- */

  /**
   * 设置话题可见集。元素不增删，只切 `display` 与 compound 父级，因此 position 能原样保留。
   * 返回 true 表示有「新露面的节点还没排布」并已补排（调用方不必再取景）。
   */
  setTopicFilter(filter: TopicVisibility | null): boolean {
    this.topicFilter = filter
      ? { members: new Set(filter.members), hierParentOf: new Map(Object.entries(filter.hierParentOf)) }
      : null
    this.rebuildHierarchy()
    // 父级可能因话题开关变成「最近的可见祖先」，compound 挂靠要跟着换
    this.syncCompoundParents()
    this.emitVisibility(this.applyVisibility())
    return this.ensurePlaced()
  }

  /**
   * 设置「被收起关系的模块」集合。只切边的 `display`，不增删元素、不碰坐标，
   * 因此反复切换天然幂等，也不会触发重排或取景变化。
   *
   * 集合相等时直接返回：这条入口会跟着 store 的每次变化调用，
   * 没必要为一次无关重渲染重算一遍全图可见性（与 `setTopicFilter` 同一收敛口径）。
   */
  setHiddenRelations(ids: readonly string[]) {
    const next = new Set(ids)
    if (next.size === this.hiddenRelationIds.size && [...next].every((id) => this.hiddenRelationIds.has(id))) {
      return
    }
    this.hiddenRelationIds = next
    this.emitVisibility(this.applyVisibility())
  }

  /**
   * 设置跨红移回流是否显现。只切 `feedback-off` 类，不增删元素、不碰坐标，
   * 因此反复开合天然幂等，也不会触发重排或取景变化。
   *
   * 集合相等时直接返回：这条入口会跟着页面的每次重渲染调用，
   * 没必要为一次无关重渲染重算一遍（与 `setHiddenRelations` 同一收敛口径）。
   */
  setFeedbackVisible(visible: boolean) {
    if (visible === this.feedbackVisible) return
    this.feedbackVisible = visible
    this.applyFeedbackVisibility()
  }

  /**
   * 把「是否显现」落到 `feedback-off` 类上——**一件事的全部视图面一起开合**：
   *   · `edge.feedback`：一级上那条块 → 块的弧；
   *   · `edge.feedback-input`：它在弧两端块子图里的落点（收方块那侧讲"读进来的"、来源块那侧讲"送出去的"）；
   *   · `node.feedback-context`：落点两端那些盒子里、只因回流才进这一块的（`applyVisibility` 按当前块挂的类）。
   * 三样共用样式表里那一条关闭态规则（`display: none`），两处判据都只有产物这一份。
   */
  private applyFeedbackVisibility() {
    this.cy?.edges('.feedback, .feedback-input').toggleClass('feedback-off', !this.feedbackVisible)
    this.cy?.nodes('.feedback-context').toggleClass('feedback-off', !this.feedbackVisible)
  }

  /**
   * 记录当前布局算法。
   * 切换布局时的「立刻重排」由 GraphCanvas 在切换的那一次 effect 里调用 `runLayout` 完成。
   */
  setLayoutKind(kind: LayoutKind) {
    this.layoutKind = kind
  }

  private emitPositions() {
    const cy = this.cy
    if (!cy) return
    const positions: Record<string, Position> = {}
    cy.nodes().forEach((node) => {
      // 只回存「可见且真的排布过」的节点：未排布节点的坐标是 cytoscape 的默认原点，
      // 写回数据就成了占位坐标（见 graph/positions.ts）
      if (!node.visible() || !this.placedIds.has(node.id())) return
      /**
       * 容器不回存坐标：compound 父节点的位置是由子节点算出来的派生值，
       * 存下来只会在下次打开时变成一个过期的锚点。子节点坐标存对，容器自然复原。
       */
      if (node.isParent()) return
      const position = node.position()
      positions[node.id()] = { x: Math.round(position.x), y: Math.round(position.y) }
    })
    this.handlers.onLayoutSettled(positions)
  }

  /** 高亮某节点的邻居，其余弱化 */
  setFocus(nodeId: string | null) {
    const cy = this.cy
    if (!cy) return
    cy.elements().removeClass('highlighted dimmed')
    if (!nodeId) return
    const node = cy.getElementById(nodeId)
    if (!node.length) return
    const neighborhood = node.closedNeighborhood()
    neighborhood.addClass('highlighted')
    cy.elements().difference(neighborhood).addClass('dimmed')
  }

  setPulseNode(nodeId: string | null) {
    if (this.pulseNodeId === nodeId) return
    this.stopPulse()
    this.pulseNodeId = nodeId
    if (!nodeId) return
    const cy = this.cy
    if (!cy) return
    const node = cy.getElementById(nodeId)
    if (!node.length) return
    this.pulseStart = performance.now()
    const tick = (time: number) => {
      const current = this.cy?.getElementById(this.pulseNodeId as string)
      if (!current || !current.length) {
        this.stopPulse()
        return
      }
      const phase = ((time - this.pulseStart) % 1600) / 1600
      const wave = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2)
      current.style('underlay-opacity', 0.16 + wave * 0.22)
      this.pulseFrame = requestAnimationFrame(tick)
    }
    this.pulseFrame = requestAnimationFrame(tick)
  }

  private stopPulse() {
    if (this.pulseFrame !== null) cancelAnimationFrame(this.pulseFrame)
    this.pulseFrame = null
  }

  /** 反选后清掉脉冲留下的行内样式 */
  clearTransientStyles() {
    this.cy?.nodes().removeStyle('underlay-opacity')
  }

  /* ---------------- 标签 ---------------- */

  /**
   * 细节取舍（LOD）：缩得太小时只留大框标题。
   *
   * 字号是模型单位常量（见 graph/labels.ts），缩放时文字与框一起变小 —— 这是正常且期望的
   * 行为（和 draw.io / Figma 一致）。但当缩放到小框文字已经不可读时，留着它只会得到一层灰雾：
   * 此时把非容器的标签藏掉，画面上仍然保留**大框标题**，骨架照样可读；放大回去自动恢复。
   */
  private applyLabelScale() {
    const cy = this.cy
    if (!cy) return
    const tooSmall = cy.zoom() < LOD_LABEL_ZOOM
    cy.batch(() => {
      cy.nodes().forEach((node) => {
        // 大框标题任何缩放下都留着：它是整层视图的唯一文字骨架
        if (node.hasClass('container')) {
          node.removeClass('label-off')
          return
        }
        node.toggleClass('label-off', tooSmall)
      })
    })
  }

  /**
   * 立即重算文字：把「哪些标签可见」登记为「所有可见节点」。
   *
   * 不再按重叠省略：标签写在方框里，它就是框的内容——省略一个标签会得到一个空框，
   * 比文字互相压住更难理解（方框重叠本身就是需要用户去修的问题，不该被藏起来）。
   */
  private refreshLabels() {
    const cy = this.cy
    if (!cy) return
    const shown = new Set<string>()
    cy.batch(() => {
      cy.nodes().forEach((node) => {
        if (!node.visible()) return
        shown.add(node.id())
      })
    })
    this.shownLabels = shown
    // 放在最后：LOD 会改 class，别让上面的遍历把它覆盖回去
    this.applyLabelScale()
  }

  /**
   * 悬停的唯一入口：命中未变化就直接返回，避免指针每移动一点都写 store、重算标签叠加。
   *
   * **容器（大框）不参与悬停**：层带 / S09 框 / E lane 是大片背景，指针划过时给它加高亮、
   * 还顺带把其它元素弱化（邻居高亮），既难看又没信息量——所以命中容器一律当作「没悬停」。
   * 模块与关系才有放大突出效果（见 styles.ts）。
   */
  private setHoveredId(id: string | null) {
    let next = id && this.cy?.getElementById(id).length ? id : null
    if (next) {
      const element = this.cy?.getElementById(next)
      if (element && element.isNode() && element.isParent()) next = null
    }
    if (next === this.hoveredId) return
    const previous = this.hoveredId
    this.hoveredId = next
    /**
     * 悬浮放大：只切 `.hovered` 类，尺寸与描边由样式表决定，
     * 过渡动画由 cytoscape 按 `transition-*` 自己跑——不要在事件里逐帧写样式。
     */
    if (this.cy) {
      if (previous) {
        const node = this.cy.getElementById(previous)
        node.removeClass('hovered')
        this.restoreBaseSize(node as NodeSingular)
      }
      if (next) {
        const node = this.cy.getElementById(next)
        node.addClass('hovered')
        this.applyHoverSize(node as NodeSingular)
      }
    }
    this.handlers.onHoverNode(next)
    // 悬停节点的标签必须显示：走「叠加显示」，不重算筛选（重算会把别人的标签挤掉）
    this.syncPinnedLabels()
  }

  /** 指针离开画布：清掉悬停态（给容器级 pointerleave 兜底用） */
  clearHover() {
    this.setHoveredId(null)
  }

  /**
   * 悬浮放大：按该节点自己的基准尺寸（`boxW`/`boxH`，由名称算出）等比放大。
   *
   * 之所以写成行内样式而不是样式表里的一档固定值：每个框的基准尺寸都不同，
   * 固定值会把小框撑大、把大框压小，比例全乱。容器跳过——它的尺寸由子节点决定。
   */
  private applyHoverSize(node: NodeSingular) {
    this.applyNodeSize(node, NODE_BOX_HOVER_SCALE * this.breatheScale)
  }

  /**
   * 节点尺寸的唯一出口：基准 × 调用方算好的倍率。
   *
   * 悬停与呼吸都会写行内宽高，各写各的必然互相覆盖（悬停时不动、呼吸把悬停顶掉）；
   * 合成一个出口后，任何时刻只有一个权威值。倍率由调用方给：悬停是固定 1.32，
   * 呼吸帧里是「呼吸倍数 ×（该节点正被悬停就再乘 1.32）」。
   */
  private applyNodeSize(node: NodeSingular, factor: number) {
    if (!node.length || node.isParent()) return
    if (factor === 1) {
      this.restoreBaseSize(node)
      return
    }
    const baseWidth = Number(node.data('boxW')) || NODE_BOX_WIDTH
    const baseHeight = Number(node.data('boxH')) || NODE_BOX_HEIGHT
    node.style({
      width: Math.round(baseWidth * factor),
      height: Math.round(baseHeight * factor),
    })
  }

  /**
   * 呼吸：让「有子图的模块」自己的尺寸周期性膨胀收缩（与光晕同周期）。
   *
   * 为什么要另起一个 rAF 循环：cytoscape 的样式本身不做动画，行内宽高一帧改一次才动得起来；
   * 只对**有子图的那几个模块**跑，且没有这类模块时立即停掉，不占常驻开销。
   */
  breatheNodes(ids: readonly string[]) {
    const next = [...new Set(ids)]
    const unchanged = next.length === this.breatheIds.length && next.every((id, index) => id === this.breatheIds[index])
    if (unchanged) return
    this.breatheIds = next
    if (!next.length) {
      this.stopPulse()
      return
    }
    if (this.pulseFrame !== null) return
    this.breatheStartedAt = Date.now()
    const step = () => {
      this.applyBreathe()
      this.pulseFrame = requestAnimationFrame(step)
    }
    this.breatheFrame = requestAnimationFrame(step)
  }

  /** 一帧的呼吸尺寸（余弦相位，起止都在基准尺寸，不会有跳变） */
  private applyBreathe() {
    const cy = this.cy
    if (!cy || !this.breatheIds.length) return
    const phase = ((Date.now() - this.breatheStartedAt) % PULSE_PERIOD_MS) / PULSE_PERIOD_MS
    this.breatheScale = 1 + PULSE_AMPLITUDE * (0.5 - 0.5 * Math.cos(2 * Math.PI * phase))
    this.breatheIds.forEach((id) => {
      const node = cy.getElementById(id)
      if (!node.length || !node.visible()) return
      const factor = this.breatheScale * (this.hoveredId === id ? NODE_BOX_HOVER_SCALE : 1)
      this.applyNodeSize(node as NodeSingular, factor)
    })
  }

  /** 停掉呼吸并把尺寸复位（悬停中的那个重新按悬停尺寸应用） */
  private stopBreathe() {
    if (this.breatheFrame !== null) {
      cancelAnimationFrame(this.breatheFrame)
      this.breatheFrame = null
    }
    this.breatheScale = 1
    this.cy?.nodes().forEach((node) => {
      if (!node.isParent()) this.restoreBaseSize(node as NodeSingular)
    })
    if (this.hoveredId) {
      const node = this.cy?.getElementById(this.hoveredId)
      if (node?.length) this.applyHoverSize(node as NodeSingular)
    }
  }

  /** 去掉行内宽高，让样式表里的 `data(boxW)` 重新生效 */
  private restoreBaseSize(node: NodeSingular) {
    if (!node.length) return
    node.removeStyle('width')
    node.removeStyle('height')
  }

  /**
   * 叠加显示：把「悬停 / 选中」的节点标签直接放行（从 `label-off` 里移除并抬高层级），
   * 退出的节点按最近一次筛选结果恢复。
   *
   * 这里刻意**不重跑筛选**：标签的显示集合只由几何决定，悬停/选中只是往上面叠一条，
   * 因此指针在画布上移动时，除被悬停节点自己的标签可能由省略态转为显示外，不会有任何文字变化。
   */
  private syncPinnedLabels() {
    const cy = this.cy
    if (!cy) return
    const next = new Set<string>()
    if (this.hoveredId && cy.getElementById(this.hoveredId).length) next.add(this.hoveredId)
    cy.nodes(':selected').forEach((node) => {
      next.add(node.id())
    })
    const unchanged = next.size === this.pinnedIds.size && [...next].every((id) => this.pinnedIds.has(id))
    if (unchanged) return
    cy.batch(() => {
      this.pinnedIds.forEach((id) => {
        if (next.has(id)) return
        const node = cy.getElementById(id)
        if (!node.length) return
        node.removeClass('label-off')
        node.toggleClass('label-off', !this.shownLabels.has(id))
      })
      next.forEach((id) => {
        const node = cy.getElementById(id)
        if (!node.length) return
        node.removeClass('label-off')
        node.addClass('label-pinned')
      })
    })
    this.pinnedIds = next
  }

  /** 合并到下一帧：一次缩放 / 平移只重算一次，避免每帧多次全量遍历 */
  private scheduleLabels() {
    if (this.labelsFrame !== null) return
    this.labelsFrame = requestAnimationFrame(() => {
      this.labelsFrame = null
      this.refreshLabels()
    })
  }

  private cancelLabels() {
    if (this.labelsFrame !== null) cancelAnimationFrame(this.labelsFrame)
    this.labelsFrame = null
  }

  select(ids: { nodes: string[]; edges: string[] }) {
    const cy = this.cy
    if (!cy) return
    cy.batch(() => {
      cy.elements().unselect()
      ids.nodes.forEach((id) => cy.getElementById(id).select())
      ids.edges.forEach((id) => cy.getElementById(id).select())
    })
    // 选中节点的标签必须显示：叠加显示，不重算筛选（否则会挤掉别人的标签）
    this.syncPinnedLabels()
  }

  fit(padding = 80) {
    const cy = this.cy
    if (!cy) return
    if (IS_DEV) {
      // 取景会改缩放，出问题时最需要知道「谁调的」。只打一行，栈取到调用方两层。
      console.debug(
        '[graphify] fit() 调用方：',
        new Error().stack?.split('\n').slice(2, 4).map((line) => line.trim()).join('  ←  '),
      )
    }
    // 只对可见节点取景：隐藏元素仍有模型包围盒，直接 cy.fit() 会让画面缩得比内容小很多。
    const visible = cy.nodes().filter((node) => node.visible())
    if (!visible.length) return

    const width = cy.width()
    const height = cy.height()
    // 标签也要算进包围盒：节点名称挂在节点下方（text-valign: bottom），
    // 只按节点矩形取景会把边缘节点的名称切在画布外
    const box = visible.boundingBox({ includeLabels: true, includeOverlays: false })
    const availableWidth = width - padding * 2
    const availableHeight = height - padding * 2
    if (!(box.w > 0) || !(box.h > 0) || availableWidth <= 0 || availableHeight <= 0) {
      // 单节点或容器退化时包围盒可能为 0，除法会得到 Infinity；交给 cytoscape 兜底
      cy.fit(visible, padding)
      this.scheduleLabels()
      return
    }

    // 取景缩放夹上下限（理由见 FIT_MIN_ZOOM / FIT_MAX_ZOOM 的注释）：
    // 宁可溢出画布让用户平移，也不把整层缩到字看不清的程度
    const raw = Math.min(availableWidth / box.w, availableHeight / box.h)
    const zoom = Math.min(
      cy.maxZoom(),
      Math.max(cy.minZoom(), Math.min(FIT_MAX_ZOOM, Math.max(FIT_MIN_ZOOM, raw))),
    )
    const center = { x: (box.x1 + box.x2) / 2, y: (box.y1 + box.y2) / 2 }
    cy.zoom(zoom)
    // rendered = model * zoom + pan：先定缩放，再整体写 pan 让包围盒中心落在画布中心
    cy.pan({ x: width / 2 - center.x * zoom, y: height / 2 - center.y * zoom })
    this.scheduleLabels()
  }

  zoom(delta: number) {
    const cy = this.cy
    if (!cy) return
    cy.zoom({
      level: Math.min(3.4, Math.max(0.12, cy.zoom() + delta)),
      renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
    })
  }

  /** 节点在容器坐标系中的渲染位置，用于浮层手柄定位 */
  renderedPosition(id: string): Position | null {
    const element = this.cy?.getElementById(id)
    if (!element || !element.length || !element.visible()) return null
    const position = element.renderedPosition()
    return { x: position.x, y: position.y }
  }

  /**
   * 节点在容器坐标系中的渲染包围盒（**含标签**）。
   * 浮层控件必须落在标签之外，因此定位要用合围盒而不是节点中心。
   */
  renderedBox(id: string): { x1: number; y1: number; x2: number; y2: number } | null {
    const element = this.cy?.getElementById(id)
    if (!element || !element.length || !element.visible()) return null
    const box = element.renderedBoundingBox({ includeLabels: true, includeOverlays: false })
    if (![box.x1, box.y1, box.x2, box.y2].every((value) => Number.isFinite(value))) return null
    return { x1: box.x1, y1: box.y1, x2: box.x2, y2: box.y2 }
  }

  /** 命中测试：返回给定容器坐标下的节点 id */
  nodeAt(containerPoint: Position): string | null {
    const cy = this.cy
    if (!cy) return null
    const pan = cy.pan()
    const modelPoint = {
      x: (containerPoint.x - pan.x) / cy.zoom(),
      y: (containerPoint.y - pan.y) / cy.zoom(),
    }
    const candidates: { node: NodeSingular; parent: boolean; area: number; degree: number }[] = []
    cy.nodes().forEach((node) => {
      // 不可见的节点仍然有模型包围盒，不排除的话引用会被丢到看不见的节点上
      if (!node.visible()) return
      const box = node.boundingBox()
      const inside =
        modelPoint.x >= box.x1 - 8 &&
        modelPoint.x <= box.x2 + 8 &&
        modelPoint.y >= box.y1 - 8 &&
        modelPoint.y <= box.y2 + 8
      if (inside) {
        candidates.push({
          node: node as NodeSingular,
          parent: node.isParent(),
          area: Math.max(0, box.w) * Math.max(0, box.h),
          degree: node.degree(true),
        })
      }
    })

    if (!candidates.length) return null
    // 与命中测试同一口径：小框优先于大框（大框只是背景），面积相同时取度数更高的
    candidates.sort((a, b) => {
      if (a.parent !== b.parent) return a.parent ? 1 : -1
      if (a.area !== b.area) return a.area - b.area
      return b.degree - a.degree
    })
    return candidates[0].node.id()
  }

  /**
   * 某个端口在容器坐标（渲染坐标）下的落点。
   * 端口取方框的边中点：`n/e/s/w` 与 `PORT_OFFSET` 一一对应。
   */
  portPoint(id: string, port: ArrowPort): Position | null {
    const box = this.renderedBox(id)
    if (!box) return null
    const offset = PORT_OFFSET[port]
    return {
      x: box.x1 + (box.x2 - box.x1) * offset.fx,
      y: box.y1 + (box.y2 - box.y1) * offset.fy,
    }
  }

  /**
   * 连线拖动时的**智能吸附**：给一个容器坐标，返回应当吸附的目标。
   *
   * 命中口径分两级，先近后远：
   *   1. 指针落在某个端口附近（PORT_SNAP_RADIUS_PX 内）→ 吸到那个端口；
   *   2. 否则命中指针下方的节点 → 吸到「离起点最近的那条边」（port 为 null，
   *      由样式表的 outside-to-node 自动选边）。
   * 都命中不到则返回 null（此时不该建立关系）。
   *
   * `excludeIds` 用来排掉源节点自身与它的子孙（大框不能连自己）。
   *
   * **容器（大框）永远不是吸附目标**：关系只发生在模块之间（层带 / S09 框 / E lane 是纯分组），
   * 所以端口扫描与节点命中都跳过 compound 父节点。
   */
  snapTarget(point: Position, excludeIds: ReadonlySet<string> = new Set()): PortSnap | null {
    const cy = this.cy
    if (!cy) return null

    // 1) 端口优先：端口在方框边界上，指针常常正好停在框外一点点
    const portHits: { id: string; port: ArrowPort; point: Position; distance: number }[] = []
    cy.nodes().forEach((node) => {
      if (!node.visible() || excludeIds.has(node.id()) || node.isParent()) return
      const box = node.renderedBoundingBox({ includeLabels: false, includeOverlays: false })
      // 先做一个粗筛：离方框太远的节点不必算端口
      const outside =
        point.x < box.x1 - PORT_SNAP_RADIUS_PX ||
        point.x > box.x2 + PORT_SNAP_RADIUS_PX ||
        point.y < box.y1 - PORT_SNAP_RADIUS_PX ||
        point.y > box.y2 + PORT_SNAP_RADIUS_PX
      if (outside) return
      ;(Object.keys(PORT_OFFSET) as ArrowPort[]).forEach((port) => {
        const candidate = this.portPoint(node.id(), port)
        if (!candidate) return
        const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y)
        if (distance > PORT_SNAP_RADIUS_PX) return
        portHits.push({ id: node.id(), port, point: candidate, distance })
      })
    })
    if (portHits.length) {
      portHits.sort((a, b) => a.distance - b.distance)
      const hit = portHits[0]
      return { id: hit.id, port: hit.port, point: hit.point, snapped: true }
    }

    // 2) 退一档：按节点命中（与引用拖放同一口径）；大框同样跳过
    const id = this.nodeAt(point)
    if (!id || excludeIds.has(id)) return null
    const hit = cy.getElementById(id)
    if (hit.length && hit.isParent()) return null
    const center = this.renderedPosition(id)
    if (!center) return null
    return { id, port: null, point: center, snapped: false }
  }

  /**
   * 某个模型坐标落在哪个大框里（用于「拖进大框即建立层级」）。
   *
   * 取**最深的那个**（嵌套时以最内层为准），并且要求点离开框边有 `CONTAINER_DROP_INSET_PX`
   * 的余量——贴着边划过不该算入框，否则拖到大框旁边就会被吞进去。
   */
  containerAt(modelPoint: Position, excludeIds: readonly string[] = []): { id: string } | null {
    const cy = this.cy
    if (!cy) return null
    const excluded = new Set(excludeIds)
    const candidates: { id: string; depth: number }[] = []
    cy.nodes().forEach((node) => {
      if (!node.isParent() || !node.visible() || excluded.has(node.id())) return
      const box = node.boundingBox({ includeLabels: false, includeOverlays: false })
      const inset = CONTAINER_DROP_INSET_PX / (cy.zoom() || 1)
      if (
        modelPoint.x < box.x1 + inset ||
        modelPoint.x > box.x2 - inset ||
        modelPoint.y < box.y1 + inset ||
        modelPoint.y > box.y2 - inset
      ) {
        return
      }
      candidates.push({ id: node.id(), depth: node.ancestors().length })
    })
    if (!candidates.length) return null
    candidates.sort((a, b) => b.depth - a.depth)
    return { id: candidates[0].id }
  }

  /** 供连通性预览使用：返回节点的模型坐标 */
  modelPosition(id: string): Position | null {
    const cy = this.cy
    if (!cy) return null
    const element = cy.getElementById(id)
    if (!element.length) return null
    const position = element.position()
    return { x: position.x, y: position.y }
  }

  modelToRendered(point: Position): Position | null {
    const cy = this.cy
    if (!cy) return null
    const pan = cy.pan()
    return { x: point.x * cy.zoom() + pan.x, y: point.y * cy.zoom() + pan.y }
  }

  resize() {
    this.cy?.resize()
    // 容器尺寸变了，渲染坐标与可见标签数都会变
    this.scheduleLabels()
  }

  destroy() {
    this.stopPulse()
    this.cancelLabels()
    if (this.containerEl && this.dblclickHandler) {
      this.containerEl.removeEventListener('dblclick', this.dblclickHandler)
    }
    if (this.containerEl && this.tagGuardHandler) {
      this.containerEl.removeEventListener('pointerdown', this.tagGuardHandler, true)
    }
    this.containerEl = null
    this.dblclickHandler = null
    this.tagGuardHandler = null
    this.activeTagIds = []
    this.stopBreathe()
    this.hoveredId = null
    this.shownLabels = new Set<string>()
    this.pinnedIds = new Set<string>()
    this.placedIds = new Set<string>()
    this.layoutInFlight = false
    this.cy?.destroy()
    this.cy = null
  }
}
