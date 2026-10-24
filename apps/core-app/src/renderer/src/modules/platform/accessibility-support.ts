import type { ITuffTransport } from '@talex-touch/utils/transport'
import type { Ref } from 'vue'
import { AppEvents } from '@talex-touch/utils/transport/events'
import { readonly, ref } from 'vue'

// Assumed until main answers, so a screen reader never meets a terminal without its
// accessibility tree.
const enabled = ref(true)

/** Follows whether assistive technology such as a screen reader is using the app. */
export function registerAccessibilitySupport(transport: ITuffTransport): void {
  let changed = false
  transport.on(AppEvents.system.accessibilitySupportChanged, (value) => {
    changed = true
    enabled.value = value === true
  })
  void transport.send(AppEvents.system.accessibilitySupportGet).then(
    (value) => {
      if (!changed) enabled.value = value === true
    },
    () => {}
  )
}

export function useAccessibilitySupport(): Readonly<Ref<boolean>> {
  return readonly(enabled)
}
