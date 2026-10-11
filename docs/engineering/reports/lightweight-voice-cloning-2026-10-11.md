# 轻量声音克隆与科幻系统声线试听评估

> 日期：2026-10-11
> 状态：三款模型已完成本地生成，试听页已验证播放；“科技未来质感”尚未获得用户确认。
> 范围：方案调研、本地串行试跑、原创声线设计、电子后处理和磁盘占用。未接入 Tuff 产品代码，未发布服务。
> 环境：Apple M4 Pro、48 GB 统一内存、macOS arm64。生成任务串行运行，进程优先级使用 `nice -n 10`。

## 1. 当前结论

普通播报音色的克隆样本未满足用户对科技感的预期。本轮增加了原创声线设计，并把模型输出与电子后处理分开试听。

当前候选流程是：先用 Qwen3-TTS VoiceDesign 设计参考声线，再由 MOSS-TTS-Nano 或 ZipVoice-Distill 生成新台词。需要更明显的电子质感时，叠加声码器与环形调制。声线、韵律和电子处理分别控制，便于定位用户不满意的部分。

本轮证明了本地生成和网页播放可用。没有证明声音已达到电影 MOSS 的相似度，也没有完成用户听感验收。该流程是本轮工程试验，不是厂商保证的跨模型工作流。

## 2. 目标与方案范围

目标是轻量、中文、本地运行，并具有《流浪地球》MOSS 所启发的冷静系统播报风格。用户优先考虑硬盘占用，要求先看公开 Demo，再串行测试候选模型。

电影中的 MOSS 与 OpenMOSS 的 MOSS-TTS 是不同项目。电影配音来自真人演员；开源模型的名称不代表内置电影声线。

| 候选 | 调研阶段定位 | 本轮执行状态 |
| --- | --- | --- |
| MOSS-TTS-Nano | 约 100M 参数，支持中文、参考音频克隆和 ONNX 本地部署 | 已跑普通参考音色和原创合成参考声线 |
| ZipVoice-Distill | 约 123M 参数，中文与英文，支持蒸馏和 ONNX/INT8 部署 | 已跑 8 步 PyTorch 推理，本机使用 MPS |
| Qwen3-TTS | 提供 0.6B/1.7B 克隆模型及 1.7B VoiceDesign 声线设计模型 | 已跑 1.7B VoiceDesign 的 MLX 4-bit 版本；未测试 0.6B Base |
| GPT-SoVITS | 成熟的中文克隆与音频准备工具，支持零样本和少样本微调 | 只读官方资料，未安装、未试跑 |
| CosyVoice 3 | 0.5B，多语言、方言和指令控制 | 只读官方资料，未安装、未试跑 |
| MOSS-VoiceGenerator | 1.7B，直接从文字描述设计音色 | 只读官方资料，未试跑；不能与本轮 Qwen 结果混记 |
| OpenVoice V2 | 音色转换与风格控制，原生支持中文 | 只读官方资料，未试跑 |

本轮没有为了覆盖候选数量继续下载其他大型模型。官方参数规模不等于完整下载体积，音频编解码器和运行环境也要计入。

## 3. 串行测试方法

### 3.1 普通音色基线

先用 MOSS-TTS-Nano 的官方公开中文参考样本 `zh_1.wav`，生成以下原创台词：

> 系统检测到太阳风暴正在接近。请保持冷静，所有逃生舱将在三十秒后进入自动锁定状态。

Nano 使用 ONNX CPU、4 个线程、固定采样模式和随机种子 42。本轮关闭 WeTextProcessing，使用运行时的 robust 文本处理。该配置没有覆盖复杂数字归一化的完整能力。

最初的 ZipVoice 试跑使用了未经确认的参考转写，文字不完整，不计入最终对比。后续改用新生成的参考音频和对应生成文本重跑。

### 3.2 原创系统声线

Qwen 使用 `mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-4bit`。输入上面的原创台词，语言设为 Chinese，温度为 0.65，最多生成 400 个 token。未使用真人参考音频。

声线描述为：

> 标准普通话成年男性，中低音域，清晰低沉但不浑浊。未来空间站人工智能控制系统，冷静理性、礼貌而疏离，情绪起伏极小，节奏均匀、语速略慢、停顿精确，句末收束干净。无笑意、无夸张播音腔，带非人类精密感但每个字清晰。

量化模型 revision 为 `5c390979e4b93af5f2932f90742ca99c7dd04687`。主权重为 1,625,226,859 字节，SHA-256 校验值如下，下载完成后已验证匹配：

```text
d8627de7ef411f6775182925059e140a9e1edb1fde8feeb540b4fba0edee1e58
```

该模型同时下载约 682 MB 的 speech tokenizer。4-bit 名称不代表所有组件都按 4-bit 存储。

### 3.3 同一声线生成新台词

将 Qwen 的原始生成音频 `qwen-ai-native.wav` 作为合成参考音频。Nano 和 ZipVoice 按顺序生成下面的新台词：

> 指令已确认。导航核心恢复在线，能源储备剩余百分之七十三。请等待下一次同步。

两款模型使用相同参考音频和相同目标文本。ZipVoice 另外接收参考音频对应的生成文本。参考转写来自合成输入，没有经过独立人工逐字听写或 ASR 校对。

Nano 继续使用 ONNX CPU 和 4 个线程。ZipVoice 使用 Distill、8 步、4 个线程和 MPS，并启用移除长静音。未安装 k2，使用官方提供的 PyTorch 实现。因此，本轮 ZipVoice 结果不能代表 INT8/ONNX 或 k2 加速后的性能。

## 4. 本地结果与测量口径

| 输出 | 原始生成音频时长 | 命令耗时 | 原始采样率与声道 | 计时说明 |
| --- | --- | --- | --- | --- |
| Qwen 原创声线 | 7.84 s | 23.41 s | 24 kHz、单声道 | 工具报告的整次命令 wall time，含加载；权重已下载 |
| Nano 普通参考音色基线 | 9.20 s | 未独立记录 | 48 kHz、双声道 | 首次命令含下载，不用作推理速度结论 |
| Nano 克隆原创合成参考 | 6.72 s | 6.92 s | 48 kHz、双声道 | Python `perf_counter` 包围整个子进程，含模型加载和启动 |
| ZipVoice-Distill 克隆原创合成参考 | 6.92 s | 12.70 s | 24 kHz、单声道 | 与上一行采用相同计时方式，含模型加载和启动 |

这些结果来自单条短文本和单次运行，不是统计基准。Qwen 的直接声线设计与两款模型的参考音频克隆任务不同，不能直接按耗时排名。没有测首包延迟、常驻服务热运行、峰值内存或并发吞吐。

## 5. 科技感后处理

先前的降调、压缩和轻回声保留为探索记录，不作为最终推荐依据。本轮新增固定载波声码器和环形调制，并提供不同处理强度。

设原声为 `dry`，声码器输出为 `vocoder`，环形调制输出为 `ring`。实际混合参数为：

| 试听版本 | 混合参数 | 比较目的 |
| --- | --- | --- |
| A：模型原声 | `dry` | 保留声线；只做高通和响度统一 |
| B：克制冷感 | `0.88 * dry + 0.09 * vocoder + 0.06 * ring` | 测试少量合成层能否增加非人类质感 |
| C：明显数字化 | `0.55 * dry + 0.40 * vocoder + 0.08 * ring` | 测试更高合成层占比，观察自然度与清晰度的代价 |

声码器使用 20 个对数频带、92 Hz 谐波载波和 30 Hz 包络平滑。环形调制频率为 47 Hz。处理前做 75 Hz 高通；B、C 不添加回声。混合系数不是主观效果评分，也不表示响度贡献百分比。

全部对照版本使用 FFmpeg `loudnorm=I=-18:TP=-2:LRA=7`，输出为 48 kHz、单声道、16-bit PCM。这里的 -18 LUFS 和 -2 dBTP 是处理目标，不是逐条复测的达标结论。脚本读回 WAV 后记录的采样峰值约为 -2 dBFS，不能与 true peak 测量混同。

## 6. 试听页与已验证边界

本机试听入口为 `http://127.0.0.1:8765/`，只绑定 loopback，没有公网发布。页面置顶 Qwen 原创系统声线的 A/B/C，其后保留普通音色对照和两款轻量模型的接力结果。官方 Demo 另列，避免与本地生成混淆。

已在 ego-browser 实际验证：

- 11 条本地音频均能播放，播放时间实际前进，未出现媒体解码错误。
- 切换音频时，之前的音频自动暂停；同一时刻只有一个播放器播放。
- 桌面界面已截图检查。
- 390 px 窄屏下采用单列，文档宽度为 390 px，没有横向溢出。

页面采用用户点击播放。首次自动播放被浏览器拒绝后，使用真实点击激活，再逐条验证。

以下项目仍未验证：用户是否认可科技感；对电影 MOSS 的音色相似度；生成文字的逐字准确率；多音字和中英混读；长文本稳定性；不同音量下的听感；真实产品中的流式交互。

## 7. 磁盘与下载记录

以下是本轮收尾时 `du -sh` 的观测值，单位按二进制量级近似记录。各项包含在总目录中，不应再与总目录相加。

| 内容 | 实际占用 |
| --- | --- |
| 整个试听目录 | 约 4.8 GiB |
| Nano/ZipVoice 共用 Python 环境 | 约 895 MiB |
| Qwen 的隔离 MLX 环境 | 约 546 MiB |
| Qwen 下载缓存，含 tokenizer | 约 2.2 GiB |
| Nano ONNX 模型 | 约 728 MiB |
| ZipVoice 与 Vocos 核心权重 | 约 520 MiB |
| 全部本轮生成音频 | 约 19 MiB |

收尾时磁盘可用空间约 13 GiB。该数字是当时的系统快照；其他任务也在同一台机器上运行，不能把可用空间变化全部归因于本轮操作。

前期清理了确认无进程占用的临时 wheel、检查环境和旧试听任务的可重建缓存，目标合计约 2 GiB。保留了活跃的 Lima/Colima 目录、Tuff 备份、模型、源码和试听结果。

Qwen 下载经历两次超时，并产生不同随机后缀的 `.incomplete` 文件。最终从较大的残片使用 HTTP Range 续传，返回 HTTP 206；完整主权重通过 SHA-256 校验。随后移除本轮较小的重复残片，回收约 840 MiB。此前误落家目录的 ZipVoice/Vocos 权重已迁至 `/tmp`，缓存引用保留。

本轮安装的主要版本为 Python 3.12.14、PyTorch 2.7.0、ONNX Runtime 1.31.0、MLX 0.32.3、mlx-audio 0.5.8 和 FFmpeg 9.0.1。虽然模型走 ONNX，本轮 Nano 官方 Python 入口仍导入 torch/torchaudio，实际环境占用不能按“完全无 PyTorch”估算。

## 8. 归档与复用边界

本报告归档方法、参数、测量结果、结论和限制。临时音频、截图、下载缓存、运行日志和 Python 环境不复制进仓库。

当前本机材料保存在 `/tmp/voice-clone-audition/`：

- `index.html`：试听页。
- `generated/qwen-ai-native.wav`：未经电子处理的原创合成参考声线。
- `generated/qwen-ai-{dry,cold,digital}.wav`：原创声线 A/B/C。
- `generated/nano-clone-{dry,cold}.wav` 和 `generated/zip-clone-{dry,cold}.wav`：新台词的轻量模型对照。
- `comparison.json`：两款轻量模型的本次计时与音频格式记录。
- `render_future.py`：声码器、环形调制和统一输出处理。
- `run_lightweight_comparison.py`：同一合成参考下的串行生成入口。

`/tmp` 文件和本机 HTTP 服务都不是永久归档。目录清理、重启或服务退出后，试听入口可能失效。没有声称本报告包含可永久播放的附件，也没有把当前试听结果登记为产品验收通过。

## 9. 后续选择与权限边界

先由用户比较 Qwen 的 A/B/C。若主要差异来自新声线，应固定声线和韵律后再评估轻量克隆；若电子层符合预期，应继续调整处理强度，并检查可懂度。听感方向未确认前，不追加下载其他大型模型。

模型或代码的 Apache-2.0/MIT 许可不包含配音演员、电影录音或角色商业使用授权。当前试验使用原创台词与合成声线；最早的普通音色基线采用官方公开演示音频，不据此声称获得真人商业克隆授权。精确复刻电影原声或公开提供相关服务，需要另行确认声音权益、录音版权及适用的生成合成内容标识要求。

## 10. 官方资料

- [MOSS-TTS-Nano 仓库](https://github.com/OpenMOSS/MOSS-TTS-Nano)与[公开 Demo](https://openmoss.ai/MOSS-TTS-Nano-Demo/)。
- [ZipVoice 仓库](https://github.com/k2-fsa/ZipVoice)与[公开 Demo](https://zipvoice.github.io/)。
- [Qwen3-TTS 仓库](https://github.com/QwenLM/Qwen3-TTS)和[本轮 MLX 4-bit VoiceDesign 模型](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-4bit)。
- [MLX-Audio 的 Qwen3-TTS 用法](https://github.com/Blaizzy/mlx-audio/blob/main/docs/models/tts/qwen3-tts.md)。
- [GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS)、[CosyVoice](https://github.com/QwenAudio/CosyVoice)、[MOSS-VoiceGenerator](https://huggingface.co/OpenMOSS-Team/MOSS-VoiceGenerator)和[OpenVoice](https://github.com/myshell-ai/OpenVoice)。
- [电影 MOSS 配音幕后采访](https://m.bjnews.com.cn/detail/1676550676168886.html)。
- [《互联网信息服务深度合成管理规定》](https://www.gov.cn/zhengce/zhengceku/2022-12/12/content_5731431.htm)和[《人工智能生成合成内容标识办法》](https://www.cac.gov.cn/2025-03/14/c_1743654684782215.htm)。
