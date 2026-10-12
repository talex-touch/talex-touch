/* Storyboard v3 — Tuff v2.4.14 launch film, Chinese cut. 120 BPM grid: beat 0.5 s, bar 2 s.
   A copy of story3.js in Simplified Chinese, drawn as a zh-CN install of v2.4.14 shows it. Every time on the
   timeline and every sound cue is the English cut's, so cues3.json and music3.wav serve both. */
const S = window.__scene
const B = S.badge
const T = {}
const DOT = '<span class="dot">•</span>'
const FILE = { src: '文件', srcIcon: 'ri:file-3-line' }
const APP = { src: '应用', srcIcon: 'ri:apps-line' }
const CB_TOP = 250 / 1.6 // #cbWrap is zoomed 1.6×, so its `top` is too: this puts the panel edge at y=250
const CB_TOP_CTX = 214 // floating over an app window
function fileSub(type, size, date, folder) {
  return `<span>${S.svg('ri:file-3-line')} ${type}</span>${DOT}<span>${size}</span>${DOT}<span>${date}</span>${DOT}<span>${S.svg('carbon:folder')} ${folder}</span>`
}
// The kit's own words: the search field's placeholder (boxInput.placeholder), the opening line, the space bar.
S.header.querySelector('.cb-ph').textContent = '万物尽在塔内'
S.hook.querySelector('#hookText').textContent = '一个快捷键。'
S.hook.querySelector('#kSpace').firstChild.textContent = '空格'
// Chinese has no spaces to split a headline on, so '|' marks where each chunk of the reveal ends.
const zw = (s) => s.split('|').map((w) => `<span class="w">${w}</span>`).join('')
// Pinyin input: the keys click at the English cut's pace while the IME composes, and each word lands when it
// is committed. `slots` keys at `cps`; `commits` are [slot, text]. Returns the last key's time, as typeChars does.
function imeType(t0, slots, cps, commits) {
  for (let i = 0; i < slots; i++) S.sfx(t0 + i / cps, 'type')
  S.typeInto(t0, commits.map(([slot, text]) => [slot / cps, text]), { sound: false })
  return t0 + (slots - 1) / cps
}

// ---------------- views ----------------
function gridView(name, tiles, rows) {
  const v = S.h('div')
  v.innerHTML = `<div class="sec">此刻常用</div>`
  const grid = S.h('div', 'grid')
  const tileEls = tiles.map(S.tile)
  tileEls.forEach((t) => grid.appendChild(t))
  v.appendChild(grid)
  let rowEls = []
  if (rows) {
    v.appendChild(S.h('div', 'sec', '最近案例'))
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

// App names are what Spotlight gives a Chinese macOS (kMDItemDisplayName, app-scanner.ts): 邮件, 预览, 照片 …
const rec = gridView('rec', [
  { icon: S.app('mail'), title: '邮件', badge: B('frequent', '常用', 128), qk: '⌘1', active: true },
  { icon: S.app('vscode'), title: 'Visual Studio Code', badge: B('yesterday', '昨天 09:58'), qk: '⌘2' },
  { icon: S.app('chatgpt'), title: 'ChatGPT', badge: B('frequent', '常用', 96), qk: '⌘3' },
  { icon: S.app('chrome'), title: 'Google Chrome', badge: B('timeBased', '推荐', 41), qk: '⌘4' },
  { icon: S.app('telegram'), title: 'Telegram', badge: B('recent', '最近', 12), qk: '⌘5' }
], [
  { icon: S.ft('type-key'), title: 'Q4 发布会.key', sub: B('newFile', '新文件') + `<span>演示</span>${DOT}<span>2026/10/10 21:40</span>`, ...FILE, qk: '⌘6' },
  { icon: S.app('obsidian'), title: 'Obsidian', sub: B('frequent', '常用') + '<span>/Applications/Obsidian.app</span>', evi: '累计使用 23 次', ...APP, qk: '⌘7' }
])
const ctxKey = gridView('ctxKey', [
  { icon: S.app('preview'), title: '预览', badge: B('appContext', 'Keynote 讲演 常用'), qk: '⌘1', active: true },
  { icon: S.app('pixelmator'), title: 'Pixelmator Pro', badge: B('appContext', 'Keynote 讲演 常用'), qk: '⌘2' },
  { icon: S.app('photos'), title: '照片', badge: B('appContext', 'Keynote 讲演 用过'), qk: '⌘3' },
  { icon: S.app('finder'), title: '访达', badge: B('frequent', '常用', 52), qk: '⌘4' },
  { icon: S.app('mail'), title: '邮件', badge: B('frequent', '常用', 128), qk: '⌘5' }
])
const ctxCode = gridView('ctxCode', [
  { icon: S.app('ghostty'), title: 'Ghostty', badge: B('appContext', 'Code 常用'), qk: '⌘1', active: true },
  { icon: S.app('fork'), title: 'Fork', badge: B('appContext', 'Code 常用'), qk: '⌘2' },
  { icon: S.app('chrome'), title: 'Google Chrome', badge: B('appContext', 'Code 用过'), qk: '⌘3' },
  { icon: S.app('chatgpt'), title: 'ChatGPT', badge: B('frequent', '常用', 96), qk: '⌘4' },
  { icon: S.app('mail'), title: '邮件', badge: B('frequent', '常用', 128), qk: '⌘5' }
])
// Yesterday morning: some music, a photo edit, some code. This morning, around the same hour, all three
// come back with the time they were used (the signal covers anything run within an hour either side).
const ydGrid = gridView('ydGrid', [
  { icon: S.app('music'), title: '音乐', badge: B('yesterday', '昨天 09:05'), qk: '⌘1', active: true },
  { icon: S.app('photoshop'), title: 'Adobe Photoshop 2025', badge: B('yesterday', '昨天 09:41'), qk: '⌘2' },
  { icon: S.app('vscode'), title: 'Visual Studio Code', badge: B('yesterday', '昨天 09:58'), qk: '⌘3' },
  { icon: S.app('mail'), title: '邮件', badge: B('frequent', '常用', 128), qk: '⌘4' },
  { icon: S.app('chrome'), title: 'Google Chrome', badge: B('timeBased', '推荐', 41), qk: '⌘5' }
])
const fileQ4 = listView('fileQ4', [
  { icon: S.ft('type-xlsx'), title: 'Q4 预算.xlsx', sub: fileSub('表格', '86 KB', '2026/10/9 18:20', '财务'), ...FILE, qk: '⌘1', active: true },
  { icon: S.ft('type-key'), title: 'Q4 发布会.key', sub: fileSub('演示', '18.6 MB', '2026/10/10 21:40', '发布会'), ...FILE, qk: '⌘2' },
  { icon: S.ft('type-pdf'), title: 'Q4 路线图.pdf', sub: fileSub('文档', '2.4 MB', '2026/10/2 09:41', '产品'), ...FILE, qk: '⌘3' },
  { icon: S.ft('type-docx'), title: 'Q4 OKR.docx', sub: fileSub('文档', '48 KB', '2026/9/28 16:55', '团队'), ...FILE, qk: '⌘4' }
])
// Typo recall that v2.4.14 really has: the in-memory app catalog (app-search-catalog-service.ts).
// BoxItem paints only the matcher's ranges: "chorme" fuzzy-matches Google [Ch]ro[me].
const appTypo = listView('appTypo', [
  { icon: S.app('chrome'), title: 'Google <span class="mh">Ch</span>ro<span class="mh">me</span>', sub: '<span>/Applications/Google Chrome.app</span>', ...APP, qk: '⌘1', active: true }
])
const content = listView('content', [
  { icon: S.ft('type-md'), title: '付款笔记.md', sub: fileSub('文本', '6 KB', '2026/10/9 21:14', '笔记'), ...FILE, qk: '⌘1', active: true },
  { icon: S.ft('generic-doc'), title: 'gateway.ts', sub: fileSub('代码', '12 KB', '2026/10/8 17:30', 'server'), ...FILE, qk: '⌘2' },
  { icon: S.ft('type-txt'), title: '上线清单.txt', sub: fileSub('文本', '3 KB', '2026/10/7 11:05', '发布会'), ...FILE, qk: '⌘3' }
])
// Preview cards, as the v2.4.14 abilities fill them for zh-CN (the subtitle badge and labels are Chinese there
// in every locale). The detail rows are left out to keep the cards short.
function pcard(name, id, sub, inner) {
  const d = S.h('div')
  d.innerHTML = `<div class="pcard">
  <div class="phd"><span class="pl"><span class="psb">${sub}</span><span class="pid">${id}</span></span>
    <div class="pa"><span class="copy"><span class="flash"></span><span class="hk">↵</span>复制结果</span><span><span class="hk">⌘←</span>最近处理</span></div></div>
  ${inner}
  <div class="pw">Powered by TuffIntelligence</div>
</div>`
  S.addView(name, d)
  return d
}
// `1280 * 0.85` (ASCII *) is taken by the basic expression ability (priority 10 runs before advanced's 15),
// whose card carries no badges.
const calc = pcard('calc', 'preview.expression.basic', '快速算式', `<div class="plb">结果</div><div class="pv">1088</div><div class="ptt">1280 * 0.85</div>`)
// The unit ability reads Chinese too: 转 joins the two units, and zh-CN gets the units' Chinese names.
pcard('unit', 'preview.unit', '单位换算', `<div class="plb">华氏度 → 摄氏度</div><div class="pv">20</div><div class="psub"><span>原值</span><span>68 华氏度</span></div><div class="ptt">68华氏度转摄氏度</div>
  <div class="pchips"><div class="pchip"><span>华氏度</span><b>68 华氏度</b></div><div class="pchip"><span>摄氏度</span><b>20 摄氏度</b></div></div>`)
pcard('color', 'preview.color', '颜色解析', `<div class="plb">颜色</div><div class="pv" style="color:#409eff">#409EFF</div><div class="psub"><span>RGB</span><span>rgb(64, 158, 255)</span></div>
  <div class="ptt">#409eff</div><div class="pills"><span class="pill">HEX</span></div>
  <div class="pchips"><div class="pchip"><span>HSL</span><b>hsl(210, 100%, 63%)</b></div><div class="pchip"><span>RGB</span><b>64, 158, 255</b></div></div>`)

// Ask AI: the ask-panel widget, conversation only, as in the English cut. Its empty state and the message
// chrome (You / AI / Streaming) are English in v2.4.14 whatever the language, so they are drawn as they are.
// Streaming tokens: Chinese two characters at a time, punctuation staying with the text before it.
const tk = (s) => (s.match(/[\u4e00-\u9fa5]{1,2}[，。、：；！？]*|[A-Za-z0-9]+|\s+|[^\sA-Za-z0-9\u4e00-\u9fa5]+/g) || [])
  .map((w) => (/^\s+$/.test(w) ? w : `<span class="tk">${w}</span>`)).join('')
const ai = S.h('div', 'aiw')
ai.innerHTML = `<div class="aie"><div class="aiei">${S.svg('carbon:chat')}</div><strong>Start a conversation</strong><span>Messages will appear here as the conversation progresses.</span></div>
<div class="aiml">
  <div class="aim"><div class="aih"><span class="air">You</span></div><div class="aic">规划一个东京周末</div></div>
  <div class="aim"><div class="aih"><span class="air">AI</span><span class="ais">Streaming</span></div><div class="aic"><p>${tk('轻松的周末可以这样安排：')}</p><ul>
    <li><span class="tk bul">•</span><b>${tk('周六')}</b> ${tk('— 涩谷、原宿、明治神宫')}</li>
    <li><span class="tk bul">•</span><b>${tk('周日')}</b> ${tk('— 浅草、上野公园、东京晴空塔')}</li></ul></div></div>
</div>`
S.addView('ai', ai)

// footer variants
const FL = { mail: 0, preview: 1, ghostty: 2, budget: 3, notes: 4, core: 5, chrome: 6, music: 7 }
S.fl.innerHTML = [
  S.footerItem({ icon: S.app('mail'), title: '邮件', sub: '应用', subIcon: 'ri:apps-line' }),
  S.footerItem({ icon: S.app('preview'), title: '预览', sub: '应用', subIcon: 'ri:apps-line' }),
  S.footerItem({ icon: S.app('ghostty'), title: 'Ghostty', sub: '应用', subIcon: 'ri:apps-line' }),
  S.footerItem({ icon: S.ft('type-xlsx'), title: 'Q4 预算.xlsx', sub: '文件', subIcon: 'ri:file-3-line' }),
  S.footerItem({ icon: S.ft('type-md'), title: '付款笔记.md', sub: '文件', subIcon: 'ri:file-3-line' }),
  // A preview card has no basic render: the footer falls back to the "CoreBox" title and a puzzle icon,
  // and the source is the system provider (coreBoxFooterDisplay.ts, icon-color-mode.ts, sourceMeta.ts).
  S.footerItem({ iconHtml: S.svg('ri:puzzle-line'), title: 'CoreBox', sub: '系统', subIcon: 'ri:settings-3-line' }),
  S.footerItem({ icon: S.app('chrome'), title: 'Google Chrome', sub: '应用', subIcon: 'ri:apps-line' }),
  S.footerItem({ icon: S.app('music'), title: '音乐', sub: '应用', subIcon: 'ri:apps-line' })
].join('')
S.fh.innerHTML = S.hints([['↵', '打开'], ['⌘K', '操作'], ['⌘1-0', '快速选择']])

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
const kn = win('light kn', 'Q4 发布会.key', S.app('keynote'), `
  <div class="kn-nav"><div class="kn-th g on"><b></b><i></i></div><div class="kn-th"><b></b><i></i></div><div class="kn-th"><b></b><i></i></div><div class="kn-th g"><b></b><i></i></div><div class="kn-th"><b></b><i></i></div></div>
  <div class="kn-stage"><div class="kn-slide"><div class="s1">Q4 发布会</div><div class="s2">2026 年 10 月</div></div></div>`, BIG)
const code = [
  `<span class="tk-k">import</span> { <span class="tk-v">verifySignature</span> } <span class="tk-k">from</span> <span class="tk-s">'./crypto'</span>`,
  `<span class="tk-k">import</span> { <span class="tk-v">queue</span> } <span class="tk-k">from</span> <span class="tk-s">'./queue'</span>`,
  '',
  `<span class="tk-k">export async function</span> <span class="tk-f">handleWebhook</span>(<span class="tk-v">req</span>: <span class="tk-t">Request</span>, <span class="tk-v">res</span>: <span class="tk-t">Response</span>) {`,
  `  <span class="tk-k">const</span> <span class="tk-v">signature</span> = <span class="tk-v">req</span>.<span class="tk-v">headers</span>[<span class="tk-s">'x-signature'</span>]`,
  `  <span class="tk-k">if</span> (!<span class="tk-f">verifySignature</span>(<span class="tk-v">req</span>.<span class="tk-v">body</span>, <span class="tk-v">signature</span>)) {`,
  `    <span class="tk-k">return</span> <span class="tk-v">res</span>.<span class="tk-f">status</span>(<span class="tk-n">401</span>).<span class="tk-f">send</span>(<span class="tk-s">'invalid signature'</span>)`,
  '  }',
  `  <span class="tk-c">// 失败的事件最多重试 3 次</span>`,
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
  <div class="vs-side"><div class="hd">资源管理器</div><div class="fi dir">⌄ server</div><div class="fi on">gateway.ts</div><div class="fi">crypto.ts</div><div class="fi">queue.ts</div><div class="fi dir">⌄ docs</div><div class="fi">付款笔记.md</div><div class="fi">README.md</div></div>
  <div class="vs-ed"><div class="vs-tabs"><span class="on">gateway.ts</span><span>queue.ts</span></div><div class="vs-code">${code}</div></div>`, BIG)
const notes = win('light notes', '备忘录', S.app('notes'), `
  <div class="h1">Q4 装备预算</div>
  <div class="ln2"><span class="lb">显示器</span><span><span class="sel"><span class="selb"></span>1280 * 0.85</span>（打八五折）</span></div>
  <div class="ln2"><span class="lb">键盘</span><span>189</span></div>
  <div class="ln2"><span class="lb">台灯</span><span>59</span></div>`, MID)
const sel = notes.querySelector('.sel')
const fly = S.h('div', 'fly', '1280 * 0.85')
S.topLayer.appendChild(fly)

// ---------------- yesterday: three moments, each flies into the tile it becomes ----------------
const MOMENTS = [
  { app: 'music', tm: '9:05', lb: '听音乐' },
  { app: 'photoshop', tm: '9:41', lb: '修照片' },
  { app: 'vscode', tm: '9:58', lb: '写代码' }
]
const moments = S.h('div', 'moments')
moments.innerHTML = MOMENTS.map((m) => `<div class="mo"><img src="${S.app(m.app)}"><div><div class="tm">${m.tm}</div><div class="lb">${m.lb}</div></div></div>`).join('')
S.fxFront.appendChild(moments)
const moEls = [...moments.children]
const moImgs = moEls.map((e) => e.querySelector('img'))
const flyIcons = MOMENTS.map((m) => {
  const i = S.h('img', 'flyic')
  i.src = S.app(m.app)
  S.fxFront.appendChild(i)
  return i
})

// ---------------- content X-ray: five plain-text files, three mention "webhook" ----------------
// The file index tokenizes with unicode61, which keeps a run of Chinese and Latin letters as one token, so the
// word stands between spaces, as Chinese technical writing puts it anyway.
const HL = '<span class="xm"><i></i>webhook</span>'
const CARD_Y = 700
const XC = [
  { name: '付款笔记.md', icon: S.ft('type-md'), cx: 235, ry: 16, z: -60, match: true,
    lines: ['<div class="t1">付款</div>', `每个 ${HL} 都要验签。`, '失败的事件自动重试。', '每笔退款都要记录。'] },
  { name: '东京行程.md', icon: S.ft('type-md'), cx: 597, ry: 8, z: -20,
    lines: ['<div class="t1">东京之旅</div>', '航班 9:40 落地。', '酒店订在涩谷附近。', '记得买张 Suica 卡。'] },
  { name: 'gateway.ts', icon: S.ft('generic-doc'), cx: 960, ry: 0, z: 0, match: true, code: true,
    lines: [`<span class="tk-c">// 校验每个 ${HL}</span>`, '<span class="tk-k">function</span> <span class="tk-f">handle</span>(req) {',
      '  <span class="tk-f">verify</span>(req)', '  queue.<span class="tk-f">push</span>(req)', '}'] },
  { name: '上线清单.txt', icon: S.ft('type-txt'), cx: 1323, ry: -8, z: -20, match: true,
    lines: ['<div class="t1">上线清单</div>', '改好价格页。', `再测一遍 ${HL}。`, '给媒体发邮件。'] },
  { name: '菜谱.txt', icon: S.ft('type-txt'), cx: 1685, ry: -16, z: -60,
    lines: ['<div class="t1">松饼</div>', '2 个鸡蛋，1 杯牛奶。', '1 杯面粉。', '每面煎 2 分钟。'] }
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

// ---------------- finale, part 1: features that ship as built-ins or official plugins ----------------
const MORE = [
  [['ri:calculator-line', '计算器'], ['ri:ruler-line', '单位换算'], ['ri:exchange-dollar-line', '汇率换算'], ['ri:palette-line', '颜色解析'],
    ['ri:hashtag', '进制转换'], ['ri:calendar-line', '日期计算'], ['ri:percent-line', '百分比'], ['ri:text', '文本统计']],
  [['ri:clipboard-line', '剪贴板历史记录'], ['ri:code-s-slash-line', '片段库'], ['ri:translate-2', '翻译'], ['ri:image-edit-line', '图片转换与压缩'],
    ['ri:emotion-line', 'Emoji 与符号'], ['ri:edit-2-line', '批量重命名'], ['ri:braces-line', 'JSON 格式化'], ['ri:input-method-line', '文本工具']],
  [['ri:mic-line', '语音听写'], ['ri:window-2-line', '窗口管理'], ['ri:shut-down-line', '系统操作'], ['ri:links-line', '快速链接'],
    ['ri:global-line', '打开网址'], ['ri:folder-open-line', 'VS Code 项目'], ['ri:sparkling-2-line', '智能问答'], ['ri:bookmark-line', '浏览器书签']]
]
const CHIP_TINT = ['#6cc7ff', '#8ea6ff', '#c39bff', '#ff9bd2', '#ffb877', '#7fe0b0']
const marq = S.h('div', 'marq')
const mrows = MORE.map((r, ri) => {
  const row = S.h('div', 'mrow')
  r.forEach(([ic, label], ci) => {
    const c = S.h('div', 'mchip', `${S.svg(ic)}${label}`)
    c.querySelector('svg').style.color = CHIP_TINT[(ri * 3 + ci) % CHIP_TINT.length]
    row.appendChild(c)
  })
  marq.appendChild(row)
  return row
})
S.topLayer.appendChild(marq)
const mchips = mrows.flatMap((r) => [...r.children])

// ---------------- finale, part 2: what you build with ----------------
const bento = S.h('div', 'bento')
S.topLayer.appendChild(bento)
const BX = [227, 599, 971, 1343]
const BY = [300, 622]
const BW = 350
const BH = 300
const BG = 22
function btile(col, row, w, h, html) {
  const d = S.h('div', 'btl', html)
  Object.assign(d.style, { left: BX[col] + 'px', top: BY[row] + 'px', width: w * BW + (w - 1) * BG + 'px', height: h * BH + (h - 1) * BG + 'px' })
  bento.appendChild(d)
  return d
}
const bTuffex = btile(0, 0, 2, 1, `<div class="bi bi-vue">${S.svg('logos:vue')}</div><h3>TuffEx</h3><p>Vue 3 组件库</p>
  <div class="mono" style="position:absolute;left:32px;bottom:30px">@talex-touch/tuffex</div>
  <div class="txd">
    <div class="txr"><span class="txb pri">确定</span><span class="txb">取消</span></div>
    <div class="txr"><span class="txsw"><i></i></span><span class="txcb">${S.svg('ri:check-line')}</span><span class="txpg"><i></i></span></div>
    <div class="txr"><span class="txsl"><b></b><em></em><i></i></span></div>
    <div class="txr"><span class="txseg"><em></em><span>日</span><span>周</span><span>月</span></span></div>
  </div>`)
const bDocs = btile(2, 0, 1, 1, `<div class="bi bi-docs">${S.svg('ri:book-open-line')}</div><h3>文档</h3><p>上手指南与 API 参考</p>
  <div class="dpage"><b></b><i></i><i></i><i style="width:58%"></i><i></i><i style="width:72%"></i><i style="width:40%"></i></div>
  <div class="blink">tuff.tagzxia.com${S.svg('ri:arrow-right-up-line')}<u></u></div>`)
const SDKS = ['CoreBox', '剪贴板', '存储', 'AI', '通知', '截图', 'SQLite', '语音', '网络', '窗口', '云同步', '密钥']
const bSdk = btile(3, 0, 1, 2, `<div class="bi bi-ts">${S.svg('logos:typescript-icon')}</div><h3>SDK</h3><p>为插件准备的类型化 API</p>
  <div class="sdkp">${SDKS.map((n) => `<span>${n}</span>`).join('')}</div>
  <div class="npm">${S.svg('logos:npm-icon')}<span>npm i @talex-touch/utils</span></div>`)
const CLI = ['tuff create', 'tuff dev', 'tuff publish']
const bCli = btile(0, 1, 1, 1, `<h3 style="margin-top:0">Tuff CLI</h3><p>创建、调试、发布</p>
  <div class="term">${CLI.map(() => '<div class="tl"><span class="pr">$</span> <span class="tc"></span></div>').join('')}</div>`)
const SHELF = [['ri:clipboard-line', '#0a84ff', '#64d2ff'], ['ri:translate-2', '#30b158', '#7fe0a0'], ['ri:image-edit-line', '#ff7a1a', '#ffc15e'],
  ['ri:emotion-line', '#ffb800', '#ffe066'], ['ri:mic-line', '#ff2d55', '#ff8aa8'], ['ri:code-s-slash-line', '#7d5cff', '#c39bff']]
const bStore = btile(1, 1, 2, 1, `<div class="bi bi-store">${S.svg('ri:store-2-line')}</div><h3>插件市场</h3><p>发布与安装插件</p>
  <div class="shelf">${SHELF.map(([ic, a, b]) => `<div style="background:linear-gradient(145deg, ${b}, ${a})">${S.svg(ic)}</div>`).join('')}</div>`)
const btiles = [bTuffex, bDocs, bSdk, bCli, bStore]

// ---------------- timeline ----------------
function build() {
  const { tl } = S
  const viewNames = Object.keys(S.views)
  const viewEntries = []
  const flEntries = []
  const fhEntries = [[0, 0]]
  const selEntries = []
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
  // Select what is in the field, then type over it.
  function retype(at, text, cps) {
    selEntries.push([at, true], [at + 0.15, false])
    S.sfx(at, 'type')
    S.typeInto(at + 0.15, [[0, null]])
    return S.typeChars(at + 0.15, text, cps)
  }
  // retype, through the IME
  function retypeIme(at, slots, cps, commits) {
    selEntries.push([at, true], [at + 0.15, false])
    S.sfx(at, 'type')
    S.typeInto(at + 0.15, [[0, null]])
    return imeType(at + 0.15, slots, cps, commits)
  }

  tl.set(S.cb, { opacity: 0 }, 0)
  tl.set(S.body, { height: 0 }, 0)
  tl.set(S.cbWrap, { top: CB_TOP }, 0)

  // S0 — hook: readable from the very first frame
  const keyEls = [document.getElementById('kOpt'), S.hook.querySelector('.plus'), document.getElementById('kSpace')]
  tl.set(S.hook, { opacity: 1, filter: 'blur(0px)' }, 0)
  tl.fromTo(S.hook, { scale: 1.05 }, { scale: 1, duration: 1.5, ease: 'power2.out' }, 0)
  const hookFoot = S.footnote('Windows 和 Linux 上是 Alt + 空格')
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
  const recHead = S.headline(zw('它懂你|要什么。'), '一个字都还没打。', { raw: true })
  S.revealWords(recHead, T.cbIn + 0.1)
  subIn(recHead.querySelector('.t-sub'), T.cbIn + 0.55)
  T.recZoom = 3.75
  S.conceal(recHead, T.recZoom - 0.05)
  T.recOut = 5.55

  // S2 — app context
  T.ctx = 6.0
  hide(S.cb, T.ctx - 0.08)
  tl.set(S.cbWrap, { top: CB_TOP_CTX }, T.ctx - 0.08)
  const ctxHead = S.headline(zw('换个应用，|推荐|跟着换。'), '你在用哪个应用，就推荐什么。', { raw: true })
  S.revealWords(ctxHead, T.ctx + 0.05)
  subIn(ctxHead.querySelector('.t-sub'), T.ctx + 0.45)
  const ctxFoot = S.footnote('应用上下文目前仅支持 macOS。')
  footIn(ctxFoot, T.ctx + 0.3)
  show(kn, T.ctx - 0.05)
  S.hudKeys(T.ctx + 0.45, ['⌥', '空格'])
  cbShow(T.ctx + 0.5)
  view('ctxKey', T.ctx - 0.08, 0.01) // while hidden: the box never opens on the previous scene's tiles
  footerAt(T.ctx - 0.08, FL.preview)
  stagger(ctxKey.tileEls, T.ctx + 0.56, 0.05)
  T.swap = 8.05
  hide(kn, T.swap)
  hide(S.cb, T.swap)
  show(vs, T.swap)
  S.hudKeys(T.swap + 0.45, ['⌥', '空格'])
  cbShow(T.swap + 0.5)
  view('ctxCode', T.swap, 0.01)
  footerAt(T.swap, FL.ghostty)
  stagger(ctxCode.tileEls, T.swap + 0.56, 0.05)
  T.ctxOut = 9.75
  S.conceal(ctxHead, T.ctxOut)
  footOut(ctxFoot, T.ctxOut)
  cbHide(T.ctxOut + 0.05)

  // S3 — yesterday morning: music at 9:05, a photo at 9:41, code at 9:58 → this morning they are waiting
  T.yd = 10.0
  T.flip = 12.0
  S.sfx(T.yd - 0.05, 'rewind')
  const NOW = 'grayscale(0) sepia(0) brightness(1) contrast(1) blur(0px)'
  const MEM = 'grayscale(1) sepia(0.3) brightness(0.5) contrast(0.92) blur(14px)'
  tl.fromTo(vs, { filter: NOW, opacity: 1 }, { filter: MEM, opacity: 0, duration: 0.6, ease: 'power2.in', immediateRender: false }, T.yd)
  tl.set(S.cbWrap, { top: CB_TOP }, T.yd)
  const MEM_TONE = 'grayscale(0.6) sepia(0.45) brightness(0.9)'
  const NOW_TONE = 'grayscale(0) sepia(0) brightness(1)'
  tl.set(moments, { filter: MEM_TONE }, 0)
  const ydHead = S.headline(`<span class="flipline"><span class="clockico">${S.svg('ri:time-line')}</span><span class="fw"><span class="yday">昨天</span><span class="today">今天</span></span><span class="fsp"></span>上午</span>`,
    ['昨天这个时候用过的，它都记得。'], { raw: true })
  const fw = ydHead.querySelector('.fw')
  const [yda, ydb] = fw.children
  const wa = yda.offsetWidth
  const wb = ydb.offsetWidth
  fw.style.width = wa + 'px'
  S.reveal(ydHead, T.yd + 0.05, { y: 20, blur: 12, dur: 0.6 })
  subIn(ydHead.querySelector('.t-sub'), T.flip + 0.3)
  const popIn = (el, at) => tl.fromTo(el, { opacity: 0, y: 24, scale: 0.92, filter: 'blur(8px)' },
    { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)', duration: 0.5, ease: 'back.out(1.6)' }, at)
  moEls.forEach((el, i) => {
    popIn(el, T.yd + 0.4 + i * 0.42)
    S.sfx(T.yd + 0.4 + i * 0.42, 'pop', { pan: (i - 1) * 0.5 })
  })
  tl.to(fw, { width: wb, duration: 0.32, ease: 'power2.inOut', immediateRender: false }, T.flip)
  tl.to(yda, { rotationX: 90, opacity: 0, duration: 0.16, ease: 'power2.in', immediateRender: false }, T.flip)
  tl.fromTo(ydb, { rotationX: -90, opacity: 0 }, { rotationX: 0, opacity: 1, duration: 0.24, ease: 'power2.out', immediateRender: false }, T.flip + 0.14)
  S.sfx(T.flip, 'flip')
  // The cards dissolve; their icons (stand-ins in the same spot) carry on into the CoreBox.
  T.moOut = T.flip + 0.05
  moImgs.forEach((img, i) => hide(img, T.moOut + i * 0.07)) // each icon's flight starts here
  tl.to(moEls, { opacity: 0, scale: 0.92, filter: 'blur(12px)', duration: 0.22, stagger: 0.03, ease: 'power2.in', immediateRender: false }, T.moOut)
  const ydCb = T.flip + 0.2
  cbShow(ydCb)
  view('ydGrid', T.yd + 0.1, 0.01)
  footerAt(T.yd + 0.1, FL.music)
  stagger(ydGrid.tileEls, ydCb + 0.06, 0.05)
  const ydImgs = ydGrid.tileEls.slice(0, 3).map((t) => t.querySelector('img'))
  tl.set(ydImgs, { opacity: 0 }, 0)
  S.sfx(T.moOut + 0.05, 'swish')
  T.ydZoom = 13.4
  const ydRings = ydGrid.tileEls.slice(0, 3).map((t) => {
    const r = S.h('div', 'ring2')
    t.appendChild(r)
    return r
  })
  const RING_AT = [T.ydZoom + 0.35, T.ydZoom + 0.8, T.ydZoom + 1.22]
  ydRings.forEach((r, i) => {
    tl.fromTo(r, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'power2.out', immediateRender: false }, RING_AT[i])
    S.sfx(RING_AT[i], 'ping', { pan: (i - 1) * 0.5 })
  })
  T.ydOut = 15.0
  S.conceal(ydHead, T.ydZoom - 0.05) // the close-up rises into the headline's space

  // S4 — find: fast results, and typo-tolerant app search
  T.find = 15.5
  hide(S.cb, T.find - 0.04)
  const findHead = S.headline(zw('想找什么，|一搜|就有。'), ['结果随打随现。', '应用名打错了，也能找到。'], { raw: true })
  S.revealWords(findHead, T.find + 0.05)
  const [fsA, fsB] = findHead.querySelectorAll('.t-sub')
  subIn(fsA, T.find + 0.4)
  cbShow(T.find, 'tilt')
  view('rec', T.find - 0.04, 0.01)
  footerAt(T.find - 0.04, FL.mail)
  T.q4 = T.find + 0.45
  const q4End = S.typeChars(T.q4, 'q4', 16)
  view('fileQ4', q4End + 0.15)
  footerAt(q4End + 0.15, FL.budget)
  stagger(fileQ4.rowEls, q4End + 0.15, 0.03, 8)
  S.sfx(q4End + 0.15, 'pop')
  T.typo = T.find + 1.9
  tl.to(fsA, { opacity: 0, y: -8, filter: 'blur(6px)', duration: 0.28, ease: 'power2.in', immediateRender: false }, T.typo - 0.08)
  tl.fromTo(fsB, { opacity: 0, y: 10, filter: 'blur(6px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.42, ease: 'power3.out', immediateRender: false }, T.typo + 0.12)
  const typoEnd = retype(T.typo, 'chorme', 16)
  T.typoRow = typoEnd + 0.2
  view('appTypo', T.typoRow)
  footerAt(T.typoRow, FL.chrome)
  stagger(appTypo.rowEls, T.typoRow, 0.03, 8)
  S.sfx(T.typoRow, 'pop')
  T.findOut = T.find + 3.8
  S.sfx(T.findOut, 'whoosh', { dur: 0.5, pan: 0, soft: true })
  S.conceal(findHead, T.findOut)
  cbHide(T.findOut + 0.05)

  // S5 — content search as an X-ray: only the files that contain the word light up
  T.content = T.findOut + 0.45
  S.clearInput(T.content - 0.03)
  noView(T.content - 0.03)
  const contentHead = S.headline(zw('搜到|文件里面去。'), '不只看文件名，还看里面写了什么。', { raw: true })
  S.revealWords(contentHead, T.content + 0.02)
  subIn(contentHead.querySelector('.t-sub'), T.content + 0.32)
  const contentFoot = S.footnote('默认关闭。可在设置中开启「索引文件内容」。')
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
  T.scan = T.content + 1.3
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
  T.morph = T.content + 2.4
  const FLY = 0.55
  const FLY_STEP = 0.08
  tl.to(decoys, { opacity: 0, y: 30, filter: 'blur(6px)', duration: 0.25, ease: 'power2.in', immediateRender: false }, T.morph)
  S.sfx(T.morph, 'whoosh', { dur: 0.5, pan: 0, soft: true })
  view('content', T.morph + 0.18, 0.35)
  footerAt(T.morph + 0.18, FL.notes)
  // each row appears just before its file lands on it
  stagger(content.rowEls, T.morph + FLY - 0.12, FLY_STEP, 8)
  content.rowEls.forEach((_, j) => S.sfx(T.morph + FLY + j * FLY_STEP, 'pop', { pan: -0.4 }))
  T.contentOut = T.content + 4.55
  S.conceal(contentHead, T.contentOut)
  footOut(contentFoot, T.contentOut)
  cbHide(T.contentOut + 0.05)

  // S6 — clipboard
  T.clip = T.contentOut + 0.45
  S.clearInput(T.clip - 0.03)
  noView(T.clip - 0.03)
  const clipHead = S.headline(zw('复制，|呼出，|搞定。'), '刚复制的内容，已经帮你填好了。', { raw: true })
  S.revealWords(clipHead, T.clip + 0.02)
  subIn(clipHead.querySelector('.t-sub'), T.clip + 0.35)
  const clipFoot = S.footnote('5 秒内复制的内容会自动带入，可在设置中调整。')
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
  T.clipOut = T.clip + 3.55
  tl.to(S.phState, { k: 0, duration: 0.2, ease: 'power2.in', immediateRender: false }, T.land - 0.28)
  S.typeInto(T.land, [[0, '1280 * 0.85']], { sound: false })
  view('calc', T.land + 0.12, 0.35)
  footerAt(T.land + 0.12, FL.core)
  S.sfx(T.land + 0.12, 'pop')
  T.copy = T.clip + 2.85
  S.hudKeys(T.copy, ['↵'], 0.6)
  tl.fromTo(calc.querySelector('.flash'), { opacity: 0 }, { opacity: 1, duration: 0.12, immediateRender: false }, T.copy)
  tl.to(calc.querySelector('.flash'), { opacity: 0, duration: 0.5, immediateRender: false }, T.copy + 0.3)
  S.sfx(T.copy + 0.05, 'chime')
  S.conceal(clipHead, T.clipOut, { dur: 0.3 })
  footOut(clipFoot, T.clipOut)

  // S6b — instant preview: the box stays up, the query changes, the answer card follows
  T.prev = T.clipOut + 0.25
  const prevHead = S.headline(zw('还没按回车，|答案|就来了。'), '单位、颜色、计算，样样都行。', { raw: true })
  S.revealWords(prevHead, T.prev)
  subIn(prevHead.querySelector('.t-sub'), T.prev + 0.35)
  const unitEnd = retypeIme(T.prev + 0.1, '68°F to °C'.length, 22, [[0, '6'], [1, '8'], [4, '华氏度'], [6, '转'], [9, '摄氏度']])
  view('unit', unitEnd + 0.15, 0.35)
  S.sfx(unitEnd + 0.15, 'pop')
  T.color = unitEnd + 1.15
  const colorEnd = retype(T.color, '#409eff', 22)
  view('color', colorEnd + 0.15, 0.35)
  S.sfx(colorEnd + 0.15, 'pop')
  T.prevOut = colorEnd + 1.0
  S.conceal(prevHead, T.prevOut, { dur: 0.3 })

  // S6c — Ask AI: a widget inside the box; the footer steps aside for it
  T.ai = T.prevOut + 0.25
  const aiHead = S.headline(zw('问 AI，|就在|这里。'), '输入「ai」，再加上你的问题。', { raw: true })
  S.revealWords(aiHead, T.ai)
  subIn(aiHead.querySelector('.t-sub'), T.ai + 0.35)
  const aiFoot = S.footnote('使用智能问答，需要先在设置中添加 AI 提供商。')
  footIn(aiFoot, T.ai + 0.3)
  const askEnd = retypeIme(T.ai + 0.05, 'ai plan a weekend in Tokyo'.length, 26,
    [[0, 'a'], [1, 'i'], [2, ' '], [8, '规划'], [12, '一个'], [19, '东京'], [25, '周末']])
  T.widget = T.ai + 0.2 + 3 / 26 + 0.1
  view('ai', T.widget, 0.45)
  footerAt(T.widget, -1)
  fhEntries.push([T.widget, -1])
  tl.to(S.footer, { height: 0, opacity: 0, duration: 0.3, ease: 'power2.inOut', immediateRender: false }, T.widget)
  S.sfx(T.widget, 'swish')
  T.ask = askEnd + 0.22
  S.hudKeys(T.ask, ['↵'], 0.5)
  const [aiEmpty, aiList] = ai.children
  const [msgYou, msgAi] = aiList.children
  const aiStatus = msgAi.querySelector('.ais')
  tl.to(aiEmpty, { opacity: 0, y: -10, duration: 0.2, ease: 'power2.in', immediateRender: false }, T.ask + 0.02)
  tl.fromTo(msgYou, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.3, ease: 'power3.out', immediateRender: false }, T.ask + 0.06)
  tl.fromTo(msgAi, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.3, ease: 'power3.out', immediateRender: false }, T.ask + 0.3)
  S.sfx(T.ask + 0.3, 'pop')
  const toks = [...msgAi.querySelectorAll('.tk')]
  const STREAM0 = T.ask + 0.45
  const STREAM1 = STREAM0 + 1.0
  let shown = -1
  S.frameFns.push((t) => {
    const k = t < STREAM0 ? 0 : Math.min(toks.length, Math.floor(((t - STREAM0) / (STREAM1 - STREAM0)) * toks.length) + 1)
    if (k !== shown) {
      toks.forEach((e, i) => { e.style.opacity = i < k ? 1 : 0 })
      shown = k
    }
  })
  tl.to(aiStatus, { opacity: 0, duration: 0.2, ease: 'power2.in', immediateRender: false }, STREAM1 + 0.05)
  T.aiOut = STREAM1 + 0.7
  S.conceal(aiHead, T.aiOut)
  footOut(aiFoot, T.aiOut)
  cbHide(T.aiOut + 0.05)
  tl.set(S.footer, { height: 44, opacity: 1 }, T.aiOut + 0.4)
  fhEntries.push([T.aiOut + 0.4, 0])

  // S7a — and much more: a wall of features drifting in depth
  T.more = 36.0
  const moreHead = S.headline(zw('还有|更多。'), [], { big: true, top: 172, raw: true })
  S.revealWords(moreHead, T.more)
  tl.set(marq, { opacity: 1, y: 0, filter: 'blur(0px)' }, T.more)
  tl.fromTo(mchips, { opacity: 0, z: -460, y: 46, rotationX: 34, transformPerspective: 1200, filter: 'blur(10px)' },
    { opacity: 1, z: 0, y: 0, rotationX: 0, filter: 'blur(0px)', duration: 0.7, ease: 'expo.out', stagger: { each: 0.022, from: 'center' } }, T.more + 0.12)
  S.sfx(T.more + 0.12, 'cascade', { n: 12, step: 0.045 }) // one run up the scale across the whole cascade
  // the Chinese rows are shorter (2020/2323/2183 px against 2141/2408/2481): same speed, shifted so no row ends in frame
  const DRIFT = [[0, -330], [-400, -70], [-60, -390]]
  mrows.forEach((r, i) => tl.fromTo(r, { x: DRIFT[i][0] }, { x: DRIFT[i][1], duration: 2.9, ease: 'none' }, T.more))
  const moreFoot = S.footnote('部分功能由官方插件提供。')
  footIn(moreFoot, T.more + 0.3)

  // S7b — the ecosystem: docs, components, SDKs, CLI, store
  T.eco = 38.4
  // fly through the wall: it swells and blurs past the viewer, the ecosystem comes up from depth
  S.conceal(moreHead, T.eco - 0.3, { dur: 0.3, scale: 1.08 })
  tl.fromTo(marq, { scale: 1, filter: 'blur(0px)' }, { scale: 1.28, opacity: 0, filter: 'blur(14px)', duration: 0.4, ease: 'power2.in', immediateRender: false }, T.eco - 0.35)
  footOut(moreFoot, T.eco - 0.3)
  S.sfx(T.eco - 0.3, 'whoosh', { dur: 0.6, pan: 0, soft: true })
  const ecoHead = S.headline(zw('自己动手，|做你的|插件。'), '文档、组件库、SDK，还有插件市场。', { top: 104, raw: true })
  S.revealWords(ecoHead, T.eco + 0.1)
  subIn(ecoHead.querySelector('.t-sub'), T.eco + 0.42)
  const ecoFoot = S.footnote('Tuff 以 MPL-2.0 协议开源。')
  footIn(ecoFoot, T.eco + 0.5)
  tl.fromTo(btiles, { opacity: 0, y: 110, z: -280, rotationX: 16, transformPerspective: 1600, filter: 'blur(12px)' },
    { opacity: 1, y: 0, z: 0, rotationX: 0, filter: 'blur(0px)', duration: 0.85, ease: 'expo.out', stagger: 0.07 }, T.eco + 0.05)
  S.sfx(T.eco + 0.05, 'cascade', { n: btiles.length, step: 0.07 })
  T.moreOut = 41.4
  tl.fromTo(bento, { scale: 0.985 }, { scale: 1.025, duration: T.moreOut - T.eco, ease: 'none' }, T.eco)
  // TuffEx: the components do what they do
  const [txSw, txSwKnob, txCb, txCheck, txPg, txSlFill, txSlKnob, txSegPlate] = ['.txsw', '.txsw i', '.txcb', '.txcb svg', '.txpg i', '.txsl em', '.txsl i', '.txseg em']
    .map((q) => bTuffex.querySelector(q))
  const seg = bTuffex.querySelector('.txseg')
  const segW = (seg.offsetWidth - 6) / 3
  tl.set(txSegPlate, { width: segW, x: 0 }, 0)
  tl.set(txPg, { scaleX: 0.18 }, 0)
  tl.set(txSlFill, { scaleX: 0.22 }, 0)
  const slW = bTuffex.querySelector('.txsl').offsetWidth
  tl.set(txSlKnob, { x: slW * 0.22 }, 0)
  const tx0 = T.eco + 0.85
  tl.to(txSwKnob, { x: 22, duration: 0.28, ease: 'power3.inOut' }, tx0)
  tl.to(txSw, { backgroundColor: '#409eff', duration: 0.28, ease: 'power2.out' }, tx0)
  tl.to(txCb, { backgroundColor: '#409eff', boxShadow: 'inset 0 0 0 1.5px #409eff', duration: 0.2, ease: 'power2.out' }, tx0 + 0.25)
  tl.to(txCheck, { scale: 1, duration: 0.3, ease: 'back.out(2.4)' }, tx0 + 0.3)
  tl.to(txPg, { scaleX: 0.82, duration: 1.6, ease: 'power2.inOut' }, tx0 + 0.1)
  tl.to(txSlFill, { scaleX: 0.7, duration: 0.9, ease: 'power3.inOut' }, tx0 + 0.45)
  tl.to(txSlKnob, { x: slW * 0.7, duration: 0.9, ease: 'power3.inOut' }, tx0 + 0.45)
  tl.to(txSegPlate, { x: segW, duration: 0.4, ease: 'power3.inOut' }, tx0 + 0.75)
  tl.to(txSegPlate, { x: segW * 2, duration: 0.4, ease: 'power3.inOut' }, tx0 + 1.45)
  // Docs: a page slides up into the corner, the link underlines itself
  tl.fromTo(bDocs.querySelector('.dpage'), { y: 120, rotation: 4 }, { y: 0, rotation: -8, duration: 0.8, ease: 'expo.out', immediateRender: true }, T.eco + 0.6)
  tl.to(bDocs.querySelector('.blink u'), { scaleX: 1, duration: 0.5, ease: 'power2.inOut' }, T.eco + 1.1)
  // SDKs: modules arrive one by one
  tl.fromTo(bSdk.querySelectorAll('.sdkp span'), { opacity: 0, y: 12, scale: 0.9 },
    { opacity: 1, y: 0, scale: 1, duration: 0.35, ease: 'back.out(1.8)', stagger: 0.06, immediateRender: true }, T.eco + 0.75)
  // CLI: three commands typed in turn
  bCli.querySelectorAll('.tl').forEach((line, i) => {
    const t0 = T.eco + 0.85 + i * 0.62
    const cmd = CLI[i]
    tl.set(line, { opacity: 1 }, t0)
    S.textTrack(line.querySelector('.tc'), [...cmd].map((_, j) => [t0 + 0.06 + j / 30, cmd.slice(0, j + 1)]))
  })
  // Store: plugins land on the shelf
  tl.fromTo(bStore.querySelectorAll('.shelf div'), { opacity: 0, y: 18, scale: 0.7 },
    { opacity: 1, y: 0, scale: 1, duration: 0.45, ease: 'back.out(1.7)', stagger: 0.07, immediateRender: true }, T.eco + 0.8)
  S.conceal(ecoHead, T.moreOut, { dur: 0.3 })
  tl.to(bento, { opacity: 0, filter: 'blur(10px)', duration: 0.3, ease: 'power2.in', immediateRender: false }, T.moreOut)
  tl.set(bento, { filter: 'blur(0px)' }, 0)
  footOut(ecoFoot, T.moreOut)
  tl.to('#glow', { opacity: 0.2, duration: 0.35, ease: 'power2.in', immediateRender: false }, T.moreOut)

  // S8 — end card, lands on the downbeat after a beat of silence
  T.end = 42.0
  const end = S.centerCard(`<img class="end-logo" src="logo.svg"><div class="t-hero">一搜即得。<span class="grad">一键即用。</span></div>
    <div class="ver">Tuff v2.4.14 现已推出。</div><div class="plat">macOS · Windows · Linux</div><div class="url">github.com/talex-touch/tuff</div>`, 'card center end')
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
  T.final = 46.0

  S.switchTrack(S.body, viewEntries)
  S.switchTrack(S.fl, flEntries)
  S.switchTrack(S.fh, fhEntries)
  S.classTrack(S.typedNode, 'sel', selEntries)

  // ---- measure the laid-out scene (camera still at identity, so rects are rig-local) ----
  const at = (t) => { tl.seek(t, false); window.__runTracks(t) }
  const rectOf = (el) => {
    const r = el.getBoundingClientRect()
    return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }
  }
  at(T.recZoom - 0.05)
  const recT = rec.tileEls.map(rectOf)
  at(T.moOut - 0.02)
  const moRects = moImgs.map(rectOf)
  at(T.flip + 1.1)
  const ydT = ydGrid.tileEls.map(rectOf)
  const ydIcons = ydImgs.map(rectOf)
  at(T.typoRow + 0.45)
  const typoIcon = rectOf(appTypo.rowEls[0].querySelector('.ic'))
  const range = document.createRange()
  range.selectNodeContents(appTypo.rowEls[0].querySelector('.ti'))
  const typoText = rectOf(range)
  at(T.morph + 0.9)
  const rowIcons = content.rowEls.map((r) => rectOf(r.querySelector('.ic')))
  at(STREAM1 + 0.1)
  const convo = rectOf(aiList)
  at(0)

  // Matched files fly into the result rows they become.
  matched.forEach((card, j) => {
    const c = XC[xcards.indexOf(card)]
    const dst = rowIcons[j]
    const t0 = T.morph + j * FLY_STEP
    tl.to(card, { x: dst.cx - c.cx, y: dst.cy - CARD_Y, z: 0, rotationY: 0, scale: dst.w / 350, duration: FLY, ease: 'power2.inOut', immediateRender: false }, t0)
    tl.to(card, { opacity: 0, duration: 0.14, ease: 'power1.in', immediateRender: false }, t0 + FLY - 0.12)
  })
  // Yesterday's icons fly into today's tiles and take their colour back on the way.
  flyIcons.forEach((ic, i) => {
    const a = moRects[i]
    const b = ydIcons[i]
    Object.assign(ic.style, { left: a.x + 'px', top: a.y + 'px', width: a.w + 'px', height: a.h + 'px' })
    const t0 = T.moOut + i * 0.07
    const land = t0 + 0.62
    tl.fromTo(ic, { opacity: 1, x: 0, y: 0, scale: 1, filter: MEM_TONE },
      { opacity: 1, x: b.x - a.x, y: b.y - a.y, scale: b.w / a.w, filter: NOW_TONE, duration: 0.62, ease: 'power3.inOut', immediateRender: false }, t0)
    tl.set(ic, { opacity: 0 }, land)
    tl.set(ydImgs[i], { opacity: 1 }, land)
    tl.to(ydGrid.tileEls[i], { scale: 1.06, duration: 0.09, ease: 'power2.out', immediateRender: false }, land)
    tl.to(ydGrid.tileEls[i], { scale: 1, duration: 0.3, ease: 'power2.inOut', immediateRender: false }, land + 0.09)
  })

  // ---- camera (origin fixed at the stage centre; focus() solves the translation) ----
  const focus = (P, s, C) => ({ s, x: C[0] - 960 - s * (P.cx - 960), y: C[1] - 540 - s * (P.cy - 540) })
  // S1: gentle push, close up on the first reason, then dolly left to right across all five
  const RZ = 1.95
  const r0 = focus(recT[0], RZ, [600, 600])
  const r1 = focus(recT[4], RZ, [1320, 600])
  S.camTo(T.cbIn, { s: 1.035 }, T.recZoom - T.cbIn, 'power1.inOut')
  S.camTo(T.recZoom, r0, 0.6, 'power3.inOut')
  S.camTo(T.recZoom + 0.6, r1, T.recOut - T.recZoom - 0.6, 'sine.inOut')
  S.camTo(T.recOut, { x: r1.x - 1900, bx: 46 }, 0.36, 'power2.in')
  S.sfx(T.recOut, 'whoosh', { dur: 0.8, pan: -1 })
  // S2: whip in on Keynote, whip across to Code
  S.camSet(T.ctx - 0.06, { s: 1, x: 1900, y: 0, bx: 46, by: 0 })
  S.camTo(T.ctx - 0.06, { x: 0, bx: 0 }, 0.45, 'expo.out')
  S.camTo(T.swap - 0.3, { x: -1900, bx: 46 }, 0.3, 'power2.in')
  S.sfx(T.swap - 0.3, 'whoosh', { dur: 0.75, pan: -1 })
  S.camSet(T.swap, { x: 1900, bx: 46 })
  S.camTo(T.swap, { x: 0, bx: 0 }, 0.45, 'expo.out')
  S.camTo(T.swap + 1.0, { s: 1.04 }, 0.9, 'power1.inOut')
  // S3: pull back into the memory, come forward for today, then read the three tiles left to right
  S.camTo(T.yd, { s: 0.94, x: 0, y: 0 }, 0.7, 'power2.out')
  S.camTo(T.flip, { s: 1 }, 0.5, 'power2.out')
  const YZ = 2.15
  const y0 = focus(ydT[0], YZ, [720, 640])
  const y1 = focus(ydT[2], YZ, [1200, 640])
  S.camTo(T.ydZoom, y0, 0.55, 'power3.inOut')
  S.camTo(T.ydZoom + 0.55, y1, T.ydOut - T.ydZoom - 0.55, 'sine.inOut')
  S.camTo(T.ydOut + 0.05, { y: y1.y - 1300, by: 46 }, 0.36, 'power2.in')
  S.sfx(T.ydOut + 0.05, 'whoosh', { dur: 0.75, pan: 0 })
  S.camSet(T.find - 0.04, { s: 1, x: 0, y: 0, bx: 0, by: 0 })
  // S4: close in on the typo result so the matched letters read, then push through
  const typoFocus = { cx: (typoIcon.x + typoText.x + typoText.w) / 2, cy: typoText.cy + 4 }
  const TZ = 2.1
  S.camTo(T.typoRow + 0.12, focus(typoFocus, TZ, [960, 600]), 0.6, 'power3.inOut')
  S.camTo(T.typoRow + 0.72, focus(typoFocus, TZ * 1.04, [960, 600]), T.findOut - T.typoRow - 0.72, 'none')
  S.camTo(T.findOut, { s: TZ * 1.04 * 1.2, bx: 8, by: 8 }, 0.4, 'power2.in')
  S.camSet(T.content - 0.03, { s: 1, x: 0, y: 0, bx: 0, by: 0 })
  // S5: drift into the cards while the beam runs, hold still for the morph, push on the results
  S.camTo(T.content + 0.6, { s: 1.03, y: 10 }, T.morph - 0.35 - T.content - 0.6, 'power1.inOut')
  S.camTo(T.morph - 0.35, { s: 1, y: 0 }, 0.3, 'power2.inOut')
  S.camTo(T.morph + 0.65, { s: 1.045 }, T.contentOut - T.morph - 0.65, 'power1.inOut')
  S.camSet(T.clip - 0.03, { s: 1, x: 0, y: 0, bx: 0, by: 0 })
  // S6: still while the copied text flies, then a slow push on the answer, carried through the previews
  S.camTo(T.land + 0.5, { s: 1.04 }, T.clipOut - T.land - 0.5, 'power1.inOut')
  S.camTo(T.prev, { s: 1.07 }, T.prevOut - T.prev, 'sine.inOut')
  // S6c: settle back as the widget opens, then lean into the conversation
  S.camTo(T.widget, { s: 1, x: 0, y: 0 }, 0.45, 'power2.inOut')
  S.camTo(T.ask + 0.1, focus(convo, 1.12, [960, 560]), T.aiOut - T.ask - 0.1, 'sine.inOut') // stays clear of the footnote
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
  window.__focus = { recT, ydT, ydIcons, moRects, typoFocus, rowIcons, convo }
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
