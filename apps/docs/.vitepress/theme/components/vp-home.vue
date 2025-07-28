<script lang="ts" setup>
import { onMounted } from 'vue';
import TouchBanner from './base/TouchBanner.vue';
import TouchText from './base/TouchText.vue';

</script>

<template>
  <div class="Home">
    <TouchBanner>
      <template #center>
        <TouchText />
      </template>
    </TouchBanner>
    hi
  </div>
</template>

<style lang="scss" scoped>
.Home {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 100%;
}
</style>

<style lang="scss">
.VPContent.is-home {
  display: flex;
  padding: 0 !important;
  height: 100%;

  .VPHome {
    & > div {
      display: flex;
      flex-grow: 1;
      & > div {
        flex-grow: 1;
      }
    }
    flex-grow: 1;
    padding: 0;
    width: 100%;
    height: 100%;
    min-width: 100%;
    min-height: 100%;
  }
}
</style>
