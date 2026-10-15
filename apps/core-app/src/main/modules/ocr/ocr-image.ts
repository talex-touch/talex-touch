import type { Buffer } from 'node:buffer'
import sharp from 'sharp'

const MAX_OCR_IMAGE_EDGE = 2000

// Imported only by the one-shot OCR child: resizing must not fan out across all CPU cores.
sharp.concurrency(1)

export async function prepareOcrImage(
  image: Buffer
): Promise<{ image: Buffer; scaleX: number; scaleY: number }> {
  const pipeline = sharp(image)
  const { width, height } = await pipeline.metadata()
  if (!width || !height) {
    throw new Error('OCR image dimensions are unavailable')
  }
  if (width <= MAX_OCR_IMAGE_EDGE && height <= MAX_OCR_IMAGE_EDGE) {
    return { image, scaleX: 1, scaleY: 1 }
  }

  const { data, info } = await pipeline
    .resize({
      width: MAX_OCR_IMAGE_EDGE,
      height: MAX_OCR_IMAGE_EDGE,
      fit: 'inside',
      withoutEnlargement: true
    })
    .png({ compressionLevel: 1 })
    .toBuffer({ resolveWithObject: true })
  return { image: data, scaleX: width / info.width, scaleY: height / info.height }
}
