import { useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, ClipboardCopy, Eye, Loader2, Sparkles, Upload } from 'lucide-react'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Field, Textarea } from './ui/input'
import { Badge, Separator } from './ui/badge'
import { ScrollArea } from './ui/scroll-area'
import { api } from '../api/client'
import type { Graph, ImportPreview, MdDoc } from '../lib/types'

const SAMPLE = JSON.stringify(
  {
    mode: 'merge',
    nodes: [
      { label: '亮温方程', type: 'concept', refs: [{ docId: '21cm-信号基础.md', anchor: '亮温方程' }] },
      { label: '自旋温度', type: 'concept' },
    ],
    edges: [{ source: '亮温方程', target: '自旋温度', label: '依赖', type: 'depends_on' }],
  },
  null,
  2,
)

interface ImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  docs: MdDoc[]
  onImported: (graph: Graph) => void
}

export function ImportDialog({ open, onOpenChange, docs, onImported }: ImportDialogProps) {
  const [payload, setPayload] = useState(SAMPLE)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)

  const parse = () => {
    try {
      return JSON.parse(payload)
    } catch (err) {
      setParseError(`JSON 解析失败：${(err as Error).message}`)
      return null
    }
  }

  const run = (dryRun: boolean) => {
    const draft = parse()
    if (!draft) return
    setParseError(null)
    setBusy(dryRun ? 'preview' : 'apply')
    api
      .importDraft(draft, dryRun)
      .then((result) => {
        setPreview(result.preview)
        if (!dryRun && result.graph) {
          onImported(result.graph)
          toast.success(
            `导入完成：新增 ${result.preview.createdNodes.length} 节点 / ${result.preview.createdEdges.length} 关系`,
            {
              description: result.preview.errors.length ? `另有 ${result.preview.errors.length} 条被跳过` : undefined,
            },
          )
          onOpenChange(false)
        }
      })
      .catch((err: Error) => {
        setParseError(err.message)
        toast.error('导入失败', { description: err.message })
      })
      .finally(() => setBusy(null))
  }

  const copyPrompt = () => {
    const list = docs.map((doc) => `- ${doc.docId}（${doc.title}）`).join('\n')
    const prompt = [
      '你是 Graphify 的建图助手。请阅读下列 markdown 文档，抽取实体与关系，输出一份可直接导入的 JSON。',
      '',
      '【notes 数据库】',
      list || '（数据库为空）',
      '',
      '【读取方式】',
      'GET /api/md             → 文档列表（含标题大纲）',
      'GET /api/md/content?docId=<docId> → 文档原文',
      'GET /api/graph/schema   → JSON Schema 与字段说明',
      '',
      '【输出契约】',
      '{ "mode": "merge", "nodes": [{ "label": "节点名", "type": "concept", "summary": "一句话", "refs": [{ "docId": "x.md", "anchor": "标题slug", "label": "§标题" }] }],',
      '  "edges": [{ "source": "节点名或id", "target": "节点名或id", "label": "关系名", "type": "depends_on" }] }',
      '',
      '【约束】',
      '1. type 取值：concept / doc / method / result / question / dataset / tool',
      '2. 关系 type 取值：depends_on / relates_to / derives_from / references / contradicts / extends',
      '3. 边的 source/target 可以直接写节点名称，服务端会自动解析',
      '4. merge 模式按 id 或 label 去重，可安全重复提交',
      '5. 提交方式：POST /api/graph/import?dryRun=1 先预览，再去掉 dryRun 正式写入',
    ].join('\n')

    navigator.clipboard.writeText(prompt).then(
      () => toast.success('已复制 LLM 建图指令', { description: '粘贴到目标模型即可按契约产出草案' }),
      () => toast.error('复制失败，请检查浏览器剪贴板权限'),
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[760px]">
        <DialogHeader>
          <DialogTitle>LLM 建图端口</DialogTitle>
          <DialogDescription>
            把模型产出的节点 / 关系草案粘贴到这里。服务端会按 <span className="font-mono">id</span> 或
            <span className="font-mono"> label</span> 去重合并，重复提交不会产生冗余节点。
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 grid-cols-2 gap-3.5">
          <Field label="草案 JSON" hint="mode: merge / replace" error={parseError} className="min-w-0">
            <Textarea
              value={payload}
              spellCheck={false}
              onChange={(event) => {
                setPayload(event.target.value)
                setPreview(null)
              }}
              className="h-[318px] min-h-[318px] font-mono text-micro leading-relaxed"
            />
          </Field>

          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-micro font-medium text-muted-foreground">差异预览</span>
              {preview ? <Badge tone="primary">干跑结果</Badge> : null}
            </div>

            <ScrollArea className="h-[318px] rounded-md border border-black/[0.07] bg-black/[0.03]">
              <div className="flex flex-col gap-2.5 p-3">
                {!preview ? (
                  <p className="text-micro leading-relaxed text-muted-foreground">
                    点击「预览差异」可以只校验、不写盘，确认无误后再执行导入。
                  </p>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge tone="success">新增节点 {preview.createdNodes.length}</Badge>
                      <Badge tone="muted">更新节点 {preview.updatedNodeIds.length}</Badge>
                      <Badge tone="primary">新增关系 {preview.createdEdges.length}</Badge>
                      <Badge tone="muted">更新关系 {preview.updatedEdgeIds.length}</Badge>
                    </div>

                    <Separator />

                    {preview.createdNodes.length ? (
                      <div className="flex flex-col gap-1">
                        <span className="text-micro font-medium text-emerald-600/90">将创建</span>
                        {preview.createdNodes.map((node) => (
                          <span key={node.id} className="truncate text-micro text-foreground/85">
                            · {node.label}
                          </span>
                        ))}
                      </div>
                    ) : null}

                    {preview.createdEdges.length ? (
                      <div className="flex flex-col gap-1">
                        <span className="text-micro font-medium text-primary/90">将建立</span>
                        {preview.createdEdges.map((edge) => (
                          <span key={edge.id} className="truncate text-micro text-foreground/85">
                            · {edge.label}
                          </span>
                        ))}
                      </div>
                    ) : null}

                    {preview.errors.length ? (
                      <div className="flex flex-col gap-1">
                        <span className="flex items-center gap-1 text-micro font-medium text-amber-600">
                          <AlertTriangle className="h-3 w-3" />
                          被跳过 {preview.errors.length} 条
                        </span>
                        {preview.errors.map((error) => (
                          <span key={`${error.index}-${error.reason}`} className="text-micro text-amber-700/85">
                            · #{error.index} {error.reason}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="flex items-center gap-1 text-micro text-emerald-600/85">
                        <CheckCircle2 className="h-3 w-3" />
                        没有发现无效条目
                      </span>
                    )}
                  </>
                )}
              </div>
            </ScrollArea>
          </div>
        </div>

        <DialogFooter className="justify-between">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={copyPrompt}>
              <ClipboardCopy className="h-3.5 w-3.5" />
              复制 LLM 指令
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setPayload(SAMPLE)
                setPreview(null)
                setParseError(null)
              }}
            >
              <Sparkles className="h-3.5 w-3.5" />
              填入示例
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button variant="secondary" onClick={() => run(true)} disabled={busy !== null}>
              {busy === 'preview' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
              预览差异
            </Button>
            <Button onClick={() => run(false)} disabled={busy !== null}>
              {busy === 'apply' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              确认导入
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
