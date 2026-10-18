const { execFileSync } = require('node:child_process')
const path = require('node:path')
const { nativeAddonReleaseDir, verifyMacUpdateHelper } = require('./native-addons')
const { verifyBundle } = require('../legal/pi-desktop-reuse-legal.cjs')

/**
 * Packaging cannot bypass the LGPL delivery: the legal bundle must belong to the out/ build
 * being packed, so a direct `electron-builder` run without a fresh electron-vite build fails.
 */
module.exports = async function beforePack(context) {
  if (context.electronPlatformName === 'darwin') {
    const releaseDir = nativeAddonReleaseDir(context.packager.projectDir)
    execFileSync(
      process.execPath,
      [path.resolve(releaseDir, '..', '..', 'scripts', 'build-update.js'), '--universal'],
      { stdio: 'inherit' }
    )
    verifyMacUpdateHelper(releaseDir)
  }
  const summary = verifyBundle({ appRoot: context.packager.projectDir })
  console.log(
    `[beforePack] Verified pi-desktop-reuse legal bundle: ${summary.entries} source files, ` +
      `archive sha256 ${summary.archiveSha256}`
  )
}
