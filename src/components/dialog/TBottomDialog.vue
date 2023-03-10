<template>
  <div ref="wholeDom" class="TBottomDialog-Container">
    <p class="dialog-title">{{ title }}</p>
    <div class="dialog-content">
      {{ message }}
    </div>
    <div class="dialog-btns">
      <span v-for="(btn, index) in btnArray" :key="index" v-wave
            @click="clickBtn(btn)" :class="{ 'info-tip': btn.value?.type === 'info',
            'warn-tip': btn.value?.type === 'warning',
            'error-tip': btn.value?.type === 'error',
            'success-tip': btn.value?.type === 'success', 'loading-tip': btn.value.loading }"
            class="btn-item">
            <span class="TDialogTip-Btn-Item-Loading">
              <Loading />
            </span>
            <span v-if="btn.value.time" class="TDialogTip-Container-Btn-Item-Text">{{ btn.value.content }} ({{ btn.value.time }}s)</span>
            <span v-else class="TDialogTip-Container-Btn-Item-Text">{{ btn.value.content }}</span>
          </span>
    </div>
  </div>
</template>

<script>
export default {
  name: "TBottomDialog"
}
</script>

<script setup>
import Loading from './../icon/LoadingIcon.vue'
import { defineProps, onMounted, ref, watchEffect } from 'vue'
import { sleep } from '@modules/utils'

const props = defineProps({
  title: String, message: String, stay: Number, close: Function,
  btns: Array, icon: String
})

const btnArray = ref([])

const wholeDom = ref(null)

const forClose = ref(async () => {

  const style = wholeDom.value?.style

  style.transform = 'translate(-50%, -50%) scale(.8) translateY(100%)'

  await sleep(100)

  style.opacity = '0'

  await sleep(100)

  props.close()

  window.removeEventListener('scroll', listener)

})

const clickBtn = ref(async (btn) => {

  btn.value.loading = true

  await sleep(400)

  if( await btn.value.onClick() ) {

    forClose.value()

  }

  btn.value.loading = false

})

watchEffect(() => {

  const array = [];

  ([ ...props.btns ]).forEach(btn => {

    const obj = ref({
      loading: false,
      ...btn
    })

    if( btn.loading ) {

      obj.value.loading = true

      btn.loading(() => {

        obj.value.loading = false

      })

    }

    if( btn.time ) {

      const _clickBtn = clickBtn

      function refresh() {

        setTimeout(() => {

          obj.value.time -= 1

          if ( obj.value.time <= 0 ) {

            _clickBtn(obj)

            return

          }

          refresh()

        }, 1000)

      }

      refresh()

    }

    array.push(obj)

  })

  btnArray.value = array

})

// couldn't move
let listener = (e) => {

  window.scrollTo({
    top: 0
  })

}

onMounted(() => {

  window.addEventListener('scroll', listener)

})
</script>

<style lang="scss" scoped>
.TBottomDialog-Container {
  .dialog-title {
    font-weight: 600;
    font-size: 20px;
  }
  .dialog-content {
    position: relative;
    display: flex;
    padding: 4px 8px;

    align-items: center;

    width: max-content;

    border-radius: 8px;
    box-sizing: border-box;
    background-color: var(--el-fill-color-light);
  }
  .dialog-btns {
    .btn-item {
      .TDialogTip-Btn-Item-Loading {
        position: absolute;
        display: inline-block;
        top: -10px;
        left: 50%;

        width: 16px;
        height: 16px;

        transform: scale(0) translateX(-50%);
        opacity: 0;
        --bg-color: var(--theme-color);
      }
      position: relative;
      margin: 8px 0;
      padding: 4px 12px;

      text-align: center;
      width: 100%;

      border-radius: 8px;
      box-sizing: border-box;
      transition: .25s;
      user-select: none;
      background-color: var(--theme-color, var(--el-color-info));
      &:hover {
        cursor: pointer;
        opacity: .75;
      }
    }
    position: absolute;
    display: flex;

    flex-direction: column;

    bottom: 5%;
    //left: 10%;

    width: 80%;
  }
  z-index: 1;
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;

  left: 50%;
  bottom: 2%;

  width: 35%;
  height: auto;
  min-height: 260px;

  border-radius: 8px;
  text-align: center;
  box-shadow: var(--el-box-shadow-light);
  background-color: var(--el-fill-color-light);
  transform: translateX(-50%);
  animation: enter .3s ease-in-out;
  transition: .25S;
}

@keyframes enter {
    0% {
        opacity: 0;
        transform: scale(.8) translateX(-50%) translateY(100%);
    }
    100% {
        opacity: 1;
        transform: scale(1) translateX(-50%) translateY(0);
    }
}

.success-tip {

  --theme-color: var(--el-color-success);

}

.info-tip {

  --theme-color: var(--el-color-primary);

}

.warn-tip {

  --theme-color: var(--el-color-warning);

}

.error-tip {

  --theme-color: var(--el-color-danger);

}
</style>