<script name="TBlockSwitch" setup>
import TSwitch from '@comp/base/switch/TSwitch.vue'
import RemixIcon from '@comp/icon/RemixIcon.vue'
import { sleep } from '@talex-touch/utils/common/utils'
import { useModelWrapper } from '@talex-touch/utils/renderer/ref'
import { nextTick, ref, watch } from 'vue'
// import { $t } from '@modules/lang'

const props = defineProps({
  title: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    required: true,
  },
  modelValue: {
    type: Boolean,
    required: true,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
  icon: {
    type: String,
    required: true,
  },
  guidance: {
    type: Boolean,
    default: false,
  },
})
const emits = defineEmits(['update:modelValue', 'change'])

const mention = ref()
const value = useModelWrapper(props, emits)

watch(() => value.value, (v) => {
  emits('change', value)

  // refresh(v)
}, { immediate: true })

// watch(() => value.value ? $t('base.status-open') : $t('base.status-close'), v => refresh(v))
// function refresh(v) {
//   nextTick(async () => {
//     const _text = v ? $t('base.status-open') : $t('base.status-close')
//
//     const el = mention.value
//     if (!el)
//       return
//
//     Object.assign(el.style, {
//       opacity: 0,
//       transform: 'translateX(5px)',
//     })
//
//     await sleep(200)
//
//     el.innerHTML = _text
//
//     Object.assign(el.style, {
//       opacity: 1,
//       transform: 'translateX(0)',
//     })
//
//     await sleep(200)
//   })
// }
</script>

<template>
  <div class="TBlockSwitch-Container TBlockSelection fake-background index-fix" :class="{ disabled }">
    <div class="TBlockSwitch-Content TBlockSelection-Content">
      <RemixIcon :name="icon" :style="value ? 'fill' : 'line'" />
      <div class="TBlockSwitch-Label TBlockSelection-Label">
        <h3>{{ title }}</h3>
        <p>{{ description }}</p>
      </div>
    </div>
    <div v-if="!guidance" class="TBlockSwitch-Switch TBlockSelection-Func">
      <span display-none ref="mention" style="transition: .2s" />
      <!--      Style sync opacity no external setting disabled -->
      <TSwitch v-model="value" />
    </div>
    <div v-else class="TBlockSwitch-Guidance">
      <RemixIcon name="arrow-right-s" :style="'line'" />
    </div>
  </div>
</template>

<style lang="scss" scoped>
//.TBlockSwitch-Container + .TBlockSwitch-Container {
//  border-radius: 0 0 4px 4px;
//}

.TBlockSwitch-Guidance {
  width: 32px;
  height: 32px;

  display: flex;
  justify-content: center;
  align-items: center;
}

.TBlockSwitch-Container {
  &.disabled {
    .TBlockSwitch-Switch {
      opacity: .5;

      pointer-events: none;
    }
  }

  .TBlockSwitch-Switch {
    display: flex;

    align-items: center;

    span {
      margin-right: 0.5rem;

      font-size: 12px;
    }

  }

  .TBlockSwitch-Content {
    display: flex;
    align-items: center;

    width: 100%;
    height: 100%;

    box-sizing: border-box;

    cursor: pointer;

    >* {
      margin-right: 16px;

      font-size: 24px;
    }

    >.TBlockSwitch-Label {
      flex: 1;

      >h3 {
        margin: 0;

        font-size: 14px;
        font-weight: 500;
      }

      >p {
        margin: 0;

        font-size: 12px;
        font-weight: 400;

        opacity: .5;
      }
    }
  }

  position: relative;
  margin-bottom: 10px;
  padding: 4px 16px;
  display: flex;

  justify-content: space-between;
  align-items: center;

  width: 100%;
  height: 56px;

  user-select: none;
  border-radius: 12px;
  //transition: .5s,;
  box-sizing: border-box;
  --fake-color: var(--el-fill-color-dark);
  --fake-radius: 12px;
  --fake-inner-opacity: .5;

  &:hover {
    --fake-color: var(--el-fill-color);
  }
}

.touch-blur .TBlockSwitch-Container {
  --fake-color: var(--el-fill-color);

  &:hover {
    --fake-color: var(--el-fill-color-light);
  }
}
</style>
