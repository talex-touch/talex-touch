# BetterWispr 竞品调研与 Tuff 听写优化方向

> 日期：2026-10-12
> 对象：BetterWispr 0.1.5；源码 `c10b57fd9525216045ab7e9e35d851bacca5cfe7`。
> 状态：调研完成；Tuff 优化方向为建议，未实施，不改变现有版本范围或全局优先级。
> 方法：官方产品页、隐私声明、发行记录、固定版本源码、公开用户讨论；真实浏览器查看网页，直接编译执行清理与纠错学习规则。
> 验证限制：未安装竞品，未下载模型，未测真实识别、原生界面、跨应用粘贴或会议音频。

## 1. 值得研究的是听写产品细节

BetterWispr 把本地识别、文本清理、跨应用输入和纠错学习串成了日常工具。对 Tuff，优先借鉴个人词库、写作模式和失败后的文本找回。不建议因此替换现有语音引擎。

免费、无账号，支持 macOS 14+，推荐 Apple Silicon。Swift／SwiftUI 原生应用，菜单栏常驻。项目使用 Apache-2.0，模型权重和第三方依赖另有条款。

2026-10-12 调研时核对的最新发布是 **0.1.5**。源码固定到 `c10b57fd9525216045ab7e9e35d851bacca5cfe7`，与发布页一致。未安装应用，未验证实际麦克风、识别速度和跨应用粘贴。

来源：[官网](https://betterwispr.com/) · [源码与许可证](https://github.com/opennookorg/betterwispr) · [0.1.5 发布](https://github.com/opennookorg/betterwispr/releases/tag/v0.1.5)

## 2. 两套独立模型，各自决定数据去向

语音模型负责把录音转成文字。笔记模型负责 Medium 润色、会议摘要和部分纠错审核。两者可以独立选择，本地语音配云端润色仍会上传文本。

| 能力 | 实现与使用边界 |
|---|---|
| 听写入口 | 默认按住 ⌥ Space，松开后完整识别；也支持按键切换录音 |
| 本地语音 | Apple Speech、FluidAudio 的 Parakeet、WhisperKit 的 Whisper |
| 录音中预览 | 0.1.5 的 Parakeet 可显示确认词和临时猜测；最终粘贴仍用整段识别 |
| 文本清理 | None 不做填充词清理；Light 用规则；Medium 再调用笔记模型 |
| 写作模式 | 口述触发词优先于网站，网站优先于应用；可覆盖语气、清理和上下文 |
| 词库学习 | 从历史编辑或粘贴后的修改提取词级替换；可撤销新学词条 |
| 会议记录 | 麦克风与其他应用音频分轨；结束后生成摘要、决策和待办 |
| 外部服务 | 可选语音 API、Claude Code、Codex 或兼容 API 的笔记模型 |

依赖版本固定为 WhisperKit 所在包 1.1.0、FluidAudio 0.17.5、Sparkle 2.10.0。它主要组合现成识别引擎，差异集中在输入体验和文本处理。

来源：[依赖](https://github.com/opennookorg/betterwispr/blob/c10b57fd9525216045ab7e9e35d851bacca5cfe7/Package.swift#L12-L20) · [处理顺序](https://github.com/opennookorg/betterwispr/blob/c10b57fd9525216045ab7e9e35d851bacca5cfe7/Sources/BetterWispr/App/AppModel.swift#L398-L483) · [模式优先级](https://github.com/opennookorg/betterwispr/blob/c10b57fd9525216045ab7e9e35d851bacca5cfe7/Sources/BetterWisprCore/Domain/WritingMode.swift#L121-L130)

## 3. 中文识别可选，英文后处理不能照搬

Parakeet Ultra 和 TDT v3 支持 25 种欧洲语言，不含中文。日文使用独立模型。中文需要选择 Whisper、可用的 Apple 本地语言包或外部服务。

| 中文相关能力 | 结论 |
|---|---|
| 语音转文字 | 有可选模型，但本次未测中文准确率 |
| 填充词与口误清理 | 规则限定英文；中文原样保留，仅去首尾空白 |
| Medium 润色与语气 | 当前应用处理分支限定英文 |
| 语音标点命令 | 主要是英文口令，不能直接映射为中文能力 |
| 自动纠错学习 | 规则按空白分词并使用英文常用词过滤；中文需要重新设计 |
| 个人术语 | 思路值得采用，需另测中文、中英混说和代码标识符 |

源码目录标注的模型体积：Parakeet Ultra 约 730 MB，压缩 Whisper Turbo 约 650 MB，完整 Turbo 约 1.6 GB。这些是目录估计，不是本次下载实测。

官网 FAQ 仍描述停止录音后才开始识别。0.1.5 已增加录音中的 Parakeet 预览，应以发布和源码区分新旧行为。

来源：[模型与语言目录](https://github.com/opennookorg/betterwispr/blob/c10b57fd9525216045ab7e9e35d851bacca5cfe7/Sources/BetterWisprCore/Speech/SpeechProvider.swift#L32-L56) · [清理语言门禁](https://github.com/opennookorg/betterwispr/blob/c10b57fd9525216045ab7e9e35d851bacca5cfe7/Sources/BetterWisprCore/Transcription/TranscriptCleaner.swift#L27-L46) · [学习规则](https://github.com/opennookorg/betterwispr/blob/c10b57fd9525216045ab7e9e35d851bacca5cfe7/Sources/BetterWisprCore/Transcription/CorrectionLearner.swift#L25-L57)

## 4. 本地优先成立，但隐私与交付仍有边界

| 边界 | 已核对事实与风险 |
|---|---|
| 本地识别 | Apple 路径强制 requiresOnDeviceRecognition；不支持时失败，不自动转云 |
| 云端处理 | 主动选择语音 API 会上传录音；云端笔记模型会接收润色或摘要文本 |
| 屏幕上下文 | 默认关闭；开启后可读取选中文本、剪贴板和当前窗口文字，并交给笔记模型 |
| 上下文保护 | 跳过安全输入、密码字段和标记为秘密的剪贴板；可选截图文字识别需要录屏权限 |
| 本地历史 | 默认开启，保存原始与处理后文本；应用自身不加密，目录与文件限制访问权限 |
| 录音保留 | 普通听写完成后清理临时录音；崩溃可留下文件，会议录音另行保存 |
| 粘贴实现 | 核对原应用仍在前台，再向它发送 ⌘V；不抢回焦点，受阻时复制文本 |
| 粘贴确认 | 返回 pasted 只说明已发送按键，没有目标应用的接收确认 |

**“任意应用”应理解为尽力兼容，不是保证落入原输入框。** 输出代码校验应用进程，没有锁定录音开始时的输入字段。[INFERENCE] 用户在同一应用内移动焦点，仍存在目标变化风险。此项来自源码，未实测复现。

自动粘贴临时占用剪贴板，750 ms 后尝试恢复。恢复前检查变更计数，避免覆盖期间新复制的内容。这个保护值得参考，但固定等待不等于粘贴确认。

来源：[隐私声明](https://betterwispr.com/privacy) · [输出实现](https://github.com/opennookorg/betterwispr/blob/c10b57fd9525216045ab7e9e35d851bacca5cfe7/Sources/BetterWisprCore/Integrations/TextOutput.swift#L25-L73) · [上下文读取](https://github.com/opennookorg/betterwispr/blob/c10b57fd9525216045ab7e9e35d851bacca5cfe7/Sources/BetterWisprCore/Integrations/ContextCapture.swift#L12-L59)

## 5. 对 Tuff，先补个性化，不重做已有能力

以下是建议，不是实施计划，不改变现有版本范围或全局优先级。Tuff 对照来自 2026-10-12 工作区源码，未在本次重新验收运行时。

| 方向 | Tuff 当前证据 | 建议 |
|---|---|---|
| 全局听写与改口 | global-dictation.ts 已接规范语音会话，Beta 手动启用 | 沿用现有会话，不另建录音入口 |
| 本地模型管理 | speech-model-service.ts 已有目录、校验、安装和运行时管理 | 不因 BetterWispr 重做模型下载 |
| 清理与按应用格式化 | voice-service.ts 有润色档位；app-context 有终端、代码、聊天等配置 | 补可编辑设置，而非增加第二套格式化器 |
| 个人词库与纠错学习 | 本次检索未见完整用户词库学习流程；报告文案明确未启用 | 第一优先；先显式词条，再做可撤销的学习 |
| 网站与口述模式 | 当前格式配置主要按应用；本次未见同类用户模式流程 | 第二优先；规则匹配和文字改写分开 |
| 找回原文与输入反馈 | 已有历史、统计、交付回退及增量输入代码 | 对照真实界面检查可发现性，避免重复建设 |
| 会议转录与说话人区分 | 是另一套采集、持久化和摘要产品 | 独立评估，不夹带进听写改进 |

BetterWispr 会监听粘贴后约 30 秒内用户如何修改文字。它还处理 Electron 辅助功能暴露延迟。Tuff 可借鉴用户体验，但跨应用读取必须有独立、可关闭的授权边界。

当前代码已经有增量交付逻辑，不能把 BetterWispr 的实时预览当成 Tuff 完全缺失的能力。两者的目标不同：预览不改输入框，增量交付会写入目标。

Tuff 源码证据（行号为调研时位置，后续变更可能移动）：

- [全局听写与改口](../../../apps/core-app/src/main/modules/voice/global-dictation.ts)：40～46 行。
- [本地模型管理](../../../apps/core-app/src/main/modules/voice/speech-model-service.ts)：1～19 行。
- [历史、统计与应用格式化](../../../apps/core-app/src/main/modules/voice/voice-service.ts)：733～750 行和 1246 行。
- [应用格式配置](../../../apps/core-app/src/main/modules/voice/app-context/profiles.ts)：216～240 行。
- [增量交付](../../../apps/core-app/src/main/modules/voice/voice-live-delivery.ts)：76～114 行。
- [个性化学习状态文案](../../../apps/core-app/src/renderer/src/modules/lang/en-US.json)：1384～1385 行。

词库判断限定本次检索范围，不能外推为整个仓库不存在任何词表协议或解码提示。

来源：[纠错监听](https://github.com/opennookorg/betterwispr/blob/c10b57fd9525216045ab7e9e35d851bacca5cfe7/Sources/BetterWisprCore/Integrations/CorrectionWatcher.swift#L12-L38)

## 6. 维护活跃，但还不能据此判断成熟或更准确

更新日志从 10 月 8 日的 0.1.0 到 10 月 12 日的 0.1.5。修复覆盖下载崩溃、蓝牙采集、文本误删和会议音频时间对齐。迭代快，也说明真实设备上的兼容性仍在收敛。

作者公开了测试集、评估脚本和负面结果，这比只展示打字动画有价值。但数据不是独立评测，也不能证明中文或这台机器上的体验。

| 作者发布的数据 | 原方案 | 新方案 | 适用范围 |
|---|---:|---:|---|
| 语音词错误率 | TDT v3：15.96% | Ultra：14.45% | 300 段印度、尼日利亚和美国英语；清理前 |
| 词归属正确率 | 不切分：85% | 按声音变化切分：93% | 6 场双人远程通话；不代表同室多人 |

词错误率越低越好，词归属正确率越高越好。第二项改进会重新识别切分片段，使用语音 API 时会再次发送音频。作者也报告短片段带来少量识别损失。

官网打字／说话动画明确标为模拟，不是性能基准。Hacker News 有正面试用反馈，也有人质疑与 Handy、VoiceInk 的差异；不能把这些评论换算成准确率。

来源：[作者数据与限制](https://github.com/opennookorg/betterwispr/releases/tag/v0.1.5) · [上线讨论](https://news.ycombinator.com/item?id=50042333)

## 7. 本次实际验证与下一步判断门槛

已用真实浏览器查看官网和隐私页。已下载固定源码，直接编译并执行清理器和纠错学习器，未构建整个应用，也未下载模型。

| 源码行为探针 | 实际结果 |
|---|---|
| 英文填充词与重复 | “um we can we can deploy the app” → “We can deploy the app” |
| 英文口述纠正 | Delhi 的口误被改为最终说出的 Ahmedabad |
| 有意强调 | “more and more and more” 保留 |
| 中文清理边界 | “嗯，我们我们明天发版。”原样保留 |
| 专有名词学习 | 从 “post hog” → “PostHog” 的修改提取词条 |
| 整句改写 | 不学习为词库替换 |

这证明了这些规则的实际行为，不证明语音识别质量。未覆盖原生应用界面、麦克风切换、真实粘贴、会议分轨和说话人识别。

若要决定是否接入 FluidAudio，应先用同一批中文、中英混说与技术术语录音，对比 Tuff 现有引擎。还要测冷启动、松键到落字时间和输入失败率。只有测出真实收益，才值得增加 macOS 专用实现。
