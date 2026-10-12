# v2.4.14 X 宣传片

2026-10-11 为 v2.4.14 做的 X（Twitter）视频，迭代了三版，v3 是终版。工具与命令见[上级 README](../../README.md)。

| 版本 | 时长 | 页面与脚本 | 变化 |
| --- | --- | --- | --- |
| v1 | 37.25 s，无声 | `v1.html`：`scene.js`（v1 运行时）+ `story.js` | 第一版 |
| v2 | 34 s，配乐 | `v2.html`：`kit/scene2.js` + `story2.js`，cue 表 `cues2.json` | 节奏加快，加配乐、运镜和「昨天」一幕 |
| v3 | 46 s，配乐 | `v3.html`：`kit/scene2.js` + `scene3.css` + `story3.js`，cue 表 `cues3.json` | 开场推荐改为从左到右运镜，「昨天」改用生活和设计的例子，加回搜索高亮，补上 widget 与即时预览，结尾生态做成便当格并停留更久 |

成片不入库，v3 约 25 MB，按上级 README 的命令可以重新渲染。`music.py` 同时能渲染 v2 和 v3 的配乐：cue 表带 `version: 3` 时，在 `T.more`（功能墙开场）多一记镲。

## v3 分镜

时刻取自 `cues3.json` 的 `T`，单位为秒。

| 时刻 | 段落 | 画面 | 文案 |
| --- | --- | --- | --- |
| 0–2 | 开场 | 「One shortcut.」和 ⌥ Space 按键 | 脚注：Alt + Space on Windows and Linux |
| 2–5.6 | 推荐 | CoreBox 弹出；先特写第一个理由徽标，再从左到右扫过全部磁贴 | It knows what you need. / Before you type a single letter. |
| 6–9.8 | 应用上下文 | 从 Keynote 切到 VS Code，推荐随之变化 | Different app. Different picks. / Suggestions follow the app you’re in.；脚注：App context is available on macOS. |
| 10–15 | 昨天 | 昨天 9:05 听歌、9:41 修图、9:58 写代码；今天同一时段，三个应用回到磁贴，徽标显示「Yesterday HH:MM」 | Yesterday → This morning / It remembers what you used yesterday. |
| 15.5–19.3 | 查找 | 边输入边出结果；输错成 `chorme` 也能召回 Google Chrome，匹配字母高亮 | Find anything. Fast. / Results appear as you type. / Even if you mistype an app. |
| 19.75–24.3 | 内容搜索 | 五个纯文本文件被「X 光」扫过，提到 webhook 的三个亮起，飞进结果行 | Search inside files. / Not just names. The words in them.；脚注：Off by default. Turn on “Index File Contents” in Settings. |
| 24.75–28.3 | 剪贴板 | 复制的文字飞进搜索框 | Copy. Summon. Done. / What you just copied is already there.；脚注：Works with anything copied in the last 5 seconds. You can change this in Settings. |
| 28.55–31.8 | 即时预览 | 单位换算、颜色、算式卡片 | Answers as you type. / Units, colors, math and more. |
| 32–35.6 | Ask AI | widget 在框内打开，只画对话本身 | Ask AI. Right here. / Type “ai” and your question.；脚注：Ask AI needs an AI provider. Add one in Settings. |
| 36–41.4 | 生态 | 功能墙从眼前掠过，接着是 TuffEx、Docs、SDKs、CLI、Plugin Store 便当格 | And much more. → Build your own. / Docs, components, SDKs and a plugin store.；脚注：Some features come from official plugins. 以及 Tuff is open source under MPL-2.0. |
| 42–46 | 结尾 | 标志、Find it. Run it.、版本号、平台和网址 | Tuff v2.4.14 is out now. / macOS · Windows · Linux / github.com/talex-touch/tuff |

## 核实记录

每句文案都对照 v2.4.14 的代码核实过。下面这些地方容易写错，有几处就被代码打脸过：

- **输错字**：只有应用名能召回，靠的是内存里的应用目录；文件名不行（审计 B9）。所以画面只演应用名，不能泛泛写「Even with typos」。
- **算式**：`1280 * 0.85`（半角 `*`）由 basic 算式能力处理（priority 10，先于 advanced 的 15），卡片上没有 `safe-parser` 徽标。
- **预览卡底栏**：预览卡没有 basic render，底栏是拼图图标 + 「CoreBox」+「System」，提示是「↵ Open · ⌘K Actions · ⌘1-0 Quick Select」。v2 曾画成「↵ Execute」，是错的。
- **磁贴徽标**：网格磁贴的徽标显示理由文字，如「Yesterday 09:12」「Often from Xcode」。磁贴有 `min-width: 0`，长应用名会被省略号截断。
- **「昨天」一幕**：推荐信号里没有「先 A 后 B」的顺序信号。这一幕只能演「昨天这个时段用过」，前后一小时内执行过就算，加上今天的「Yesterday HH:MM」理由；不能说成学会了操作顺序。
- **限制条件**：已写进脚注和回复推文。
  - 应用上下文仅 macOS。
  - 文件内容搜索默认关闭，只解析纯文本。
  - 剪贴板自动带入有 5 秒窗口，可调。
  - Ask AI 需要先配置 AI provider。
- **v2.4.14 英文界面里只有中文的地方**：所以画面避开。
  - 插件 feature 名没有英文。
  - 计算、单位、颜色预览卡的副标题徽标、部分标签和明细行写死中文，只画语言中性的字段。
  - Ask AI widget 的模型工具栏、「AI 正在生成」提示、「复制回答 / 替换选中文本」按钮只有中文，只画对话本身。
  - 本地化修复在 `37f8c7d9a`（插件 feature 名）和 `b95b213e5`（预览能力与结果卡）里，没有进 v2.4.14。

## 推文

按 twitter-text 权重计数。

主推（266）：

```text
Tuff v2.4.14 is out.

One shortcut. It knows what you need, what you used this time yesterday, and the app you're in.

Find files, even by the words inside them. What you copied is already there. Units, colors, math and AI, right in the box.

https://github.com/talex-touch/tuff/releases
```

回复一（276）：

```text
Good to know:
- App-aware picks: macOS for now.
- Search inside files is off by default. Turn on "Index File Contents" in Settings. Plain text for now.
- Typos are forgiven in app names.
- Copies show up if you open Tuff within 5 s (adjustable).
- Ask AI needs an AI provider.
```

回复二（201）：

```text
Want to build on it? Tuff is open source (MPL-2.0).

- TuffEx: UI components for Vue 3
- Typed SDKs for plugins
- Tuff CLI to create, test and publish
- Docs and a plugin store

https://tuff.tagzxia.com
```
