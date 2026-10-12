import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileParserRegistry } from '../electron/file-parsers'

describe('FileParserRegistry and chunked parsers', () => {
  it('prefers CodeFileParser for code extensions and chunks lines', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tuff-parser-test-'))
    const filePath = join(dir, 'example.ts')
    // Generate 60 lines of code
    const lines = Array.from({ length: 60 }, (_, i) => `const val_${i + 1} = ${i + 1};`)
    await writeFile(filePath, lines.join('\n'), 'utf8')

    try {
      const preferred = fileParserRegistry.getPreferredParser('.ts')
      expect(preferred?.id).toBe('code-file-parser')

      const result = await fileParserRegistry.parseWithBestParser({
        filePath,
        extension: '.ts',
        size: 500,
      })

      expect(result?.status).toBe('success')
      expect(result?.chunks).toBeDefined()
      expect(result!.chunks!.length).toBeGreaterThan(1)
      expect(result!.chunks![0].startLine).toBe(1)
      expect(result!.chunks![0].endLine).toBe(40)
      expect(result!.chunks![1].startLine).toBe(31) // overlapping
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('selects PdfFileParser for .pdf extension', async () => {
    const preferred = fileParserRegistry.getPreferredParser('.pdf')
    expect(preferred?.id).toBe('pdf-file-parser')
  })

  it('falls back to TextFileParser for plain text extensions', async () => {
    const preferred = fileParserRegistry.getPreferredParser('.txt')
    expect(preferred?.id).toBe('text-file-parser')
  })
})
