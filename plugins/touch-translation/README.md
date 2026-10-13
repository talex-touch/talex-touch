# Touch Translation Plugin

一个现代化的多源翻译插件，支持多个翻译提供者并行翻译，具有简洁的 UI 和强大的架构设计。

## 功能特性

- ✨ **多源翻译**: 支持 Google、DeepL、Bing、自定义 AI 等多个翻译源
- 🎯 **并行翻译**: 同时请求多个翻译服务，提高效率
- 📱 **响应式设计**: 使用 UnoCSS 构建的现代化 UI
- 💾 **历史记录**: 自动保存翻译历史，支持快速重用
- 🔧 **可配置**: 灵活的翻译源配置和管理
- 📋 **一键复制**: 快速复制翻译结果
- 🔄 **重试机制**: 失败的翻译可以单独重试
- 🌙 **暗色模式**: 支持明暗主题切换


## 交互形态与 SDK 规范说明

- **交互模式：Web content 独占形态**
  - 翻译插件主功能 `touch-translate` 采用 `webcontent` 交互形态（路径 `/`），进入时撑大视窗（`forceMax: true`）提供沉浸式多源对比与字典翻译体验。
  - 实时输入同步：CoreBox 输入框的按键通过 `onCoreBoxInputChange` 自动输入并防抖触发翻译。
- **`push` 与 `webcontent` 互斥规范及 SDK 演进**：
  - `webcontent` 独占视窗形态与 `push: true`（根搜索结果流模式）在架构上严格互斥，不能在同一 Feature 中混用。
  - **当前 SDK 版本（`sdkapi <= 261011`）**：宿主允许加载并给出警告提示，自动优先以独占视图呈现，**不会阻断插件加载**。
  - **下一个 SDK 版本（`sdkapi >= 261015` / 2026-10-15）**：宿主将正式启用硬门禁拦截（`PLUGIN_PACKAGE_MANIFEST_INTERACTION_CONFLICT`），任何同时声明 `push: true` 与独占视图 `webcontent` 的插件将**直接报错并无法加载**。
## 架构设计

### 核心 Hooks

#### `useTranslationProvider`
管理所有翻译提供者的注册、配置和状态：

```typescript
const {
  providers, // 所有翻译提供者
  enabledProviders, // 已启用的提供者
  toggleProvider, // 切换提供者启用状态
  updateProviderConfig // 更新提供者配置
} = useTranslationProvider()
```

#### `useTranslation`
核心翻译逻辑和状态管理：

```typescript
const {
  translate, // 执行翻译
  currentResponse, // 当前翻译响应
  history, // 翻译历史
  isTranslating, // 翻译状态
  hasResults, // 是否有结果
  retryTranslation // 重试翻译
} = useTranslation()
```

### 翻译提供者

每个翻译提供者都实现了 `TranslationProvider` 接口：

```typescript
interface TranslationProvider {
  name: string
  id: string
  type: 'api' | 'web' | 'ai'
  enabled: boolean
  translate: (text: string, targetLang?: string, sourceLang?: string) => Promise<TranslationResult>
}
```

#### 内置提供者

1. **Google Translate** (`google-translate.ts`)
   - 类型: `web`
   - 使用免费的 Google Translate API
   - 支持自动语言检测

2. **DeepL** (`deepl-translate.ts`)
   - 类型: `ai`
   - 支持官方 API（需要配置 API Key）
   - 无 API Key 时使用模拟翻译

3. **Bing Translator** (`bing-translate.ts`)
   - 类型: `web`
   - 支持 Azure Cognitive Services API
   - 无 API Key 时使用模拟翻译

4. **自定义翻译** (`custom-translate.ts`)
   - 类型: `ai`
   - 支持任何 OpenAI 兼容的 API
   - 可配置模型和提示词

### 组件架构

#### `TranslationCard.vue`
翻译结果卡片组件，支持：
- 显示翻译结果
- 复制功能
- 错误状态显示
- 重试按钮
- 加载状态

#### `multi-translate.vue`
主页面组件，整合所有功能：
- 输入区域
- 设置面板
- 历史记录
- 结果展示（宫格布局）

## 使用方法

### 基本翻译

```vue
<script setup>
import { useTranslation } from '@/composables/useTranslation'

const { translate } = useTranslation()

async function handleTranslate() {
  await translate('Hello World', 'zh', 'en')
}
</script>
```

### 自定义翻译提供者

```typescript
import { useTranslationProvider } from '@/composables/useTranslationProvider'

const { registerProvider } = useTranslationProvider()

// 注册自定义提供者
registerProvider({
  name: 'My Translator',
  id: 'my-translator',
  type: 'api',
  enabled: true,
  async translate(text, targetLang, sourceLang) {
    // 实现翻译逻辑
    return {
      text: 'translated text',
      provider: 'My Translator',
      timestamp: Date.now()
    }
  }
})
```

## 配置说明

### DeepL API 配置
```typescript
const { updateProviderConfig } = useTranslationProvider()

updateProviderConfig('deepl', {
  apiKey: 'your-deepl-api-key',
  apiUrl: 'https://api-free.deepl.com/v2/translate'
})
```

### 自定义 AI 配置
```typescript
updateProviderConfig('custom', {
  apiUrl: 'https://api.openai.com/v1/chat/completions',
  apiKey: 'your-openai-api-key',
  model: 'gpt-3.5-turbo',
  prompt: '请将以下文本翻译成中文，只返回翻译结果：'
})
```

## 开发指南

### 添加新的翻译提供者

1. 在 `src/providers/` 目录下创建新的提供者文件
2. 实现 `TranslationProvider` 接口
3. 在 `useTranslationProvider.ts` 中注册提供者

### 扩展功能

- 修改 `TranslationResult` 接口添加新字段
- 在 `useTranslation` 中添加新的翻译逻辑
- 在 `TranslationCard` 中添加新的 UI 元素

## 技术栈

- Vue 3 + TypeScript
- UnoCSS
- Vite
- LocalStorage API
- Fetch API

## 许可证

MIT License
