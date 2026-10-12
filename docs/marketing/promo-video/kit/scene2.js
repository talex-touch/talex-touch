/* Tuff v2.4.14 — CoreBox launch film, v2. Deterministic: everything is a function of the seek time. */
gsap.ticker.lagSmoothing(0)
const tl = gsap.timeline({ paused: true, defaults: { ease: 'power3.out' } })
const stage = document.getElementById('stage')
const rig = document.getElementById('rig')
const cam = document.getElementById('cam')
const winLayer = document.getElementById('winLayer')
const fxBack = document.getElementById('fxBack')
const fxFront = document.getElementById('fxFront')
const topLayer = document.getElementById('topLayer')
const glowLayer = document.getElementById('glow')
const blurNode = document.getElementById('mblurN')

// ---------- helpers ----------
const h = (tag, cls, html) => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (html != null) e.innerHTML = html
  return e
}
const svg = (name) => {
  const ic = window.ICONS[name]
  return `<svg viewBox="0 0 ${ic.w} ${ic.h}" fill="currentColor">${ic.body}</svg>`
}
const app = (n) => `icons-light/${n}.png`
const ft = (n) => `icons/${n}.png`
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))

// ---------- sound cues (read by the audio renderer) ----------
const cues = []
function sfx(t, kind, opts = {}) { cues.push({ t: +t.toFixed(4), kind, ...opts }) }

// Tracks evaluated every frame (text content, classes, crossfades) — order independent.
const tracks = []
function textTrack(node, entries) { tracks.push({ kind: 'text', node, entries: entries.sort((a, b) => a[0] - b[0]), last: null }) }
function classTrack(node, cls, entries) { tracks.push({ kind: 'class', node, cls, entries: entries.sort((a, b) => a[0] - b[0]) }) }
function switchTrack(container, entries, fade = 0.14) {
  tracks.push({ kind: 'switch', kids: [...container.children], entries: entries.sort((a, b) => a[0] - b[0]), fade })
}
function current(entries, t) {
  let cur = null
  let prev = null
  for (const e of entries) {
    if (e[0] <= t) { prev = cur; cur = e } else break
  }
  return { cur, prev }
}
const frameFns = []
function runTracks(t) {
  for (const tr of tracks) {
    const { cur, prev } = current(tr.entries, t)
    if (tr.kind === 'text') {
      const v = cur ? cur[1] : ''
      if (v !== tr.last) { tr.node.innerHTML = v; tr.last = v }
    } else if (tr.kind === 'class') {
      tr.node.classList.toggle(tr.cls, cur ? !!cur[1] : false)
    } else if (tr.kind === 'switch') {
      const idx = cur ? cur[1] : -1
      const pidx = prev ? prev[1] : -1
      const p = cur ? clamp((t - cur[0]) / tr.fade) : 1
      tr.kids.forEach((k, i) => {
        let o = 0
        if (i === idx) o = p
        else if (i === pidx && p < 1) o = 1 - p
        k.style.opacity = o
      })
    }
  }
  for (const fn of frameFns) fn(t)
}

// Apple-ish reveal helpers on the timeline.
function reveal(node, at, opts = {}) {
  const { y = 26, blur = 10, dur = 0.8, scale = 1, ease = 'power3.out' } = opts
  tl.fromTo(node, { opacity: 0, y, filter: `blur(${blur}px)`, scale },
    { opacity: 1, y: 0, filter: 'blur(0px)', scale: 1, duration: dur, ease, immediateRender: opts.immediate ?? true }, at)
}
function conceal(node, at, opts = {}) {
  const { y = -14, blur = 10, dur = 0.45, scale = 1 } = opts
  tl.to(node, { opacity: 0, y, filter: `blur(${blur}px)`, scale, duration: dur, ease: 'power2.in', immediateRender: false }, at)
}
// Word-by-word kinetic reveal: each word lands on its own sixteenth.
function splitWords(text) {
  return text.split(' ').map((w) => `<span class="w">${w}</span>`).join(' ')
}
function revealWords(card, at, opts = {}) {
  const { step = 0.085, y = 34, blur = 12, dur = 0.55 } = opts
  tl.set(card, { opacity: 1, y: 0, filter: 'blur(0px)' }, at)
  const words = card.querySelectorAll('.t-head .w, .t-big .w')
  tl.fromTo(words, { opacity: 0, y, filter: `blur(${blur}px)` },
    { opacity: 1, y: 0, filter: 'blur(0px)', duration: dur, stagger: step, ease: 'power3.out', immediateRender: true }, at)
  return at + step * (words.length - 1) + dur
}

// ---------- camera rig ----------
// Moves the product layer (windows, CoreBox, scene objects); headlines stay in screen space.
const camState = { x: 0, y: 0, s: 1, rx: 0, ry: 0, ox: 960, oy: 540, bx: 0, by: 0 }
frameFns.push(() => {
  const c = camState
  rig.style.transformOrigin = `${c.ox.toFixed(1)}px ${c.oy.toFixed(1)}px`
  rig.style.transform = `translate3d(${c.x.toFixed(2)}px, ${c.y.toFixed(2)}px, 0) rotateX(${c.rx.toFixed(3)}deg) rotateY(${c.ry.toFixed(3)}deg) scale(${c.s.toFixed(4)})`
  if (c.bx > 0.1 || c.by > 0.1) {
    blurNode.setAttribute('stdDeviation', `${c.bx.toFixed(2)} ${c.by.toFixed(2)}`)
    rig.style.filter = 'url(#mblur)'
  } else {
    rig.style.filter = 'none'
  }
  glowLayer.style.transform = `translate3d(${(c.x * 0.16).toFixed(2)}px, ${(c.y * 0.16).toFixed(2)}px, 0)`
})
function camTo(at, props, dur, ease = 'power3.inOut') {
  tl.to(camState, { ...props, duration: dur, ease, immediateRender: false }, at)
}
function camSet(at, props) { tl.set(camState, props, at) }

// ---------- glow (procedural drift) ----------
const blobs = [...document.querySelectorAll('.blob')]
const glowState = { cx: 960, cy: 640, spread: 1 }
frameFns.push((t) => {
  const { cx, cy, spread } = glowState
  const P = [
    [-260, -40, 0.11, 0.0], [230, 10, 0.09, 1.7], [60, 150, 0.13, 3.1], [-60, -170, 0.07, 4.4]
  ]
  blobs.forEach((b, i) => {
    const [dx, dy, f, ph] = P[i]
    const x = cx + dx * spread + Math.sin(t * f * 6.283 + ph) * 70 - b.offsetWidth / 2
    const y = cy + dy * spread + Math.cos(t * f * 5.1 + ph) * 46 - b.offsetHeight / 2
    b.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`
  })
})

// ---------- CoreBox ----------
const cbWrap = h('div'); cbWrap.id = 'cbWrap'
const cb = h('div', 'cb')
cbWrap.appendChild(cb)
cam.appendChild(cbWrap)

const header = h('div', 'cb-header')
header.innerHTML = `
  <img class="cb-logo" src="logo.svg">
  <div class="cb-input"><span class="cb-ph">Everything in tuff.</span><span class="cb-typed"><span class="cb-text"></span><span class="cb-caret"></span></span></div>
  <div class="cb-tagslot"></div>
  <span class="cb-pin">${svg('ri:pushpin-line')}</span>`
cb.appendChild(header)
const body = h('div', 'cb-body')
cb.appendChild(body)
const footer = h('div', 'cb-footer')
footer.innerHTML = `<div class="fl"></div><div class="fh"></div>`
cb.appendChild(footer)
const fl = footer.querySelector('.fl')
const fh = footer.querySelector('.fh')
const typedNode = header.querySelector('.cb-text')
const inputNode = header.querySelector('.cb-input')
const caret = header.querySelector('.cb-caret')
const ph = header.querySelector('.cb-ph')
const tagSlot = header.querySelector('.cb-tagslot')

// Input: entries of [time, text]. The placeholder blurs away while there is text.
const inputEntries = [[0, '']]
const keyTimes = []
const phState = { k: 1 } // placeholder visibility multiplier, tweened on the timeline
function typeInto(t0, chunks, opts = {}) {
  // chunks: [[dt, text]] — dt relative to t0; text is appended, null clears the field
  let acc = current(inputEntries, t0).cur?.[1] ?? ''
  for (const [dt, txt] of chunks) {
    acc = txt === null ? '' : acc + txt
    inputEntries.push([t0 + dt, acc])
    keyTimes.push(t0 + dt)
    if (txt && opts.sound !== false) sfx(t0 + dt, 'type')
  }
  inputEntries.sort((a, b) => a[0] - b[0])
}
function typeChars(t0, text, cps = 12) {
  typeInto(t0, [...text].map((c, i) => [i / cps, c]))
  return t0 + (text.length - 1) / cps
}
function clearInput(t0) { typeInto(t0, [[0, null]]) }
frameFns.push((t) => {
  const { cur } = current(inputEntries, t)
  const text = cur ? cur[1] : ''
  if (typedNode.__v !== text) { typedNode.textContent = text; typedNode.__v = text }
  const empty = text === ''
  ph.style.opacity = empty ? 0.75 * phState.k : 0
  ph.style.filter = empty ? `blur(${((1 - phState.k) * 5).toFixed(2)}px)` : 'blur(5px)'
  // caret: solid right after a key, blinking when idle
  let lastKey = -10
  for (const k of keyTimes) if (k <= t) lastKey = Math.max(lastKey, k)
  const idle = t - lastKey
  caret.style.opacity = idle < 0.5 || (idle % 1.06) < 0.53 ? 1 : 0
})

// Views inside the body
const views = {}
function addView(name, node) { node.classList.add('view'); body.appendChild(node); views[name] = node; return node }

// Recommendation badges — variant, icon and text follow recommendation-presentation.ts.
const BADGE = {
  frequent: ['b-frequent', 'ri:fire-line'],
  timeBased: ['b-intelligent', 'ri:time-line'],
  yesterday: ['b-intelligent', 'ri:history-line'],
  appContext: ['b-intelligent', 'ri:apps-2-line'],
  recent: ['b-recent', 'ri:history-line'],
  newFile: ['b-newfile', 'ri:file-add-line']
}
function badge(kind, text, count) {
  const [cls, icon] = BADGE[kind]
  return `<span class="badge ${cls}">${svg(icon)}<span class="bt">${text}</span>${count ? `<span class="bc">· ${count}</span>` : ''}</span>`
}
function tile({ icon, title, badge: b, qk, active }) {
  const d = h('div', 'tile' + (active ? ' active' : ''))
  d.innerHTML = `<img src="${icon}"><span class="tt">${title}</span>${b ?? ''}${qk ? `<span class="qk">${qk}</span>` : ''}`
  return d
}
function row({ icon, iconHtml, title, sub, src, srcIcon, qk, active, evi }) {
  const d = h('div', 'row' + (active ? ' active' : ''))
  d.innerHTML = `<div class="accent"></div><div class="ic">${iconHtml ?? `<img src="${icon}">`}</div>
    <div class="ct"><div class="ti">${title}</div>${sub ? `<div class="st">${sub}</div>` : ''}</div>
    <div class="sig">${evi ? `<span class="evi">${evi}</span>` : ''}${src ? `<span class="src">${svg(srcIcon || 'ri:apps-line')}${src}</span>` : ''}${qk ? `<span class="qkp">${qk}</span>` : ''}</div>`
  return d
}
function footerItem({ icon, iconHtml, title, sub, subIcon }) {
  return `<div>${iconHtml ?? `<img src="${icon}">`}<div class="ft"><b>${title}</b><span>${subIcon ? svg(subIcon) : ''}${sub}</span></div></div>`
}
function hints(list) {
  return `<div class="fhv">${list.map(([k, l]) => `<div><span class="hk">${k}</span><span class="hl">${l}</span></div>`).join('')}</div>`
}

// ---------- hook ----------
const hook = h('div', 'card center')
hook.innerHTML = `<div class="t-big" id="hookText">One shortcut.</div>
  <div class="keys" style="margin-top:64px"><div class="key" id="kOpt"><span class="glyph">⌥</span><small>option</small><div class="ring"></div></div><span class="plus">+</span><div class="key wide" id="kSpace">space<div class="ring"></div></div></div>`
topLayer.appendChild(hook)

// ---------- copy ----------
function headline(main, subs = [], opts = {}) {
  const d = h('div', 'card headline')
  const list = Array.isArray(subs) ? subs : [subs]
  d.innerHTML = `<div class="${opts.big ? 't-big' : 't-head'}">${opts.raw ? main : splitWords(main)}</div>` +
    (list.length ? `<div class="subs">${list.map((s, i) => `<div class="t-sub${i ? ' alt' : ''}">${s}</div>`).join('')}</div>` : '')
  if (opts.top) d.style.top = opts.top + 'px'
  topLayer.appendChild(d)
  return d
}
function centerCard(html, cls = 'card center') {
  const d = h('div', cls, html)
  topLayer.appendChild(d)
  return d
}
function footnote(text) {
  const d = h('div', 'foot', text)
  topLayer.appendChild(d)
  return d
}

// HUD (mini keys)
const hud = h('div'); hud.id = 'hud'
topLayer.appendChild(hud)
function hudKeys(at, keys, dur = 0.9, sound = 'key') {
  const grp = h('div', 'hudg')
  grp.innerHTML = keys.map((k) => `<div class="mkey">${k}</div>`).join('')
  hud.appendChild(grp)
  tl.fromTo(grp, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.16, ease: 'power2.out' }, at - 0.14)
  tl.to(grp.children, { y: 5, duration: 0.06, ease: 'power1.in', immediateRender: false }, at)
  tl.to(grp.children, { y: 0, duration: 0.12, ease: 'power2.out', immediateRender: false }, at + 0.1)
  tl.to(grp, { opacity: 0, duration: 0.22, ease: 'power2.in', immediateRender: false }, at + dur)
  if (sound) sfx(at, sound, { n: keys.length })
}

window.__runTracks = runTracks
window.__cues = cues
window.__scene = { views, tl, h, svg, app, ft, stage, rig, cam, cbWrap, cb, body, footer, fl, fh, tagSlot, header, typedNode, inputNode,
  winLayer, fxBack, fxFront, topLayer, typeInto, typeChars, clearInput, addView, badge, tile, row, footerItem, hints, headline,
  centerCard, footnote, reveal, conceal, revealWords, textTrack, classTrack, switchTrack, hudKeys, glowState, frameFns, hook,
  phState, camState, camTo, camSet, sfx, clamp, current }
