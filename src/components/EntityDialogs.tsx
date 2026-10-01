import { useEffect, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Field, Input, Textarea } from './ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Switch } from './ui/switch'
import { DotBadge } from './ui/badge'
import {
  EDGE_TYPE_LABELS,
  EDGE_TYPE_ORDER,
  NODE_TYPE_COLORS,
  NODE_TYPE_LABELS,
  NODE_TYPE_ORDER,
  type EdgeType,
  type GraphEdge,
  type GraphNode,
  type NodeType,
} from '../lib/types'
import { HIGHLIGHT_COLOR, SNAP_COLOR } from '../graph/palette'

/**
 * 节点对话框的表单值。
 *
 * **不含 tags**：全局标签是从注册表多选的（见属性面板的标签编辑），自由文本已经移除；
 * 更重要的是，编辑节点时如果连 tags 一起提交，一个空数组就会把已有标签抹掉。
 */
export interface NodeFormValues {
  label: string
  type: NodeType
  summary: string
}

interface NodeDialogProps {
  open: boolean
  mode: 'create' | 'edit'
  initial?: Partial<GraphNode>
  onOpenChange: (open: boolean) => void
  onSubmit: (values: NodeFormValues) => void
}

export function NodeDialog({ open, mode, initial, onOpenChange, onSubmit }: NodeDialogProps) {
  const [label, setLabel] = useState('')
  const [type, setType] = useState<NodeType>('concept')
  const [summary, setSummary] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setLabel(initial?.label ?? '')
    setType((initial?.type as NodeType) ?? 'concept')
    setSummary(initial?.summary ?? '')
    setError(null)
  }, [open, initial])

  const submit = () => {
    const trimmed = label.trim()
    if (!trimmed) {
      setError('节点名称不能为空')
      return
    }
    onSubmit({
      label: trimmed,
      type,
      summary: summary.trim(),
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? '新建节点' : '编辑节点'}</DialogTitle>
          <DialogDescription>节点代表一个概念、结论或文档入口，可挂载 notes 数据库中的引用。</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3.5">
          <Field label="节点名称" hint="必填" error={error}>
            <Input
              autoFocus
              value={label}
              placeholder="例如：分子冷却阈值 m_crit"
              onChange={(event) => {
                setLabel(event.target.value)
                if (error) setError(null)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit()
              }}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="节点类型">
              <Select value={type} onValueChange={(value) => setType(value as NodeType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NODE_TYPE_ORDER.map((item) => (
                    <SelectItem key={item} value={item}>
                      <span className="flex items-center gap-2">
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: NODE_TYPE_COLORS[item] }}
                        />
                        {NODE_TYPE_LABELS[item]}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <p className="text-micro leading-relaxed text-muted-foreground/70">
            全局标签在右侧属性面板里从注册表多选（也可以当场新建），不在这里编辑。
          </p>

          <Field label="摘要" hint="一句话说明">
            <Textarea
              value={summary}
              placeholder="用一句话说明这个节点在知识体系中的位置"
              onChange={(event) => setSummary(event.target.value)}
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={submit}>{mode === 'create' ? '创建节点' : '保存修改'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export interface EdgeFormValues {
  label: string
  type: EdgeType
  directed: boolean
  note: string
}

interface EdgeDialogProps {
  open: boolean
  mode: 'create' | 'edit'
  sourceLabel: string
  targetLabel: string
  initial?: Partial<GraphEdge>
  onOpenChange: (open: boolean) => void
  onSubmit: (values: EdgeFormValues) => void
}

export function EdgeDialog({
  open,
  mode,
  sourceLabel,
  targetLabel,
  initial,
  onOpenChange,
  onSubmit,
}: EdgeDialogProps) {
  const [label, setLabel] = useState('')
  const [type, setType] = useState<EdgeType>('relates_to')
  const [directed, setDirected] = useState(true)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setLabel(initial?.label ?? '')
    setType((initial?.type as EdgeType) ?? 'relates_to')
    setDirected(initial?.directed ?? true)
    setNote(initial?.note ?? '')
    setError(null)
  }, [open, initial])

  const submit = () => {
    const trimmed = label.trim()
    if (!trimmed) {
      setError('关系名称不能为空')
      return
    }
    onSubmit({ label: trimmed, type, directed, note: note.trim() })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? '建立关系' : '编辑关系'}</DialogTitle>
          <DialogDescription className="flex items-center gap-2">
            {/* 源 / 目标沿用 palette 里的强调色，与画布高亮、吸附色同源 */}
            <DotBadge color={HIGHLIGHT_COLOR}>{sourceLabel}</DotBadge>
            <ArrowRight className="h-3 w-3" />
            <DotBadge color={SNAP_COLOR}>{targetLabel}</DotBadge>
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3.5">
          <Field label="关系名称" hint="显示在连边上" error={error}>
            <Input
              autoFocus
              value={label}
              placeholder="例如：依赖、扩展、相斥"
              onChange={(event) => {
                setLabel(event.target.value)
                if (error) setError(null)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit()
              }}
            />
          </Field>

          <div className="grid grid-cols-2 items-end gap-3">
            <Field label="关系类型">
              <Select value={type} onValueChange={(value) => setType(value as EdgeType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EDGE_TYPE_ORDER.map((item) => (
                    <SelectItem key={item} value={item}>
                      {EDGE_TYPE_LABELS[item]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="flex h-8 items-center justify-between rounded-md border border-black/10 bg-black/[0.03] px-2.5">
              <span className="text-micro text-muted-foreground">有向（显示箭头）</span>
              <Switch checked={directed} onCheckedChange={setDirected} />
            </div>
          </div>

          <Field label="备注" hint="可选">
            <Textarea
              value={note}
              placeholder="记录这条关系的依据、出处或需要注意的前提"
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={submit}>{mode === 'create' ? '建立关系' : '保存修改'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
