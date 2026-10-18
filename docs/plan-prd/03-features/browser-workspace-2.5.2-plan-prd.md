# PRD: Tuff 2.5.2 现代浏览器工作区（Modern Browser Workspace）

> 更新时间：2026-10-17  
> 状态：Planned / Beta Feature Flagged / Default Off  
> 目标版本：2.5.2  
> 关联调研报告：`../../engineering/reports/electron-browser-feasibility-survey-2026-10-17.md`  
> 关联执行清单：`../TODO.md`  

---

## 1. 最终目标

2.5.2 将 **现代浏览器工作区 (Modern Browser Workspace)** 作为 Tuff 的实验性生产力能力：
用户在不离开 Tuff 的前提下，拥有一个界面极致优雅（Arc/Zen 风格垂直标签栏、沉浸式无边框视口、与 ⌘K CoreBox 深度结合）的内嵌浏览工作台。

### 核心选型与原则（路线 1）
* **坚持走 `WebContentsView` + Vue 3 自研现代外壳**：彻底抛弃 Chrome 传统的顶栏和标签页设计，使用 TuffEx 和 UnoCSS 构建高颜值界面。
* **规避全量 Chrome Web Store 扩展与 DRM 授权包袱**：
  * 不把支持海量 Chrome 商店插件作为目标；
  * 高频诉求（广告拦截、深色模式、脚本增强、翻译）由 `@talex-touch/tuff-native`（Rust adblock 核心）与主进程/preload 原生提供。
* **严格的 Beta 门禁与零回归原则**：
  * **默认关闭**（`betaFeatures.browserWorkspace: false`）；
  * **未开启状态**：侧边栏完全不显示浏览器入口，路由拦截重定向回主页，应用展示与交互完全保持原有的传统启动器与项目面板形态（“展示还是之前那一套”）；
  * **开启状态**：侧边栏出现浏览器导航入口，允许进入独立工作区管理多标签页、无边框网页视口、历史记录与书签。

---

## 2. Beta 门禁与配置定义

### 2.1 存储与配置实体 (`AppSetting`)
在 `packages/utils/common/storage/entity/app-settings.ts` 中维护统一的 `betaFeatures` 状态：
```ts
export interface AppSetting {
  // ...
  betaFeatures: {
    screenshot: boolean
    voiceDictation: boolean
    voiceQuickEdit: boolean
    omniPanel: boolean
    browserWorkspace: boolean // 新增：现代浏览器工作区开关，默认 false
  }
}
```

### 2.2 用户设置界面 (`SettingGeneralPage` / 实验室特性)
* 位置：在「设置 -> 通用配置」页面提供「实验特性 (Beta)」区块。
* 组件：`SettingBetaFeatures.vue`。
* 开关文案：
  * **标题**：现代浏览器工作区（带 `Beta` 徽章）
  * **描述**：开启基于 WebContentsView 的现代化独立浏览器工作区，支持垂直标签页与无边框视口。关闭时保持传统启动器外观。
* 响应：切换后实时保存至 `appSetting.betaFeatures.browserWorkspace`，侧边栏导航响应式更新。

### 2.3 侧边栏与路由门禁
* **侧边栏 (`ShellSidebar.vue`)**：
  ```vue
  <ShellNavItem
    v-if="isBrowserWorkspaceEnabled"
    icon="i-ri-global-line"
    :label="t('shell.browser')"
    to="/browser"
  />
  ```
  未启用时，DOM 中不渲染该项，不留空位，不影响其他导航项。
* **路由守卫 (`router.ts`)**：
  在全局 `beforeEach` 中对携带 `meta.betaFeature: 'browserWorkspace'` 的路由进行拦截；未启用时直接重定向回 `/home`，防止通过深层链接误入。

---

## 3. 功能架构与分期演进

```
┌────────────────────────────────────────────────────────┐
│  Tuff 主窗口 (Vue 3 + TuffEx + UnoCSS)                 │
│ ┌───────────────┬────────────────────────────────────┐ │
│ │ 垂直侧边栏     │ 现代浏览器视口 (WebContentsView)    │ │
│ │ • 标签页列表   │ • 独立 Session 隔离                 │ │
│ │ • 新增/关闭   │ • Rust 原生 Adblock 拦截 (规划)     │ │
│ │ • 历史/书签   │ • 智能页面缩放与暗黑适配             │ │
│ │ • ⌘K 唤醒     │                                    │ │
│ └───────────────┴────────────────────────────────────┘ │
└────────────────────────────────────────────────────────┘
```

### 阶段规划
* **Phase 1（当前基础）**：
  * 主进程 `browserModule` 与 `BrowserWorkspaceManager` 管理 `WebContentsView` 视口布局与生命周期。
  * 渲染层 `BrowserPage.vue` 实现标签切换、历史与书签抽屉。
  * 补齐 Beta 门禁开关，确保默认关闭时不产生任何视觉与行为侵入。
* **Phase 2（2.5.2 核心打磨）**：
  * 标签页挂起（Tab Discarding）：针对非活跃标签页释放渲染进程，降低内存消耗。
  * 键盘快捷键体系（⌘T 新标签、⌘W 关标签、⌘L 聚焦地址栏）。
  * 网页与 CoreBox 联动（选中网页文字一键呼出 AI 解释/翻译）。
* **Phase 3（增强能力）**：
  * `@talex-touch/tuff-native` 接入 Brave 开源的 `adblock-rust`，主进程网络钩子实现秒级去广告。
  * 智能暗色模式注入。

---

## 4. 质量与验收标准

1. **零回归验收**：
   * 默认状态下运行测试或启动应用，侧边栏、快捷键、主页搜索完全为传统外观，无 `/browser` 入口暴露；
   * 单元测试覆盖：`SettingBetaFeatures` 开关渲染与状态更新、`ShellSidebar` 依据开关展示/隐藏导航项、`router` 拦截未授权访问。
2. **生命周期受控**：
   * 浏览器视口大小与坐标必须随窗口缩放（Resize）精确同步，不发生画面遮挡或错位；
   * 关闭标签页时，底层的 `WebContentsView` 与 `webContents` 必须彻底销毁，内存即时释放。
