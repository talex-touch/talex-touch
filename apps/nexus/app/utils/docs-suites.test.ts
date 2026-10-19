import { describe, expect, it } from 'vitest'
import { resolveStaticComponentSuite, STATIC_COMPONENT_SUITE_MAP } from './docs-suites'

describe('docs-suites', () => {
  it('maps components to their designated suites', () => {
    expect(resolveStaticComponentSuite('/docs/dev/components/learning-curve')).toBe('data')
    expect(resolveStaticComponentSuite('/zh/docs/dev/components/learning-curve')).toBe('data')
    expect(resolveStaticComponentSuite('/en/docs/dev/components/learning-curve.en')).toBe('data')
    expect(resolveStaticComponentSuite('/docs/dev/components/timeseries-chart')).toBe('data')
    expect(resolveStaticComponentSuite('/docs/dev/components/button')).toBe('base')
    expect(resolveStaticComponentSuite('/docs/dev/components/chat')).toBe('ai')
    expect(resolveStaticComponentSuite('/docs/dev/components/card')).toBe('base')
    expect(resolveStaticComponentSuite('/docs/dev/components/flowchart')).toBe('flow')
    expect(resolveStaticComponentSuite('/docs/dev/components/motion-button')).toBe('motion')
    expect(resolveStaticComponentSuite('/docs/dev/components/command-palette')).toBe('pro')
    expect(resolveStaticComponentSuite('/docs/dev/components/template-shell')).toBe('templates')
  })

  it('returns null for unknown paths', () => {
    expect(resolveStaticComponentSuite('/docs/dev/unknown-slug')).toBeNull()
    expect(resolveStaticComponentSuite('/guide')).toBeNull()
  })

  it('has valid non-empty static component map', () => {
    expect(Object.keys(STATIC_COMPONENT_SUITE_MAP).length).toBeGreaterThan(200)
    expect(STATIC_COMPONENT_SUITE_MAP['/docs/dev/components/learning-curve']).toBe('data')
  })
})
