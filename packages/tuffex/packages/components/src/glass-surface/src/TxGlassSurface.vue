<script setup lang="ts">
import type { GlassSurfaceProps } from '../index'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { hasDocument, hasNavigator, hasWindow } from '../../../../utils/env'

defineOptions({
  name: 'TxGlassSurface',
})

const props = withDefaults(defineProps<GlassSurfaceProps>(), {
  width: '200px',
  height: '200px',
  borderRadius: 20,
  borderWidth: 0.07,
  brightness: 70,
  opacity: 0.93,
  blur: 11,
  displace: 0.5,
  backgroundOpacity: 0,
  saturation: 1,
  distortionScale: -180,
  redOffset: 0,
  greenOffset: 10,
  blueOffset: 20,
  xChannel: 'R',
  yChannel: 'G',
  mixBlendMode: 'difference',
})

const containerRef = ref<HTMLDivElement | null>(null)
const feImageRef = ref<SVGImageElement | null>(null)
const redChannelRef = ref<SVGFEDisplacementMapElement | null>(null)
const greenChannelRef = ref<SVGFEDisplacementMapElement | null>(null)
const blueChannelRef = ref<SVGFEDisplacementMapElement | null>(null)
const gaussianBlurRef = ref<SVGFEGaussianBlurElement | null>(null)

function generateUniqueId() {
  return Math.random().toString(36).substring(2, 15)
}

const uniqueId = generateUniqueId()
const filterId = `tx-glass-filter-${uniqueId}`
const redGradId = `tx-glass-red-grad-${uniqueId}`
const blueGradId = `tx-glass-blue-grad-${uniqueId}`

let resizeObserver: ResizeObserver | null = null
let resizeTimer: ReturnType<typeof setTimeout> | null = null
let isUnmounted = false

function supportsSVGFilters() {
  if (!hasWindow() || !hasNavigator() || !hasDocument())
    return false

  const isWebkit = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent)
  const isFirefox = /Firefox/.test(navigator.userAgent)

  if (isWebkit || isFirefox)
    return false

  const value = `url(#${filterId})`
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function')
    return false
  return CSS.supports('backdrop-filter', value) || CSS.supports('-webkit-backdrop-filter', value)
}

function supportsBackdropFilter() {
  if (!hasWindow())
    return false
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function')
    return false
  return CSS.supports('backdrop-filter', 'blur(10px)')
}

/**
 * Longest side of the displacement map, in pixels. Chromium copies an feImage into every compositor
 * frame that draws a backdrop `url()` filter, rasterized on the CPU at the size it is drawn, so a
 * map as large as the surface cost a 1526×1886 panel 100–200ms a frame. The map is two ramps under
 * a blurred rect: drawn at this size and stretched, it displaces within a pixel of the full one.
 */
const MAP_MAX_SIDE = 256

/** The canvas name of the blend mode the map's blue ramp uses; null for the one canvas lacks, which keeps the SVG map. */
function canvasBlendOperation(mode: GlassSurfaceProps['mixBlendMode']): GlobalCompositeOperation | null {
  if (!mode || mode === 'normal')
    return 'source-over'
  if (mode === 'plus-lighter')
    return 'lighter'
  if (mode === 'plus-darker')
    return null
  return mode
}

function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2))
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + width, y, x + width, y + height, r)
  ctx.arcTo(x + width, y + height, x, y + height, r)
  ctx.arcTo(x, y + height, x, y, r)
  ctx.arcTo(x, y, x + width, y, r)
  ctx.closePath()
}

/**
 * The map below, drawn into a canvas of at most MAP_MAX_SIDE pixels; null where the SVG filter is not
 * used (the map is then never read), or a 2D context or the blend mode is unavailable. Both ramps
 * start from transparent black, as the SVG stops do, so Chrome gives the two the same channel values.
 */
function drawDisplacementMap(width: number, height: number): string | null {
  const blend = canvasBlendOperation(props.mixBlendMode)
  if (!blend || !supportsSVGFilters())
    return null
  const scale = Math.min(1, MAP_MAX_SIDE / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  let ctx: CanvasRenderingContext2D | null = null
  try {
    ctx = canvas.getContext('2d')
  }
  catch {
    ctx = null
  }
  if (!ctx)
    return null

  ctx.scale(canvas.width / width, canvas.height / height)
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, width, height)

  const red = ctx.createLinearGradient(width, 0, 0, 0)
  red.addColorStop(0, 'rgba(0, 0, 0, 0)')
  red.addColorStop(1, '#f00')
  roundedRectPath(ctx, 0, 0, width, height, props.borderRadius)
  ctx.fillStyle = red
  ctx.fill()

  const blue = ctx.createLinearGradient(0, 0, 0, height)
  blue.addColorStop(0, 'rgba(0, 0, 0, 0)')
  blue.addColorStop(1, '#00f')
  ctx.globalCompositeOperation = blend
  roundedRectPath(ctx, 0, 0, width, height, props.borderRadius)
  ctx.fillStyle = blue
  ctx.fill()
  ctx.globalCompositeOperation = 'source-over'

  // Canvas filters ignore the transform, so the blur is scaled by hand.
  const edgeSize = Math.min(width, height) * (props.borderWidth * 0.5)
  ctx.filter = `blur(${props.blur * scale}px)`
  ctx.fillStyle = `hsl(0 0% ${props.brightness}% / ${props.opacity})`
  roundedRectPath(ctx, edgeSize, edgeSize, width - edgeSize * 2, height - edgeSize * 2, props.borderRadius)
  ctx.fill()

  return canvas.toDataURL('image/png')
}

function svgDisplacementMap(actualWidth: number, actualHeight: number) {
  const edgeSize = Math.min(actualWidth, actualHeight) * (props.borderWidth * 0.5)

  const svgContent = `
      <svg viewBox="0 0 ${actualWidth} ${actualHeight}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="${redGradId}" x1="100%" y1="0%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="#0000"/>
            <stop offset="100%" stop-color="red"/>
          </linearGradient>
          <linearGradient id="${blueGradId}" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#0000"/>
            <stop offset="100%" stop-color="blue"/>
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="${actualWidth}" height="${actualHeight}" fill="black"></rect>
        <rect x="0" y="0" width="${actualWidth}" height="${actualHeight}" rx="${props.borderRadius}" fill="url(#${redGradId})" />
        <rect x="0" y="0" width="${actualWidth}" height="${actualHeight}" rx="${props.borderRadius}" fill="url(#${blueGradId})" style="mix-blend-mode: ${props.mixBlendMode}" />
        <rect x="${edgeSize}" y="${edgeSize}" width="${actualWidth - edgeSize * 2}" height="${actualHeight - edgeSize * 2}" rx="${props.borderRadius}" fill="hsl(0 0% ${props.brightness}% / ${props.opacity})" style="filter:blur(${props.blur}px)" />
      </svg>
    `

  return `data:image/svg+xml,${encodeURIComponent(svgContent)}`
}

function updateDisplacementMap() {
  if (isUnmounted)
    return

  if (feImageRef.value) {
    const rect = containerRef.value?.getBoundingClientRect()
    const width = rect?.width || 400
    const height = rect?.height || 200
    feImageRef.value.setAttribute('href', drawDisplacementMap(width, height) ?? svgDisplacementMap(width, height))
  }
}

function updateFilterElements() {
  if (isUnmounted)
    return

  const elements = [
    { el: redChannelRef.value, offset: props.redOffset },
    { el: greenChannelRef.value, offset: props.greenOffset },
    { el: blueChannelRef.value, offset: props.blueOffset },
  ]

  for (const { el, offset } of elements) {
    if (el) {
      el.setAttribute('scale', (props.distortionScale + offset).toString())
      el.setAttribute('xChannelSelector', props.xChannel)
      el.setAttribute('yChannelSelector', props.yChannel)
    }
  }

  if (gaussianBlurRef.value) {
    gaussianBlurRef.value.setAttribute('stdDeviation', props.displace.toString())
  }
}

const containerStyles = computed(() => {
  const monochromeMask = 'var(--tx-surface-refraction-mask-rgb, 255 255 255)'
  const baseStyles: Record<string, string | number> = {
    width: typeof props.width === 'number' ? `${props.width}px` : props.width,
    height: typeof props.height === 'number' ? `${props.height}px` : props.height,
    borderRadius: `${props.borderRadius}px`,
  }

  const fallbackBlur = Math.max(0, props.blur)
  const svgSupported = supportsSVGFilters()
  const backdropFilterSupported = supportsBackdropFilter()

  if (svgSupported) {
    return {
      ...baseStyles,
      background: `rgb(${monochromeMask} / ${props.backgroundOpacity})`,
      backdropFilter: `url(#${filterId}) saturate(${props.saturation})`,
    }
  }

  if (!backdropFilterSupported) {
    return {
      ...baseStyles,
      background: `rgb(${monochromeMask} / 0.4)`,
      border: `1px solid rgb(${monochromeMask} / 0.24)`,
    }
  }

  return {
    ...baseStyles,
    background: `rgb(${monochromeMask} / 0.22)`,
    backdropFilter: `blur(${fallbackBlur}px) saturate(1.8) brightness(1.06)`,
    WebkitBackdropFilter: `blur(${fallbackBlur}px) saturate(1.8) brightness(1.06)`,
    border: `1px solid rgb(${monochromeMask} / 0.24)`,
  }
})

onMounted(() => {
  isUnmounted = false

  nextTick(() => {
    if (isUnmounted)
      return

    updateDisplacementMap()
    updateFilterElements()

    if (containerRef.value && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        if (resizeTimer)
          clearTimeout(resizeTimer)
        resizeTimer = setTimeout(() => {
          resizeTimer = null
          updateDisplacementMap()
        }, 0)
      })
      resizeObserver.observe(containerRef.value)
    }
  })
})

onBeforeUnmount(() => {
  isUnmounted = true
  resizeObserver?.disconnect()
  resizeObserver = null
  if (resizeTimer) {
    clearTimeout(resizeTimer)
    resizeTimer = null
  }
})

watch(
  [
    () => props.width,
    () => props.height,
    () => props.borderRadius,
    () => props.borderWidth,
    () => props.brightness,
    () => props.opacity,
    () => props.blur,
    () => props.displace,
    () => props.distortionScale,
    () => props.redOffset,
    () => props.greenOffset,
    () => props.blueOffset,
    () => props.xChannel,
    () => props.yChannel,
    () => props.mixBlendMode,
  ],
  () => {
    updateDisplacementMap()
    updateFilterElements()
  },
)
</script>

<template>
  <div ref="containerRef" class="tx-glass-surface" :style="containerStyles">
    <svg class="tx-glass-surface__svg" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter :id="filterId" color-interpolation-filters="sRGB" x="0%" y="0%" width="100%" height="100%">
          <feImage
            ref="feImageRef"
            x="0"
            y="0"
            width="100%"
            height="100%"
            preserveAspectRatio="none"
            result="map"
          />

          <feDisplacementMap ref="redChannelRef" in="SourceGraphic" in2="map" result="dispRed" />
          <feColorMatrix
            in="dispRed"
            type="matrix"
            values="1 0 0 0 0
                    0 0 0 0 0
                    0 0 0 0 0
                    0 0 0 1 0"
            result="red"
          />

          <feDisplacementMap ref="greenChannelRef" in="SourceGraphic" in2="map" result="dispGreen" />
          <feColorMatrix
            in="dispGreen"
            type="matrix"
            values="0 0 0 0 0
                    0 1 0 0 0
                    0 0 0 0 0
                    0 0 0 1 0"
            result="green"
          />

          <feDisplacementMap ref="blueChannelRef" in="SourceGraphic" in2="map" result="dispBlue" />
          <feColorMatrix
            in="dispBlue"
            type="matrix"
            values="0 0 0 0 0
                    0 0 0 0 0
                    0 0 1 0 0
                    0 0 0 1 0"
            result="blue"
          />

          <feBlend in="red" in2="green" mode="screen" result="rg" />
          <feBlend in="rg" in2="blue" mode="screen" result="output" />
          <feGaussianBlur ref="gaussianBlurRef" in="output" stdDeviation="0.7" />
        </filter>
      </defs>
    </svg>

    <div class="tx-glass-surface__content">
      <slot />
    </div>
  </div>
</template>

<style lang="scss">
@use '../../../style/mixins.scss' as *;

.tx-glass-surface {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  transition: opacity 260ms ease-out;

  // High contrast: an opaque panel instead of glass. The material is an inline style, hence the
  // `!important`.
  @include tx-when-high-contrast {
    background: var(--tx-bg-color-overlay, #fff) !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
  }
}

.tx-glass-surface__svg {
  width: 100%;
  height: 100%;
  pointer-events: none;
  position: absolute;
  inset: 0;
  opacity: 0;
  z-index: -1;
}

.tx-glass-surface__content {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: inherit;
  position: relative;
  z-index: 1;
}
</style>
