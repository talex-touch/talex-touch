import { defineEvent } from '../event/builder'

export type ScreenshotSessionCompletionMode = 'editor' | 'return-resource'
export type ScreenshotSessionInitialTarget = 'free-region' | 'display' | 'window' | 'ui-element'
export type ScreenshotSessionDelayMs = 0 | 3000 | 5000
export type ScreenshotSessionPhase = 'preparing' | 'selecting' | 'confirming' | 'editing' | 'tearing-down'
export type ScreenshotSessionMode = 'frozen' | 'live'
export type ScreenshotSelectionTargetMode = 'free-region' | 'object'

export interface ScreenshotRect {
  x: number
  y: number
  width: number
  height: number
}

export interface ScreenshotPoint {
  x: number
  y: number
}

export interface ScreenshotSafeAreaInsets {
  top: number
  right: number
  bottom: number
  left: number
}

export interface ScreenshotSessionStartRequest {
  completionMode?: ScreenshotSessionCompletionMode
  delayMs?: ScreenshotSessionDelayMs
  initialTarget?: ScreenshotSessionInitialTarget
}

export interface NormalizedScreenshotSessionStartRequest {
  completionMode: ScreenshotSessionCompletionMode
  delayMs: ScreenshotSessionDelayMs
  initialTarget: ScreenshotSessionInitialTarget
}

export interface ScreenshotSessionStartResponse {
  accepted: boolean
  sessionId?: string
  state?: 'started' | 'existing'
  reason?: string
}

export interface ScreenshotManagedResource {
  tfileUrl: string
  mimeType: 'image/png'
  width: number
  height: number
  sizeBytes: number
}

export type ScreenshotSessionResult =
  | {
      status: 'completed'
      sessionId: string
      resource: ScreenshotManagedResource
    }
  | {
      status: 'canceled'
      sessionId: string
      reason?: string
    }
  | {
      status: 'failed'
      sessionId: string
      code: string
      reason?: string
    }

export interface ScreenshotSessionWaitResultRequest {
  sessionId: string
}

export interface ScreenshotOverlayDisplay {
  id: string
  bounds: ScreenshotRect
  scaleFactor: number
  rotation: 0 | 90 | 180 | 270
  frozenTfileUrl?: string
}

export interface ScreenshotOverlayCapability {
  available: boolean
  reason?: string
}

export interface ScreenshotOverlayOptions {
  cursor: boolean
  cornerRadius: number
  border: boolean
  shadow: boolean
  aspectRatio?: number
}

/** Why a UI-element hit test fell back to its window (mirrors the native protocol values). */
export type ScreenshotAccessibilityFallback = 'permission-denied' | 'timeout' | 'unsupported' | 'unverified-window'

/**
 * A native hit-test candidate, without its native identity. `sequence` is the pointer request
 * that produced it; a lock must name the sequence the renderer actually displayed. `level`
 * indexes the native chain (0 = deepest UI element, then its window) and `levels` is its length.
 */
export interface ScreenshotOverlayCandidate {
  sequence: number
  kind: 'window' | 'ui-element'
  bounds: ScreenshotRect
  role?: string
  level: number
  levels: number
  fallback?: ScreenshotAccessibilityFallback
}

/** What the current selection means: a native target keeps its semantics until it is edited. */
export type ScreenshotSelectionSource = 'region' | 'grid' | 'window' | 'ui-element'

export interface ScreenshotOverlaySelectionTarget {
  source: ScreenshotSelectionSource
  role?: string
}

/**
 * Inline annotation source. The source image is immutable for the edit; annotations are drawn in
 * its pixel space. `sourceUrl` is a short-lived capability URL that the overlay may read back into
 * a canvas. `bounds` is where the source sits on the desktop in global DIP.
 */
export interface ScreenshotOverlayEditState {
  editId: string
  displayId: string
  sourceUrl: string
  width: number
  height: number
  bounds: ScreenshotRect
  committedRevision?: number
}

export interface ScreenshotOverlayState {
  sessionId: string
  phase: ScreenshotSessionPhase
  mode: ScreenshotSessionMode
  targetMode: ScreenshotSelectionTargetMode
  display: ScreenshotOverlayDisplay
  safeAreaInsets: ScreenshotSafeAreaInsets
  desktopBounds: ScreenshotRect
  selection?: ScreenshotRect
  selectionTarget?: ScreenshotOverlaySelectionTarget
  candidate?: ScreenshotOverlayCandidate
  hitTestError?: string
  edit?: ScreenshotOverlayEditState
  options: ScreenshotOverlayOptions
  capabilities: Record<string, ScreenshotOverlayCapability>
}

/** Largest edited PNG the overlay may commit (matches the native compose packet budget). */
export const SCREENSHOT_EDIT_MAX_PNG_BYTES = 64 * 1024 * 1024

export type ScreenshotOverlayOutputCommand =
  | { type: 'copy'; revision?: number }
  | { type: 'save'; revision?: number }
  | { type: 'confirm'; revision?: number }

export type ScreenshotOverlayCommand =
  | { type: 'set-selection'; selection: ScreenshotRect; source?: 'region' | 'grid' }
  | { type: 'clear-selection' }
  | { type: 'set-mode'; mode: ScreenshotSessionMode }
  | { type: 'set-target-mode'; targetMode: ScreenshotSelectionTargetMode }
  | { type: 'set-options'; options: Partial<ScreenshotOverlayOptions> }
  | { type: 'pointer'; point: ScreenshotPoint; sequence: number }
  | { type: 'set-candidate-level'; sequence: number; level: number }
  | { type: 'lock-candidate'; sequence: number }
  | { type: 'begin-edit' }
  | { type: 'end-edit' }
  | { type: 'commit-edit'; editId: string; revision: number; png: Uint8Array }
  | ScreenshotOverlayOutputCommand
  | { type: 'cancel' }

export interface ScreenshotOverlayCommandRequest {
  sessionId: string
  command: ScreenshotOverlayCommand
}

export interface ScreenshotOverlayCommandResponse {
  accepted: boolean
  reason?: string
}

const START_KEYS = new Set(['completionMode', 'delayMs', 'initialTarget'])
const COMPLETION_MODES = new Set<ScreenshotSessionCompletionMode>(['editor', 'return-resource'])
const DELAYS = new Set<ScreenshotSessionDelayMs>([0, 3000, 5000])
const INITIAL_TARGETS = new Set<ScreenshotSessionInitialTarget>(['free-region', 'display', 'window', 'ui-element'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function normalizeScreenshotSessionStartRequest(value: unknown): NormalizedScreenshotSessionStartRequest | null {
  if (value === undefined) {
    return {
      completionMode: 'editor',
      delayMs: 0,
      initialTarget: 'free-region',
    }
  }
  if (!isRecord(value) || Object.keys(value).some(key => !START_KEYS.has(key))) {
    return null
  }

  const completionMode = value.completionMode ?? 'editor'
  const delayMs = value.delayMs ?? 0
  const initialTarget = value.initialTarget ?? 'free-region'
  if (
    !COMPLETION_MODES.has(completionMode as ScreenshotSessionCompletionMode) ||
    !DELAYS.has(delayMs as ScreenshotSessionDelayMs) ||
    !INITIAL_TARGETS.has(initialTarget as ScreenshotSessionInitialTarget)
  ) {
    return null
  }

  return {
    completionMode: completionMode as ScreenshotSessionCompletionMode,
    delayMs: delayMs as ScreenshotSessionDelayMs,
    initialTarget: initialTarget as ScreenshotSessionInitialTarget,
  }
}

export const ScreenshotSessionEvents = {
  lifecycle: {
    start: defineEvent('screenshot-session')
      .module('lifecycle')
      .event('start')
      .define<ScreenshotSessionStartRequest | void, ScreenshotSessionStartResponse>(),
    waitResult: defineEvent('screenshot-session')
      .module('lifecycle')
      .event('wait-result')
      .define<ScreenshotSessionWaitResultRequest, ScreenshotSessionResult>(),
  },
  overlay: {
    ready: defineEvent('screenshot-session').module('overlay').event('ready').define<void, ScreenshotOverlayState>(),
    state: defineEvent('screenshot-session').module('overlay').event('state').define<ScreenshotOverlayState, void>(),
    command: defineEvent('screenshot-session')
      .module('overlay')
      .event('command')
      .define<ScreenshotOverlayCommandRequest, ScreenshotOverlayCommandResponse>(),
  },
} as const
