# Tuff v2.4.15-beta.7 更新说明

## 摘要

- TuffEx 按钮尺寸动画修复：解决 `useFlip` 在中断过渡时忽略 `height: false` 强写内联高度导致的按钮高度塌陷问题，并为基础按钮补齐最小高度防护。
- 更新状态按钮防御：设置页更新生命周期操作按钮增加最小高度与防压缩样式约束，杜绝在极端布局竞态下折叠。
- 应用更新健康确认恢复：优化更新重启后的生命周期恢复顺序，正确执行启动健康确认并归档，避免成功更新被误判为过期失败。

## 变更内容

- 修复 `useFlip` 工具在 `mode: 'size'` 下未遵守 `opt.size.height` 限制的缺陷；`.tx-button` 基础样式补齐 `min-height: var(--tx-button-height)`，杜绝内联高度污染与视觉切线。
- 设置页更新状态组件（`SettingUpdateStatus`）强化操作按钮样式，限制 `min-height: var(--tx-button-height, 32px)` 与 `flex-shrink: 0`，避免弹窗与过渡时被挤压。
- 修复 `UpdateService` 在启动恢复生命周期时的判定顺序：对处于 `awaiting-health` 与 `handoff-started` 阶段的更新尝试优先触发 `confirmStartupHealth`，成功确认后状态正常置为 `healthy`（已更新），不再误入 `UPDATE_ATTEMPT_STALE` 分支。
