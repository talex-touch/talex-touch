# Android 车载 / KTV 点歌机轻量语音 SDK 集成规约

> 文档版本：1.0（2026-10）  
> 适用范围：Android 车载中控机、KTV 点歌机、定制 Android 终端；离线唤醒词、实时中文命令识别、可选本地音频采集。  
> 参考实现：sherpa-onnx Android AAR/JNI + 本 SDK 的 Java API。  
> 术语：文中“事实”指上游文档或 Android 官方文档明确给出的值；“预算/估算”是工程验收前的目标范围，不是任何特定主板的实测承诺。

## 1. 结论与推荐交付形态

1. **以 AAR 作为 Android 交付物，Java/Kotlin 只暴露业务接口，sherpa-onnx 和 JNI 隔离在实现层。** 业务方不应直接接触 `OnlineRecognizer`、`OnlineStream`、ONNX 配置或指针生命周期。
2. **首发只支持 `arm64-v8a` 和 `armeabi-v7a`。** 车载新机优先 arm64；仍有 32 位系统/应用的老设备再保留 armeabi-v7a。不要把 x86 ABI 放进量产包；x86/x86_64 仅用于模拟器或实验室。
3. **唤醒和命令识别分两级：**
   - 常驻阶段使用小型 KWS 模型，保持低功耗；识别到唤醒词后才进入命令识别。
   - 命令识别使用 streaming Zipformer/Paraformer 等模型；命令结束由 endpoint/VAD 判定，不把整段音频无限送入识别器。
4. **模型版本和 JNI 版本必须锁定并同一发布单元验收。** AAR 的 classes.jar、`.so`、模型文件不可跨版本自由替换。
5. **音频线程不得阻塞。** `feedAudio` 是实时热路径：固定 16 kHz、单声道、PCM 16-bit，调用方不转移 byte 数组所有权；SDK 应尽快入有界队列，识别在独立线程执行。
6. **被动唤醒不默认抢音频焦点。** KTV 正在播放歌曲时，唤醒监听应只占用麦克风；真正开始播报/录入命令时按产品策略短暂请求音频焦点。若 OEM 音频策略要求，提供显式 `REQUEST_TRANSIENT` 选项。

## 2. sherpa-onnx Android AAR 机制

### 2.1 上游可复现的打包流程

官方 `android/SherpaOnnxAar/README.md` 的流程是：下载 release 的 Android native tarball，将每个 ABI 下的 `.so` 复制到 `android/SherpaOnnxAar/sherpa_onnx/src/main/jniLibs/<abi>/`，再执行：

```bash
./gradlew :sherpa_onnx:assembleRelease
# sherpa_onnx/build/outputs/aar/sherpa_onnx-release.aar
```

示例 release v1.13.8 的 native 包为：

```text
sherpa-onnx-v1.13.8-android.tar.bz2
# RK NPU 设备使用对应的 -android-rknn.tar.bz2 变体
```

上游构建文档明确列出 `arm64-v8a`、`armv7-eabi`、`x86_64`、`x86` 四种构建目标；Android ABI 目录名称对外应使用 `armeabi-v7a`（上游脚本中的 `armv7-eabi` 对应该 Android ABI）。量产本 SDK 只收录前两种。

### 2.2 AAR 内部结构

AAR 本质是 ZIP。Android 官方库格式允许以下内容；本 SDK 应保持目录简单、无重复 native 库：

```text
vod-voice-sdk-1.0.0.aar
├── AndroidManifest.xml
├── classes.jar                         # 对业务暴露的 Java/Kotlin API，以及实现类
├── jni/
│   ├── arm64-v8a/
│   │   ├── libsherpa-onnx-jni.so
│   │   └── libonnxruntime.so
│   └── armeabi-v7a/
│       ├── libsherpa-onnx-jni.so
│       └── libonnxruntime.so
├── assets/
│   └── vod_voice/
│       └── models/<model-version>/
│           ├── tokens.txt
│           ├── encoder*.onnx
│           ├── decoder*.onnx
│           └── joiner*.onnx
├── proguard.txt
└── R.txt / res/                         # 若本 SDK 没有资源，可为空或省略
```

`classes.jar` 是 Java/Kotlin 字节码；`jni/<abi>/*.so` 在应用打包时按 ABI 合并到最终 APK/AAB；`assets/` 会合并到应用的 `AssetManager` 命名空间。AAR 本身不是一个可直接安装的 APK，最终体积和压缩方式由消费方的 APK/AAB、ABI split、AGP 版本决定。

**不要**把模型放到 `res/raw` 再用资源 ID 传给 sherpa。官方 Android 示例按 `AssetManager` 和相对于 assets 根的字符串路径配置模型，例如 `sherpa-onnx-streaming-.../encoder...onnx`。SDK 应将模型根固定为 `vod_voice/models/<version>/`，通过 `context.getAssets()` 传入 native 构造器；如果选用的底层 API 只接受文件路径，则首次初始化时以流复制到 `filesDir/vod_voice/<sha256>/`，先写临时文件、fsync/close 后原子 rename，并校验 SHA-256。

### 2.3 ABI 与体积预算

以下是 sherpa-onnx 官方 Android build 文档给出的示例 native 输出（不同 release、编译开关、符号裁剪会改变大小）：

| ABI | `libonnxruntime.so` | `libsherpa-onnx-jni.so` | 该 ABI native 输出约合 | 结论 |
|---|---:|---:|---:|---|
| arm64-v8a | 15 MB | 3.7 MB | 18.7 MB | 现代车机首选 |
| armeabi-v7a | 10 MB | 2.1 MB | 12.1 MB | 兼容旧 32 位终端 |
| x86_64 | 17 MB | 4.0 MB | 21.0 MB | 仅模拟器/测试 |
| x86 | 17 MB | 3.9 MB | 20.9 MB | 仅模拟器/测试 |

这是 native **构建目录的未压缩示例值**，不是用户下载体积。上游同一页的 APK Analyzer 示例指出，压缩/裁剪后的运行时（共享库合计）约 7.2 MB，其中 `libonnxruntime.so` 约 5.8 MB；该页面同时说明这是 full build，custom/mobile build 可继续缩小。不要把 15 MB 和 5.8 MB 当作矛盾数据：前者是一个构建输出样本，后者是最终 APK 分析样本，release、压缩和版本可能不同。

若 AAR 同时包含两种量产 ABI，native 未压缩预算约 `18.7 + 12.1 = 30.8 MB`，此外还要加 `classes.jar`、模型和 ZIP 元数据。作为交付策略：

- **推荐**：AAR 保留两个 ABI，消费方在 `defaultConfig.ndk.abiFilters` 选目标 ABI；或者发布 `arm64`/`armeabi-v7a` 两个变体。
- **不要**让 `x86` 随量产 AAR 进入最终 APK；AAB/ABI split 只在确实启用 split 时才会剔除未用 ABI。
- **模型体积往往比 runtime 更大。** 官方示例的 float32 bilingual Zipformer 模型仅 encoder 就约 315 MB，整个 debug APK 约 329 MB；KTV 交付必须选择 int8/streaming 小模型，并从模型包删除测试 wav、脚本、README、备用精度模型等非运行文件。
- ONNX Runtime 官方移动端文档展示了 custom build 可显著缩小 runtime（具体比例依模型算子而定）。量产应生成 operator config，验证 sherpa 所需算子完整后再裁剪，不能仅凭文件大小替换 full runtime。

消费方 Gradle 示例：

```gradle
android {
    defaultConfig {
        minSdk 23
        // 量产车机：按实际系统二选一；多 ABI 发行时填写两项
        ndk { abiFilters 'arm64-v8a', 'armeabi-v7a' }
    }
    packaging {
        jniLibs { useLegacyPackaging = false }
    }
}

dependencies {
    implementation files('libs/vod-voice-sdk-1.0.0.aar')
}
```

若使用 Maven，应发布 POM、AAR、sources/javadoc（如有）、SHA-256 和 SBOM；不要让业务方自行下载 sherpa release 并覆盖 SDK 内部 `.so`。

### 2.4 native 加载与模型加载顺序

sherpa 的 Kotlin API 在 `OnlineRecognizer`/`OnlineStream` 静态初始化中加载 `System.loadLibrary("sherpa-onnx-jni")`；JNI 再解析 ONNX Runtime 和模型。SDK 应在后台初始化线程执行以下顺序：

1. 检查 `Build.SUPPORTED_ABIS` 与 SDK 编译 ABI；不支持时返回 `UNSUPPORTED_ABI`，不让应用崩溃。
2. 让类加载触发 JNI，捕获 `UnsatisfiedLinkError`，记录 ABI、SDK 版本、native SHA-256。
3. 检查 `assets/vod_voice/models/<version>/` 的必需文件和 manifest hash。
4. 通过 `AssetManager` 创建 `OnlineRecognizer`；配置 `provider="cpu"`、`numThreads`、模型类型、endpoint 规则、hotwords（若使用）。
5. 创建单一 `OnlineStream`；每次开始一条命令时 reset 或创建新 stream，停止时调用 `inputFinished()`，然后释放 stream 和 recognizer。

一个 manager 实例只允许一个识别流；若产品必须同时识别多个麦克风，应创建多个实例并评估模型内存与 CPU 预算，禁止无上限创建 stream。

## 3. 面向业务的 Java API 规范

### 3.1 公共契约

所有公共方法线程安全，但 `feedAudio` 设计为音频采集线程调用；它不得等待模型推理。回调默认在 SDK 的单线程 executor（不是主线程）触发。业务需要更新 UI 时自行切回主线程。`byte[]` 只在调用期间读取，调用返回后可立即复用/修改。

```java
package com.example.vodvoice;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

public interface VodVoiceWakeupManager extends AutoCloseable {
    enum State { NEW, LOADING, READY, LISTENING, PAUSED, STOPPED, ERROR, RELEASED }
    enum AudioFocusPolicy { NEVER, REQUEST_TRANSIENT, REQUEST_GAIN }

    interface Listener {
        void onReady();
        void onStateChanged(@NonNull State state);
        void onCommandDetected(@NonNull String command,
                               float confidence,
                               long latencyMs);
        void onError(@NonNull ErrorCode code, @NonNull String message,
                     @Nullable Throwable cause);
    }

    enum ErrorCode {
        INVALID_ARGUMENT, UNSUPPORTED_ABI, MODEL_NOT_FOUND,
        MODEL_CHECKSUM_FAILED, NATIVE_LOAD_FAILED, AUDIO_FOCUS_DENIED,
        QUEUE_OVERFLOW, ENGINE_FAILURE, ALREADY_RELEASED
    }

    final class Config {
        public final int sampleRateHz;       // REQUIRED: 16000
        public final int channels;           // REQUIRED: 1
        public final int pcmBytesPerSample;  // REQUIRED: 2, signed little-endian
        public final String modelVersion;
        public final String modelAssetRoot;
        public final int numThreads;         // start with 1; benchmark 2/3
        public final float minConfidence;
        public final AudioFocusPolicy audioFocusPolicy;
        public final boolean keepAliveInBackground;

        private Config(Builder b) {
            sampleRateHz = b.sampleRateHz;
            channels = b.channels;
            pcmBytesPerSample = b.pcmBytesPerSample;
            modelVersion = b.modelVersion;
            modelAssetRoot = b.modelAssetRoot;
            numThreads = b.numThreads;
            minConfidence = b.minConfidence;
            audioFocusPolicy = b.audioFocusPolicy;
            keepAliveInBackground = b.keepAliveInBackground;
        }

        public static final class Builder {
            private int sampleRateHz = 16000;
            private int channels = 1;
            private int pcmBytesPerSample = 2;
            private String modelVersion = "kws-command-1";
            private String modelAssetRoot = "vod_voice/models/kws-command-1";
            private int numThreads = 1;
            private float minConfidence = 0.70f;
            private AudioFocusPolicy audioFocusPolicy = AudioFocusPolicy.NEVER;
            private boolean keepAliveInBackground = true;

            public Builder modelVersion(@NonNull String value) {
                modelVersion = value; return this;
            }
            public Builder modelAssetRoot(@NonNull String value) {
                modelAssetRoot = value; return this;
            }
            public Builder numThreads(int value) {
                if (value < 1 || value > 4) throw new IllegalArgumentException("numThreads");
                numThreads = value; return this;
            }
            public Builder minConfidence(float value) {
                if (value < 0f || value > 1f) throw new IllegalArgumentException("confidence");
                minConfidence = value; return this;
            }
            public Builder audioFocusPolicy(@NonNull AudioFocusPolicy value) {
                audioFocusPolicy = value; return this;
            }
            public Builder keepAliveInBackground(boolean value) {
                keepAliveInBackground = value; return this;
            }
            public Config build() {
                if (sampleRateHz != 16000 || channels != 1 || pcmBytesPerSample != 2) {
                    throw new IllegalArgumentException("Only 16 kHz mono PCM16 is supported");
                }
                return new Config(this);
            }
        }
    }

    interface Factory {
        @NonNull VodVoiceWakeupManager create(@NonNull Context context,
                                               @NonNull Config config,
                                               @NonNull Listener listener);
    }

    /** Asynchronously validates assets and creates the native recognizer. */
    void initialize();
    void startListening();
    void pause();
    void resume();
    void stopListening();

    /**
     * Enqueues size bytes of signed little-endian PCM16. Returns false only if
     * not listening, released, or the bounded queue is full. Never blocks.
     */
    boolean feedAudio(@NonNull byte[] pcmData, int size);

    State getState();
    void release();
    @Override void close();
}
```

上面是**接口约定**，实现包中不能保留示例方法体。正式实现必须将这些方法连接到真实 recognizer，不得返回固定值或吞掉错误。

### 3.2 业务侧最小接入

```java
VodVoiceWakeupManager.Config config =
    new VodVoiceWakeupManager.Config.Builder()
        .modelVersion("kws-command-1")
        .modelAssetRoot("vod_voice/models/kws-command-1")
        .numThreads(1)
        .minConfidence(0.72f)
        // 歌曲播放时被动监听，不抢焦点；命令录入场景可改为 REQUEST_TRANSIENT
        .audioFocusPolicy(VodVoiceWakeupManager.AudioFocusPolicy.NEVER)
        .keepAliveInBackground(true)
        .build();

// sdkFactory 由 AAR 的初始化入口提供；Application 中持有它即可。
VodVoiceWakeupManager manager = sdkFactory.create(
    applicationContext, config, new VodVoiceWakeupManager.Listener() {
        @Override public void onReady() { /* 开启 AudioRecord 后 startListening */ }
        @Override public void onStateChanged(VodVoiceWakeupManager.State state) { }
        @Override public void onCommandDetected(String command, float confidence,
                                                 long latencyMs) {
            // 将 command 映射为点歌机白名单命令；不要直接执行任意文本
        }
        @Override public void onError(VodVoiceWakeupManager.ErrorCode code,
                                      String message, Throwable cause) { }
    });
manager.initialize();
```

### 3.3 内部音频桥接规约

AudioRecord 使用 `AudioFormat.CHANNEL_IN_MONO`、`ENCODING_PCM_16BIT`、16,000 Hz；先用 `getMinBufferSize`，再分配至少 100 ms、通常 200–500 ms 的环形缓冲。每块推荐 10–20 ms（320–640 bytes）；块太小会增加 JNI 调用开销，块太大则增加检测延迟。

每个音频块的内部流程：

```text
AudioRecord.read(byte[], 0, n)
  -> feedAudio(byte[], n)                // 只入有界队列，不做推理
  -> worker: little-endian short -> float [-1, 1]
  -> OnlineStream.acceptWaveform(float[], 16000)
  -> while OnlineRecognizer.isReady(stream): decode(stream)
  -> endpoint / final result -> onCommandDetected(...)
```

`feedAudio` 的 `size` 必须是 2 的倍数；非法大小返回 `false` 并报告 `INVALID_ARGUMENT`。队列满时宁可丢弃最新块并报告 `QUEUE_OVERFLOW`，也不得阻塞 AudioRecord 线程造成持续 underrun；实现要把 overflow 计数和最近一次时间戳打入诊断信息。检测延迟使用 `SystemClock.elapsedRealtimeNanos()`，从音频块采集时间（能取得硬件 timestamp 时优先）到回调时间计算，不使用 wall clock。

### 3.4 生命周期、前后台和音频焦点

推荐状态图：

```text
NEW -> LOADING -> READY -> LISTENING <-> PAUSED -> STOPPED -> RELEASED
                  └──────> ERROR ────────────────────────────────┘
```

- `initialize()`、模型校验、native recognizer 创建必须在后台 executor；`onReady` 之后才能 `startListening`。
- `startListening()` 只启动已注入的音频源；若 SDK 自己持有 AudioRecord，则需要 `RECORD_AUDIO` 权限，并在失败时释放 record。
- `pause()` 保留 recognizer 和模型，停止消费新音频；`stopListening()` 调用 `inputFinished`、清空 stream、释放 AudioRecord；是否保留 native 模型由配置决定。
- `release()` 幂等：停止录音、停止 worker、释放 stream/recognizer、移除焦点 listener、关闭 executor；释放后所有公共调用返回 `ALREADY_RELEASED` 或抛出明确的 `IllegalStateException`，不能触发 native use-after-free。
- 被动 KWS 的 `AudioFocusPolicy.NEVER` 是默认值，避免 KTV 播放被 duck/pause。进入主动命令收音或 TTS 播报时才请求焦点。
- Android 8.0+ 使用 `AudioFocusRequest`，同一个 request 实例配对 `requestAudioFocus()` 和 `abandonAudioFocusRequest()`；处理 `GRANTED`、`DELAYED`、`FAILED`、`LOSS`、`LOSS_TRANSIENT` 和 `LOSS_TRANSIENT_CAN_DUCK`。焦点失败不能假设录音或播放已开始。
- Android 15/API 35 及以上，目标 SDK 应考虑只有 top app 或 foreground service 才能成功请求音频焦点；专用车机若要求屏幕熄灭后继续监听，应在用户可见/用户动作时启动合适的 foreground service，并声明系统要求的服务类型和权限。
- 前台服务只负责持有合法运行资格，不应以通知绕过系统权限。车机厂商若将应用设为 system/privileged app、关闭电池优化或自定义音频策略，应在设备集成文档中列明，不把这些条件写死在通用 SDK。
- 后台恢复时检查 AudioRecord 状态、音频路由变化和焦点，不直接复用已失效的 native stream；必要时重新创建 stream。

## 4. 模型、线程和安全边界

### 4.1 推荐线程模型

| 线程 | 职责 | 约束 |
|---|---|---|
| AudioRecord 线程 | 采集 PCM、调用 `feedAudio` | 不分配大对象、不锁等待、不做 ONNX 推理 |
| Ingest/识别线程 | PCM 转 float、`acceptWaveform`、decode、endpoint | 单实例单线程调用 recognizer |
| SDK callback executor | 派发 listener | 有界/单线程；不得反向同步调用 feed |
| 主线程 | 业务 UI | 不执行模型加载或推理 |

对实时流可复用 `short[]`/`float[]` 工作缓冲，避免每 10 ms 产生临时对象。Java byte-to-float 转换是可接受的基线；性能紧张时放入 JNI，但必须继续维持一个明确的所有权契约。

### 4.2 命令白名单与隐私

`onCommandDetected` 输出的文本必须经过热词/命令白名单、置信度阈值和 endpoint 过滤，再交给点歌业务。不能把任意识别文本当作 URL、shell、SQL 或文件路径。默认不落盘原始 PCM、识别文本和模型输入；诊断只保留计数、耗时、错误码、模型版本、ABI。若产品要上传日志或音频，应单独取得授权并定义保留期限。

### 4.3 模型加载和版本清单

AAR 内 `assets/vod_voice/model-manifest.json`（或等价清单）至少记录：模型版本、文件相对路径、字节数、SHA-256、采样率、模型类型、授权信息。初始化时逐文件验证；模型不完整时不要启动一个“看似 READY”的降级实例。模型和 native runtime 的兼容矩阵示例：

```text
SDK 1.0.0 -> sherpa-onnx 1.13.8 -> ONNX Runtime pinned hash -> model kws-command-1
SDK 1.1.0 -> sherpa-onnx 1.13.8 + custom ORT -> model kws-command-2
```

每次升级 ONNX Runtime、NDK、模型量化方式或 endpoint 参数都要重新跑准确率、延迟、内存和 16 KB page-size 验收。

## 5. RK3568/RK3588 与高通车载平台的资源预算

以下是**工程预算区间**，假设：16 kHz/mono PCM、单路麦克风、CPU provider、int8 streaming 模型、一个 SDK 实例；CPU 为该 SoC 总可用 CPU 的平均占用，内存为应用 native + Java 的增量峰值，不含 Android 系统、歌曲播放解码器和 GPU 视频。真实值必须按指定板卡、散热、Android build、模型和线程数实测。

| 平台/任务 | CPU 预算（稳态） | SDK 增量 RSS 峰值预算 | 设备端增量功耗预算 | 说明 |
|---|---:|---:|---:|---|
| RK3568（4×A55）常驻 KWS | 1–5% 总 CPU | 20–60 MB | 0.2–0.8 W | 3.3M 级 KWS、1 线程、无连续 ASR |
| RK3568 唤醒后 streaming ASR | 15–35% 总 CPU | 80–220 MB | 1.5–3.5 W | int8 encoder；float 模型可能远超预算 |
| RK3588（4×A55+4×A76）常驻 KWS | 0.5–3% 总 CPU | 20–60 MB | 0.2–0.8 W | 绑定 A55 或低频核更省电 |
| RK3588 streaming ASR | 5–20% 总 CPU | 80–220 MB | 1.5–4.0 W（CPU） | 可评估 RKNN/QNN 变体；不要将 NPU 加速当作 CPU 版本兼容 |
| Snapdragon 车载 CPU provider | 3–15% 总 CPU | 80–220 MB | 0.5–2.5 W | 依 SM 系列、DVFS、温度和线程数变化 |
| Snapdragon QNN/HTP（若模型与 SoC 支持） | 1–8% CPU | 80–220 MB（含 runtime/context） | 0.3–1.5 W | 需使用匹配的 QNN backend、模型 context 和厂商 BSP |

**如何理解“电池功耗”：** 车机通常由 12 V 电源持续供电，表中是 SDK 相对空闲基线的增量，不是整机电池续航。换算时 `1 W / 12 V ≈ 83 mA`（不计 DC/DC 效率）；例如 0.5 W 约为 42 mA，2.5 W 约为 208 mA。ACC 关闭后的睡眠/唤醒策略由车身电源管理决定；SDK 不得自行保持 wakelock 或无限重启 AudioRecord 来“保活”。

**内存风险：** 官方 sherpa Android 示例使用 float32 bilingual Zipformer 时，encoder 文件约 315 MB，debug APK 约 329 MB；这证明“模型文件大小”与“轻量 SDK”不是同一回事。量产需优先选择 streaming/int8 模型、删掉备用模型，并在冷启动/热启动两种场景测量 RSS、native heap、mmap 和文件页缓存。若目标终端只有 1–2 GB RAM，应把 SDK 峰值预算控制在整机内存的 10% 左右，并禁止同时加载 KWS、ASR、TTS 多套大模型。

### 5.1 可复现验收方法

1. 固定设备、Android build、CPU governor/热状态、模型 hash、SDK/AAR hash；冷启动后等待 60 秒。
2. KWS 场景播放 30 分钟静音、车内噪声和歌曲混合音频；记录 `adb shell top -H -p <pid>`、Perfetto CPU scheduling、唤醒误报/漏报。
3. ASR 场景使用相同 16 kHz PCM 脚本，分别测 10 s、30 s、连续 5 min；记录识别线程 CPU、P50/P95/P99 latency、队列深度和 overflow 次数。
4. 内存用 `adb shell dumpsys meminfo <package>` 加 Perfetto native memory；至少记录 Java heap、native heap、PSS、RSS、峰值和释放后基线。
5. 功耗优先使用电源分析仪/车机 PMIC telemetry；没有硬件时只能记录 `batterystats` 趋势，不能把软件估算写成实测。KWS/ASR/待机分别测 30 分钟以上，报告输入电压、亮屏/熄屏、温度和播放状态。
6. 在目标 CPU 温度升高后重复测试，确保 DVFS 降频不会让实时因子（RTF）超过 1；验收目标可设 `P95 detection latency <= 500 ms`、队列无持续增长、连续 30 分钟无崩溃。

## 6. 交付与防踩坑 Checklist

### 构建/打包

- [ ] AAR、模型包、源码 commit、NDK、AGP、ONNX Runtime、sherpa 版本全部锁定并可重建。
- [ ] `unzip -l sdk.aar` 确认有 `classes.jar`、两种目标 ABI 的 `jni/.../*.so`、模型 `assets/` 和 manifest。
- [ ] 用 `readelf -h`/`file` 检查 `.so` 架构；不要把 arm64 `.so` 放入 armeabi-v7a 目录。
- [ ] 用 APK Analyzer/`bundletool` 查看最终 APK/AAB 的 ABI split；确认测试设备只下载一个 ABI。
- [ ] 检查所有 native 库的 16 KB ELF/page alignment。Android 15 支持 16 KB page-size 设备；native SDK 应按 Android 官方指南使用兼容的 AGP/NDK/链接器，并在 16 KB 模拟器或真机验证。
- [ ] 检查 `libc++_shared.so` 等公共依赖是否与宿主冲突；优先静态链接内部 STL 或明确由一个依赖统一提供，禁止两个版本静默覆盖。
- [ ] release 开启 strip、去掉 debug symbols（symbols 单独归档）、关闭日志中的模型路径/音频内容输出。
- [ ] 产物提供 SHA-256、SBOM、第三方许可证（sherpa/ONNX Runtime/模型分别核对许可证）。

### 模型/运行时

- [ ] 模型文件只保留运行必需文件；清单中的字节数和 SHA-256 与 AAR 一致。
- [ ] int8/float 模型、tokens、encoder/decoder/joiner、model type 配置成套发布，不混用不同训练版本。
- [ ] `numThreads=1` 作为低功耗基线，再以实测决定是否升到 2/3；不在业务进程里无限创建 recognizer。
- [ ] 选择 CPU、RKNN 或 QNN provider 前验证目标 SoC、BSP、backend 和模型格式；“有 NPU”不等于任意 ONNX 模型可用。
- [ ] 识别线程串行访问一个 `OnlineStream`；stop/release 与 decode 之间有明确 join，避免 native use-after-free。
- [ ] 长时间静音、歌曲噪声、多人说话、回声、采样率错误、AudioRecord 返回负值都覆盖测试。

### Android 生命周期/音频

- [ ] `RECORD_AUDIO` 权限、AudioRecord input source、16 kHz mono PCM16 在所有目标 ROM 上验证。
- [ ] 被动 KWS 默认不抢 AudioFocus；主动命令/TTS 采用 `AudioFocusRequest` 并配对 abandon。
- [ ] 处理焦点延迟/失败、蓝牙或 USB 音频路由变化、麦克风被其他应用占用、AudioRecord 初始化失败。
- [ ] Android 15/API 35+ 验证 top-app/foreground-service 约束；熄屏继续工作必须有 OEM 明确的 FGS/电源策略，不用隐式后台启动绕过限制。
- [ ] 前后台切换、屏幕熄灭、车机 ACC off/on、进程被杀后重新初始化均通过；不要保存 Activity 引用。
- [ ] `feedAudio` 有界队列有 overflow 监控；不得在音频线程等待锁、GC、磁盘或网络。
- [ ] 回调 executor 有界且可停止；回调异常不能杀死识别线程，release 后不再回调业务。

### 车机集成/验收

- [ ] RK3568、RK3588、每个 Snapdragon SKU 至少有一台代表性量产固件，不以开发板结果替代整机结果。
- [ ] 记录 CPU 总占用与单线程占用，避免“总 CPU 很低”掩盖一个 A55 被打满。
- [ ] 记录 P50/P95/P99 延迟、实时因子、RSS/PSS 峰值、温度、频率、功耗和误报/漏报。
- [ ] 设定热降频后的验收阈值；连续 30–60 分钟无堆积、崩溃、音频 underrun 和模型泄漏。
- [ ] 识别结果只能进入命令白名单；原始 PCM、文本和诊断日志遵守隐私保留规则。
- [ ] 发布前做二进制差分：native、classes.jar、模型和资源变化必须能解释；每个变更增加版本号和回滚包。

## 7. 参考资料（官方/上游）

1. sherpa-onnx Android AAR 构建 README：<https://github.com/k2-fsa/sherpa-onnx/blob/master/android/SherpaOnnxAar/README.md>
2. sherpa-onnx Android 构建、ABI、native 与模型示例：<https://k2-fsa.github.io/sherpa/onnx/android/build-sherpa-onnx.html>
3. sherpa-onnx Kotlin `OnlineRecognizer` API：<https://github.com/k2-fsa/sherpa-onnx/blob/master/sherpa-onnx/kotlin-api/OnlineRecognizer.kt>
4. sherpa-onnx Kotlin `OnlineStream.acceptWaveform` API：<https://github.com/k2-fsa/sherpa-onnx/blob/master/sherpa-onnx/kotlin-api/OnlineStream.kt>
5. Android 官方 AAR/library format：<https://developer.android.com/studio/projects/android-library>
6. Android NDK ABI 指南：<https://developer.android.com/ndk/guides/abis>
7. Android 官方音频焦点：<https://developer.android.com/media/optimize/audio-focus>
8. Android 官方 16 KB page size：<https://developer.android.com/guide/practices/page-sizes>
9. ONNX Runtime 移动端部署与 custom build：<https://onnxruntime.ai/docs/tutorials/mobile/>
10. Rockchip RK3568 brief datasheet：<https://www.rock-chips.com/uploads/pdf/2022.8.26/192/RK3568%20Brief%20Datasheet.pdf>
11. Rockchip RK3588 brief datasheet：<https://www.rock-chips.com/uploads/pdf/2022.8.26/192/RK3588%20Brief%20Datasheet.pdf>

> 资源和功耗表中的区间是交付预算，不是上述厂商文档宣称的 benchmark。量产签核必须附指定硬件和固件的实测原始数据。
