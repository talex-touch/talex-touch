<script name="AppConfigure" setup lang="ts">
import fs from 'fs'
import FlatButton from "@comp/base/button/FlatButton.vue";

const props = defineProps<{
  data: any,
}>()

const info = ref()

!(async () => {
  const res = await fs.statSync(props.data.desc)

  info.value = res
  console.log('stats', res)
})()
</script>

<template>
  <div class="AppConfigure">
    <div class="AppConfigure-Head">
      <div class="AppConfigure-Head-Left">
        <img :src="data.icon" alt="Application Logo">
      </div>
      <div class="AppConfigure-Head-Right">
        <div class="AppConfigure-Head-Right-Top">{{ data.name }}</div>
        <div class="AppConfigure-Head-Right-Bottom">{{ data.desc }}</div>
      </div>
    </div>
    <div class="AppConfigure-Content">
      <el-scrollbar>
        <div class="AppConfigure-Content-Inner">
          <t-group-block name="Application action" icon="auction">
            <t-block-slot title="Launch app" icon="external-link">
              <FlatButton>Launch</FlatButton>
            </t-block-slot>
            <t-block-slot title="Open in explorer" icon="folder-2">
              <FlatButton>Open</FlatButton>
            </t-block-slot>
            <t-block-slot icon="delete-bin-2">
              <template #label>
                <h3>Uninstall app <span color-red>(danger)</span></h3>
              </template>
              <FlatButton hover:bg-red>Uninstall</FlatButton>
            </t-block-slot>
            <t-block-switch guidance title="Application Help" description="Find help through search engine."
              icon="search-2" />
          </t-group-block>

          <t-group-block name="Application stats" icon="dashboard-horizontal">
            <t-block-line title="Name">
              <template #description>
                {{ data.names }}
              </template>
            </t-block-line>
            <t-block-line title="Type" :description="data.type"></t-block-line>
            <t-block-line title="Value" :description="data.value"></t-block-line>
            <t-block-line title="Keywords">
              <template #description>
                {{ data.keyWords }}
              </template>
            </t-block-line>
          </t-group-block>

          {{ info }}

          <t-group-block v-if="info" name="Application specification (External)" icon="apps">
            <t-block-line title="Version">
              <template #description>
                1
              </template>
            </t-block-line>
            <t-block-line title="Size" :description="info.size"></t-block-line>
            <t-block-line title="Dev" :description="info.dev"></t-block-line>
            <t-block-line title="Ino" :description="info.ino"></t-block-line>
            <t-block-line title="Mode" :description="info.mode"></t-block-line>
            <t-block-line title="NLink" :description="info.nlink"></t-block-line>
            <t-block-line title="Uid" :description="info.uid"></t-block-line>
            <t-block-line title="Gid" :description="info.gid"></t-block-line>
            <t-block-line title="RDev" :description="info.rdev"></t-block-line>
            <t-block-line title="BlkSize" :description="info.blksize"></t-block-line>
            <t-block-line title="AtimeMs" :description="info.atimeMs"></t-block-line>
            <t-block-line title="CtimeMs" :description="info.ctimeMs"></t-block-line>
            <t-block-line title="BirthTimeMs" :description="info.birthtimeMs"></t-block-line>
          </t-group-block>
        </div>
      </el-scrollbar>
    </div>
    <div class="AppConfigure-Ends">
      Sure to config and synchronize among devices?
      <FlatButton>
        Save
      </FlatButton>
    </div>
  </div>
</template>

<style lang="scss">
.AppConfigure-Head {
  position: relative;
  padding: 1rem;
  display: flex;

  width: 100%;
  height: 48px;

  gap: 1rem;

  border-bottom: 1px solid var(--el-border-color);

  &-Left {
    position: relative;
    display: flex;

    align-items: center;
    justify-content: center;

    height: 100%;
  }

  &-Right {
    &-Top {
      font-weight: 600;
    }

    &-Bottom {
      opacity: .8;
      font-size: 0.8rem;
    }

    position: relative;
    display: flex;
    flex-direction: column;

    justify-content: center;

    height: 100%;
  }
}

.AppConfigure {
  &-Content {
    &-Inner {
      padding: 0 1rem;
    }

    position: relative;
    padding: 1rem 0;

    width: 100%;
    height: calc(100% - 48px - 64px - 1rem);

    box-sizing: border-box;
  }

  &-Ends {
    position: sticky;
    padding: 0 1rem;
    display: flex;

    align-items: center;
    justify-content: space-between;

    bottom: 0;

    width: 100%;
    height: 64px;

    box-sizing: border-box;
    border-top: 1px solid var(--el-border-color);
  }

  position: relative;
  flex: 1;

  width: 100%;
  height: 100%;
}
</style>