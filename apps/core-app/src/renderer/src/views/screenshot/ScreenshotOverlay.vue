<script setup lang="ts">
import type {
  ScreenshotGeometryPoint,
  ScreenshotGeometryRect,
  ScreenshotResizeHandle,
  ScreenshotSelectionAnchor
} from '@talex-touch/utils/renderer'
import {
  createScreenshotSelection,
  moveScreenshotSelection,
  nudgeScreenshotSelection,
  projectScreenshotSelection,
  resizeScreenshotSelection,
  setScreenshotSelectionSize,
  snapshotScreenshotSelection,
  screenshotGridCell
} from '@talex-touch/utils/renderer'
import type {
  ScreenshotOverlayCommand,
  ScreenshotOverlayOptions,
  ScreenshotOverlayState
} from '@talex-touch/utils/transport/events/screenshot-session'
import { ScreenshotSessionEvents } from '@talex-touch/utils/transport/events/screenshot-session'
import { useTuffTransport } from '@talex-touch/utils/transport'
import { useI18n } from 'vue-i18n'
import {
  AnnotationDocument,
  renderDocumentToPng,
  drawAnnotationObject,
  drawSelectionBox,
  DEFAULT_ANNOTATION_STYLE,
  PRESET_COLORS,
  PRESET_STROKE_WIDTHS,
  type AnnotationTool,
  type AnnotationStyle,
  type AnnotationObject,
  type AnnotationPoint
} from './annotation'

interface PointerInteraction {
  kind: 'create' | 'move' | 'resize'
  start: ScreenshotGeometryPoint
  original?: ScreenshotGeometryRect
  handle?: ScreenshotResizeHandle
  pointerId: number
}

interface AnnotationDragState {
  kind: 'create' | 'move'
  start: AnnotationPoint
  initialObject?: AnnotationObject
  currentObject?: AnnotationObject
}

const HANDLE_NAMES: ScreenshotResizeHandle[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']
const TARGET_GRID_POINTS = ['nw', 'n', 'ne', 'w', 'center', 'e', 'sw', 's', 'se'] as const
const GRID_CELL_KEYS = ['q', 'w', 'e', 'a', 's', 'd', 'z', 'x', 'c']

const transport = useTuffTransport()
const { t } = useI18n()

const state = ref<ScreenshotOverlayState | null>(null)
const selection = ref<ScreenshotGeometryRect | null>(null)
const interaction = ref<PointerInteraction | null>(null)
const busy = ref(false)
const errorCode = ref('')
const widthInput = ref('')
const heightInput = ref('')
const selectedAnchor = ref<ScreenshotSelectionAnchor>('center')
const pointerLocal = ref<ScreenshotGeometryPoint | null>(null)

// 9-grid keyboard navigation state
const gridNavActive = ref(false)
const gridStack = ref<ScreenshotGeometryRect[]>([])

// Inline Annotation Editing state
const isEditing = computed(() => state.value?.phase === 'editing')
const editState = computed(() => state.value?.edit ?? null)
const annotationDoc = shallowRef(new AnnotationDocument())
const activeTool = ref<AnnotationTool>('rectangle')
const currentStyle = ref<AnnotationStyle>({ ...DEFAULT_ANNOTATION_STYLE })
const styleCapsuleOpen = ref(false)
const baseImage = ref<HTMLImageElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const annotationDrag = ref<AnnotationDragState | null>(null)

let pointerSequence = 0
let disposeStateListener: (() => void) | null = null
let lastHitTestAt = 0
let suppressEscapeUntil = 0
let commitDebounceTimer: ReturnType<typeof setTimeout> | null = null

const displayBounds = computed<ScreenshotGeometryRect | null>(
  () => state.value?.display.bounds ?? null
)
const selectionBounds = computed<ScreenshotGeometryRect | null>(
  () => state.value?.desktopBounds ?? null
)
const localSelection = computed(() => {
  if (!selection.value || !displayBounds.value) return null
  return projectScreenshotSelection(selection.value, displayBounds.value)
})
const selectionStyle = computed(() => {
  const rect = localSelection.value
  if (!rect) return undefined
  return {
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`
  }
})
const localCandidate = computed(() => {
  if (!state.value?.candidate || !displayBounds.value) return null
  return projectScreenshotSelection(state.value.candidate.bounds, displayBounds.value)
})
const candidateStyle = computed(() => {
  const rect = localCandidate.value
  return rect
    ? {
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`
      }
    : undefined
})
const isObjectMode = computed(() => state.value?.targetMode === 'object')
const isFrozen = computed(() => state.value?.mode === 'frozen')
const safeAreaInsets = computed(
  () => state.value?.safeAreaInsets ?? { top: 0, right: 0, bottom: 0, left: 0 }
)
const overlayStyle = computed<Record<string, string>>(() => ({
  '--screenshot-safe-top': `${safeAreaInsets.value.top}px`,
  '--screenshot-safe-right': `${safeAreaInsets.value.right}px`,
  '--screenshot-safe-bottom': `${safeAreaInsets.value.bottom}px`,
  '--screenshot-safe-left': `${safeAreaInsets.value.left}px`
}))

const magnifierStyle = computed(() => {
  const point = pointerLocal.value
  const display = displayBounds.value
  const url = state.value?.display.frozenTfileUrl
  if (!point || !display || !url || !isFrozen.value || isEditing.value) return undefined
  const safeArea = safeAreaInsets.value
  const minimumLeft = safeArea.left + 8
  const minimumTop = safeArea.top + 8
  const left = Math.min(
    Math.max(minimumLeft, point.x + 18),
    Math.max(minimumLeft, display.width - safeArea.right - 132)
  )
  const top = Math.min(
    Math.max(minimumTop, point.y + 18),
    Math.max(minimumTop, display.height - safeArea.bottom - 102)
  )
  return {
    left: `${left}px`,
    top: `${top}px`,
    backgroundImage: `url(${JSON.stringify(url)})`,
    backgroundSize: `${display.width * 4}px ${display.height * 4}px`,
    backgroundPosition: `${60 - point.x * 4}px ${44 - point.y * 4}px`
  }
})
const optionState = computed(() => state.value?.options)
const hasOutputTarget = computed(() => Boolean(selection.value || state.value?.candidate))

// Active 9-grid region being navigated
const currentGridRegion = computed<ScreenshotGeometryRect | null>(() => {
  if (!gridNavActive.value || !displayBounds.value) return null
  return gridStack.value[gridStack.value.length - 1] ?? displayBounds.value
})

const gridCells = computed(() => {
  const region = currentGridRegion.value
  if (!region) return []
  return Array.from({ length: 9 }, (_, index) => ({
    index,
    key: GRID_CELL_KEYS[index].toUpperCase(),
    rect: screenshotGridCell(region, index)!
  }))
})

function localToGlobal(event: PointerEvent): ScreenshotGeometryPoint | null {
  const display = displayBounds.value
  if (!display) return null
  if (Number.isFinite(event.screenX) && Number.isFinite(event.screenY)) {
    return { x: event.screenX, y: event.screenY }
  }
  return {
    x: display.x + event.clientX,
    y: display.y + event.clientY
  }
}

function updateInputs(rect: ScreenshotGeometryRect | null): void {
  widthInput.value = rect ? String(Math.round(rect.width)) : ''
  heightInput.value = rect ? String(Math.round(rect.height)) : ''
}

async function dispatchCommand(command: ScreenshotOverlayCommand): Promise<boolean> {
  const current = state.value
  if (!current) return false
  try {
    const response = await transport.send(ScreenshotSessionEvents.overlay.command, {
      sessionId: current.sessionId,
      command
    })
    if (!response.accepted) {
      errorCode.value = response.reason ?? 'command-rejected'
      return false
    }
    return true
  } catch {
    errorCode.value = 'transport-failed'
    return false
  }
}

function startCreate(event: PointerEvent): void {
  if (
    busy.value ||
    isEditing.value ||
    gridNavActive.value ||
    event.button !== 0 ||
    !selectionBounds.value
  )
    return
  const point = localToGlobal(event)
  if (!point) return
  errorCode.value = ''
  interaction.value = { kind: 'create', start: point, pointerId: event.pointerId }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function startMove(event: PointerEvent): void {
  if (busy.value || isEditing.value || event.button !== 0 || !selection.value) return
  const point = localToGlobal(event)
  if (!point) return
  interaction.value = {
    kind: 'move',
    start: point,
    original: { ...selection.value },
    pointerId: event.pointerId
  }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function startResize(handle: ScreenshotResizeHandle, event: PointerEvent): void {
  if (busy.value || isEditing.value || event.button !== 0 || !selection.value) return
  const point = localToGlobal(event)
  if (!point) return
  interaction.value = {
    kind: 'resize',
    handle,
    start: point,
    original: { ...selection.value },
    pointerId: event.pointerId
  }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function updatePointer(event: PointerEvent): void {
  pointerLocal.value = { x: event.clientX, y: event.clientY }
  if (isEditing.value || gridNavActive.value) return
  const currentInteraction = interaction.value
  const bounds = selectionBounds.value
  const point = localToGlobal(event)
  if (!bounds || !point) return
  if (!currentInteraction) {
    if (selection.value) return
    if (performance.now() - lastHitTestAt >= 48) {
      lastHitTestAt = performance.now()
      void dispatchCommand({ type: 'pointer', point, sequence: ++pointerSequence })
    }
    return
  }

  if (currentInteraction.kind === 'create') {
    selection.value = createScreenshotSelection(currentInteraction.start, point, bounds, 4)
  } else if (currentInteraction.original) {
    const deltaX = point.x - currentInteraction.start.x
    const deltaY = point.y - currentInteraction.start.y
    selection.value =
      currentInteraction.kind === 'move'
        ? moveScreenshotSelection(currentInteraction.original, deltaX, deltaY, bounds)
        : resizeScreenshotSelection(
            currentInteraction.original,
            currentInteraction.handle ?? 'se',
            deltaX,
            deltaY,
            bounds,
            {
              aspectRatio: optionState.value?.aspectRatio
            }
          )
  }
  updateInputs(selection.value)
}

async function selectCandidate(): Promise<void> {
  const candidate = state.value?.candidate
  if (!candidate || busy.value) return
  const next = snapshotScreenshotSelection(candidate.bounds)
  selection.value = next
  updateInputs(next)
  await dispatchCommand({ type: 'lock-candidate', sequence: candidate.sequence })
}

async function cycleCandidateLevel(): Promise<void> {
  const candidate = state.value?.candidate
  if (!candidate || candidate.levels <= 1) return
  const nextLevel = (candidate.level + 1) % candidate.levels
  await dispatchCommand({
    type: 'set-candidate-level',
    sequence: candidate.sequence,
    level: nextLevel
  })
}

async function finishPointer(event: PointerEvent): Promise<void> {
  if (isEditing.value || gridNavActive.value) return
  const currentInteraction = interaction.value
  if (!currentInteraction) {
    await selectCandidate()
    return
  }
  const point = localToGlobal(event)
  const candidateClick =
    currentInteraction.kind === 'create' &&
    point !== null &&
    Math.hypot(point.x - currentInteraction.start.x, point.y - currentInteraction.start.y) < 6 &&
    Boolean(state.value?.candidate)
  if (candidateClick) {
    interaction.value = null
    await selectCandidate()
    return
  }
  updatePointer(event)
  interaction.value = null
  if (selection.value) {
    await dispatchCommand({
      type: 'set-selection',
      selection: snapshotScreenshotSelection(selection.value),
      source: 'region'
    })
  }
}

async function clearSelection(): Promise<void> {
  if (busy.value) return
  selection.value = null
  updateInputs(null)
  await dispatchCommand({ type: 'clear-selection' })
}

async function setTargetMode(targetMode: 'free-region' | 'object'): Promise<void> {
  if (!state.value || state.value.targetMode === targetMode) return
  if (await dispatchCommand({ type: 'set-target-mode', targetMode })) {
    state.value = { ...state.value, targetMode, candidate: undefined, selection: undefined }
    selection.value = null
    updateInputs(null)
  }
}

async function setMode(mode: 'frozen' | 'live'): Promise<void> {
  if (!state.value || state.value.mode === mode) return
  if (await dispatchCommand({ type: 'set-mode', mode })) {
    state.value = { ...state.value, mode }
  }
}

async function setOption(options: Partial<ScreenshotOverlayOptions>): Promise<void> {
  if (!state.value || !(await dispatchCommand({ type: 'set-options', options }))) return
  state.value = {
    ...state.value,
    options: { ...state.value.options, ...options }
  }
}

async function toggleCursor(): Promise<void> {
  const enabled = !optionState.value?.cursor
  if (enabled && isFrozen.value) await setMode('live')
  await setOption({ cursor: enabled })
}

async function applyManualSize(): Promise<void> {
  const bounds = selectionBounds.value
  const current = selection.value
  if (!bounds || !current) return
  const width = Number(widthInput.value)
  const height = Number(heightInput.value)
  const next = setScreenshotSelectionSize(current, width, height, bounds, {
    aspectRatio: optionState.value?.aspectRatio,
    anchor: selectedAnchor.value
  })
  selection.value = next
  updateInputs(next)
  await dispatchCommand({ type: 'set-selection', selection: snapshotScreenshotSelection(next) })
}

// 9-Grid keyboard navigation functions
function toggleGridNav(): void {
  if (selection.value || isEditing.value || !displayBounds.value) return
  gridNavActive.value = !gridNavActive.value
  gridStack.value = gridNavActive.value ? [displayBounds.value] : []
}

async function selectGridCell(index: number): Promise<void> {
  const region = currentGridRegion.value
  if (!region) return
  const next = screenshotGridCell(region, index)
  if (!next) return
  // If the cell is small enough (or level 3 reached), commit selection directly
  if (next.width < 120 || next.height < 90 || gridStack.value.length >= 3) {
    selection.value = next
    updateInputs(next)
    gridNavActive.value = false
    gridStack.value = []
    await dispatchCommand({
      type: 'set-selection',
      selection: snapshotScreenshotSelection(next),
      source: 'grid'
    })
  } else {
    gridStack.value.push(next)
  }
}

function retreatGridNav(): void {
  if (gridStack.value.length > 1) {
    gridStack.value.pop()
  } else {
    gridNavActive.value = false
    gridStack.value = []
  }
}

// Annotation editing functions
async function startEdit(): Promise<void> {
  if (!selection.value || busy.value || isEditing.value) return
  busy.value = true
  const accepted = await dispatchCommand({ type: 'begin-edit' })
  busy.value = false
  if (accepted) {
    annotationDoc.value = new AnnotationDocument()
  }
}

async function endEdit(): Promise<void> {
  if (!isEditing.value || busy.value) return
  busy.value = true
  await dispatchCommand({ type: 'end-edit' })
  busy.value = false
  baseImage.value = null
}

function redrawCanvas(): void {
  const canvas = canvasRef.value
  const img = baseImage.value
  if (!canvas || !img) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

  for (const obj of annotationDoc.value.objects) {
    drawAnnotationObject(ctx, obj)
  }

  // Draw transient preview object being dragged
  if (annotationDrag.value?.currentObject) {
    drawAnnotationObject(ctx, annotationDrag.value.currentObject)
  }

  // Draw selection box around active selected object in 'select' mode
  const selected = annotationDoc.value.selectedObject
  if (selected && activeTool.value === 'select') {
    const bounds = AnnotationDocument.getBounds(selected)
    drawSelectionBox(ctx, bounds)
  }
}

async function scheduleCommitEdit(): Promise<void> {
  if (commitDebounceTimer) clearTimeout(commitDebounceTimer)
  commitDebounceTimer = setTimeout(async () => {
    const edit = editState.value
    const img = baseImage.value
    if (!edit || !img || !isEditing.value) return
    try {
      const pngBytes = await renderDocumentToPng(img, edit.width, edit.height, annotationDoc.value)
      await dispatchCommand({
        type: 'commit-edit',
        editId: edit.editId,
        revision: annotationDoc.value.revision,
        png: pngBytes
      })
    } catch {
      // Ignored; next edit or output action will re-commit
    }
  }, 100)
}

function getCanvasPoint(event: PointerEvent): AnnotationPoint | null {
  const canvas = canvasRef.value
  if (!canvas) return null
  const rect = canvas.getBoundingClientRect()
  const scaleX = canvas.width / rect.width
  const scaleY = canvas.height / rect.height
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY
  }
}

function handleCanvasPointerDown(event: PointerEvent): void {
  if (event.button !== 0 || !isEditing.value) return
  const pt = getCanvasPoint(event)
  if (!pt) return
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)

  if (activeTool.value === 'select') {
    const hitIdx = annotationDoc.value.hitTest(pt)
    annotationDoc.value.selectedIndex = hitIdx
    if (hitIdx !== null) {
      const target = annotationDoc.value.selectedObject!
      annotationDrag.value = {
        kind: 'move',
        start: pt,
        initialObject: { ...target },
        currentObject: { ...target }
      }
    }
    redrawCanvas()
    return
  }

  // Creating new annotation object
  const id = `annot-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const style = currentStyle.value
  let initialObject: AnnotationObject

  switch (activeTool.value) {
    case 'rectangle':
      initialObject = {
        id,
        kind: 'rectangle',
        x: pt.x,
        y: pt.y,
        width: 0,
        height: 0,
        color: style.color,
        strokeWidth: style.strokeWidth,
        filled: style.filled
      }
      break
    case 'ellipse':
      initialObject = {
        id,
        kind: 'ellipse',
        x: pt.x,
        y: pt.y,
        width: 0,
        height: 0,
        color: style.color,
        strokeWidth: style.strokeWidth,
        filled: style.filled
      }
      break
    case 'line':
      initialObject = {
        id,
        kind: 'line',
        start: { ...pt },
        end: { ...pt },
        color: style.color,
        strokeWidth: style.strokeWidth
      }
      break
    case 'arrow':
      initialObject = {
        id,
        kind: 'arrow',
        start: { ...pt },
        end: { ...pt },
        color: style.color,
        strokeWidth: style.strokeWidth
      }
      break
    case 'brush':
      initialObject = {
        id,
        kind: 'brush',
        points: [{ ...pt }],
        color: style.color,
        strokeWidth: style.strokeWidth
      }
      break
    case 'pixelate':
      initialObject = {
        id,
        kind: 'pixelate',
        x: pt.x,
        y: pt.y,
        width: 0,
        height: 0,
        color: '#000000',
        strokeWidth: 1,
        blockSize: 10
      }
      break
    case 'text': {
      const text = window.prompt(t('screenshot.editor.annotation') || 'Text')
      if (text && text.trim()) {
        annotationDoc.value.add({
          id,
          kind: 'text',
          x: pt.x,
          y: pt.y,
          text: text.trim(),
          fontSize: style.fontSize,
          color: style.color,
          strokeWidth: 1
        })
        redrawCanvas()
        void scheduleCommitEdit()
      }
      return
    }
    default:
      return
  }

  annotationDrag.value = {
    kind: 'create',
    start: pt,
    initialObject,
    currentObject: initialObject
  }
  redrawCanvas()
}

function handleCanvasPointerMove(event: PointerEvent): void {
  const drag = annotationDrag.value
  if (!drag) return
  const pt = getCanvasPoint(event)
  if (!pt) return

  if (drag.kind === 'move' && drag.initialObject) {
    const deltaX = pt.x - drag.start.x
    const deltaY = pt.y - drag.start.y
    drag.currentObject = AnnotationDocument.translate(drag.initialObject, deltaX, deltaY)
  } else if (drag.kind === 'create' && drag.currentObject) {
    const obj = drag.currentObject
    switch (obj.kind) {
      case 'rectangle':
      case 'ellipse':
      case 'pixelate':
        obj.x = Math.min(drag.start.x, pt.x)
        obj.y = Math.min(drag.start.y, pt.y)
        obj.width = Math.abs(pt.x - drag.start.x)
        obj.height = Math.abs(pt.y - drag.start.y)
        break
      case 'line':
      case 'arrow':
        obj.end = { ...pt }
        break
      case 'brush':
        obj.points.push({ ...pt })
        break
    }
  }
  redrawCanvas()
}

function handleCanvasPointerUp(): void {
  const drag = annotationDrag.value
  if (!drag) return
  if (drag.kind === 'move' && drag.currentObject && annotationDoc.value.selectedIndex !== null) {
    annotationDoc.value.replace(annotationDoc.value.selectedIndex, drag.currentObject)
  } else if (drag.kind === 'create' && drag.currentObject) {
    const obj = drag.currentObject
    let valid = true
    if (obj.kind === 'rectangle' || obj.kind === 'ellipse' || obj.kind === 'pixelate') {
      valid = obj.width > 2 && obj.height > 2
    } else if (obj.kind === 'line' || obj.kind === 'arrow') {
      valid = Math.hypot(obj.end.x - obj.start.x, obj.end.y - obj.start.y) > 4
    } else if (obj.kind === 'brush') {
      valid = obj.points.length > 1
    }
    if (valid) {
      annotationDoc.value.add(obj)
    }
  }
  annotationDrag.value = null
  redrawCanvas()
  void scheduleCommitEdit()
}

function undoAnnotation(): void {
  if (annotationDoc.value.undo()) {
    redrawCanvas()
    void scheduleCommitEdit()
  }
}

function redoAnnotation(): void {
  if (annotationDoc.value.redo()) {
    redrawCanvas()
    void scheduleCommitEdit()
  }
}

function deleteSelectedAnnotation(): void {
  if (annotationDoc.value.selectedIndex !== null) {
    annotationDoc.value.remove(annotationDoc.value.selectedIndex)
    redrawCanvas()
    void scheduleCommitEdit()
  }
}

async function runOutput(action: 'copy' | 'save' | 'confirm'): Promise<void> {
  if (!hasOutputTarget.value || busy.value) return
  busy.value = true
  errorCode.value = ''
  if (action === 'save') suppressEscapeUntil = Number.POSITIVE_INFINITY

  // If currently in editing phase, ensure the latest revision is committed before output
  if (isEditing.value) {
    const edit = editState.value
    const img = baseImage.value
    if (edit && img && edit.committedRevision !== annotationDoc.value.revision) {
      try {
        const pngBytes = await renderDocumentToPng(
          img,
          edit.width,
          edit.height,
          annotationDoc.value
        )
        await dispatchCommand({
          type: 'commit-edit',
          editId: edit.editId,
          revision: annotationDoc.value.revision,
          png: pngBytes
        })
      } catch {
        // Fall back to attempting output
      }
    }
  }

  const accepted = await dispatchCommand({
    type: action,
    revision: isEditing.value ? annotationDoc.value.revision : undefined
  })
  if (action === 'save') suppressEscapeUntil = performance.now() + 300
  if (action !== 'confirm' || !accepted) busy.value = false
}

async function confirm(): Promise<void> {
  await runOutput('confirm')
}

async function cancel(): Promise<void> {
  if (busy.value) return
  if (isEditing.value) {
    await endEdit()
    return
  }
  if (gridNavActive.value) {
    gridNavActive.value = false
    gridStack.value = []
    return
  }
  busy.value = true
  const accepted = await dispatchCommand({ type: 'cancel' })
  if (!accepted) busy.value = false
}

function handleKeydown(event: KeyboardEvent): void {
  // Chinese IME composition protection
  if (event.isComposing || event.keyCode === 229) return

  if (event.key === 'Escape') {
    event.preventDefault()
    if (busy.value || performance.now() < suppressEscapeUntil) return
    void cancel()
    return
  }

  // 9-grid navigation key interception
  if (gridNavActive.value) {
    if (event.key === 'Backspace') {
      event.preventDefault()
      retreatGridNav()
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const reg = currentGridRegion.value
      if (reg) {
        selection.value = reg
        updateInputs(reg)
        gridNavActive.value = false
        gridStack.value = []
        void dispatchCommand({
          type: 'set-selection',
          selection: snapshotScreenshotSelection(reg),
          source: 'grid'
        })
      }
      return
    }
    const lowerKey = event.key.toLowerCase()
    const cellIdx = GRID_CELL_KEYS.indexOf(lowerKey)
    if (cellIdx !== -1) {
      event.preventDefault()
      void selectGridCell(cellIdx)
      return
    }
    const num = Number(event.key)
    if (num >= 1 && num <= 9) {
      event.preventDefault()
      void selectGridCell(num - 1)
      return
    }
    return
  }

  // In edit mode keys
  if (isEditing.value) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      if (event.shiftKey) redoAnnotation()
      else undoAnnotation()
      return
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') {
      event.preventDefault()
      redoAnnotation()
      return
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      deleteSelectedAnnotation()
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      void confirm()
      return
    }
    return
  }

  // In selection/candidate mode keys
  if (event.key === 'Enter') {
    event.preventDefault()
    void confirm()
    return
  }

  // 'G' toggles 9-grid navigation
  if ((event.key === 'g' || event.key === 'G') && !selection.value) {
    event.preventDefault()
    toggleGridNav()
    return
  }

  // 'E' starts annotation edit when selection exists
  if ((event.key === 'e' || event.key === 'E') && selection.value) {
    event.preventDefault()
    void startEdit()
    return
  }

  // Tab cycles candidate hierarchy level
  if (event.key === 'Tab' && state.value?.candidate) {
    event.preventDefault()
    void cycleCandidateLevel()
    return
  }

  // Backspace clears selection
  if ((event.key === 'Backspace' || event.key === 'Delete') && selection.value) {
    event.preventDefault()
    void clearSelection()
    return
  }

  const directions = {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowUp: 'up',
    ArrowDown: 'down'
  } as const
  const direction = directions[event.key as keyof typeof directions]
  if (!direction || !selection.value || !selectionBounds.value) return
  event.preventDefault()
  const next = nudgeScreenshotSelection(
    selection.value,
    direction,
    event.shiftKey,
    selectionBounds.value,
    event.altKey ? 10 : 1,
    {
      aspectRatio: optionState.value?.aspectRatio,
      anchor: selectedAnchor.value
    }
  )
  selection.value = next
  updateInputs(next)
  void dispatchCommand({ type: 'set-selection', selection: snapshotScreenshotSelection(next) })
}

// Watch edit state to load base image
watch(
  () => state.value?.edit,
  (edit) => {
    if (edit && edit.sourceUrl) {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        baseImage.value = img
        redrawCanvas()
      }
      img.src = edit.sourceUrl
    } else {
      baseImage.value = null
    }
  },
  { immediate: true }
)

onMounted(async () => {
  window.addEventListener('keydown', handleKeydown)
  disposeStateListener = transport.on(ScreenshotSessionEvents.overlay.state, (nextState) => {
    if (state.value && nextState.sessionId !== state.value.sessionId) return
    state.value = nextState
    if (!interaction.value) {
      selection.value = nextState.selection ?? null
      updateInputs(selection.value)
    }
  })
  try {
    const initial = await transport.send(ScreenshotSessionEvents.overlay.ready, undefined)
    state.value = initial
    selection.value = initial.selection ?? null
    updateInputs(selection.value)
  } catch {
    errorCode.value = 'overlay-unavailable'
  }
})

onBeforeUnmount(() => {
  if (commitDebounceTimer) clearTimeout(commitDebounceTimer)
  disposeStateListener?.()
  disposeStateListener = null
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <main
    class="screenshot-overlay"
    :class="{ 'is-live': !isFrozen, 'is-busy': busy, 'is-editing': isEditing }"
    :style="overlayStyle"
    @pointerdown="startCreate"
    @pointermove="updatePointer"
    @pointerup="finishPointer"
    @contextmenu.prevent="cancel"
  >
    <img
      v-if="state?.display.frozenTfileUrl && isFrozen && !isEditing"
      class="frozen-frame"
      :src="state.display.frozenTfileUrl"
      alt=""
      draggable="false"
    />
    <div v-if="!isEditing" class="desktop-mask" />

    <!-- 9-Grid Keyboard Navigation Overlay -->
    <div v-if="gridNavActive && currentGridRegion" class="grid-nav-overlay">
      <div
        v-for="cell in gridCells"
        :key="cell.index"
        class="grid-nav-cell"
        :style="{
          left: `${cell.rect.x - (displayBounds?.x ?? 0)}px`,
          top: `${cell.rect.y - (displayBounds?.y ?? 0)}px`,
          width: `${cell.rect.width}px`,
          height: `${cell.rect.height}px`
        }"
        @click.stop="selectGridCell(cell.index)"
      >
        <span class="grid-cell-label">{{ cell.key }}</span>
      </div>
      <div class="grid-nav-hint">
        {{
          t('screenshot.overlay.gridNavHint') ||
          '按 1-9 / Q-C 细分区域，Backspace 返回，Enter 确认，Esc 退出'
        }}
      </div>
    </div>

    <!-- Candidate hover highlight -->
    <section
      v-if="localCandidate && !selection && !gridNavActive && !isEditing"
      class="object-candidate"
      :style="candidateStyle"
      aria-hidden="true"
    >
      <span
        v-for="point in TARGET_GRID_POINTS"
        :key="point"
        class="target-grid-point"
        :class="`is-${point}`"
      />
      <div v-if="state?.candidate" class="candidate-tag">
        <span class="candidate-kind">{{
          state.candidate.kind === 'ui-element' ? 'UI' : 'Window'
        }}</span>
        <span v-if="state.candidate.role" class="candidate-role">{{ state.candidate.role }}</span>
        <span v-if="state.candidate.levels > 1" class="candidate-level">
          {{ state.candidate.level + 1 }}/{{ state.candidate.levels }}
        </span>
      </div>
    </section>

    <!-- Normal Selection box -->
    <section
      v-if="localSelection && !isEditing"
      class="selection"
      :style="selectionStyle"
      aria-label="Screenshot selection"
      @pointerdown.stop="startMove"
    >
      <span
        v-for="point in TARGET_GRID_POINTS"
        :key="point"
        class="target-grid-point"
        :class="`is-${point}`"
      />
      <span class="selection-size">
        {{ Math.round(selection?.width ?? 0) }} × {{ Math.round(selection?.height ?? 0) }}
      </span>
      <button
        v-for="handle in HANDLE_NAMES"
        :key="handle"
        type="button"
        class="resize-handle"
        :class="`is-${handle}`"
        :aria-label="t('screenshot.overlay.resizeHandle', { handle })"
        @pointerdown.stop="startResize(handle, $event)"
      />
    </section>

    <!-- Inline Annotation Canvas -->
    <div
      v-if="isEditing && editState"
      class="annotation-canvas-container"
      :style="{
        left: `${editState.bounds.x - (displayBounds?.x ?? 0)}px`,
        top: `${editState.bounds.y - (displayBounds?.y ?? 0)}px`,
        width: `${editState.bounds.width}px`,
        height: `${editState.bounds.height}px`
      }"
      @pointerdown.stop="handleCanvasPointerDown"
      @pointermove.stop="handleCanvasPointerMove"
      @pointerup.stop="handleCanvasPointerUp"
    >
      <canvas
        ref="canvasRef"
        class="annotation-canvas"
        :width="editState.width"
        :height="editState.height"
      />
    </div>

    <!-- Magnifier loupe -->
    <aside v-if="magnifierStyle" class="magnifier" :style="magnifierStyle" aria-hidden="true">
      <span class="magnifier-cross" />
      <span class="magnifier-coordinate">
        {{ Math.round(pointerLocal?.x ?? 0) }}, {{ Math.round(pointerLocal?.y ?? 0) }}
      </span>
    </aside>

    <!-- Mode switch buttons -->
    <div
      v-if="state && selection && !isEditing"
      class="mode-switch"
      role="group"
      :aria-label="t('screenshot.overlay.mode')"
    >
      <button
        type="button"
        class="icon-button"
        :class="{ active: !isObjectMode }"
        :aria-pressed="!isObjectMode"
        :title="t('screenshot.overlay.freeRegion')"
        @pointerdown.stop
        @click.stop="setTargetMode('free-region')"
      >
        <i class="i-ri-crop-line" />
      </button>
      <button
        type="button"
        class="icon-button"
        :class="{ active: isObjectMode }"
        :aria-pressed="isObjectMode"
        :title="t('screenshot.overlay.objectSelection')"
        @pointerdown.stop
        @click.stop="setTargetMode('object')"
      >
        <i class="i-ri-layout-line" />
      </button>
      <span class="separator" />
      <button
        type="button"
        class="icon-button"
        :class="{ active: isFrozen }"
        :aria-pressed="isFrozen"
        :title="t('screenshot.overlay.frozen')"
        @pointerdown.stop
        @click.stop="setMode('frozen')"
      >
        <i class="i-ri-image-line" />
      </button>
      <button
        type="button"
        class="icon-button"
        :class="{ active: !isFrozen }"
        :aria-pressed="!isFrozen"
        :title="t('screenshot.overlay.live')"
        @pointerdown.stop
        @click.stop="setMode('live')"
      >
        <i class="i-ri-live-line" />
      </button>
    </div>

    <!-- Main Toolbar -->
    <footer v-if="state && (selection || isEditing)" class="toolbar" @pointerdown.stop>
      <!-- Normal selection controls -->
      <template v-if="!isEditing">
        <div v-if="!isObjectMode" class="dimension-inputs">
          <label>
            <span>W</span>
            <input v-model="widthInput" inputmode="numeric" @change="applyManualSize" />
          </label>
          <span>×</span>
          <label>
            <span>H</span>
            <input v-model="heightInput" inputmode="numeric" @change="applyManualSize" />
          </label>
          <!-- Anchor Selector for sizing -->
          <select
            v-model="selectedAnchor"
            class="anchor-select"
            :title="t('screenshot.overlay.anchor') || '缩放固定锚点'"
            @change="applyManualSize"
          >
            <option value="nw">↖</option>
            <option value="n">↑</option>
            <option value="ne">↗</option>
            <option value="w">←</option>
            <option value="center">·</option>
            <option value="e">→</option>
            <option value="sw">↙</option>
            <option value="s">↓</option>
            <option value="se">↘</option>
          </select>
        </div>

        <select
          v-if="!isObjectMode"
          :value="optionState?.aspectRatio ?? ''"
          :aria-label="t('screenshot.overlay.aspectRatio')"
          @change="
            setOption({
              aspectRatio: Number(($event.target as HTMLSelectElement).value) || undefined
            })
          "
        >
          <option value="">{{ t('screenshot.overlay.freeRatio') }}</option>
          <option :value="1">1:1</option>
          <option :value="4 / 3">4:3</option>
          <option :value="16 / 9">16:9</option>
        </select>

        <button
          type="button"
          class="icon-button"
          :class="{ active: optionState?.cursor }"
          :aria-pressed="optionState?.cursor"
          :title="t('screenshot.overlay.cursor')"
          @click="toggleCursor"
        >
          <i class="i-ri-cursor-line" />
        </button>
        <label class="radius-control" :title="t('screenshot.overlay.cornerRadius')">
          <i class="i-ri-rounded-corner" />
          <input
            type="range"
            min="0"
            max="64"
            step="2"
            :value="optionState?.cornerRadius ?? 0"
            :aria-label="t('screenshot.overlay.cornerRadius')"
            @input="setOption({ cornerRadius: Number(($event.target as HTMLInputElement).value) })"
          />
        </label>
        <button
          type="button"
          class="icon-button"
          :class="{ active: optionState?.border }"
          :aria-pressed="optionState?.border"
          :title="t('screenshot.overlay.border')"
          @click="setOption({ border: !optionState?.border })"
        >
          <i class="i-ri-shape-line" />
        </button>
        <button
          type="button"
          class="icon-button"
          :class="{ active: optionState?.shadow }"
          :aria-pressed="optionState?.shadow"
          :title="t('screenshot.overlay.shadow')"
          @click="setOption({ shadow: !optionState?.shadow })"
        >
          <i class="i-ri-contrast-drop-2-line" />
        </button>

        <span class="separator" />

        <!-- Enter Annotation Edit Mode -->
        <button
          type="button"
          class="icon-button highlight"
          :title="t('screenshot.editor.annotation') || '标注编辑 (E)'"
          @click="startEdit"
        >
          <i class="i-ri-mark-pen-line" />
        </button>
      </template>

      <!-- Annotation Editing Toolbar with Rsnap-style stable primary anchor -->
      <template v-else>
        <!-- Annotation tool buttons -->
        <button
          type="button"
          class="icon-button"
          :class="{ active: activeTool === 'select' }"
          title="选择 / 移动 / 调整 (V)"
          @click="activeTool = 'select'"
        >
          <i class="i-ri-cursor-line" />
        </button>
        <button
          type="button"
          class="icon-button"
          :class="{ active: activeTool === 'rectangle' }"
          title="矩形 (R)"
          @click="activeTool = 'rectangle'"
        >
          <i class="i-ri-checkbox-blank-line" />
        </button>
        <button
          type="button"
          class="icon-button"
          :class="{ active: activeTool === 'ellipse' }"
          title="圆形 / 椭圆 (O)"
          @click="activeTool = 'ellipse'"
        >
          <i class="i-ri-checkbox-blank-circle-line" />
        </button>
        <button
          type="button"
          class="icon-button"
          :class="{ active: activeTool === 'arrow' }"
          title="箭头 (A)"
          @click="activeTool = 'arrow'"
        >
          <i class="i-ri-arrow-right-up-line" />
        </button>
        <button
          type="button"
          class="icon-button"
          :class="{ active: activeTool === 'line' }"
          title="直线 (L)"
          @click="activeTool = 'line'"
        >
          <i class="i-ri-subtract-line" />
        </button>
        <button
          type="button"
          class="icon-button"
          :class="{ active: activeTool === 'brush' }"
          title="画笔 (P)"
          @click="activeTool = 'brush'"
        >
          <i class="i-ri-brush-line" />
        </button>
        <button
          type="button"
          class="icon-button"
          :class="{ active: activeTool === 'text' }"
          title="文字 (T)"
          @click="activeTool = 'text'"
        >
          <i class="i-ri-text" />
        </button>
        <button
          type="button"
          class="icon-button"
          :class="{ active: activeTool === 'pixelate' }"
          title="马赛克 / 模糊 (M)"
          @click="activeTool = 'pixelate'"
        >
          <i class="i-ri-blur-off-line" />
        </button>

        <span class="separator" />

        <!-- Style capsule toggle (Rsnap pattern: secondary style controls attach stably) -->
        <button
          type="button"
          class="icon-button"
          :class="{ active: styleCapsuleOpen }"
          title="样式面板"
          @click="styleCapsuleOpen = !styleCapsuleOpen"
        >
          <span class="color-badge" :style="{ backgroundColor: currentStyle.color }" />
        </button>

        <!-- Floating style capsule rendered above the toolbar pill -->
        <div v-if="styleCapsuleOpen" class="style-capsule" @pointerdown.stop>
          <div class="color-presets">
            <button
              v-for="color in PRESET_COLORS"
              :key="color"
              type="button"
              class="color-dot"
              :class="{ selected: currentStyle.color === color }"
              :style="{ backgroundColor: color }"
              @click="currentStyle.color = color"
            />
          </div>
          <div class="stroke-width-presets">
            <button
              v-for="w in PRESET_STROKE_WIDTHS"
              :key="w"
              type="button"
              class="stroke-btn"
              :class="{ selected: currentStyle.strokeWidth === w }"
              @click="currentStyle.strokeWidth = w"
            >
              <span class="stroke-sample" :style="{ height: `${w}px` }" />
            </button>
          </div>
          <button
            type="button"
            class="fill-toggle"
            :class="{ active: currentStyle.filled }"
            @click="currentStyle.filled = !currentStyle.filled"
          >
            {{ currentStyle.filled ? '填充' : '描边' }}
          </button>
        </div>

        <span class="separator" />

        <!-- History: Undo / Redo -->
        <button
          type="button"
          class="icon-button"
          :disabled="!annotationDoc.canUndo"
          title="撤销 (⌘Z)"
          @click="undoAnnotation"
        >
          <i class="i-ri-arrow-go-back-line" />
        </button>
        <button
          type="button"
          class="icon-button"
          :disabled="!annotationDoc.canRedo"
          title="重做 (⌘Y)"
          @click="redoAnnotation"
        >
          <i class="i-ri-arrow-go-forward-line" />
        </button>

        <span class="separator" />

        <!-- Exit Edit Mode -->
        <button type="button" class="icon-button" title="退出编辑模式" @click="endEdit">
          <i class="i-ri-check-double-line" />
        </button>
      </template>

      <span class="separator" />

      <!-- Shared Output Buttons: Copy, Save, Cancel, Confirm -->
      <button
        type="button"
        class="icon-button"
        :disabled="!hasOutputTarget || busy"
        :title="t('screenshot.editor.copy')"
        @click="runOutput('copy')"
      >
        <i class="i-ri-file-copy-line" />
      </button>
      <button
        type="button"
        class="icon-button"
        :disabled="!hasOutputTarget || busy"
        :title="t('screenshot.editor.save')"
        @click="runOutput('save')"
      >
        <i class="i-ri-save-line" />
      </button>
      <span class="separator" />
      <button
        type="button"
        class="icon-button danger"
        :title="t('screenshot.overlay.cancel')"
        @click="cancel"
      >
        <i class="i-ri-close-line" />
      </button>
      <button
        type="button"
        class="icon-button primary"
        :disabled="!hasOutputTarget || busy"
        :title="t('screenshot.editor.done')"
        @click="confirm"
      >
        <i class="i-ri-check-line" />
      </button>
    </footer>

    <!-- Error message output -->
    <output v-if="errorCode" class="error-status" aria-live="polite">
      {{ t(`screenshot.errors.${errorCode}`) || errorCode }}
    </output>
  </main>
</template>

<style scoped>
:global(html),
:global(body),
:global(#app) {
  margin: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: transparent !important;
}

.screenshot-overlay {
  --screenshot-primary: var(--tx-color-primary, #409eff);
  --screenshot-primary-dark: var(--tx-color-primary-dark-2, #337ecc);
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  user-select: none;
  cursor: crosshair;
}

.screenshot-overlay.is-busy {
  cursor: wait;
}

.screenshot-overlay.is-editing {
  cursor: default;
}

.frozen-frame {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
  pointer-events: none;
}

.desktop-mask {
  position: absolute;
  inset: 0;
  background: rgba(8, 10, 12, 0.28);
  pointer-events: none;
}

/* 9-grid keyboard navigation */
.grid-nav-overlay {
  position: absolute;
  inset: 0;
  pointer-events: auto;
  z-index: 8;
}

.grid-nav-cell {
  position: absolute;
  box-sizing: border-box;
  border: 1px dashed rgba(64, 158, 255, 0.6);
  background: rgba(64, 158, 255, 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s ease;
}

.grid-nav-cell:hover {
  background: rgba(64, 158, 255, 0.22);
}

.grid-cell-label {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: rgba(17, 19, 21, 0.85);
  color: #ffffff;
  font:
    700 14px ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
}

.grid-nav-hint {
  position: absolute;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 14px;
  border-radius: 8px;
  background: rgba(17, 19, 21, 0.92);
  color: #e2e8f0;
  font-size: 13px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  pointer-events: none;
}

/* Candidate hover highlight */
.object-candidate {
  position: absolute;
  z-index: 2;
  box-sizing: border-box;
  border: 2px dashed rgba(64, 158, 255, 0.88);
  background: rgba(64, 158, 255, 0.16);
  pointer-events: none;
}

.candidate-tag {
  position: absolute;
  top: -24px;
  left: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(17, 19, 21, 0.9);
  color: #e2e8f0;
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.candidate-kind {
  font-weight: 700;
  color: var(--screenshot-primary);
}

/* Target grid points */
.target-grid-point {
  position: absolute;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4);
  transform: translate(-50%, -50%);
  pointer-events: none;
}

.target-grid-point.is-nw {
  left: 0;
  top: 0;
}
.target-grid-point.is-n {
  left: 50%;
  top: 0;
}
.target-grid-point.is-ne {
  left: 100%;
  top: 0;
}
.target-grid-point.is-w {
  left: 0;
  top: 50%;
}
.target-grid-point.is-center {
  left: 50%;
  top: 50%;
  background: var(--screenshot-primary);
}
.target-grid-point.is-e {
  left: 100%;
  top: 50%;
}
.target-grid-point.is-sw {
  left: 0;
  top: 100%;
}
.target-grid-point.is-s {
  left: 50%;
  top: 100%;
}
.target-grid-point.is-se {
  left: 100%;
  top: 100%;
}

/* Selection Box */
.selection {
  position: absolute;
  z-index: 3;
  box-sizing: border-box;
  border: 2px solid var(--screenshot-primary);
  background: transparent;
  box-shadow: 0 0 0 1px rgba(51, 126, 204, 0.78);
  cursor: move;
}

.selection::before {
  position: absolute;
  inset: 0;
  content: '';
  box-shadow: 0 0 0 9999px rgba(8, 10, 12, 0.5);
  pointer-events: none;
}

.selection-size {
  position: absolute;
  left: 0;
  bottom: -28px;
  min-width: 74px;
  height: 22px;
  padding: 0 7px;
  border: 1px solid rgba(148, 163, 184, 0.32);
  border-radius: 4px;
  background: rgba(17, 19, 21, 0.94);
  color: #e2e8f0;
  font:
    600 11px/20px ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace;
  text-align: center;
  white-space: nowrap;
  pointer-events: none;
}

.resize-handle {
  position: absolute;
  width: 10px;
  height: 10px;
  padding: 0;
  border: 1px solid var(--screenshot-primary-dark);
  border-radius: 2px;
  background: #f8fafc;
  transform: translate(-50%, -50%);
}

.resize-handle.is-nw {
  left: 0;
  top: 0;
  cursor: nwse-resize;
}
.resize-handle.is-n {
  left: 50%;
  top: 0;
  cursor: ns-resize;
}
.resize-handle.is-ne {
  left: 100%;
  top: 0;
  cursor: nesw-resize;
}
.resize-handle.is-w {
  left: 0;
  top: 50%;
  cursor: ew-resize;
}
.resize-handle.is-e {
  left: 100%;
  top: 50%;
  cursor: ew-resize;
}
.resize-handle.is-sw {
  left: 0;
  top: 100%;
  cursor: nesw-resize;
}
.resize-handle.is-s {
  left: 50%;
  top: 100%;
  cursor: ns-resize;
}
.resize-handle.is-se {
  left: 100%;
  top: 100%;
  cursor: nwse-resize;
}

/* Inline Annotation Canvas Container */
.annotation-canvas-container {
  position: absolute;
  z-index: 5;
  box-sizing: border-box;
  box-shadow: 0 0 0 9999px rgba(8, 10, 12, 0.65);
  cursor: crosshair;
}

.annotation-canvas {
  width: 100%;
  height: 100%;
  display: block;
}

/* Magnifier loupe */
.magnifier {
  position: absolute;
  z-index: 7;
  width: 120px;
  height: 90px;
  border: 1px solid rgba(255, 255, 255, 0.8);
  border-radius: 6px;
  background-color: #111315;
  background-repeat: no-repeat;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  pointer-events: none;
}

.magnifier-cross {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 8px;
  height: 8px;
  border: 1px solid #409eff;
  transform: translate(-50%, -50%);
}

.magnifier-coordinate {
  position: absolute;
  right: 4px;
  bottom: 2px;
  color: #e2e8f0;
  font:
    500 10px/14px ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace;
}

/* Controls: Mode Switch & Toolbar */
.mode-switch,
.toolbar {
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 8px;
  background: rgba(17, 19, 21, 0.94);
  color: #e2e8f0;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}

.mode-switch {
  position: absolute;
  top: calc(var(--screenshot-safe-top, 0px) + 18px);
  right: var(--screenshot-safe-right, 0px);
}

.toolbar {
  position: absolute;
  right: var(--screenshot-safe-right, 0px);
  bottom: calc(var(--screenshot-safe-bottom, 0px) + 24px);
}

.dimension-inputs {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
}

.dimension-inputs label {
  display: flex;
  align-items: center;
  gap: 2px;
}

.dimension-inputs input {
  width: 44px;
  height: 22px;
  padding: 0 4px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 4px;
  background: rgba(30, 34, 38, 0.8);
  color: #ffffff;
  font-size: 11px;
  text-align: center;
}

.anchor-select {
  height: 22px;
  padding: 0 2px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 4px;
  background: rgba(30, 34, 38, 0.8);
  color: #409eff;
  font-size: 12px;
}

.toolbar select {
  height: 26px;
  padding: 0 4px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 4px;
  background: rgba(30, 34, 38, 0.8);
  color: #e2e8f0;
  font-size: 11px;
}

.radius-control {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 4px;
}

.radius-control input[type='range'] {
  width: 48px;
}

.separator {
  width: 1px;
  height: 18px;
  background: rgba(148, 163, 184, 0.2);
}

.icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: #cbd5e1;
  font-size: 15px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.icon-button:hover:not(:disabled) {
  background: rgba(148, 163, 184, 0.16);
  color: #ffffff;
}

.icon-button.active {
  background: rgba(64, 158, 255, 0.25);
  border-color: rgba(64, 158, 255, 0.6);
  color: #409eff;
}

.icon-button.highlight {
  color: #38bdf8;
}

.icon-button.primary {
  background: #409eff;
  color: #ffffff;
}

.icon-button.primary:hover:not(:disabled) {
  background: #66b1ff;
}

.icon-button.danger:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.25);
  color: #ef4444;
}

.icon-button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.color-badge {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.6);
}

/* Floating Style Capsule (Rsnap-style stable primary anchor) */
.style-capsule {
  position: absolute;
  bottom: calc(100% + 8px);
  right: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 8px;
  background: rgba(17, 19, 21, 0.96);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
  z-index: 12;
}

.color-presets {
  display: flex;
  align-items: center;
  gap: 4px;
}

.color-dot {
  width: 16px;
  height: 16px;
  padding: 0;
  border: 1px solid rgba(0, 0, 0, 0.4);
  border-radius: 50%;
  cursor: pointer;
  transition: transform 0.15s ease;
}

.color-dot:hover {
  transform: scale(1.15);
}

.color-dot.selected {
  outline: 2px solid #ffffff;
  outline-offset: 1px;
}

.stroke-width-presets {
  display: flex;
  align-items: center;
  gap: 3px;
}

.stroke-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 4px;
  background: rgba(30, 34, 38, 0.6);
  cursor: pointer;
}

.stroke-btn.selected {
  border-color: #409eff;
  background: rgba(64, 158, 255, 0.2);
}

.stroke-sample {
  display: block;
  width: 14px;
  border-radius: 1px;
  background: #ffffff;
}

.fill-toggle {
  padding: 2px 6px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 4px;
  background: rgba(30, 34, 38, 0.6);
  color: #cbd5e1;
  font-size: 11px;
  cursor: pointer;
}

.fill-toggle.active {
  background: rgba(64, 158, 255, 0.25);
  border-color: #409eff;
  color: #409eff;
}

.error-status {
  position: absolute;
  bottom: calc(var(--screenshot-safe-bottom, 0px) + 68px);
  right: var(--screenshot-safe-right, 0px);
  padding: 4px 8px;
  border-radius: 4px;
  background: rgba(239, 68, 68, 0.9);
  color: #ffffff;
  font-size: 12px;
}
</style>
