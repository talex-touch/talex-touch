import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import TxImageGallery from '../src/TxImageGallery.vue'

// The gallery imports the preview the first time it is needed. Loaded here first, that import
// settles within a flush instead of racing the assertions after the first press.
beforeAll(async () => {
  await import('../../image-preview')
})

const items = [
  { id: 'a', url: '/a.png', name: 'Alpha' },
  { id: 'b', url: '/b.png', name: 'Beta' },
  { id: 'c', url: '/c.png' },
]

// TxImagePreview's parts. Its neighbouring slides are drawn too, aria-hidden, so the picture
// shown is the current slide's; a closed preview stays in the DOM while it fades.
const overlay = () => document.body.querySelector<HTMLElement>('.tx-image-preview')
const openOverlay = () => document.body.querySelector<HTMLElement>('.tx-image-preview:not(.is-closing)')
const shownSrc = () =>
  document.body.querySelector<HTMLImageElement>('.tx-image-preview__slide:not([aria-hidden]) .tx-image-preview__image')?.getAttribute('src')
const counter = () => document.body.querySelector('.tx-image-preview__counter')?.textContent?.trim()
const nav = (label: string) => document.body.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!

describe('txImageGallery', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders thumbnails with image alt text and open labels', () => {
    const wrapper = mount(TxImageGallery, {
      props: { items },
    })

    const thumbs = wrapper.findAll('.tx-image-gallery__thumb')
    expect(thumbs).toHaveLength(3)
    expect(thumbs[0].attributes('aria-label')).toBe('Open Alpha preview')
    expect(thumbs[2].attributes('aria-label')).toBe('Open Image 3 preview')
    expect(wrapper.findAll('img').map(img => img.attributes('alt'))).toEqual(['Alpha', 'Beta', ''])
  })

  it('opens the preview at the clicked item and emits the selected item', async () => {
    const wrapper = mount(TxImageGallery, {
      props: { items },
      attachTo: document.body,
    })

    await wrapper.findAll('.tx-image-gallery__thumb')[1].trigger('click')
    await flushPromises()

    expect(wrapper.emitted('open')?.[0]).toEqual([{ index: 1, item: items[1] }])
    expect(overlay()?.getAttribute('aria-label')).toBe('Preview: Beta')
    expect(document.body.querySelector('.tx-image-preview__name')?.textContent).toBe('Beta')
    expect(shownSrc()).toBe('/b.png')
    expect(counter()).toBe('2 / 3')
    wrapper.unmount()
  })

  it('navigates with boundary-disabled previous and next controls', async () => {
    const wrapper = mount(TxImageGallery, {
      props: { items },
      attachTo: document.body,
    })

    await wrapper.findAll('.tx-image-gallery__thumb')[0].trigger('click')
    await flushPromises()

    expect(nav('Previous image').getAttribute('aria-disabled')).toBe('true')
    expect(nav('Next image').hasAttribute('aria-disabled')).toBe(false)

    nav('Next image').click()
    await nextTick()
    expect(shownSrc()).toBe('/b.png')
    expect(counter()).toBe('2 / 3')

    nav('Next image').click()
    await nextTick()
    expect(shownSrc()).toBe('/c.png')
    expect(counter()).toBe('3 / 3')
    expect(nav('Next image').getAttribute('aria-disabled')).toBe('true')

    // An unavailable button does nothing.
    nav('Next image').click()
    await nextTick()
    expect(shownSrc()).toBe('/c.png')

    nav('Previous image').click()
    await nextTick()
    expect(shownSrc()).toBe('/b.png')
    expect(counter()).toBe('2 / 3')
    wrapper.unmount()
  })

  it('keeps focus in the dialog when navigation reaches either end', async () => {
    const wrapper = mount(TxImageGallery, {
      props: { items },
      attachTo: document.body,
    })

    const thumb = (i: number) => wrapper.findAll('.tx-image-gallery__thumb')[i]!

    await thumb(0).trigger('click')
    await flushPromises()

    // Walking to the last image makes Next unavailable under the pointer. It says so with
    // aria-disabled and stays focusable, so focus stays on the control the user was using
    // rather than falling out of the dialog.
    nav('Next image').focus()
    nav('Next image').click()
    nav('Next image').click()
    await flushPromises()
    expect(nav('Next image').getAttribute('aria-disabled')).toBe('true')
    expect(document.activeElement).toBe(nav('Next image'))

    // The dialog is still Escape-able, and closing puts focus back on the
    // thumbnail the preview was opened from.
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(openOverlay()).toBeNull()
    expect(document.activeElement).toBe(thumb(0).element)

    // The opposite end, same rule with the controls the other way round.
    await thumb(items.length - 1).trigger('click')
    await nextTick()
    nav('Previous image').focus()
    nav('Previous image').click()
    nav('Previous image').click()
    await flushPromises()
    expect(nav('Previous image').getAttribute('aria-disabled')).toBe('true')
    expect(document.activeElement).toBe(nav('Previous image'))
    expect(overlay()!.contains(document.activeElement)).toBe(true)

    wrapper.unmount()
  })

  it('does not open or emit for an empty list', async () => {
    const wrapper = mount(TxImageGallery, {
      props: { items: [] },
      attachTo: document.body,
    })

    expect(wrapper.findAll('.tx-image-gallery__thumb')).toHaveLength(0)
    expect(overlay()).toBeNull()
    expect(wrapper.emitted('open')).toBeUndefined()
  })

  it('clamps startIndex updates and closes when the list becomes empty', async () => {
    const wrapper = mount(TxImageGallery, {
      props: {
        items,
        startIndex: 0,
      },
      attachTo: document.body,
    })

    await wrapper.findAll('.tx-image-gallery__thumb')[0].trigger('click')
    await flushPromises()
    expect(counter()).toBe('1 / 3')

    await wrapper.setProps({ startIndex: 9 })
    await nextTick()
    expect(counter()).toBe('3 / 3')

    // One image left: it is shown, and a single image has no counter.
    await wrapper.setProps({ items: [items[0]] })
    await nextTick()
    expect(shownSrc()).toBe('/a.png')
    expect(counter()).toBeUndefined()

    await wrapper.setProps({ items: [] })
    await nextTick()
    expect(openOverlay()).toBeNull()
    wrapper.unmount()
  })

  it('localizes the thumbnail open-label and fallback item-label formatters', () => {
    const wrapper = mount(TxImageGallery, {
      props: {
        items,
        itemLabelFormatter: (i: number) => `图片 ${i + 1}`,
        openLabelFormatter: (label: string) => `打开 ${label}`,
      },
    })

    const thumbs = wrapper.findAll('.tx-image-gallery__thumb')
    // Named item: the open formatter wraps the item's name.
    expect(thumbs[0].attributes('aria-label')).toBe('打开 Alpha')
    // Unnamed item: the fallback item formatter feeds the open formatter.
    // Pre-fix these were the hardcoded `Open ${label} preview` / `Image N`.
    expect(thumbs[2].attributes('aria-label')).toBe('打开 图片 3')
  })
})
