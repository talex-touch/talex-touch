# Tuff 当前执行顺序

> Authority: this document is the sole global execution-order source. Confirm scope and acceptance with the user, then establish current status, blockers and handoff with the current owner using existing PRDs, engineering specifications and observed runtime evidence. Work planned before the 2026-10-03 cutover remains frozen in the [pre-cutover backlog](../engineering/workflow/backlog.md). `docs/comet/` preserves read-only pre-exit records and is not a source of live status or an execution entrypoint.

## Current order

1. **Close verified release and runtime blockers.** The OTA, macOS release-evidence, and application-icon acceptance work is frozen in the [pre-cutover backlog](../engineering/workflow/backlog.md); resume each one after confirming scope and acceptance with the user and handoff with the current owner, using its frozen record, PRD and evidence. The OTA parent was concurrently owned at cutover; this document does not restate its volatile child status.
2. **Complete the search and cross-platform remediation.** The [living audit](../engineering/reports/search-crossplatform-audit.md) owns the backlog; Windows productionization and the [search-index split write-path migration](../engineering/workflow/backlog.md#07-28-migrate-search-index-split-write-paths) are frozen records. The default-on topology is reconciled; the isolated-profile runtime evidence is still owed (see the [split acceptance record](../engineering/reports/search-index-split-write-acceptance.md)), and `=0` stays the emergency rollback.
3. **Continue remaining independently-owned work** in the order recorded here only after the preceding blocker lane is resolved; use user-agreed scope and acceptance, existing PRDs and engineering specifications, observed runtime evidence, and the current owner's handoff.

## Non-negotiable safety gates

- `TUFF_DB_SEARCH_SPLIT_ENABLED` defaults **on** since `cd39bdbf6` (2026-08-05). The 2d.3 write-path migration landed with it, so `database.db` and `search-index.db` each have exactly one writer connection and the half-migrated failure mode this gate used to guard against no longer exists. Setting it to `0` is the emergency revert to the shared-file topology, not the safe default.
- That flip was proved by three app runs, not by typecheck: schema parity plus a first-launch bootstrap reindex of 4678 items, a second boot that correctly skipped it, and a V2 run with zero `SQLITE_BUSY`, zero cross-home FK failures and zero retry exhaustion. Any future change to the split topology owes the same class of evidence.
- Historical reports prove only their recorded environment. Packaged and production claims require exact observed artifacts or deployed surfaces; they are never inferred from source state.

## Work-state rules

- Confirm live status with the current owner against the relevant existing PRD, engineering specification and observed evidence. Do not copy active counts, branch names, HEADs, dirty-worktree state, or implementation snapshots into this document.
- Independently verify the agreed acceptance before recording completion and handing off. Frozen pre-cutover records are never completed or archived by editing the backlog.
- Roadmaps, PRDs, engineering specifications, frozen task records, historical Comet records, and topical TODOs may describe local scope or immutable history but must not define another global priority order.

## Local and historical references

- Search/cross-platform audit: [living audit](../engineering/reports/search-crossplatform-audit.md)
- AI: [TODO-AI.md](./TODO-AI.md)
- R3: [TODO-R3.md](./TODO-R3.md)
- Nexus: [TODO-nexus.md](./TODO-nexus.md)
- Long-term debt: [docs/TODO-BACKLOG-LONG-TERM.md](./TODO-BACKLOG-LONG-TERM.md)
- Historical completion facts: [01-project/CHANGES.md](./01-project/CHANGES.md)
- 2026-08-31 maintenance audit: [actionable report](../engineering/reports/maintenance-audit-2026-08-31.md).
- 2026-09-01 maintenance audit: [actionable report](../engineering/reports/maintenance-audit-2026-09-01.md).
- 2026-09-02 maintenance audit: [actionable report](../engineering/reports/maintenance-audit-2026-09-02.md).
- 2026-08-30 maintenance audit: [actionable report](../engineering/reports/maintenance-audit-2026-08-30.md).
- 2026-09-03 maintenance audit: [actionable report](../engineering/reports/maintenance-audit-2026-09-03.md).

## Topical guardrails

- **R2 AI Stable** remains `historical 13/13 / current recapture open`. Any current-version claim must use `--requireCurrentVersion` and a manifest baseline matching `apps/core-app/package.json`; historical artifacts do not become current proof.
- **R9.2 ContextHygiene** retains completed P0/P1 and isolated packaged-entrypoint evidence, while real-profile and later scope migration remain open.
- **R8-F CatalogService MVP** 的 domain-lexicon 产品触发仍暂停；已获执行授权的 `09-13-voice-provider-cloud-pack` 是独立 scoped extension，代码与本地验证已完成，待 review/landing。AI/Assistant/OmniPanel polish、desktop fireworks 与 broad search-class refactors 继续按原顺序暂停。
- **macOS 原生能力渠道化**先进入 AI topical backlog，不抢占当前 release/search blocker：评估机器本地能力的运行时发现、自动注入与平台降级，详细范围见 [`TODO-AI.md`](./TODO-AI.md#macos-原生能力渠道化候选)。

## Version-planned work

- [ ] **2.5.1：文件搜索与文件动作融合。** P0 与本轮正文语义穿透已落地：目录结果与 `.app` 去重、⌘K 打开方式与 7 组文件动作、应用版本与真实创建时间摘要、权限/删除错误反馈；B9 文件名错字 n-gram；PDF/code 分段、页码/行号片段和受控 EmbeddingGemma 2 本地 runtime contract 已接入，209 项既有单测及本轮分段/向量/预览回归通过。仍待实施的是 P1 原生 Scanner 对比、P3 文件移动/复制/废纸篓、P4 显式源码正文检索，以及签名 helper 的 packaged release 验收；模型与运行边界见 [调研报告](../engineering/reports/file-search-integration-2.5.1-2026-10-11.md)。本条不改变前述全局执行顺序。

## Release follow-ups

- [ ] **v2.4.14 发布说明有两处与代码不符：仓库和 GitHub 已改，Nexus 副本未改。** `notes/update_2.4.14.zh.md`、`notes/update_2.4.14.en.md` 和 GitHub Release 正文已于 2026-10-11 改正。Nexus 发布记录 `v2.4.14` 的 `notes` / `notesHtml` 是发版时同步过去的副本，同日用 `GET /api/releases/v2.4.14` 核对仍是旧措辞。改它要用发布同步密钥调 `PATCH /api/releases/v2.4.14`，或在管理台编辑；这属于对外发布，需先获授权。
  - 「尚未形成习惯时显示学习提示」不成立：`b8f2a2477`（10-03）先把学习提示换成空位占位网格，`0f6c75773`（10-07）又移除了习惯区的整个空态，tag 里已没有这段界面。已改为「尚未形成习惯时不填充虚构常用项目」。
  - 「支持从目录和网址直达常用操作」只对一半：目录成立，`system-actions-provider.ts` 给已存在的目录提供终端和文件管理器动作（`162809001`）；内核只把 `file://`、`tfile://` 解析成路径，普通网址直开由随应用内置的官方插件「浏览器打开」（`touch-browser-open`）提供。已改为「支持从目录直达常用操作，网址经内置 Browser 入口直开」。
- [ ] **PR #2120（全量琉光材质与概念文档对齐）及旁路问题收口。** 旁路 10+ 项修复（工区 `/private/tmp/tuff-side-issues-1017`，分支 `task/feat/refraction-surfaces-and-concept-docs`，31 文件）已完成：BottomDialog 150ms 截断修复、TxFlatRadio 强制颜色与高对比度选中态、TxBlowDialog/TBlowDialog 安全移除样式、TxModal/TxDrawer 焦点环抑制与防视口跳动、refractionRenderer="css" 毛玻璃降级修复、着色模式抽屉修复等，120 项单测通过且 CSS 预算受控；等待正式审查与合入授权。后续长尾债务（183.9 KiB 图标 safelist 局部 classGlyph 剥离、core-app 历史对话框副本平迁）已归档至 [TODO 长期债务池](./TODO-BACKLOG-LONG-TERM.md#a-架构与质量债务)。

