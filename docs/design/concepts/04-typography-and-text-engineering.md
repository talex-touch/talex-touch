# 第四篇：排版美学、字体工程与排版节奏 (Typography & Text Engineering)

> 涵盖章节：第 18 章 ～ 第 22 章  
> 核心主题：13–14px 生产力基准与高密度排版；等宽代码 0.9em 光学调和；现代软换行与孤字终结；零字距铁律与多语言节拍。

---

## 第 18 章：13–14px 界面基准与字阶梯层级

### 18.1 生产力工具 vs 营销网页的认知差异

许多从营销官网、博客或消费级 App 转入桌面工具的开发者，喜欢将正文字号设为 16px 甚至 18px。
在内容型生产力工具（如 IDE、系统级启动盘、数据分析面板）中，这是极其严重的体验倒退：

1. **视野扫读广度（Foveal Vision Window）**：人眼中央凹视力最佳区域大约为视场角 2 度。过大的字号导致一屏内能同时容纳的实体信息急剧缩水，用户需要反复移动视线，导致眼肌疲劳。
2. **信息关联密度（Proximity of Related Context）**：参数、标签、输入框与错误反馈必须在视野内紧凑锚定。过大字号强制拉开间距，破坏了格式塔心理学中的“接近律”（Law of Proximity）。

### 18.2 TuffEx 字阶梯标准

在 TuffEx 整个组件库中，字号分布严格锁定在以下阶梯：

```
Micro-labels (微标签 / 徽标): 10px ~ 11px  (全大写 / 纯数字 / 仅作视觉修饰)
Secondary (辅助说明 / 灰色提示): 12px      (严格限于非关键信息)
Body / Controls (主正文 / 操作控件): 13px ~ 14px (用户阅读与操作的主战场)
Headings (分组标题 / 模块标题): 16px ~ 18px (结构分割点)
Display (大尺寸数值指标): 24px ~ 32px     (核心监控大屏与统计数字)
```

> **铁律原则**：任何需要使用 16px 呈现正文内容的业务组件，必然是其**信息层级架构出现了严重混乱**。解决办法是梳理层级，而不是调大字号。

---

## 第 19 章：无衬线与等宽字体的 X 高度调和

### 19.1 为什么内联代码必须设为 `0.9em`？

在专业界面中，技术术语与代码标识通常以行内代码块（`<code>` 或 `<kbd>`）形式混排在正文中。
无衬线 UI 字体（如 San Francisco、Inter）与等宽字体（如 JetBrains Mono、Fira Code、SF Mono）在字体设计度量衡（Font Metrics）上存在根本差异：

```
UI 无衬线字体 (Inter / SF Pro):
X 高度 (x-height) 适中，字宽紧凑，基线稳定。

等宽编程字体 (JetBrains Mono):
为了保证编程时的清晰可辨，等宽字体刻意拉大了字腔，其 X 高度通常比同字号无衬线字体高出 12% ～ 18%！
```

如果内联代码块直接使用 `font-size: 1em`（继承 100%）：
* 代码文字在视觉上会**生硬地向外凸起**，犹如正文中的突兀补丁。
* 行高会被上下顶开，破坏整段文字原本匀称的行间呼吸节奏（Vertical Rhythm）。

### 19.2 TuffEx 解决方案

```scss
// TuffEx 标准行内代码样式
.tx-prose code,
.tx-inline-code {
  font-family: var(--tx-font-family-mono);
  // 严格缩放至 0.9em，抹平等宽字体的 X 高度膨胀
  font-size: 0.9em;
  padding: 0.15em 0.35em;
  border-radius: 4px;
  background-color: var(--tx-fill-color-light);
  // 微调基线，使中西文与代码符号垂直居中绝对对齐
  vertical-align: baseline;
}
```

---

## 第 20 章：现代软换行与孤字规避 (`text-wrap: pretty` & `balance`)

### 20.1 孤字（Orphans）的视觉折磨

在窄屏容器或卡片中，段落末尾经常出现极其尴尬的一幕：**最后一个标点或一个单字独自落在一行**。
在传统排版学中，这被称为孤行/孤字（Orphan）。它打破了段落底部的视觉重量平衡，导致右下角空落落，显得极其粗糙业余。

以往的前端做法有两种极端：
* 极端 A：放任不管，任由单字孤悬。
* 极端 B：在字符串层面通过 JavaScript 强行在最后两个词之间插入 `&nbsp;` 或硬换行 `<br>`。
  * **灾难性后果**：一旦用户调整窗口大小，硬编码的换行符会将当前宽度的排版固化进文档流，在更宽或更窄的屏幕上直接引发异常折行！

### 20.2 浏览器原生软换行（CSS Text Module Level 4）

从 Chrome 117 与 Safari 17.4 开始，现代浏览器正式实现了基于动态规划的智能断行算法。TuffEx 将其确立为核心排版标准：

```scss
// 1. 标题与短提示（≤6 行）：追求每行字数均衡对称
.tx-card__title,
.tx-modal__title,
.tx-heading {
  text-wrap: balance;
}

// 2. 长段落正文、卡片描述：追求终结孤字、优先版面优雅
.tx-prose p,
.tx-description,
.tx-help-text {
  text-wrap: pretty;
}
```

* `text-wrap: balance`：浏览器通过多轮计算，寻找行宽方差最小的最优解，使标题呈现和谐的倒梯形或对称形态。
* `text-wrap: pretty`：专门针对末尾孤字进行优化。如果发现段末只剩下一个单字，排版引擎会自动将上一行的倒数第二个词拉至新行，保持双字或多字收尾。

> **流式生成例外**：在 AI 流式输出中（如 `TxStreamText`），正在接收 Token 时保持 `text-wrap: wrap`；当段落彻底生成完毕后，再无缝切换为 `pretty`，防止流式输出过程中每输出一个词都触发全局排版重算。

---

## 第 21 章：字距调整禁忌：正文零 Tracking 铁律

### 21.1 随意调整 `letter-spacing` 的危害

许多初级开发者为了追求所谓的“呼吸感”或“设计感”，喜欢在普通正文上加 `letter-spacing: 1px` 或 `0.05em`。
世界顶级字体厂商（如 Monotype、Apple Typography Group）耗费数年时间校准字体的字偶间距表（Kerning Pairs，如 `AV`、`To`、`We` 的微缩补偿）。
一旦声明了全局 `letter-spacing`：
* 字体的字偶互锁机制瞬间被全部强制瓦解！
* 字母与汉字之间的连贯感知断裂，人脑阅读速度暴跌 20% 以上。

### 21.2 TuffEx 仅有的三类字距豁免

在 TuffEx 体系中，正文严禁触碰 `letter-spacing`。仅允许在以下三种极端几何场景下使用：

1. **≤11px 的全大写微型标签（Uppercase Micro-labels）**：
   全大写拉丁字母字腔方正密集，在极小尺寸下笔画易糊在一起。
   * 例如：`TxSidebarNav` 章节头 `letter-spacing: 0.08em`。
2. **≥20px 的巨大展示数字（Display Numerals）**：
   大号数字因笔画粗大，默认设置显得松垮。
   * 例如：`TxInsightMetric` `letter-spacing: -0.01em`（微负字距紧凑收拢）。
3. **用户头像缩写（Avatar Initials）**：
   此时文字本质上是几何居中图标，非连续阅读文本。

---

## 第 22 章：跨语言与中西文混排节奏

### 22.1 中西文之间的“半角空格”纪律

在中文技术语境下，汉字是全宽方块字（Em-square），拉丁字母与数字是变宽比例字。两者直接贴在一起会产生严重的字谷挤压。

* **错误**：`运行5个Docker容器在macOS上。`（毫无间隙，极其局促）
* **错误**：`运行　５个　Ｄｏｃｋｅｒ容器在　ｍａｃＯＳ上。`（使用全角字母数字，丑陋不堪）
* **正确**：`运行 5 个 Docker 容器在 macOS 上。`（中西文、数字之间保留一个半角空格）

### 22.2 系统字体回退链的严密顺序

```scss
// TuffEx 标准无衬线字体栈
--tx-font-family: 
  -apple-system,              // macOS / iOS 最新系统字体 (San Francisco)
  BlinkMacSystemFont,         // Chrome on macOS 回退
  "SF Pro Text",              // 明确指定的 SF
  "Segoe UI",                 // Windows 现代字体
  system-ui,                  // 现代 W3C 标准系统字体
  "PingFang SC",              // macOS 简体中文首选 (苹方)
  "Hiragino Sans GB",         // macOS 早期中文回退 (冬青黑体)
  "Microsoft YaHei",          // Windows 简体中文 (微软雅黑)
  sans-serif;                 // 最终兜底

// 等宽代码字体栈
--tx-font-family-mono:
  "JetBrains Mono",           // 专业开发环境首选
  SFMono-Regular,             // macOS 原生等宽
  Consolas,                   // Windows 经典等宽
  Menlo,                      // macOS 经典等宽
  monospace;
```
这一优先级保证了在任何操作系统下，优先由原生排版引擎的高精度字体接管渲染，消除非矢量毛刺与字符变形。
