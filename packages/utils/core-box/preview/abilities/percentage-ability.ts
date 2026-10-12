import type {
  PreviewAbilityContext,
  PreviewAbilityResult,
  PreviewAbilitySafetyPolicy,
  PreviewCardPayload,
} from "../types";
import { i18nMsg } from "../../../i18n";
import { BasePreviewAbility } from "../sdk";

const PERCENT_PATTERNS = [
  /^\s*([-+]?(?:\d+(?:\.\d+)?|\.\d+))\s*([-+])\s*([-+]?(?:\d+(?:\.\d+)?|\.\d+))%\s*$/,
  /^\s*([-+]?(?:\d+(?:\.\d+)?|\.\d+))\s*\+\s*\(([-+]?(?:\d+(?:\.\d+)?|\.\d+))%\)\s*$/,
  /^\s*([-+]?(?:\d+(?:\.\d+)?|\.\d+))\s*-\s*\(([-+]?(?:\d+(?:\.\d+)?|\.\d+))%\)\s*$/,
  /^\s*([-+]?(?:\d+(?:\.\d+)?|\.\d+))\s*(?:的|的?)+\s*([-+]?(?:\d+(?:\.\d+)?|\.\d+))%\s*$/,
  /^\s*([-+]?(?:\d+(?:\.\d+)?|\.\d+))\s*% of\s*([-+]?(?:\d+(?:\.\d+)?|\.\d+))\s*$/i,
  /^\s*([-+]?(?:\d+(?:\.\d+)?|\.\d+))%\s*([-+])\s*([-+]?(?:\d+(?:\.\d+)?|\.\d+))%\s*$/,
  /^\s*([-+]?(?:\d+(?:\.\d+)?|\.\d+))\s*(?:增加|上涨|提高)\s*([-+]?(?:\d+(?:\.\d+)?|\.\d+))%\s*$/,
  /^\s*([-+]?(?:\d+(?:\.\d+)?|\.\d+))\s*(?:减少|下降|降低)\s*([-+]?(?:\d+(?:\.\d+)?|\.\d+))%\s*$/,
];

export class PercentageAbility extends BasePreviewAbility {
  readonly id = "preview.percent";
  override readonly label = "Percentage";
  readonly priority = 45;
  override readonly safety: PreviewAbilitySafetyPolicy = {
    input: {
      maxLength: 120,
      syntax:
        "percentage arithmetic patterns such as 100 + 20%, 20% of 80, 100 增加 20%",
      notes: "Regex parser only; no dynamic execution.",
    },
    dependencies: ["parser"],
    usesDynamicExecution: false,
    usesNetwork: false,
    usesCache: false,
  };

  override canHandle(query: { text?: string }): boolean {
    if (!query.text || query.text.length > this.safety.input.maxLength)
      return false;
    return PERCENT_PATTERNS.some((regex) => regex.test(query.text!));
  }

  override async execute(
    context: PreviewAbilityContext,
  ): Promise<PreviewAbilityResult | null> {
    const startedAt = Date.now();
    const query = this.getNormalizedQuery(context.query);
    let base = 0;
    let percent = 0;
    let operation: "add" | "sub" | "of" = "of";

    let purePercent = false;
    for (const regex of PERCENT_PATTERNS) {
      const match = query.match(regex);
      if (!match) continue;
      if (regex === PERCENT_PATTERNS[0]) {
        base = Number(match[1]);
        percent = Number(match[3]);
        operation = match[2] === "-" ? "sub" : "add";
      } else if (regex === PERCENT_PATTERNS[1]) {
        base = Number(match[1]);
        percent = Number(match[2]);
        operation = "add";
      } else if (regex === PERCENT_PATTERNS[2]) {
        base = Number(match[1]);
        percent = Number(match[2]);
        operation = "sub";
      } else if (regex === PERCENT_PATTERNS[4]) {
        percent = Number(match[1]);
        base = Number(match[2]);
        operation = "of";
      } else if (regex === PERCENT_PATTERNS[3]) {
        base = Number(match[1]);
        percent = Number(match[2]);
        operation = "of";
      } else if (regex === PERCENT_PATTERNS[6]) {
        base = Number(match[1]);
        percent = Number(match[2]);
        operation = "add";
      } else if (regex === PERCENT_PATTERNS[7]) {
        base = Number(match[1]);
        percent = Number(match[2]);
        operation = "sub";
      } else {
        base = Number(match[1]);
        percent = Number(match[3]);
        operation = match[2] === "-" ? "sub" : "add";
        purePercent = true;
      }
      break;
    }

    if (Number.isNaN(base) || Number.isNaN(percent)) return null;

    this.throwIfAborted(context.signal);

    const delta = purePercent ? percent : (base * percent) / 100;
    const result = purePercent
      ? operation === "add"
        ? base + percent
        : base - percent
      : operation === "add"
        ? base + delta
        : operation === "sub"
          ? base - delta
          : (percent * base) / 100;

    const payload: PreviewCardPayload = {
      abilityId: this.id,
      title: query,
      subtitle: purePercent
        ? i18nMsg("previewCard.percent.subtitleArithmetic")
        : operation === "of"
          ? i18nMsg("previewCard.percent.subtitleOf")
          : i18nMsg("previewCard.percent.subtitleChange"),
      primaryLabel: purePercent
        ? i18nMsg("previewCard.percent.percentResult")
        : i18nMsg("previewCard.common.result"),
      primaryValue: purePercent ? `${result}%` : result.toString(),
      secondaryLabel: purePercent
        ? i18nMsg("previewCard.percent.operation")
        : i18nMsg("previewCard.percent.delta"),
      secondaryValue: purePercent
        ? `${base}% ${operation === "add" ? "+" : "-"} ${percent}%`
        : delta.toString(),
      sections: [
        {
          rows: [
            {
              label: purePercent
                ? i18nMsg("previewCard.percent.basePercent")
                : i18nMsg("previewCard.percent.base"),
              value: base.toString(),
            },
            {
              label: i18nMsg("previewCard.percent.percent"),
              value: `${percent}%`,
            },
          ],
        },
      ],
    };

    return {
      abilityId: this.id,
      confidence: 0.7,
      payload,
      durationMs: Date.now() - startedAt,
    };
  }
}
