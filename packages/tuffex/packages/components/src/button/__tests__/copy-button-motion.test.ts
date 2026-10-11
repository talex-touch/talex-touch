import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as sass from 'sass'
import { describe, expect, it } from 'vitest'

// Compiled CSS, not source text: vitest never compiles `<style>`.
const SFC = resolve(dirname(fileURLToPath(import.meta.url)), '../src/copy-button.vue')
const NO_PREFERENCE = '@media (prefers-reduced-motion: no-preference)'

interface Rule {
  selectors: string[]
  declarations: Map<string, string>
  media: string | null
}

function parseCssRules(rawCss: string): Rule[] {
  const css = rawCss
    // Sass keeps /* */ comments, and a non-ASCII one adds an @charset line;
    // either in a prelude would read as part of the next selector.
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@charset[^;]*;/g, '')
  const out: Rule[] = []
  const atRules: string[] = []
  let prelude = ''
  let i = 0
  while (i < css.length) {
    const char = css[i++]!
    if (char === '{') {
      const head = prelude.trim()
      prelude = ''
      if (head.startsWith('@')) {
        atRules.push(head)
        continue
      }
      const end = css.indexOf('}', i)
      const declarations = new Map<string, string>()
      for (const part of css.slice(i, end).split(';')) {
        const colon = part.indexOf(':')
        if (colon > 0)
          declarations.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim())
      }
      out.push({ selectors: head.split(',').map(s => s.trim()), declarations, media: atRules.at(-1) ?? null })
      i = end + 1
    }
    else if (char === '}') {
      atRules.pop()
      prelude = ''
    }
    else {
      prelude += char
    }
  }
  return out
}

function rules(): Rule[] {
  const source = readFileSync(SFC, 'utf8')
  const css = [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
    .map(match => sass.compileString(match[1] ?? '', { url: pathToFileURL(SFC), syntax: 'scss' }).css)
    .join('\n')
  return parseCssRules(css)
}

describe('txCopyButton motion contract', () => {
  const all = rules()
  const transitions = all.filter(r => r.declarations.has('transition') || r.declarations.has('transition-property'))

  it('declares motion only for those who have not asked for less', () => {
    expect(transitions.length).toBeGreaterThan(0)
    for (const rule of transitions)
      expect(rule.media, rule.selectors.join(', ')).toBe(NO_PREFERENCE)
  })

  it('eases colour only on the state-change class, never on hover', () => {
    for (const rule of transitions) {
      const value = rule.declarations.get('transition') ?? ''
      if (/\b(?:color|background-color|background|box-shadow)\b/.test(value))
        expect(rule.selectors.every(s => s.includes('.is-morphing')), rule.selectors.join(', ')).toBe(true)
    }
    const hover = all.filter(r => r.selectors.some(s => s.includes(':hover')))
    expect(hover.length).toBeGreaterThan(0)
    for (const rule of hover)
      expect(rule.declarations.has('transition'), rule.selectors.join(', ')).toBe(false)
  })

  it('draws its edge as a ring, not a border', () => {
    const root = all.find(r => r.selectors.includes('.tx-copy-button') && r.media === null)!
    expect(root.declarations.get('border')).toBe('0')
    expect(root.declarations.get('box-shadow')).toContain('inset 0 0 0 1px')
  })
})

const BUTTON_SCSS = resolve(dirname(fileURLToPath(import.meta.url)), '../src/style/index.scss')

describe('txButton progress & status motion contract', () => {
  const all = parseCssRules(sass.compile(BUTTON_SCSS).css)

  it('declares progress fill and status glyph transitions only inside prefers-reduced-motion: no-preference', () => {
    const progressAndStatusMotion = all.filter(r =>
      r.selectors.some(s =>
        s.includes('.tx-button__progress-fill')
        || s.includes('.tx-button.is-morphing')
        || s.includes('.tx-button__status-glyph')
        || s.includes('.tx-button__status-dot'),
      ) && (r.declarations.has('transition') || r.declarations.has('animation')),
    )
    expect(progressAndStatusMotion.length).toBeGreaterThan(0)
    for (const rule of progressAndStatusMotion)
      expect(rule.media, rule.selectors.join(', ')).toBe(NO_PREFERENCE)
  })

  it('gates root button colour transitions behind .is-morphing, never on :hover', () => {
    const rootColourTransitions = all.filter(r =>
      r.selectors.some(s => s.startsWith('.tx-button') && !s.includes('__'))
      && /\b(?:color|background-color|border-color)\b/.test(r.declarations.get('transition') ?? ''),
    )
    expect(rootColourTransitions.length).toBeGreaterThan(0)
    for (const rule of rootColourTransitions)
      expect(rule.selectors.every(s => s.includes('.is-morphing')), rule.selectors.join(', ')).toBe(true)
  })
})
