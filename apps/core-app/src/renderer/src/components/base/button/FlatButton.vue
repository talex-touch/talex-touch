<template>
  <div
    v-wave
    cursor-pointer
    flex
    relative
    role="button"
    :class="{ primary, 'fake-background': !primary, mini }"
    class="FlatButton-Container"
  >
    <span v-wave>
      <slot />
    </span>
  </div>
</template>

<script name="FlatButton" lang="ts" setup>
defineProps({
  primary: Boolean,
  mini: Boolean
})
</script>

<style lang="scss" scoped>
.FlatButton-Container {
  &.primary {
    color: var(--el-color-primary-dark-2);

    border-color: var(--el-color-primary);

    &:hover {
      color: var(--el-text-color-primary);
      //background: linear-gradient(to right, var(--el-color-primary-light-3), var(--el-color-primary-light-5), var(--el-color-primary-light-3));
      background: var(--el-color-primary-light-3);
    }
  }

  &.mini {
    min-width: 32px;
    min-height: 32px;
  }

  display: flex;
  justify-content: center;
  align-items: center;

  min-width: 120px;
  // width: 100%;
  min-height: 32px;

  user-select: none;
  text-indent: 0;

  border-radius: 6px;
  border: 1px solid var(--el-border-color);
  transition: 0.25s;
}
</style>
