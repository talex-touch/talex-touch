/**
 * Fails on a hex colour written straight into a component stylesheet.
 *
 * Colours reach a component through `--tx-*` tokens, which is what lets the
 * dark and high-contrast palettes repaint it: they redefine tokens and nothing
 * else. A bare `#fff` in a declaration is out of their reach, so it stays white
 * on a dark high-contrast panel and no palette can say otherwise.
 *
 * A hex literal is allowed in three places:
 *   - the fallback of a `var()` — `var(--tx-bg-color, #fff)` — read only when
 *     the token is missing;
 *   - a custom-property definition — `--tx-drawer-shade: #000` — which *is* a
 *     token, and is where palettes and components declare colours;
 *   - mask properties — `mask-image: linear-gradient(#000, transparent)` — where
 *     only the alpha counts and the hue is never painted.
 * Anywhere else, including a Sass variable or a mixin argument, it fails: both
 * are resolved at compile time, before any palette runs.
 *
 * Scope: the `<style>` blocks of `.vue` files, and `.scss` / `.css` files, under
 * packages/components/{src,style}, tests excluded. Hex in templates and scripts
 * (SVG data, chart palettes, colour-picker presets) is content, not styling, and
 * is out of scope. So are `rgb()` / `rgba()` values.
 *
 * Usage:
 *   pnpm -C packages/tuffex audit:colors
 *   pnpm -C packages/tuffex audit:colors:self-test
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(scriptDir, '..', 'packages', 'components')
const roots = [join(packageRoot, 'src'), join(packageRoot, 'style')]

const HEX = /#[0-9a-f]{3,8}\b/gi
const MASK_PROPERTY = /^(?:-webkit-)?mask(?:-image)?$/
const STYLE_BLOCK = /<style[^>]*>([\s\S]*?)<\/style>/g

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules' || name === 'dist')
        continue
      walk(path, out)
    }
    else if (/\.(?:vue|scss|css)$/.test(name)) {
      out.push(path)
    }
  }
  return out
}

/** Blanks comments character for character, so offsets and line numbers survive. */
function blankComments(css) {
  const blank = match => match.replace(/[^\n]/g, ' ')
  return css
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    // `//` after a colon or a word character is a URL (`https://`), not a comment.
    .replace(/(?<![:\w])\/\/[^\n]*/g, blank)
}

/** The stylesheets in a file, each with its offset into the file. */
function styleBlocks(path, source) {
  if (!path.endsWith('.vue'))
    return [{ offset: 0, css: source }]
  return [...source.matchAll(STYLE_BLOCK)].map(match => ({
    offset: match.index + match[0].indexOf('>') + 1,
    css: match[1],
  }))
}

/** The functions `prefix` leaves open, innermost last: `['var(', '(']` inside a fallback's `color-mix(`. */
function openFunctions(prefix) {
  const open = []
  for (const [token] of prefix.matchAll(/var\(|url\(|\(|\)/g)) {
    if (token === ')')
      open.pop()
    else
      open.push(token)
  }
  return open
}

/**
 * Hex colours outside a token, as `{ path, line, hex, declaration }`.
 *
 * Over `{ path, source }` records rather than the filesystem, so `--self-test`
 * can hand it sources whose answer is known.
 */
export function findHexLiterals(files) {
  const found = []
  for (const file of files) {
    for (const { offset, css: raw } of styleBlocks(file.path, file.source)) {
      const css = blankComments(raw)
      for (const match of css.matchAll(HEX)) {
        const digits = match[0].length - 1
        if (![3, 4, 6, 8].includes(digits))
          continue

        const at = match.index
        const start = Math.max(css.lastIndexOf(';', at), css.lastIndexOf('{', at), css.lastIndexOf('}', at)) + 1
        const ends = [';', '}', '{'].map(char => css.indexOf(char, at)).filter(index => index !== -1)
        const end = ends.length ? Math.min(...ends) : css.length
        // A `{` before the next `;` means this is a selector (`#fab .x {`), not a value.
        if (css[end] === '{')
          continue

        const declaration = css.slice(start, end).trim()
        const colon = declaration.indexOf(':')
        const property = colon === -1 ? '' : declaration.slice(0, colon).trim()
        if (property.startsWith('--') || MASK_PROPERTY.test(property))
          continue
        // In a `var()` it is the fallback; in a `url()` it is a fragment (`url(#glass-filter)`).
        const open = openFunctions(css.slice(start, at))
        if (open.includes('var(') || open.includes('url('))
          continue

        found.push({
          path: file.path,
          line: file.source.slice(0, offset + at).split('\n').length,
          hex: match[0],
          declaration: declaration.replace(/\s+/g, ' '),
        })
      }
    }
  }
  return found
}

function selfTest() {
  let failures = 0
  const vue = css => `<template><svg fill="#fff" /></template>\n<style lang="scss">\n${css}\n</style>\n`
  const cases = [
    {
      label: 'a bare hex in a declaration fails',
      files: [{ path: 'a/A.vue', source: vue('.a { color: #fff; }') }],
      expect: ['a/A.vue:3 #fff'],
    },
    {
      label: 'a hex mixed into a shade fails',
      files: [{ path: 'a/a.scss', source: '.a {\n  background: color-mix(in srgb, var(--x) 88%, #000);\n}' }],
      expect: ['a/a.scss:2 #000'],
    },
    {
      label: 'a var() fallback passes, nested in another function too',
      files: [{ path: 'a/A.vue', source: vue('.a { color: var(--tx-a, #fff); border-color: var(--tx-b, color-mix(in srgb, #000 10%, transparent)); }') }],
      expect: [],
    },
    {
      label: 'a hex after a closed var() fails',
      files: [{ path: 'a/A.vue', source: vue('.a { background: linear-gradient(var(--tx-a), #fff); }') }],
      expect: ['a/A.vue:3 #fff'],
    },
    {
      label: 'a custom-property definition passes',
      files: [{ path: 'a/a.scss', source: ':root { --tx-a: #ffffff; --tx-b: color-mix(in srgb, #000 10%, transparent); }' }],
      expect: [],
    },
    {
      label: 'a mask passes',
      files: [{ path: 'a/a.scss', source: '.a { mask-image: linear-gradient(#000, transparent); -webkit-mask: radial-gradient(#000 60%, #0000); }' }],
      expect: [],
    },
    {
      label: 'a Sass variable and a mixin argument fail',
      files: [{ path: 'a/a.scss', source: '$ink: #333;\n.a { @include tint(#abc); }' }],
      expect: ['a/a.scss:1 #333', 'a/a.scss:2 #abc'],
    },
    {
      label: 'comments, templates, selectors and interpolation are ignored',
      files: [{ path: 'a/A.vue', source: vue('/* color: #fff; */\n// color: #000;\n#fab .x { color: var(--tx-a); }\n.b-#{$n} { background: url(https://x.test/#ff0); }') }],
      expect: [],
    },
    {
      label: 'only 3, 4, 6 and 8 digits are colours',
      files: [{ path: 'a/a.scss', source: '.a { color: #12345; outline-color: #1234; }' }],
      expect: ['a/a.scss:1 #1234'],
    },
  ]

  for (const testCase of cases) {
    const actual = findHexLiterals(testCase.files).map(entry => `${entry.path}:${entry.line} ${entry.hex}`)
    if (JSON.stringify(actual) !== JSON.stringify(testCase.expect)) {
      failures += 1
      console.error(`  FAIL ${testCase.label}`)
      console.error(`       expected ${JSON.stringify(testCase.expect)}`)
      console.error(`       actual   ${JSON.stringify(actual)}`)
    }
  }

  console.log(
    failures
      ? `\ncolor-literals self-test: ${failures} of ${cases.length} cases failed`
      : `color-literals self-test: ${cases.length} cases pass`,
  )
  return failures
}

if (process.argv.includes('--self-test'))
  process.exit(selfTest() > 0 ? 1 : 0)

const files = roots.flatMap(root => walk(root)).map(path => ({
  path: relative(packageRoot, path),
  source: readFileSync(path, 'utf8'),
}))

const found = findHexLiterals(files)
if (found.length) {
  console.error(`\x1B[31m[audit:colors] ${found.length} hex colour(s) outside a token:\x1B[0m`)
  for (const entry of found) {
    const declaration = entry.declaration.length > 80 ? `${entry.declaration.slice(0, 79)}…` : entry.declaration
    console.error(`  ${entry.path}:${entry.line}  ${entry.hex}  ${declaration}`)
  }
  console.error(
    '\nRead the colour from a `--tx-*` token, with the hex as the `var()` fallback if you need one'
    + '\n(`color: var(--tx-color-on-primary, #fff)`), or declare it as a custom property the'
    + '\ncomponent reads. See the header of scripts/audit-color-literals.mjs for what is allowed.',
  )
  process.exit(1)
}

console.log(`[audit:colors] ${files.length} stylesheets, no hex colour outside a token.`)
