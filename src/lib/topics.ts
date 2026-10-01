import type { Graph, Topic } from './types'

/** 话题注册表；旧图与骨架视图没有注册表时返回空数组 */
export const graphTopics = (graph: Graph): Topic[] => graph.meta.topics ?? []

export const findTopic = (graph: Graph, topicId: string): Topic | null =>
  graphTopics(graph).find((topic) => topic.id === topicId) ?? null

/** 当前可见集的静态描述，供渲染器按 id 判断显示与取层级父级 */
export interface TopicVisibility {
  /** 当前可见的节点：不属于任何被关闭话题的节点 */
  members: string[]
  /**
   * 视图下的层级父级：成员 id → 最近的、**同样可见**的祖先；
   * null 表示该成员本次作为顶层显示（其真实父链全部落在可见集之外）。
   * 这只是一份计算结果，不改动节点自身的层级字段。不过滤时为空对象。
   */
  hierParentOf: Record<string, string | null>
}

export interface TopicView extends TopicVisibility {
  /** 是否真的做了过滤（至少有一个话题被关闭） */
  filtered: boolean
  /** 生效的被关闭话题 id（已去重、已剔除未注册项，顺序稳定） */
  hiddenTopicIds: string[]
  memberIds: Set<string>
  /** 注册表非空且全部话题都被关闭（画布据此给出恢复入口） */
  allHidden: boolean
}

/** 某话题的成员节点 id（与该话题是否被关闭无关，供话题面板显示规模） */
export const topicMemberIds = (graph: Graph, topicId: string): string[] =>
  graph.nodes.filter((node) => (node.topics ?? []).includes(topicId)).map((node) => node.id)

/** 话题成员数，供顶栏话题列表展示 */
export const topicVisibleCount = (graph: Graph, topicId: string): number =>
  topicMemberIds(graph, topicId).length

/**
 * 计算当前可见集：**不属于任何被关闭话题的节点**。
 *
 * 话题面板是「显示 / 隐藏」开关：勾选某话题即显示其成员，取消勾选即隐藏其成员。
 * 因此这里按「被关闭集合」求差集，而不是按「被开启集合」求并集——多归属的节点只要
 * 落在任一被关闭话题里就隐藏，开关才有确定的反馈；不归属任何话题的节点恒显。
 *
 * 层级关系不靠容器表达，因此父节点被隐藏不会连累子节点：父链越出可见集的成员
 * 改以「最近的可见祖先」为层级父级，没有这样的祖先即视为顶层（见 hierParentOf）。
 *
 * 注册表为空（旧图 / 骨架视图）或被关闭集合为空时不过滤，直接返回全部节点。
 */
export function topicVisibility(graph: Graph, hiddenTopicIds: readonly string[] = []): TopicView {
  const allIds = graph.nodes.map((node) => node.id)
  const registry = graphTopics(graph)
  const known = new Set(registry.map((topic) => topic.id))
  // 未注册的 id 直接忽略：撤销或换图后残留的开关状态不该让画布整体空掉
  const hidden = [...new Set(hiddenTopicIds)].filter((id) => known.has(id))

  if (!registry.length || !hidden.length) {
    return {
      filtered: false,
      hiddenTopicIds: hidden,
      members: allIds,
      hierParentOf: {},
      memberIds: new Set(allIds),
      allHidden: false,
    }
  }

  const hiddenSet = new Set(hidden)
  const memberIds = new Set(
    graph.nodes
      .filter((node) => !(node.topics ?? []).some((topicId) => hiddenSet.has(topicId)))
      .map((node) => node.id),
  )
  const byId = new Map(graph.nodes.map((node) => [node.id, node]))

  // 每个可见节点沿 parent 上溯，取第一个同样可见的祖先作为本视图下的层级父级；
  // 一个都没有（父链整段越界）则视为顶层。可见集内部的层级由此原样保留。
  const hierParentOf: Record<string, string | null> = {}
  memberIds.forEach((id) => {
    const seen = new Set<string>([id])
    let parent = byId.get(id)?.parent ?? null
    let lifted: string | null = null
    while (parent && !seen.has(parent)) {
      if (memberIds.has(parent)) {
        lifted = parent
        break
      }
      seen.add(parent)
      parent = byId.get(parent)?.parent ?? null
    }
    hierParentOf[id] = lifted
  })

  return {
    filtered: true,
    hiddenTopicIds: hidden,
    members: [...memberIds],
    hierParentOf,
    memberIds,
    allHidden: hidden.length >= registry.length,
  }
}

/**
 * 可见集指纹：只在「可见集或其层级结构」真正变化时触发「重新套用过滤 + 取景 + 重算展开」，
 * 避免普通编辑（改名、改摘要）把画布重新 fit 一次造成跳动。
 *
 * 层级父级映射与「被关闭集合」必须一并计入：成员集相同而祖先链被改动时，可见集不变但
 * 画布层级要跟着重排；开关集合本身也进指纹，保证开关文案与画布状态同步刷新。
 */
export const topicVisibilityFingerprint = (view: TopicView): string => {
  const members = [...view.memberIds].sort().join(',')
  const structure = Object.entries(view.hierParentOf)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, parent]) => `${id}>${parent ?? ''}`)
    .join(',')
  return `${view.hiddenTopicIds.join(',')}|${members}|${structure}`
}
