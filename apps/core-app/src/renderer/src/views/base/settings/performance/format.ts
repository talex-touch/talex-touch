import { formatBytesShort, formatUptimeShort } from '~/components/plugin/runtime/format'

export { formatUptimeShort }

export function formatMemory(value: number | null): string {
  return value === null ? '—' : formatBytesShort(value)
}

export function formatPercent(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`
}

export function formatElu(value: number | null): string {
  return formatPercent(value === null ? null : value * 100)
}

export function formatRate(value: number | null): string {
  return value === null ? '—' : value.toFixed(1)
}
