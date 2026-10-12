import type {
  PreviewAbilityContext,
  PreviewAbilityResult,
  PreviewAbilitySafetyPolicy,
  PreviewCardPayload,
} from "../types";
import { i18nMsg } from "../../../i18n";
import { BasePreviewAbility } from "../sdk";
import {
  formatUnitNumber,
  getUnitSuggestions,
  parseUnitQuery,
  resolveUnit,
} from "./unit-conversion-core";

export class UnitConversionAbility extends BasePreviewAbility {
  readonly id = "preview.unit";
  override readonly label = "Unit Conversion";
  readonly priority = 25;
  override readonly safety: PreviewAbilitySafetyPolicy = {
    input: {
      maxLength: 120,
      syntax:
        "numeric unit query with optional to/in/=/->/转/换算/换成 target unit",
      notes: "Uses shared static unit conversion tables; no formula evaluator.",
    },
    dependencies: ["parser"],
    usesDynamicExecution: false,
    usesNetwork: false,
    usesCache: false,
    replacementPlan:
      "Completed: Preview and calculation paths share static unit conversion core.",
  };

  override canHandle(query: { text?: string }): boolean {
    if (!query.text || query.text.length > this.safety.input.maxLength)
      return false;
    const parsed = parseUnitQuery(query.text);
    if (!parsed) return false;

    const fromUnit = resolveUnit(parsed.fromUnit);
    if (!fromUnit) return false;
    if (!parsed.toUnit) return true;

    const toUnit = resolveUnit(parsed.toUnit);
    return Boolean(toUnit && fromUnit.category === toUnit.category);
  }

  override async execute(
    context: PreviewAbilityContext,
  ): Promise<PreviewAbilityResult | null> {
    const startedAt = Date.now();
    const text = this.getNormalizedQuery(context.query);
    const locale = context.locale ?? "zh-CN";
    const parsed = parseUnitQuery(text);
    if (!parsed) return null;

    const fromUnit = resolveUnit(parsed.fromUnit, locale);
    if (!fromUnit) return null;

    const toUnit = parsed.toUnit ? resolveUnit(parsed.toUnit, locale) : null;
    if (toUnit && fromUnit.category !== toUnit.category) {
      return null;
    }

    this.throwIfAborted(context.signal);
    const baseValue = fromUnit.toBase(parsed.value);

    if (toUnit) {
      const converted = toUnit.fromBase(baseValue);
      const formattedResult = formatUnitNumber(converted);

      const payload: PreviewCardPayload = {
        abilityId: this.id,
        title: text,
        subtitle: i18nMsg("previewCard.unit.subtitle"),
        primaryLabel: `${fromUnit.display} → ${toUnit.display}`,
        primaryValue: formattedResult,
        secondaryLabel: i18nMsg("previewCard.unit.original"),
        secondaryValue: `${parsed.value} ${parsed.fromUnit}`,
        chips: [
          {
            label: fromUnit.display,
            value: `${parsed.value} ${parsed.fromUnit}`,
          },
          {
            label: toUnit.display,
            value: `${formattedResult} ${parsed.toUnit}`,
          },
        ],
        sections: [
          {
            title: i18nMsg("previewCard.common.details"),
            rows: [
              {
                label: i18nMsg("previewCard.unit.category"),
                value: i18nMsg(
                  `previewCard.unit.categories.${fromUnit.category}`,
                ),
              },
              {
                label: i18nMsg("previewCard.unit.formula"),
                value: `${parsed.fromUnit} → ${parsed.toUnit}`,
              },
            ],
          },
        ],
      };

      return {
        abilityId: this.id,
        confidence: 0.8,
        payload,
        durationMs: Date.now() - startedAt,
      };
    }

    const filteredRows = getUnitSuggestions(
      fromUnit.category,
      fromUnit.unit,
      locale,
    )
      .slice(0, 3)
      .map((target) => ({
        label: `${fromUnit.display} → ${target.display}`,
        value: `${formatUnitNumber(target.fromBase(baseValue))} ${target.unit.toUpperCase()}`,
      }));

    const payload: PreviewCardPayload = {
      abilityId: this.id,
      title: text,
      subtitle: i18nMsg("previewCard.unit.suggestionsSubtitle"),
      primaryLabel: fromUnit.display,
      primaryValue: `${parsed.value} ${parsed.fromUnit}`,
      sections: filteredRows.length
        ? [
            {
              title: i18nMsg("previewCard.unit.commonConversions"),
              rows: filteredRows,
            },
          ]
        : undefined,
    };

    return {
      abilityId: this.id,
      confidence: 0.5,
      payload,
      durationMs: Date.now() - startedAt,
    };
  }
}
