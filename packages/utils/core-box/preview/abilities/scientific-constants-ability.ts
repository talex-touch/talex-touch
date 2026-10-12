import type {
  PreviewAbilityContext,
  PreviewAbilityResult,
  PreviewAbilitySafetyPolicy,
  PreviewCardPayload,
} from "../types";
import { i18nMsg } from "../../../i18n";
import { BasePreviewAbility } from "../sdk";
import {
  findScientificConstant,
  SCIENTIFIC_CONSTANTS,
} from "./scientific-constants-data";

export {
  findScientificConstant,
  SCIENTIFIC_CONSTANTS,
} from "./scientific-constants-data";
export type { ScientificConstantDefinition } from "./scientific-constants-data";

/** Aliases are search vocabulary; the Chinese ones are only shown to zh-CN. */
const HAN_PATTERN = /[\u4E00-\u9FA5]/;

const CONSTANT_KEYWORDS =
  /(constant|常量|gravity|光速|speed of light|light speed|普朗克|玻尔兹曼|阿伏伽德罗|π|\bpi\b|planck|boltzmann|avogadro|faraday|圆周率|自然常数|euler['’]?s number|元电荷|elementary charge|fundamental charge|electric charge quantum|气体常数|重力|permittivity|permeability|\bepsilon(?:0|\s+naught)\b|\bmu(?:0|\s+naught)\b|介电|电容率|磁导率|electron mass|电子质量|proton mass|质子质量|bohr|玻尔|rydberg|里德伯|stefan|斯特藩|atmosphere|大气压|\batm\b|ħ|ℏ|\bh ?bar\b|[εμσρλ∞₀-₉ₑₚₙ])/i;

function formatValue(value: string): {
  formatted: string;
  scientific?: string;
} {
  const scientificMatch = /^-?\d+(\.\d+)?e[+-]?\d+$/i.test(value);
  if (scientificMatch) {
    const [coeff, exp] = value.toLowerCase().split("e");
    const formatted = `${coeff} × 10^${Number(exp)}`;
    return { formatted, scientific: value };
  }

  if (value.includes(".")) {
    const trimmed = value.replace(/\.?0+$/, "");
    return {
      formatted: trimmed,
    };
  }

  return { formatted: value };
}

export class ScientificConstantsAbility extends BasePreviewAbility {
  readonly id = "preview.constants.scientific";
  override readonly label = "Scientific Constants";
  readonly priority = 22;
  override readonly safety: PreviewAbilitySafetyPolicy = {
    input: {
      maxLength: 160,
      syntax: "scientific constant keywords or aliases",
      notes:
        "Static PreviewSDK constant lookup; no dynamic execution, network or cache.",
    },
    dependencies: ["parser"],
    usesDynamicExecution: false,
    usesNetwork: false,
    usesCache: false,
    replacementPlan: "Completed: constant table moved into PreviewSDK.",
  };

  override canHandle(query: { text?: string }): boolean {
    if (!query.text || query.text.length > this.safety.input.maxLength)
      return false;
    if (CONSTANT_KEYWORDS.test(query.text)) return true;
    // A Chinese alias is a full name, never a one-letter symbol, so it may open the card on its
    // own. The keywords above miss some of them, such as 万有引力常数, 法拉第常数 and 电子静止质量.
    return (
      HAN_PATTERN.test(query.text) && findScientificConstant(query.text) !== null
    );
  }

  override async execute(
    context: PreviewAbilityContext,
  ): Promise<PreviewAbilityResult | null> {
    const startedAt = Date.now();
    const text = this.getNormalizedQuery(context.query);
    if (!text || !this.isInputWithinLimit(context)) return null;

    const matched = findScientificConstant(text);
    if (!matched) return null;

    const value = formatValue(matched.value);
    const itemKey = `previewCard.constants.items.${matched.id}`;
    const showHanAliases = (context.locale ?? "zh-CN") === "zh-CN";

    const payload: PreviewCardPayload = {
      abilityId: this.id,
      title: i18nMsg(`${itemKey}.name`),
      subtitle: i18nMsg(`${itemKey}.category`),
      primaryLabel: i18nMsg("previewCard.constants.value"),
      primaryValue: value.formatted,
      primaryUnit: matched.unit,
      description: i18nMsg(`${itemKey}.description`),
      badges: [matched.symbol ?? "", matched.source ?? ""].filter(Boolean),
      chips: matched.aliases
        .filter((alias) => alias !== matched.name)
        .filter((alias) => showHanAliases || !HAN_PATTERN.test(alias))
        .slice(0, 3)
        .map((alias) => ({
          label: i18nMsg("previewCard.constants.alias"),
          value: alias,
        })),
      sections: [
        {
          title: i18nMsg("previewCard.constants.details"),
          rows: [
            { label: i18nMsg("previewCard.constants.id"), value: matched.id },
            ...(value.scientific
              ? [
                  {
                    label: i18nMsg("previewCard.constants.scientific"),
                    value: value.scientific,
                  },
                ]
              : []),
            {
              label: i18nMsg("previewCard.constants.source"),
              value: matched.source ?? "CODATA 2018",
            },
          ],
        },
      ],
      meta: {
        constantId: matched.id,
        aliases: matched.aliases,
        source: matched.source,
      },
    };

    return {
      abilityId: this.id,
      confidence: 0.7,
      payload,
      durationMs: Date.now() - startedAt,
    };
  }

  async preload(): Promise<void> {
    void SCIENTIFIC_CONSTANTS;
  }
}
