import { ErrorCodes, getCurrentInstance, handleError } from 'vue'

/** Return `false`, or a promise of it, to stay open. */
export type BeforeClose<Reason extends string> = (reason: Reason) => boolean | void | Promise<boolean | void>

/**
 * Closing at the user's request, through the host's `beforeClose`. A
 * synchronous answer closes at once. While a promise is pending, further
 * requests are dropped, and once it resolves nothing closes if the surface was
 * closed some other way meanwhile. A guard that throws or rejects keeps the
 * surface open and goes to the app's error handler. Call it in `setup`.
 */
export function useGuardedClose<Reason extends string>(
  guard: () => BeforeClose<Reason> | undefined,
  isOpen: () => boolean,
  close: () => void,
): (reason: Reason) => void {
  const instance = getCurrentInstance()
  let deciding = false

  function report(error: unknown): void {
    handleError(error, instance, ErrorCodes.COMPONENT_EVENT_HANDLER, false)
  }

  return (reason) => {
    if (deciding)
      return
    let verdict: ReturnType<BeforeClose<Reason>>
    try {
      verdict = guard()?.(reason)
    }
    catch (error) {
      report(error)
      return
    }
    if (!verdict || typeof verdict !== 'object' || typeof verdict.then !== 'function') {
      if (verdict !== false)
        close()
      return
    }
    deciding = true
    Promise.resolve(verdict)
      .then((result) => {
        if (result !== false && isOpen())
          close()
      }, report)
      .finally(() => {
        deciding = false
      })
  }
}
