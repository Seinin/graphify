import type {
  ChainLayout,
  CodeFile,
  CodeWindow,
  Graph,
  GraphEdge,
  GraphNode,
  GraphVersion,
  ImportPreview,
  MdDoc,
  MdDocContent,
  NodePosition,
  TagDefinition,
} from '../lib/types'

const BASE = '/api'

export class ApiError extends Error {
  status: number
  issues?: { path: string; message: string }[]

  constructor(message: string, status: number, issues?: { path: string; message: string }[]) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.issues = issues
  }
}

interface RequestOptions {
  method?: string
  body?: unknown
  signal?: AbortSignal
  timeout?: number
}

/** 归一化错误：网络异常、超时与后端错误都转成 ApiError，便于统一提示 */
function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, timeout = 20_000 } = options
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)

  if (signal) {
    signal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  return fetch(`${BASE}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: controller.signal,
  })
    .catch((err: unknown) => {
      const aborted = err instanceof DOMException && err.name === 'AbortError'
      throw new ApiError(aborted ? '请求超时，请重试' : '无法连接到 Graphify 服务，请确认服务已启动', 0)
    })
    .then(async (response) => {
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        const message = payload?.error || `请求失败（HTTP ${response.status}）`
        throw new ApiError(message, response.status, payload?.issues)
      }
      return payload as T
    })
    .finally(() => clearTimeout(timer))
}

export const api = {
  // ---------- notes 数据库 ----------
  listMd: (force = false) => request<{ docs: MdDoc[]; count: number; totalChars: number; mdDir: string }>(`/md${force ? '?force=1' : ''}`),
  readMd: (docId: string) => request<{ doc: MdDocContent }>(`/md/content?docId=${encodeURIComponent(docId)}`),
  refreshMd: () => request<{ docs: MdDoc[]; count: number }>('/md/refresh', { method: 'POST' }),

  // ---------- 源码索引 ----------
  /** 源码文件列表；`query` 按路径子串过滤（服务端过滤，避免动辄上千条） */
  listCode: (query = '', limit = 400) =>
    request<{ codeDir: string; count: number; matched: number; files: CodeFile[] }>(
      `/code?limit=${limit}${query ? `&q=${encodeURIComponent(query)}` : ''}`,
    ),
  /** 读取某文件的一段行窗口（`start`/`end` 是高亮区间，1 起、含两端） */
  readCode: (file: string, start?: number | null, end?: number | null, context = 6) =>
    request<{ window: CodeWindow }>(
      `/code/content?file=${encodeURIComponent(file)}` +
        `${start ? `&start=${start}` : ''}${end ? `&end=${end}` : ''}&context=${context}`,
    ),
  /**
   * 按行区间取一段（分段连续浏览用）。
   *
   * 与 readCode 的差别只在语义：readCode 是「围绕引用行多给一点上下文」，
   * 这个是「就要这一段」——`from`/`to` 是窗口本身（1 起、含两端），不叠加 context。
   * `start`/`end` 仍是要**高亮**的引用区间，服务端取它与本段的交集（本段不含引用行时给 0）。
   */
  readCodeRange: (file: string, from: number, to: number, start?: number | null, end?: number | null) =>
    request<{ window: CodeWindow }>(
      `/code/content?file=${encodeURIComponent(file)}&mode=range&from=${from}&to=${to}` +
        `${start ? `&start=${start}` : ''}${end ? `&end=${end}` : ''}`,
    ),
  refreshCode: () => request<{ count: number }>('/code/refresh', { method: 'POST' }),

  // ---------- 图谱 ----------
  getGraph: () => request<{ graph: Graph }>('/graph'),
  /**
   * 整图替换（`PUT /api/graph`）。
   *
   * **界面已不再使用这条路**：手动保存改为"另存为一份保留副本"（见 `saveSnapshot`），
   * 前端因此没有任何"把整张图覆盖回工作文件"的通道。它保留给脚本 / CLI
   * （`scripts/*.mjs` 仍用它写回，服务端的破坏性护栏也仍为它们而设）。
   */
  putGraph: (graph: Graph, reason = 'graph:replace') =>
    request<{ graph: Graph }>('/graph', { method: 'PUT', body: { graph, reason } }),
  /** 只改图谱元信息（目前是名称）：增量写，不再借整图 PUT */
  patchMeta: (patch: { name?: string }) => request<{ graph: Graph }>('/graph/meta', { method: 'PATCH', body: patch }),
  /** 批量回写节点坐标：一次请求 = 一次写盘 = 一份快照（不逐节点写，避免刷满历史） */
  updatePositions: (positions: Record<string, { x: number; y: number }>, reason = 'node:positions') =>
    request<{ graph: Graph; updated: number; skipped: string[] }>('/graph/positions', {
      method: 'POST',
      body: { positions, reason },
    }),
  /** 手动保存的第二步：把整图另存为一份保留副本（**不写工作文件**） */
  saveSnapshot: (graph: Graph, reason = 'graph:save-as') =>
    request<{ id: string; savedAt: string; nodes: number; edges: number }>('/graph/save', {
      method: 'POST',
      body: { graph, reason },
    }),

  createNode: (node: Partial<GraphNode>) =>
    request<{ graph: Graph; node: GraphNode }>('/graph/nodes', { method: 'POST', body: node }),
  updateNode: (id: string, patch: Partial<GraphNode>) =>
    request<{ graph: Graph; node: GraphNode }>(`/graph/nodes/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: patch,
    }),
  deleteNode: (id: string) =>
    request<{ graph: Graph; removedEdges: number }>(`/graph/nodes/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  createEdge: (edge: Partial<GraphEdge>) =>
    request<{ graph: Graph; edge: GraphEdge }>('/graph/edges', { method: 'POST', body: edge }),
  updateEdge: (id: string, patch: Partial<GraphEdge>) =>
    request<{ graph: Graph; edge: GraphEdge }>(`/graph/edges/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: patch,
    }),
  deleteEdge: (id: string) =>
    request<{ graph: Graph; removedEdge: GraphEdge }>(`/graph/edges/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // ---------- LLM 建图端口 ----------
  importDraft: (draft: unknown, dryRun = false) =>
    request<{ dryRun: boolean; preview: ImportPreview; graph?: Graph }>(
      `/graph/import${dryRun ? '?dryRun=1' : ''}`,
      { method: 'POST', body: { ...(draft as object), dryRun } },
    ),
  getSchema: () => request<Record<string, unknown>>('/graph/schema'),

  // ---------- 全局标签注册表 ----------
  /** 登记一个标签（同名复用）；名称是唯一必填项 */
  createTag: (input: { name: string; description?: string; color?: string }) =>
    request<{ graph: Graph; tag: TagDefinition; reused?: boolean }>('/graph/tags', { method: 'POST', body: input }),
  /** 改名称 / 说明 / 颜色：id 不变，节点归属因此不受影响 */
  updateTag: (id: string, patch: { name?: string; description?: string; color?: string }) =>
    request<{ graph: Graph; tag: TagDefinition }>(`/graph/tags/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: patch,
    }),
  /** 注销标签：所有节点上的归属与明细一并摘掉 */
  deleteTag: (id: string) =>
    request<{ graph: Graph; removedTag: TagDefinition }>(`/graph/tags/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  // ---------- 物理链页的手动摆放 ----------
  /**
   * 读物理链页记下的手摆坐标（缺文件时回空的一份）。
   *
   * 与 `/graph` 那一组分开：这一页的数据来自生成物，服务端只为它存"谁摆在哪儿"。
   */
  getChainLayout: () => request<{ layout: ChainLayout }>('/chain-layout'),
  /** 整份替换手摆坐标；交空对象 = 清掉覆盖层（恢复生成物默认摆位） */
  saveChainLayout: (positions: Record<string, NodePosition>) =>
    request<{ layout: ChainLayout; updated: number; skipped: string[] }>('/chain-layout', {
      method: 'PUT',
      body: { positions },
    }),

  // ---------- 版本 ----------
  listVersions: () => request<{ versions: GraphVersion[] }>('/graph/versions'),
  rollbackVersion: (id: string) =>
    request<{ graph: Graph; rolledBackTo: string }>(`/graph/versions/${encodeURIComponent(id)}/rollback`, {
      method: 'POST',
    }),
  /** 删除一份**保留副本**（自动快照由轮转上限管理，服务端会拒绝逐个删） */
  deleteVersion: (id: string) =>
    request<{ removed: string }>(`/graph/versions/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  health: () => request<{ ok: boolean; mdDir: string; mode: string }>('/health'),
}
