// One undo history for a whole document (M0.6): every change, whether typing in one paragraph's TipTap, a mark, an insert, a move
// or a delete, is a step here. The TipTap instances keep no history of their own.
//
// A step stores the whole document as it was before. Documents share every unchanged block (tree.ts), so a step costs the path
// that changed, not a copy. Typing is grouped: changes with the same `group` key (the editor uses `text:<block id>`) that follow
// each other within `idleMs` join the step before, until the step is `maxGroupMs` old. Anything else (another key, no key, an
// undo, `seal()`) starts a new step.

export interface HistoryOptions {
  /** A pause longer than this ends a group of typing. */
  readonly idleMs?: number
  /** A group of typing never spans more than this, even without a pause. */
  readonly maxGroupMs?: number
  /** The most steps kept; the oldest go first. */
  readonly limit?: number
  /** The clock (tests set it). */
  readonly now?: () => number
}

export interface HistoryChange<S> {
  /** Changes with the same key may join one step (typing in one block). Undefined: always a step of its own. */
  readonly group?: string
  /** Where the cursor was before the change: undo puts it back there. */
  readonly selectionBefore: S
  /** Where the cursor is after the change: redo puts it there. */
  readonly selectionAfter: S
}

interface Step<T, S> {
  /** The state on the other side of this step (before it, on the undo stack; after it, on the redo stack). */
  readonly state: T
  readonly selectionBefore: S
  selectionAfter: S
  readonly group: string | undefined
  readonly startedAt: number
  lastAt: number
}

export interface HistoryRestore<T, S> {
  readonly state: T
  /** Where to put the cursor. */
  readonly selection: S
}

export const DEFAULT_HISTORY = { idleMs: 1000, maxGroupMs: 5000, limit: 500 } as const

export interface History<T, S> {
  readonly present: T
  readonly canUndo: boolean
  readonly canRedo: boolean
  /** How many steps can be undone (for tests and the toolbar). */
  readonly undoDepth: number
  /** Records a change to `state`. A change to the same state is ignored. */
  record(state: T, change: HistoryChange<S>): void
  /** Replaces the present without a step (a new document is loaded): clears both stacks. */
  reset(state: T): void
  /** Ends the current group, so the next change starts a new step (a click elsewhere, a save). */
  seal(): void
  undo(): HistoryRestore<T, S> | undefined
  redo(): HistoryRestore<T, S> | undefined
}

export function createHistory<T, S>(initial: T, options: HistoryOptions = {}): History<T, S> {
  const idleMs = options.idleMs ?? DEFAULT_HISTORY.idleMs
  const maxGroupMs = options.maxGroupMs ?? DEFAULT_HISTORY.maxGroupMs
  const limit = options.limit ?? DEFAULT_HISTORY.limit
  const now = options.now ?? (() => Date.now())

  let present = initial
  let past: Step<T, S>[] = []
  let future: Step<T, S>[] = []
  let sealed = false

  return {
    get present() {
      return present
    },
    get canUndo() {
      return past.length > 0
    },
    get canRedo() {
      return future.length > 0
    },
    get undoDepth() {
      return past.length
    },
    record(state, change) {
      if (state === present) {
        return
      }
      const at = now()
      const last = past.at(-1)
      const joins =
        !sealed &&
        change.group !== undefined &&
        last !== undefined &&
        future.length === 0 &&
        last.group === change.group &&
        at - last.lastAt <= idleMs &&
        at - last.startedAt <= maxGroupMs
      if (joins) {
        last.selectionAfter = change.selectionAfter
        last.lastAt = at
      } else {
        past.push({
          state: present,
          selectionBefore: change.selectionBefore,
          selectionAfter: change.selectionAfter,
          group: change.group,
          startedAt: at,
          lastAt: at,
        })
        if (past.length > limit) {
          past = past.slice(past.length - limit)
        }
      }
      present = state
      future = []
      sealed = false
    },
    reset(state) {
      present = state
      past = []
      future = []
      sealed = false
    },
    seal() {
      sealed = true
    },
    undo() {
      const step = past.pop()
      if (step === undefined) {
        return undefined
      }
      future.push({ ...step, state: present })
      present = step.state
      sealed = true
      return { state: present, selection: step.selectionBefore }
    },
    redo() {
      const step = future.pop()
      if (step === undefined) {
        return undefined
      }
      past.push({ ...step, state: present })
      present = step.state
      sealed = true
      return { state: present, selection: step.selectionAfter }
    },
  }
}
