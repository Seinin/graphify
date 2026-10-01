/**
 * 层级 / 标签页可见集模型（纯函数，不依赖 cytoscape）。
 *
 * 组织语义（装饰容器 vs 模块）：
 *   · **装饰容器**（type 'group' 的大框）：只作视觉分组，它的子节点直接画在框里（compound），
 *     自身不提供「展开 / 进入」交互；
 *   · **模块**（非 group 且带有子节点的节点）：是导航单位，子节点不与它同屏，
 *     通过双击 / 属性页入口在它自己的标签页里打开。
 *
 * 因此每个标签页的焦点是固定的（主图焦点为 null），可见集是一次性静态推导：
 * 焦点的直系子节点 + 其中装饰容器的后代（递归）。没有「已展开集合」、没有每屏预算。
 *
 * 不 import cytoscape 是刻意的：可以在 node 下直接拿 data/*.json 校验这些规则。
 */

export interface HierarchyNode {
  id: string
  parent: string | null
  /** 是否装饰容器（大框）：true 时子节点在父视图内联渲染 */
  frame: boolean
  /**
   * **对外输入（灰显的上下文节点）id**：只在**以本节点为焦点的标签页**里额外显形
   * （物理链的块子图用它把"这一块的成员读了块外哪个量"摆在眼前）。
   *
   * 这些 id 指向的仍然是**原来那个节点**（同一个 id、同一个 `parent`）：这里只改**可见集**，
   * 不动 `parentOf` —— 层级、层级条、子节点计数都不受影响，也不会出现"同一个量两个身份"。
   */
  contexts?: readonly string[]
}

export interface Hierarchy {
  /** 稳定的节点顺序（等于传入顺序） */
  ids: string[]
  /** 层级父级：null 表示顶层 */
  parentOf: Map<string, string | null>
  /** 层级子级，按 ids 顺序稳定 */
  childrenOf: Map<string, string[]>
  /** 顶层节点 id */
  roots: string[]
  /** 层号：顶层为 0，逐层 +1 */
  depthOf: Map<string, number>
  /** 装饰容器 id 集合 */
  frameIds: Set<string>
  /** 各节点声明的对外输入（只列真实存在、且不是自己的那些） */
  contextsOf: Map<string, string[]>
}

/**
 * 建立层级模型。
 *
 * `hierParentOf` 是话题过滤下的层级父级（成员 id → 最近的同话题祖先，null 表示顶层）；
 * 传 null 时直接用节点自身的 parent。映射里没有的 id 回落到自身 parent，这样话题视图与
 * 不过滤视图可以共用同一套计算。
 *
 * 自环与循环引用会被断开（该节点视为顶层）：数据来自人工编辑，不能让一处环把整图算崩。
 */
export function buildHierarchy(
  nodes: readonly HierarchyNode[],
  hierParentOf: ReadonlyMap<string, string | null> | null,
): Hierarchy {
  const ids = nodes.map((node) => node.id)
  const known = new Set(ids)

  const parentOf = new Map<string, string | null>()
  nodes.forEach((node) => {
    const raw = hierParentOf?.has(node.id) ? hierParentOf.get(node.id) ?? null : node.parent ?? null
    const parent = raw && raw !== node.id && known.has(raw) ? raw : null
    parentOf.set(node.id, parent)
  })

  ids.forEach((id) => {
    const seen = new Set<string>([id])
    let cursor = parentOf.get(id) ?? null
    while (cursor) {
      if (seen.has(cursor)) {
        parentOf.set(id, null)
        break
      }
      seen.add(cursor)
      cursor = parentOf.get(cursor) ?? null
    }
  })

  const childrenOf = new Map<string, string[]>()
  ids.forEach((id) => childrenOf.set(id, []))
  const roots: string[] = []
  ids.forEach((id) => {
    const parent = parentOf.get(id) ?? null
    if (parent) childrenOf.get(parent)?.push(id)
    else roots.push(id)
  })

  const depthOf = new Map<string, number>()
  const queue: Array<[string, number]> = roots.map((id) => [id, 0])
  while (queue.length) {
    const [id, depth] = queue.shift() as [string, number]
    if (depthOf.has(id)) continue
    depthOf.set(id, depth)
    ;(childrenOf.get(id) ?? []).forEach((child) => queue.push([child, depth + 1]))
  }

  const frameIds = new Set(nodes.filter((node) => node.frame).map((node) => node.id))

  /** 对外输入：指向不存在的节点（或指自己）一律丢掉——它们进不了可见集，留着只会让样式表空转 */
  const contextsOf = new Map<string, string[]>()
  nodes.forEach((node) => {
    const list = [...new Set(node.contexts ?? [])].filter((id) => id !== node.id && known.has(id))
    if (list.length) contextsOf.set(node.id, list)
  })

  return { ids, parentOf, childrenOf, roots, depthOf, frameIds, contextsOf }
}

/**
 * 标签页可见集：焦点的直系子节点 + 其中装饰容器的后代（递归）+ 焦点声明的**对外输入**。
 *
 * `focusId` 为 null 时是主图：顶层节点全部可见（顶层里的装饰容器同样内联展开）。
 * 模块的子节点不会出现在这里——它们属于模块自己的标签页。
 *
 * **对外输入**（`contextsOf`）是第三种来源：它们是**别的节点的子节点**，不该按层级出现在这里，
 * 但焦点（物理链的块）声明了"我的成员读它"，于是只在这个标签页里**额外显形**（渲染器把它们灰显）。
 * 它们**不再往下钻**：它们的子节点属于它们自己的标签页。
 */
export function tabVisibleIds(hierarchy: Hierarchy, focusId: string | null): Set<string> {
  const visible = new Set<string>()
  const queue = focusId === null ? [...hierarchy.roots] : [...(hierarchy.childrenOf.get(focusId) ?? [])]
  while (queue.length) {
    const id = queue.shift() as string
    if (visible.has(id)) continue
    visible.add(id)
    if (!hierarchy.frameIds.has(id)) continue
    ;(hierarchy.childrenOf.get(id) ?? []).forEach((child) => {
      if (!visible.has(child)) queue.push(child)
    })
  }
  if (focusId !== null) {
    for (const id of hierarchy.contextsOf.get(focusId) ?? []) visible.add(id)
  }
  return visible
}

/**
 * 本标签页里**属于别人**的节点：焦点声明的对外输入（灰显上下文）。
 *
 * 渲染器拿它做两件事：给这些节点挂只读灰显样式；把它们的**真实父级被藏掉**这件事豁免掉
 * （compound 级联隐藏原本会把它们一起藏掉——它们的父节点是别的块，不在本标签页里）。
 */
export function tabContextIds(hierarchy: Hierarchy, focusId: string | null): Set<string> {
  if (focusId === null) return new Set()
  return new Set(hierarchy.contextsOf.get(focusId) ?? [])
}
