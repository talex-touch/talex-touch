import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'vitest'
import { inferManifestChannel } from './lib/update-rollback-contract.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const VERSION = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).version

describe('manual build tag', () => {
  it('would have resolved to nothing under the labels that look reasonable', () => {
    const base = String(VERSION).split('-')[0]
    for (const label of ['manual', 'release', 'rc']) {
      assert.equal(inferManifestChannel(`${base}-${label}.20260805-120000`), null, label)
    }
    assert.equal(inferManifestChannel('manual-build-20260805-120000'), null)
  })
})
