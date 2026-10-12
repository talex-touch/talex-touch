/* Storyboard v2 — Tuff v2.4.14 launch film, English cut. 120 BPM grid: beat 0.5 s, bar 2 s. */
const S = window.__scene
const B = S.badge
const T = {}
const DOT = '<span class="dot">•</span>'
const FILE = { src: 'File', srcIcon: 'ri:file-3-line' }
const APP = { src: 'Application', srcIcon: 'ri:apps-line' }
const CB_TOP = 250 / 1.6 // #cbWrap is zoomed 1.6×, so its `top` is too: this puts the panel edge at y=250
const CB_TOP_CTX = 214 // floating over an app window
function fileSub(type, size, date, folder) {
  return `<span>${S.svg('ri:file-3-line')} ${type}</span>${DOT}<span>${size}</span>${DOT}<span>${date}</span>${DOT}<span>${S.svg('carbon:folder')} ${folder}</span>`
}

// ---------------- views ----------------
function gridView(name, tiles, rows) {
  const v = S.h('div')
  v.innerHTML = `<div class="sec">Right now</div>`
  const grid = S.h('div', 'grid')
  const tileEls = tiles.map(S.tile)
  tileEls.forEach((t) => grid.appendChild(t))
  v.appendChild(grid)
  let rowEls = []
  if (rows) {
    v.appendChild(S.h('div', 'sec', 'Recent picks'))
    const list = S.h('div', 'rows')
    rowEls = rows.map(S.row)
    rowEls.forEach((r) => list.appendChild(r))
    v.appendChild(list)
  }
  S.addView(name, v)
  return { v, tileEls, rowEls }
}
function listView(name, rows) {
  const v = S.h('div', 'rows')
  v.style.paddingTop = '4px'
  const rowEls = rows.map(S.row)
  rowEls.forEach((r) => v.appendChild(r))
  S.addView(name, v)
  return { v, rowEls }
}

const rec = gridView('rec', [
  { icon: S.app('mail'), title: 'Mail', badge: B('frequent', 'Frequent', 128), qk: '⌘1', active: true },
  { icon: S.app('vscode'), title: 'Visual Studio Code', badge: B('yesterday', 'Yesterday 09:58'), qk: '⌘2' },
  { icon: S.app('chatgpt'), title: 'ChatGPT', badge: B('frequent', 'Frequent', 96), qk: '⌘3' },
  { icon: S.app('chrome'), title: 'Google Chrome', badge: B('timeBased', 'Suggested', 41), qk: '⌘4' },
  { icon: S.app('telegram'), title: 'Telegram', badge: B('recent', 'Recent', 12), qk: '⌘5' }
], [
  { icon: S.ft('type-key'), title: 'Q4 Launch.key', sub: B('newFile', 'New file') + `<span>Presentation</span>${DOT}<span>2026/10/10 21:40</span>`, ...FILE, qk: '⌘6' },
  { icon: S.app('obsidian'), title: 'Obsidian', sub: B('frequent', 'Frequent') + '<span>/Applications/Obsidian.app</span>', evi: 'Used 23× in total', ...APP, qk: '⌘7' }
])
const ctxKey = gridView('ctxKey', [
  { icon: S.app('preview'), title: 'Preview', badge: B('appContext', 'Often from Keynote'), qk: '⌘1', active: true },
  { icon: S.app('pixelmator'), title: 'Pixelmator Pro', badge: B('appContext', 'Often from Keynote'), qk: '⌘2' },
  { icon: S.app('photos'), title: 'Photos', badge: B('appContext', 'Used from Keynote'), qk: '⌘3' },
  { icon: S.app('finder'), title: 'Finder', badge: B('frequent', 'Frequent', 52), qk: '⌘4' },
  { icon: S.app('mail'), title: 'Mail', badge: B('frequent', 'Frequent', 128), qk: '⌘5' }
])
const ctxCode = gridView('ctxCode', [
  { icon: S.app('ghostty'), title: 'Ghostty', badge: B('appContext', 'Often from Code'), qk: '⌘1', active: true },
  { icon: S.app('fork'), title: 'Fork', badge: B('appContext', 'Often from Code'), qk: '⌘2' },
  { icon: S.app('chrome'), title: 'Google Chrome', badge: B('appContext', 'Used from Code'), qk: '⌘3' },
  { icon: S.app('chatgpt'), title: 'ChatGPT', badge: B('frequent', 'Frequent', 96), qk: '⌘4' },
  { icon: S.app('mail'), title: 'Mail', badge: B('frequent', 'Frequent', 128), qk: '⌘5' }
])
// Same app, next morning: the plugin feature used yesterday at 9:41 is back with its own reason.
const ydCode = gridView('ydCode', [
  { icon: S.app('ghostty'), title: 'Ghostty', badge: B('appContext', 'Often from Code'), qk: '⌘1', active: true },
  { icon: 'vscp.svg', title: 'VS Code Projects', badge: B('yesterday', 'Yesterday 09:41'), qk: '⌘2' },
  { icon: S.app('fork'), title: 'Fork', badge: B('appContext', 'Often from Code'), qk: '⌘3' },
  { icon: S.app('chrome'), title: 'Google Chrome', badge: B('appContext', 'Used from Code'), qk: '⌘4' },
  { icon: S.app('chatgpt'), title: 'ChatGPT', badge: B('frequent', 'Frequent', 96), qk: '⌘5' }
])
const fileQ4 = listView('fileQ4', [
  { icon: S.ft('type-xlsx'), title: 'Q4 Budget.xlsx', sub: fileSub('Spreadsheet', '86 KB', '2026/10/9 18:20', 'Finance'), ...FILE, qk: '⌘1', active: true },
  { icon: S.ft('type-key'), title: 'Q4 Launch.key', sub: fileSub('Presentation', '18.6 MB', '2026/10/10 21:40', 'Launch'), ...FILE, qk: '⌘2' },
  { icon: S.ft('type-pdf'), title: 'Q4 Roadmap.pdf', sub: fileSub('Document', '2.4 MB', '2026/10/2 09:41', 'Product'), ...FILE, qk: '⌘3' },
  { icon: S.ft('type-docx'), title: 'Q4 OKRs.docx', sub: fileSub('Document', '48 KB', '2026/9/28 16:55', 'Team'), ...FILE, qk: '⌘4' }
])
// Typo recall that v2.4.14 really has: the in-memory app catalog (app-search-catalog-service.ts).
const appTypo = listView('appTypo', [
  { icon: S.app('chrome'), title: 'Google Chrome', sub: '<span>/Applications/Google Chrome.app</span>', ...APP, qk: '⌘1', active: true }
])
const content = listView('content', [
  { icon: S.ft('type-md'), title: 'payment-notes.md', sub: fileSub('Text', '6 KB', '2026/10/9 21:14', 'Notes'), ...FILE, qk: '⌘1', active: true },
  { icon: S.ft('generic-doc'), title: 'gateway.ts', sub: fileSub('Code', '12 KB', '2026/10/8 17:30', 'server'), ...FILE, qk: '⌘2' },
  { icon: S.ft('type-txt'), title: 'launch-checklist.txt', sub: fileSub('Text', '3 KB', '2026/10/7 11:05', 'Launch'), ...FILE, qk: '⌘3' }
])
// v2.4.14 hardcodes the card's subtitle, primary label and detail rows in Chinese, so none are drawn here.
// `1280 * 0.85` (ASCII *) is taken by the basic expression ability (priority 10 runs before advanced's 15),
// whose card carries no badges.
const calc = S.h('div')
calc.innerHTML = `<div class="pcard">
  <div class="phd"><span class="pid">preview.expression.basic</span>
    <div class="pa"><span class="copy"><span class="flash"></span><span class="hk">↵</span>Copy result</span><span><span class="hk">⌘←</span>Recent</span></div></div>
  <div class="pv" style="margin-top:14px">1088</div>
  <div class="ptt">1280 * 0.85</div>
  <div class="pw">Powered by TuffIntelligence</div>
</div>`
S.addView('calc', calc)

// footer variants
const FL = { mail: 0, preview: 1, ghostty: 2, budget: 3, notes: 4, calc: 5, chrome: 6 }
S.fl.innerHTML = [
  S.footerItem({ icon: S.app('mail'), title: 'Mail', sub: 'Application', subIcon: 'ri:apps-line' }),
  S.footerItem({ icon: S.app('preview'), title: 'Preview', sub: 'Application', subIcon: 'ri:apps-line' }),
  S.footerItem({ icon: S.app('ghostty'), title: 'Ghostty', sub: 'Application', subIcon: 'ri:apps-line' }),
  S.footerItem({ icon: S.ft('type-xlsx'), title: 'Q4 Budget.xlsx', sub: 'File', subIcon: 'ri:file-3-line' }),
  S.footerItem({ icon: S.ft('type-md'), title: 'payment-notes.md', sub: 'File', subIcon: 'ri:file-3-line' }),
  `<div>${S.svg('ri:calculator-line')}<div class="ft"><b>1280 * 0.85</b></div></div>`,
  S.footerItem({ icon: S.app('chrome'), title: 'Google Chrome', sub: 'Application', subIcon: 'ri:apps-line' })
].join('')
S.fh.innerHTML = S.hints([['↵', 'Open'], ['⌘K', 'Actions'], ['⌘1-0', 'Quick Select']]) + S.hints([['↵', 'Execute'], ['⌘K', 'Actions']])

// ---------------- desktop windows (illustrations) ----------------
function win(cls, title, icon, bodyHtml, box) {
  const w = S.h('div', `win ${cls}`)
  w.innerHTML = `<div class="bar"><div class="lights"><i></i><i></i><i></i></div><div class="tt"><img src="${icon}">${title}</div></div><div class="wb">${bodyHtml}</div>`
  Object.assign(w.style, { left: box[0] + 'px', top: box[1] + 'px', width: box[2] + 'px', height: box[3] + 'px' })
  S.winLayer.appendChild(w)
  return w
}
const BIG = [240, 272, 1440, 660]
const MID = [420, 300, 1080, 560]
const kn = win('light kn', 'Q4 Launch.key', S.app('keynote'), `
  <div class="kn-nav"><div class="kn-th g on"><b></b><i></i></div><div class="kn-th"><b></b><i></i></div><div class="kn-th"><b></b><i></i></div><div class="kn-th g"><b></b><i></i></div><div class="kn-th"><b></b><i></i></div></div>
  <div class="kn-stage"><div class="kn-slide"><div class="s1">Q4 Launch</div><div class="s2">October 2026</div></div></div>`, BIG)
const code = [
  `<span class="tk-k">import</span> { <span class="tk-v">verifySignature</span> } <span class="tk-k">from</span> <span class="tk-s">'./crypto'</span>`,
  `<span class="tk-k">import</span> { <span class="tk-v">queue</span> } <span class="tk-k">from</span> <span class="tk-s">'./queue'</span>`,
  '',
  `<span class="tk-k">export async function</span> <span class="tk-f">handleWebhook</span>(<span class="tk-v">req</span>: <span class="tk-t">Request</span>, <span class="tk-v">res</span>: <span class="tk-t">Response</span>) {`,
  `  <span class="tk-k">const</span> <span class="tk-v">signature</span> = <span class="tk-v">req</span>.<span class="tk-v">headers</span>[<span class="tk-s">'x-signature'</span>]`,
  `  <span class="tk-k">if</span> (!<span class="tk-f">verifySignature</span>(<span class="tk-v">req</span>.<span class="tk-v">body</span>, <span class="tk-v">signature</span>)) {`,
  `    <span class="tk-k">return</span> <span class="tk-v">res</span>.<span class="tk-f">status</span>(<span class="tk-n">401</span>).<span class="tk-f">send</span>(<span class="tk-s">'invalid signature'</span>)`,
  '  }',
  `  <span class="tk-c">// Retry failed events up to 3 times</span>`,
  `  <span class="tk-k">await</span> <span class="tk-v">queue</span>.<span class="tk-f">push</span>(<span class="tk-v">req</span>.<span class="tk-v">body</span>, { <span class="tk-v">retries</span>: <span class="tk-n">3</span> })`,
  `  <span class="tk-v">res</span>.<span class="tk-f">status</span>(<span class="tk-n">200</span>).<span class="tk-f">end</span>()`,
  '}',
  '',
  `<span class="tk-k">export function</span> <span class="tk-f">health</span>(<span class="tk-v">_req</span>: <span class="tk-t">Request</span>, <span class="tk-v">res</span>: <span class="tk-t">Response</span>) {`,
  `  <span class="tk-v">res</span>.<span class="tk-f">json</span>({ <span class="tk-v">ok</span>: <span class="tk-k">true</span> })`,
  '}'
].map((l, i) => `<span class="ln">${i + 1}</span>${l}`).join('\n')
const vs = win('dark vs', 'gateway.ts — tuff', S.app('vscode'), `
  <div class="vs-act"></div>
  <div class="vs-side"><div class="hd">EXPLORER</div><div class="fi dir">⌄ server</div><div class="fi on">gateway.ts</div><div class="fi">crypto.ts</div><div class="fi">queue.ts</div><div class="fi dir">⌄ docs</div><div class="fi">payment-notes.md</div><div class="fi">README.md</div></div>
  <div class="vs-ed"><div class="vs-tabs"><span class="on">gateway.ts</span><span>queue.ts</span></div><div class="vs-code">${code}</div></div>`, BIG)
const notes = win('light notes', 'Notes', S.app('notes'), `
  <div class="h1">Q4 gear budget</div>
  <div class="ln2"><span class="lb">Monitor</span><span><span class="sel"><span class="selb"></span>1280 * 0.85</span>  (15% off)</span></div>
  <div class="ln2"><span class="lb">Keyboard</span><span>189</span></div>
  <div class="ln2"><span class="lb">Desk lamp</span><span>59</span></div>`, MID)
const sel = notes.querySelector('.sel')
const fly = S.h('div', 'fly', '1280 * 0.85')
S.topLayer.appendChild(fly)

// ---------------- content X-ray: five plain-text files, three mention "webhook" ----------------
const HL = '<span class="xm"><i></i>webhook</span>'
const CARD_Y = 700
const XC = [
  { name: 'payment-notes.md', icon: S.ft('type-md'), cx: 235, ry: 16, z: -60, match: true,
    lines: ['<div class="t1">Payments</div>', `Verify each ${HL}.`, 'Retry failed events.', 'Log every refund.'] },
  { name: 'travel-plan.md', icon: S.ft('type-md'), cx: 597, ry: 8, z: -20,
    lines: ['<div class="t1">Tokyo trip</div>', 'Flight lands at 9:40.', 'Hotel near Shibuya.', 'Buy a Suica card.'] },
  { name: 'gateway.ts', icon: S.ft('generic-doc'), cx: 960, ry: 0, z: 0, match: true, code: true,
    lines: [`<span class="tk-c">// Check every ${HL}</span>`, '<span class="tk-k">function</span> <span class="tk-f">handle</span>(req) {',
      '  <span class="tk-f">verify</span>(req)', '  queue.<span class="tk-f">push</span>(req)', '}'] },
  { name: 'launch-checklist.txt', icon: S.ft('type-txt'), cx: 1323, ry: -8, z: -20, match: true,
    lines: ['<div class="t1">Launch checklist</div>', 'Fix the pricing page.', `Test the ${HL}.`, 'Email the press.'] },
  { name: 'recipes.txt', icon: S.ft('type-txt'), cx: 1685, ry: -16, z: -60,
    lines: ['<div class="t1">Pancakes</div>', '2 eggs, 1 cup of milk.', '1 cup of flour.', '2 minutes per side.'] }
]
// Colour-first, same shape at both ends, so GSAP interpolates every number.
const SHADOW_BASE = 'rgba(0, 0, 0, 0.55) 0px 30px 70px 0px, rgba(255, 255, 255, 0.1) 0px 0px 0px 1px, rgba(59, 155, 255, 0) 0px 0px 0px 0px'
const SHADOW_HIT = 'rgba(0, 0, 0, 0.55) 0px 30px 70px 0px, rgba(59, 155, 255, 1) 0px 0px 0px 3px, rgba(59, 155, 255, 0.55) 0px 0px 70px 16px'
const xcards = XC.map((c) => {
  const d = S.h('div', 'xcard' + (c.code ? ' code' : ''))
  d.innerHTML = `<div class="xh"><img src="${c.icon}">${c.name}</div><div class="xb">${c.lines.map((l) => (l.startsWith('<div') ? l : `<div>${l}</div>`)).join('')}</div>`
  Object.assign(d.style, { left: c.cx + 'px', top: CARD_Y + 'px', boxShadow: SHADOW_BASE })
  S.fxFront.appendChild(d) // in front of the CoreBox: they land on the result rows
  return d
})
const beam = S.h('div', 'xbeam')
S.fxFront.appendChild(beam)

// ---------------- yesterday: what happened at 9:40 / 9:41 ----------------
const steps = S.h('div', 'steps')
steps.innerHTML = `<div class="step"><img src="${S.app('vscode')}"><div><div class="tm">9:40</div><div class="lb">Opened VS Code</div></div></div>
  <svg class="arrow" viewBox="0 0 96 40"><path d="M6 20 H86 M70 7 L88 20 L70 33"/></svg>
  <div class="step"><img src="vscp.svg"><div><div class="tm">9:41</div><div class="lb">Used VS Code Projects</div></div></div>`
S.topLayer.appendChild(steps)

// ---------------- timeline ----------------
function build() {
  const { tl } = S
  const viewNames = Object.keys(S.views)
  const viewEntries = []
  const flEntries = []
  const fhEntries = [[0, 0]]
  const height = (name) => S.views[name].offsetHeight
  function view(name, at, dur = 0.3) {
    viewEntries.push([at, viewNames.indexOf(name)])
    tl.to(S.body, { height: height(name), duration: dur, ease: 'power3.out', immediateRender: false }, at)
  }
  function noView(at) {
    viewEntries.push([at, -1])
    flEntries.push([at, -1])
    tl.set(S.body, { height: 0 }, at)
  }
  const footerAt = (at, idx) => flEntries.push([at, idx])
  function cbShow(at, mode = 'pop') {
    if (mode === 'tilt') {
      tl.fromTo(S.cbWrap, { y: 80, rotationX: 24, scale: 0.9, transformPerspective: 1600 },
        { y: 0, rotationX: 0, scale: 1, duration: 1.0, ease: 'expo.out', immediateRender: false }, at)
      tl.fromTo(S.cb, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'power2.out', immediateRender: false }, at)
      S.sfx(at, 'open')
    } else {
      tl.fromTo(S.cbWrap, { y: 14, rotationX: 0, scale: 0.965, transformPerspective: 1600 },
        { y: 0, scale: 1, duration: 0.32, ease: 'power3.out', immediateRender: false }, at)
      tl.fromTo(S.cb, { opacity: 0 }, { opacity: 1, duration: 0.18, ease: 'power2.out', immediateRender: false }, at)
    }
  }
  function cbHide(at, dur = 0.22) {
    tl.to(S.cb, { opacity: 0, duration: dur, ease: 'power2.in', immediateRender: false }, at)
    tl.to(S.cbWrap, { scale: 0.97, duration: dur, ease: 'power2.in', immediateRender: false }, at)
  }
  // Every list is staggered in exactly once, so the hidden start state can be applied up front:
  // otherwise items sit fully visible between their view appearing and their own entrance.
  const stagger = (els, at, step = 0.04, y = 10) =>
    tl.fromTo(els, { opacity: 0, y }, { opacity: 1, y: 0, duration: 0.3, stagger: step, ease: 'power2.out', immediateRender: true }, at)
  const footIn = (f, at) => tl.fromTo(f, { opacity: 0 }, { opacity: 1, duration: 0.5, ease: 'power2.out' }, at)
  const footOut = (f, at) => tl.to(f, { opacity: 0, duration: 0.35, ease: 'power2.in', immediateRender: false }, at)
  const show = (el, at) => tl.set(el, { opacity: 1 }, at)
  const hide = (el, at) => tl.set(el, { opacity: 0 }, at)
  const subIn = (el, at) => tl.fromTo(el, { opacity: 0, y: 14, filter: 'blur(8px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.5, ease: 'power3.out' }, at)

  tl.set(S.cb, { opacity: 0 }, 0)
  tl.set(S.body, { height: 0 }, 0)
  tl.set(S.cbWrap, { top: CB_TOP }, 0)

  // S0 — hook: readable from the very first frame
  const keyEls = [document.getElementById('kOpt'), S.hook.querySelector('.plus'), document.getElementById('kSpace')]
  tl.set(S.hook, { opacity: 1, filter: 'blur(0px)' }, 0)
  tl.fromTo(S.hook, { scale: 1.05 }, { scale: 1, duration: 1.5, ease: 'power2.out' }, 0)
  const hookFoot = S.footnote('Alt + Space on Windows and Linux')
  footIn(hookFoot, 0.25)
  T.press = 1.5
  tl.to([keyEls[0], keyEls[2]], { y: 9, duration: 0.07, ease: 'power1.in', immediateRender: false }, T.press)
  tl.to([keyEls[0], keyEls[2]], { y: 0, duration: 0.2, ease: 'power2.out', immediateRender: false }, T.press + 0.14)
  tl.fromTo(S.hook.querySelectorAll('.ring'), { opacity: 0, scale: 1, borderColor: 'rgba(120,170,255,0.95)' },
    { opacity: 1, scale: 1.18, duration: 0.45, ease: 'power2.out', immediateRender: false }, T.press + 0.02)
  tl.to(S.hook.querySelectorAll('.ring'), { opacity: 0, duration: 0.25, immediateRender: false }, T.press + 0.25)
  tl.to(S.hook, { opacity: 0, scale: 0.94, filter: 'blur(14px)', duration: 0.38, ease: 'power2.in', immediateRender: false }, T.press + 0.12)
  footOut(hookFoot, T.press + 0.12)
  S.sfx(T.press, 'key', { n: 2, big: true })

  // S1 — recommendations
  T.cbIn = 2.0
  tl.fromTo('#glow', { opacity: 0 }, { opacity: 0.9, duration: 1.3, ease: 'power2.out' }, 1.7)
  cbShow(T.cbIn, 'tilt')
  view('rec', T.cbIn + 0.05, 0.6)
  footerAt(T.cbIn, FL.mail)
  stagger(rec.tileEls, T.cbIn + 0.2, 0.05)
  stagger(rec.rowEls, T.cbIn + 0.45, 0.05)
  const recHead = S.headline('It knows what you need.', 'Before you type a single letter.')
  S.revealWords(recHead, T.cbIn + 0.1)
  subIn(recHead.querySelector('.t-sub'), T.cbIn + 0.55)
  T.recZoom = 3.85
  S.conceal(recHead, T.recZoom - 0.05)
  T.recOut = 5.55

  // S2 — app context
  T.ctx = 6.0
  hide(S.cb, T.ctx - 0.08)
  tl.set(S.cbWrap, { top: CB_TOP_CTX }, T.ctx - 0.08)
  const ctxHead = S.headline('Different app. Different picks.', 'Suggestions follow the app you’re in.')
  S.revealWords(ctxHead, T.ctx + 0.05)
  subIn(ctxHead.querySelector('.t-sub'), T.ctx + 0.45)
  const ctxFoot = S.footnote('App context is available on macOS.')
  footIn(ctxFoot, T.ctx + 0.3)
  show(kn, T.ctx - 0.05)
  S.hudKeys(T.ctx + 0.45, ['⌥', 'space'])
  cbShow(T.ctx + 0.5)
  view('ctxKey', T.ctx + 0.5, 0.01)
  footerAt(T.ctx + 0.5, FL.preview)
  stagger(ctxKey.tileEls, T.ctx + 0.56, 0.05)
  T.swap = 8.05
  hide(kn, T.swap)
  hide(S.cb, T.swap)
  show(vs, T.swap)
  S.hudKeys(T.swap + 0.45, ['⌥', 'space'])
  cbShow(T.swap + 0.5)
  view('ctxCode', T.swap + 0.5, 0.01)
  footerAt(T.swap + 0.5, FL.ghostty)
  stagger(ctxCode.tileEls, T.swap + 0.56, 0.05)
  T.ctxOut = 9.75
  S.conceal(ctxHead, T.ctxOut)
  cbHide(T.ctxOut + 0.05)

  // S3 — yesterday: 9:40 opened VS Code, 9:41 used VS Code Projects → today at 9:41 it is waiting
  T.yd = 10.0
  T.flip = 12.0
  S.sfx(T.yd - 0.05, 'rewind')
  const MEM = 'grayscale(1) sepia(0.3) brightness(0.5) contrast(0.92)'
  const NOW = 'grayscale(0) sepia(0) brightness(1) contrast(1)'
  tl.fromTo(vs, { filter: NOW }, { filter: MEM, duration: 0.45, ease: 'power2.out', immediateRender: false }, T.yd)
  const ydHead = S.headline(`<span class="flipline"><span class="clockico">${S.svg('ri:time-line')}</span><span class="fw"><span class="yday">Yesterday,</span><span class="today">Today,</span></span><span class="fsp"></span>9:41</span>`,
    ['It remembers what you used yesterday.'], { raw: true })
  const fw = ydHead.querySelector('.fw')
  const [yda, ydb] = fw.children
  const wa = yda.offsetWidth
  const wb = ydb.offsetWidth
  fw.style.width = wa + 'px'
  S.reveal(ydHead, T.yd + 0.05, { y: 20, blur: 12, dur: 0.6 })
  subIn(ydHead.querySelector('.t-sub'), T.flip + 0.3)
  const [st1, arrow, st2] = steps.children
  const popIn = (el, at) => tl.fromTo(el, { opacity: 0, y: 24, scale: 0.92, filter: 'blur(8px)' },
    { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)', duration: 0.5, ease: 'back.out(1.6)' }, at)
  popIn(st1, T.yd + 0.45)
  S.sfx(T.yd + 0.45, 'pop')
  const path = arrow.querySelector('path')
  const plen = path.getTotalLength()
  path.style.strokeDasharray = `${plen}`
  tl.set(arrow, { opacity: 0, filter: 'blur(0px)' }, 0)
  tl.set(arrow, { opacity: 0.9 }, T.yd + 0.8)
  tl.fromTo(path, { strokeDashoffset: plen }, { strokeDashoffset: 0, duration: 0.32, ease: 'power2.inOut', immediateRender: false }, T.yd + 0.8)
  popIn(st2, T.yd + 1.05)
  S.sfx(T.yd + 1.05, 'pop')
  tl.to([st1, arrow, st2], { opacity: 0, y: -16, filter: 'blur(8px)', duration: 0.3, stagger: 0.04, ease: 'power2.in', immediateRender: false }, T.yd + 1.72)
  tl.to(fw, { width: wb, duration: 0.32, ease: 'power2.inOut', immediateRender: false }, T.flip)
  tl.to(yda, { rotationX: 90, opacity: 0, duration: 0.16, ease: 'power2.in', immediateRender: false }, T.flip)
  tl.fromTo(ydb, { rotationX: -90, opacity: 0 }, { rotationX: 0, opacity: 1, duration: 0.24, ease: 'power2.out', immediateRender: false }, T.flip + 0.14)
  S.sfx(T.flip, 'flip')
  tl.to(vs, { filter: NOW, duration: 0.4, ease: 'power2.out', immediateRender: false }, T.flip)
  S.hudKeys(T.flip + 0.55, ['⌥', 'space'])
  cbShow(T.flip + 0.6)
  view('ydCode', T.flip + 0.6, 0.01)
  footerAt(T.flip + 0.6, FL.ghostty)
  stagger(ydCode.tileEls, T.flip + 0.66, 0.05)
  T.ydZoom = 13.35
  const ring = S.h('div', 'ring2')
  ydCode.tileEls[1].appendChild(ring)
  tl.fromTo(ring, { opacity: 0 }, { opacity: 1, duration: 0.35, ease: 'power2.out', immediateRender: false }, T.ydZoom + 0.4)
  S.sfx(T.ydZoom + 0.4, 'sparkle')
  T.ydOut = 14.5
  S.conceal(ydHead, T.ydOut)
  footOut(ctxFoot, T.ydZoom - 0.1) // keeps clear of the close-up

  // S4 — find: fast results, and typo-tolerant app search
  T.find = 15.0
  hide(vs, T.find - 0.04)
  hide(S.cb, T.find - 0.04)
  tl.set(S.cbWrap, { top: CB_TOP }, T.find - 0.04)
  const findHead = S.headline('Find anything. Fast.', ['Results appear as you type.', 'Even if you mistype an app.'])
  S.revealWords(findHead, T.find + 0.05)
  const [fsA, fsB] = findHead.querySelectorAll('.t-sub')
  subIn(fsA, T.find + 0.4)
  cbShow(T.find, 'tilt')
  view('rec', T.find, 0.01)
  footerAt(T.find, FL.mail)
  T.q4 = 15.45
  const q4End = S.typeChars(T.q4, 'q4', 16)
  view('fileQ4', q4End + 0.15)
  footerAt(q4End + 0.15, FL.budget)
  stagger(fileQ4.rowEls, q4End + 0.15, 0.03, 8)
  S.sfx(q4End + 0.15, 'pop')
  T.typo = 16.9
  tl.to(fsA, { opacity: 0, y: -8, filter: 'blur(6px)', duration: 0.28, ease: 'power2.in', immediateRender: false }, T.typo - 0.08)
  tl.fromTo(fsB, { opacity: 0, y: 10, filter: 'blur(6px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.42, ease: 'power3.out', immediateRender: false }, T.typo + 0.12)
  S.classTrack(S.typedNode, 'sel', [[T.typo, true], [T.typo + 0.15, false]])
  S.sfx(T.typo, 'type')
  S.typeInto(T.typo + 0.15, [[0, null]])
  const typoEnd = S.typeChars(T.typo + 0.15, 'chorme', 16)
  view('appTypo', typoEnd + 0.2)
  footerAt(typoEnd + 0.2, FL.chrome)
  stagger(appTypo.rowEls, typoEnd + 0.2, 0.03, 8)
  S.sfx(typoEnd + 0.2, 'pop')
  T.findOut = 18.55
  S.sfx(T.findOut, 'whoosh', { dur: 0.5, pan: 0, soft: true })
  S.conceal(findHead, T.findOut)
  cbHide(T.findOut + 0.05)

  // S5 — content search as an X-ray: only the files that contain the word light up
  T.content = 19.0
  S.clearInput(T.content - 0.03)
  noView(T.content - 0.03)
  const contentHead = S.headline('Search inside files.', 'Not just names. The words in them.')
  S.revealWords(contentHead, T.content + 0.02)
  subIn(contentHead.querySelector('.t-sub'), T.content + 0.32)
  const contentFoot = S.footnote('Off by default. Turn on “Index File Contents” in Settings.')
  footIn(contentFoot, T.content + 0.35)
  tl.fromTo(xcards, {
    opacity: 0, z: -700, y: 90, rotationX: 22, rotationY: (i) => XC[i].ry * 2.2, transformPerspective: 1400, filter: 'blur(0px)'
  }, {
    opacity: 1, z: (i) => XC[i].z, y: 0, rotationX: 0, rotationY: (i) => XC[i].ry, filter: 'blur(0px)',
    duration: 0.75, ease: 'expo.out', stagger: { each: 0.06, from: 'center' }
  }, T.content + 0.02)
  S.sfx(T.content + 0.02, 'whoosh', { dur: 0.6, pan: 0, soft: true })
  cbShow(T.content + 0.45)
  T.wh = T.content + 0.6
  S.typeChars(T.wh, 'webhook', 16)
  T.scan = 20.3
  const SCAN = 0.8
  const X0 = 40
  const X1 = 1880
  tl.set(beam, { x: X0, opacity: 0 }, 0)
  tl.to(beam, { opacity: 1, duration: 0.08, immediateRender: false }, T.scan)
  tl.to(beam, { x: X1, duration: SCAN, ease: 'none', immediateRender: false }, T.scan)
  tl.to(beam, { opacity: 0, duration: 0.14, immediateRender: false }, T.scan + SCAN - 0.08)
  S.sfx(T.scan, 'scan', { dur: SCAN })
  const matched = []
  const decoys = []
  XC.forEach((c, i) => {
    const card = xcards[i]
    const tc = T.scan + (SCAN * (c.cx - X0)) / (X1 - X0)
    if (c.match) {
      matched.push(card)
      tl.to(card.querySelectorAll('.xm i'), { scaleX: 1, duration: 0.2, ease: 'power2.out', immediateRender: false }, tc - 0.05)
      tl.fromTo(card, { boxShadow: SHADOW_BASE }, { boxShadow: SHADOW_HIT, duration: 0.25, ease: 'power2.out', immediateRender: false }, tc)
      tl.to(card, { scale: 1.045, duration: 0.16, ease: 'power2.out', immediateRender: false }, tc)
      tl.to(card, { scale: 1, duration: 0.3, ease: 'power2.inOut', immediateRender: false }, tc + 0.16)
      S.sfx(tc, 'ping', { pan: (c.cx - 960) / 960 })
    } else {
      decoys.push(card)
      tl.to(card, { opacity: 0.22, filter: 'blur(2px)', scale: 0.95, duration: 0.35, ease: 'power2.out', immediateRender: false }, tc)
    }
  })
  T.morph = 21.4
  const FLY = 0.55
  const FLY_STEP = 0.08
  tl.to(decoys, { opacity: 0, y: 30, filter: 'blur(6px)', duration: 0.25, ease: 'power2.in', immediateRender: false }, T.morph)
  S.sfx(T.morph, 'whoosh', { dur: 0.5, pan: 0, soft: true })
  view('content', T.morph + 0.18, 0.35)
  footerAt(T.morph + 0.18, FL.notes)
  // each row appears just before its file lands on it
  stagger(content.rowEls, T.morph + FLY - 0.12, FLY_STEP, 8)
  content.rowEls.forEach((_, j) => S.sfx(T.morph + FLY + j * FLY_STEP, 'pop', { pan: -0.4 }))
  T.contentOut = 23.55
  S.conceal(contentHead, T.contentOut)
  footOut(contentFoot, T.contentOut)
  cbHide(T.contentOut + 0.05)

  // S6 — clipboard
  T.clip = 24.0
  S.clearInput(T.clip - 0.03)
  noView(T.clip - 0.03)
  const clipHead = S.headline('Copy. Summon. Done.', 'What you just copied is already there.')
  S.revealWords(clipHead, T.clip + 0.02)
  subIn(clipHead.querySelector('.t-sub'), T.clip + 0.35)
  const clipFoot = S.footnote('Works with anything copied in the last 5 seconds. You can change this in Settings.')
  footIn(clipFoot, T.clip + 0.35)
  tl.fromTo(notes, { opacity: 0, x: -160, rotationY: -30, scale: 0.96, transformPerspective: 1800, filter: 'blur(0px)' },
    { opacity: 1, x: 0, rotationY: 0, scale: 1, filter: 'blur(0px)', duration: 0.85, ease: 'expo.out', immediateRender: false }, T.clip)
  S.sfx(T.clip, 'whoosh', { dur: 0.5, pan: -0.6, soft: true })
  tl.to(sel.querySelector('.selb'), { scaleX: 1, duration: 0.3, ease: 'power1.inOut' }, T.clip + 0.55)
  S.hudKeys(T.clip + 0.95, ['⌘', 'C'], 0.3)
  T.summon = T.clip + 1.5
  S.hudKeys(T.summon, ['⌥', 'space'], 0.6)
  tl.to(notes, { scale: 0.94, y: 24, opacity: 0, filter: 'blur(8px)', duration: 0.55, ease: 'power2.inOut', immediateRender: false }, T.summon)
  cbShow(T.summon + 0.05)
  T.land = T.summon + 0.45
  T.clipOut = 27.55
  tl.to(S.phState, { k: 0, duration: 0.2, ease: 'power2.in', immediateRender: false }, T.land - 0.28)
  tl.set(S.phState, { k: 1 }, T.clipOut + 0.3)
  S.typeInto(T.land, [[0, '1280 * 0.85']], { sound: false })
  view('calc', T.land + 0.12, 0.35)
  footerAt(T.land + 0.12, FL.calc)
  fhEntries.push([T.land + 0.12, 1])
  S.sfx(T.land + 0.12, 'pop')
  T.copy = 26.85
  S.hudKeys(T.copy, ['↵'], 0.6)
  tl.fromTo(calc.querySelector('.flash'), { opacity: 0 }, { opacity: 1, duration: 0.12, immediateRender: false }, T.copy)
  tl.to(calc.querySelector('.flash'), { opacity: 0, duration: 0.5, immediateRender: false }, T.copy + 0.3)
  S.sfx(T.copy + 0.05, 'chime')
  S.conceal(clipHead, T.clipOut)
  footOut(clipFoot, T.clipOut)
  cbHide(T.clipOut)
  fhEntries.push([T.clipOut + 0.3, 0])

  // S7 — and much more: a fast cascade in depth
  T.more = 28.0
  const moreHead = S.headline('And much more.', [], { big: true, top: 190 })
  S.revealWords(moreHead, T.more)
  const wall = S.h('div', 'wall')
  const chips = []
  for (const r of [
    [['ri:calculator-line', 'Calculator'], ['ri:ruler-line', 'Unit conversion'], ['ri:exchange-dollar-line', 'Currency'], ['ri:palette-line', 'Colors']],
    [['ri:clipboard-line', 'Clipboard history'], ['ri:code-s-slash-line', 'Snippets'], ['ri:image-edit-line', 'Image converter'], ['ri:folder-open-line', 'VS Code projects']],
    [['ri:hashtag', 'Number bases'], ['ri:calendar-line', 'Date math'], ['ri:text', 'Text stats'], ['ri:links-line', 'Open URLs']]
  ]) {
    const line = S.h('div', 'wrow')
    for (const [ic, label] of r) {
      const c = S.h('div', 'chip', `${S.svg(ic)}${label}`)
      line.appendChild(c)
      chips.push(c)
    }
    wall.appendChild(line)
  }
  S.topLayer.appendChild(wall)
  tl.fromTo(chips, { opacity: 0, z: -420, y: 50, rotationX: 38, transformPerspective: 1200, filter: 'blur(10px)' },
    { opacity: 1, z: 0, y: 0, rotationX: 0, filter: 'blur(0px)', duration: 0.55, stagger: 0.04, ease: 'expo.out' }, T.more + 0.15)
  S.sfx(T.more + 0.15, 'cascade', { n: chips.length, step: 0.04 })
  const moreFoot = S.footnote('Some features come from bundled official plugins.')
  footIn(moreFoot, T.more + 0.3)
  T.moreOut = 29.4
  S.conceal(moreHead, T.moreOut, { dur: 0.3 })
  tl.to(chips, { opacity: 0, y: -10, filter: 'blur(6px)', duration: 0.3, stagger: 0.01, ease: 'power2.in', immediateRender: false }, T.moreOut)
  footOut(moreFoot, T.moreOut)
  tl.to('#glow', { opacity: 0.2, duration: 0.35, ease: 'power2.in', immediateRender: false }, T.moreOut)

  // S8 — end card, lands on the downbeat after a beat of silence
  T.end = 30.0
  const end = S.centerCard(`<img class="end-logo" src="logo.svg"><div class="t-hero">Find it. <span class="grad">Run it.</span></div>
    <div class="ver">Tuff v2.4.14 is out now.</div><div class="plat">macOS · Windows · Linux</div><div class="url">github.com/talex-touch/tuff</div>`, 'card center end')
  tl.set(end, { opacity: 1 }, 0)
  const [logo, slogan, ver, plat, url] = end.children
  S.reveal(logo, T.end, { y: 0, scale: 0.8, blur: 18, dur: 0.9, ease: 'expo.out' })
  S.reveal(slogan, T.end + 0.18, { y: 26, blur: 12, dur: 0.9 })
  S.reveal(ver, T.end + 0.6, { y: 16, blur: 8, dur: 0.7 })
  S.reveal(plat, T.end + 0.72, { y: 16, blur: 8, dur: 0.7 })
  S.reveal(url, T.end + 0.84, { y: 16, blur: 8, dur: 0.7 })
  tl.fromTo(end, { scale: 1 }, { scale: 1.025, duration: 4, ease: 'none', immediateRender: false }, T.end)
  tl.to(S.glowState, { cy: 800, spread: 1.4, duration: 1.4, ease: 'power2.out' }, T.end - 0.1)
  tl.to('#glow', { opacity: 0.42, duration: 1.0, ease: 'power2.out', immediateRender: false }, T.end)
  T.final = 34.0

  S.switchTrack(S.body, viewEntries)
  S.switchTrack(S.fl, flEntries)
  S.switchTrack(S.fh, fhEntries)

  // ---- measure the laid-out scene (camera still at identity, so rects are rig-local) ----
  const at = (t) => { tl.seek(t, false); window.__runTracks(t) }
  const rectOf = (el) => {
    const r = el.getBoundingClientRect()
    return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }
  }
  at(T.recZoom - 0.05)
  const t0 = rectOf(rec.tileEls[0])
  const t2 = rectOf(rec.tileEls[2])
  const recFocus = { cx: (t0.x + t2.x + t2.w) / 2, cy: t0.cy }
  at(T.ydZoom)
  const ydTile = rectOf(ydCode.tileEls[1])
  at(T.morph + 0.9)
  const rowIcons = content.rowEls.map((r) => rectOf(r.querySelector('.ic')))
  at(0)

  // Matched files fly into the result rows they become.
  matched.forEach((card, j) => {
    const c = XC[xcards.indexOf(card)]
    const dst = rowIcons[j]
    const t0 = T.morph + j * FLY_STEP
    tl.to(card, { x: dst.cx - c.cx, y: dst.cy - CARD_Y, z: 0, rotationY: 0, scale: dst.w / 350, duration: FLY, ease: 'power2.inOut', immediateRender: false }, t0)
    tl.to(card, { opacity: 0, duration: 0.14, ease: 'power1.in', immediateRender: false }, t0 + FLY - 0.12)
  })

  // ---- camera (origin fixed at the stage centre; focus() solves the translation) ----
  const focus = (P, s, C) => ({ s, x: C[0] - 960 - s * (P.cx - 960), y: C[1] - 540 - s * (P.cy - 540) })
  // S1: gentle push, then a close-up on the reasons, then whip out
  S.camTo(T.cbIn, { s: 1.035 }, T.recZoom - T.cbIn, 'power1.inOut')
  S.camTo(T.recZoom, focus(recFocus, 1.85, [960, 575]), 0.7, 'power3.inOut')
  const rz = focus(recFocus, 1.92, [960, 575])
  S.camTo(T.recZoom + 0.7, rz, T.recOut - T.recZoom - 0.7, 'none')
  S.camTo(T.recOut, { x: rz.x - 1900, bx: 46 }, 0.36, 'power2.in')
  S.sfx(T.recOut, 'whoosh', { dur: 0.8, pan: -1 })
  // S2: whip in on Keynote, whip across to Code
  S.camSet(T.ctx - 0.06, { s: 1, x: 1900, y: 0, bx: 46, by: 0 })
  S.camTo(T.ctx - 0.06, { x: 0, bx: 0 }, 0.45, 'expo.out')
  S.camTo(T.swap - 0.3, { x: -1900, bx: 46 }, 0.3, 'power2.in')
  S.sfx(T.swap - 0.3, 'whoosh', { dur: 0.75, pan: -1 })
  S.camSet(T.swap, { x: 1900, bx: 46 })
  S.camTo(T.swap, { x: 0, bx: 0 }, 0.45, 'expo.out')
  S.camTo(T.swap + 1.0, { s: 1.04 }, 0.9, 'power1.inOut')
  // S3: pull back into the memory, come forward for today, then look at yesterday's pick
  S.camTo(T.yd, { s: 0.94, x: 0, y: 0 }, 0.7, 'power2.out')
  S.camTo(T.flip, { s: 1 }, 0.5, 'power2.out')
  const yz = focus(ydTile, 1.6, [960, 690])
  S.camTo(T.ydZoom, yz, 0.75, 'power3.inOut')
  S.camTo(T.ydZoom + 0.75, focus(ydTile, 1.66, [960, 690]), T.ydOut - T.ydZoom - 0.75, 'none')
  S.camTo(T.ydOut + 0.05, { y: yz.y - 1300, by: 46 }, 0.36, 'power2.in')
  S.sfx(T.ydOut + 0.05, 'whoosh', { dur: 0.75, pan: 0 })
  S.camSet(T.find - 0.04, { s: 1, x: 0, y: 0, bx: 0, by: 0 })
  // S4: lean in on the typo result, then push through
  S.camTo(T.typo + 0.7, { s: 1.06, y: -14 }, T.findOut - T.typo - 0.7, 'power2.inOut')
  S.camTo(T.findOut, { s: 1.24, bx: 8, by: 8 }, 0.4, 'power2.in')
  S.camSet(T.content - 0.03, { s: 1, x: 0, y: 0, bx: 0, by: 0 })
  // S5: drift into the cards while the beam runs, hold still for the morph, push on the results
  S.camTo(T.content + 0.6, { s: 1.03, y: 10 }, T.morph - 0.35 - T.content - 0.6, 'power1.inOut')
  S.camTo(T.morph - 0.35, { s: 1, y: 0 }, 0.3, 'power2.inOut')
  S.camTo(T.morph + 0.65, { s: 1.045 }, T.contentOut - T.morph - 0.65, 'power1.inOut')
  S.camSet(T.clip - 0.03, { s: 1, x: 0, y: 0, bx: 0, by: 0 })
  // S6: still while the copied text flies, then a slow push on the answer
  S.camTo(T.land + 0.5, { s: 1.04 }, T.clipOut - T.land - 0.5, 'power1.inOut')
  S.camSet(T.more - 0.05, { s: 1, x: 0, y: 0, bx: 0, by: 0 })

  // Fly the copied text into the search field: measure both ends on the finished layout.
  at(T.summon - 0.01)
  const a = sel.getBoundingClientRect()
  at(T.land + 0.3)
  const b = S.typedNode.getBoundingClientRect()
  at(0)
  const k = b.height / a.height
  const pad = 6
  tl.fromTo(fly, { x: a.left - pad, y: a.top, scale: 1, opacity: 0 },
    { opacity: 1, duration: 0.08, ease: 'none', immediateRender: false }, T.summon + 0.02)
  tl.to(fly, { x: b.left - pad * k, y: b.top, scale: k, duration: 0.4, ease: 'power3.inOut', immediateRender: false }, T.summon + 0.05)
  tl.to(fly, { opacity: 0, duration: 0.12, ease: 'power1.out', immediateRender: false }, T.land)
  tl.set(fly, { x: a.left - pad, y: a.top, opacity: 0 }, 0)
  S.sfx(T.summon + 0.05, 'swish')
  window.__fly = { a: [a.left, a.top, a.width, a.height], b: [b.left, b.top, b.width, b.height] }
  window.__focus = { recFocus, ydTile, rowIcons }
}

window.__T = T
window.__seek = (t) => {
  S.tl.seek(t, false)
  window.__runTracks(t)
}
window.__ready = (async () => {
  await document.fonts.ready
  await Promise.all([...document.images].map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r }))))
  build()
  window.__duration = T.final
  return true
})()
