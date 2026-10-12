# 宣传片工具包

用 HTML/CSS/GSAP 复刻 CoreBox 界面，按时间轴逐帧渲染成片，再用代码合成配乐。画面只由时间决定，同一份源稿任何时候都能重新渲染出同一部片子。

v2.4.14 的 X（Twitter）宣传片就是用它做的，源稿、分镜、文案与核实记录在 [`episodes/2.4.14/`](./episodes/2.4.14/README.md)。下一部片子从那里复制起步。

## 目录

| 路径 | 内容 |
| --- | --- |
| `kit/scene.css` | 基础样式：舞台、光晕、CoreBox、列表行、磁贴、标题卡 |
| `kit/scene2.css`、`kit/scene2.js` | 当前运行时：相机 rig、图层与时间轴工具，见下文「运行时」 |
| `kit/icons.js` | 从工作区 iconify 图标集抽出的子集 |
| `kit/logo.svg`、`kit/vscp.svg` | Tuff 标志、VS Code Projects 插件图标 |
| `kit/render.mjs`、`kit/shoot.mjs`、`kit/probe.mjs` | 渲染成片、截静帧、在指定时刻求值；共用 `kit/cdp.mjs` |
| `kit/add-icons.cjs` | 往 `kit/icons.js` 追加 iconify 图标 |
| `kit/export-icons.swift` | 从本机导出第三方应用图标和文件类型图标 |
| `episodes/<版本>/` | 一部片子的页面、分镜脚本、专属样式、配乐脚本、cue 表和文案 |

以下内容不入库，见 `.gitignore`：

- 第三方图标：`kit/icons/`、`kit/icons-light/`。版权归各自所有者，在本机导出。
- `kit/gsap.min.js`：工具首次运行时从工作区的 gsap 包复制过来。
- 静帧、配乐 WAV 和成片：都能从源稿重新生成。

## 环境

- macOS。图标导出依赖 AppKit 和 `sips`。
- Google Chrome，路径不同时用环境变量 `CHROME` 指定。
- 已完成 `pnpm install`：gsap 和 iconify 图标集从工作区解析。
- `ffmpeg`。
- 配乐需要 Python 3、numpy 和 scipy。

## 快速开始

以下命令都在 `docs/marketing/promo-video/` 下执行。

```bash
# 1. 第一次使用：导出图标
swift kit/export-icons.swift

# 2. 截静帧审片，输出到 shots/t-2.70.png 等
node kit/shoot.mjs episodes/2.4.14/v3.html 2.7,13.9,29.8 0.5

# 3. 渲染画面，60 fps；v3 全片 2760 帧约 2.5 分钟（M4 Pro）
nice -n 10 node kit/render.mjs episodes/2.4.14/v3.html /tmp/v3-video.mp4 60

# 4. 合成配乐（种子固定，重跑逐位一致）
python3 episodes/2.4.14/music.py episodes/2.4.14/cues3.json /tmp/v3-music.wav

# 5. 混流，并补上 BT.709 色彩标签
ffmpeg -i /tmp/v3-video.mp4 -i /tmp/v3-music.wav -map 0:v:0 -map 1:a:0 -c:v copy \
  -bsf:v h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0 \
  -c:a aac -b:a 256k -ar 48000 -shortest -movflags +faststart /tmp/tuff-v2.4.14-x-v3.mp4
```

`render.mjs` 还接受起止时间，例如 `... 60 5.5 6.5` 只渲染这一秒，用来快速看一段运镜。

想在浏览器里交互预览，先跑一次任意工具，让 `kit/gsap.min.js` 就位。然后用 Chrome 打开 `episodes/2.4.14/v3.html`，在控制台执行 `__seek(12.6)`。

## 运行机制

- 页面加载后，分镜脚本的 `build()` 把所有元素和 tween 挂到一条暂停的 GSAP 时间轴 `S.tl` 上，时间都是绝对秒数。
- 工具只通过三个全局变量驱动页面：
  - `__ready`：一个 promise，等字体和图片加载完再 build。
  - `__duration`：全片时长。
  - `__seek(t)`：执行 `tl.seek(t, false)`，再跑每帧轨道 `__runTracks(t)`。
- 不依赖真实时钟，所以渲染快慢不影响成片，任意一帧都能单独复现。
- `render.mjs` 逐帧截 JPEG，直接用管道交给 ffmpeg，帧不落盘。
- 节拍是 120 BPM：一拍 0.5 s，一小节 2 s。重要的出现落在拍点上，配乐的和弦也按这个网格排。
- 分镜把关键时刻写进 `window.__T`，音效 cue 写进 `window.__cues`（`S.sfx(t, kind)`），配乐脚本读这两样。
- 分集页面带 `<base href="../../kit/">`：样式、脚本、图标等相对路径都从 `kit/` 解析，分集自己的文件写成 `../episodes/<版本>/…`。

### 分镜脚本的约定

新片子复制 `episodes/2.4.14/v3.html`、`story3.js`、`scene3.css` 和 `music.py`，改掉页面里的分集路径。脚本末尾必须照 `story3.js` 那样定义：

```js
window.__T = T
window.__seek = (t) => { S.tl.seek(t, false); window.__runTracks(t) }
window.__ready = (async () => {
  await document.fonts.ready
  // ……等图片加载……
  build()
  window.__duration = T.final
  return true
})()
```

### 运行时（`const S = window.__scene`）

| 分组 | 成员 |
| --- | --- |
| 图层 | `stage`；`rig`（随相机移动的产品层，内含 `winLayer`、`fxBack`、`cam`、`fxFront`）；`topLayer`（屏幕空间的标题与脚注） |
| 时间轴 | `tl`：暂停的主时间轴，所有 tween 都按绝对时间挂上去 |
| 元素 | `h(tag, cls, html)`；`svg('ri:time-line')` 取 `icons.js` 里的图标；`app('mail')` 对应 `icons-light/mail.png`；`ft('type-md')` 对应 `icons/type-md.png` |
| 每帧轨道 | `textTrack(node, [[t, html]])`、`classTrack(node, cls, [[t, on]])`、`switchTrack(container, [[t, 子元素序号]], fade = 0.14)`；`frameFns.push(t => …)` 做程序化的逐帧更新 |
| 出场 | `reveal(node, at, { y, blur, dur, scale, ease })`、`conceal(node, at, …)`、`revealWords(card, at, { step, y, blur, dur })`（逐词，返回结束时刻） |
| 相机 | `camState`：`x y s rx ry ox oy`，`bx by` 是运动模糊；`camTo(at, props, dur, ease)`、`camSet(at, props)` |
| 光晕 | `glowState`：`cx cy spread` |
| CoreBox | `cbWrap cb header body footer fl fh typedNode inputNode tagSlot`；`addView(name, node)` 与 `views`；输入用 `typeInto(t0, [[dt, 文本或 null]])`、`typeChars(t0, text, cps = 12)`、`clearInput(t0)`，占位符用 `phState` |
| 界面部件 | `badge(kind, text, count)`，kind 取 `frequent timeBased yesterday appContext recent newFile`，与 `recommendation-presentation.ts` 一致；另有 `tile({…})`、`row({…})`、`footerItem({…})`、`hints([[键, 说明]])` |
| 文案 | `headline(main, subs, { big, raw, top })`、`centerCard(html, cls)`、`footnote(text)`；开场卡 `hook`；按键浮层 `hudKeys(at, keys, dur, sound)` |
| 音效与工具 | `sfx(t, kind, opts)`、`clamp`、`current` |

## cue 表与配乐

时间轴一改，就重新导出 cue 表，并和旧文件 diff：

```bash
node kit/probe.mjs episodes/2.4.14/v3.html 0 "return {version: 3, T: window.__T, cues: window.__cues}" 2>/dev/null \
  | sed 's/^0 //' > episodes/2.4.14/cues3.json
```

- `music.py` 用 numpy/scipy 合成，种子固定，重跑结果逐位一致。
- 和弦进行与 build 小节由 `T.end` 推出，音效由 cue 触发。
- 母带目标：BS.1770 积分响度 −14 LUFS，真峰值限幅 −1.6 dBTP，编成 AAC 256k 后仍不超过 −1 dBTP。
- `music.py` 读 2.4.14 分镜的几个时刻：`cbIn`、`yd`、`flip`、`scan`、`more`、`moreOut`、`end`、`final`。分镜换了，这几处要跟着改。

`probe.mjs` 也是排查工具：在指定时刻求值任意函数体，例如 `node kit/probe.mjs episodes/2.4.14/v3.html 6,8 "return window.__scene.camState"`。

## 成片核查

```bash
# 应为 yuv420p、tv，三项 bt709
ffprobe -v error -show_entries stream=codec_name,pix_fmt,color_range,color_space,color_primaries,color_transfer -of compact out.mp4

# 应约为 −14 LUFS，峰值不超过 −1 dBTP
ffmpeg -hide_banner -nostats -i out.mp4 -map 0:a -af ebur128=peak=true -f null - 2>&1 | grep -E "I:|Peak:"
```

- 用 `shoot.mjs` 按 0.25 倍截二十来张静帧拼成联系表，通看一遍。
- `switchTrack` 切换时有 0.14 s 交叉淡入，正好截在切换点的帧会同时出现两张卡，这是正常的。
- 带模糊滤镜的帧在两次运行之间会有少量像素值差异。核对静帧时比较差值，不要比较字节。

## 踩过的坑

- GSAP `fromTo` 里只出现在 from 中的属性，靠惰性 startAt 生效，seek 驱动的帧里可能不渲染。to 里也要写上。
- 新样式层的类名会和旧层撞名：v3 的 `.bt` 曾把徽标文字全藏了。新增样式文件前，先用脚本比对选择器和已有 markup 的类名。
- 先在 CoreBox 隐藏时切到下一幕的视图，再让它弹出。否则弹出时会交叉淡出上一幕的磁贴。
- `#cbWrap` 放大了 1.6 倍，它的 `top` 也会被放大，见 `story3.js` 的 `CB_TOP`。
- Chrome 截出的 JPEG 是全范围 BT.601。`render.mjs` 已做转换，混流时要用 `h264_metadata` 补 BT.709 标签，否则播放器会按 yuvj420p/pc 处理，黑位发灰。

## 文案与核实

- 用普通人一看就懂的简单英文，让动画本身把意思讲清楚，不依赖语言。
- 节奏和运镜参考 Apple 发布会和微软宣传片。
- 例子要生活化，比如听歌、修图，不能只举程序员的例子。
- 每句文案都对照发布 tag 的代码核实，限制条件写进脚注和回复推文。没有实测依据的延迟数字不写。
- 只画目标语言下界面真实显示的内容。2.4.14 英文界面里仍有只显示中文的地方，清单见分集 README。
- 做别的语言版本时，复制分镜脚本只换文案，时间轴和 cue 不动，配乐就能共用。2.4.14 中文版的做法和中文特有的坑（输入法节奏、标题分块、全文检索分词）见分集 README。

推文按 twitter-text 权重计数，上限 280：

- URL 一律算 23。
- U+2022「•」、「⌥」这类字符算 2。
- 英文和弯引号「’」算 1。所以列表用「-」更省字数。

## 图标

- `swift kit/export-icons.swift` 导出两类图标：
  - 应用图标写进 `kit/icons-light/<name>.png`。取的是包里 `.icns` 经 `sips` 缩放的浅色原图。`NSWorkspace.icon(forFile:)` 在深色模式下会返回深色图标，不管进程强制什么外观，所以只给标了 `system` 的应用使用。
  - 文件类型图标写进 `kit/icons/<name>.png`。
- 需要新的应用时，把它加进脚本里的列表，再用 `S.app('<name>')` 引用。
- iconify 图标用 `node kit/add-icons.cjs ri:time-line logos:vue` 追加。从 `apps/core-app` 和 `apps/nexus` 能解析的图标集有 `ri`、`carbon`、`simple-icons`、`logos`、`cib`、`twemoji`。

## 共享机器

- 渲染属于重任务，用 `nice -n 10` 跑。
- 三个工具分别占用端口 9237、9238、9239，Chrome 配置目录放在系统临时目录下的 `tuff-promo-<工具名>`。
- 同一时间只跑一个渲染。
