import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { toast } from 'sonner'
import { Link2, Loader2, MousePointer2, Tags, X } from 'lucide-react'
import { GraphRenderer, PORT_SNAP_RADIUS_PX, type VisibilityInfo } from '../graph/cytoscapeSetup'
import type { LayoutKind } from '../graph/layout'
import { useGraphStore } from '../state/graphStore'
import { useGraphSource } from '../graph/graphSource'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import {
  CrossRedshiftFeedbackToggle,
  EmptyState,
  GraphLegend,
  ZoomControls,
  type CrossRedshiftFeedbackState,
} from './CanvasOverlays'
import { ContextMenu, type ContextMenuState } from './ContextMenu'
import { cn } from '../lib/utils'
import {
  ARROW_PORTS,
  NODE_TYPE_ORDER,
  type ArrowPort,
  type GraphRef,
  type NodePosition,
  type NodeType,
} from '../lib/types'
import type { TopicVisibility } from '../lib/topics'
import { SNAP_COLOR, TAG_DOT_COLOR, TAG_DOT_INSET, TAG_DOT_SIZE } from '../graph/palette'

/**
 * 「有子图的模块」上粒子的落点：写死的 5 个位置 + 错开的延迟。
 *
 * 刻意不用随机数：同一模块每次重渲染粒子必须落在同一处，否则平移一下整块粒子就会「跳一下」。
 * 位置都在框内偏下，粒子缓缓上浮淡出——干净的余韵，不是烟花。
 */
const PARTICLE_SPOTS = [
  { x: 16, y: 72, delay: 0, drift: -5, duration: 3.4 },
  { x: 34, y: 78, delay: 0.9, drift: 4, duration: 2.9 },
  { x: 55, y: 74, delay: 1.7, drift: -3, duration: 3.6 },
  { x: 72, y: 66, delay: 2.5, drift: 6, duration: 3.1 },
  { x: 86, y: 54, delay: 3.2, drift: -4, duration: 3.3 },
  { x: 46, y: 50, delay: 1.3, drift: 3, duration: 2.7 },
]

/** 暴露给外层的画布命令式接口（供快捷键与状态条调用）；按标签页各持一份 */
export interface CanvasApi {
  fit: () => void
  relayout: () => void
  zoomIn: () => void
  zoomOut: () => void
}

/** 浮层按钮尺寸（与 h-6 w-6 一致），用于夹紧计算 */
const OVERLAY_SIZE = { w: 24, h: 24 }
/** 浮层与画布边缘的最小留白 */
const OVERLAY_GAP = 6
/** 缩放按钮 / 快捷键的步长（原先 0.18 偏肉，实测 0.25 更跟手） */
const ZOOM_STEP = 0.25

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** 连线拖拽在两端的吸附结果：端口为 null 表示「吸到节点、由箭头自动选边」 */
export interface ArrowPorts {
  sourcePort: ArrowPort | null
  targetPort: ArrowPort | null
}

/**
 * 某个节点上离给定屏幕点最近的端口（在吸附半径内才算）。
 * 手柄挂在方框右边，所以源端几乎总是 `e`（右）——这正是「智能吸附」在起作用。
 */
function nearestPortOf(
  renderer: GraphRenderer,
  nodeId: string,
  point: { x: number; y: number },
): { port: ArrowPort | null; point: { x: number; y: number } } {
  let best: { port: ArrowPort; point: { x: number; y: number }; distance: number } | null = null
  ARROW_PORTS.forEach((port) => {
    const candidate = renderer.portPoint(nodeId, port)
    if (!candidate) return
    const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y)
    if (distance > PORT_SNAP_RADIUS_PX) return
    if (!best || distance < best.distance) best = { port, point: candidate, distance }
  })
  const hit = best as { port: ArrowPort; point: { x: number; y: number } } | null
  if (hit) return { port: hit.port, point: hit.point }
  const center = renderer.renderedPosition(nodeId)
  return { port: null, point: center ?? { x: point.x, y: point.y } }
}

/**
 * 把节点旁的浮层按钮夹进画布矩形：右侧放不下就翻到另一侧，再放不下就收在边界内侧。
 * `anchor` 是用于镜像的参考点（「节点 + 标签」合围盒的中心），
 * 这样翻边后按钮整体落在合围盒之外，不会从右边压字改成左边压字。
 * 参考点已经离开视野时返回 null（不绘制），避免按钮贴在边界指向画布外的空白。
 */
function placeOverlay(
  anchor: { x: number; y: number },
  desired: { x: number; y: number },
  viewport: { w: number; h: number },
): { bx: number; by: number } | null {
  if (viewport.w <= 0 || viewport.h <= 0) return null
  if (anchor.x < 0 || anchor.y < 0 || anchor.x > viewport.w || anchor.y > viewport.h) return null
  const maxX = Math.max(OVERLAY_GAP, viewport.w - OVERLAY_SIZE.w - OVERLAY_GAP)
  const maxY = Math.max(OVERLAY_GAP, viewport.h - OVERLAY_SIZE.h - OVERLAY_GAP)
  let x = desired.x
  if (x + OVERLAY_SIZE.w > viewport.w - OVERLAY_GAP) {
    // 以参考点镜像到另一侧；两侧都放不下则保持原侧，交给下面的夹紧
    const mirrored = 2 * anchor.x - desired.x - OVERLAY_SIZE.w
    if (mirrored >= OVERLAY_GAP) x = mirrored
  }
  return { bx: clamp(x, OVERLAY_GAP, maxX), by: clamp(desired.y, OVERLAY_GAP, maxY) }
}

export interface GraphCanvasProps {
  /** 标签页焦点：null = 主图；否则是某个模块的 id。渲染器实例的可见集由它静态决定 */
  focusId: string | null
  /**
   * 标签口径（缺省 `true`）：有子图的模块用**当前子树叶子并集**（画布页，与属性面板同一份）；
   * 物理链页传 `false` 照读生成物里烘好的那份（见 `lib/tagEdit.ts` 的 `tagDisplayOf`）。
   * 只影响红点与命中，不改任何数据。
   */
  tagUnion?: boolean
  /** 是否当前激活的标签页：隐藏标签页（display:none）不取景、不重排，激活时只需 resize */
  active: boolean
  ready: boolean
  layout: LayoutKind
  connectSource: string | null
  refDragPayload: GraphRef | null
  /** 当前可见集（成员 + 层级父级）；null 表示不做话题过滤（旧图 / 骨架视图） */
  topicFilter: TopicVisibility | null
  /** 注册表非空且全部话题都被关闭：画布给出恢复入口，而不是一片空白 */
  topicsAllClosed?: boolean
  onEnableAllTopics?: () => void
  /** 任一弹层 / 阅读抽屉是否打开：打开期间不绘制画布浮层（会透过半透明面板显影） */
  overlayOpen?: boolean
  /**
   * 跨红移反馈开关（可选）。不传 = 浮层上不出现这个控件、渲染器恒为"画"——画布页走的就是这条路，
   * 它那套行为因此逐字不变。传进来时状态由页面持有（本机偏好），这里只做两件事：
   * 把"画不画"推给渲染器（切类名，不重建元素），把控件画在右上角那一列。
   */
  crossRedshiftFeedback?: CrossRedshiftFeedbackState
  /** 可见集指纹：只有它变化时才重新套用过滤并取景，普通编辑不会让画布跳动 */
  topicKey: string
  /** 每个标签页一份 CanvasApi：激活 / 卸载时登记与注销 */
  registerApi?: (api: CanvasApi | null) => void
  onZoomChange?: (zoom: number) => void
  /** 可见节点数变化时上报，供状态条与工具条显示 */
  onVisibilityChange?: (info: VisibilityInfo) => void
  onLayoutChange: (kind: LayoutKind) => void
  /** 双击模块 / 右键「进入子图」：打开该模块的子图标签页 */
  onEnterSubgraph: (nodeId: string) => void
  /** 点中节点左上角的标签红点：选中该节点并在属性面板展开这个标签的明细 */
  onOpenTagDetail: (nodeId: string, tagId: string) => void
  onConnectComplete: (sourceId: string, targetId: string | null) => void
  onConnectCancel: () => void
  onAddRefToNode: (nodeId: string, ref: GraphRef) => void
  /** 把节点拖进 / 拖出大框：containerId 为 null 表示落在空白处（归属由上层按当前标签页裁定） */
  onNodeReparent?: (nodeId: string, containerId: string | null) => void
  onRequestCreateNode: (position: NodePosition | null) => void
  /** ports 是拖线时吸附到的端口（null = 自动选边），由 EdgeDialog 一并落盘 */
  onRequestCreateEdge: (sourceId: string, targetId: string, ports?: ArrowPorts) => void
  onRequestEditNode: (nodeId: string) => void
  onRequestEditEdge: (edgeId: string) => void
  onRequestDeleteNode: (nodeId: string) => void
  onRequestDeleteEdge: (edgeId: string) => void
  /** 新建大框并放入该节点 */
  onCreateGroupWithNode?: (nodeId: string) => void
  /** 在画布坐标处新建空大框；containerId 是落点处的大框（没有则归当前标签页焦点） */
  onCreateGroupAt?: (position: NodePosition, containerId: string | null) => void
  /** 把节点移出它所在的大框（上提一层） */
  onDetachFromGroup?: (nodeId: string) => void
  onFocusLibrary: () => void
  onOpenImport: () => void
  onPositionsSettled: (positions: Record<string, NodePosition>) => void
  onPositionEditStart: () => void
}

export function GraphCanvas(props: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<GraphRenderer | null>(null)
  const relayoutRef = useRef<() => void>(() => {})
  const propsRef = useRef(props)
  propsRef.current = props

  /**
   * **图数据源**：模板只认这个接口，不认某个单例 store。
   * 没提供 provider 时它退回共享 store（画布页行为逐字不变）；物理链页提供了自己的
   * 数据源（生成物里的图 + 本地选中/标签），所以两张图各用各的数据。
   */
  const source = useGraphSource()
  const { graph, selection, hoveredNodeId, activeTagIds, select, setHovered, toggleHiddenRelations } = source
  /** 回调里要读当前数据源：用 ref 拿最新值，避免把 source 塞进依赖数组 */
  const sourceRef = useRef(source)
  sourceRef.current = source
  /**
   * 按模块收起的关系：订阅**指纹字符串**而不是数组本身——数组每次现算都是新引用，
   * 会让下面的 effect 在无关重渲染里反复触发。口径与 `props.topicKey` 一致。
   */
  const hiddenRelationKey = source.hiddenRelationIds.join(',')
  /** 跨红移回流要不要画：没传开关的页面恒为「画」（不传就没有这类边的说法，行为与改动前一致） */
  const feedbackEnabled = props.crossRedshiftFeedback?.enabled ?? true

  const [zoom, setZoom] = useState(1)
  /** x/y 是节点中心的渲染坐标（连线预览的起点），bx/by 是夹紧后的按钮位置 */
  const [handle, setHandle] = useState<{ id: string; x: number; y: number; bx: number; by: number } | null>(null)
  /**
   * 全局标签红点（DOM 徽标）：勾选标签后，命中的模块左上角一个小红点。
   * 由渲染器算渲染坐标（`tagMarks()`），这里只负责按坐标铺按钮——见 refreshHandle。
   */
  const [tagMarks, setTagMarks] = useState<Array<{ nodeId: string; tagId: string; x: number; y: number; zoom: number }>>([])
  /**
   * 「有子图的模块」的渲染位置：DOM 覆盖层上画呼吸光晕 + 粒子（见 index.css 的 subgraph-* 规则）。
   * 与红点徽标共用同一套刷新时机（pan/zoom/resize/布局/数据变化）。
   */
  const [subgraphMarks, setSubgraphMarks] = useState<Array<{ nodeId: string; x: number; y: number; w: number; h: number }>>([])
  const [linkPreview, setLinkPreview] = useState<{
    x1: number
    y1: number
    x2: number
    y2: number
    /** 终点是否吸到了端口（true 时画一个实心圈，提示「松手就落在这个端点上」） */
    snapped: boolean
  } | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  /** 常显边标签：产物名只写在边标签上，需要整读数据流时打开 */
  const [showEdgeLabels, setShowEdgeLabels] = useState(false)

  const connectSource = props.connectSource
  /** 由渲染器挂载处赋值的刷新入口，供浮层自身的指针事件即时重算 */
  const refreshRef = useRef<() => void>(() => {})
  /** 上一次生效的排布方案：用来区分「首次挂载」与「用户刚换了方案」 */
  const layoutKindRef = useRef(props.layout)

  /* ---------------- 渲染器挂载 ---------------- */
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const renderer = new GraphRenderer(
      {
        onSelectNode: (id) => {
          const source = propsRef.current.connectSource
          if (source && source !== id) {
            // 大框是容器：关系只发生在模块之间，点容器不建立关系（提示后退出连线模式）
            const target = sourceRef.current.graph.nodes.find((node) => node.id === id)
            if (target?.type === 'group') {
              toast.info('大框是容器，不参与关系；请连到模块上')
              propsRef.current.onConnectCancel()
              return
            }
            propsRef.current.onConnectComplete(source, id)
            return
          }
          // 单击一律是选中（模块、容器、叶子都如此）；进入子图只走双击与属性页入口
          select('node', id)
          setMenu(null)
        },
        onSelectEdge: (id) => {
          select('edge', id)
          setMenu(null)
        },
        onClearSelection: () => {
          if (propsRef.current.connectSource) propsRef.current.onConnectCancel()
          select(null, null)
          setMenu(null)
        },
        onEnterSubgraph: (id) => propsRef.current.onEnterSubgraph(id),
        // 点红点：选中该节点（面板才有内容）并把要展开的标签报给上层
        onOpenTagDetail: (nodeId, tagId) => {
          select('node', nodeId)
          propsRef.current.onOpenTagDetail(nodeId, tagId)
        },
        onNodeDragStart: () => propsRef.current.onPositionEditStart(),
        onNodeDragEnd: (id, position) => {
          propsRef.current.onPositionsSettled({ [id]: { x: Math.round(position.x), y: Math.round(position.y) } })
        },
        // 拖进大框 = 建立层级：渲染器只给几何判定结果，落盘由上层负责
        onNodeReparent: (id, containerId) => {
          const node = sourceRef.current.graph.nodes.find((item) => item.id === id)
          // 已经是这个父节点时不必再写一次（渲染器已挡一层，这里防数据与画布短暂不同步）
          if (!node || (node.parent ?? null) === containerId) return
          propsRef.current.onNodeReparent?.(id, containerId)
        },
        onHoverNode: (id) => setHovered(id),
        onNodeContextMenu: (id, client) => {
          const state = sourceRef.current
          const node = state.graph.nodes.find((item) => item.id === id)
          const childCount = state.graph.nodes.filter((item) => item.parent === id).length
          setMenu({
            kind: 'node',
            id,
            x: client.x,
            y: client.y,
            childCount,
            isContainer: node?.type === 'group',
            parentId: node?.parent ?? null,
            // 关系是否已收起：决定菜单显示「隐藏它的关系」还是「显示它的关系」
            relationsHidden: state.hiddenRelationIds.includes(id),
          })
        },
        onEdgeContextMenu: (id, client) => setMenu({ kind: 'edge', id, x: client.x, y: client.y }),
        onCanvasContextMenu: (client, model) =>
          setMenu({ kind: 'canvas', x: client.x, y: client.y, model: model ?? undefined }),
        onZoomChange: (value) => {
          setZoom(value)
          if (propsRef.current.active) propsRef.current.onZoomChange?.(value)
        },
        onLayoutSettled: (positions) => propsRef.current.onPositionsSettled(positions),
        onLayoutError: (error) => {
          // 布局失败不能静默：此前会表现为「点了按钮没反应、画面像没渲染」
          toast.error('布局未能完成', {
            id: 'layout-error',
            description: `${error instanceof Error ? error.message : String(error)}；已保留现有节点位置`,
            duration: 7000,
          })
          renderer.fit()
        },
        onVisibilityChange: (info) => {
          if (propsRef.current.active) propsRef.current.onVisibilityChange?.(info)
        },
      },
      { focusId: props.focusId, tagUnion: props.tagUnion },
    )

    renderer.mount(container)
    rendererRef.current = renderer

    /**
     * 调试句柄：无头探针 / 手工排查时读激活画布的 cy 实例（只读，不改任何行为）。
     * 每个标签页各挂一份，后挂的覆盖先挂的——探针只关心「当前这张」，够用了。
     */
    ;(window as unknown as Record<string, unknown>).__GRAPHIFY_DEBUG__ = {
      getActiveCy: () => rendererRef.current?.core ?? null,
      getRenderer: () => rendererRef.current,
      getState: () => useGraphStore.getState(),
    }

    const refreshHandle = () => {
      const current = rendererRef.current
      if (!current) return
      const state = useGraphStore.getState()
      const overlayOpen = propsRef.current.overlayOpen === true
      // 弹层/抽屉打开、尚未就绪、正在连线时都不画浮层
      const allowed = propsRef.current.ready && !overlayOpen && !propsRef.current.connectSource
      const viewport = { w: current.core?.width() ?? 0, h: current.core?.height() ?? 0 }

      // 连线手柄：只在选中**模块**（非大框）时出现——大框是容器，不参与关系
      const selected = state.selection.kind === 'node' && state.selection.id
        ? state.graph.nodes.find((node) => node.id === state.selection.id)
        : null
      if (allowed && selected && selected.type !== 'group') {
        const position = current.renderedPosition(selected.id)
        // 落点按「节点 + 标签」合围盒算：方框变宽后按中心偏移的固定像素会把手柄放进框里
        const box = current.renderedBox(selected.id)
        const placed =
          box && position
            ? placeOverlay(
                { x: (box.x1 + box.x2) / 2, y: position.y },
                { x: box.x2 + OVERLAY_GAP, y: position.y - OVERLAY_SIZE.h / 2 },
                viewport,
              )
            : null
        setHandle(
          position && placed
            ? { id: selected.id, x: position.x, y: position.y, bx: placed.bx, by: placed.by }
            : null,
        )
      } else {
        setHandle(null)
      }

      /**
       * 红点徽标：与手柄同一套刷新时机（pan/zoom/resize/布局/数据变化都会走到这里）。
       * 位置有变化才换新数组，避免每个 pan 帧都重渲染一遍。
       */
      const marks = allowed ? current.tagMarks() : []
      const markKey = (list: typeof marks) =>
        list.map((mark) => `${mark.nodeId}:${mark.tagId}:${Math.round(mark.x)},${Math.round(mark.y)}`).join('|')
      setTagMarks((previous) => (markKey(previous) === markKey(marks) ? previous : marks))

      // 有子图的模块：呼吸光晕 + 粒子（同样只在位置变化时换新数组）
      const subMarks = allowed ? current.subgraphMarks() : []
      const subKey = (list: typeof subMarks) =>
        list.map((mark) => `${mark.nodeId}:${Math.round(mark.x)},${Math.round(mark.y)},${Math.round(mark.w)}`).join('|')
      setSubgraphMarks((previous) => (subKey(previous) === subKey(subMarks) ? previous : subMarks))
      // 呼吸：这些模块自己的尺寸周期性地膨胀收缩（没有这类模块时渲染器会立刻停掉动画循环）
      current.breatheNodes(subMarks.map((mark) => mark.nodeId))
    }
    refreshRef.current = refreshHandle

    const handleTick = () => requestAnimationFrame(refreshHandle)
    const core = renderer.core
    core?.on('pan zoom resize position', handleTick)

    // 指针在画布上移动时即时重算浮层
    let pointerFrame: number | null = null
    const onPointerMove = () => {
      if (pointerFrame !== null) return
      pointerFrame = requestAnimationFrame(() => {
        pointerFrame = null
        refreshHandle()
      })
    }
    container.addEventListener('pointermove', onPointerMove)
    // 指针离开画布就清悬停态：核心的 mouseout 在「指针直接从节点移出容器」这条路径上不可靠
    const onPointerLeave = () => renderer.clearHover()
    container.addEventListener('pointerleave', onPointerLeave)

    const unsubscribe = useGraphStore.subscribe(handleTick)
    const resizeObserver = new ResizeObserver(() => {
      renderer.resize()
      refreshHandle()
    })
    resizeObserver.observe(container)

    refreshHandle()

    return () => {
      unsubscribe()
      core?.off('pan zoom resize position', handleTick)
      container.removeEventListener('pointermove', onPointerMove)
      container.removeEventListener('pointerleave', onPointerLeave)
      if (pointerFrame !== null) cancelAnimationFrame(pointerFrame)
      resizeObserver.disconnect()
      renderer.destroy()
      rendererRef.current = null
    }
    // focusId 在标签页生命周期内不变（标签页与焦点一一对应）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [select, setHovered])

  /* -------- 激活态：隐藏标签页 display:none，重新激活时必须 resize 才能恢复尺寸 -------- */
  useEffect(() => {
    if (!props.active) return
    const renderer = rendererRef.current
    if (!renderer) return
    renderer.resize()
    // 上报当前缩放：状态条与缩放控件显示的是「激活标签页」的视口
    const current = renderer.core?.zoom()
    if (typeof current === 'number') {
      setZoom(current)
      props.onZoomChange?.(current)
    }
    refreshRef.current()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.active])

  /* -------- 弹层 / 抽屉打开期间不绘制画布浮层（会透过半透明面板显影） -------- */
  useEffect(() => {
    if (!props.overlayOpen) return
    setLinkPreview(null)
    setDropTargetId(null)
    setMenu(null)
    refreshRef.current()
  }, [props.overlayOpen])

  /* ---------------- 数据同步 ---------------- */
  useEffect(() => {
    rendererRef.current?.sync(graph)
    /**
     * 数据变了，画布浮层要立刻跟上：红点徽标的数量/位置由渲染器在 `refreshHandle` 里算、
     * 由 DOM 层画。此前只在 pan/zoom/position 事件里重算，于是「改完数据得动一下鼠标才出现徽标」——
     * 这里补一次，不再依赖指针移动。
     */
    refreshRef.current()
  }, [graph])

  /* ---------------- 常显边标签（工具条开关） ---------------- */
  useEffect(() => {
    rendererRef.current?.core?.edges().toggleClass('show-label', showEdgeLabels)
  }, [showEdgeLabels, graph])

  /* ---------------- 跨红移回流（开关由页面传；不传则恒为「画」） ---------------- */
  useEffect(() => {
    rendererRef.current?.setFeedbackVisible(feedbackEnabled)
  }, [feedbackEnabled, graph])

  /**
   * 就绪后补一次浮层刷新。
   *
   * 浮层（连线手柄、标签红点、子图光晕）在 `ready` 之前一律不画，
   * 而数据可能比 `ready` 先到——那种顺序下徽标要等到下一次平移/缩放才出现。
   * 这里在就绪瞬间补算一次，避免「刚打开时要动一下鼠标才看到徽标」。
   */
  useEffect(() => {
    if (!props.ready) return
    refreshRef.current()
  }, [props.ready])

  /* ---------------- 全局标签：勾选变了就重算红点 ---------------- */
  useEffect(() => {
    rendererRef.current?.setActiveTags(activeTagIds)
    // 勾选状态变了，红点徽标要立刻亮/灭（同样不必等指针移动）
    refreshRef.current()
  }, [activeTagIds, graph])

  /** 图例只列当前图谱出现的要素种类 */
  const usedTypes = useMemo<NodeType[]>(
    () => NODE_TYPE_ORDER.filter((type) => graph.nodes.some((node) => node.type === type)),
    [graph.nodes],
  )

  /* ---------------- 布局算法：切换后立刻重排一次 ---------------- */
  useEffect(() => {
    const renderer = rendererRef.current
    if (!renderer) return
    renderer.setLayoutKind(props.layout)
    // 首次挂载不重排：打开时的重排由 layoutIfPending 负责，避免重复布局与多余取景
    if (layoutKindRef.current === props.layout) return
    layoutKindRef.current = props.layout
    // 隐藏的标签页只记下布局方式、不重排：它的版面与视口都该原样留着
    if (!props.active) return
    // 选了排布方案就立刻排：用户等的是这次点按的结果，不是下一次改动
    renderer.runLayout(props.layout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.layout])

  /* -------- 话题过滤：只切可见性，不重建元素，因此节点坐标跨话题保持 -------- */
  const topicFilterRef = useRef(props.topicFilter)
  topicFilterRef.current = props.topicFilter
  useEffect(() => {
    const renderer = rendererRef.current
    if (!renderer) return
    // 返回 true 表示本次揭示出了「尚未排布过」的节点并已补一次重排（自带取景）
    const willPlace = renderer.setTopicFilter(topicFilterRef.current)
    // 打开图谱时按当前布局重排一次；此后切话题不做重排——只把视野对准新的可见集
    if (!willPlace && propsRef.current.active && !renderer.layoutIfPending()) renderer.fit()
    // 只用指纹作为触发条件：可见集没变时，普通编辑不应该让画布重新取景
  }, [props.topicKey])

  /* -------- 按模块收起的关系：只切连线可见性，不重建元素、不动坐标 -------- */
  useEffect(() => {
    // 集合留在渲染器上，因此这里只在它变化时推一次；sync() 之后规则仍然生效
    rendererRef.current?.setHiddenRelations(hiddenRelationKey ? hiddenRelationKey.split(',') : [])
  }, [hiddenRelationKey])

  /* ---------------- 对外暴露命令式接口（每标签页一份） ---------------- */
  useEffect(() => {
    if (!props.registerApi) return
    props.registerApi({
      fit: () => rendererRef.current?.fit(),
      relayout: () => relayoutRef.current(),
      zoomIn: () => rendererRef.current?.zoom(ZOOM_STEP),
      zoomOut: () => rendererRef.current?.zoom(-ZOOM_STEP),
    })
    return () => props.registerApi?.(null)
    // 只在挂载/卸载时登记一次：api 内部全部走 ref，不依赖当时的 props
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---------------- 选中态与脉冲 ---------------- */
  useEffect(() => {
    const renderer = rendererRef.current
    if (!renderer) return
    renderer.select({
      nodes: selection.kind === 'node' && selection.id ? [selection.id] : [],
      edges: selection.kind === 'edge' && selection.id ? [selection.id] : [],
    })
    renderer.clearTransientStyles()
    renderer.setPulseNode(selection.kind === 'node' ? selection.id : null)
  }, [selection.kind, selection.id, graph])

  /* ---------------- 悬停邻居高亮 ---------------- */
  useEffect(() => {
    const focusId = hoveredNodeId ?? (selection.kind === 'node' ? selection.id : null)
    rendererRef.current?.setFocus(focusId)
  }, [hoveredNodeId, selection.kind, selection.id])

  /* ---------------- 连线手柄拖拽（带端口智能吸附） ---------------- */
  const startHandleDrag = useCallback((event: React.PointerEvent) => {
    event.preventDefault()
    const renderer = rendererRef.current
    const container = containerRef.current
    if (!renderer || !container || !handle) return
    const rect = container.getBoundingClientRect()
    const sourceId = handle.id
    // 源端也吸：手柄挂在框右侧，通常吸到右端口（e），于是箭头从右边出发而不是框心
    const origin = nearestPortOf(renderer, sourceId, { x: handle.x, y: handle.y })
    // 只排除源节点自己；连到自己的大框（父子）是合法操作
    const exclude = new Set<string>([sourceId])

    const move = (moveEvent: PointerEvent) => {
      const point = { x: moveEvent.clientX - rect.left, y: moveEvent.clientY - rect.top }
      const snap = renderer.snapTarget(point, exclude)
      // 吸附成功时预览线终点直接落到端口/节点上：所见即松手后的结果
      setLinkPreview({
        x1: origin.point.x,
        y1: origin.point.y,
        x2: snap ? snap.point.x : point.x,
        y2: snap ? snap.point.y : point.y,
        snapped: Boolean(snap?.snapped),
      })
      setDropTargetId(snap?.id ?? null)
    }

    const up = (upEvent: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const point = { x: upEvent.clientX - rect.left, y: upEvent.clientY - rect.top }
      const snap = renderer.snapTarget(point, exclude)
      setLinkPreview(null)
      setDropTargetId(null)
      if (snap) {
        propsRef.current.onRequestCreateEdge(sourceId, snap.id, {
          sourcePort: origin.port,
          targetPort: snap.port,
        })
      } else {
        toast.info('连线已取消：请把线拖到另一个节点上')
      }
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }, [handle])

  /**
   * 吸附目标的高亮：`.connect-target` 类由样式表定义（吸附色描边 + 光晕），
   * 拖线或拖引用时命中哪个节点，那个节点就亮起来——比在浮层里写一句提示直观得多。
   *
   * **大框永远不亮**：它是纯分组背景，整框泛青色又扎眼又没有信息量
   * （与 snapTarget「容器不是吸附目标」同一条原则）。
   */
  useEffect(() => {
    const cy = rendererRef.current?.core
    if (!cy) return
    cy.nodes().removeClass('connect-target')
    if (!dropTargetId) return
    const element = cy.getElementById(dropTargetId)
    if (element.length && !element.isParent()) element.addClass('connect-target')
  }, [dropTargetId])

  /* ---------------- 引用拖放 ---------------- */
  const handleDragOver = (event: React.DragEvent) => {
    if (!props.refDragPayload) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'link'
    const container = containerRef.current
    const renderer = rendererRef.current
    if (!container || !renderer) return
    const rect = container.getBoundingClientRect()
    const targetId = renderer.nodeAt({ x: event.clientX - rect.left, y: event.clientY - rect.top })
    if (targetId !== dropTargetId) setDropTargetId(targetId)
  }

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault()
    const payload = props.refDragPayload
    const container = containerRef.current
    const renderer = rendererRef.current
    setDropTargetId(null)
    if (!payload || !container || !renderer) return
    const rect = container.getBoundingClientRect()
    const targetId = renderer.nodeAt({ x: event.clientX - rect.left, y: event.clientY - rect.top })
    const element = targetId ? renderer.core?.getElementById(targetId) : null
    // 大框不接引用（它是纯分组）；ref 卡挂到本体上——同名模块永远是同一个实例
    if (element?.length && !element.isParent()) {
      props.onAddRefToNode((element.data('refId') as string | undefined) ?? targetId!, payload)
    } else {
      toast.info('请把引用拖到某个节点上')
    }
  }

  const relayout = () => {
    const renderer = rendererRef.current
    if (!renderer) return
    renderer.runLayout(props.layout)
    toast.success('已整理当前视图')
  }
  relayoutRef.current = relayout

  // 取消连线：Esc
  useEffect(() => {
    if (!connectSource) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') props.onConnectCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [connectSource, props])

  const isEmpty = graph.nodes.length === 0

  return (
    /*
      overflow-hidden：浮层按钮经 placeOverlay 夹紧后本就在画布内，这里再兜一层，
      保证贴边的按钮也绝不会画到两侧面板上。
      不加 isolate：画布内的右键菜单是 fixed z-[80]，一旦这里形成层叠上下文，
      它会被 DOM 靠后的详情面板盖住（面板与菜单重叠时菜单看不见）。
    */
    <div
      className="relative min-h-0 min-w-0 flex-1 overflow-hidden"
      style={{ display: props.active ? undefined : 'none' }}
      data-tab-focus={props.focusId ?? 'main'}
    >
      <div
        ref={containerRef}
        className={cn('canvas-grid absolute inset-0', connectSource && 'cursor-crosshair')}
        onDragOver={handleDragOver}
        onDragLeave={() => setDropTargetId(null)}
        onDrop={handleDrop}
        data-canvas="true"
      />

      {/*
        全局标签红点：DOM 徽标（真按钮）。
        点它 = 选中该模块 + 在右侧属性面板展开这个标签的明细；
        指针按下时截断，免得 cytoscape 把这一下当成拖节点。
      */}
      {tagMarks.map((mark) => (
        <button
          key={`${mark.nodeId}:${mark.tagId}`}
          type="button"
          aria-label="查看这个标签的明细"
          title="看这个标签的明细"
          className="absolute z-10 cursor-pointer rounded-full ring-2 ring-white transition-transform hover:scale-150"
          style={{
            left: mark.x + TAG_DOT_INSET,
            top: mark.y + TAG_DOT_INSET,
            width: TAG_DOT_SIZE,
            height: TAG_DOT_SIZE,
            backgroundColor: TAG_DOT_COLOR,
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            select('node', mark.nodeId)
            props.onOpenTagDetail(mark.nodeId, mark.tagId)
          }}
        />
      ))}

      {/*
        有子图的模块：呼吸光晕 + 粒子，提示「这里还能往下钻」。
        · 光晕与粒子是纯 CSS 动画（见 index.css 的 subgraph-*）；
        · 模块**自身**的膨胀收缩由渲染器的呼吸循环写行内宽高（pulseNodes）；
        · 光晕框往外多留 9px：模块膨胀 ±5% 时不会把光晕压在边框里；
        · 全部不抢指针事件；位置随平移/缩放刷新（与红点同一套机制）。
      */}
      {subgraphMarks.map((mark) => (
        <div
          key={mark.nodeId}
          aria-hidden="true"
          className="pointer-events-none absolute"
          style={{ left: mark.x - 9, top: mark.y - 9, width: mark.w + 18, height: mark.h + 18 }}
        >
          <span className="subgraph-halo absolute inset-0 rounded-[12px]" />
          {PARTICLE_SPOTS.map((spot, index) => (
            <span
              key={index}
              className="subgraph-particle"
              style={
                {
                  left: `${spot.x}%`,
                  top: `${spot.y}%`,
                  animationDelay: `${spot.delay}s`,
                  animationDuration: `${spot.duration}s`,
                  '--drift': `${spot.drift}px`,
                } as CSSProperties
              }
            />
          ))}
        </div>
      ))}

      {!props.ready ? (
        <div className="absolute inset-0 flex items-center justify-center bg-background/40 backdrop-blur-[1px]">
          <span className="flex items-center gap-2 text-micro text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            正在加载图谱…
          </span>
        </div>
      ) : null}

      {props.ready && isEmpty ? (
        <EmptyState
          onNewNode={() => props.onRequestCreateNode(null)}
          onOpenImport={props.onOpenImport}
          onFocusLibrary={props.onFocusLibrary}
        />
      ) : null}

      {/* 话题全部被关掉：给出可解释的说明与恢复入口（与「图谱本来就没节点」互斥） */}
      {props.ready && !isEmpty && props.topicsAllClosed ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="glass-panel pointer-events-auto flex w-[280px] flex-col items-center gap-2 rounded-lg px-4 py-3.5 text-center">
            <Tags className="h-4 w-4 text-amber-600" />
            <p className="text-micro font-medium text-foreground/90">当前没有显示任何话题节点</p>
            <p className="text-micro leading-relaxed text-muted-foreground">
              所有话题都被关掉了。重新打开至少一个话题，或点下面的按钮全部打开。
            </p>
            <Button size="sm" variant="secondary" onClick={props.onEnableAllTopics}>
              全选话题
            </Button>
          </div>
        </div>
      ) : null}

      {/* 连线预览：弹层打开期间同样不画（会透过半透明面板显影） */}
      {linkPreview && !props.overlayOpen ? (
        <svg className="pointer-events-none absolute inset-0 h-full w-full">
          <line
            x1={linkPreview.x1}
            y1={linkPreview.y1}
            x2={linkPreview.x2}
            y2={linkPreview.y2}
            stroke={SNAP_COLOR}
            strokeWidth="1.8"
            strokeDasharray="6 5"
          />
          {/* 吸到端口时改成「套环 + 实心点」：一眼能看出箭头会落在哪个端点上 */}
          {linkPreview.snapped ? (
            <>
              <circle cx={linkPreview.x2} cy={linkPreview.y2} r="6.5" fill="none" stroke={SNAP_COLOR} strokeWidth="2" />
              <circle cx={linkPreview.x2} cy={linkPreview.y2} r="2.8" fill={SNAP_COLOR} />
            </>
          ) : (
            <circle cx={linkPreview.x2} cy={linkPreview.y2} r="4" fill={SNAP_COLOR} />
          )}
        </svg>
      ) : null}

      {/* 连接手柄 */}
      {handle && props.ready && !connectSource && !props.overlayOpen ? (
        <button
          type="button"
          onPointerDown={startHandleDrag}
          style={{ left: handle.bx, top: handle.by }}
          className={cn(
            'absolute z-20 flex h-6 w-6 cursor-crosshair items-center justify-center rounded-full border border-cyan-500/50 bg-white/95 text-cyan-700 shadow-[0_2px_10px_-3px_rgba(8,145,178,0.45)] backdrop-blur-sm transition-transform duration-150 hover:scale-110',
            dropTargetId ? 'scale-110' : '',
          )}
          title="按住并拖到另一个节点即可建立关系"
          aria-label="拉出关系"
        >
          <Link2 className="h-3 w-3" />
        </button>
      ) : null}

      {/* 浮层：缩放与图例 */}
      <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          {connectSource ? (
            <div className="glass-panel pointer-events-auto flex animate-slide-up items-center gap-2 rounded-lg px-3 py-2 text-micro">
              <MousePointer2 className="h-3.5 w-3.5 text-cyan-700" />
              <span>
                点击目标节点以建立关系（源：
                <span className="text-foreground/90">
                  {graph.nodes.find((node) => node.id === connectSource)?.label ?? connectSource}
                </span>
                ）
              </span>
              <Button variant="ghost" size="icon-sm" onClick={props.onConnectCancel} aria-label="取消连线">
                <X className="h-3 w-3" />
              </Button>
            </div>
          ) : null}
          {dropTargetId ? (
            <Badge tone="primary" className="pointer-events-auto animate-fade-in">
              松开即可把引用挂到该节点
            </Badge>
          ) : null}
        </div>

        <div className="flex flex-col items-end gap-2">
          <ZoomControls
            zoom={zoom}
            onZoomIn={() => rendererRef.current?.zoom(ZOOM_STEP)}
            onZoomOut={() => rendererRef.current?.zoom(-ZOOM_STEP)}
            onFit={() => rendererRef.current?.fit()}
            onRelayout={relayout}
            showEdgeLabels={showEdgeLabels}
            onToggleEdgeLabels={() => setShowEdgeLabels((prev) => !prev)}
          />
          <CrossRedshiftFeedbackToggle state={props.crossRedshiftFeedback} />
          <GraphLegend compact types={usedTypes} />
        </div>
      </div>

      <ContextMenu
        state={menu}
        onClose={() => setMenu(null)}
        onEditNode={props.onRequestEditNode}
        onEditEdge={props.onRequestEditEdge}
        onDeleteNode={props.onRequestDeleteNode}
        onDeleteEdge={props.onRequestDeleteEdge}
        onConnectFrom={(id) => props.onConnectComplete(id, null)}
        onAddNodeAt={(position) => props.onRequestCreateNode(position)}
        onAddNodeFree={() => props.onRequestCreateNode(null)}
        onRelayout={relayout}
        onEnterSubgraph={props.onEnterSubgraph}
        onCreateGroupWithNode={props.onCreateGroupWithNode}
        onCreateGroupAt={(position) => {
          // 「在此处新建大框」：落点在哪个大框里就归哪个大框；空白处归当前标签页焦点
          const container = rendererRef.current?.containerAt(position) ?? null
          props.onCreateGroupAt?.(position, container?.id ?? props.focusId)
        }}
        onDetachFromGroup={props.onDetachFromGroup}
        onToggleRelations={toggleHiddenRelations}
      />
    </div>
  )
}
