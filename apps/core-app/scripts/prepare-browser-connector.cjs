'use strict'

const { execFileSync } = require('node:child_process')
const path = require('node:path')

const appRoot = path.resolve(__dirname, '..')
const nativeRoot = path.dirname(require.resolve('@talex-touch/tuff-native'))
const universal = process.argv.includes('--universal') || process.env.BUILD_TARGET === 'mac'

execFileSync(
  process.execPath,
  [
    path.join(nativeRoot, 'scripts', 'build-browser-bridge.js'),
    ...(universal ? ['--universal'] : [])
  ],
  { cwd: nativeRoot, stdio: 'inherit' }
)
execFileSync(process.execPath, [path.resolve(appRoot, '..', 'browser-connector', 'build.mjs')], {
  cwd: appRoot,
  stdio: 'inherit'
})
