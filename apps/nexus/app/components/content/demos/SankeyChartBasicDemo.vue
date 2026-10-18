<script setup lang="ts">
import type { SankeyLinkData, SankeyNodeData } from '@talex-touch/tuffex/charts'
import { TxSankeyChart } from '@talex-touch/tuffex/charts'
import { computed, shallowRef } from 'vue'

const nodes: SankeyNodeData[] = [
  { name: 'Organic', value: 5200 },
  { name: 'Referral', value: 2100 },
  { name: 'Ads', value: 1400 },
  { name: 'Landing', value: 8700, tooltipData: { Sessions: 8700, 'Bounce rate': '34%' } },
  { name: 'Signup', value: 2600, isDrillable: true, childCount: 4 },
  { name: 'Docs', value: 3100 },
  { name: 'Bounce', value: 3000 },
]

// Landing's outflows add up to its inflow (2600 + 3100 + 3000 = 8700): a node
// whose links carry less than its own value leaves a bare tail where d3 lays
// the node out at max(in, out), which reads as an unfinished diagram.
const links: SankeyLinkData[] = [
  { source: 0, target: 3, value: 5200 },
  { source: 1, target: 3, value: 2100 },
  { source: 2, target: 3, value: 1400 },
  { source: 3, target: 4, value: 2600, isDrillable: true },
  { source: 3, target: 5, value: 3100 },
  { source: 3, target: 6, value: 3000 },
]

const { locale } = useI18n()
const copy = computed(() => locale.value === 'zh'
  ? {
      hint: '拖动节点可重新排列；点击节点或连线。',
      node: '节点',
      link: '连线',
      labels: { instructions: '按回车键选中节点。按住 Alt 加上下方向键可移动它；也可拖动节点重新排列，双击背景复位。' },
    }
  : { hint: 'Drag a node to move it; click nodes or links.', node: 'node', link: 'link', labels: undefined })

const lastClick = shallowRef<{ kind: 'node' | 'link', text: string } | null>(null)
const readout = computed(() => lastClick.value ? `${copy.value[lastClick.value.kind]}: ${lastClick.value.text}` : copy.value.hint)
</script>

<template>
  <div class="sankey-demo not-prose">
    <TxSankeyChart
      :nodes="nodes"
      :links="links"
      :height="320"
      :labels="copy.labels"
      @node-click="lastClick = { kind: 'node', text: $event.name }"
      @link-click="lastClick = { kind: 'link', text: String($event.value) }"
    />
    <p class="sankey-demo__readout">
      {{ readout }}
    </p>
  </div>
</template>

<style scoped>
.sankey-demo {
  width: 100%;
}

.sankey-demo__readout {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--tx-chart-text-primary, #6b7280);
}
</style>
