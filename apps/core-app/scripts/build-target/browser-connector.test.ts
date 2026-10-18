import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { verifyBrowserConnectorAssets } = require('./browser-connector.js') as {
  verifyBrowserConnectorAssets: (directory: string) => void
}

const roots: string[] = []

function createValidConnectorFixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'browser-connector-assets-'))
  roots.push(root)
  mkdirSync(path.join(root, '_locales', 'en'), { recursive: true })
  mkdirSync(path.join(root, '_locales', 'zh_CN'), { recursive: true })
  writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      background: { service_worker: 'service-worker.js' },
      action: { default_popup: 'popup.html' }
    })
  )
  for (const entry of [
    'service-worker.js',
    'popup.html',
    'popup.js',
    'popup.css',
    '_locales/en/messages.json',
    '_locales/zh_CN/messages.json'
  ]) {
    writeFileSync(path.join(root, entry), 'fixture\n')
  }
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Chrome connector resource gate', () => {
  it('accepts the complete built extension shape', () => {
    expect(verifyBrowserConnectorAssets(createValidConnectorFixture())).toBeUndefined()
  })

  it.each([
    ['service worker', 'service-worker.js'],
    ['English localization', path.join('_locales', 'en', 'messages.json')],
    ['Simplified Chinese localization', path.join('_locales', 'zh_CN', 'messages.json')]
  ])('rejects a build missing its %s', (_label, relativePath) => {
    const root = createValidConnectorFixture()
    rmSync(path.join(root, relativePath))

    expect(() => verifyBrowserConnectorAssets(root)).toThrow()
  })

  it('rejects a manifest entry that escapes the connector resource root', () => {
    const root = createValidConnectorFixture()
    writeFileSync(
      path.join(root, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        background: { service_worker: '../outside-worker.js' },
        action: { default_popup: 'popup.html' }
      })
    )

    expect(() => verifyBrowserConnectorAssets(root)).toThrow()
  })
})
