# Tuff v2.4.15-beta.6 更新说明

## 摘要

- 聚焦搜索（CoreBox）预览体验升级：当文件或插件详情预览激活时，窗口自适应展开至最大高度（600px），避免单结果搜索时媒体与元数据被压扁裁切。
- TuffEx 平滑圆角与表面令牌全面升级：引入超椭圆（Squircle）平滑圆角体系，重构组件库表面材质与暗色对比阶梯，升级 Markdown 编辑器组件。
- Nexus 文档中心与设计概念展台：新增几何曲率、流体材质、光学折射与色彩科学等交互概念展台，集成 Markdown 协同编辑体验空间。
- 全局无障碍与国际化细节对齐：为弹窗、抽屉与告警等无文本图标按钮提供本地化标签支持，TxThinkingOrb 新增渐变色 variant 变体。

## 变更内容

- 修复 CoreBox 在仅命中单行结果时因窗口高度受限（~114px）导致右侧视频、图片等媒体预览被物理裁切、控件挤压呈现大面积黑块的缺陷；通过 `useResize` 与 `useSearch` 建立 `hasPreview` 联动响应，预览展开时平滑最大化至 600px，预览关闭后自适应恢复。
- TuffEx 组件库引入基于 `corner-shape: superellipse` 的超椭圆平滑圆角 mixin，更新 `--tx-corner-smooth-*` 令牌；重构 Markdown 协同编辑器、工具栏、行内标记与状态面板；完善暗色模式中性色阶。
- Nexus 官网与文档中心新增包含 20+ 个设计理念演练场的交互展台（含曲率梳、光线混合、折射分层、弹簧中断与打字机节奏）；提供协同 Markdown 编辑器演示宿主环境。
- 增强组件库可访问性（a11y）：为 TModal、TxDrawer、TxAlert 与 TxToastHost 补齐可配置的本地化 `closeLabel` 与 `ariaLabel`，消除中文界面下的英文发音提示；TxThinkingOrb 新增 `variant="gradient"` 调色板渐变变体。
