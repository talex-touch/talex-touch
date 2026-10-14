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
为了防止状态过渡污染悬停，TuffEx 规定：**颜色过渡必须绑定在临时状态类上，而非元素基础类上**：

```scss
// 正确做法：TxModeChip 源码纪律
.tx-mode-chip {
  // 悬停瞬间完成，零延迟
  &:hover:not(:disabled) {
    background-color: var(--tx-mode-chip-fill-hover);
  }

  // 仅当 JavaScript 明确驱动状态形变时，挂载 .is-morphing
  &.is-morphing {
    transition: 
      background-color 240ms var(--tx-ease-out-strong), 
      color 240ms var(--tx-ease-out-strong);
  }
}
```

---

## 第 25 章：菜单与动作确认律动：90ms 清除 + 90ms 激活

### 25.1 为什么菜单点击后瞬间消失是错的？

在原生应用中，经常发生这样的困惑：用户点击了上下文菜单中的“删除”，菜单瞬间在 0ms 消失，屏幕上没有留下任何反馈。
用户往往会愣住一瞬间：“我到底点中了刚才那一行吗？还是鼠标滑偏了点到了外面？”

### 25.2 两拍式确认律动（Two-beat Activation Feedback）

TuffEx 在 `TxDropdownItem` 与 `TxContextMenuItem` 中沉淀了经典的两拍闭合节拍：

```
用户点击菜单项 ->
【拍子一：90ms】瞬间清除 Hover/Focus 高亮，消除手势视觉残留。
【拍子二：90ms】激活强调态色块脉冲一次，向视网膜确认“你命中了这一项”。
-> 触发业务回调（emit select）
-> 优雅收回父级菜单面板
```

整个过程耗时 **180ms**。既能让眼睛确信操作已执行，又绝不拖沓。
当用户开启系统减弱动态效果时，该机制瞬间降级为 0ms 极速响应。

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
* **Composite（合成器线程）**：**`translate`**, **`scale`**, **`rotate`**, **`opacity`** —— 运行在独立线程，直接交给 GPU 处理，哪怕主线程 JavaScript 繁忙也不会掉帧！

**TuffEx 铁律**：
所有高频动画、加载效果与循环特效，**严格只能使用四大金刚合成属性**。

### 26.2 严禁将 CSS 变量（`var()`）写进 `@keyframes`

```scss
// 严重违规：Keyframes 内部包含 var()
@keyframes bad-pulse {
  0% { transform: scale(var(--start-scale)); } // 浏览器无法在合成器线程预编译插值！
  100% { transform: scale(var(--end-scale)); }
}

// 正确做法：Keyframes 保持纯净数值，变量用于外部 duration 与 delay 计算
@keyframes tx-pure-pulse {
  0% { scale: 1; }
  50% { scale: 1.08; }
  100% { scale: 1; }
}

.element {
  animation: tx-pure-pulse calc(var(--base-duration) * 1.2) ease-out;
}
```

---

## 第 27 章：物理弹簧引擎 vs 贝塞尔曲线

### 27.1 为什么 Cubic-Bezier 无法应对被中断的手势？

CSS 原生贝塞尔曲线（如 `cubic-bezier(0.25, 1, 0.5, 1)`）有一个物理死穴：**它是基于固定时间跨度（Duration）的插值函数**。
如果用户正在拖拽抽屉，松手时带有速度 $v_0$：
* 贝塞尔曲线无法承接初速度 $v_0$，强行从 0 加速，产生明显的“卡壳顿挫感”。
* 如果动效播放到一半用户再次反向点击，贝塞尔曲线必须粗暴刹车重来，造成剧烈抽搐。

### 27.2 TuffEx 弹簧模型（Spring Physics）

TuffEx 的物理弹簧引擎基于经典二阶阻尼振荡方程：
$$m \frac{d^2x}{dt^2} + c \frac{dx}{dt} + k x = 0$$
* **刚度（Stiffness $k$）**：决定弹簧拉伸时的加速度与回弹爆发力。
* **阻尼（Damping $c$）**：控制振荡衰减速度，消除烦人的反复晃动。
* **质量（Mass $m$）**：赋予元素物理惯性。

手势打断时，弹簧系统自然保留上一帧的速度向量 $\vec{v}$ 并无缝合力，达到如同拖拽实体物理卡片般的顺滑跟手。

---

## 第 28 章：折叠展开尺寸保持原则

### 28.1 折叠动画中的“文字挤压抽搐”

当手风琴菜单（Accordion）或折叠面板展开时，常见的错误实现是直接动画内部容器的宽度或高度。
如果内容容器在收拢过程中尺寸不断变小，内部文字为了适应逐渐变窄的容器会**不断重新折行（Reflow）**，整段文字在关闭过程中如同被挤压的毛毛虫般上下乱跳！

### 28.2 容器剪裁隔离法（`bui-disclosure-collapse`）

```scss
// 正确模式：外部容器控制高度与 clip，内部内容尺寸绝对锁定
.tx-disclosure-wrapper {
  overflow: hidden; // 外层充当视口剪裁器
  transition: grid-template-rows 200ms ease-out;

  .tx-disclosure-content {
    min-height: 0; // 内部内容保持真实尺寸，文字绝不二次折行！
  }
}
```

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
