// Captures still PNGs of a scene at the given times for review, into shots/ under the current directory.
// Usage: node kit/shoot.mjs <scene.html> <t1,t2,...> [scale=0.5]
import { mkdirSync, writeFileSync } from 'node:fs'
import { H, openScene, W } from './cdp.mjs'

const [, , sceneArg, timesArg = '0', scaleArg = '0.5'] = process.argv
if (!sceneArg) {
  console.error('usage: node kit/shoot.mjs <scene.html> <t1,t2,...> [scale=0.5]')
  process.exit(2)
}

const page = await openScene(sceneArg, { name: 'shoot', port: 9238, verbose: true })
try {
  mkdirSync('shots', { recursive: true })
  const scale = Number(scaleArg)
  for (const t of timesArg.split(',').map(Number)) {
    await page.seek(t)
    const shot = await page.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: H, scale } })
    const file = `shots/t-${t.toFixed(2)}.png`
    writeFileSync(file, Buffer.from(shot.data, 'base64'))
    console.log(file)
  }
}
finally {
  page.close()
}
