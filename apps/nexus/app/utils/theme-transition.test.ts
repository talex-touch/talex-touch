import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyThemeTransition,
  buildCircleBlurCss,
  buildCircleCss,
  buildFadeCss,
  buildGifCss,
  buildPolygonCss,
  buildPolygonGradientCss,
  buildWipeCss,
  resolveTransitionCss,
  THEME_VIEW_TRANSITION_STYLE_ID,
} from './theme-transition'

interface MockDocument {
  getElementById: (id: string) => MockElement | null
  createElement: (tag: string) => MockElement
  head: {
    appendChild: (el: MockElement) => void
  }
  startViewTransition?: (callback: () => void | Promise<void>) => {
    ready: Promise<void>
    finished: Promise<void>
  }
}

interface MockElement {
  id: string
  textContent: string
  parentNode: { removeChild: (child: MockElement) => void } | null
  remove: () => void
}

describe('theme-transition', () => {
  describe('css generators (SSR safe)', () => {
    it('generates circle-blur CSS with SVG Gaussian blur and exact origin coordinates', () => {
      const css = buildCircleBlurCss(100, 200, 450, 'cubic-bezier(0.16, 1, 0.3, 1)', 3.5, false)

      expect(css).toContain('data:image/svg+xml')
      expect(css).toContain('feGaussianBlur')
      expect(css).toContain('stdDeviation%3D%223.5%22')
      expect(css).toContain('tuff-vt-circle-blur')
      expect(css).toContain('mask-position: 100px 200px')
      expect(css).toContain('-webkit-mask-size: 0px 0px')
    })

    it('generates reverse circle-blur CSS when reverse is true', () => {
      const css = buildCircleBlurCss(100, 200, 450, 'cubic-bezier(0.16, 1, 0.3, 1)', 3.5, true)

      expect(css).toContain('0%')
      expect(css).toContain('100%')
      expect(css).toMatch(/100%\s*\{[^}]*mask-size:\s*0px 0px/)
    })

    it('generates circle CSS with clip-path circle', () => {
      const css = buildCircleCss(150, 250, 350)
      expect(css).toContain('clip-path: circle(0px at 150px 250px)')
      expect(css).toContain('tuff-vt-circle')
    })

    it('generates polygon CSS with diagonal slash keyframes', () => {
      const css = buildPolygonCss(600)
      expect(css).toContain('polygon(50% -71%, -50% 71%, -50% 71%, 50% -71%)')
      expect(css).toContain('polygon(50% -71%, -50% 71%, 50% 171%, 171% 50%)')
    })

    it('generates polygon-gradient CSS with SVG gradient mask', () => {
      const css = buildPolygonGradientCss(800)
      expect(css).toContain('linearGradient')
      expect(css).toContain('mask-size: 300vmax')
    })

    it('generates wipe CSS with inset clip-path', () => {
      const css = buildWipeCss(400)
      expect(css).toContain('inset(0 100% 0 0)')
      expect(css).toContain('inset(0 0 0 0)')
    })

    it('generates fade CSS with opacity transition', () => {
      const css = buildFadeCss(250)
      expect(css).toContain('tuff-vt-fade-out')
      expect(css).toContain('tuff-vt-fade-in')
    })

    it('generates gif CSS with custom mask URL', () => {
      const customGif = 'https://example.com/custom.gif'
      const css = buildGifCss(customGif, 1500)
      expect(css).toContain(`url('${customGif}')`)
      expect(css).toContain('2500vmax')
    })
  })

  describe('resolveTransitionCss', () => {
    it('defaults to circle-blur with click coordinates', () => {
      const css = resolveTransitionCss({ origin: { clientX: 300, clientY: 400 } })
      expect(css).toContain('300px 400px')
      expect(css).toContain('feGaussianBlur')
    })

    it('accepts array coordinates as origin', () => {
      const css = resolveTransitionCss({ origin: [50, 75] })
      expect(css).toContain('50px 75px')
    })

    it('switches between variants based on option', () => {
      expect(resolveTransitionCss({ variant: 'polygon' })).toContain('tuff-vt-polygon')
      expect(resolveTransitionCss({ variant: 'wipe' })).toContain('tuff-vt-wipe')
      expect(resolveTransitionCss({ variant: 'fade' })).toContain('tuff-vt-fade')
      expect(resolveTransitionCss({ variant: 'circle' })).toContain('tuff-vt-circle')
    })
  })

  describe('applyThemeTransition execution', () => {
    const originalWindow = globalThis.window
    const originalDocument = globalThis.document

    let elements: Map<string, MockElement>
    let mockDoc: MockDocument

    beforeEach(() => {
      elements = new Map()

      mockDoc = {
        getElementById: (id: string) => elements.get(id) ?? null,
        createElement: (_tag: string) => {
          const el: MockElement = {
            id: '',
            textContent: '',
            parentNode: null,
            remove: () => {
              if (el.id)
                elements.delete(el.id)
              el.parentNode = null
            },
          }
          return el
        },
        head: {
          appendChild: (el: MockElement) => {
            el.parentNode = {
              removeChild: (child: MockElement) => {
                if (child.id)
                  elements.delete(child.id)
                child.parentNode = null
              },
            }
            if (el.id)
              elements.set(el.id, el)
          },
        },
      }

      const mockWin = {
        innerWidth: 1000,
        innerHeight: 800,
        matchMedia: vi.fn(() => ({
          matches: false,
        })),
      }

      Object.defineProperty(globalThis, 'window', {
        value: mockWin,
        configurable: true,
        writable: true,
      })
      Object.defineProperty(globalThis, 'document', {
        value: mockDoc,
        configurable: true,
        writable: true,
      })
    })

    afterEach(() => {
      Object.defineProperty(globalThis, 'window', {
        value: originalWindow,
        configurable: true,
        writable: true,
      })
      Object.defineProperty(globalThis, 'document', {
        value: originalDocument,
        configurable: true,
        writable: true,
      })
      vi.restoreAllMocks()
    })

    it('runs update callback directly if startViewTransition is unsupported', () => {
      let called = false
      applyThemeTransition(() => {
        called = true
      })

      expect(called).toBe(true)
      expect(elements.has(THEME_VIEW_TRANSITION_STYLE_ID)).toBe(false)
    })

    it('runs update callback directly if prefers-reduced-motion is true', () => {
      const win = globalThis.window as unknown as { matchMedia: (query: string) => { matches: boolean } }
      win.matchMedia = vi.fn((query: string) => ({
        matches: query.includes('prefers-reduced-motion: reduce'),
      }))

      let called = false
      applyThemeTransition(() => {
        called = true
      })

      expect(called).toBe(true)
      expect(elements.has(THEME_VIEW_TRANSITION_STYLE_ID)).toBe(false)
    })

    it('injects style tag and cleans it up when transition finishes', async () => {
      let resolveFinished: () => void = () => {}
      const finishedPromise = new Promise<void>((resolve) => {
        resolveFinished = resolve
      })

      const mockStartVt = vi.fn((cb: () => void) => {
        cb()
        return {
          ready: Promise.resolve(),
          finished: finishedPromise,
        }
      })
      mockDoc.startViewTransition = mockStartVt

      let called = false
      const result = applyThemeTransition(() => {
        called = true
      }, {
        origin: { clientX: 200, clientY: 200 },
        variant: 'circle-blur',
      })

      expect(called).toBe(true)
      expect(mockStartVt).toHaveBeenCalled()

      const styleEl = elements.get(THEME_VIEW_TRANSITION_STYLE_ID)
      expect(styleEl).toBeDefined()
      expect(styleEl?.textContent).toContain('tuff-vt-circle-blur')
      expect(styleEl?.textContent).toContain('200px 200px')

      resolveFinished()
      await result

      expect(elements.has(THEME_VIEW_TRANSITION_STYLE_ID)).toBe(false)
    })

    it('falls back safely if startViewTransition throws', () => {
      mockDoc.startViewTransition = vi.fn(() => {
        throw new Error('transition failed')
      })

      let called = false
      applyThemeTransition(() => {
        called = true
      })

      expect(called).toBe(true)
      expect(elements.has(THEME_VIEW_TRANSITION_STYLE_ID)).toBe(false)
    })
  })
})
