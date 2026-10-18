#!/usr/bin/env node
/**
 * Regenerates TxIconPicker's `src/generated/` from the catalog rows:
 *
 * - `glyphs-<section>-<n>.ts` — the path data every bundled `class:` row is
 *   drawn with, so the picker renders the same in a host whose stylesheet
 *   never heard of `i-ri-*` (Nexus installs neither collection). Split per
 *   section and capped in size, because a section's glyphs are imported the
 *   first time it is shown, not with the component.
 * - `chunks.ts` — which chunks each section imports.
 * - `pinyin.ts` — pinyin for every Chinese keyword, so `huojian` and `hj`
 *   find 火箭. Polyphones are resolved per word (银行 is yin hang), which is
 *   why this is a word table and not a character one.
 * - `shapes.ts` — the plate outlines, as finished path strings on a 24-unit
 *   box. Computed here rather than at runtime so a server render and the
 *   client agree to the byte.
 *
 * Run after editing a catalog module:
 *
 *   node packages/tuffex/scripts/generate-icon-picker-data.mjs
 *
 * The icon sets and pinyin-pro are resolved from core-app, deliberately: it
 * already depends on them to build its own stylesheet, so the picker draws
 * exactly the glyph data core-app's CSS was generated from, at the same
 * version, without TuffEx taking on a dependency it only needs offline.
 */

import { Buffer } from 'node:buffer'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { tsImport } from 'tsx/esm/api'

const PACKAGE_ROOT = new URL('../', import.meta.url)
const PICKER_SRC = new URL('packages/components/src/icon-picker/src/', PACKAGE_ROOT)
const OUT_DIR = new URL('generated/', PICKER_SRC)
const requireFromCoreApp = createRequire(new URL('../../apps/core-app/package.json', PACKAGE_ROOT))

/** Keeps every chunk well inside audit:size's 48 KiB per-module budget. */
const CHUNK_BYTES = 40 * 1024

const SETS = {
  'i-ri-': '@iconify-json/ri',
  'i-simple-icons-': '@iconify-json/simple-icons',
}

const failures = []
function fail(message) {
  failures.push(message)
}

// ---------------------------------------------------------------------------
// Inputs

const catalog = await tsImport(fileURLToPath(new URL('catalog.ts', PICKER_SRC)), import.meta.url)
const SECTIONS = {
  emoji: catalog.EMOJI_CATALOG,
  icon: catalog.ICON_CATALOG,
  brand: catalog.BRAND_CATALOG,
  ai: catalog.AI_CATALOG,
}

const iconSets = Object.fromEntries(Object.entries(SETS).map(([prefix, pkg]) => [prefix, {
  pkg,
  info: requireFromCoreApp(`${pkg}/info.json`),
  icons: requireFromCoreApp(`${pkg}/icons.json`),
  version: requireFromCoreApp(`${pkg}/package.json`).version,
}]))
const { pinyin } = requireFromCoreApp('pinyin-pro')
const pinyinVersion = requireFromCoreApp('pinyin-pro/package.json').version

// ---------------------------------------------------------------------------
// Catalog checks

const seenIds = new Map()
const seenClasses = new Map()
for (const [section, rows] of Object.entries(SECTIONS)) {
  for (const row of rows) {
    if (seenIds.has(row.id))
      fail(`${row.id} appears in both ${seenIds.get(row.id)} and ${section}`)
    seenIds.set(row.id, section)
    if (!row.category)
      fail(`${row.id} has no category`)
    else if (!catalog.ICON_PICKER_CATEGORY_LABELS[row.category])
      fail(`${row.id}: category "${row.category}" has no label in ICON_PICKER_CATEGORY_LABELS`)
    if (!row.keywords.trim())
      fail(`${row.id} has no keywords`)
    if (row.icon.type === 'class') {
      if (seenClasses.has(row.icon.value))
        fail(`${row.icon.value} is in both ${seenClasses.get(row.icon.value)} and ${section}`)
      seenClasses.set(row.icon.value, section)
    }
  }
}

// ---------------------------------------------------------------------------
// Glyphs

/** One icon's path data, or a reason it cannot be drawn as a single filled path. */
function glyphOf(className) {
  const prefix = Object.keys(SETS).find(p => className.startsWith(p))
  if (!prefix)
    return { error: 'is from no bundled icon set' }
  const set = iconSets[prefix].icons
  let name = className.slice(prefix.length)
  const alias = set.aliases?.[name]
  if (alias) {
    if (Object.keys(alias).some(key => key !== 'parent'))
      return { error: `is a transformed alias of ${alias.parent}` }
    name = alias.parent
  }
  const icon = set.icons[name]
  if (!icon)
    return { error: `does not exist in ${iconSets[prefix].pkg}@${iconSets[prefix].version}` }
  const width = icon.width ?? set.width ?? 16
  const height = icon.height ?? set.height ?? 16
  if (width !== 24 || height !== 24 || icon.left || icon.top)
    return { error: `is ${width}×${height}, and the picker draws every glyph on a 24-unit box` }
  const paths = [...icon.body.matchAll(/<path\s([^>]*?)\/>/g)]
  const stripped = icon.body.replace(/<path\s[^>]*?\/>/g, '')
  if (!paths.length || stripped.trim())
    return { error: 'is not a plain list of paths' }
  const ds = []
  for (const [, attrs] of paths) {
    const pairs = [...attrs.matchAll(/([\w-]+)="([^"]*)"/g)]
    const other = pairs.filter(([, key, value]) => key !== 'd' && !(key === 'fill' && value === 'currentColor'))
    if (other.length)
      return { error: `has a path with ${other.map(([, key]) => key).join(', ')}` }
    ds.push(pairs.find(([, key]) => key === 'd')?.[2] ?? '')
  }
  return { d: ds.join('') }
}

const chunks = {}
for (const [section, rows] of Object.entries(SECTIONS)) {
  const lines = []
  for (const row of rows) {
    if (row.icon.type !== 'class')
      continue
    const glyph = glyphOf(row.icon.value)
    if (glyph.error)
      fail(`${row.icon.value} ${glyph.error}`)
    else
      lines.push(`  '${row.icon.value}': '${glyph.d}',\n`)
  }
  // As few chunks as the cap allows, then evened out: filling each to the
  // cap leaves a last chunk of a few rows that costs a request of its own.
  const total = lines.reduce((sum, line) => sum + line.length, 0)
  const target = total / Math.max(1, Math.ceil(total / CHUNK_BYTES))
  chunks[section] = []
  let current = null
  for (const line of lines) {
    if (!current || (current.bytes + line.length > target && current.bytes > 0 && chunks[section].length < Math.ceil(total / CHUNK_BYTES))) {
      current = { name: `glyphs-${section}-${chunks[section].length + 1}`, lines: [], bytes: 0 }
      chunks[section].push(current)
    }
    current.lines.push(line)
    current.bytes += line.length
  }
}

// ---------------------------------------------------------------------------
// Pinyin

const HAN = /\p{Script=Han}/u
const words = new Set()
for (const rows of Object.values(SECTIONS)) {
  for (const row of rows) {
    for (const token of row.keywords.split(/\s+/)) {
      if (!token || !HAN.test(token))
        continue
      if (![...token].every(char => HAN.test(char)))
        fail(`${row.id}: keyword "${token}" mixes Chinese with other characters; split it`)
      else
        words.add(token)
    }
  }
}
const pinyinTable = [...words].sort().map((word) => {
  // IMEs type ü as v (绿 is lv), so that is what a search box receives.
  const syllables = pinyin(word, { toneType: 'none', type: 'array' }).map(s => s.replaceAll('ü', 'v'))
  return `${word}:${syllables.join(' ')}`
}).join('|')

// ---------------------------------------------------------------------------
// Shapes

const fmt = (n) => {
  const v = Math.round(n * 100) / 100
  return String(Object.is(v, -0) ? 0 : v)
}

/** Uniformly scales and centres point sets so their bounding box fills the 24-unit box. */
function fitter(points) {
  const xs = points.map(p => p[0])
  const ys = points.map(p => p[1])
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const scale = 24 / Math.max(maxX - minX, maxY - minY)
  const dx = (24 - (maxX - minX) * scale) / 2 - minX * scale
  const dy = (24 - (maxY - minY) * scale) / 2 - minY * scale
  return { scale, map: ([x, y]) => [x * scale + dx, y * scale + dy] }
}

/** A closed Catmull-Rom spline through the points, as cubic segments. */
function smoothClosed(points) {
  const n = points.length
  let d = `M${fmt(points[0][0])} ${fmt(points[0][1])}`
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n]
    const p1 = points[i]
    const p2 = points[(i + 1) % n]
    const p3 = points[(i + 2) % n]
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += `C${fmt(c1[0])} ${fmt(c1[1])} ${fmt(c2[0])} ${fmt(c2[1])} ${fmt(p2[0])} ${fmt(p2[1])}`
  }
  return `${d}Z`
}

/** A radial outline r(θ), θ measured clockwise from twelve o'clock, fitted to the box. */
function radial(samples, r) {
  const points = Array.from({ length: samples }, (_, i) => {
    const theta = (i / samples) * Math.PI * 2
    const radius = r(theta)
    return [Math.sin(theta) * radius, -Math.cos(theta) * radius]
  })
  const { map } = fitter(points)
  return smoothClosed(points.map(map))
}

/**
 * The outline of `count` overlapping circles of radius `rho` whose centres sit
 * `offset` from the middle, the first at angle `phase`: round lobes meeting in
 * pinches, which a sinusoidal r(θ) cannot draw — its lobes come out as petals.
 */
function lobes(count, offset, rho, phase = 0) {
  return (theta) => {
    let reach = 0
    for (let k = 0; k < count; k++) {
      const phi = theta - phase - (k / count) * Math.PI * 2
      const side = offset * Math.sin(phi)
      if (Math.abs(side) <= rho)
        reach = Math.max(reach, offset * Math.cos(phi) + Math.sqrt(rho * rho - side * side))
    }
    return reach
  }
}

/** A regular polygon, point up, with every corner rounded to `radius`, fitted to the box. */
function roundedPolygon(sides, radius) {
  const vertices = Array.from({ length: sides }, (_, i) => {
    const theta = -Math.PI / 2 + (i / sides) * Math.PI * 2
    return [Math.cos(theta) * 12, Math.sin(theta) * 12]
  })
  const corners = vertices.map((v, i) => {
    const prev = vertices[(i - 1 + sides) % sides]
    const next = vertices[(i + 1) % sides]
    const toPrev = unit([prev[0] - v[0], prev[1] - v[1]])
    const toNext = unit([next[0] - v[0], next[1] - v[1]])
    const half = Math.acos(toPrev[0] * toNext[0] + toPrev[1] * toNext[1]) / 2
    const reach = radius / Math.tan(half)
    const bisector = unit([toPrev[0] + toNext[0], toPrev[1] + toNext[1]])
    const centre = [v[0] + bisector[0] * radius / Math.sin(half), v[1] + bisector[1] * radius / Math.sin(half)]
    const enter = [v[0] + toPrev[0] * reach, v[1] + toPrev[1] * reach]
    const leave = [v[0] + toNext[0] * reach, v[1] + toNext[1] * reach]
    // Sampled, because the arc's extreme in x or y is wherever its tangent
    // runs level, which is only its midpoint when the corner faces an edge.
    const from = Math.atan2(enter[1] - centre[1], enter[0] - centre[0])
    let to = Math.atan2(leave[1] - centre[1], leave[0] - centre[0])
    while (to < from)
      to += Math.PI * 2
    const arc = Array.from({ length: 33 }, (_, k) => {
      const angle = from + ((to - from) * k) / 32
      return [centre[0] + Math.cos(angle) * radius, centre[1] + Math.sin(angle) * radius]
    })
    return { enter, leave, arc }
  })
  const { scale, map } = fitter(corners.flatMap(c => c.arc))
  const r = fmt(radius * scale)
  const pt = p => map(p).map(fmt).join(' ')
  let d = `M${pt(corners[0].leave)}`
  for (let i = 1; i <= sides; i++) {
    const corner = corners[i % sides]
    d += `L${pt(corner.enter)}A${r} ${r} 0 0 1 ${pt(corner.leave)}`
  }
  return `${d}Z`
}

function unit([x, y]) {
  const length = Math.hypot(x, y)
  return [x / length, y / length]
}

function heart(samples) {
  const points = Array.from({ length: samples }, (_, i) => {
    const t = (i / samples) * Math.PI * 2
    return [
      16 * Math.sin(t) ** 3,
      -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)),
    ]
  })
  const { map } = fitter(points)
  return smoothClosed(points.map(map))
}

// Order is the shape row's order: the avatar shapes, the polygons, then the
// expressive ones. Every outline starts at twelve o'clock and runs clockwise,
// which gives the morph engine matched starting points to work from.
const SHAPES = {
  circle: 'M12 0A12 12 0 1 1 12 24A12 12 0 1 1 12 0Z',
  // Four cubics with their handles at 93% of the half-edge: a superellipse of
  // exponent ~4.3, the continuous-curvature corner of an app icon.
  squircle: 'M12 0C23.16 0 24 0.84 24 12C24 23.16 23.16 24 12 24C0.84 24 0 23.16 0 12C0 0.84 0.84 0 12 0Z',
  rounded: 'M12 0H17.5A6.5 6.5 0 0 1 24 6.5V17.5A6.5 6.5 0 0 1 17.5 24H6.5A6.5 6.5 0 0 1 0 17.5V6.5A6.5 6.5 0 0 1 6.5 0Z',
  square: 'M12 0H21.8A2.2 2.2 0 0 1 24 2.2V21.8A2.2 2.2 0 0 1 21.8 24H2.2A2.2 2.2 0 0 1 0 21.8V2.2A2.2 2.2 0 0 1 2.2 0Z',
  diamond: roundedPolygon(4, 3),
  pentagon: roundedPolygon(5, 2.6),
  hexagon: roundedPolygon(6, 2.6),
  arch: 'M12 0A12 12 0 0 1 24 12V20A4 4 0 0 1 20 24H4A4 4 0 0 1 0 20V12A12 12 0 0 1 12 0Z',
  cookie: radial(72, lobes(9, 9.2, 3.4)),
  clover: radial(64, lobes(4, 6.2, 6.4, Math.PI / 4)),
  // Narrow tips and wide valleys: a raised cosine squared, ten points.
  burst: radial(60, theta => 8.6 + 3.4 * ((1 + Math.cos(10 * theta)) / 2) ** 2),
  heart: heart(40),
}

// ---------------------------------------------------------------------------
// Output

if (failures.length) {
  console.error(`generate-icon-picker-data: ${failures.length} problem(s), nothing written`)
  for (const message of failures)
    console.error(`  - ${message}`)
  process.exit(1)
}

const ri = iconSets['i-ri-']
const si = iconSets['i-simple-icons-']
const HEADER = [
  '// Generated by packages/tuffex/scripts/generate-icon-picker-data.mjs — do not edit.',
]
const GLYPH_HEADER = [
  ...HEADER,
  `// Path data: ${ri.info.name} ${ri.info.version} (${ri.info.license.spdx}, via ${ri.pkg}@${ri.version}),`,
  `// ${si.info.name} ${si.info.version} (${si.info.license.spdx}, via ${si.pkg}@${si.version}).`,
  '// Brand marks remain the trademarks of their owners.',
]

await rm(OUT_DIR, { recursive: true, force: true })
await mkdir(OUT_DIR, { recursive: true })

const written = []
async function emit(name, lines) {
  const text = `${lines.join('\n')}\n`
  await writeFile(new URL(name, OUT_DIR), text)
  written.push([name, Buffer.byteLength(text)])
}

for (const sectionChunks of Object.values(chunks)) {
  for (const chunk of sectionChunks) {
    await emit(`${chunk.name}.ts`, [
      ...GLYPH_HEADER,
      '',
      'const glyphs: Readonly<Record<string, string>> = {',
      chunk.lines.join('').trimEnd(),
      '}',
      '',
      'export default glyphs',
    ])
  }
}

await emit('chunks.ts', [
  ...HEADER,
  '',
  'import type { IconPickerCatalogSection } from \'../types\'',
  '',
  'export type GlyphChunk = () => Promise<{ default: Readonly<Record<string, string>> }>',
  '',
  '/** The glyph chunks each section draws from, imported the first time the section is needed. */',
  'export const GLYPH_CHUNKS: Readonly<Record<IconPickerCatalogSection, readonly GlyphChunk[]>> = {',
  ...Object.entries(chunks).map(([section, sectionChunks]) => sectionChunks.length
    ? [`  ${section}: [`, ...sectionChunks.map(c => `    () => import('./${c.name}'),`), '  ],'].join('\n')
    : `  ${section}: [],`),
  '}',
])

await emit('pinyin.ts', [
  ...HEADER,
  `// Readings from pinyin-pro ${pinyinVersion}, toneless, ü written as v.`,
  '',
  '/** `word:syllable syllable|…` for every Chinese keyword in the bundled catalog. */',
  `const table = '${pinyinTable}'`,
  '',
  'export default table',
])

await emit('shapes.ts', [
  ...HEADER,
  '',
  'import type { IconPickerShape } from \'../types\'',
  '',
  '/** Plate outlines on a 24-unit box, in shape-row order. */',
  'export const SHAPE_PATHS: Readonly<Record<IconPickerShape, string>> = {',
  ...Object.entries(SHAPES).map(([name, d]) => `  ${name}: '${d}',`),
  '}',
])

const existing = await readdir(OUT_DIR)
console.log(`generate-icon-picker-data: wrote ${existing.length} files to ${fileURLToPath(OUT_DIR)}`)
for (const [name, bytes] of written)
  console.log(`  ${name.padEnd(22)} ${(bytes / 1024).toFixed(1).padStart(6)} KiB`)
console.log(`  ${seenClasses.size} glyphs, ${words.size} pinyin words, ${Object.keys(SHAPES).length} shapes`)
