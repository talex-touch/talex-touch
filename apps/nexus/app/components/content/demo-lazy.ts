export interface DemoActivationRequest {
  demo?: string
  isActive: boolean
}

/**
 * Demos run on their own once their turn in the activation queue comes up, so
 * any activation request is honoured as long as there is a demo that is not
 * running yet.
 */
export function shouldActivateDemo(request: DemoActivationRequest) {
  return Boolean(request.demo) && !request.isActive
}

/**
 * Longest a queued demo waits for an idle slot. A page that never goes idle
 * still mounts every demo instead of leaving the rest on their placeholders.
 */
export const DEMO_ACTIVATION_IDLE_TIMEOUT_MS = 600

type DemoActivation = () => void

export interface DemoActivationScheduler {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
  setTimeout: (callback: () => void, ms: number) => unknown
}

const pendingActivations: DemoActivation[] = []
let flushScheduled = false

function scheduleActivationFlush(scheduler: DemoActivationScheduler) {
  if (flushScheduled || !pendingActivations.length)
    return

  flushScheduled = true
  const flush = () => {
    flushScheduled = false
    pendingActivations.shift()?.()
    scheduleActivationFlush(scheduler)
  }

  if (typeof scheduler.requestIdleCallback === 'function') {
    scheduler.requestIdleCallback(flush, { timeout: DEMO_ACTIVATION_IDLE_TIMEOUT_MS })
    return
  }
  scheduler.setTimeout(flush, 0)
}

/**
 * Demos do not wait to be scrolled to. Every demo on the page joins one queue
 * in mount (document) order, and the queue starts one per idle slot, so a page
 * of heavy demos does not land as a single long task.
 *
 * Returns a cancel for a wrapper that unmounts before its turn.
 */
export function queueDemoActivation(activate: DemoActivation, scheduler: DemoActivationScheduler = window) {
  pendingActivations.push(activate)
  scheduleActivationFlush(scheduler)

  return () => {
    const index = pendingActivations.indexOf(activate)
    if (index >= 0)
      pendingActivations.splice(index, 1)
  }
}
