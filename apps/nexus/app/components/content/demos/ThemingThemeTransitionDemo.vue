<script setup lang="ts">
import type { ThemeTransitionVariant } from '~/utils/theme-transition'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTheme } from '~/composables/useTheme'

const { locale } = useI18n()
const { color, toggleDark } = useTheme()

const currentVariant = ref<ThemeTransitionVariant>('circle-blur')
const lastCoords = ref<{ x: number, y: number } | null>(null)

const isDark = computed(() => color.value === 'dark')

const variantOptions = computed(() => {
  if (locale.value === 'zh') {
    return [
      { value: 'circle-blur', label: '柔和光晕圆 (circle-blur, 默认)' },
      { value: 'circle', label: '硬边圆形 (circle)' },
      { value: 'polygon', label: '斜切光刃 (polygon)' },
      { value: 'polygon-gradient', label: '渐变光刃 (polygon-gradient)' },
      { value: 'wipe', label: '平推扫光 (wipe)' },
      { value: 'fade', label: '平滑淡出 (fade)' },
      { value: 'circle-blur-top-left', label: '左上角光晕 (circle-blur-top-left)' },
    ]
  }
  return [
    { value: 'circle-blur', label: 'Circle Blur (default)' },
    { value: 'circle', label: 'Circle Sharp' },
    { value: 'polygon', label: 'Polygon Slash' },
    { value: 'polygon-gradient', label: 'Polygon Gradient' },
    { value: 'wipe', label: 'Wipe' },
    { value: 'fade', label: 'Fade' },
    { value: 'circle-blur-top-left', label: 'Circle Blur Top-Left' },
  ]
})

function triggerSwitch(event: MouseEvent) {
  lastCoords.value = {
    x: Math.round(event.clientX),
    y: Math.round(event.clientY),
  }
  const nextMode = isDark.value ? 'light' : 'dark'
  toggleDark(nextMode, event, {
    variant: currentVariant.value,
  })
}
</script>

<template>
  <div class="theme-transition-demo not-prose">
    <div class="theme-transition-demo__controls">
      <label class="theme-transition-demo__field">
        <span class="theme-transition-demo__label">
          {{ locale === 'zh' ? '动效预设' : 'Preset' }}
        </span>
        <select
          v-model="currentVariant"
          class="theme-transition-demo__select"
        >
          <option
            v-for="opt in variantOptions"
            :key="opt.value"
            :value="opt.value"
          >
            {{ opt.label }}
          </option>
        </select>
      </label>

      <div class="theme-transition-demo__info">
        <span class="theme-transition-demo__tag">
          {{ locale === 'zh' ? '当前主题:' : 'Current:' }}
          <b>{{ color.value }}</b>
        </span>
        <span v-if="lastCoords" class="theme-transition-demo__tag theme-transition-demo__tag--coords">
          {{ locale === 'zh' ? '触发坐标:' : 'Origin:' }}
          <b>{{ lastCoords.x }}px, {{ lastCoords.y }}px</b>
        </span>
      </div>
    </div>

    <div
      class="theme-transition-demo__stage"
      @click="triggerSwitch"
    >
      <div class="theme-transition-demo__interactive">
        <button
          type="button"
          class="theme-transition-demo__btn"
          @click.stop="triggerSwitch"
        >
          <span
            class="theme-transition-demo__icon"
            :class="isDark ? 'i-carbon-moon' : 'i-carbon-sun'"
          />
          <span>
            {{
              locale === 'zh'
                ? (isDark ? '切换到浅色模式' : '切换到深色模式')
                : (isDark ? 'Switch to Light' : 'Switch to Dark')
            }}
          </span>
        </button>

        <p class="theme-transition-demo__hint">
          {{
            locale === 'zh'
              ? '点击按钮或舞台任意位置，即可体验以鼠标点击坐标为扩散原点的 View Transition'
              : 'Click the button or anywhere in the stage to trigger a View Transition from the click origin'
          }}
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.theme-transition-demo {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
}

.theme-transition-demo__controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--tx-surface-muted, rgba(148, 163, 184, 0.08));
  border: 1px solid var(--tx-border-subtle, rgba(148, 163, 184, 0.16));
}

.theme-transition-demo__field {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.theme-transition-demo__label {
  font-weight: 500;
  color: var(--tx-text-secondary, #64748b);
}

.theme-transition-demo__select {
  padding: 6px 10px;
  border-radius: 8px;
  font-size: 13px;
  background: var(--tx-surface, #ffffff);
  color: var(--tx-text, #0f172a);
  border: 1px solid var(--tx-border, rgba(148, 163, 184, 0.3));
  outline: none;
  cursor: pointer;
  transition: border-color 0.2s ease;
}

.theme-transition-demo__select:focus {
  border-color: var(--tx-color-primary, #7c5cff);
}

.theme-transition-demo__info {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.theme-transition-demo__tag {
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--tx-surface-elevated, rgba(148, 163, 184, 0.12));
  color: var(--tx-text-secondary, #475569);
}

.theme-transition-demo__tag--coords {
  font-family: monospace;
}

.theme-transition-demo__stage {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 180px;
  padding: 32px 20px;
  border-radius: 16px;
  border: 1px dashed var(--tx-border, rgba(148, 163, 184, 0.3));
  background: var(--tx-surface, rgba(148, 163, 184, 0.03));
  cursor: pointer;
  transition: border-color 0.2s ease, background-color 0.2s ease;
  user-select: none;
}

.theme-transition-demo__stage:hover {
  border-color: var(--tx-color-primary, #7c5cff);
  background: var(--tx-surface-hover, rgba(124, 92, 255, 0.04));
}

.theme-transition-demo__interactive {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  pointer-events: auto;
}

.theme-transition-demo__btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 500;
  background: var(--tx-color-primary, #7c5cff);
  color: #ffffff;
  border: none;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(124, 92, 255, 0.25);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.theme-transition-demo__btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(124, 92, 255, 0.35);
}

.theme-transition-demo__btn:active {
  transform: translateY(0);
}

.theme-transition-demo__icon {
  font-size: 18px;
}

.theme-transition-demo__hint {
  margin: 0;
  font-size: 12px;
  color: var(--tx-text-muted, #94a3b8);
  text-align: center;
  max-width: 420px;
  line-height: 1.5;
}
</style>
