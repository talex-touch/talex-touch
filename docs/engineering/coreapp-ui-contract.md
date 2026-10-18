# CoreApp UI Contract

> 更新时间：2026-10-17
> 定位：CoreApp renderer UI 组件使用边界，约束本地 legacy UI 向 TuffEx primitives 渐进收口。

## Contract

- 页面层与业务功能代码优先直接使用 TuffEx primitives，例如 `TxButton`、`TxModal`、`TxDrawer`、`TxSwitch`、`TxSelect`、`TxTabs`、`TxIcon`。
- 业务组合层可以继续保留 CoreApp 语义组件，例如 `TuffGroupBlock`、`TuffBlockSlot`、`StatusIcon`，但内部 primitive 必须委托 TuffEx。
- 兼容层只用于迁移期保留历史 API，不允许承载新视觉或交互能力；新代码不得新增对 `components/base/tuff`、`components/base/select`、`components/base/switch`、`components/tabs`、`components/menu` 中 primitive 的依赖。
- `FlipDialog` 暂作为 CoreApp 对 `TxFlipOverlay` 的行为门面保留，直到引用点完成批量迁移。
- `TouchMenu` / `TTabs` 等历史导航面暂不第一阶段迁移，后续按主导航与页面 tab 体验单独切片。

## Current Pilot

- Renderer 根部通过 `TX_ICON_CONFIG_KEY` 注入 CoreApp icon 配置，统一 `file`、本地绝对路径、`/api/*` 与 SVG fetch 行为。
- 直接引用本地 `TuffIcon` 的页面与组件已切到 `@talex-touch/tuffex/icon` 的 `TxIcon`。
- `TButton`、`TModal`、`TSwitch` 新调用已迁到 TuffEx；旧文件仅作为 legacy adaptor 暂留。
- `TuffBlock*` 属业务组合层，当前保留 API，并将内部 switch/icon/input/select primitive 收口到 TuffEx。
- Drawer pilot 已从能力测试弹层迁到 `TxDrawer`；复杂多抽屉场景继续走后续小切片。

## Browser Workspace

- `/browser` 是浏览器工作台，`/` 默认进入该页；侧栏不再放置顶部“新建对话”行，该入口位于浏览器标签栏右上角，仍通过统一会话入口清除项目归属并进入 `/home`。新建网页加号位于标签旁，`⌘/Ctrl+N` 与 `⌘/Ctrl+T` 保持各自语义；已存对话仍使用 `/home/c/:id`。
- 主窗口首次启动默认为 1280 × 820，最小尺寸仍为 1100 × 680；优先恢复已保存窗口尺寸，默认尺寸继续受屏幕工作区约束，不覆盖用户调整过的布局。
- 起始页复用 Home 的模型、听写、附件和提交链路，但拥有独立草稿；浏览提交进入当前网页标签，提问提交持久化后转入真实会话。浏览起始页不触发 Home 推荐调用。
- Main 拥有标签、导航状态、最近访问和收藏；renderer 通过 `BrowserSdk` 读取快照、订阅更新并上报实际 viewport。旧 revision 不覆盖新状态，离页和遮挡层出现时隐藏原生 guest。
- 标签右键菜单提供刷新、复制及关闭当前/其他/左侧/右侧；右键后台标签不激活页面。批量关闭按执行时的 Main 快照确定范围并保留目标；仅当当前活动页属于关闭范围时先切到目标，错误通过现有重试入口报告，重试重新读取状态。菜单打开时暂停原生 guest 展示，关闭后恢复。
- 每个远程标签使用无应用 preload 的隔离 `WebContentsView`。仅接受 HTTP(S)；危险协议、URL 凭据、网站权限和下载默认拒绝。所有请求要求真实主窗口 sender 与主 frame，插件、子 frame 和进程内伪造调用均拒绝。
- 标签、最近访问和收藏保存在本机 SQLite 配置，不能经通用 Storage SDK 读取或修改；网站登录态使用独立内存 session，仅持续本次应用运行。Ego 网页代操作不属于此页的已接入能力。
- Home 与浏览起始页共同拥有确认入口：一个隐藏或销毁的页面不能撤销另一个可见页面的工具确认能力。

## Advanced Appearance Settings

- `dev.advancedSettings` 由“关于 → 高级设置”控制，正式版也提供入口；默认 `false`，缺失或非布尔 `true` 的历史值不显示高级内容。
- `ThemeStyle.vue` 的 CoreBox 自定义与壁纸细项仅在开关为 `true` 时挂载。关闭只隐藏编辑入口，不重置已保存的布局、壁纸或滤镜。
- 普通外观设置继续显示窗口效果、色彩风格、壁纸来源、模糊与透明度；高级设置不等于开发者模式，不开放内部插件或调试能力。

## Validation

- 本地 contract 扫描：`pnpm check coreapp-ui-contract`。CI 的 `Check CoreApp UI contract` 步骤跑同一条命令。
  该门禁此前 import 了工作区从未声明的 `globby`，每次调用都以 `ERR_MODULE_NOT_FOUND` 退出，实际一次也没跑过；
  现已改用其余 `check-*` 脚本统一的 `readdirSync` 遍历。
- 最近路径类型检查：`pnpm -C "apps/core-app" run typecheck:web`。
- Icon 配置单测：`pnpm -C "apps/core-app" exec vitest run "src/renderer/src/modules/tuffex/icon-config.test.ts" "src/renderer/src/components/base/tuff-icon-rendering.test.ts"`。
