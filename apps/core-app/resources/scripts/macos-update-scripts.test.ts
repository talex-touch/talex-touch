import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareMacUpdate } from '../../src/main/modules/update/services/macos-update-preparation'
import {
  createSignedMacUpdateFixture,
  readMacBundleVersion,
  swapHelperPath
} from './fixtures/macos-update-fixture'

const exec = promisify(execFile)
const roots: string[] = []
const applyScript = new URL('./macos-apply-update.sh', import.meta.url).pathname
const restoreScript = new URL('./macos-restore-update.sh', import.meta.url).pathname

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe.runIf(process.platform === 'darwin')('macOS atomic update scripts', () => {
  it('swaps real signed bundles, never reverses an apply replay, and restores exactly once', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'tuff-macos-swap-'))
    roots.push(root)
    const fixture = await createSignedMacUpdateFixture(root)
    const receipt = await prepareMacUpdate(fixture.input)
    const prepared = path.join(receipt.stageRoot, 'prepared.app')
    const oldInode = (await stat(fixture.appBundlePath)).ino
    const newInode = (await stat(prepared)).ino
    const bin = path.join(root, 'bin')
    const launches = path.join(root, 'launches.txt')
    await mkdir(bin)
    await writeFile(path.join(bin, 'open'), '#!/bin/sh\nprintf "%s\\n" "$1" >> "$OTA_LAUNCHES"\n')
    await chmod(path.join(bin, 'open'), 0o755)
    const options = {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, OTA_LAUNCHES: launches }
    }
    const log = path.join(fixture.attemptRoot, 'script.log')
    const applyArgs = [
      applyScript,
      '--prepared',
      prepared,
      '--dest',
      fixture.appBundlePath,
      '--swap-helper',
      swapHelperPath,
      '--version',
      '2.4.10',
      '--previous-version',
      '2.4.9',
      '--pid',
      '999999999',
      '--log',
      log
    ]
    await exec('/bin/bash', applyArgs, options)
    expect(await readMacBundleVersion(fixture.appBundlePath)).toBe('2.4.10')
    expect(await readMacBundleVersion(prepared)).toBe('2.4.9')
    expect((await stat(fixture.appBundlePath)).ino).toBe(newInode)
    expect((await stat(prepared)).ino).toBe(oldInode)
    await exec('/bin/bash', applyArgs, options)
    expect((await stat(fixture.appBundlePath)).ino).toBe(newInode)
    expect((await stat(prepared)).ino).toBe(oldInode)
    const restoreArgs = [
      restoreScript,
      '--backup',
      prepared,
      '--dest',
      fixture.appBundlePath,
      '--swap-helper',
      swapHelperPath,
      '--version',
      '2.4.9',
      '--failed-version',
      '2.4.10',
      '--log',
      log
    ]
    await exec('/bin/bash', restoreArgs, options)
    expect(await readMacBundleVersion(fixture.appBundlePath)).toBe('2.4.9')
    expect(await readMacBundleVersion(prepared)).toBe('2.4.10')
    expect((await stat(fixture.appBundlePath)).ino).toBe(oldInode)
    await exec('/bin/bash', restoreArgs, options)
    expect((await stat(fixture.appBundlePath)).ino).toBe(oldInode)
    expect((await stat(prepared)).ino).toBe(newInode)
    expect(await readFile(launches, 'utf8')).toBe(`${fixture.appBundlePath}\n`.repeat(4))
  })

  it.each(['same-directory', 'symlink', 'file', 'missing'] as const)(
    'refuses a %s swap operand without changing either tree',
    async (invalid) => {
      const root = await mkdtemp(path.join(tmpdir(), 'tuff-native-swap-reject-'))
      roots.push(root)
      const left = path.join(root, 'left')
      const right = path.join(root, 'right')
      await mkdir(left)
      await writeFile(path.join(left, 'sentinel'), 'installed')
      if (invalid === 'symlink') await symlink(left, right)
      if (invalid === 'file') await writeFile(right, 'not a bundle')
      await expect(
        exec(swapHelperPath, ['--swap', left, invalid === 'same-directory' ? left : right])
      ).rejects.toThrow()
      expect(await readFile(path.join(left, 'sentinel'), 'utf8')).toBe('installed')
      if (invalid === 'file') expect(await readFile(right, 'utf8')).toBe('not a bundle')
    }
  )

  it('refuses to swap while the parent is still alive', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'tuff-macos-parent-'))
    roots.push(root)
    const fixture = await createSignedMacUpdateFixture(root)
    const receipt = await prepareMacUpdate(fixture.input)
    const prepared = path.join(receipt.stageRoot, 'prepared.app')
    await expect(
      exec('/bin/bash', [
        applyScript,
        '--prepared',
        prepared,
        '--dest',
        fixture.appBundlePath,
        '--swap-helper',
        swapHelperPath,
        '--version',
        '2.4.10',
        '--previous-version',
        '2.4.9',
        '--pid',
        String(process.pid),
        '--log',
        path.join(fixture.attemptRoot, 'script.log')
      ])
    ).rejects.toThrow()
    expect(await readMacBundleVersion(fixture.appBundlePath)).toBe('2.4.9')
    expect(await readMacBundleVersion(prepared)).toBe('2.4.10')
  })
})
