import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ApiError, api } from '../api/client'
import { useGraphStore } from '../state/graphStore'
import type { Graph, GraphEdge, GraphNode, NodePosition } from '../lib/types'

function errorDescription(err: unknown) {
  if (err instanceof ApiError && err.issues?.length) {
    return err.issues.map((issue) => issue.message).join('；')
  }
  return undefined
}

/**
 * 图谱与服务端的同步层：
 * - 结构性操作（新建/删除/改属性/改名）直接调用对应端点，并以服务端返回的图谱为准
 * - **只改本机**的改动（拖拽坐标、自动重排、撤销/重做）不写盘，只标脏——保存要用户手动来
 * - 手动保存（Ctrl/Cmd + S）是**另存为**：先把本机坐标批量写回工作文件，再归档一份保留副本
 *
 * 这里刻意**没有自动保存**：前端不再整图 PUT，工作文件只被"点了才发生"的增量写入更新，
 * 所以"一个还开着旧数据的标签页把整张图覆盖掉"那条失败路径不再存在。
 */
export function useGraphSync() {
  const applyServerGraph = useGraphStore((state) => state.applyServerGraph)
  const loadGraph = useGraphStore((state) => state.loadGraph)
  const markSaved = useGraphStore((state) => state.markSaved)
  const setSaveState = useGraphStore((state) => state.setSaveState)
  const [ready, setReady] = useState(false)

  const reload = useCallback(
    () =>
      api
        .getGraph()
        .then(({ graph: incoming }) => {
          loadGraph(incoming)
          setReady(true)
          return true
        })
        .catch((err: Error) => {
          setSaveState('error', err.message)
          toast.error('加载图谱失败', { description: err.message })
          return false
        }),
    [loadGraph, setSaveState],
  )

  useEffect(() => {
    reload()
  }, [reload])

  /**
   * 手动保存（Ctrl/Cmd + S）= **另存为**，两步且严格有序：
   *
   *   ① 先把"只在本机改过"的坐标**批量**写回工作文件（一次写盘 = 一份快照）；
   *   ② 再把整图另存为一份**保留副本**（写进历史目录、不参与轮转，**不碰工作文件**）。
   *
   * 顺序不能反：反过来副本里就没有刚拖好的坐标，副本与工作文件会不一致。
   * 第二步失败时如实说明"坐标已写入、副本未生成"，并保持未保存状态以便重试。
   */
  const saveNow = useCallback(() => {
    const store = useGraphStore.getState()
    /**
     * 这一层只管画布那张图（`data/graph.json`）。物理链页的保存走它自己那条路：
     * 存的是那一页的手动摆放（`state/chainLayoutStore` → `data/chain-layout.json`），
     * 与这里无关（见 `App.tsx` 的快捷键分组）。
     * 万一生成物被塞进这个 store，坐标会被写进画布的工作文件、整图会被归档进画布的历史目录——
     * 都是污染，这里因此留一道兜底。
     */
    if ((store.graph.meta as { id?: string }).id === 'physics-chain') {
      toast.info('物理链是只读的，没有需要保存的改动')
      return Promise.resolve(false)
    }
    const positions: Record<string, NodePosition> = {}
    for (const id of store.pendingPositionIds) {
      const node = store.graph.nodes.find((item) => item.id === id)
      if (node?.position) positions[id] = { x: node.position.x, y: node.position.y }
    }

    let positionsWritten = false
    setSaveState('saving')
    return api
      .updatePositions(positions, 'node:positions')
      .then(({ graph: saved }) => {
        positionsWritten = true
        // 工作文件已含这些坐标：以服务端权威图为准（本地其它未落盘改动由 store 合并保留）
        applyServerGraph(saved)
      })
      .then(() => api.saveSnapshot(useGraphStore.getState().graph, 'graph:save-as'))
      .then((archive) => {
        markSaved(useGraphStore.getState().graph)
        toast.success('已另存为一份保留副本', { description: archive.id })
        return true
      })
      .catch((err: Error) => {
        setSaveState('error', err.message)
        toast.error(positionsWritten ? '副本未生成' : '保存失败', {
          id: 'graphify-save',
          description: positionsWritten
            ? `坐标已写入工作文件，但副本没生成：${err.message}`
            : err.message,
        })
        return false
      })
  }, [applyServerGraph, markSaved, setSaveState])

  /** 包装服务端写操作：失败时回滚到服务端权威状态并提示原因 */
  const withServerGraph = useCallback(
    <T extends { graph: Graph }>(promise: Promise<T>, successMessage?: string) => {
      return promise
        .then((result) => {
          applyServerGraph(result.graph)
          if (successMessage) toast.success(successMessage)
          return result
        })
        .catch((err: Error) => {
          setSaveState('error', err.message)
          toast.error(err.message === 'Failed to fetch' ? '无法连接到 Graphify 服务' : err.message, {
            description: errorDescription(err) ?? '已恢复为服务端最新状态',
          })
          reload()
          return null
        })
    },
    [applyServerGraph, reload, setSaveState],
  )

  /** 结构性操作前先记录撤销点，保证新建/删除同样可逆 */
  const snapshotPoint = useCallback(() => {
    useGraphStore.getState().pushHistoryPoint()
  }, [])

  const createNode = useCallback(
    (input: Partial<GraphNode>) => {
      snapshotPoint()
      return withServerGraph(api.createNode(input), `已创建节点「${input.label ?? ''}」`)
    },
    [snapshotPoint, withServerGraph],
  )

  const createEdge = useCallback(
    (input: Partial<GraphEdge>) => {
      snapshotPoint()
      return withServerGraph(api.createEdge(input), `已建立关系「${input.label ?? ''}」`)
    },
    [snapshotPoint, withServerGraph],
  )

  const removeNode = useCallback(
    (id: string) => {
      snapshotPoint()
      return withServerGraph(api.deleteNode(id))
    },
    [snapshotPoint, withServerGraph],
  )

  const removeEdge = useCallback(
    (id: string) => {
      snapshotPoint()
      return withServerGraph(api.deleteEdge(id))
    },
    [snapshotPoint, withServerGraph],
  )

  /**
   * 属性编辑：先本地改（进入撤销栈），再同步服务端。
   * mutate 在 sync 之前执行，因此 / 撤销 能立即回到改动前的状态。
   */
  const patchNode = useCallback(
    (id: string, patch: Partial<GraphNode>) => {
      const store = useGraphStore.getState()
      store.mutate((draft) => {
        const node = draft.nodes.find((item) => item.id === id)
        if (node) Object.assign(node, patch)
      })
      return withServerGraph(api.updateNode(id, patch))
    },
    [withServerGraph],
  )

  const patchEdge = useCallback(
    (id: string, patch: Partial<GraphEdge>) => {
      const store = useGraphStore.getState()
      store.mutate((draft) => {
        const edge = draft.edges.find((item) => item.id === id)
        if (edge) Object.assign(edge, patch)
      })
      return withServerGraph(api.updateEdge(id, patch))
    },
    [withServerGraph],
  )

  /**
   * 改图谱名称：**增量写**（只加一个字段）。
   *
   * 以前是"本地改完借整图 PUT 落盘"——既慢，又把整张图置于被覆盖的风险里。
   */
  const rename = useCallback(
    (name: string) => {
      useGraphStore.getState().mutate(
        (draft) => {
          draft.meta.name = name
        },
        { history: true },
      )
      return withServerGraph(api.patchMeta({ name }), `已改名为「${name}」`)
    },
    [withServerGraph],
  )

  /** 拖拽开始：只记录一次撤销点（坐标本身上面那条 `applyPositions` 处理） */
  const beginPositionEdit = useCallback(() => {
    useGraphStore.getState().mutate(() => {}, { history: true })
  }, [])

  /**
   * 拖拽结束 / 自动重排的落点：坐标**只改本机**，并记下"待写节点"。
   * 手动保存时只提交这些节点，避免整图坐标回写、也避免逐节点写盘刷满历史。
   *
   * 只有坐标**真的变了**才算本机改动：打开页面时会跑一次布局并把坐标回存，
   * 那时坐标与 store 里一致——若不加这道判断，整张图一上来就被标成"有未保存改动"，
   * 顶栏永远是脏的、刷新还必然弹确认，"离开提示"因此变成噪声。
   */
  const applyPositions = useCallback((positions: Record<string, NodePosition>) => {
    const store = useGraphStore.getState()
    const touched = Object.keys(positions).filter((id) => {
      const node = store.graph.nodes.find((item) => item.id === id)
      if (!node) return false
      const next = positions[id]
      if (!node.position) return true
      return Math.round(node.position.x) !== Math.round(next.x) || Math.round(node.position.y) !== Math.round(next.y)
    })
    store.mutate(
      (draft) => {
        draft.nodes.forEach((node) => {
          const position = positions[node.id]
          if (position) node.position = position
        })
      },
      { history: false },
    )
    store.notePendingPositions(touched)
  }, [])

  /**
   * 撤销 / 重做：**只回退本机，不写盘**。
   *
   * 唯一能把撤销后的状态留存的路径是手动保存（另存为副本）——整图覆盖已被禁止，
   * 工作文件只被逐条操作更新。帮助面板与历史面板脚注都如实写了"仅当前会话"。
   */
  const undo = useCallback(() => {
    if (!useGraphStore.getState().undo()) toast.info('没有可撤销的操作')
  }, [])

  const redo = useCallback(() => {
    if (!useGraphStore.getState().redo()) toast.info('没有可重做的操作')
  }, [])

  return {
    ready,
    reload,
    saveNow,
    rename,
    createNode,
    createEdge,
    removeNode,
    removeEdge,
    patchNode,
    patchEdge,
    beginPositionEdit,
    applyPositions,
    undo,
    redo,
  }
}
