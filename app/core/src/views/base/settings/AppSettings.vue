<template>
  <ViewTemplate title="Settings">
    <div class="AppSettings-Container">
      <SettingHeader :dev="dev" :env="$env" />

      <SettingUser :env="$env" />

      <SettingLanguage :env="$env" />

      <SettingTools :env="$env" />

      <SettingStorage />

      <SettingAbout :dev="dev" :env="$env" />
    </div>
  </ViewTemplate>
</template>

<script name="AppSettings" setup>
import { useEnv } from "@modules/hooks/env-hooks";
import ViewTemplate from "@comp/base/template/ViewTemplate.vue";
import SettingHeader from "./SettingHeader.vue";
import SettingUser from './SettingUser.vue'
import SettingLanguage from './SettingLanguage.vue'
import SettingTools from "./SettingTools.vue";
import SettingStorage from './SettingStorage.vue';
import SettingAbout from "./SettingAbout.vue";

const $env = reactive({
  os: null,
  process: null,
  packageJson: null,
  account: window.$storage.account,
  sui: window.$startupInfo,
});

const dev = ref(false);

// initially
onMounted(async () => {
  dev.value = process.env.NODE_ENV === "development";

  const env = useEnv();
  $env.os = env.os;
  $env.process = env.process;
  $env.packageJson = env.packageJson;
});
</script>

<style lang="scss" scoped>
.Usage {
  &:before {
    content: "";
    position: absolute;

    left: 0;
    top: 0;

    width: var(--percent, 100%);
    max-width: 100%;
    height: 100%;

    background-color: var(--color, var(--el-color-info));
    border-radius: 2px;
    transition: 1s linear;
  }

  &:after {
    content: attr(data-text);
    position: absolute;

    left: 80%;
  }

  position: relative;
  display: inline-block;

  width: 120px;
  height: 20px;

  border-radius: 4px;
  border: 1px solid var(--el-border-color);
}

.AppSettings-Container {
  position: relative;

  height: 100%;
  width: 100%;
}
</style>
