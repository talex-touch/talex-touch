// Evaluates a function body in a scene at the given times and prints `<t> <JSON>` per time.
// Usage: node kit/probe.mjs <scene.html> <t1,t2,...> "<body with a return>"
import { openScene } from './cdp.mjs'

const [, , sceneArg, timesArg = '0', body = 'return null'] = process.argv
if (!sceneArg) {
  console.error('usage: node kit/probe.mjs <scene.html> <t1,t2,...> "<body with a return>"')
  process.exit(2)
}

const page = await openScene(sceneArg, { name: 'probe', port: 9239, verbose: true })
try {
  for (const t of timesArg.split(',').map(Number)) {
    await page.seek(t)
    console.log(t, JSON.stringify(await page.evaluate(`(() => { ${body} })()`)))
  }
}
finally {
  page.close()
}
