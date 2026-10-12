/* Storyboard — Tuff v2.4.14 launch film, English cut. Every scene lives on the shared timeline. */
const S = window.__scene
const B = S.badge
const T = {}
const DOT = '<span class="dot">•</span>'
const FILE = { src: 'File', srcIcon: 'ri:file-3-line' }
const APP = { src: 'Application', srcIcon: 'ri:apps-line' }
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
const budget = { icon: S.ft('type-xlsx'), title: 'Q4 Budget.xlsx', sub: fileSub('Spreadsheet', '86 KB', '2026/10/9 18:20', 'Finance'), ...FILE, qk: '⌘1', active: true }
const fileQ4 = listView('fileQ4', [
  budget,
  { icon: S.ft('type-key'), title: 'Q4 Launch.key', sub: fileSub('Presentation', '18.6 MB', '2026/10/10 21:40', 'Launch'), ...FILE, qk: '⌘2' },
  { icon: S.ft('type-pdf'), title: 'Q4 Roadmap.pdf', sub: fileSub('Document', '2.4 MB', '2026/10/2 09:41', 'Product'), ...FILE, qk: '⌘3' },
  { icon: S.ft('type-docx'), title: 'Q4 OKRs.docx', sub: fileSub('Document', '48 KB', '2026/9/28 16:55', 'Team'), ...FILE, qk: '⌘4' }
])
const fileTypo = listView('fileTypo', [
  budget,
  { icon: S.ft('type-xlsx'), title: 'Budget Template.xlsx', sub: fileSub('Spreadsheet', '31 KB', '2026/8/14 10:02', 'Finance'), ...FILE, qk: '⌘2' }
])
const content = listView('content', [
  { icon: S.ft('type-md'), title: 'payment-notes.md', sub: fileSub('Text', '6 KB', '2026/10/9 21:14', 'Notes'), ...FILE, qk: '⌘1', active: true },
  { icon: S.ft('generic-doc'), title: 'gateway.ts', sub: fileSub('Code', '12 KB', '2026/10/8 17:30', 'server'), ...FILE, qk: '⌘2' },
  { icon: S.ft('type-txt'), title: 'launch-checklist.txt', sub: fileSub('Text', '3 KB', '2026/10/7 11:05', 'Launch'), ...FILE, qk: '⌘3' }
])
const calc = S.h('div')
calc.innerHTML = `<div class="pcard">
  <div class="phd"><span class="pid">preview.expression.advanced</span>
    <div class="pa"><span class="copy"><span class="flash"></span><span class="hk">↵</span>Copy result</span><span><span class="hk">⌘←</span>Recent</span></div></div>
  <div class="plb">Result</div>
  <div class="pv">1088</div>
  <div class="ptt">1280 * 0.85</div>
  <div class="pills"><span class="pill">safe-parser</span></div>
  <div class="pw">Powered by TuffIntelligence</div>
</div>`
S.addView('calc', calc)

// footer variants
const FL = { mail: 0, preview: 1, ghostty: 2, budget: 3, notes: 4, calc: 5 }
S.fl.innerHTML = [
  S.footerItem({ icon: S.app('mail'), title: 'Mail', sub: 'Application', subIcon: 'ri:apps-line' }),
  S.footerItem({ icon: S.app('preview'), title: 'Preview', sub: 'Application', subIcon: 'ri:apps-line' }),
  S.footerItem({ icon: S.app('ghostty'), title: 'Ghostty', sub: 'Application', subIcon: 'ri:apps-line' }),
  S.footerItem({ icon: S.ft('type-xlsx'), title: 'Q4 Budget.xlsx', sub: 'File', subIcon: 'ri:file-3-line' }),
  S.footerItem({ icon: S.ft('type-md'), title: 'payment-notes.md', sub: 'File', subIcon: 'ri:file-3-line' }),
  `<div>${S.svg('ri:calculator-line')}<div class="ft"><b>1280 * 0.85</b></div></div>`
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
const doc = win('light doc', 'payment-notes.md', S.ft('type-md'), `
  <div class="h1">Payment integration</div>
  <div class="li">Verify the <span class="mk"><span class="hlb"></span>webhook</span> signature at the gateway.</div>
  <div class="li">Retry failed events up to 3 times.</div>
  <div class="li">Log every refund with its order ID.</div>`, MID)
const notes = win('light notes', 'Notes', S.app('notes'), `
  <div class="h1">Q4 gear budget</div>
  <div class="ln2"><span class="lb">Monitor</span><span><span class="sel"><span class="selb"></span>1280 * 0.85</span>  (15% off)</span></div>
  <div class="ln2"><span class="lb">Keyboard</span><span>189</span></div>
  <div class="ln2"><span class="lb">Desk lamp</span><span>59</span></div>`, MID)
const sel = notes.querySelector('.sel')
const fly = S.h('div', 'fly', '1280 * 0.85')
S.topLayer.appendChild(fly)

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
  const footerAt = (at, idx) => flEntries.push([at, idx])
  function cbShow(at, big) {
    if (big) tl.fromTo(S.cbWrap, { y: 60, scale: 0.92 }, { y: 0, scale: 1, duration: 1.0, ease: 'expo.out', immediateRender: false }, at)
    else tl.fromTo(S.cbWrap, { y: 14, scale: 0.97 }, { y: 0, scale: 1, duration: 0.35, ease: 'power3.out', immediateRender: false }, at)
    tl.fromTo(S.cb, { opacity: 0 }, { opacity: 1, duration: big ? 0.45 : 0.2, ease: 'power2.out', immediateRender: false }, at)
  }
  function cbHide(at) {
    tl.to(S.cb, { opacity: 0, duration: 0.22, ease: 'power2.in', immediateRender: false }, at)
    tl.to(S.cbWrap, { scale: 0.97, duration: 0.22, ease: 'power2.in', immediateRender: false }, at)
  }
  const stagger = (els, at, step = 0.04, y = 10) =>
    tl.fromTo(els, { opacity: 0, y }, { opacity: 1, y: 0, duration: 0.3, stagger: step, ease: 'power2.out', immediateRender: false }, at)
  const winIn = (w, at, from = { y: 40, scale: 0.98 }) =>
    tl.fromTo(w, { opacity: 0, x: 0, filter: 'blur(0px)', ...from }, { opacity: 1, x: 0, y: 0, scale: 1, duration: 0.8, ease: 'power3.out', immediateRender: false }, at)
  const winOut = (w, at, to = { y: 30 }) =>
    tl.to(w, { opacity: 0, duration: 0.45, ease: 'power2.in', immediateRender: false, ...to }, at)
  const footIn = (f, at) => tl.fromTo(f, { opacity: 0 }, { opacity: 1, duration: 0.6, ease: 'power2.out' }, at)
  const footOut = (f, at) => tl.to(f, { opacity: 0, duration: 0.4, ease: 'power2.in', immediateRender: false }, at)

  tl.set(S.cb, { opacity: 0 }, 0)
  tl.set(S.body, { height: 0 }, 0)

  // S1 — hook: readable from the very first frame
  const keyEls = [document.getElementById('kOpt'), S.hook.querySelector('.plus'), document.getElementById('kSpace')]
  tl.set(S.hook, { opacity: 1 }, 0)
  tl.fromTo(S.hook, { scale: 1.05 }, { scale: 1, duration: 1.4, ease: 'power2.out' }, 0)
  const hookFoot = S.footnote('Alt + Space on Windows and Linux')
  footIn(hookFoot, 0.3)
  T.press = 1.45
  tl.to([keyEls[0], keyEls[2]], { y: 9, duration: 0.07, ease: 'power1.in', immediateRender: false }, T.press)
  tl.to([keyEls[0], keyEls[2]], { y: 0, duration: 0.22, ease: 'power2.out', immediateRender: false }, T.press + 0.16)
  tl.fromTo(S.hook.querySelectorAll('.ring'), { opacity: 0, scale: 1, borderColor: 'rgba(120,170,255,0.95)' },
    { opacity: 1, scale: 1.18, duration: 0.5, ease: 'power2.out', immediateRender: false }, T.press + 0.02)
  tl.to(S.hook.querySelectorAll('.ring'), { opacity: 0, duration: 0.3, immediateRender: false }, T.press + 0.3)
  tl.to(S.hook, { opacity: 0, scale: 0.94, filter: 'blur(14px)', duration: 0.5, ease: 'power2.in', immediateRender: false }, T.press + 0.3)
  footOut(hookFoot, T.press + 0.3)

  // S2 — recommendations
  T.cbIn = T.press + 0.55
  tl.fromTo('#glow', { opacity: 0 }, { opacity: 0.9, duration: 1.4, ease: 'power2.out' }, T.press + 0.2)
  cbShow(T.cbIn, true)
  view('rec', T.cbIn + 0.05, 0.6)
  footerAt(T.cbIn, FL.mail)
  stagger(rec.tileEls, T.cbIn + 0.25)
  stagger(rec.rowEls, T.cbIn + 0.45, 0.05)
  const recHead = S.headline('It knows what you need.', 'Before you type a single letter.')
  S.reveal(recHead, T.cbIn + 0.55, { y: 24, blur: 10, dur: 0.9 })
  T.recOut = T.cbIn + 4.9
  S.conceal(recHead, T.recOut)
  cbHide(T.recOut + 0.05)

  // S3 — app context
  T.ctx = T.recOut + 0.3
  const ctxHead = S.headline('Different app. Different picks.', 'Suggestions follow the app you’re in.')
  S.reveal(ctxHead, T.ctx + 0.05, { y: 24, blur: 10, dur: 0.9 })
  const ctxFoot = S.footnote('App context is available on macOS.')
  footIn(ctxFoot, T.ctx + 0.3)
  winIn(kn, T.ctx + 0.1)
  tl.set(S.cbWrap, { top: 214 }, T.ctx)
  S.hudKeys(T.ctx + 1.15, ['⌥', 'space'])
  cbShow(T.ctx + 1.25)
  view('ctxKey', T.ctx + 1.25, 0.01)
  footerAt(T.ctx + 1.25, FL.preview)
  stagger(ctxKey.tileEls, T.ctx + 1.32, 0.05)
  cbHide(T.ctx + 3.0)
  winOut(kn, T.ctx + 3.15, { x: -90 })
  winIn(vs, T.ctx + 3.3, { x: 90, y: 0, scale: 1 })
  S.hudKeys(T.ctx + 4.0, ['⌥', 'space'])
  cbShow(T.ctx + 4.1)
  view('ctxCode', T.ctx + 4.1, 0.01)
  footerAt(T.ctx + 4.1, FL.ghostty)
  stagger(ctxCode.tileEls, T.ctx + 4.17, 0.05)
  T.ctxOut = T.ctx + 5.9
  S.conceal(ctxHead, T.ctxOut)
  footOut(ctxFoot, T.ctxOut)
  cbHide(T.ctxOut)
  winOut(vs, T.ctxOut + 0.1)

  // S4 — file search
  T.file = T.ctxOut + 0.35
  tl.set(S.cbWrap, { top: 164 }, T.file - 0.2)
  const fileHead = S.headline('Find any file. Fast.', ['Results show up as you type.', 'Even with typos.'])
  S.reveal(fileHead, T.file, { y: 24, blur: 10, dur: 0.9 })
  cbShow(T.file + 0.1)
  view('rec', T.file + 0.1, 0.01)
  footerAt(T.file + 0.1, FL.mail)
  const q4End = S.typeChars(T.file + 0.75, 'q4', 16)
  view('fileQ4', q4End + 0.15)
  footerAt(q4End + 0.15, FL.budget)
  stagger(fileQ4.rowEls, q4End + 0.15, 0.03, 8)
  T.typo = T.file + 2.55
  const [subA, subB] = fileHead.querySelectorAll('.t-sub')
  tl.to(subA, { opacity: 0, y: -8, filter: 'blur(6px)', duration: 0.3, ease: 'power2.in', immediateRender: false }, T.typo - 0.1)
  tl.fromTo(subB, { opacity: 0, y: 10, filter: 'blur(6px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.45, ease: 'power3.out', immediateRender: false }, T.typo + 0.15)
  S.classTrack(S.typedNode, 'sel', [[T.typo, true], [T.typo + 0.18, false]])
  S.typeInto(T.typo + 0.18, [[0, null]])
  const typoEnd = S.typeChars(T.typo + 0.18, 'budgte', 16)
  view('fileTypo', typoEnd + 0.25)
  stagger(fileTypo.rowEls, typoEnd + 0.25, 0.03, 8)
  T.fileOut = T.file + 5.1
  S.conceal(fileHead, T.fileOut)
  cbHide(T.fileOut + 0.05)

  // S5 — content search
  T.content = T.fileOut + 0.35
  S.clearInput(T.content)
  const contentHead = S.headline('Search inside files, too.', 'Find notes and code by the words inside them.')
  S.reveal(contentHead, T.content, { y: 24, blur: 10, dur: 0.9 })
  const contentFoot = S.footnote('Off by default. Turn on “Index File Contents” in Settings.')
  footIn(contentFoot, T.content + 0.3)
  winIn(doc, T.content + 0.1)
  tl.to(doc.querySelector('.hlb'), { scaleX: 1, duration: 0.45, ease: 'power2.inOut' }, T.content + 0.9)
  T.cs = T.content + 1.75
  tl.to(doc, { scale: 0.94, y: 24, opacity: 0, filter: 'blur(8px)', duration: 0.6, ease: 'power2.inOut', immediateRender: false }, T.cs - 0.05)
  cbShow(T.cs)
  view('rec', T.cs, 0.01)
  footerAt(T.cs, FL.mail)
  const whEnd = S.typeChars(T.cs + 0.45, 'webhook', 16)
  view('content', whEnd + 0.18)
  footerAt(whEnd + 0.18, FL.notes)
  stagger(content.rowEls, whEnd + 0.18, 0.03, 8)
  T.contentOut = T.content + 5.2
  S.conceal(contentHead, T.contentOut)
  footOut(contentFoot, T.contentOut)
  cbHide(T.contentOut)

  // S6 — clipboard
  T.clip = T.contentOut + 0.35
  S.clearInput(T.clip)
  viewEntries.push([T.clip, -1])
  flEntries.push([T.clip, -1])
  tl.set(S.body, { height: 0 }, T.clip)
  const clipHead = S.headline('Copy. Summon. Done.', 'What you just copied is already there.')
  S.reveal(clipHead, T.clip, { y: 24, blur: 10, dur: 0.9 })
  const clipFoot = S.footnote('Works with anything copied in the last 5 seconds. You can change this in Settings.')
  footIn(clipFoot, T.clip + 0.3)
  winIn(notes, T.clip + 0.1)
  tl.to(sel.querySelector('.selb'), { scaleX: 1, duration: 0.32, ease: 'power1.inOut' }, T.clip + 0.75)
  S.hudKeys(T.clip + 1.3, ['⌘', 'C'], 0.7)
  T.summon = T.clip + 2.0
  S.hudKeys(T.summon, ['⌥', 'space'], 0.7)
  tl.to(notes, { scale: 0.94, y: 24, opacity: 0, filter: 'blur(8px)', duration: 0.6, ease: 'power2.inOut', immediateRender: false }, T.summon)
  cbShow(T.summon + 0.05)
  T.land = T.summon + 0.45
  tl.to(S.phState, { k: 0, duration: 0.2, ease: 'power2.in', immediateRender: false }, T.land - 0.28)
  tl.set(S.phState, { k: 1 }, T.clipOut + 0.3)
  S.typeInto(T.land, [[0, '1280 * 0.85']])
  view('calc', T.land + 0.12, 0.35)
  footerAt(T.land + 0.12, FL.calc)
  fhEntries.push([T.land + 0.12, 1])
  T.copy = T.land + 1.25
  S.hudKeys(T.copy, ['↵'], 0.7)
  tl.fromTo(calc.querySelector('.flash'), { opacity: 0 }, { opacity: 1, duration: 0.12, immediateRender: false }, T.copy)
  tl.to(calc.querySelector('.flash'), { opacity: 0, duration: 0.5, immediateRender: false }, T.copy + 0.3)
  T.clipOut = T.clip + 4.4
  S.conceal(clipHead, T.clipOut)
  footOut(clipFoot, T.clipOut)
  cbHide(T.clipOut)
  fhEntries.push([T.clipOut + 0.3, 0])

  // S7 — and much more
  T.more = T.clipOut + 0.35
  const moreHead = S.headline('And much more.')
  moreHead.style.top = '190px'
  moreHead.querySelector('.t-head').className = 't-big'
  S.reveal(moreHead, T.more, { y: 24, blur: 10, dur: 0.9 })
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
  tl.fromTo(chips, { opacity: 0, y: 18, scale: 0.96 }, { opacity: 1, y: 0, scale: 1, duration: 0.5, stagger: 0.06, ease: 'power3.out' }, T.more + 0.35)
  const moreFoot = S.footnote('Some features come from bundled official plugins.')
  footIn(moreFoot, T.more + 0.6)
  T.moreOut = T.more + 3.3
  S.conceal(moreHead, T.moreOut)
  tl.to(chips, { opacity: 0, y: -10, filter: 'blur(6px)', duration: 0.4, stagger: 0.015, ease: 'power2.in', immediateRender: false }, T.moreOut)
  footOut(moreFoot, T.moreOut)

  // S8 — end card
  T.end = T.moreOut + 0.45
  const end = S.centerCard(`<img class="end-logo" src="logo.svg"><div class="t-hero">Find it. <span class="grad">Run it.</span></div>
    <div class="ver">Tuff v2.4.14 is out now.</div><div class="plat">macOS · Windows · Linux</div><div class="url">github.com/talex-touch/tuff</div>`, 'card center end')
  tl.set(end, { opacity: 1 }, 0)
  const [logo, slogan, ver, plat, url] = end.children
  S.reveal(logo, T.end, { y: 0, scale: 0.86, blur: 16, dur: 1.0 })
  S.reveal(slogan, T.end + 0.25, { y: 26, blur: 12, dur: 1.0 })
  S.reveal(ver, T.end + 0.75, { y: 16, blur: 8, dur: 0.8 })
  S.reveal(plat, T.end + 0.9, { y: 16, blur: 8, dur: 0.8 })
  S.reveal(url, T.end + 1.05, { y: 16, blur: 8, dur: 0.8 })
  tl.to(S.glowState, { cy: 800, spread: 1.4, duration: 1.6, ease: 'power2.inOut' }, T.end - 0.3)
  tl.to('#glow', { opacity: 0.42, duration: 1.2, ease: 'power2.inOut', immediateRender: false }, T.end - 0.3)
  T.final = T.end + 4.3

  S.switchTrack(S.body, viewEntries)
  S.switchTrack(S.fl, flEntries)
  S.switchTrack(S.fh, fhEntries)

  // Fly the copied text into the search field: measure both ends on the finished layout.
  const at = (t) => { tl.seek(t, false); window.__runTracks(t) }
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
  window.__fly = { a: [a.left, a.top, a.width, a.height], b: [b.left, b.top, b.width, b.height] }
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
