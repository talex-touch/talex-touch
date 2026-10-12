// Adds icons from the workspace's iconify collections to kit/icons.js (window.ICONS = {name: {body, w, h}}).
// Usage: node kit/add-icons.cjs ri:time-line carbon:folder logos:vue ...
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')

const REPO = path.resolve(__dirname, '../../../..')
// Workspace packages that depend on the collections; the first one that resolves a prefix wins.
const ANCHORS = ['apps/core-app', 'apps/nexus'].map(dir => createRequire(path.join(REPO, dir, 'package.json')))
function collection(prefix) {
  for (const require of ANCHORS) {
    try {
      return JSON.parse(fs.readFileSync(require.resolve(`@iconify-json/${prefix}/icons.json`), 'utf8'))
    }
    catch {}
  }
  throw new Error(`no @iconify-json/${prefix} in apps/core-app or apps/nexus`)
}

const FILE = path.join(__dirname, 'icons.js')
global.window = {}
require(FILE)
const ICONS = window.ICONS
const missing = []
for (const full of process.argv.slice(2)) {
  if (ICONS[full])
    continue
  const [prefix, name] = full.split(':')
  const j = collection(prefix)
  let ic = j.icons[name]
  if (!ic && j.aliases && j.aliases[name])
    ic = { ...j.icons[j.aliases[name].parent], ...j.aliases[name] }
  if (!ic) {
    missing.push(full)
    continue
  }
  ICONS[full] = { body: ic.body, w: ic.width || j.width || 24, h: ic.height || j.height || 24 }
}
fs.writeFileSync(FILE, `window.ICONS=${JSON.stringify(ICONS)}`)
console.log('total', Object.keys(ICONS).length, 'missing', missing.join(' ') || 'none')
