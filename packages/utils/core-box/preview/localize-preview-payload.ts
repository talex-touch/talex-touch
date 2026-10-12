import type { PreviewCardPayload } from "./types";
import {
  createI18nMessage,
  i18nResolver,
  isI18nMessage,
  parseI18nMessage,
} from "../../i18n";

export type PreviewTranslate = (
  key: string,
  params?: Record<string, string | number>,
) => string;

const TEXT_FIELDS = [
  "title",
  "subtitle",
  "primaryLabel",
  "primaryValue",
  "primaryUnit",
  "secondaryLabel",
  "secondaryValue",
  "description",
] as const;

/** Looks keys up in the messages shipped with this package, in `i18nResolver`'s locale. */
function translateWithBuiltInMessages(
  key: string,
  params?: Record<string, string | number>,
): string {
  return i18nResolver.resolve(createI18nMessage(key, params));
}

/**
 * Resolves one `$i18n:` message. Params may themselves be messages (a line operation inside the
 * line-tools title, a currency name inside `{from} → {to}`), so string params resolve first.
 */
function localizeText(value: string, translate: PreviewTranslate): string {
  const parsed = isI18nMessage(value) ? parseI18nMessage(value) : null;
  if (!parsed) return value;
  if (!parsed.params) return translate(parsed.key);

  const params: Record<string, string | number> = {};
  for (const [name, param] of Object.entries(parsed.params)) {
    params[name] =
      typeof param === "string"
        ? localizeText(param, translate)
        : typeof param === "number"
          ? param
          : String(param);
  }
  return translate(parsed.key, params);
}

/**
 * Turns the `$i18n:` messages preview abilities emit into text.
 *
 * The abilities name their labels by key so that the host can show them in its own language.
 * Without a `translate`, the keys resolve against the English and Chinese messages bundled with
 * this package, in the locale set through `i18nResolver.setLocale()` (English by default).
 */
export function localizePreviewPayload(
  payload: PreviewCardPayload,
  translate: PreviewTranslate = translateWithBuiltInMessages,
): PreviewCardPayload {
  const text = (value: string) => localizeText(value, translate);
  const localized: PreviewCardPayload = { ...payload };

  for (const field of TEXT_FIELDS) {
    const value = payload[field];
    if (typeof value === "string") localized[field] = text(value);
  }
  if (payload.badges) localized.badges = payload.badges.map(text);
  if (payload.chips) {
    localized.chips = payload.chips.map((chip) => ({
      ...chip,
      label: text(chip.label),
      value: text(chip.value),
    }));
  }
  if (payload.sections) {
    localized.sections = payload.sections.map((section) => ({
      ...section,
      ...(typeof section.title === "string"
        ? { title: text(section.title) }
        : {}),
      rows: section.rows.map((row) => ({
        ...row,
        label: text(row.label),
        value: text(row.value),
        ...(typeof row.description === "string"
          ? { description: text(row.description) }
          : {}),
      })),
    }));
  }
  if (payload.warnings) localized.warnings = payload.warnings.map(text);

  return localized;
}
