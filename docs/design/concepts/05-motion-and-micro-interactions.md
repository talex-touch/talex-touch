# 第五篇：微动态、物理弹簧与交互节拍 (Motion & Micro-interactions)

> 涵盖章节：第 23 章 ～ 第 30 章  
> 核心主题：生产力工具的微动效纪律；Sub-100ms 瞬时悬停；90ms+90ms 确认节拍；合成器线程铁律；物理弹簧与双 Keyframe 重播技巧。

---

## 第 23 章：为什么要做“小 motion”：生产力工具的响应纪律

### 23.1 宣传片动效 vs 生产力工具动效的本质对立

在概念宣传片或游戏界面中，动效往往追求大开大合（剧烈的全屏位移、炫目的粒子爆发、长达 800ms 的翻转卡片）。
然而在桌面端高频生产力工具（如 Tuff、IDE、操作系统）中，用户一天要点击上千次，进行数百次快捷操作。
**如果一个按钮每次点击都要耗费 400ms 做弹性回弹，用户的大脑在感知层面会被严重拖慢，产生烦躁的“滞后阻碍感”**。

### 23.2 TuffEx 微动效（Micro-motion）核心守则

TuffEx 提出的动效哲学是：**“动效是空间锚点，绝非娱乐表演”**。
1. **连续性（Continuity）**：动效存在的唯一正当理由，是告诉用户的视线“东西是从哪里出来的、收拢到了哪里去”，保持心智模型的空间连续性。
2. **极短驻留（Ultra-brief Residence）**：绝大部分微交互时间被压缩在 **90ms ～ 180ms** 之间。
3. **零等待（Non-blocking）**：动效播放绝不可阻断下一次点击或键盘输入。

---

## 第 24 章：瞬时悬停原则：Sub-100ms 交互防迟滞

### 24.1 严禁在 Hover 上过渡颜色

在很多 Web 前端项目中，开发者喜欢偷懒写下：
```scss
// 严重违规的反模式！
.btn {
  transition: all 0.3s ease; // 严禁！
}
```
当鼠标指针滑过一排按钮或列表项时，所有按钮的背景色与文字颜色慢吞吞地淡入淡出。在人脑反应时间（约 100ms）内，这种渐变会让鼠标感觉像“泡在浆糊里移动”。

**TuffEx 铁律**：
* **悬停（Hover）必须是 0ms 瞬间响应！** 鼠标指针只要进入元素热区，背景色高亮与文字墨水必须立即可见。
* 只有几何属性（如极微小的 `scale`、`transform` 位移、极淡的 `opacity` 光斑）才允许带有平滑过渡。

### 24.2 状态形变（Morphing）的过渡门禁

那么，什么时候才允许颜色过渡？**仅在组件发生语义状态切换时（例如从普通态切换为危险态）**。
为了防止状态过渡污染悬停，TuffEx 规定：**颜色过渡必须绑定在临时状态类上，而非元素基础类上**。下面是 TxModeChip 的写法（略去了变量的兜底值）：

```scss
// 正确做法：TxModeChip 源码纪律
.tx-mode-chip {
  // 悬停瞬间完成，零延迟
  &:hover:not(:disabled) {
    background-color: var(--tx-mode-chip-fill-hover);
    color: var(--tx-mode-chip-ink-hover, var(--tx-mode-chip-ink));
  }

  // 仅当 JavaScript 明确驱动状态形变时，挂载 .is-morphing
  &.is-morphing {
    transition: 
      background-color 240ms var(--tx-ease-out-strong), 
      color 240ms var(--tx-ease-out-strong);
  }
}
```

现在 TuffEx 的组件都守这条规则：悬停一律瞬间换色。颜色过渡要么只在 `.is-morphing` 存在时生效（选中、展开、聚焦这类状态切换时挂上，最长的一段颜色过渡走完就摘掉），要么只写在悬停根本不改颜色的元素上。跟着指针走的高亮也算悬停，例如 TxSearchPanel 的候选项、TxCascader 展开的路径，同样瞬间换色。

---

## 第 25 章：菜单与动作确认律动：90ms 清除 + 90ms 激活

### 25.1 为什么菜单点击后瞬间消失是错的？

在原生应用中，经常发生这样的困惑：用户点击了上下文菜单中的“删除”，菜单瞬间在 0ms 消失，屏幕上没有留下任何反馈。
用户往往会愣住一瞬间：“我到底点中了刚才那一行吗？还是鼠标滑偏了点到了外面？”

### 25.2 两拍式确认律动（Two-beat Activation Feedback）

TuffEx 的 `TxDropdownItem` 与 `TxContextMenuItem` 在点击后先走一段两拍、合计约 180ms 的确认节拍，再关闭菜单：

```
用户点击菜单项 ->
【拍子一：90ms】这一行的边框、底色和阴影全部变透明，撤掉悬停与焦点的高亮。
【拍子二：90ms】这一行切到 TxCardItem 的激活态，确认“你命中了这一项”。
-> 第二拍结束：派发 select 事件
-> 关闭菜单
```

既能让眼睛确信操作已执行，又绝不拖沓。两拍各由一个 90ms 的 `setTimeout` 推进；定时器不保证准点，实测每拍约 91ms。只有这次点击会关闭菜单（`close-on-select`）、并且 `activation-feedback` 开着（两者默认都开）时才走两拍，否则立即派发 select。当用户开启系统减弱动态效果时，同样立即执行。

```vue
<!-- packages/tuffex/packages/utils/menu-activation-feedback.ts -->
<!-- 业务调用保持极其简洁 -->
<TxDropdownItem @select="handleExecuteAction">
  运行当前指令
</TxDropdownItem>
```

---

## 第 26 章：合成器线程优先：零排版动画保障

### 26.1 四大安全金刚属性

在浏览器与 Electron 渲染引擎中，修改属性会触发不同阶段的管线：
* **Layout（排版）**：`width`, `height`, `margin`, `top`, `left`, `flex` —— 极其昂贵，引起整个页面重排！
* **Paint（绘制）**：`background-color`, `box-shadow`, `border-radius` —— 重新栅格化像素。
* **Composite（合成器线程）**：**`translate`**, **`scale`**, **`rotate`**, **`opacity`** —— 动画可以整段交给合成器线程：元素提升为独立图层、栅格化一次之后，每一帧只需对这张现成的图层做位移、缩放、旋转或调整透明度再合成，不必重新排版或重绘，哪怕主线程 JavaScript 繁忙，动画依然能跟上显示器的刷新率！

合成器线程本身是一条 CPU 线程（Chromium 里位于渲染进程），它把已经栅格化的图层交给 GPU 拼合，并不跑在 GPU 上。

**TuffEx 铁律**：
所有高频动画、加载效果与循环特效，**严格只能使用四大金刚合成属性**。

一次性的尺寸形变不在此列，例如第 28 章的折叠展开、第 27 章由弹簧推进的尺寸形变。理由见 28.2。

### 26.2 `@keyframes` 里可以写 `var()`：能否合成看动的是哪个属性

动画开始时，浏览器按元素把关键帧里的 `var()` 解析成具体值，再把整段动画交给合成器，和直接写数值一样。动画途中改了变量，浏览器按新值重新解析关键帧，动画接着跑。

2026-10 在 Chromium 152 里用 DevTools 时间线跟踪逐条核对，看跟踪事件里的 `compositeFailed` 与 `unsupportedProperties`；每种属性都用 `var()` 写和直接写数值各测一组，两组结果相同。WebKit 与 Gecko 没有实测。

| 关键帧动的是 | 在哪条线程上跑 |
|---|---|
| `translate`、`scale`、`opacity`、`transform` | 合成器 |
| `filter: blur()`、`box-shadow`、`color`、`width` | 主线程：blur 这类会移动像素的滤镜不能合成，其余三项在 `unsupportedProperties` 里列出 |
| 自定义属性本身，再由 `transform: scale(var(--s))` 读取 | 主线程：`unsupportedProperties: ["--s"]` |

所以要避开的是两种写法，都和 `var()` 无关：

* 关键帧动的是非合成属性，分类见 26.1。
* 给自定义属性做关键帧动画，再让合成属性读它。自定义属性每一帧都在主线程上插值，读它的 `transform` 本身不是动画，只是每帧跟着重算样式，合成器拿不到这段动画。要动哪个合成属性，就直接给它写关键帧，变量只用来给起点、终点、幅度这类值。

```scss
// 合成器：变量只给起点（TxBadge 的入场位移）
@keyframes tx-badge-slide-in {
  from { translate: var(--tx-badge-offset-x, -8.2px) var(--tx-badge-offset-y, 12.4px); }
  to { translate: 0 0; }
}

// 主线程：动的是自定义属性 --pulse，transform 只是每帧跟着重算
@property --pulse { syntax: '<number>'; inherits: false; initial-value: 1; }
@keyframes bad-pulse { 50% { --pulse: 1.08; } }
.element { transform: scale(var(--pulse)); animation: bad-pulse 1.2s ease-out; }
```

---

## 第 27 章：物理弹簧引擎 vs 贝塞尔曲线

### 27.1 为什么 Cubic-Bezier 无法应对被中断的手势？

CSS 原生贝塞尔曲线（如 `cubic-bezier(0.25, 1, 0.5, 1)`）有一个物理死穴：**它是基于固定时间跨度（Duration）的插值函数**。
如果动效播放到一半被手势打断（例如用户拖拽抽屉时突然反向滑动），过渡会从当前位置按固定时长重新走一条曲线，速度直接换成新曲线起点的斜率，与打断前的速度 $v_0$ 无关：
* 起点平缓的曲线（如 `ease-in-out`）会先急停，再重新加速，产生明显的“卡壳顿挫感”。
* 起点陡峭的曲线（如 TuffEx 的 `ease-out-strong`）反而会猛地加速。

两种情况速度都发生突变，运动轨迹出现机械的折断感。

### 27.2 TuffEx 弹簧模型（Spring Physics）

需要在打断时保住速度、又由 JS 逐帧绘制的动效，TuffEx 交给 `stepSpring` 推进，例如 TxSlider 拖过头后的回弹、TxMorph 与 TxTransitionSmoothSize 的尺寸形变，以及 TxLiquid。它积分的是经典二阶阻尼振荡方程（$x$ 为相对目标的位移）：
$$m \frac{d^2x}{dt^2} + c \frac{dx}{dt} + k x = 0$$
* **刚度（Stiffness $k$）**：决定弹簧拉伸时的加速度与回弹爆发力。
* **阻尼（Damping $c$）**：控制振荡衰减速度，消除烦人的反复晃动。
* **质量（Mass $m$）**：赋予元素物理惯性。

`stepSpring` 用半隐式欧拉法积分，每 1/240 秒算一个子步。手势打断时只换目标，当前的位置与速度 $\vec{v}$ 原样带过去，达到如同拖拽实体物理卡片般的顺滑跟手。

---

## 第 28 章：折叠展开尺寸保持原则

### 28.1 折叠动画中的“文字挤压抽搐”

当手风琴菜单（Accordion）或折叠面板展开时，常见的错误实现是直接动画内部容器的宽度或高度。
如果内容容器在收拢过程中尺寸不断变小，内部文字为了适应逐渐变窄的容器会**不断重新折行（Reflow）**，整段文字在关闭过程中如同被挤压的毛毛虫般上下乱跳！

### 28.2 容器剪裁隔离法（`bui-disclosure-collapse`）

TuffEx 把这套写法收成了 `style/mixins.scss` 里的 `bui-disclosure-collapse`。TxToolChips、TxTaskRows、TxDiffTable 等组件直接引用它；TxToolCallCard、TxSources、TxChainOfThought、TxReasoningDisclosure 则各自内联了同样的写法。它展开后是这样：

```scss
// 外层：只有一条轨道的 grid。0fr ↔ 1fr 之间过渡的是容器的高度
.tx-disclosure {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  transition:
    grid-template-rows 0.3s var(--tx-ease-out-strong),
    opacity 0.3s var(--tx-ease-out-strong);

  // 内层就是剪裁器：overflow: hidden 让它的最小高度归零。
  // 内容始终按完整宽度排好，变的只是露出来的高度，文字绝不二次折行
  > * {
    overflow: hidden;
  }

  &.is-open {
    grid-template-rows: 1fr;
    opacity: 1;
  }

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
}
```

折叠展开要把后面的内容推开，这件事只靠四大合成属性做不到，所以它是第 26 章铁律之外允许改动排版的一类。它不循环，也不跟着指针高频触发，每次状态切换只跑一次。内容按完整尺寸排好不动，每一帧浏览器只是重新摆放后面的元素，不会重新折行。

收起时内容要一直可见，直到容器合拢。如果用 `visibility: hidden` 一类的属性在收起的第一帧就把内容藏掉，看到的就只剩一个空框自己缩回去。

---

## 第 29 章：双 Keyframe 名字交替重放机制

### 29.1 避免 `void el.offsetWidth` 强制重排

在前端交互中，经常需要“在同一元素上重新播放一次动画”（例如表单校验失败时晃动输入框，或者成功时脉冲提示一次）。
传统 Hack 做法是：
```ts
// 传统危险做法：强制浏览器执行同步重排！
element.classList.remove('is-pulse');
void element.offsetWidth; // 极其昂贵！卡顿主线程！
element.classList.add('is-pulse');
```

### 29.2 TuffEx 双键名交替黑科技

在 `TxStatusHint` 等组件中，TuffEx 采用双 Keyframe 名称交替翻转：

```scss
// 预先声明两个逻辑完全相同、名称不同的 Keyframe
@keyframes tx-pulse-a {
  30% { scale: 1.12; }
}
@keyframes tx-pulse-b {
  30% { scale: 1.12; }
}

.tx-status-hint.is-pulse-a { animation: tx-pulse-a 300ms ease-out; }
.tx-status-hint.is-pulse-b { animation: tx-pulse-b 300ms ease-out; }
```

```ts
// 每次重放只需翻转 class 名称，零代价重自动画，完全绕开 DOM 重排！
pulseState.value = pulseState.value === 'a' ? 'b' : 'a';
```

---

## 第 30 章：减弱动态偏好（Reduced Motion）零损降级

### 30.1 无障碍的尊严底线

部分前庭神经紊乱（Vestibular Disorder）或癫痫患者在面对屏幕晃动、大面积缩放时会产生真实的眩晕与恶心。现代操作系统均提供了“减弱动态效果”开关。

### 30.2 降级不等于内容消失：必须锁定终态

```scss
// 错误写法：单纯将 animation 置为 none，导致淡入初始态（opacity: 0）的内容直接看不见！
@media (prefers-reduced-motion: reduce) {
  .fade-in-element { animation: none; } // 致命错误：元素隐形了！
}

// 正确写法：在关闭动画的同时，强制将最终样式固化为可见终态
@media (prefers-reduced-motion: reduce) {
  .fade-in-element {
    animation: none !important;
    transition: none !important;
    opacity: 1 !important;
    transform: none !important;
  }
}
```
或者采用优雅的逆向声明法：**仅在用户偏好全动效时才挂载动画**：
```scss
@media (prefers-reduced-motion: no-preference) {
  .fade-in-element {
    animation: tx-fade-in 200ms ease-out;
  }
}
```
这保证了在任何无障碍模式下，生产力内容始终 100% 完整呈现在视网膜前。
