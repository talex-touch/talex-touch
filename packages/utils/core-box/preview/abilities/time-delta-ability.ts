import type {
  PreviewAbilityContext,
  PreviewAbilityResult,
  PreviewAbilitySafetyPolicy,
  PreviewCardPayload,
} from "../types";
import dayjs from "dayjs";
import zhCn from "dayjs/locale/zh-cn.js";
import relativeTime from "dayjs/plugin/relativeTime.js";
import { i18nMsg } from "../../../i18n";
import { BasePreviewAbility } from "../sdk";

dayjs.extend(relativeTime);

const RELATIVE_PATTERN = /^now\s*([+-])\s*(.+)$/i;
const RANGE_PATTERN =
  /^(\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?)\s*-\s*(now|\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?)$/i;

const UNIT_MAP: Record<string, number> = {
  s: 1000,
  sec: 1000,
  secs: 1000,
  second: 1000,
  seconds: 1000,
  m: 60 * 1000,
  min: 60 * 1000,
  mins: 60 * 1000,
  minute: 60 * 1000,
  minutes: 60 * 1000,
  h: 60 * 60 * 1000,
  hr: 60 * 60 * 1000,
  hrs: 60 * 60 * 1000,
  hour: 60 * 60 * 1000,
  hours: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  days: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  weeks: 7 * 24 * 60 * 60 * 1000,
};

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

function parseRelative(value: string): number | null {
  const englishOffset = parseEnglishRelative(value);
  if (englishOffset !== null) return englishOffset;
  return parseChineseDurationSegments(value);
}

function parseEnglishRelative(value: string): number | null {
  const source = value.trim().toLowerCase();
  if (!source) return null;

  let total = 0;
  const regex = /([-+]?(?:\d+(?:\.\d+)?|\.\d+))\s*([a-z]+)/gi;
  let matched = false;
  let lastIndex = 0;
  const unmatchedParts: string[] = [];

  for (
    let match = regex.exec(source);
    match !== null;
    match = regex.exec(source)
  ) {
    unmatchedParts.push(source.slice(lastIndex, match.index));
    lastIndex = regex.lastIndex;
    const amountRaw = match[1];
    const unitRaw = match[2];
    if (!amountRaw || !unitRaw) continue;
    const amount = Number(amountRaw);
    const unit = unitRaw.toLowerCase();
    const factor = UNIT_MAP[unit];
    if (!factor || Number.isNaN(amount)) return null;
    total += amount * factor;
    matched = true;
  }

  unmatchedParts.push(source.slice(lastIndex));
  if (!matched || unmatchedParts.join("").trim().length > 0) return null;
  return total;
}

const CN_UNIT_MAP: Record<string, number> = {
  秒: SECOND_MS,
  分钟: MINUTE_MS,
  分: MINUTE_MS,
  小时: HOUR_MS,
  时: HOUR_MS,
  天: DAY_MS,
  日: DAY_MS,
  周: WEEK_MS,
};

function parseChineseDurationSegments(text: string): number | null {
  const source = text.trim();
  if (!source) return null;

  let total = 0;
  const regex = /([-+]?(?:\d+(?:\.\d+)?|\.\d+))\s*(秒|分钟|小时|[分时天日周])/g;
  let matched = false;
  let lastIndex = 0;
  const unmatchedParts: string[] = [];

  for (
    let match = regex.exec(source);
    match !== null;
    match = regex.exec(source)
  ) {
    unmatchedParts.push(source.slice(lastIndex, match.index));
    lastIndex = regex.lastIndex;
    const amountRaw = match[1];
    const unitRaw = match[2];
    if (!amountRaw || !unitRaw) continue;
    const factor = CN_UNIT_MAP[unitRaw];
    if (!factor) return null;
    const amount = Number(amountRaw);
    if (Number.isNaN(amount)) return null;
    total += amount * factor;
    matched = true;
  }

  unmatchedParts.push(source.slice(lastIndex));
  if (!matched || unmatchedParts.join("").trim().length > 0) return null;
  return total;
}

function parseChineseRelative(text: string): number | null {
  const trimmed = text.trim();
  const direction = trimmed.endsWith("前")
    ? "前"
    : trimmed.endsWith("后")
      ? "后"
      : undefined;
  const expression = direction ? trimmed.slice(0, -1).trim() : trimmed;
  if (!expression) return null;

  const offset = parseChineseDurationSegments(expression);
  if (offset === null) return null;
  if (direction === "前") return -Math.abs(offset);
  if (direction === "后") return Math.abs(offset);
  return offset;
}

function parseNaturalRelative(text: string): number | null {
  const lower = text.trim().toLowerCase();
  if (!lower) return null;

  if (lower === "tomorrow" || lower === "明天") return DAY_MS;
  if (lower === "yesterday" || lower === "昨天") return -DAY_MS;
  if (lower === "today" || lower === "now" || lower === "今天") return 0;

  const inMatch = lower.match(/^in\s+([\w\s.]+)$/);
  if (inMatch) {
    const expression = inMatch[1];
    if (!expression) return null;
    const offset = parseRelative(expression);
    return offset === null ? null : offset;
  }

  const agoMatch = lower.match(/^([\w\s.]+)\s+(ago|before)$/);
  if (agoMatch) {
    const expression = agoMatch[1];
    if (!expression) return null;
    const offset = parseRelative(expression);
    return offset === null ? null : -offset;
  }

  const laterMatch = lower.match(/^([\w\s.]+)\s+(later|after|from now)$/);
  if (laterMatch) {
    const expression = laterMatch[1];
    if (!expression) return null;
    const offset = parseRelative(expression);
    return offset === null ? null : offset;
  }

  const cn = parseChineseRelative(text);
  if (cn !== null) return cn;

  return null;
}

function parseDurationValue(text: string): number | null {
  const lower = text.trim().toLowerCase();
  const regex = /^([-+]?(?:\d+(?:\.\d+)?|\.\d+))\s*([a-z]+)$/i;
  const match = lower.match(regex);
  if (match) {
    const offset = parseRelative(lower);
    if (offset !== null) return Math.abs(offset);
  }

  const cn = parseChineseRelative(text);
  if (cn !== null) {
    return Math.abs(cn);
  }

  const multiMatch = /(\d+)\s+[a-z]+/i.test(lower);
  const compactMultiMatch = /(\d+(?:\.\d+)?|\.\d+)\s*[a-z]+/i.test(lower);
  if (multiMatch || compactMultiMatch) {
    const offset = parseRelative(lower);
    if (offset !== null) return Math.abs(offset);
  }

  return null;
}

function parseAbsoluteDate(text: string): dayjs.Dayjs | null {
  const normalized = text.trim();
  if (!normalized) return null;

  const lower = normalized.toLowerCase();
  const hasDatePrefix = lower.startsWith("date ");
  const dateText = hasDatePrefix ? normalized.slice(5).trim() : normalized;

  if (!hasDatePrefix) {
    const datePattern =
      /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:[\sT]\d{1,2}:\d{1,2}(?::\d{1,2})?)?$/;
    const naturalMap: Record<string, number> = {
      tomorrow: 1,
      "day after tomorrow": 2,
      yesterday: -1,
      今天: 0,
      明天: 1,
      后天: 2,
      昨天: -1,
    };

    if (!datePattern.test(normalized) && !(lower in naturalMap)) {
      return null;
    }
  }

  const formats = [
    "YYYY-MM-DD",
    "YYYY/MM/DD",
    "YYYY.MM.DD",
    "YYYY-MM-DD HH:mm",
    "YYYY-MM-DD HH:mm:ss",
    "YYYY/MM/DD HH:mm",
    "YYYY/MM/DD HH:mm:ss",
    "YYYY.MM.DD HH:mm",
    "YYYY.MM.DD HH:mm:ss",
  ];

  const textToParse = hasDatePrefix ? dateText : normalized;
  for (const format of formats) {
    const parsed = dayjs(textToParse, format, true);
    if (parsed.isValid()) return parsed;
  }

  if (hasDatePrefix) {
    const parsed = dayjs(dateText);
    if (parsed.isValid()) return parsed;
  }

  const naturalMap: Record<string, number> = {
    tomorrow: 1,
    "day after tomorrow": 2,
    yesterday: -1,
    今天: 0,
    明天: 1,
    后天: 2,
    昨天: -1,
  };

  if (lower in naturalMap) {
    const offsetDays = naturalMap[lower];
    if (offsetDays === undefined) return null;
    return dayjs().add(offsetDays, "day");
  }

  return null;
}

/**
 * Unit names and joining follow the locale: zh-CN reads `1天2小时30分钟`,
 * en-US `1d 2h 30m`.
 */
function formatDuration(ms: number, locale: string): string {
  const unit = (value: number, name: string) =>
    new Intl.NumberFormat(locale, {
      style: "unit",
      unit: name,
      unitDisplay: "narrow",
    }).format(value);
  // Split the milliseconds directly. A dayjs duration also has months of 30.4 days, so its
  // days() dropped every whole month and hours() carried the remainder: 45 days read as 14d 14h.
  const days = Math.trunc(ms / DAY_MS);
  const hours = Math.trunc((ms % DAY_MS) / HOUR_MS);
  const minutes = Math.trunc((ms % HOUR_MS) / MINUTE_MS);
  const seconds = Math.trunc((ms % MINUTE_MS) / SECOND_MS);
  const segments: string[] = [];
  if (days) segments.push(unit(days, "day"));
  if (hours) segments.push(unit(hours, "hour"));
  if (minutes) segments.push(unit(minutes, "minute"));
  if (segments.length === 0) segments.push(unit(seconds, "second"));
  return new Intl.ListFormat(locale, { type: "unit", style: "narrow" }).format(
    segments,
  );
}

/**
 * dayjs reads `fromNow()` from its global locale, which stays English, so the
 * locale is set on the instance: zh-CN reads `3 天前`, en-US `3 days ago`.
 */
function fromNow(target: dayjs.Dayjs, locale: string): string {
  return target.locale(locale.startsWith("zh") ? zhCn : "en").fromNow();
}

export class TimeDeltaAbility extends BasePreviewAbility {
  readonly id = "preview.time";
  override readonly label = "Time Delta";
  readonly priority = 30;
  override readonly safety: PreviewAbilitySafetyPolicy = {
    input: {
      maxLength: 160,
      syntax: "relative time, duration, absolute date or date range",
      notes: "dayjs parsing only; no network, cache or dynamic execution.",
    },
    dependencies: ["parser"],
    usesDynamicExecution: false,
    usesNetwork: false,
    usesCache: false,
    replacementPlan: "Completed: dayjs-based parser moved into PreviewSDK.",
  };

  override canHandle(query: { text?: string }): boolean {
    if (!query.text || query.text.length > this.safety.input.maxLength)
      return false;
    const relativeMatch = query.text.match(RELATIVE_PATTERN);
    return (
      (relativeMatch
        ? parseRelative(relativeMatch[2] ?? "") !== null
        : false) ||
      RANGE_PATTERN.test(query.text) ||
      parseNaturalRelative(query.text) !== null ||
      parseDurationValue(query.text) !== null ||
      parseAbsoluteDate(query.text) !== null
    );
  }

  override async execute(
    context: PreviewAbilityContext,
  ): Promise<PreviewAbilityResult | null> {
    const startedAt = Date.now();
    const text = this.getNormalizedQuery(context.query);
    if (!this.isInputWithinLimit(context)) return null;
    const locale = context.locale ?? "zh-CN";

    const relativeMatch = text.match(RELATIVE_PATTERN);
    if (relativeMatch) {
      const [, operator, expression] = relativeMatch;
      if (!operator || !expression) return null;
      const offset = parseRelative(expression);
      if (offset === null) return null;
      const sign = operator === "-" ? -1 : 1;
      const target = dayjs().add(sign * offset, "millisecond");
      return {
        abilityId: this.id,
        confidence: 0.8,
        payload: {
          abilityId: this.id,
          title: text,
          subtitle: i18nMsg("previewCard.time.offsetSubtitle"),
          primaryLabel: i18nMsg("previewCard.time.targetTime"),
          primaryValue: target.format("YYYY-MM-DD HH:mm:ss"),
          secondaryLabel: i18nMsg("previewCard.time.relativeToNow"),
          secondaryValue: fromNow(target, locale),
          sections: [
            {
              rows: [
                {
                  label: i18nMsg("previewCard.time.offset"),
                  value: formatDuration(offset, locale),
                },
                { label: "ISO", value: target.toISOString() },
              ],
            },
          ],
        },
        durationMs: Date.now() - startedAt,
      };
    }

    const naturalOffset = parseNaturalRelative(text);
    if (naturalOffset !== null) {
      const target = dayjs().add(naturalOffset, "millisecond");
      return {
        abilityId: this.id,
        confidence: 0.7,
        payload: {
          abilityId: this.id,
          title: text,
          subtitle: i18nMsg("previewCard.time.offsetSubtitle"),
          primaryLabel: i18nMsg("previewCard.time.targetTime"),
          primaryValue: target.format("YYYY-MM-DD HH:mm:ss"),
          secondaryLabel: i18nMsg("previewCard.time.relativeToNow"),
          secondaryValue: fromNow(target, locale),
          sections: [
            {
              rows: [
                {
                  label: i18nMsg("previewCard.time.offset"),
                  value: formatDuration(Math.abs(naturalOffset), locale),
                },
                { label: "ISO", value: target.toISOString() },
              ],
            },
          ],
        },
        durationMs: Date.now() - startedAt,
      };
    }

    const durationValue = parseDurationValue(text);
    if (durationValue) {
      return {
        abilityId: this.id,
        confidence: 0.6,
        payload: {
          abilityId: this.id,
          title: text,
          subtitle: i18nMsg("previewCard.time.durationSubtitle"),
          primaryLabel: i18nMsg("previewCard.time.totalDuration"),
          primaryValue: formatDuration(durationValue, locale),
          sections: [
            {
              rows: [
                {
                  label: i18nMsg("previewCard.time.hours"),
                  value: (durationValue / (60 * 60 * 1000)).toFixed(2),
                },
                {
                  label: i18nMsg("previewCard.time.minutes"),
                  value: (durationValue / (60 * 1000)).toFixed(2),
                },
                {
                  label: i18nMsg("previewCard.time.seconds"),
                  value: (durationValue / 1000).toFixed(2),
                },
              ],
            },
          ],
        },
        durationMs: Date.now() - startedAt,
      };
    }

    const absoluteDate = parseAbsoluteDate(text);
    if (absoluteDate) {
      const diff = Math.abs(absoluteDate.diff(dayjs()));
      return {
        abilityId: this.id,
        confidence: 0.7,
        payload: {
          abilityId: this.id,
          title: text,
          subtitle: i18nMsg("previewCard.time.dateDiffSubtitle"),
          primaryLabel: i18nMsg("previewCard.time.fromNow"),
          primaryValue: fromNow(absoluteDate, locale),
          secondaryLabel: i18nMsg("previewCard.time.interval"),
          secondaryValue: formatDuration(diff, locale),
          sections: [
            {
              rows: [
                {
                  label: i18nMsg("previewCard.time.targetDate"),
                  value: absoluteDate.format("YYYY-MM-DD HH:mm:ss"),
                },
                {
                  label: i18nMsg("previewCard.time.milliseconds"),
                  value: diff.toString(),
                },
              ],
            },
          ],
        },
        durationMs: Date.now() - startedAt,
      };
    }

    const rangeMatch = text.match(RANGE_PATTERN);
    if (!rangeMatch) return null;
    const [, startRaw, endRaw] = rangeMatch;
    if (!startRaw || !endRaw) return null;
    const start = startRaw.toLowerCase() === "now" ? dayjs() : dayjs(startRaw);
    const end = endRaw.toLowerCase() === "now" ? dayjs() : dayjs(endRaw);
    if (!start.isValid() || !end.isValid()) return null;
    const diff = Math.abs(end.diff(start));

    const payload: PreviewCardPayload = {
      abilityId: this.id,
      title: text,
      subtitle: i18nMsg("previewCard.time.rangeSubtitle"),
      primaryLabel: i18nMsg("previewCard.time.interval"),
      primaryValue: formatDuration(diff, locale),
      secondaryLabel: i18nMsg("previewCard.time.milliseconds"),
      secondaryValue: diff.toString(),
      sections: [
        {
          rows: [
            {
              label: i18nMsg("previewCard.time.start"),
              value: start.format("YYYY-MM-DD HH:mm:ss"),
            },
            {
              label: i18nMsg("previewCard.time.end"),
              value: end.format("YYYY-MM-DD HH:mm:ss"),
            },
          ],
        },
      ],
    };

    return {
      abilityId: this.id,
      confidence: 0.75,
      payload,
      durationMs: Date.now() - startedAt,
    };
  }
}
