// Renders a scene frame by frame through headless Chrome and pipes JPEG frames into ffmpeg; no frame touches the disk.
// Usage: node kit/render.mjs <scene.html> <out.mp4> [fps=60] [from] [to]
import { spawn } from 'node:child_process'
import { openScene } from './cdp.mjs'

const [, , sceneArg, outArg = 'out.mp4', fpsArg = '60', fromArg, toArg] = process.argv
if (!sceneArg) {
  console.error('usage: node kit/render.mjs <scene.html> <out.mp4> [fps=60] [from] [to]')
  process.exit(2)
}
const FPS = Number(fpsArg)

const page = await openScene(sceneArg, { name: 'render', port: 9237 })
try {
  const duration = await page.evaluate('window.__duration')
  const from = fromArg ? Number(fromArg) : 0
  const to = toArg ? Number(toArg) : duration
  const total = Math.round((to - from) * FPS)
  console.error(`scene ${duration.toFixed(2)}s, rendering ${from}..${to}s = ${total} frames @${FPS}fps`)

  const ffmpeg = spawn('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    // Chrome's JPEGs are full-range BT.601; deliver standard limited-range BT.709 so players agree on black.
    '-vf', 'scale=in_color_matrix=bt601:out_color_matrix=bt709:in_range=full:out_range=limited,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-tune', 'animation',
    '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.2',
    '-color_range', 'tv', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
    '-r', String(FPS), '-movflags', '+faststart', outArg,
  ], { stdio: ['pipe', 'inherit', 'inherit'] })

  const started = Date.now()
  for (let i = 0; i < total; i++) {
    const t = from + i / FPS
    await page.seek(t)
    const shot = await page.send('Page.captureScreenshot', { format: 'jpeg', quality: 96, optimizeForSpeed: true })
    if (!ffmpeg.stdin.write(Buffer.from(shot.data, 'base64')))
      await new Promise(resolve => ffmpeg.stdin.once('drain', resolve))
    if (i % 120 === 0)
      console.error(`frame ${i}/${total}  t=${t.toFixed(2)}s  ${((Date.now() - started) / 1000).toFixed(0)}s elapsed`)
  }
  ffmpeg.stdin.end()
  await new Promise(resolve => ffmpeg.on('close', resolve))
  console.error(`done in ${((Date.now() - started) / 1000).toFixed(0)}s -> ${outArg}`)
}
finally {
  page.close()
}
