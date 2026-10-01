import type { CollectionReturnValue, Core, LayoutOptions } from 'cytoscape'

export type LayoutKind = 'manual' | 'flow' | 'fcose' | 'concentric' | 'grid' | 'circle' | 'breadthfirst'

export const LAYOUT_LABELS: Record<LayoutKind, string> = {
  manual: '手动摆放',
  flow: '分层对齐',
  fcose: '力导向',
  concentric: '同心圆',
  grid: '网格',
  circle: '环形',
  breadthfirst: '层级',
}

/**
 * 默认布局：手动摆放。
 * 这是一张**可手工编排的图**——大框套小框、箭头吸附端口都要求位置稳定，
 * 任何「自动整理」都会把用户摆好的版面冲掉。想自动排一次随时可在工具条里换成别的布局。
 */
export const DEFAULT_LAYOUT_KIND: LayoutKind = 'manual'

/**
 * 力导向布局参数：追求「节点不重叠 + 关系走向清晰」。
 * 关闭随机化可让同一份数据每次得到稳定结果，便于用户形成空间记忆。
 *
 * 所有布局一律 `fit: false`：取景交给 GraphRenderer 的 `fit()`。
 * 布局自带的取景只按节点矩形算包围盒，边缘节点的名称会被切在画布外；
 * 统一交给渲染器后，取景能把标签一起纳入，且展开/收起时能保持视口不动。
 */
export function buildLayoutOptions(kind: LayoutKind, hasSelection: boolean): LayoutOptions {
  /**
   * 手动摆放：`preset` 布局不做任何计算，只把元素的现有坐标当作最终结果。
   * 于是「切到手动」= 保留当前版面，后续拖动成为唯一的位置来源。
   */
  if (kind === 'manual') {
    return { name: 'preset', fit: false, animate: false } as unknown as LayoutOptions
  }

  /**
   * 分层对齐是自研算法（graph/ordered.ts），由渲染器的 runLayout 直接拦截，
   * 不会走到 cytoscape 布局。这里返回 preset 只是兜底：万一被别的调用方传进来，
   * 宁可「什么都不做」，也不要落进下面的 circle 分支把版面转成一圈。
   */
  if (kind === 'flow') {
    return { name: 'preset', fit: false, animate: false } as unknown as LayoutOptions
  }

  if (kind === 'fcose') {
    return {
      name: 'fcose',
      quality: 'default',
      animate: true,
      animationDuration: 520,
      animationEasing: 'ease-out-cubic',
      randomize: false,
      fit: false,
      // 节点之间的最小留白。层级已改由连线表达，这里不再涉及复合容器的包含关系
      nodeSeparation: 130,
      idealEdgeLength: (edge: { data: (key: string) => unknown }) =>
        String(edge.data('type')) === 'depends_on' ? 130 : 175,
      nodeRepulsion: 8200,
      gravity: 0.26,
      numIter: 2600,
      samplingType: true,
      uniformNodeDimensions: false,
      // 把节点下方的标签也算进尺寸，避免标签互相压住或溢出取景范围
      nodeDimensionsIncludeLabels: true,
    } as unknown as LayoutOptions
  }

  if (kind === 'concentric') {
    return {
      name: 'concentric',
      animate: true,
      animationDuration: 420,
      fit: false,
      minNodeSpacing: 46,
      concentric: (node: { degree: (includeLoops?: boolean) => number }) => node.degree(true),
      levelWidth: () => 2,
    } as unknown as LayoutOptions
  }

  if (kind === 'grid') {
    return {
      name: 'grid',
      animate: true,
      animationDuration: 380,
      fit: false,
      avoidOverlap: true,
      spacingFactor: 1.35,
    } as unknown as LayoutOptions
  }

  /**
   * 层级布局（cytoscape 内置 breadthfirst）：默认布局。根在上、逐层向下铺开，
   * 配合层级连线正好读出「谁细分成谁」。`grid: true` 让同一层的节点对齐成行，
   * `avoidOverlap` 保证节点标签不会互相压住（节点是等大方块，标签在下方）。
   */
  if (kind === 'breadthfirst') {
    return {
      name: 'breadthfirst',
      animate: true,
      animationDuration: 420,
      animationEasing: 'ease-out-cubic',
      fit: false,
      directed: true,
      circle: false,
      grid: true,
      avoidOverlap: true,
      spacingFactor: 1.25,
      nodeDimensionsIncludeLabels: true,
    } as unknown as LayoutOptions
  }

  return {
    name: 'circle',
    animate: true,
    animationDuration: 400,
    fit: false,
    spacingFactor: 1.2,
    ...(hasSelection ? {} : {}),
  } as unknown as LayoutOptions
}

/**
 * 运行布局并返回 Promise，便于串接后续动作。
 * `options.fit: false` 用来覆盖布局自带的取景：展开/收起后的整树重排必须保留当前视口
 * （缩放与观看区域都不动），否则一次点按就会把视野带走、用户失去方位。
 */
/**
 * 布局结束的兜底时限。
 *
 * 布局本身应该发 `layoutstop`，但它在两种情况下可能永远不来：画布尺寸为 0（例如容器尚未布局完，
 * 无头环境下更是常态）、或元素数据异常让算法卡住。此时调用方的 `await` 会永久挂起，
 * 后面「登记坐标 → 回存 → 取景」整条链路一起停摆（表现为画布空白、坐标写不回去）。
 * 超时只影响等待时长，不会打断算法本身：真结束后位置照样生效。
 */
const LAYOUT_TIMEOUT_MS = 10_000

export function runLayout(
  cy: Core,
  kind: LayoutKind,
  onError?: (error: unknown) => void,
  options?: { fit?: boolean },
) {
  // 只把可见元素交给布局：cytoscape 默认连 display:none 的元素一起纳入集合，而 fcose 在
  // nodeDimensionsIncludeLabels 下遇到被隐藏的复合容器会直接抛错，导致整次布局失败
  // （位置不更新，看起来像没渲染）。这里与 runLocalLayout 保持同一口径。
  const nodes = cy.nodes().filter((node) => node.visible())
  if (nodes.length === 0) return Promise.resolve()
  const eles = nodes.union(nodes.edgesWith(nodes))
  return new Promise<void>((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const finish = () => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve()
    }
    const base = buildLayoutOptions(kind, cy.$(':selected').length > 0)
    const layoutOptions = {
      ...base,
      ...(options?.fit === undefined ? {} : { fit: options.fit }),
      eles,
    } as unknown as LayoutOptions
    try {
      const layout = cy.layout(layoutOptions)
      layout.one('layoutstop', finish)
      layout.run()
    } catch (error) {
      // 布局失败不能静默：调用方据此提示用户并兜底取景
      onError?.(error)
      finish()
      return
    }
    timer = setTimeout(finish, LAYOUT_TIMEOUT_MS)
  })
}

/**
 * 只对给定子集做局部重排：展开/收起一层后用来把新露出的分支整理干净，
 * 而不去动画布上其它已经摆好的节点（fit:false 也保证视口不跳）。
 */
export function runLocalLayout(
  cy: Core,
  eles: CollectionReturnValue,
  onError?: (error: unknown) => void,
  duration = 340,
) {
  const nodes = eles.nodes().filter((node) => node.visible())
  if (nodes.length === 0) return Promise.resolve()
  const collection = nodes.union(nodes.edgesWith(nodes))
  return new Promise<void>((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const finish = () => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve()
    }
    try {
      const layout = cy.layout({
        name: 'fcose',
        eles: collection,
        quality: 'default',
        animate: true,
        animationDuration: duration,
        animationEasing: 'ease-out-cubic',
        randomize: false,
        fit: false,
        nodeSeparation: 120,
        nodeRepulsion: 7800,
        gravity: 0.3,
        numIter: 1600,
        samplingType: true,
        uniformNodeDimensions: false,
        nodeDimensionsIncludeLabels: true,
      } as unknown as LayoutOptions)
      layout.one('layoutstop', finish)
      layout.run()
    } catch (error) {
      onError?.(error)
      finish()
      return
    }
    timer = setTimeout(finish, LAYOUT_TIMEOUT_MS)
  })
}
