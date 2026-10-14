import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fileParserRegistry } from '../electron/file-parsers'
import { CodeFileParser } from '../electron/file-parsers/parsers/code-chunk-parser'
import { PdfFileParser } from '../electron/file-parsers/parsers/pdf-parser'
import { leasePdf, PAGE_TEXT } from './fixtures/lease-pdf'


let directory: string | undefined
async function fixture(name: string, bytes: string | Buffer): Promise<string> {
  directory ??= await mkdtemp(join(tmpdir(), 'tuff-parser-contract-'))
  const path = join(directory, name)
  await writeFile(path, bytes)
  return path
}
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
  directory = undefined
})

describe('file parser consumer contracts', () => {
  it('extracts exact text on every physical page of a real compressed four-page PDF', async () => {
    const bytes = leasePdf()
    const filePath = await fixture('lease.pdf', bytes)
    const result = await fileParserRegistry.parseWithBestParser({ filePath, extension: '.pdf', size: bytes.length })
    expect(result?.status).toBe('success')
    expect(result?.chunks).toEqual(PAGE_TEXT.map((text, index) => ({ text, pageNumber: index + 1 })))
    expect(result?.content).toBe(PAGE_TEXT.join('\n\n'))
  })

  it.each([
    { name: 'LF', separator: '\n' },
    { name: 'CRLF', separator: '\r\n' },
    { name: 'CR', separator: '\r' },
  ])('preserves complete source and aligns code chunks to $name source lines', async ({ separator }) => {
    const lines = Array.from({ length: 73 }, (_, index) => `const value_${index + 1} = "line ${index + 1} 🐾";`)
    const content = lines.join(separator)
    const filePath = await fixture('source.ts', content)
    const result = await fileParserRegistry.parseWithBestParser({ filePath, extension: '.ts', size: Buffer.byteLength(content) })
    expect(result?.status).toBe('success')
    expect(result?.content).toBe(content)
    const covered = new Set<number>()
    for (const chunk of result!.chunks!) {
      expect(chunk.text).toBe(lines.slice(chunk.startLine! - 1, chunk.endLine).join('\n'))
      for (let line = chunk.startLine!; line <= chunk.endLine!; line++) covered.add(line)
    }
    expect([...covered].sort((a, b) => a - b)).toEqual(lines.map((_, index) => index + 1))
  })

  it('retains the true line and complete unicode text when splitting a long minified line', async () => {
    const minified = `${'a'.repeat(3999)  }🐾${  'b'.repeat(5100)}`
    const content = `// header\n${minified}\n// footer`
    const filePath = await fixture('minified.ts', content)
    const result = await new CodeFileParser().parse({ filePath, extension: '.ts', size: Buffer.byteLength(content) })
    expect(result.status).toBe('success')
    const pieces = result.chunks!.filter(chunk => chunk.startLine === 2 && chunk.endLine === 2)
    expect(pieces.map(chunk => chunk.text).join('')).toBe(minified)
    expect(pieces.every(chunk => !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(chunk.text))).toBe(true)
    expect(result.chunks!.at(-1)).toEqual({ text: '// footer', startLine: 3, endLine: 3 })
  })

  it.each([
    { name: 'code', extension: '.ts', bytes: Buffer.from('const pets = true;'), parser: new CodeFileParser() },
    { name: 'PDF', extension: '.pdf', bytes: leasePdf(), parser: new PdfFileParser() },
  ])('accepts the exact $name input limit and rejects actual bytes above it even with stale size metadata', async ({ extension, bytes, parser }) => {
    const filePath = await fixture(`boundary${extension}`, bytes)
    const context = { filePath, extension, size: 1 }
    expect((await parser.parse({ ...context, maxBytes: bytes.length })).status).toBe('success')
    const rejected = await parser.parse({ ...context, maxBytes: bytes.length - 1 })
    expect(rejected.status).not.toBe('success')
    expect(rejected.reason).toBe('file-too-large')
    expect(rejected.content).toBeUndefined()
    expect(rejected.chunks).toBeUndefined()
  })

  it.each([
    { name: 'code', extension: '.ts', bytes: Buffer.from('const pets = true;'), parser: new CodeFileParser() },
    { name: 'PDF', extension: '.pdf', bytes: leasePdf(), parser: new PdfFileParser() },
  ])('does not publish partial $name content after cancellation or output-budget failure', async ({ extension, bytes, parser }) => {
    const filePath = await fixture(`cancelled${extension}`, bytes)
    const controller = new AbortController()
    const cancelled = await parser.parse({ filePath, extension, size: bytes.length, signal: controller.signal }, () => controller.abort())
    expect(cancelled).toMatchObject({ status: 'failed', reason: 'aborted', errorCode: 'ABORT_ERR' })
    expect(cancelled.content).toBeUndefined()
    expect(cancelled.chunks).toBeUndefined()
    const limited = await parser.parse({ filePath, extension, size: bytes.length, maxOutputBytes: 1 })
    expect(limited.status).not.toBe('success')
    expect(limited.content).toBeUndefined()
    expect(limited.chunks).toBeUndefined()
  })

  it.each([
    { name: 'malformed', bytes: Buffer.from('%PDF-1.4\nthis is not a PDF object tree\n%%EOF') },
    { name: 'encrypted', bytes: leasePdf(true) },
  ])('surfaces a $name PDF failure rather than inventing page-one text', async ({ name, bytes }) => {
    const filePath = await fixture(`${name}.pdf`, bytes)
    const result = await new PdfFileParser().parse({ filePath, extension: '.pdf', size: bytes.length })
    expect(result.status).toBe('failed')
    expect(result.errorCode).toBe(name === 'encrypted' ? 'PDF_PASSWORD_REQUIRED' : 'PDF_PARSE_FAILED')
    expect(result.content).toBeUndefined()
    expect(result.chunks).toBeUndefined()
  })
})
