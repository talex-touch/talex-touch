<script name="AppList" setup lang="ts">
const props = defineProps<{
  list: any[],
  index: number,
}>()
const emits = defineEmits<{
  (e: "search", val: string): void,
  (e: "select", val: any): void,
}>()

// const _list = ref(props.list)
const search = ref("")

watch(() => search.value, val => {
  emits('search', val)
  // _list.value = props.list.filter(item => item.name.includes(val))
})

function highlightText(text: string, matched: Array<any>) {
  let result = "";

  const [startIndex, endIndex] = matched;

  // replace text index 2 html
  for (let i = 0; i < text.length; i++) {
    if (i >= startIndex && i <= endIndex) {
      result += `<span class="matched">${text[i]}</span>`;
    } else {
      result += text[i];
    }
  }

  return result;
}

function handleClick(item: any, ind: number) {
  // Repeat click => cancel
  if (props.index === ind) {
    emits('select', null, -1)
    return
  }
  emits('select', item, ind)
}
</script>

<template>
  <el-scrollbar>
    <ul class="AppList">
      <div class="AppList-Toolbox">
        <FlatInput v-model="search" placeholder="Type to search..." :fetch="search" />
      </div>
      <li class="fake-background" :class="{ active: index === ind }" @click="handleClick(item, ind)"
        v-for="(item, ind) in list">
        <img :src="item.icon" alt="">

        <div class="Main">
          <p v-if="item.matched" v-html="highlightText(item.name, item.matched)" />
          <p v-else v-text="item.name" />
          <!-- <p class="desc">{{ item.desc }}</p> -->
        </div>
      </li>
    </ul>
    <div class="AppList-Info">
      <span>{{ list.length }} applications in this device.</span>
    </div>
  </el-scrollbar>
</template>

<style lang="scss">
.AppList-Info {
  span {
    opacity: .75;
    font-size: .8rem;
  }
  position: sticky;
  padding: .25rem .5rem;

  bottom: 0;

  background-color: var(--el-fill-color);
}

.AppList-Toolbox {
  z-index: 100;
  position: sticky;
  padding: .25rem 0;

  top: 0;

  background-color: var(--el-fill-color);
}

.AppList li {
  &.active {
    --fake-color: var(--el-color-primary-light-5);
    border: 1px solid var(--el-color-primary);
  }

  padding: 0 .5rem;

  top: .5rem;

  display: flex;
  align-items: center;
  gap: .5rem;

  cursor: pointer;
  transition: .25s;
  border: 1px solid transparent;

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
    --fake-color: var(--el-fill-color);
  }
}
</style>