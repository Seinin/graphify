/**
 * 物理链页的**手动摆放**：本机 → 盘上（`data/chain-layout.json`）。
 *
 * 与画布共用的 `graphStore` 分开记：两张图各存各的坐标，互不牵连。这一页只读生成物，
 * 能动的就只有位置，所以这份状态比画布那份窄得多——只有坐标与一次保存。
 *
 * 状态词汇与画布对齐（`graphStore` 的 `saved` / `dirty` / `saveState` / `lastSavedAt`）：
 *   · `saved`   —— 盘上那份（服务端读回来的覆盖层）
 *   · `pending` —— 本机改了、还没保存的那份；非空即「有未保存改动」
 * 页面拿 `{ ...saved, ...pending }` 叠在生成物的坐标上，拖完一个节点只记在本机，
 * **按保存才写盘**——与画布同一条路，不自动写。
 */
import { create } from 'zustand'
import { toast } from 'sonner'
import { api } from '../api/client'
import type { ChainLayout } from '../lib/types'
import type { SaveState } from './graphStore'

export interface ChainLayoutState {
  /** 盘上那份读回来了没有（页面挂载时读一次；没读完就照生成物默认显示） */
  loaded: boolean
  saved: ChainLayout['positions']
  pending: ChainLayout['positions']
  saveState: SaveState
  /** 盘上那份的写入时间（ISO）；空串 = 还没写过覆盖层 */
  lastSavedAt: string
  load: () => Promise<void>
  notePositions: (positions: ChainLayout['positions']) => void
  save: () => Promise<boolean>
  restoreDefaults: () => Promise<boolean>
}

export const useChainLayoutStore = create<ChainLayoutState>((set, get) => ({
  loaded: false,
  saved: {},
  pending: {},
  saveState: 'idle',
  lastSavedAt: '',

  /**
   * 打开这一页时读一次覆盖层。
   * 读不到不当致命错误：页面照生成物默认显示，但要**说清原因**——静默地"回到默认"
   * 正是"我以为保存了"那类错觉的来源。
   */
  load: async () => {
    if (get().loaded) return
    try {
      const { layout } = await api.getChainLayout()
      set({ loaded: true, saved: layout.positions, lastSavedAt: layout.updatedAt ?? '' })
    } catch (err) {
      set({ loaded: true })
      toast.error('读不到这一页记下的摆放', {
        description: `${(err as Error).message}；页面按生成物烘好的默认摆位显示。`,
      })
    }
  },

  /** 拖完一个节点（落点已四舍五入）：只记在本机，等保存才写盘 */
  notePositions: (positions) => set((state) => ({ pending: { ...state.pending, ...positions } })),

  /** 保存：把「盘上那份 + 本机这份」整份写回 */
  save: async () => {
    const current = get()
    if (Object.keys(current.pending).length === 0) {
      toast.info('没有需要保存的改动', {
        description: '这一页能改的只有节点摆放：拖开一个节点再保存。',
      })
      return false
    }
    set({ saveState: 'saving' })
    try {
      const result = await api.saveChainLayout({ ...current.saved, ...current.pending })
      set({
        saveState: 'saved',
        saved: result.layout.positions,
        pending: {},
        lastSavedAt: result.layout.updatedAt ?? '',
      })
      toast.success('已保存摆放', {
        description: `${result.updated} 个节点的位置已写回 data/chain-layout.json，下次打开按它显示。`,
        action: { label: '恢复生成物默认', onClick: () => void get().restoreDefaults() },
      })
      return true
    } catch (err) {
      set({ saveState: 'error' })
      toast.error('保存摆放失败', { description: (err as Error).message })
      return false
    }
  },

  /**
   * 恢复默认摆放：清掉覆盖层，页面回到生成物烘好的坐标。
   *
   * 这是"手动摆放"必须配的一条退路——摆乱了要能回到原点，而不是只能一路手动摆回去。
   */
  restoreDefaults: async () => {
    set({ saveState: 'saving' })
    try {
      const result = await api.saveChainLayout({})
      set({
        saveState: 'saved',
        saved: {},
        pending: {},
        lastSavedAt: result.layout.updatedAt ?? '',
      })
      toast.success('已恢复生成物默认摆放', { description: 'data/chain-layout.json 已清空，页面回到烘好的坐标。' })
      return true
    } catch (err) {
      set({ saveState: 'error' })
      toast.error('恢复默认摆放失败', { description: (err as Error).message })
      return false
    }
  },
}))

/** 本机与盘上是否不一致：顶栏的「有未保存改动」与保存动作都看它 */
export const chainLayoutDirty = (state: ChainLayoutState) => Object.keys(state.pending).length > 0
