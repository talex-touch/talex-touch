<script name="ApplicationIndex" setup lang="ts">
import AppList from './AppList.vue'
import { touchChannel } from "~/modules/channel/channel-core";

const props = defineProps<{
  modelValue?: boolean,
}>()

const apps = ref();

!(async () => {
  apps.value = await touchChannel.sendSync("core-box-get:apps");

  console.log("apps", apps.value)
})()
</script>

<template>
  <div class="ApplicationIndex">
    <div class="ApplicationList">
      <AppList :list="apps" />
    </div>
    <div class="ApplicationContent">
      This is application.
    </div>
  </div>
</template>

<style lang="scss">
.ApplicationIndex {
  position: relative;
  display: flex;
  height: 100%;

  .ApplicationList {
    min-width: 200px;
    width: 30%;
    height: 100%;
    border-right: 1px solid var(--el-border-color);
  }

  .ApplicationContent {
    flex: 1;
  }
}
</style>