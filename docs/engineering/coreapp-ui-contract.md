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

- `/browser` 是浏览器工作台；启用浏览器 Beta 时，`/` 默认进入该页，未启用时由路由门禁返回 `/home`。侧栏不再放置顶部“新建对话”行，该入口位于浏览器标签栏右上角，仍通过统一会话入口清除项目归属并进入 `/home`。新建网页加号位于标签旁，`⌘/Ctrl+N` 与 `⌘/Ctrl+T` 保持各自语义；已存对话仍使用 `/home/c/:id`。
- 主窗口首次启动默认为 1280 × 820，最小尺寸仍为 1100 × 680；优先恢复已保存窗口尺寸，默认尺寸继续受屏幕工作区约束，不覆盖用户调整过的布局。
- 标签栏空白区域可拖动窗口，标签与工具按钮保持 `no-drag`；标签支持横向拖放及 `Alt+Shift+←/→` 排序。`BrowserSdk.moveTab(tabId, beforeTabId)` 以现存标签作相对锚点，`null` 移至末尾；真正移动才保存和通知，不改变活动页或重建 guest，无效目标不改变顺序。
- “新建对话”旁的插件快捷栏读取 live 插件 store，最多展示 3 个固定图标，拼图菜单提供固定、功能选择与管理入口。固定偏好沿用 SQLite-backed `appSetting.shell.browserPluginPins`：`null` 为默认建议，`[]` 明确不固定；卸载插件立即从展示中移除，禁用或异常插件不可执行，启动失败明确报告。工具栏菜单打开时暂停原生 guest，离开工作台时关闭所有浮层。
- 起始页复用 Home 的模型、听写、附件和提交链路，但拥有独立草稿；浏览提交进入当前网页标签，提问提交持久化后转入真实会话。浏览起始页不触发 Home 推荐调用。
- Main 拥有标签、导航状态、最近访问和收藏；renderer 通过 `BrowserSdk` 读取快照、订阅更新并上报实际 viewport。旧 revision 不覆盖新状态，离页和遮挡层出现时隐藏原生 guest。
- 标签右键菜单提供刷新、复制及关闭当前/其他/左侧/右侧；右键后台标签不激活页面。批量关闭按执行时的 Main 快照确定范围并保留目标；仅当当前活动页属于关闭范围时先切到目标，错误通过现有重试入口报告，重试重新读取状态。菜单打开时暂停原生 guest 展示，关闭后恢复。
- 每个远程标签使用无应用 preload 的隔离 `WebContentsView`。仅接受 HTTP(S)；危险协议、URL 凭据、网站权限和下载默认拒绝。所有请求要求真实主窗口 sender 与主 frame，插件、子 frame 和进程内伪造调用均拒绝。
- 标签、最近访问和收藏保存在本机 SQLite 配置，不能经通用 Storage SDK 读取或修改；网站登录态使用独立内存 session，仅持续本次应用运行。Ego 网页代操作不属于此页的已接入能力。
- Home 与浏览起始页共同拥有确认入口：一个隐藏或销毁的页面不能撤销另一个可见页面的工具确认能力。

## Chrome Connection

- Home 顶栏与浏览器顶栏共用 `ShellAccountAvatar`。Tuff 账号沿用现有身份、登录、退出和资料弹层；Chrome 连接是独立区域，不把 Tuff 头像当作网站登录状态。浏览器 Beta 关闭时不显示连接入口，Main 同时拒绝新配对和操作并关闭已有连接，保留本地待同步数据。
- 连接器源码位于 `apps/browser-connector/`。`pnpm -C apps/core-app browser:prepare` 使用现有 esbuild 和 rustc 准备扩展及原生桥接，不下载依赖或安装到 Chrome。开发启动、应用构建、发布 workflow 与打包前后资源门禁均接入产物链；macOS 发布桥接需要已安装的 arm64/x64 Rust targets。
- 用户在头像菜单中打开“管理 Chrome 连接”，显式安装本机桥接并显示扩展文件夹；随后在 Chrome 扩展页开启开发者模式，加载该文件夹，授予书签和标签权限，并在扩展弹窗输入 Tuff 生成的两分钟一次性配对码。未完成这些步骤不得显示为已连接或已同步。暂停、断开与撤销不删除 Chrome 原始数据。
- 扩展 ID 为 `dalmacfpdfmbedbaamfinhaikanpafcl`，Native Messaging host 为 `com.talex.tuff.browser`。原生桥接从同一次有界读取取得原子 `endpoint` 描述文件中的回环地址与 Main 公钥，并在转发前向扩展提供该公钥；扩展先验证绑定本次客户端随机数的 Main 签名，Main 再验证资料签名与配对授权。Main 身份私钥仅存于内存且不能跨监听器重绑复用；扩展不可导出私钥保存在自己的 IndexedDB，获准资料公钥保存在 Main。该边界依赖受保护的本机描述文件与可信操作系统，不宣称传输加密或逐帧完整性保护。
- 连接状态与书签库不能经通用 renderer Storage、云同步或诊断内容预览外发。`browser-connection` 的 renderer 请求/响应预览与克隆诊断不记录原始内容；Main 性能接收端再次移除原始预览、扩展 metadata 和 stack，仅保留事件类型、耗时与级别等运行指标。
- `browser-connections` 是 Main 独占的 SQLite 配置。书签操作先持久化，再发送；相同操作 ID 只采用扩展日志中已有结果。执行中断且结果未知时进入冲突，不能自动新建一次。只有完整快照通过校验并完成应有持久化后，Main 才发送 `snapshot-accepted`；扩展不能将已发出消息当作同步成功。
- Chrome 书签保留节点 ID、目录和重复 URL。不可重命名的书签栏仍可接收子项，企业管理目录保持只读。离线追加互不制造冲突，未发送的重复编辑保留最新意图；递归删除需要确认且保护执行前的完整后代集合。公开 Chrome API 没有跨应用原子比较写入，仍以执行前快照比较为边界。
- 本机收藏星标保持本机语义；Chrome 收藏通过独立按钮选择资料与目录。Chrome 标签的切换、移动、导航和关闭明确作用于 Chrome；“在 Tuff 打开副本”使用 Tuff 自己的网站会话。标签 ID 不跨主进程生命周期持久化，当前连接收到新快照前不可操作；标签命令离线不排队、不自动重放。
- 标签变化使用独立轻量通知，不重复落库或推送整份书签库。Renderer 分别维护完整快照与各资料标签补丁的版本，再合成展示，避免较新标签补丁挡住较旧但尚未应用的书签变更。书签列表、标签列表和目录选择器使用虚拟列表限制实际 DOM 数量。
- 当前同步范围只有书签与非无痕标签。没有 Cookie、密码、网页正文、历史记录或 Google Chrome Sync 私有 API 接入，也没有把 Chrome 扩展加载到 Tuff 内嵌页面。Chrome 原有登录态仅留在 Chrome；所有弹层沿用原生 guest 遮挡与离页收起规则。

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
