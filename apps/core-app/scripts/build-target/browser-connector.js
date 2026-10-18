'use strict'

const fs = require('node:fs')
const path = require('node:path')

function verifyBrowserConnectorAssets(directory) {
  const root = path.resolve(directory)
  const manifestPath = path.join(root, 'manifest.json')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  if (
    manifest.manifest_version !== 3 ||
    !manifest.background?.service_worker ||
    !manifest.action?.default_popup
  ) {
    throw new Error('Chrome connector manifest is missing its MV3 worker or popup')
  }
  const entries = [
    'manifest.json',
    manifest.background.service_worker,
    manifest.action.default_popup,
    'popup.js',
    'popup.css',
    '_locales/en/messages.json',
    '_locales/zh_CN/messages.json'
  ]
  for (const entry of entries) {
    if (typeof entry !== 'string') throw new Error('Chrome connector entry is not a path')
    const filename = path.resolve(root, entry)
    const relative = path.relative(root, filename)
    if (
      !relative ||
      relative.startsWith(`..${path.sep}`) ||
      relative === '..' ||
      path.isAbsolute(relative)
    ) {
      throw new Error('Chrome connector entry escapes its resource directory')
    }
    const stat = fs.lstatSync(filename)
    if (!stat.isFile() || stat.size === 0)
      throw new Error(`Chrome connector resource is missing or empty: ${entry}`)
  }
}

module.exports = { verifyBrowserConnectorAssets }
