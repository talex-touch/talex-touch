import type { BrowserConnectionServerMessage } from '../../../packages/utils/transport/sdk/domains/browser-connection'
import { BROWSER_PROTOCOL_VERSION, browserServerAuthenticationChallenge } from '../../../packages/utils/transport/sdk/domains/browser-connection'

export type BrowserServerProof = Extract<BrowserConnectionServerMessage, { type: 'challenge' }>

function decodeBoundedBase64(value: string, maximumBytes: number): ArrayBuffer {
  if (value.length > Math.ceil(maximumBytes / 3) * 4 || !/^(?:[A-Z0-9+/]{4})*(?:[A-Z0-9+/]{2}==|[A-Z0-9+/]{3}=)?$/i.test(value))
    throw new Error('invalidServerProof')
  const binary = atob(value)
  if (!binary.length || binary.length > maximumBytes)
    throw new Error('invalidServerProof')
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes.buffer
}

/**
 * Verify Main's live endpoint before releasing a profile signature or Chrome metadata.
 * The trusted key must come from the FIRST native-host-info frame, never from TCP.
 * Replay protection belongs to the caller's fresh expectedClientNonce and one-challenge state.
 */
export async function verifyBrowserServerProof(serverPublicKey: string, expectedClientNonce: string, proof: BrowserServerProof): Promise<boolean> {
  try {
    if (proof.version !== BROWSER_PROTOCOL_VERSION || !/^[\w-]{43}$/.test(expectedClientNonce) || proof.clientNonce !== expectedClientNonce || !/^[\w-]{43}$/.test(proof.nonce))
      return false
    const key = await crypto.subtle.importKey('spki', decodeBoundedBase64(serverPublicKey, 3072), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    const signature = decodeBoundedBase64(proof.signature, 64)
    if (signature.byteLength !== 64)
      return false
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, new TextEncoder().encode(browserServerAuthenticationChallenge(expectedClientNonce, proof.nonce)))
  }
  catch {
    return false
  }
}
