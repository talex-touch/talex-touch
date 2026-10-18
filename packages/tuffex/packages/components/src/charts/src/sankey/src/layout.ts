import type { SankeyLinkData, SankeyNodeData } from './types'
import { sankey, sankeyLinkHorizontal } from 'd3-sankey'

export interface SankeyLayoutOptions {
  width: number
  height: number
  nodeWidth: number
  nodePadding: number
  /** Pixel number or percent string (of `width`). */
  left: number | string
  right: number | string
}

export interface PositionedSankeyNode {
  index: number
  datum: SankeyNodeData
  x0: number
  x1: number
  y0: number
  y1: number
}

export interface PositionedSankeyLink {
  index: number
  datum: SankeyLinkData
  sourceIndex: number
  targetIndex: number
  path: string
  /** Stroke width for the ribbon. */
  width: number
  /** The ribbon's breadth as laid out, before `width`'s 1px floor. */
  breadth: number
  /** Gradient bounds (source right edge → target left edge). */
  x1: number
  x2: number
  /** Where the ribbon's centre leaves the source node. */
  y0: number
  /** Where the ribbon's centre enters the target node. */
  y1: number
}

export interface SankeyLayoutResult {
  nodes: PositionedSankeyNode[]
  links: PositionedSankeyLink[]
}

/** Resolves a px-or-percent edge inset against the container size. */
export function resolveEdgeInset(value: number | string, size: number): number {
  if (typeof value === 'number')
    return value
  const percent = Number.parseFloat(value)
  return Number.isFinite(percent) ? (percent / 100) * size : 0
}

interface LayoutNode {
  index: number
  x0?: number
  x1?: number
  y0?: number
  y1?: number
}

interface LayoutLink {
  source: number | LayoutNode
  target: number | LayoutNode
  value: number
  index?: number
  width?: number
}

/**
 * Runs the d3-sankey layout on copies of the inputs (it mutates them).
 * Returns `null` for degenerate input, including circular links — d3-sankey
 * throws on cycles and a chart should degrade, not crash the host.
 */
export function computeSankeyLayout(
  nodes: SankeyNodeData[],
  links: SankeyLinkData[],
  options: SankeyLayoutOptions,
): SankeyLayoutResult | null {
  if (nodes.length === 0 || options.width <= 0 || options.height <= 0)
    return { nodes: [], links: [] }

  const leftInset = resolveEdgeInset(options.left, options.width)
  const rightInset = resolveEdgeInset(options.right, options.width)

  const layoutNodes: LayoutNode[] = nodes.map((_, index) => ({ index }))
  const layoutLinks: LayoutLink[] = links.map(link => ({
    source: link.source,
    target: link.target,
    value: link.value,
  }))

  const generator = sankey<LayoutNode, LayoutLink>()
    .nodeWidth(options.nodeWidth)
    .nodePadding(options.nodePadding)
    .extent([
      [leftInset, 8],
      [Math.max(leftInset + 1, options.width - rightInset), Math.max(9, options.height - 8)],
    ])

  let layout: { nodes: LayoutNode[], links: LayoutLink[] }
  try {
    layout = generator({ nodes: layoutNodes, links: layoutLinks })
  }
  catch (error) {
    console.warn('[tuffex/charts] TxSankeyChart: invalid sankey input (circular links?)', error)
    return null
  }

  const pathGenerator = sankeyLinkHorizontal()

  return {
    nodes: layout.nodes.map(node => ({
      index: node.index,
      datum: nodes[node.index] as SankeyNodeData,
      x0: node.x0 ?? 0,
      x1: node.x1 ?? 0,
      y0: node.y0 ?? 0,
      y1: node.y1 ?? 0,
    })),
    links: layout.links.map((link, index) => {
      const source = link.source as LayoutNode
      const target = link.target as LayoutNode
      return {
        index,
        datum: links[index] as SankeyLinkData,
        sourceIndex: source.index,
        targetIndex: target.index,
        path: pathGenerator(link as never) ?? '',
        width: Math.max(1, link.width ?? 1),
        breadth: link.width ?? 0,
        x1: source.x1 ?? 0,
        x2: target.x0 ?? 0,
        y0: (link as { y0?: number }).y0 ?? 0,
        y1: (link as { y1?: number }).y1 ?? 0,
      }
    }),
  }
}

/**
 * The layout with nodes moved vertically by `offsets` (node index → px).
 * Ribbons re-route with them. On each node they keep the order d3-sankey
 * stacked them in until two of their other ends trade places, then follow the
 * other ends from top to bottom; an empty map returns `layout` itself.
 */
export function offsetSankeyLayout(
  layout: SankeyLayoutResult,
  offsets: ReadonlyMap<number, number>,
): SankeyLayoutResult {
  if (offsets.size === 0)
    return layout
  const nodes = layout.nodes.map((node) => {
    const offset = offsets.get(node.index) ?? 0
    return offset === 0 ? node : { ...node, y0: node.y0 + offset, y1: node.y1 + offset }
  })
  const byIndex = new Map(nodes.map(node => [node.index, node]))
  const top = (index: number): number => byIndex.get(index)?.y0 ?? 0
  const homeTops = new Map(layout.nodes.map(node => [node.index, node.y0]))
  const homeTop = (index: number): number => homeTops.get(index) ?? 0
  const ends = layout.links.map(() => ({ y0: 0, y1: 0 }))

  const stack = (
    group: Map<number, PositionedSankeyLink[]>,
    otherEnd: (link: PositionedSankeyLink) => number,
    homeEnd: (link: PositionedSankeyLink) => number,
    write: (link: PositionedSankeyLink, y: number) => void,
  ): void => {
    const byOtherEnd = (tops: (index: number) => number) =>
      (a: PositionedSankeyLink, b: PositionedSankeyLink): number => tops(otherEnd(a)) - tops(otherEnd(b)) || a.index - b.index
    for (const [index, links] of group) {
      // d3-sankey does not always leave a node's ribbons sorted by their other
      // ends; sorting them from the first move would jump some of them.
      const now = [...links].sort(byOtherEnd(top))
      const traded = [...links].sort(byOtherEnd(homeTop)).some((link, position) => link !== now[position])
      const ordered = traded ? now : [...links].sort((a, b) => homeEnd(a) - homeEnd(b) || a.index - b.index)
      let y = top(index)
      for (const link of ordered) {
        write(link, y + link.breadth / 2)
        y += link.breadth
      }
    }
  }
  const outgoing = new Map<number, PositionedSankeyLink[]>()
  const incoming = new Map<number, PositionedSankeyLink[]>()
  const add = (group: Map<number, PositionedSankeyLink[]>, index: number, link: PositionedSankeyLink): void => {
    const links = group.get(index)
    if (links)
      links.push(link)
    else
      group.set(index, [link])
  }
  for (const link of layout.links) {
    add(outgoing, link.sourceIndex, link)
    add(incoming, link.targetIndex, link)
  }
  stack(outgoing, link => link.targetIndex, link => link.y0, (link, y) => {
    ends[link.index]!.y0 = y
  })
  stack(incoming, link => link.sourceIndex, link => link.y1, (link, y) => {
    ends[link.index]!.y1 = y
  })

  const pathGenerator = sankeyLinkHorizontal()
  return {
    nodes,
    links: layout.links.map((link) => {
      const { y0, y1 } = ends[link.index]!
      if (y0 === link.y0 && y1 === link.y1)
        return link
      const path = pathGenerator({ source: { x1: link.x1 }, target: { x0: link.x2 }, y0, y1 } as never) ?? ''
      return { ...link, y0, y1, path }
    }),
  }
}
