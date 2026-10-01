import { useEffect, useRef } from 'react'
import {
  Boxes,
  CornerUpRight,
  Eye,
  EyeOff,
  Link2,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  Ungroup,
  Unlink,
} from 'lucide-react'
import { cn } from '../lib/utils'

export interface ContextMenuState {
  x: number
  y: number
  kind: 'node' | 'edge' | 'canvas'
  id?: string
  /** 画布坐标，用于在右键位置新建节点 / 大框 */
  model?: { x: number; y: number }
  /** 命中的节点的直系子节点数（模块 > 0 时显示「进入子图」） */
  childCount?: number
  /** 命中的节点是否是装饰容器（大框）：大框不可进入 */
  isContainer?: boolean
  /** 命中的节点当前所属的大框 id（null 表示顶层）——决定「移出大框」是否可用 */
  parentId?: string | null
  /** 命中的节点当前是否已收起关系：决定菜单显示「隐藏」还是「显示它的关系」 */
  relationsHidden?: boolean
}

interface ContextMenuProps {
  state: ContextMenuState | null
  onClose: () => void
  onEditNode?: (id: string) => void
  onEditEdge?: (id: string) => void
  onConnectFrom?: (id: string) => void
  onDeleteNode?: (id: string) => void
  onDeleteEdge?: (id: string) => void
  onAddNodeAt?: (position: { x: number; y: number }) => void
  onAddNodeFree?: () => void
  onRelayout?: () => void
  /** 进入该模块的子图标签页（与双击模块等效） */
  onEnterSubgraph?: (id: string) => void
  /** 新建大框并把该节点放进去（大框的大小自动包含该节点） */
  onCreateGroupWithNode?: (id: string) => void
  /** 在右键位置新建一个空大框 */
  onCreateGroupAt?: (position: { x: number; y: number }) => void
  /** 把该节点移出它所在的大框 */
  onDetachFromGroup?: (id: string) => void
  /** 收起 / 展开该模块的关系（纯视图动作：不删关系、不改数据、不动坐标） */
  onToggleRelations?: (id: string) => void
}

interface MenuItem {
  key: string
  label: string
  icon: React.ReactNode
  danger?: boolean
  onSelect: () => void
}

/** 画布右键菜单：按命中对象类型给出可用操作 */
export function ContextMenu({
  state,
  onClose,
  onEditNode,
  onEditEdge,
  onConnectFrom,
  onDeleteNode,
  onDeleteEdge,
  onAddNodeAt,
  onAddNodeFree,
  onRelayout,
  onEnterSubgraph,
  onCreateGroupWithNode,
  onCreateGroupAt,
  onDetachFromGroup,
  onToggleRelations,
}: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!state) return
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [state, onClose])

  if (!state) return null

  const items: MenuItem[] = []

  if (state.kind === 'node' && state.id) {
    const id = state.id
    const childCount = state.childCount ?? 0
    items.push({
      key: 'edit',
      label: '编辑节点属性',
      icon: <Pencil className="h-3.5 w-3.5" />,
      onSelect: () => onEditNode?.(id),
    })
    // 大框是容器，不参与关系：不提供「拉出关系」入口
    if (!state.isContainer) {
      items.push({
        key: 'connect',
        label: '从此节点拉出关系',
        icon: <Link2 className="h-3.5 w-3.5" />,
        onSelect: () => onConnectFrom?.(id),
      })
    }
    /**
     * 模块（非大框但有子节点）可以「进入子图」：与双击模块等效，在新标签页打开它的内容。
     * 装饰容器不提供这个入口——框里的内容本来就摊在框内。
     */
    if (childCount > 0 && !state.isContainer) {
      items.push({
        key: 'enter-subgraph',
        label: `进入子图 · ${childCount}`,
        icon: <CornerUpRight className="h-3.5 w-3.5" />,
        onSelect: () => onEnterSubgraph?.(id),
      })
    }
    /**
     * 大框相关：手动建立分组的两个入口。
     * 「新建大框并放入」是右键某节点时最顺手的动作（框会自己长到刚好包住它）；
     * 「移出大框」只在它确实在某个框里时出现。移入别的已有大框走拖拽或检查器里的下拉。
     */
    if (!state.isContainer) {
      items.push({
        key: 'group-with',
        label: '新建大框并放入此节点',
        icon: <Boxes className="h-3.5 w-3.5" />,
        onSelect: () => onCreateGroupWithNode?.(id),
      })
    }
    if (state.parentId) {
      items.push({
        key: 'ungroup',
        label: '移出大框',
        icon: <Ungroup className="h-3.5 w-3.5" />,
        onSelect: () => onDetachFromGroup?.(id),
      })
    }
    /**
     * 收起 / 展开这个模块的关系：连线一多（同一个通用过程在图上出现好几处）就先收起来，
     * 只看节点本身。**纯视图动作**：不删关系、不改数据、不动坐标，随时能再显示回来；
     * 状态记在本机浏览器里，刷新后保持。大框（容器）不参与关系，因此不提供该项。
     */
    if (!state.isContainer) {
      items.push({
        key: 'toggle-relations',
        label: state.relationsHidden ? '显示它的关系' : '隐藏它的关系',
        icon: state.relationsHidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />,
        onSelect: () => onToggleRelations?.(id),
      })
    }
    items.push({
      key: 'delete',
      label: '删除节点',
      icon: <Trash2 className="h-3.5 w-3.5" />,
      danger: true,
      onSelect: () => onDeleteNode?.(id),
    })
  } else if (state.kind === 'edge' && state.id) {
    const id = state.id
    items.push(
      { key: 'edit', label: '编辑关系', icon: <Pencil className="h-3.5 w-3.5" />, onSelect: () => onEditEdge?.(id) },
      { key: 'delete', label: '取消关系', icon: <Unlink className="h-3.5 w-3.5" />, danger: true, onSelect: () => onDeleteEdge?.(id) },
    )
  } else {
    items.push(
      {
        key: 'add-here',
        label: '在此处新建节点',
        icon: <Plus className="h-3.5 w-3.5" />,
        onSelect: () => (state.model ? onAddNodeAt?.(state.model) : onAddNodeFree?.()),
      },
      {
        key: 'add-group-here',
        label: '在此处新建大框',
        icon: <Boxes className="h-3.5 w-3.5" />,
        onSelect: () => (state.model ? onCreateGroupAt?.(state.model) : undefined),
      },
      { key: 'relayout', label: '整理布局', icon: <Sparkles className="h-3.5 w-3.5" />, onSelect: () => onRelayout?.() },
    )
  }

  return (
    <div
      ref={ref}
      className="glass-panel fixed z-[80] min-w-[190px] animate-in fade-in-0 zoom-in-95 rounded-lg p-1 text-tiny"
      style={{ left: Math.min(state.x, window.innerWidth - 210), top: Math.min(state.y, window.innerHeight - 190) }}
      role="menu"
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="menuitem"
          onClick={() => {
            item.onSelect()
            onClose()
          }}
          className={cn(
            'flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
            item.danger
              ? 'text-destructive hover:bg-destructive/12'
              : 'text-foreground/88 hover:bg-black/[0.06] hover:text-foreground',
          )}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  )
}
