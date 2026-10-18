import type { BrowserServerProof } from '../../../../../browser-connector/src/auth'
import { verifyBrowserServerProof } from '../../../../../browser-connector/src/auth'
import { browserServerAuthenticationChallenge } from '@talex-touch/utils/transport/sdk/domains/browser-connection'
import { generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto'
import { describe, expect, it } from 'vitest'

function nonce(): string {
  return randomBytes(32).toString('base64url')
}

function proofFor(
  privateKey: KeyObject,
  clientNonce: string,
  serverNonce: string
): BrowserServerProof {
  const signature = sign(
    'sha256',
    Buffer.from(browserServerAuthenticationChallenge(clientNonce, serverNonce)),
    {
      key: privateKey,
      dsaEncoding: 'ieee-p1363'
    }
  ).toString('base64')
  return { type: 'challenge', version: 1, clientNonce, nonce: serverNonce, signature }
}

describe('browser connector Main server proof', () => {
  it('accepts a real P-256 proof bound to the fresh client nonce', async () => {
    const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    const serverPublicKey = pair.publicKey
      .export({ type: 'spki', format: 'der' })
      .toString('base64')
    const clientNonce = nonce()
    const proof = proofFor(pair.privateKey, clientNonce, nonce())

    await expect(verifyBrowserServerProof(serverPublicKey, clientNonce, proof)).resolves.toBe(true)
  })

  it.each([
    [
      'unsigned',
      () => ({ type: 'challenge', version: 1, clientNonce: nonce(), nonce: nonce(), signature: '' })
    ],
    [
      'malformed signature',
      () => ({
        type: 'challenge',
        version: 1,
        clientNonce: nonce(),
        nonce: nonce(),
        signature: 'not-base64'
      })
    ]
  ])('rejects an %s server proof', async (_label, createProof) => {
    const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    const serverPublicKey = pair.publicKey
      .export({ type: 'spki', format: 'der' })
      .toString('base64')
    const clientNonce = nonce()

    await expect(
      verifyBrowserServerProof(serverPublicKey, clientNonce, createProof() as BrowserServerProof)
    ).resolves.toBe(false)
  })

  it('rejects a proof signed by a different Main key', async () => {
    const trusted = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    const wrong = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    const trustedPublicKey = trusted.publicKey
      .export({ type: 'spki', format: 'der' })
      .toString('base64')
    const clientNonce = nonce()
    const proof = proofFor(wrong.privateKey, clientNonce, nonce())

    await expect(verifyBrowserServerProof(trustedPublicKey, clientNonce, proof)).resolves.toBe(
      false
    )
  })

  it('rejects a proof replayed under a different fresh client nonce', async () => {
    const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    const serverPublicKey = pair.publicKey
      .export({ type: 'spki', format: 'der' })
      .toString('base64')
    const originalClientNonce = nonce()
    const replayedClientNonce = nonce()
    const proof = proofFor(pair.privateKey, originalClientNonce, nonce())

    await expect(
      verifyBrowserServerProof(serverPublicKey, replayedClientNonce, proof)
    ).resolves.toBe(false)
  })
})
