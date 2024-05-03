<script name="AppList" setup lang="ts">
const props = defineProps<{
  list: any[],
}>()

const _list = ref(props.list)
const search = ref("")

watch(() => search.value, val => {
  _list.value = props.list.filter(item => item.name.includes(val))
})
</script>

<template>
  <el-scrollbar>
    <ul class="AppList">
      <div class="AppList-Toolbox">
        <FlatInput v-model="search" placeholder="Type to search..." :fetch="search" />
      </div>
      <li v-for="item in _list">
        <!-- 生成一个经典的图标 + 标题 介绍 的布局 -->
        <img :src="item.icon" alt="">

        <div class="Main">
          <p>{{ item.name }}</p>
          <!-- <p class="desc">{{ item.desc }}</p> -->
        </div>
      </li>
    </ul>
  </el-scrollbar>
</template>

<style lang="scss">
.AppList-Toolbox {
  position: sticky;
  padding-bottom: .5rem;

  top: 0;

  backdrop-filter: blur(10px);
}

.AppList li {
  padding: 0 .5rem;

  display: flex;
  align-items: center;
  gap: .5rem;

  img {
    width: 2rem;
    height: 2rem;
  }

  .Main {
    p {
      margin: 0;
      font-size: .8rem;
    }

    .desc {
      font-size: .8rem;
      color: var(--el-text-color-secondary);
    }
  }
}

.AppList {
  display: flex;
  margin: 0;
  padding: 1rem .5rem;

  gap: .5rem;
  flex-direction: column;

  list-style: none;

  li {
    height: 48px;
    overflow: hidden;

    border-radius: 8px;
    background-color: var(--el-fill-color);
  }
}
</style>