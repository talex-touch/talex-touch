import type { App, MessageBoxSyncOptions } from 'electron'
import { BrowserWindow, dialog } from 'electron'
import { t } from '../utils/i18n-helper'
import { getCurrentTouchApp } from './main-runtime-state'

const LEAVE = 0

function visibleOwner(contents: Electron.WebContents): BrowserWindow | null {
  const owner = BrowserWindow.fromWebContents(contents)
  // A sheet on a hidden window cannot be seen, and the main process waits on it for good.
  return owner && !owner.isDestroyed() && owner.isVisible() ? owner : null
}

/**
 * Asks the user when a page wants to stay: its `beforeunload` cancelled a reload or a close, as
 * a form with unsaved changes does. Electron does not ask by itself - without this the page simply
 * stays, and nothing says why. Every page is covered, plugin pages included.
 *
 * While the app quits the page is let go: the renderers have saved what they could by then, and a
 * quit that one page can veto in silence never finishes.
 */
export function installLeaveGuard(electronApp: App): void {
  electronApp.on('web-contents-created', (_event, contents) => {
    contents.on('will-prevent-unload', (event) => {
      if (getCurrentTouchApp()?.isQuitting) {
        event.preventDefault()
        return
      }
      const options: MessageBoxSyncOptions = {
        type: 'question',
        buttons: [t('app.leaveGuard.leave'), t('app.leaveGuard.stay')],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
        message: t('app.leaveGuard.message'),
        detail: t('app.leaveGuard.detail')
      }
      // Synchronous by necessity: the page is let go only from inside this handler.
      const owner = visibleOwner(contents)
      const choice = owner
        ? dialog.showMessageBoxSync(owner, options)
        : dialog.showMessageBoxSync(options)
      if (choice === LEAVE) event.preventDefault()
    })
  })
}
