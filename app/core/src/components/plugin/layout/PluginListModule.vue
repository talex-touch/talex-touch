<script name="PluginListModule" setup>
import PluginIcon from "@comp/plugin/PluginIcon.vue";
import { useModelWrapper } from "@talex-touch/utils/renderer/ref";
import PluginStatus from "@comp/plugin/action/PluginStatus.vue";

const props = defineProps(["modelValue", "plugins", "shrink"]);

const emits = defineEmits(["update:modelValue"]);

const value = useModelWrapper(props, emits);
</script>

<template>
  <div class="PluginList-Module" mb-12 min-h-16>
    <p my-4 flex justify-between items-center>
      <!-- For slot change style (className) -->
      <span class="PluginList-Name">
        <slot name="name" />
      </span>
      <span style="color: var(--el-text-color-secondary)" text-sm class="PluginList-Amo">
        {{ plugins.length }}
      </span>
    </p>

    <!-- <p v-t="'base.empty-select'" :class="{ visible: Object.values(plugins).length > 0 }" class="PluginList-Empty" /> -->
    <p
      v-text="`No selection made.`"
      :class="{ visible: Object.values(plugins).length > 0 }"
      class="PluginList-Empty"
    />

    <transition-group name="list">
      <div
        v-for="(plugin, index) in Object.values(plugins)"
        :key="index"
        class="PluginList-Item fake-background"
        :class="{ shrink, target: plugin.name === value, dev: plugin.dev?.enable }"
        @click="value = plugin.name"
      >
        <PluginIcon :icon="plugin.icon" :alt="plugin.name" />

        <div class="PluginList-Item-Main">
          <p>{{ plugin.name }}</p>

          <p v-if="!shrink">
            {{ plugin.desc }}
          </p>
          <div v-else class="PluginList-ShrinkStatus">
            <PluginStatus :plugin="plugin" :shrink="true" />
          </div>
        </div>
      </div>
    </transition-group>
  </div>
</template>

<style lang="scss" scoped>
.PluginList-Item-Main {
  .PluginList-ShrinkStatus {
    position: absolute;
    padding: 0.5rem 0;

    top: 50%;
    right: 5%;

    border-radius: 18px;
    transform: translateY(-50%);
    overflow: hidden;
  }

  margin-left: 1rem;

  & :first-child {
    margin: 0;

    font-weight: 600;
    font-size: 20px;
  }

  & :last-child {
    margin: 0;

    font-size: 14px;
    color: var(--el-text-color-secondary);
  }

  display: flex;

  flex-direction: column;
  justify-content: space-between;
}

:deep(.PluginIcon-Container) {
  display: flex;

  justify-content: center;
  align-items: center;

  grid-column: 1;
  grid-row: 1 / 3;

  width: 1.25em;
  height: 1.25em;

  font-size: 32px;

  border-radius: 12px;
  box-sizing: border-box;
  background-color: var(--el-fill-color);
}

.PluginList-Item {
  &.dev :deep(.PluginIcon-Container) {
    box-shadow: 0 0 4px 2px var(--el-color-warning-light-5);
  }

  &.target {
    &:before {
      filter: invert(0);
    }

    --fake-opacity: 0.5;
    --fake-inner-opacity: 0.5;

    pointer-events: none;

    border: 2px solid var(--el-color-primary-light-3);
  }

  &.shrink {
    :deep(.PluginIcon-Container) {
      span {
        transform: scale(0.75);
      }
      min-width: 32px;
      height: 32px;

      font-size: 24px;
    }

    .PluginList-Item-Main {
      & :last-child {
        font-size: 16px;
        color: var(--el-text-color-primary);
      }
    }

    &:hover {
      border: 2px solid var(--el-color-primary-light-3);
    }

    height: 64px;

    pointer-events: all !important;
  }

  &:hover {
    &:before {
      filter: invert(0.15);
    }

    --fake-opacity: 0.25;
    --fake-inner-opacity: 0.25;

    border: 2px solid var(--el-border-color);
  }

  display: flex;
  padding: 0 20px;

  align-items: center;

  height: 80px;
  margin: 10px 5px;

  cursor: pointer;
  border-radius: 12px;
  border: 2px solid transparent;

  --fake-opacity: 0;
  --fake-inner-opacity: 0;

  overflow: hidden;
  transition: 0.25s;
}

.list-move,
/* 对移动中的元素应用的过渡 */
.list-enter-active,
.list-leave-active {
  transition: all 0.5s cubic-bezier(0.785, 0.135, 0.15, 0.86);
}

.list-enter-from,
.list-leave-to {
  margin-bottom: -53px;

  opacity: 0;
  transform: translateX(30px);
}

.PluginList-Empty {
  &.visible {
    margin-bottom: -35px;

    opacity: 0;
    transform: translateY(20px);
  }
  margin: 0;
  margin-bottom: 18px;

  text-align: center;

  opacity: 0.75;
  font-size: 14px;

  transition: 0.5s cubic-bezier(0.785, 0.135, 0.15, 0.86);
}
</style>
