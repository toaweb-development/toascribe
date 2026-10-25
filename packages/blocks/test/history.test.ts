import { describe, expect, it } from 'vitest'

import { createHistory } from '../src/index.ts'

function clocked() {
  let time = 0
  return { now: () => time, advance: (ms: number) => (time += ms) }
}

const at = (n: number) => ({ selectionBefore: n - 1, selectionAfter: n })

describe('createHistory', () => {
  it('undoes and redoes each step and hands back the selection', () => {
    const history = createHistory<string, number>('a')
    history.record('ab', at(1))
    history.record('abc', at(2))
    expect(history.undo()).toEqual({ state: 'ab', selection: 1 })
    expect(history.undo()).toEqual({ state: 'a', selection: 0 })
    expect(history.undo()).toBeUndefined()
    expect(history.redo()).toEqual({ state: 'ab', selection: 1 })
    expect(history.redo()).toEqual({ state: 'abc', selection: 2 })
    expect(history.redo()).toBeUndefined()
  })

  it('groups typing in one block while it follows quickly, and splits on a pause, another block or a cap', () => {
    const clock = clocked()
    const history = createHistory<string, number>('', { now: clock.now, idleMs: 1000, maxGroupMs: 5000 })
    for (const [index, state] of ['H', 'He', 'Hei'].entries()) {
      clock.advance(200)
      history.record(state, { group: 'text:a', ...at(index + 1) })
    }
    expect(history.undoDepth).toBe(1)
    clock.advance(1500) // a pause
    history.record('Hei d', { group: 'text:a', ...at(5) })
    clock.advance(100)
    history.record('Hei du', { group: 'text:a', ...at(6) })
    expect(history.undoDepth).toBe(2)
    clock.advance(100)
    history.record('Hei du!', { group: 'text:b', ...at(7) }) // another block
    expect(history.undoDepth).toBe(3)
    // A step that keeps going without a pause is cut after maxGroupMs.
    for (let index = 0; index < 30; index += 1) {
      clock.advance(300)
      history.record(`x${String(index)}`, { group: 'text:b', ...at(8 + index) })
    }
    // 'Hei du!' and the first 16 join one step (5 s); the 17th starts the next one, which the last 14 join.
    expect(history.undoDepth).toBe(4)
    expect(history.undo()?.selection).toBe(23)
  })

  it('never groups a change without a key, and starts a new group after an undo or a seal', () => {
    const history = createHistory<string, number>('')
    history.record('a', { group: 'text:a', ...at(1) })
    history.record('a*', at(2)) // formatting
    history.record('a*b', { group: 'text:a', ...at(3) })
    expect(history.undoDepth).toBe(3)
    history.seal()
    history.record('a*bc', { group: 'text:a', ...at(4) })
    expect(history.undoDepth).toBe(4)
    history.undo()
    history.record('a*bd', { group: 'text:a', ...at(4) })
    expect(history.undoDepth).toBe(4)
    expect(history.canRedo).toBe(false)
  })

  it('drops the redo steps on a new change, ignores a change to the same state, and keeps at most `limit` steps', () => {
    const history = createHistory<number, number>(0, { limit: 3 })
    for (let n = 1; n <= 5; n += 1) history.record(n, at(n))
    history.record(5, at(6))
    expect(history.undoDepth).toBe(3)
    history.undo()
    history.record(9, at(9))
    expect(history.canRedo).toBe(false)
    history.reset(0)
    expect(history.canUndo).toBe(false)
  })
})
