import { createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'

export const PAGE_TEXT = [
  'Lease agreement cover and parties.',
  'Rent is payable on the first day of each month.',
  'The landlord maintains the roof and heating.',
  'Tenant shall not keep any pets without written consent.',
]

const PASSWORD_PADDING = Buffer.from('28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a', 'hex')
function paddedPassword(password: string): Buffer {
  return Buffer.concat([Buffer.from(password, 'latin1'), PASSWORD_PADDING]).subarray(0, 32)
}
function md5(bytes: Buffer): Buffer {
  return createHash('md5').update(bytes).digest()
}
function rc4(key: Buffer, input: Buffer): Buffer {
  const state = Array.from({ length: 256 }, (_, i) => i)
  let j = 0
  for (let i = 0; i < 256; i++) {
    j = (j + state[i]! + key[i % key.length]!) & 255
    ;[state[i], state[j]] = [state[j]!, state[i]!]
  }
  const output = Buffer.alloc(input.length)
  let i = 0
  j = 0
  for (let offset = 0; offset < input.length; offset++) {
    i = (i + 1) & 255
    j = (j + state[i]!) & 255
    ;[state[i], state[j]] = [state[j]!, state[i]!]
    output[offset] = input[offset]! ^ state[(state[i]! + state[j]!) & 255]!
  }
  return output
}

// Complete PDF 1.4, with physical xref byte offsets and compressed page streams.
// The encrypted variant uses the actual revision-2 standard security algorithm.
export function leasePdf(encrypted = false): Buffer {
  const documentId = Buffer.from('00112233445566778899aabbccddeeff', 'hex')
  const owner = rc4(md5(paddedPassword('owner-secret')).subarray(0, 5), paddedPassword('tenant-secret'))
  const permissions = Buffer.alloc(4)
  permissions.writeInt32LE(-4)
  const key = md5(Buffer.concat([paddedPassword('tenant-secret'), owner, permissions, documentId])).subarray(0, 5)
  const user = rc4(key, PASSWORD_PADDING)
  const objects: Buffer[] = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [4 0 R 6 0 R 8 0 R 10 0 R] /Count 4 >>'),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
  ]
  PAGE_TEXT.forEach((text, index) => {
    const pageId = 4 + index * 2
    const streamId = pageId + 1
    objects.push(Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`))
    let stream: Buffer = Buffer.from(deflateSync(Buffer.from(`BT /F1 12 Tf 72 720 Td (${text}) Tj ET`)))
    if (encrypted) {
      const objectId = Buffer.from([streamId & 255, (streamId >> 8) & 255, 0, 0, 0])
      stream = Buffer.from(rc4(md5(Buffer.concat([key, objectId])).subarray(0, 10), stream))
    }
    objects.push(Buffer.concat([
      Buffer.from(`<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`),
      stream,
      Buffer.from('\nendstream'),
    ]))
  })
  if (encrypted) {
    objects.push(Buffer.from(`<< /Filter /Standard /V 1 /R 2 /O <${owner.toString('hex')}> /U <${user.toString('hex')}> /P -4 >>`))
  }
  const parts = [Buffer.from('%PDF-1.4\n%\xff\xff\xff\xff\n', 'latin1')]
  const offsets = [0]
  let length = parts[0]!.length
  objects.forEach((object, index) => {
    offsets.push(length)
    const bytes = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from('\nendobj\n')])
    parts.push(bytes)
    length += bytes.length
  })
  const rows = offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  parts.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${rows}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${encrypted ? ` /Encrypt 12 0 R /ID [<${documentId.toString('hex')}> <${documentId.toString('hex')}>]` : ''} >>\nstartxref\n${length}\n%%EOF\n`))
  return Buffer.concat(parts)
}
