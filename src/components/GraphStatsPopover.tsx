import * as PopoverPrimitive from '@radix-ui/react-popover'
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip as ChartTooltip, XAxis } from 'recharts'
import { BarChart3 } from 'lucide-react'
import { Button } from './ui/button'
import { Badge, Separator } from './ui/badge'
import { Tooltip } from './ui/tooltip'
import {
  EDGE_TYPE_LABELS,
  EDGE_TYPE_ORDER,
  NODE_TYPE_COLORS,
  NODE_TYPE_LABELS,
  NODE_TYPE_ORDER,
  type Graph,
} from '../lib/types'
import { EDGE_LABEL_COLOR, LABEL_COLOR } from '../graph/palette'

export function GraphStatsPopover({ graph }: { graph: Graph }) {
  const nodeData = NODE_TYPE_ORDER.map((type) => ({
    name: NODE_TYPE_LABELS[type],
    value: graph.nodes.filter((node) => node.type === type).length,
    color: NODE_TYPE_COLORS[type],
  })).filter((item) => item.value > 0)

  const edgeData = EDGE_TYPE_ORDER.map((type) => ({
    name: EDGE_TYPE_LABELS[type],
    value: graph.edges.filter((edge) => edge.type === type).length,
  })).filter((item) => item.value > 0)

  const isolated = graph.nodes.filter(
    (node) => !graph.edges.some((edge) => edge.source === node.id || edge.target === node.id),
  ).length

  const refs = graph.nodes.reduce((sum, node) => sum + node.refs.length, 0)
  const tagged = graph.nodes.filter((node) => node.tags.length > 0).length

  return (
    <PopoverPrimitive.Root>
      <Tooltip content="图谱统计">
        <PopoverPrimitive.Trigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="图谱统计">
            <BarChart3 className="h-3.5 w-3.5" />
          </Button>
        </PopoverPrimitive.Trigger>
      </Tooltip>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={8}
          className="glass-panel z-[70] w-[292px] animate-in fade-in-0 zoom-in-95 rounded-lg p-3.5"
        >
          <h3 className="text-tiny font-semibold">图谱统计</h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge tone="muted">{graph.nodes.length} 节点</Badge>
            <Badge tone="muted">{graph.edges.length} 关系</Badge>
            <Badge tone={refs > 0 ? 'primary' : 'muted'}>{refs} 引用</Badge>
            <Badge tone={isolated > 0 ? 'warning' : 'muted'}>{isolated} 孤立节点</Badge>
            <Badge tone="muted">{tagged} 已打标签</Badge>
          </div>

          <Separator className="my-3" />

          <span className="text-micro text-muted-foreground">节点类型分布</span>
          <div className="mt-1.5 h-[92px]">
            {nodeData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={nodeData} margin={{ top: 6, right: 0, left: 0, bottom: 0 }}>
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 10, fill: EDGE_LABEL_COLOR }}
                    axisLine={false}
                    tickLine={false}
                    interval={0}
                  />
                  <ChartTooltip
                    cursor={{ fill: 'rgba(15,23,42,0.05)' }}
                    contentStyle={{
                      background: 'rgba(255,255,255,0.98)',
                      border: '1px solid rgba(15,23,42,0.1)',
                      borderRadius: 8,
                      fontSize: 11,
                      boxShadow: '0 10px 30px -14px rgba(15,23,42,0.22)',
                    }}
                    labelStyle={{ color: LABEL_COLOR }}
                    formatter={(value) => [`${value ?? 0} 个`, '数量']}
                  />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={26}>
                    {nodeData.map((item) => (
                      <Cell key={item.name} fill={item.color} fillOpacity={0.78} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="pt-6 text-center text-micro text-muted-foreground">暂无节点</p>
            )}
          </div>

          {edgeData.length ? (
            <>
              <Separator className="my-3" />
              <span className="text-micro text-muted-foreground">关系类型分布</span>
              <ul className="mt-1.5 flex flex-col gap-1">
                {edgeData.map((item) => (
                  <li key={item.name} className="flex items-center justify-between text-micro">
                    <span className="text-foreground/80">{item.name}</span>
                    <span className="tabular-nums text-muted-foreground">{item.value}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
