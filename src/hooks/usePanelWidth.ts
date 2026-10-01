import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/** localStorage 命名空间：只存界面宽度偏好，绝不进入图谱数据或撤销栈 */
const STORAGE_KEY = 'graphify.panelWidth.v1'

/** 面板最小宽度：再窄就收起为细条 */
export const PANEL_MIN_WIDTH = 220
/** 面板最大宽度上限，避免超宽屏上拉出荒谬的宽度 */
export const PANEL_HARD_MAX_WIDTH = 720
/** 收起后的细条宽度 */
export const PANEL_RAIL_WIDTH = 36
/** 拖拽手柄宽度（与 ResizeHandle 的 w-2 一致） */
export const PANEL_HANDLE_WIDTH = 8
/** 三列行内的间距（与 App 的 gap-2 一致） */
export const PANEL_GAP = 8
/** 画布保底宽度 */
export const CANVAS_MIN_WIDTH = 320
/** 指针横向位移越过最小宽度这么多像素时，松手即收起 */
export const PANEL_COLLAPSE_SLACK = 48
/** 键盘步进（Shift 时加倍） */
export const PANEL_KEY_STEP = 16

export type PanelSide = 'left' | 'right'

export interface PanelWidthOptions {
  /** 本面板在存储里的键名，例如 'library' / 'inspector' */
  storageKey: string
  /** 手柄在面板的哪一侧：左侧面板手柄在右，右侧面板手柄在左 */
  side: PanelSide
  /** 默认宽度（双击手柄复位到此值） */
  defaultWidth: number
  minWidth?: number
  canvasMinWidth?: number
  /** 三列行容器的当前宽度，0 表示尚未测量 */
  containerWidth?: number
  /** 另一栏当前占用的宽度（不含手柄），未渲染时传 0 */
  peerWidth?: number
  /** 另一栏是否已渲染：决定额外的手柄与间距占位 */
  peerVisible?: boolean
}

export interface PanelWidthState {
  width: number
  collapsed: boolean
}

/**
 * 计算面板宽度上限：容器宽 − 另一栏占用 − 画布保底宽 − 手柄与间距占位。
 * 容器宽未知（0）时返回硬上限，不做夹紧。
 */
export function computePanelMaxWidth({
  containerWidth,
  peerWidth = 0,
  peerVisible = false,
  canvasMinWidth = CANVAS_MIN_WIDTH,
  hardMax = PANEL_HARD_MAX_WIDTH,
}: {
  containerWidth?: number
  peerWidth?: number
  peerVisible?: boolean
  canvasMinWidth?: number
  hardMax?: number
}): number {
  if (!containerWidth || containerWidth <= 0) return hardMax
  // 间距：两侧面板都在时 4 段，只有一侧时 2 段；手柄：自己那条 + 另一栏那条
  const gaps = (peerVisible ? 4 : 2) * PANEL_GAP
  const handles = PANEL_HANDLE_WIDTH * (peerVisible ? 2 : 1)
  const reserved = gaps + handles + canvasMinWidth + (peerVisible ? peerWidth : 0)
  const room = containerWidth - reserved
  return Math.max(0, Math.min(hardMax, room))
}

function clamp(value: number, lower: number, upper: number): number {
  const ceiling = Math.max(lower, upper)
  return Math.min(Math.max(value, lower), ceiling)
}

function readStoredState(storageKey: string): PanelWidthState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const entry = (parsed as Record<string, unknown>)[storageKey]
    if (!entry || typeof entry !== 'object') return null
    const { width, collapsed } = entry as { width?: unknown; collapsed?: unknown }
    if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) return null
    return { width: Math.round(width), collapsed: collapsed === true }
  } catch {
    // 隐私模式、禁用存储或数据损坏：一律降级为默认值，不抛错
    return null
  }
}

function writeStoredState(storageKey: string, state: PanelWidthState): void {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed: Record<string, unknown> = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    parsed[storageKey] = state
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed))
  } catch {
    // 写失败只影响「下次打开的记忆」，不影响本次会话
  }
}

/**
 * 面板宽度与收起状态：拖拽（Pointer Events）、键盘微调、双击复位，
 * 并把结果记到 localStorage（拖拽结束才落盘一次）。
 */
export function usePanelWidth({
  storageKey,
  side,
  defaultWidth,
  minWidth = PANEL_MIN_WIDTH,
  canvasMinWidth = CANVAS_MIN_WIDTH,
  containerWidth,
  peerWidth = 0,
  peerVisible = false,
}: PanelWidthOptions) {
  const [state, setState] = useState<PanelWidthState>(() => {
    const stored = readStoredState(storageKey)
    return stored ?? { width: defaultWidth, collapsed: false }
  })
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startWidth: number
    pendingCollapse: boolean
    moved: boolean
  } | null>(null)
  // 拖拽/键盘回调里需要读到最新宽度，避免闭包拿到旧值
  const stateRef = useRef(state)
  stateRef.current = state

  const maxWidth = useMemo(
    () => computePanelMaxWidth({ containerWidth, peerWidth, peerVisible, canvasMinWidth, hardMax: PANEL_HARD_MAX_WIDTH }),
    [canvasMinWidth, containerWidth, peerVisible, peerWidth],
  )

  // 夹紧在 effect 里做：容器变小或另一栏变宽时自动让位，不产生横向溢出
  useEffect(() => {
    if (state.collapsed) return
    if (maxWidth >= PANEL_HARD_MAX_WIDTH) return
    const next = clamp(state.width, minWidth, maxWidth)
    if (next !== state.width) setState({ width: next, collapsed: false })
  }, [maxWidth, minWidth, state.collapsed, state.width])

  const persist = useCallback(
    (next: PanelWidthState) => {
      setState(next)
      writeStoredState(storageKey, next)
    },
    [storageKey],
  )

  const setWidth = useCallback(
    (value: number) => {
      const next = clamp(value, minWidth, maxWidth)
      setState((prev) => (prev.collapsed ? { width: next, collapsed: false } : { ...prev, width: next }))
    },
    [maxWidth, minWidth],
  )

  const reset = useCallback(() => {
    persist({ width: clamp(defaultWidth, minWidth, maxWidth), collapsed: false })
  }, [defaultWidth, maxWidth, minWidth, persist])

  const collapse = useCallback(() => {
    persist({ width: stateRef.current.width, collapsed: true })
  }, [persist])

  const expand = useCallback(() => {
    persist({ width: clamp(defaultWidth, minWidth, maxWidth), collapsed: false })
  }, [defaultWidth, maxWidth, minWidth, persist])

  const toggleCollapsed = useCallback(() => {
    if (stateRef.current.collapsed) expand()
    else collapse()
  }, [collapse, expand])

  /* ---------------- 拖拽 ---------------- */

  const handleProps = useMemo(
    () => ({
      onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return
        // 收起状态下开始拖拽：先以默认宽度为起点展开
        const startWidth = stateRef.current.collapsed ? defaultWidth : stateRef.current.width
        event.currentTarget.setPointerCapture(event.pointerId)
        dragRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startWidth,
          pendingCollapse: false,
          moved: false,
        }
        setDragging(true)
        event.preventDefault()
      },
      onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current
        if (!drag || drag.pointerId !== event.pointerId) return
        // 左栏手柄往右移变宽，右栏手柄往左移变宽
        const delta = side === 'left' ? event.clientX - drag.startX : drag.startX - event.clientX
        if (Math.abs(delta) > 3) drag.moved = true
        const raw = drag.startWidth + delta
        drag.pendingCollapse = raw < minWidth - PANEL_COLLAPSE_SLACK
        setState(() => ({ width: clamp(raw, minWidth, maxWidth), collapsed: false }))
      },
      onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current
        if (!drag || drag.pointerId !== event.pointerId) return
        dragRef.current = null
        setDragging(false)
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId)
        }
        if (!drag.moved) return
        if (drag.pendingCollapse) {
          collapse()
          return
        }
        // 拖拽结束才落盘一次，避免每帧写 localStorage
        persist({ width: stateRef.current.width, collapsed: false })
      },
      onPointerCancel: (event: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current
        if (!drag || drag.pointerId !== event.pointerId) return
        dragRef.current = null
        setDragging(false)
      },
      onDoubleClick: () => reset(),
      onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
        const step = event.shiftKey ? PANEL_KEY_STEP * 2 : PANEL_KEY_STEP
        // 方向键语义：把分隔条往那个方向推
        const grow = side === 'left' ? 'ArrowRight' : 'ArrowLeft'
        const shrink = side === 'left' ? 'ArrowLeft' : 'ArrowRight'

        if (event.key === grow) {
          event.preventDefault()
          if (stateRef.current.collapsed) expand()
          else setWidth(stateRef.current.width + step)
          return
        }
        if (event.key === shrink) {
          event.preventDefault()
          if (stateRef.current.collapsed) {
            expand()
            return
          }
          const next = stateRef.current.width - step
          if (next < minWidth) {
            // 键盘连续收窄到最小宽度以下：直接收起
            collapse()
            return
          }
          setWidth(next)
          return
        }
        if (event.key === 'Home') {
          event.preventDefault()
          setWidth(minWidth)
          return
        }
        if (event.key === 'End') {
          event.preventDefault()
          setWidth(maxWidth)
          return
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          toggleCollapsed()
        }
      },
    }),
    [collapse, defaultWidth, expand, maxWidth, minWidth, persist, reset, setWidth, side, toggleCollapsed],
  )

  return {
    width: state.width,
    collapsed: state.collapsed,
    dragging,
    maxWidth,
    handleProps,
    setWidth,
    reset,
    collapse,
    expand,
    toggleCollapsed,
  }
}
