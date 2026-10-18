<script setup lang="ts">
import type { MapGeoJson } from '@talex-touch/tuffex/charts'
import { TxChoroplethMap } from '@talex-touch/tuffex/charts'
import { computed, onMounted, ref, shallowRef } from 'vue'

interface Row { country: string, share: number }

// Typed `string` so Nitro's typed-route inference short-circuits. Served from
// `public/geo` (vendored copy of johan/world.geo.json) rather than the CDN, so
// the demo never depends on a third-party origin to render.
const WORLD_URL: string = '/geo/world-countries.geo.json'

const world = shallowRef<MapGeoJson | null>(null)
const failed = ref(false)
const hovered = shallowRef<Row | null>(null)
const resetKey = ref(0)
const { locale } = useI18n()
const copy = computed(() => locale.value === 'zh'
  ? {
      loading: '正在加载世界地图…',
      failed: '世界地图加载失败。',
      hint: '悬停查看份额；拖拽平移，⌘/Ctrl + 滚轮缩放，双击复位。',
      labels: {
        map: '世界地图',
        instructions: '拖拽或用方向键平移。双指捏合、按住 Control 或 Command 滚动，或按加号减号缩放。双击或按 0 复位。',
      },
    }
  : {
      loading: 'Loading world GeoJSON…',
      failed: 'World GeoJSON failed to load.',
      hint: 'Hover for the share; drag to pan, ⌘/Ctrl + scroll to zoom, double-click to reset.',
      labels: { map: 'World map' },
    })

const data: Row[] = [
  { country: 'United States of America', share: 31 },
  { country: 'China', share: 24 },
  { country: 'Germany', share: 11 },
  { country: 'Brazil', share: 8 },
  { country: 'India', share: 14 },
  { country: 'Australia', share: 5 },
  { country: 'South Africa', share: 3 },
]

// Plain-function view of $fetch: Nitro's typed-route inference explodes on
// arbitrary external URLs (TS2589).
const fetchGeoJson = $fetch as (url: string) => Promise<MapGeoJson>

onMounted(async () => {
  try {
    world.value = await fetchGeoJson(WORLD_URL)
  }
  catch {
    failed.value = true
  }
})

// Remounting the map restores the initial view without fetching the GeoJSON again.
function resetDemo(): void {
  hovered.value = null
  resetKey.value += 1
}

defineExpose({ resetDemo })
</script>

<template>
  <div class="map-demo not-prose">
    <TxChoroplethMap
      v-if="world"
      :key="resetKey"
      :geo-json="world"
      :data="data"
      name="country"
      value="share"
      show-legend
      :labels="copy.labels"
      :value-format="(value: number) => `${value}%`"
      @region-hover="hovered = $event ?? null"
    />
    <p v-if="world" class="map-demo__readout">
      {{ hovered ? `${hovered.country}: ${hovered.share}%` : copy.hint }}
    </p>
    <p v-else class="map-demo__placeholder">
      {{ copy[failed ? 'failed' : 'loading'] }}
    </p>
  </div>
</template>

<style scoped>
.map-demo {
  width: 100%;
}

.map-demo__readout {
  margin: 12px 0 0;
  font-size: 13px;
  color: var(--tx-chart-text-primary, #6b7280);
}

.map-demo__placeholder {
  margin: 0;
  padding: 48px 0;
  font-size: 12px;
  color: var(--tx-chart-text-primary, #6b7280);
  text-align: center;
}
</style>
