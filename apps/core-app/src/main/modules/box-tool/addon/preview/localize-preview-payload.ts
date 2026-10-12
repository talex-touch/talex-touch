import type { PreviewCardPayload } from '@talex-touch/utils'
import { isI18nMessage, parseI18nMessage } from '@talex-touch/utils/i18n'

export type PreviewTranslate = (key: string, params?: Record<string, string | number>) => string

const TEXT_FIELDS = [
  'title',
  'subtitle',
  'primaryLabel',
  'primaryValue',
  'primaryUnit',
  'secondaryLabel',
  'secondaryValue',
  'description'
] as const

/**
 * Resolves one `$i18n:` message. Params may themselves be messages (a line operation inside the
 * line-tools title, a currency name inside `{from} → {to}`), so string params resolve first.
 */
function localizeText(value: string, translate: PreviewTranslate): string {
  const parsed = isI18nMessage(value) ? parseI18nMessage(value) : null
  if (!parsed) return value
  if (!parsed.params) return translate(parsed.key)

  const params: Record<string, string | number> = {}
  for (const [name, param] of Object.entries(parsed.params)) {
    params[name] =
      typeof param === 'string'
        ? localizeText(param, translate)
        : typeof param === 'number'
          ? param
          : String(param)
  }
  return translate(parsed.key, params)
}

/**
 * Turns the `$i18n:` messages preview abilities emit into text in the current language.
 *
 * Resolved here, in main, rather than in the card: the payload outlives the card. It is also
 * stored whole as calculation history and shown again from there, where an unresolved message
 * would appear verbatim.
 */
export function localizePreviewPayload(
  payload: PreviewCardPayload,
  translate: PreviewTranslate
): PreviewCardPayload {
  const text = (value: string) => localizeText(value, translate)
  const localized: PreviewCardPayload = { ...payload }

  for (const field of TEXT_FIELDS) {
    const value = payload[field]
    if (typeof value === 'string') localized[field] = text(value)
  }
  if (payload.badges) localized.badges = payload.badges.map(text)
  if (payload.chips) {
    localized.chips = payload.chips.map((chip) => ({
      ...chip,
      label: text(chip.label),
      value: text(chip.value)
    }))
  }
  if (payload.sections) {
    localized.sections = payload.sections.map((section) => ({
      ...section,
      ...(typeof section.title === 'string' ? { title: text(section.title) } : {}),
      rows: section.rows.map((row) => ({
        ...row,
        label: text(row.label),
        value: text(row.value),
        ...(typeof row.description === 'string' ? { description: text(row.description) } : {})
      }))
    }))
  }
  if (payload.warnings) localized.warnings = payload.warnings.map(text)

  return localized
}
