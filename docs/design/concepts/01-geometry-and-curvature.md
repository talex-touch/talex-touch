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

Apple 从 iOS 7 开始，在所有应用图标、硬件外壳及系统视窗中强制采用超椭圆（Lamé Curve）：
$$\left| \frac{x}{a} \right|^n + \left| \frac{y}{b} \right|^n = 1 \quad (n \approx 4 \sim 5)$$
通过引入欧拉螺线（Euler Spiral / Clothoid）作为缓和曲线，使得直线与曲线交汇点的曲率变化率为零（$\frac{d\kappa}{ds} = 0$）。

### 1.3 TuffEx 中的 G2 连续工程实现

由于现代浏览器尚未原生普及 `corner-shape: squircle`，TuffEx 在核心视窗、CoreBox 主浮层与重点卡片组件中，通过 SVG 路径计算与参数化 CSS Mask 实现 G2 等效的超椭圆形态：

```scss
// packages/tuffex/packages/components/style/mixins.scss
// 核心 G2 平滑剪裁参数化生成
@mixin tx-squircle($radius: 16px, $smoothness: 0.6) {
  // 当浏览器支持 CSS corner-shape 时原生优先
  @supports (corner-shape: squircle) {
    border-radius: $radius;
    corner-shape: squircle;
  }
  // 否则通过精密拟合的平滑贝塞尔曲线或 SVG Mask 赋予 G2 外形
  @supports not (corner-shape: squircle) {
    border-radius: $radius;
    // 使用更高阶的光学半角拟合，降低过渡突兀感
    clip-path: url("data:image/svg+xml,...");
  }
}
```

#### 对比示例：错误与正确

```html
<!-- 错误：机械使用固定大圆角，在 600px+ 的浮层上暴露出四角生硬的圆弧折线 -->
<div class="corebox-window" style="border-radius: 24px; box-shadow: 0 20px 40px rgba(0,0,0,0.3);">
  ...
</div>

<!-- 正确：采用 TuffEx G2 连续曲率平滑方案，结合光学折射边缘 -->
<div class="corebox-window tx-surface-refraction tx-corner-smooth-lg">
  ...
</div>
```

---

## 第 2 章：同心圆角法则与黄金嵌套比

### 2.1 物理几何公式：$R_{\text{outer}} = R_{\text{inner}} + \text{Padding}$

当两个同心圆角容器嵌套在一起时，如果内外容器使用相同的 `border-radius`，两者之间的间隙会产生极其严重的视觉扭曲：

```
错误嵌套 (内外皆为 12px，Padding = 8px):
拐角处的实际物理距离：
D_corner = (R + P) * √2 - R = (12 + 8) * 1.414 - 12 ≈ 16.28px
与边缘平直处的间距 8px 相比，拐角处间距骤增一倍！
视觉表现：内部容器像是被“挤压”或“悬空”，两道弧线无法平行。

正确嵌套 (R_outer = R_inner + Padding):
设 R_inner = 8px, Padding = 6px -> R_outer 必须严格设为 14px。
视觉表现：两道弧线保持完全等距平行的环形通道（Concentric Harmony）。
```

### 2.2 TuffEx 黄金嵌套实战

在 `TxSensitiveInput`、`TxCard` 与 `TxTabs` 等多层嵌套组件中，TuffEx 严格执行 CSS `calc()` 动态同心约束：

```scss
// TxSensitiveInput 中的同心设计实装
.tx-sensitive-input {
  --tx-si-radius: 12px;
  border-radius: var(--tx-si-radius);
  padding: 4px;

  // 内部复制按钮 Tab 位于右侧内侧，保持同心圆角
  .tx-sensitive-input__copy-tab {
    // 外层半径减去内边距，确保内外圆弧完全同心平行
    border-radius: calc(var(--tx-si-radius) - 4px); // 即 8px
  }
}
```

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

* `TxScrubField`（26px 高度）：`padding: 4px 8px 4px 6px`。
* `TxButton`（32px 标准高度）：`padding: 6px 12px`。
* `TxTag`（微型标签）：`padding: 2px 6px`。

---

## 第 4 章：空间层级与 Z-Axis 深度拓扑

### 4.1 彻底消灭 `z-index: 99999`

在未经深思的工程体系中，开发人员遇到遮挡问题往往随意加大 `z-index`，最终导致全局层级失控（Modal 被 Select 遮挡、Tooltip 穿透系统托盘）。

TuffEx 建立了不可逾越的 7 级 Z 轴拓扑系统：

| 标号 | 层级令牌 | Z-Index | 对应物理实体 | 遮挡规则 |
|---|---|---|---|---|
| L0 | `--tx-z-floor` | `0` | 主工作区底板、Canvas 画布 | 任何组件均在其上方 |
| L1 | `--tx-z-surface` | `1` | 普通卡片、表格行、分组容器 | 局部文档流层级 |
| L2 | `--tx-z-sticky` | `10` | 表格吸顶头、侧边栏固定操作条 | 仅盖住当前滚动容器的下层内容 |
| L3 | `--tx-z-popover` | `100` | 下拉菜单、日期选择器、上下文菜单 | 随宿主滚动或脱标，可被抽屉覆盖 |
| L4 | `--tx-z-drawer` | `500` | 侧滑配置抽屉、详情侧面板 | 遮盖整个应用主体 |
| L5 | `--tx-z-modal` | `1000` | 对话框、危险操作阻断弹窗 | 全局遮罩遮蔽所有背景内容 |
| L6 | `--tx-z-system` | `5000` | CoreBox 快捷指令盘、全局搜索栏 | 跨越一切应用窗口的系统级交互 |
| L7 | `--tx-z-toast` | `9999` | 错误报警、状态通知、Tooltip 气泡 | 永远处于最高可见层，不可被阻拦 |

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
