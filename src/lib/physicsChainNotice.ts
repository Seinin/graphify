import { toast } from 'sonner'

/**
 * 物理链页的编辑动作回这一句：数据由生成物驱动，新增、改属性、连线、标签都不落盘，写入权在真源。
 *
 * **节点摆放是唯一的例外**：拖开一个节点、按保存（顶栏按钮 / Ctrl/Cmd + S）写回
 * `data/chain-layout.json`，下次打开照它显示（见 `state/chainLayoutStore`）。
 * 说明里因此把"能改的只有位置"讲明白——不然一句"只读"会把这条也堵掉。
 *
 * 单独一个模块：页面自己的编辑回调与 App 的快捷键读同一份说明。
 * 不并进 `physicsChain.ts`——那份 lib 被自检 `loadTs` 直接加载，不该牵进 UI 依赖。
 */
export const readOnlyNotice = () =>
  toast.info('物理链是只读的', {
    description:
      '这一页由 physics-chain.json 生成，能改的只有节点摆放（拖开后按保存写回）；其余编辑请改真源 docs/notes/physics-chain/chain.json 后重新生成。',
  })
