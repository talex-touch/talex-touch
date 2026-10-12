import type {
  FileParser,
  FileParserContext,
  FileParserProgress,
  FileParserResult,
} from '../types'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'

const PDF_EXTENSIONS = ['.pdf']
const PDF_TIMEOUT_MS = 30_000
const PDF_MAX_BYTES = 50 * 1024 * 1024
const PDF_MAX_OUTPUT_BYTES = 8 * 1024 * 1024
const PDF_MAX_CHUNKS = 4096
const PDF_MAX_PAGES = 2000

// Kept self-contained JavaScript so source, utils tsup and packaged Electron use
// the same worker without an extra asset-copy/build path. PDF.js' Node "worker"
// normally runs on the caller thread; a real Node worker makes abort/deadline
// enforceable even while decoding compressed streams. No rendering/OCR fallback.
const PDF_WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs/promises');
const path = require('node:path');

function fail(reason, code) {
  throw Object.assign(new Error(reason), { code });
}

(async () => {
  let handle;
  let loadingTask;
  let totalBytes = 0;
  let processedBytes = 0;
  try {
    handle = await fs.open(workerData.filePath, 'r');
    const stat = await handle.stat();
    totalBytes = stat.size;
    if (!stat.isFile()) fail('not-a-regular-file', 'FILE_NOT_REGULAR');
    if (totalBytes > workerData.maxBytes) fail('file-too-large', 'FILE_TOO_LARGE');
    const data = new Uint8Array(totalBytes + 1);
    while (processedBytes < data.length) {
      const { bytesRead } = await handle.read(
        data, processedBytes, Math.min(65536, data.length - processedBytes), null,
      );
      if (!bytesRead) break;
      processedBytes += bytesRead;
      if (processedBytes > totalBytes) fail('file-changed-during-read', 'FILE_CHANGED');
    }
    const finalStat = await handle.stat();
    if (processedBytes !== totalBytes || finalStat.size !== stat.size || finalStat.mtimeMs !== stat.mtimeMs) {
      fail('file-changed-during-read', 'FILE_CHANGED');
    }
    await handle.close();
    handle = undefined;

    // The parent resolves this runtime-selected absolute URL for the eval worker;
    // static imports cannot use its packaged Node resolution context.
    const { getDocument } = await import(workerData.moduleUrl);
    class NoRenderingCanvasFactory {
      create() { fail('pdf-rendering-disabled', 'PDF_RENDERING_DISABLED'); }
    }
    loadingTask = getDocument({
      data: data.subarray(0, processedBytes),
      cMapUrl: path.join(workerData.assetsPath, 'cmaps') + path.sep,
      cMapPacked: true,
      standardFontDataUrl: path.join(workerData.assetsPath, 'standard_fonts') + path.sep,
      useWorkerFetch: false,
      CanvasFactory: NoRenderingCanvasFactory,
      disableFontFace: true,
      useSystemFonts: false,
      useWasm: false,
      isOffscreenCanvasSupported: false,
      isImageDecoderSupported: false,
      maxImageSize: 0,
      enableXfa: false,
      stopAtErrors: true,
      verbosity: 0,
    });
    const document = await loadingTask.promise;
    if (document.numPages > workerData.maxPages) fail('pdf-page-limit', 'PDF_PAGE_LIMIT');
    const chunks = [];
    const pages = [];
    let outputBytes = 0;
    let emptyPages = 0;
    let part = '';
    let pageParts = [];
    function append(text, pageNumber) {
      let offset = 0;
      while (offset < text.length) {
        let end = Math.min(offset + 4000 - part.length, text.length);
        if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
        if (end === offset) {
          flush(pageNumber);
          continue;
        }
        const piece = text.slice(offset, end);
        // Returned content and chunks both retain text. Reserve both copies,
        // plus page separators, before retaining decompressed text.
        outputBytes += 2 * Buffer.byteLength(piece, 'utf8');
        if (outputBytes > workerData.maxOutputBytes) fail('output-too-large', 'FILE_OUTPUT_LIMIT');
        part += piece;
        offset = end;
        if (part.length === 4000) flush(pageNumber);
      }
    }
    function flush(pageNumber) {
      if (!part) return;
      if (chunks.length >= workerData.maxChunks) fail('output-too-large', 'FILE_OUTPUT_LIMIT');
      chunks.push({ text: part, pageNumber });
      pageParts.push(part);
      part = '';
    }

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const reader = page.streamTextContent({ includeMarkedContent: false }).getReader();
      let hasText = false;
      let lastCharacter = '';
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          for (const item of value.items) {
            if (typeof item.str !== 'string') continue;
            if (item.str) {
              append(item.str, pageNumber);
              hasText ||= /\S/u.test(item.str);
              lastCharacter = item.str.slice(-1);
            }
            if (item.hasEOL && hasText && lastCharacter !== '\n') {
              append('\n', pageNumber);
              lastCharacter = '\n';
            }
          }
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
        page.cleanup();
      }
      flush(pageNumber);
      if (hasText) {
        if (pages.length) {
          outputBytes += 2;
          if (outputBytes > workerData.maxOutputBytes) fail('output-too-large', 'FILE_OUTPUT_LIMIT');
        }
        pages.push(pageParts.join(''));
      } else {
        emptyPages++;
      }
      pageParts = [];
      parentPort.postMessage({ type: 'progress', progress: {
        processedBytes, totalBytes, percentage: pageNumber / document.numPages,
        message: 'pdf-page:' + pageNumber + '/' + document.numPages,
      } });
    }
    parentPort.postMessage({ type: 'result', result: pages.length ? {
      status: 'success', content: pages.join('\n\n'), chunks,
      metadata: { source: 'pdfjs', pageCount: document.numPages, emptyPages },
      processedBytes, totalBytes,
    } : {
      status: 'skipped', reason: 'empty-or-scanned-pdf',
      metadata: { source: 'pdfjs', pageCount: document.numPages, emptyPages },
      processedBytes, totalBytes,
    } });
  } catch (error) {
    parentPort.postMessage({ type: 'result', result: {
      status: 'failed',
      reason: error?.name === 'PasswordException' ? 'password-protected-pdf' : error?.message || 'pdf-parse-failed',
      errorCode: error?.name === 'PasswordException' ? 'PDF_PASSWORD_REQUIRED' : error?.code || 'PDF_PARSE_FAILED',
      processedBytes, totalBytes,
    } });
  } finally {
    await handle?.close().catch(() => {});
    await loadingTask?.destroy().catch(() => {});
    parentPort.close();
  }
})();
`

interface PdfWorkerMessage {
  type: 'progress' | 'result'
  progress?: FileParserProgress
  result?: FileParserResult
}

function boundedLimit(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 0
    ? Math.min(Math.floor(value), fallback)
    : fallback
}

export class PdfFileParser implements FileParser {
  readonly id = 'pdf-file-parser'
  readonly priority = 120
  readonly supportedExtensions = PDF_EXTENSIONS

  async parse(
    context: FileParserContext,
    onProgress?: (progress: FileParserProgress) => void,
  ): Promise<FileParserResult> {
    const { filePath, extension, signal } = context
    if (!PDF_EXTENSIONS.includes(extension.toLowerCase())) {
      return { status: 'skipped', reason: 'unsupported-extension' }
    }
    if (signal?.aborted) {
      return { status: 'failed', reason: 'aborted', errorCode: 'ABORT_ERR' }
    }

    try {
      // core-app's file-index worker is CJS; published utils are ESM.
      const require = createRequire(typeof __filename === 'string' ? __filename : import.meta.url)
      const moduleUrl = pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href
      const assetsPath = path.dirname(require.resolve('pdfjs-dist/package.json'))
      const worker = new Worker(PDF_WORKER_SOURCE, {
        eval: true,
        name: 'tuff-pdf-parser',
        resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 },
        workerData: {
          filePath,
          moduleUrl,
          assetsPath,
          maxBytes: boundedLimit(context.maxBytes, PDF_MAX_BYTES),
          maxOutputBytes: boundedLimit(context.maxOutputBytes, PDF_MAX_OUTPUT_BYTES),
          maxChunks: boundedLimit(context.maxChunks, PDF_MAX_CHUNKS),
          maxPages: PDF_MAX_PAGES,
        },
      })
      return await new Promise<FileParserResult>((resolve) => {
        let settled = false
        let processedBytes = 0
        let totalBytes = context.size
        const finish = (result: FileParserResult): void => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          signal?.removeEventListener('abort', onAbort)
          // This worker is exclusively owned by this request. Reclaim it before
          // exposing completion; stale frames can never publish partial results.
          void worker.terminate().then(() => resolve(result), () => resolve(result))
        }
        const fail = (reason: string, errorCode: string): void => {
          finish({ status: 'failed', reason, errorCode, processedBytes, totalBytes })
        }
        const onAbort = (): void => fail('aborted', 'ABORT_ERR')
        const timer = setTimeout(() => fail('pdf-timeout', 'PDF_TIMEOUT'), PDF_TIMEOUT_MS)
        signal?.addEventListener('abort', onAbort, { once: true })
        worker.on('message', (message: PdfWorkerMessage) => {
          if (settled) return
          if (message.type === 'progress' && message.progress) {
            processedBytes = message.progress.processedBytes ?? processedBytes
            totalBytes = message.progress.totalBytes ?? totalBytes
            try {
              onProgress?.(message.progress)
            } catch (error) {
              fail(error instanceof Error ? error.message : 'progress-callback-failed', 'PDF_PROGRESS_FAILED')
            }
          } else if (message.type === 'result' && message.result) {
            finish({
              ...message.result,
              metadata: { ...message.result.metadata, basename: path.basename(filePath) },
            })
          }
        })
        worker.once('error', error => fail(error.message, 'PDF_WORKER_FAILED'))
        worker.once('exit', () => {
          if (!settled) fail('pdf-worker-exited-without-result', 'PDF_WORKER_EXITED')
        })
        if (signal?.aborted) onAbort()
      })
    } catch (error) {
      return {
        status: 'failed',
        reason: error instanceof Error ? error.message : 'pdf-parser-unavailable',
        errorCode: 'PDF_PARSER_UNAVAILABLE',
      }
    }
  }
}

export const pdfFileParser = new PdfFileParser()
