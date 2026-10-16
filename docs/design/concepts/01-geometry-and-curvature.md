# 第一篇：几何、曲率连续性与空间形态 (Geometry, Curvature & Space)

> 涵盖章节：第 1 章 ～ 第 4 章  
> 核心主题：从欧几里得圆弧到超椭圆 G2 曲率连续；同心圆角几何守恒；光学内嵌补偿与 Z 轴深度拓扑。

---

## 第 1 章：曲率连续性原理：从 G0、G1 到 G2 连续

### 1.1 什么是曲率连续性？

在工业设计（如汽车车身、航空机翼）与高端数字界面（Apple iOS/macOS 硬件及系统 UI）中，曲线的平滑程度由几何连续性阶数决定：

* **$G^0$ 连续（位置连续）**：两段曲线在连接点处坐标重合，但切线方向发生突变（例如：两条直线相交构成的 90 度尖角）。
* **$G^1$ 连续（切线连续）**：两段曲线在连接点处切线方向相同，一阶导数方向一致。**Web 浏览器标准的 CSS `border-radius` 即为 $G^1$ 连续**——它由一段直线直接拼接一段四分之一标准圆弧。
* **$G^2$ 连续（曲率连续）**：两段曲线在连接点处不仅切线方向相同，**曲率 $\kappa$（二阶导数）亦完全相等且连续变化**。

```
G1 倒角 (标准 border-radius):
直线 (曲率 κ = 0) --------> 突变点 (κ 瞬间跳跃至 1/R) ------> 圆弧 (κ 恒定)
视觉感受：连接处出现轻微但可察觉的“折角感”与高光截断（Specular Break）。

G2 倒角 (超椭圆 / Squircle):
直线 (κ = 0) --------> 缓和过渡区 (κ 从 0 平滑爬升至最大值) ------> 顶点 (平滑对称)
视觉感受：浑然天成，光影流动连续，视觉柔和度与品质感极高。
```

### 1.2 为什么标准 `border-radius` 在大尺寸卡片上显得廉价？

标准 CSS `border-radius: 16px` 使用的是圆弧倒角。曲率定义为：
$$\kappa = \frac{1}{R}$$
在直线段，曲率 $\kappa = 0$；一旦进入圆弧接触点，曲率瞬间跳跃为 $\frac{1}{16} = 0.0625$。在人眼视网膜的高阶边缘检测机制中，二阶导数的阶跃会导致边缘反差感知（Mach Band 效应），在光照或者反光材质下会形成明显的“硬接缝”。

Apple 从 iOS 7 开始把应用图标换成「连续圆角」（continuous corners），这种外形常被近似为超椭圆（Lamé Curve）：
$$\left| \frac{x}{a} \right|^n + \left| \frac{y}{b} \right|^n = 1 \quad (n \approx 4 \sim 5)$$
$n = 2$ 时它就是圆。$n > 2$ 时，超椭圆在与直线相接处的曲率为 0，与直线的曲率接得上（$G^2$）；$n > 3$ 时，相接处的曲率变化率 $\frac{d\kappa}{ds}$ 也为 0，曲率从 0 平缓爬升到 45° 方向的峰值。欧拉螺线（Euler Spiral / Clothoid）是另一种缓和曲线：它的曲率随弧长线性增长，$\frac{d\kappa}{ds}$ 是一个不为 0 的常数，超椭圆里并没有它。

### 1.3 TuffEx 中的 G2 连续工程实现

TuffEx 用 CSS 的 `corner-shape` 画平滑圆角：`border-radius` 仍然决定拐角占多大，`corner-shape: superellipse(K)` 把这段拐角从圆弧换成超椭圆，指数 $n = 2^K$（K = 1 是圆弧，K = 2 是常说的 squircle）。Chromium 139 起支持，TuffEx 所在的 Electron 41（Chromium 146）可以直接用；Safari 和 Firefox 还不支持。

```scss
// packages/tuffex/packages/components/style/mixins.scss（节选）
$tx-squircle-smoothness: 0.6 !default;

// $inset：子层离宿主外缘的距离（宿主的边框、内边距），每个圆角减去它
@mixin tx-squircle($radius: 16px, $smoothness: $tx-squircle-smoothness, $inset: 0) {
  border-radius: tx-squircle-inset($radius, $inset);
  @supports (corner-shape: superellipse(2)) {
    // 每个圆角乘以 1 + $smoothness；指数让 45° 方向切入的深度保持为圆弧 R 的深度
    border-radius: tx-squircle-inset(tx-squircle-radius($radius, $smoothness), $inset);
    corner-shape: superellipse(#{tx-squircle-exponent($smoothness)});
  }
}

.tx-modal__content {
  @include tx-squircle(16px); // → border-radius: 25.6px; corner-shape: superellipse(1.777)
}
```

* **`$smoothness` 与 Figma 的 Corner smoothing 同义**：拐角沿每条边多占 `$smoothness × R`，超椭圆的半轴 $a = (1 + s) \cdot R$。
* **指数由「45° 方向切入深度相等」求出**：超椭圆在对角线上切入 $a(1 - 2^{-1/n})$，令它等于半径 R 的圆弧切入的 $R(1 - 1/\sqrt{2})$。默认 $s = 0.6$ 时 $a = 1.6R$、$n \approx 3.43$、$K \approx 1.777$。拐角看起来和原来的 R 一样大，只是曲线从 1.6R 处就开始弯，曲率从 0 爬升到 45° 方向的约 $1.31/R$，中间没有阶跃。
* **实测**（Chrome 152，从拐角沿 3°～45° 的射线做命中测试）：R = 16 / 18 / 24 时，45° 方向与同 R 圆角的边界相差不超过 0.02px；靠近曲线起点处超椭圆略向内收，法向不到 0.3px。
* **令牌与工具类**：拿不到 mixin 的代码（如 core-app）读 `--tx-corner-smooth-scale`（1.6）与 `--tx-corner-smooth-shape`（`superellipse(1.777)`），在 `@supports (corner-shape: superellipse(2))` 里把半径乘上前者、再设后者。模板里可以直接用 `.tx-corner-smooth-sm`、`-md`、`-lg`，分别对应 8 / 16 / 24px 的圆角。
* **已接入**：TxCard、TxModal、TxCommandPalette、TxFlipOverlay、TxPopperDialog、TxBlowDialog、TxBottomDialog、TxTouchTip，以及 core-app 的 CoreBox。CoreBox 默认外观的圆角为 0，选「圆角」外观（12px）时才看得到。主窗口的圆角由系统绘制（macOS 的 vibrancy 窗口、Windows 的 DWM），CSS 改不了。
* **子层要一起继承形状**：`corner-shape` 不会继承。用 `border-radius: inherit` 复制外形的子层必须同时写 `corner-shape: inherit`，否则拿到的是放大后的半径配圆弧，在拐角处向内缺一块。TxBaseSurface 的各层、TxFlowLight、`.fake-background` 的伪元素都已这样处理；TxBaseSurface 传了自己的 `radius` 时保持圆弧。平滑圆角的宿主不要再设 `--fake-radius`，它会盖掉继承下来的半径。
* **在边框或内边距以内的子层不能直接继承**：继承来的是宿主外缘的半径，放在内缘上，每个拐角都会在两者之间留出一道透出背景的月牙缝。这样的子层给 `tx-squircle` 传 `$inset`，例如 `@include tx-squircle(var(--tx-card-radius, 14px), $inset: 1px)`：半径减去这段距离、超椭圆的指数不变，与宿主同心（见 2.1）。
* **不支持 `corner-shape` 的浏览器保留普通圆角（$G^1$），不用 SVG 遮罩补形**。`mask` / `clip-path` 会剪掉元素外侧的 `box-shadow`，还会让元素成为背景滤镜的根：实测在 Chrome 里，带遮罩的宿主内部的 `backdrop-filter` 只取得到宿主自己，底下的条纹原样露出（红色通道 51～219）；去掉遮罩才是均匀的模糊（135）。默认的琉光（refraction）与玻璃材质都靠 `backdrop-filter`，遮罩补形会让它们失效。
* **矮盒子的拐角会变方**：盒子的高或宽小于 $2 \times 1.6R$ 时，浏览器按比例缩小半径，拐角比原来的 R 更方。例如 R = 18 的 TxCard 要至少 57.6px 高才不受影响；40px 高时，45° 方向少切约 1.6px。

#### 对比示例：错误与正确

```html
<!-- 错误：在 600px+ 的浮层上直接写大圆角，四角是圆弧，曲率在接缝处跳变 -->
<div class="launcher" style="border-radius: 24px; box-shadow: 0 20px 40px rgba(0,0,0,0.3);">
  ...
</div>

<!-- 正确：平滑圆角工具类定外形，铺在里面的琉光材质（TxBaseSurface 默认 refraction）继承同一外形 -->
<div class="launcher tx-corner-smooth-lg">
  <TxBaseSurface class="launcher__surface" />
  ...
</div>
```

---

## 第 2 章：同心圆角法则与黄金嵌套比

### 2.1 物理几何公式：$R_{\text{outer}} = R_{\text{inner}} + \text{Padding}$

当两个同心圆角容器嵌套在一起时，如果内外容器使用相同的 `border-radius`，两者之间的间隙会产生极其严重的视觉扭曲：

```
错误嵌套 (内外皆为 12px，Padding = 8px):
拐角处（沿 45° 对角线）的实际物理距离：
D_corner = P * √2 = 8 * 1.414 ≈ 11.31px
与边缘平直处的间距 8px 相比，拐角处间距凭空多出约 41%！
视觉表现：内部容器像是被“挤压”或“悬空”，两道弧线无法平行。

正确嵌套 (R_outer = R_inner + Padding):
设 R_inner = 8px, Padding = 6px -> R_outer 必须严格设为 14px。
视觉表现：两道弧线保持完全等距平行的环形通道（Concentric Harmony）。
```

### 2.2 TuffEx 黄金嵌套实战

TuffEx 的嵌套组件用 CSS `calc()` 从同一个半径变量推出内外两层，改一个尺寸，两层一起变：

```scss
// TxMotionControl 的分段控件，建在 TxTabs 上（节选）
.tx-motion-control {
  --tx-mc-radius: 14px; // xs / sm / lg 为 10 / 12 / 16px

  // 轨道
  :deep(.tx-tabs__nav) { padding: 0; border-radius: var(--tx-mc-radius); }
  // 3px 写在标签列表上，替换 TxTabs 自带的 6px 8px，顶部导航下的分隔线也去掉，
  // 3px 就是标签项四周的全部间隙
  :deep(.tx-tabs .tx-tabs__nav) { border-bottom: 0; }
  :deep(.tx-tabs .tx-tabs__nav-inner) { padding: 3px; }
  // 标签项：轨道半径减去 3px
  :deep(.tx-tab-item) { border-radius: calc(var(--tx-mc-radius) - 3px); }
}

// 「频率」变体的外框：6px 内边距里装的是触发按钮或轨道，半径都是 --tx-mc-radius
.tx-motion-control__frequency {
  padding: 6px;
  border-radius: calc(var(--tx-mc-radius) + 6px);
}
```

* **TxMotionControl**：md 尺寸下，轨道 14px，标签项 11px，外框 20px。外框到标签项的间隙是 6 + 3 = 9px，20 − 9 正好等于 11。TxTabs 的 `pill` 指示器每次定位时读取当前标签项的计算圆角，所以也是 11px。
* **TxChoiceCard** 由内往外推：外框半径 `calc(var(--tx-choice-card-option-radius, 10px) + var(--tx-choice-card-pad, 8px))`，选项 10px，外框 18px。
* **TxCollapse**：外框 10px，有 1px 边框。首个标题与收起时末个标题的外侧两角是 `calc(var(--tx-collapse-radius, 12px) - 1px)`，悬停底色和焦点环都沿着外框走。
* **TxMorph**：`--tx-morph-radius` 注册为可继承的 `<length>`。内容的圆角写成 `calc(var(--tx-morph-radius) - var(--tx-morph-inset))`，就与外框同心；形状变形的途中读到的是动画中的半径，也保持同心。
* **TxCard**：材质层、封面与加载遮罩铺满卡片的边框以内，圆角取卡片的平滑圆角减去边框宽度 `--tx-card-border-width`（`solid`、`dashed` 为 1px，`plain` 为 0），形状相同。默认 18px 的卡片外缘是 28.8px，这三层是 27.8px。
* **内边距大于外框半径时无法同心**：$R_{\text{outer}} - \text{Padding}$ 为负，内层只能用自己的最小圆角。TxTabs 的外框是 12px，标签项离外框外沿 13～17px（1px 边框、导航内边距与标签项外边距之和），所以标签项用自己的 10px。

```vue
<!-- 错误写法：硬编码内外圆角导致断层 -->
<div class="outer-box" style="border-radius: 12px; padding: 8px;">
  <div class="inner-chip" style="border-radius: 12px;">Tag</div>
</div>

<!-- 正确写法：严格遵守同心守恒 -->
<div class="outer-box" style="border-radius: 12px; padding: 4px;">
  <div class="inner-chip" style="border-radius: 8px;">Tag</div>
</div>
```

---

## 第 3 章：内外微内嵌与光学校准

### 3.1 水平内嵌（Horizontal Inset）与圆角防削切

当容器拥有圆角时，圆弧会向容器内部侵占空间。如果输入框（`TxInput`）的文本或光标直接贴着矩形边界开始，光标闪烁时会直接**切入圆角弧线**内部，形成“文字被圆角砍头”的低级视觉缺陷。

为了保证光标与左边缘安全相切，水平内边距必须大于等于圆弧最大内侵距离：
$$w_{\text{clearance}} \ge R \cdot \left(1 - \cos\left(\frac{\pi}{4}\right)\right) \approx 0.293 \cdot R$$
不仅如此，考虑到视网膜扫描的呼吸感，TuffEx 制定铁律：
**水平内边距必须完全覆盖整个圆角半径值**：
$$Padding_{\text{horizontal}} \ge R$$

```scss
// TxInput 的源码实现纪律
.tx-input {
  border-radius: 12px;
  // padding-left 必须严格达到 12px，让光标与首字符完全避开圆弧拐点
  padding: 0 12px;
}
```

### 3.2 垂直与水平内边距的 0.65x 光学比例

文字本身带有排版 `line-height`，字体上下天然带有不可见的行间空隙（Font Leading）。如果按钮或 Chip 采用相等的数值内边距（如 `padding: 8px 8px`），在人眼中会呈现出**头重脚轻的上下空旷感**。

TuffEx 的单行文字包裹层黄金光学比例：
$$Padding_{\text{vertical}} \approx 0.6 \sim 0.75 \times Padding_{\text{horizontal}}$$

* `TxScrubField`：固定 26px 高，12px 字的行高 14.5px，上下各留 5.75px，写着的 4px 上下内边距不起作用。两端的字离边缘 9px：拖动柄一侧是 5px 内边距加柄自己的 4px，单位一侧是 8px 加 1px，比值约 0.64。
* `TxModeChip`：固定 28px 高、行高 18px，上下各留 5px，左右 8px（`height: 28px; padding: 0 8px`），比值 0.625。
* `TxTag` 的 md 尺寸：直接写作 `padding: 5px 8px`，比值同为 0.625。

---

## 第 4 章：空间层级与 Z-Axis 深度拓扑

### 4.1 彻底消灭 `z-index: 99999`

在未经深思的工程体系中，开发人员遇到遮挡问题往往随意加大 `z-index`，最终导致全局层级失控（Modal 被 Select 遮挡、Tooltip 穿透系统托盘）。

固定的层级档位也解决不了这个问题：弹窗里打开的下拉菜单必须盖住弹窗，抽屉里打开的弹窗又必须盖住抽屉。谁该在上面，取决于打开的先后，而不是组件的种类。所以 TuffEx 不给浮层分固定档位，而是让它们按打开顺序，从同一个 z-index 分配器（`packages/tuffex/packages/utils/z-index-manager.ts`）取号：

* **取号**：浮层打开时调用 `next()`，拿到当前值加 1，后打开的总是盖在先打开的上面。取号的有 TxModal；基于 TxBaseAnchor 的浮层，如 TxPopover、TxTooltip、TxSelect、TxDropdownMenu、TxContextMenu；以及 TxCommandPalette、TxFlipOverlay、TxPicker、TxLoadingOverlay 和各类 Dialog。TxToastHost 在每次调用 `toast()` 时取号。
* **起点**：计数器从 2000 起步（`DEFAULT_Z_INDEX_SEED`），第一个浮层拿到 2001。不带参数调用 `refresh()` 时，会改读 CSS 变量 `--tx-index-popper`，取两者中较大的那个。
* **抽屉**：TxDrawer 打开时先 `refresh(10000)`，把计数抬到至少 10000 再取号，所以第一个抽屉是 10001，在抽屉里打开的浮层从 10002 往上排。传了 `z-index` 时直接用这个值，并把计数抬到至少这个值。
* **只增不减**：关闭浮层不会退号，下一个浮层照样取更大的号。
* **按应用隔离**：`app.use(Tuffex)` 时为这个应用建一个分配器，没有 Vue 应用的调用方共用模块级的那一个。

业务代码要做自己的浮层时，同样用 `useZIndexAllocator()` 取号，不要写死数字。

`variables.scss` 里另有 `--tx-index-normal: 1`、`--tx-index-top: 1000`、`--tx-index-popper: 2000` 三个令牌：`--tx-index-popper` 除了作分配器的起点，也是 TxVersionCapsule 面板的层级；`--tx-index-top` 给 TxMotion 的全局进度条用，让它压在所有浮层之下；`--tx-index-normal` 组件没有用到。TxMotion 的全局指针层是例外，固定为 2147483647：它要跟着指针盖过抽屉和对话框，而分配器的号没有上限。组件内部写死的 `z-index` 大多是 −1 到 10 的小数值，只在组件自己的层叠上下文里排先后。

### 4.2 吸顶分离准则：使用 1px 细线而非投影

当表格表头或顶部导航条吸附在视窗顶部、下方内容滚动经过时，**禁止使用弥散阴影作为分割**。

```scss
// 错误写法：阴影让固定条悬浮在半空中，且模糊了滚动到其下方的第一行字
.table-sticky-header {
  box-shadow: 0 4px 12px rgba(0,0,0,0.15); // 严禁！
}

// 正确写法：使用极细的清晰边界线，保持严谨的平面秩序
.table-sticky-header {
  border-bottom: 1px solid var(--tx-border-color);
  background-color: var(--tx-bg-color); // 必须是不透明背景
}
```

**原因分析**：吸顶元素在空间感知上并不是悬浮在半空中的飞毯（Overlay），而是内容视窗的“闸门”。使用 1px 细线能够在物理上清晰界定滚出边界；而使用投影会造成空间深度假象，破坏文本第一行的可读性。
