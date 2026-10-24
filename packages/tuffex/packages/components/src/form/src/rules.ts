import type { FormMessages, FormRule, FormValues } from './types'

export interface RuleOutcome {
  error?: string
  warning?: string
}

/** Empty for `required`: nothing typed, nothing picked, a checkbox left unticked. */
export function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null || value === '' || value === false)
    return true
  return Array.isArray(value) && value.length === 0
}

const asyncTag = '[object AsyncFunction]'
/** Validators found returning a promise without being declared `async`. */
const undeclaredAsync = new WeakSet<NonNullable<FormRule['validator']>>()

/** A rule TxForm defers: its validator is declared `async`. */
export function isAsyncRule(rule: FormRule): boolean {
  return !!rule.validator && Object.prototype.toString.call(rule.validator) === asyncTag
}

export function isThenable<T = unknown>(value: unknown): value is PromiseLike<T> {
  return !!value && typeof (value as PromiseLike<unknown>).then === 'function'
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function toNumber(value: unknown): number | null {
  if (typeof value === 'number')
    return Number.isNaN(value) ? null : value
  if (typeof value === 'string' && value.trim() !== '') {
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  }
  return null
}

function matchesType(value: unknown, type: NonNullable<FormRule['type']>): boolean {
  if (type === 'number' || type === 'integer') {
    const number = toNumber(value)
    return number !== null && (type === 'number' || Number.isInteger(number))
  }
  if (typeof value !== 'string')
    return false
  if (type === 'email')
    return EMAIL.test(value)
  try {
    return /^https?:$/.test(new URL(value).protocol)
  }
  catch {
    return false
  }
}

function lengthOf(value: unknown): number | null {
  if (typeof value === 'string' || Array.isArray(value))
    return value.length
  return null
}

/** The built-in checks of one rule. Every check but `required` passes an empty value. */
function checkBuiltIns(value: unknown, rule: FormRule, label: string, messages: FormMessages): string | null {
  if (isEmptyValue(value))
    return rule.required ? rule.message ?? messages.required(label) : null

  if (rule.type && !matchesType(value, rule.type))
    return rule.message ?? messages.type(label, rule.type)

  if (rule.min !== undefined || rule.max !== undefined) {
    const number = toNumber(value)
    if (number !== null && rule.min !== undefined && number < rule.min)
      return rule.message ?? messages.min(label, rule.min)
    if (number !== null && rule.max !== undefined && number > rule.max)
      return rule.message ?? messages.max(label, rule.max)
  }

  if (rule.minLength !== undefined || rule.maxLength !== undefined) {
    const length = lengthOf(value)
    const unit = Array.isArray(value) ? 'items' : 'characters'
    if (length !== null && rule.minLength !== undefined && length < rule.minLength)
      return rule.message ?? messages.minLength(label, rule.minLength, unit)
    if (length !== null && rule.maxLength !== undefined && length > rule.maxLength)
      return rule.message ?? messages.maxLength(label, rule.maxLength, unit)
  }

  if (rule.pattern) {
    // A `g` or `y` pattern keeps `lastIndex` between calls and would fail every
    // other check of the same value.
    rule.pattern.lastIndex = 0
    if (!rule.pattern.test(String(value)))
      return rule.message ?? messages.pattern(label)
  }

  return null
}

/** What a validator returned, as a message or `null` for a pass. */
export function readValidatorResult(result: unknown, rule: FormRule, label: string, messages: FormMessages): string | null {
  if (result === false)
    return rule.message ?? messages.invalid(label)
  if (typeof result === 'string' && result)
    return result
  return null
}

/** Files a failed rule's message; `true` when it is an error, which ends the run. */
export function record(outcome: RuleOutcome, rule: FormRule, message: string): boolean {
  if (rule.level === 'warning') {
    outcome.warning ??= message
    return false
  }
  outcome.error = message
  return true
}

/**
 * Runs everything that answers at once, in order, and stops at the first
 * error. Warnings never stop it. A validator that hands back a promise without
 * being declared `async` is reported once and left to the asynchronous pass.
 */
export function runSyncRules(
  value: unknown,
  rules: FormRule[],
  model: FormValues,
  path: string,
  label: string,
  messages: FormMessages,
  signal: AbortSignal,
): RuleOutcome {
  const outcome: RuleOutcome = {}
  for (const rule of rules) {
    const builtIn = checkBuiltIns(value, rule, label, messages)
    if (builtIn && record(outcome, rule, builtIn))
      return outcome
    if (builtIn || !rule.validator || isAsyncRule(rule) || undeclaredAsync.has(rule.validator))
      continue

    let message: string | null
    try {
      const result = rule.validator(value, rule, model, { signal, path })
      if (isThenable(result)) {
        warnUndeclaredAsync(rule.validator, path)
        continue
      }
      message = readValidatorResult(result, rule, label, messages)
    }
    catch (error) {
      console.warn(`[TxForm] The validator for "${path}" threw; the field counts as invalid.`, error)
      message = rule.message ?? messages.invalid(label)
    }
    if (message && record(outcome, rule, message))
      return outcome
  }
  return outcome
}

/** Validators the asynchronous pass runs: declared `async`, or found returning a promise. */
export function asyncRulesOf(rules: FormRule[]): FormRule[] {
  return rules.filter(rule => !!rule.validator && (isAsyncRule(rule) || undeclaredAsync.has(rule.validator)))
}

function warnUndeclaredAsync(validator: NonNullable<FormRule['validator']>, path: string): void {
  if (undeclaredAsync.has(validator))
    return
  undeclaredAsync.add(validator)
  console.warn(`[TxForm] The validator for "${path}" returned a promise. Declare it \`async\` so TxForm debounces it and runs it after the other rules pass.`)
}
