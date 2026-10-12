import type {
  PreviewAbilityContext,
  PreviewAbilityResult,
  PreviewAbilitySafetyPolicy,
  PreviewCardPayload,
} from "../types";
import type { TuffQuery } from "../../tuff";
import { i18nMsg } from "../../../i18n";
import { BasePreviewAbility } from "../sdk";

const EXPRESSION_REGEX = /^[\d+\-*/().%\s]+$/u;
const DATE_EXPRESSION_REGEX = /^((?:19|20|21)\d{2})([-/])(\d{1,2})\2(\d{1,2})$/u;
const DATE_RANGE_EXPRESSION_REGEX = /^(\d{4}-\d{2}-\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})$/u;

function isCalendarDate(text: string): boolean {
  const match = DATE_EXPRESSION_REGEX.exec(text);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[3]);
  const day = Number(match[4]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth;
}

/**
 * `2026-12-25` and `2026/12/25` are also a valid subtraction and division, and the expression
 * abilities run before the time ability. Text that forms a real calendar date in a plausible
 * year, or a range of two such dates in the form the time ability reads, is left to it.
 */
export function isDateLikeExpression(text: string): boolean {
  const normalized = text.trim();
  if (isCalendarDate(normalized)) return true;
  const range = DATE_RANGE_EXPRESSION_REGEX.exec(normalized);
  return Boolean(range && isCalendarDate(range[1]!) && isCalendarDate(range[2]!));
}

type Token =
  | { type: "number"; value: number }
  | { type: "operator"; value: "+" | "-" | "*" | "/" | "%" | "u+" | "u-" }
  | { type: "leftParen" }
  | { type: "rightParen" };

const OPERATOR_PRECEDENCE: Record<string, number> = {
  "u+": 4,
  "u-": 4,
  "*": 3,
  "/": 3,
  "%": 3,
  "+": 2,
  "-": 2,
};

const RIGHT_ASSOCIATIVE = new Set(["u+", "u-"]);

function formatNumber(value: number): string {
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    return "";
  }
  if (Number.isInteger(value)) {
    return value.toString();
  }
  return value.toFixed(6).replace(/\.?0+$/, "");
}

function tokenize(expression: string): Token[] | null {
  const tokens: Token[] = [];
  let index = 0;
  let expectsValue = true;

  while (index < expression.length) {
    const char = expression[index];
    if (!char) return null;

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (/\d|\./.test(char)) {
      const rest = expression.slice(index);
      const match = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)/);
      if (!match) return null;
      const value = Number(match[0]);
      if (!Number.isFinite(value)) return null;
      tokens.push({ type: "number", value });
      index += match[0].length;
      expectsValue = false;
      continue;
    }

    if (char === "(") {
      tokens.push({ type: "leftParen" });
      index += 1;
      expectsValue = true;
      continue;
    }

    if (char === ")") {
      tokens.push({ type: "rightParen" });
      index += 1;
      expectsValue = false;
      continue;
    }

    if ("+-*/%".includes(char)) {
      if (expectsValue && (char === "+" || char === "-")) {
        tokens.push({ type: "operator", value: char === "+" ? "u+" : "u-" });
      } else if (!expectsValue) {
        tokens.push({
          type: "operator",
          value: char as "+" | "-" | "*" | "/" | "%",
        });
        expectsValue = true;
        index += 1;
        continue;
      } else {
        return null;
      }
      index += 1;
      continue;
    }

    return null;
  }

  return tokens;
}

function toRpn(tokens: Token[]): Token[] | null {
  const output: Token[] = [];
  const operators: Token[] = [];

  for (const token of tokens) {
    if (token.type === "number") {
      output.push(token);
      continue;
    }

    if (token.type === "operator") {
      while (operators.length > 0) {
        const top = operators[operators.length - 1];
        if (!top || top.type !== "operator") break;
        const tokenPrecedence = OPERATOR_PRECEDENCE[token.value];
        const topPrecedence = OPERATOR_PRECEDENCE[top.value];
        if (
          typeof tokenPrecedence !== "number" ||
          typeof topPrecedence !== "number"
        )
          return null;
        const shouldPop = RIGHT_ASSOCIATIVE.has(token.value)
          ? tokenPrecedence < topPrecedence
          : tokenPrecedence <= topPrecedence;
        if (!shouldPop) break;
        output.push(operators.pop()!);
      }
      operators.push(token);
      continue;
    }

    if (token.type === "leftParen") {
      operators.push(token);
      continue;
    }

    let foundLeftParen = false;
    while (operators.length > 0) {
      const top = operators.pop()!;
      if (top.type === "leftParen") {
        foundLeftParen = true;
        break;
      }
      output.push(top);
    }
    if (!foundLeftParen) return null;
  }

  while (operators.length > 0) {
    const top = operators.pop()!;
    if (top.type === "leftParen" || top.type === "rightParen") return null;
    output.push(top);
  }

  return output;
}

function evaluateRpn(tokens: Token[]): number | null {
  const stack: number[] = [];

  for (const token of tokens) {
    if (token.type === "number") {
      stack.push(token.value);
      continue;
    }
    if (token.type !== "operator") return null;

    if (token.value === "u+" || token.value === "u-") {
      const value = stack.pop();
      if (typeof value !== "number") return null;
      stack.push(token.value === "u-" ? -value : value);
      continue;
    }

    const right = stack.pop();
    const left = stack.pop();
    if (typeof left !== "number" || typeof right !== "number") return null;

    switch (token.value) {
      case "+":
        stack.push(left + right);
        break;
      case "-":
        stack.push(left - right);
        break;
      case "*":
        stack.push(left * right);
        break;
      case "/":
        stack.push(left / right);
        break;
      case "%":
        stack.push(left % right);
        break;
    }
  }

  return stack.length === 1 && Number.isFinite(stack[0]!) ? stack[0]! : null;
}

export function evaluateBasicExpression(expression: string): number | null {
  if (!expression || !EXPRESSION_REGEX.test(expression)) {
    return null;
  }
  const tokens = tokenize(expression);
  if (!tokens?.length) return null;
  const rpn = toRpn(tokens);
  if (!rpn) return null;
  return evaluateRpn(rpn);
}

export class BasicExpressionAbility extends BasePreviewAbility {
  readonly id = "preview.expression.basic";
  override readonly label = "Basic Expression";
  readonly priority = 10;
  override readonly safety: PreviewAbilitySafetyPolicy = {
    input: {
      maxLength: 160,
      syntax: "digits, whitespace, parentheses, +, -, *, / and % only",
      notes:
        "Evaluated by the PreviewSDK arithmetic parser; no dynamic code execution.",
    },
    dependencies: ["parser"],
    usesDynamicExecution: false,
    usesNetwork: false,
    usesCache: false,
    replacementPlan:
      "Completed: Function constructor replaced by a local arithmetic parser.",
  };

  override canHandle(query: TuffQuery): boolean {
    const normalized = query.text?.trim() ?? "";
    if (
      normalized.length < 2 ||
      normalized.length > this.safety.input.maxLength
    )
      return false;
    if (!/[+\-*/%]/.test(normalized)) return false;
    if (isDateLikeExpression(normalized)) return false;
    return EXPRESSION_REGEX.test(normalized);
  }

  override async execute(
    context: PreviewAbilityContext,
  ): Promise<PreviewAbilityResult | null> {
    const startedAt = Date.now();
    const expression = this.getNormalizedQuery(context.query);
    if (!expression || !this.isInputWithinLimit(context)) return null;

    const sanitized = expression.replace(/[^0-9+\-*/().%\s]/g, "");
    this.throwIfAborted(context.signal);
    const evaluated = evaluateBasicExpression(sanitized);
    if (evaluated === null) {
      return null;
    }

    const payload: PreviewCardPayload = {
      abilityId: this.id,
      title: expression,
      subtitle: i18nMsg("previewCard.basic.subtitle"),
      primaryLabel: i18nMsg("previewCard.common.result"),
      primaryValue: formatNumber(evaluated),
      sections: [
        {
          rows: [
            {
              label: i18nMsg("previewCard.common.expression"),
              value: expression,
            },
            { label: i18nMsg("previewCard.basic.sanitized"), value: sanitized },
          ],
        },
      ],
      meta: {
        expression,
        sanitized,
      },
    };

    return {
      abilityId: this.id,
      confidence: 0.6,
      payload,
      durationMs: Date.now() - startedAt,
    };
  }
}
