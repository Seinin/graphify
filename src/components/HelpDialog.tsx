import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'
import { Badge, Separator } from './ui/badge'

const GROUPS: { title: string; items: { keys: string[]; desc: string }[] }[] = [
  {
    title: '图谱编辑（仅画布视图）',
    items: [
      { keys: ['N'], desc: '新建节点' },
      { keys: ['C'], desc: '选中节点后进入连线模式，再点目标节点建立关系' },
      { keys: ['Delete'], desc: '删除选中的节点或关系（可撤销）' },
      { keys: ['Esc'], desc: '取消当前操作 / 关闭抽屉 / 取消选中' },
    ],
  },
  {
    title: '撤销与保存',
    items: [
      { keys: ['Ctrl', 'Z'], desc: '撤销上一步操作（只作用于当前会话，不写盘）' },
      { keys: ['Ctrl', 'Shift', 'Z'], desc: '重做（同样只作用于当前会话）' },
      { keys: ['Ctrl', 'S'], desc: '另存为一份保留副本：先把本机坐标写回工作文件，再归档副本' },
    ],
  },
  {
    title: '浏览',
    items: [
      { keys: ['/'], desc: '聚焦全局搜索' },
      { keys: ['L'], desc: '按当前布局重新排布（默认是手动摆放，不会自动重排）' },
      { keys: ['拖拽'], desc: '把节点拖进大框的范围即建立层级；拖出框外即移出' },
      { keys: ['右键'], desc: '节点上可「新建大框并放入此节点」/「移出大框」；空白处可「在此处新建大框」' },
      { keys: ['手柄'], desc: '选中节点后拖右侧手柄连线，靠近方框边中点会吸附到该端口' },
      { keys: ['F'], desc: '适应屏幕' },
      { keys: ['滚轮'], desc: '以光标为中心缩放' },
      { keys: ['拖拽空白'], desc: '平移画布' },
      { keys: ['双击节点'], desc: '展开下一层；再双击同一节点则收起该层' },
    ],
  },
]

const GESTURES: { title: string; desc: string }[] = [
  { title: '钻取与返回', desc: '首屏只显示一级（顶层大框）。点大框即进入它的下一层，同级隐藏；左上角面包屑可跳到任意一层，↩ 键或 Esc 退一层。' },
  { title: '虚线的含义', desc: '虚线只表示「条件 / 可选」：虚线框是可选步骤，虚线连线是条件性数据流（在检查器里用「条件 / 可选」开关打标）。' },
  { title: '关系名按需显示', desc: '箭头上的文字默认不显示：把指针停在节点上看相邻的关系名，停在某条线上只看这一条，选中则一直显示。' },
  { title: '拖拽连线', desc: '选中节点后，点住节点右侧的蓝色手柄拖到另一个节点，即可建立关系。指针靠近方框的四条边中点时会吸附到那个端口，松手后固定下来。' },
  { title: '大框套小框', desc: '「大框」是容器：把小框拖进它的范围即建立层级，拖出去即移出。大框会自己长大到刚好包住里面的节点，不用手调大小。' },
  { title: '手动摆放', desc: '默认布局是「手动摆放」：位置只由拖动决定，不会被自动重排冲掉。想自动整理一次，在工具条里换成力导向 / 层级即可。' },
  { title: '悬浮放大', desc: '指针落在方框上时该框放大一档并加深描边，便于在密集的版面里确认指的是哪一个。' },
  { title: '逐层展开', desc: '悬停或选中节点后，点它右下方的圆形键展开下一层，再点同一枚键收起。带虚线与「· N」的节点表示还有 N 个未展开的下层。' },
  { title: '画布上限', desc: '一张画布最多同时显示 25 个节点：超出上限的展开会被拒绝并给出提示，需要收起其他分支或切到更细分的话题。' },
  { title: '引用拖放', desc: '把左侧 notes 数据库中的文档拖到某个节点上，即可为该节点添加引用。' },
  { title: '源码引用', desc: '检查器里点「源码」选文件与行区间，即可把某几行代码挂到节点上；点引用即在源码预览抽屉里看那几行。' },
  { title: '悬停高亮', desc: '悬停节点会高亮它的邻居并弱化其余元素，便于顺着关系链阅读。' },
  { title: '右键菜单', desc: '在节点、关系或空白处右键，可获得与上下文相关的操作。' },
]

export function HelpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[640px]">
        <DialogHeader>
          <DialogTitle>操作指南</DialogTitle>
          <DialogDescription>所有破坏性操作都可以撤销；服务端还会在每次写入前自动留存快照。</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-5">
          <div className="flex flex-col gap-3">
            {GROUPS.map((group) => (
              <section key={group.title} className="flex flex-col gap-1.5">
                <h3 className="text-micro font-semibold uppercase tracking-wide text-muted-foreground/80">
                  {group.title}
                </h3>
                {group.items.map((item) => (
                  <div key={item.desc} className="flex items-start gap-2">
                    <span className="flex shrink-0 gap-1">
                      {item.keys.map((key) => (
                        <kbd
                          key={key}
                          className="rounded border border-black/10 bg-black/[0.05] px-1.5 py-[1px] font-mono text-micro text-foreground/85"
                        >
                          {key}
                        </kbd>
                      ))}
                    </span>
                    <span className="text-micro leading-relaxed text-muted-foreground">{item.desc}</span>
                  </div>
                ))}
              </section>
            ))}
          </div>

          <div className="flex flex-col gap-3">
            <section className="flex flex-col gap-2">
              <h3 className="text-micro font-semibold uppercase tracking-wide text-muted-foreground/80">
                关键操作
              </h3>
              {GESTURES.map((item) => (
                <div key={item.title} className="rounded-md border border-black/[0.07] bg-black/[0.03] px-2.5 py-2">
                  <p className="text-micro font-medium text-foreground/88">{item.title}</p>
                  <p className="mt-0.5 text-micro leading-relaxed text-muted-foreground">{item.desc}</p>
                </div>
              ))}
            </section>

            <Separator />

            <section className="flex flex-col gap-1.5">
              <h3 className="text-micro font-semibold uppercase tracking-wide text-muted-foreground/80">
                可逆性
              </h3>
              <p className="text-micro leading-relaxed text-muted-foreground">
                删除节点、取消关系都会在提示条里给出「撤销」入口；即使刷新页面，
                也能在<span className="text-foreground/85">版本历史</span>里回滚到任意一次修改之前的状态。
                <br />
                撤销/重做只改本机（不写盘）：要让撤销后的状态留存，按
                <kbd className="mx-0.5 rounded bg-black/[0.06] px-1">Ctrl/Cmd + S</kbd>另存为一份保留副本。
                拖拽坐标与自动重排同样只改本机，保存时才写回工作文件。
              </p>
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                <Badge tone="success">会话内撤销栈 100 步</Badge>
                <Badge tone="primary">服务端快照 50 份</Badge>
              </div>
            </section>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
