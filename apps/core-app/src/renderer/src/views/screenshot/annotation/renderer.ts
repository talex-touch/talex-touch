// SPDX-License-Identifier: MPL-2.0
// Derived from Satty (https://github.com/Satty-org/Satty) at commit
// 1c198c65c251aadc74d4f138f03bc2741b4655b2: src/tools/arrow.rs and src/tools/pixelate.rs.
// Copyright (c) Matthias Gabriel and Satty contributors.
// Adaptations for Tuff: pure Canvas2D document renderer and export generator. See ./NOTICE.

import type { AnnotationObject } from './types'
import { AnnotationDocument } from './document'
import type { AnnotationPoint, AnnotationRect } from './geometry'

/**
 * Draws an arrow from start to end with wings projected at ~30° angle, matching Satty's arrow head math.
 */
function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  start: AnnotationPoint,
  end: AnnotationPoint,
  strokeWidth: number
): void {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const angle = Math.atan2(dy, dx)
  const headLength = Math.max(12, strokeWidth * 3.5)
  const wingAngle = Math.PI / 6 // 30 degrees

  ctx.beginPath()
  ctx.moveTo(end.x, end.y)
  ctx.lineTo(
    end.x - headLength * Math.cos(angle - wingAngle),
    end.y - headLength * Math.sin(angle - wingAngle)
  )
  ctx.lineTo(
    end.x - headLength * Math.cos(angle + wingAngle),
    end.y - headLength * Math.sin(angle + wingAngle)
  )
  ctx.closePath()
  ctx.fill()
}

/**
 * Applies a true destructive pixelation block mosaic, adapted from Satty's pixelate shader/buffer logic.
 */
function applyPixelate(
  ctx: CanvasRenderingContext2D,
  rect: AnnotationRect,
  blockSize: number
): void {
  const x = Math.max(0, Math.floor(rect.x))
  const y = Math.max(0, Math.floor(rect.y))
  const width = Math.min(ctx.canvas.width - x, Math.ceil(rect.width))
  const height = Math.min(ctx.canvas.height - y, Math.ceil(rect.height))
  if (width <= 0 || height <= 0) return

  const imgData = ctx.getImageData(x, y, width, height)
  const data = imgData.data
  const size = Math.max(4, blockSize)

  for (let py = 0; py < height; py += size) {
    for (let px = 0; px < width; px += size) {
      const sampleX = Math.min(px + Math.floor(size / 2), width - 1)
      const sampleY = Math.min(py + Math.floor(size / 2), height - 1)
      const sampleIdx = (sampleY * width + sampleX) * 4
      const r = data[sampleIdx]
      const g = data[sampleIdx + 1]
      const b = data[sampleIdx + 2]
      const a = data[sampleIdx + 3]

      const blockW = Math.min(size, width - px)
      const blockH = Math.min(size, height - py)

      for (let by = 0; by < blockH; by += 1) {
        for (let bx = 0; bx < blockW; bx += 1) {
          const pixelIdx = ((py + by) * width + (px + bx)) * 4
          data[pixelIdx] = r
          data[pixelIdx + 1] = g
          data[pixelIdx + 2] = b
          data[pixelIdx + 3] = a
        }
      }
    }
  }

  ctx.putImageData(imgData, x, y)
}

export function drawAnnotationObject(
  ctx: CanvasRenderingContext2D,
  object: AnnotationObject
): void {
  ctx.save()
  ctx.strokeStyle = object.color
  ctx.fillStyle = object.color
  ctx.lineWidth = object.strokeWidth
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  switch (object.kind) {
    case 'rectangle': {
      const { x, y, width, height, filled, cornerRadius } = object
      ctx.beginPath()
      if (cornerRadius && cornerRadius > 0 && typeof ctx.roundRect === 'function') {
        ctx.roundRect(x, y, width, height, cornerRadius)
      } else {
        ctx.rect(x, y, width, height)
      }
      if (filled) ctx.fill()
      ctx.stroke()
      break
    }
    case 'ellipse': {
      const rx = Math.abs(object.width / 2)
      const ry = Math.abs(object.height / 2)
      const cx = object.x + rx
      const cy = object.y + ry
      ctx.beginPath()
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
      if (object.filled) ctx.fill()
      ctx.stroke()
      break
    }
    case 'line': {
      ctx.beginPath()
      ctx.moveTo(object.start.x, object.start.y)
      ctx.lineTo(object.end.x, object.end.y)
      ctx.stroke()
      break
    }
    case 'arrow': {
      ctx.beginPath()
      ctx.moveTo(object.start.x, object.start.y)
      ctx.lineTo(object.end.x, object.end.y)
      ctx.stroke()
      drawArrowHead(ctx, object.start, object.end, object.strokeWidth)
      break
    }
    case 'brush': {
      if (object.points.length === 0) break
      ctx.beginPath()
      ctx.moveTo(object.points[0].x, object.points[0].y)
      for (let i = 1; i < object.points.length; i += 1) {
        ctx.lineTo(object.points[i].x, object.points[i].y)
      }
      ctx.stroke()
      break
    }
    case 'text': {
      ctx.font = `${object.fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
      ctx.fillText(object.text, object.x, object.y)
      break
    }
    case 'pixelate': {
      applyPixelate(ctx, object, object.blockSize)
      break
    }
  }

  ctx.restore()
}

/**
 * Draws selection bounding box and handles around selected object.
 */
export function drawSelectionBox(
  ctx: CanvasRenderingContext2D,
  bounds: AnnotationRect,
  scale = 1
): void {
  ctx.save()
  ctx.strokeStyle = '#007aff'
  ctx.lineWidth = 1.5 / scale
  ctx.setLineDash([4 / scale, 4 / scale])
  ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height)

  // Corner and edge handles
  const handleSize = 7 / scale
  ctx.setLineDash([])
  ctx.fillStyle = '#ffffff'
  ctx.strokeStyle = '#007aff'
  ctx.lineWidth = 1.5 / scale

  const points: AnnotationPoint[] = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width / 2, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x, y: bounds.y + bounds.height / 2 },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height / 2 },
    { x: bounds.x, y: bounds.y + bounds.height },
    { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height }
  ]

  for (const pt of points) {
    ctx.fillRect(pt.x - handleSize / 2, pt.y - handleSize / 2, handleSize, handleSize)
    ctx.strokeRect(pt.x - handleSize / 2, pt.y - handleSize / 2, handleSize, handleSize)
  }

  ctx.restore()
}

/**
 * Renders the base image and all document annotations to a canvas, then exports as Uint8Array PNG bytes.
 */
export async function renderDocumentToPng(
  baseImage: CanvasImageSource,
  width: number,
  height: number,
  document: AnnotationDocument
): Promise<Uint8Array> {
  const canvas =
    document instanceof AnnotationDocument ? window.document.createElement('canvas') : null
  if (!canvas) throw new Error('DOM canvas unavailable')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D context unavailable')

  // Draw base image
  ctx.drawImage(baseImage, 0, 0, width, height)

  // Draw all objects in order
  for (const object of document.objects) {
    drawAnnotationObject(ctx, object)
  }

  return new Promise<Uint8Array>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Canvas toBlob failed'))
        return
      }
      blob
        .arrayBuffer()
        .then((buf) => resolve(new Uint8Array(buf)))
        .catch(reject)
    }, 'image/png')
  })
}
