import { describe, expect, it } from 'vitest'
import {
  buildCircleBlurCss,
  buildCircleCss,
  buildFadeCss,
  buildGifCss,
  buildPolygonCss,
  buildPolygonGradientCss,
  buildWipeCss,
  resolveTransitionCss,
} from '../animation/theme-transition'

describe('tuffex theme-transition animation module', () => {
  it('builds circle-blur CSS with SVG Gaussian blur and correct origin', () => {
    const css = buildCircleBlurCss(120, 240, 450, 'cubic-bezier(0.16, 1, 0.3, 1)', 3.5, false)

    expect(css).toContain('data:image/svg+xml')
    expect(css).toContain('feGaussianBlur')
    expect(css).toContain('tuff-vt-circle-blur')
    expect(css).toContain('mask-position: 120px 240px')
  })

  it('builds circle CSS with clip-path circle', () => {
    const css = buildCircleCss(150, 250, 350)
    expect(css).toContain('clip-path: circle(0px at 150px 250px)')
    expect(css).toContain('tuff-vt-circle')
  })

  it('builds polygon CSS', () => {
    const css = buildPolygonCss(600)
    expect(css).toContain('polygon(50% -71%, -50% 71%, -50% 71%, 50% -71%)')
  })

  it('builds polygon-gradient CSS', () => {
    const css = buildPolygonGradientCss(800)
    expect(css).toContain('linearGradient')
  })

  it('builds wipe CSS', () => {
    const css = buildWipeCss(400)
    expect(css).toContain('inset(0 100% 0 0)')
  })

  it('builds fade CSS', () => {
    const css = buildFadeCss(250)
    expect(css).toContain('tuff-vt-fade-in')
  })

  it('builds gif CSS', () => {
    const css = buildGifCss('https://example.com/sample.gif', 1500)
    expect(css).toContain('url(\'https://example.com/sample.gif\')')
  })

  it('resolves default variant to circle-blur with origin', () => {
    const css = resolveTransitionCss({ origin: { clientX: 200, clientY: 300 } })
    expect(css).toContain('tuff-vt-circle-blur')
    expect(css).toContain('200px 300px')
  })
})
