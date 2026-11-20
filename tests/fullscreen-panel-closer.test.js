const { describe, it } = require('node:test')
const assert = require('node:assert')
const { createFullscreenPanelCloser, CLOSE_DELAYS_MS } = require('../src/controllers/fullscreen-panel-closer.js')

const WINDOW_ID = 7

function setup() {
  const listeners = new Set()
  const pending = new Map()
  let nextTimer = 1
  const calls = []

  // vivaldi.windowPrivate.onStateChanged passes (windowId, state).
  const windowPrivate = {
    onStateChanged: {
      addListener: fn => listeners.add(fn),
      removeListener: fn => listeners.delete(fn),
    },
  }
  const panelActions = {
    setContentVisible: (winId, visible) => calls.push([winId, visible]),
  }
  const closer = createFullscreenPanelCloser({
    windowId: WINDOW_ID,
    windowPrivate,
    panelActions,
    setTimer: (fn, delay) => {
      const id = nextTimer++
      pending.set(id, { fn, delay })
      return id
    },
    clearTimer: id => pending.delete(id),
  })

  return {
    closer,
    calls,
    listeners,
    pending,
    setState: (state, id = WINDOW_ID) => [...listeners].forEach(fn => fn(id, state)),
    runTimers: () => {
      for (const [id, { fn }] of [...pending]) {
        pending.delete(id)
        fn()
      }
    },
  }
}

describe('fullscreen panel closer', () => {
  it('closes panel content after the window leaves fullscreen', () => {
    const t = setup()
    t.setState('fullscreen')
    t.setState('maximized')

    assert.deepStrictEqual([...t.pending.values()].map(timer => timer.delay), CLOSE_DELAYS_MS)
    t.runTimers()
    assert.deepStrictEqual(t.calls, CLOSE_DELAYS_MS.map(() => [WINDOW_ID, false]))
  })

  it('does nothing while the window is fullscreen', () => {
    const t = setup()
    t.setState('fullscreen')
    t.setState('fullscreen')

    assert.strictEqual(t.pending.size, 0)
    assert.deepStrictEqual(t.calls, [])
  })

  it('does nothing for state changes outside fullscreen', () => {
    const t = setup()
    t.setState('normal')
    t.setState('maximized')
    t.setState('minimized')

    assert.strictEqual(t.pending.size, 0)
  })

  it('ignores other windows', () => {
    const t = setup()
    t.setState('fullscreen', 99)
    t.setState('maximized', 99)

    assert.strictEqual(t.pending.size, 0)
  })

  it('stops listening and cancels pending closes on dispose', () => {
    const t = setup()
    t.setState('fullscreen')
    t.setState('maximized')
    t.closer.dispose()

    assert.strictEqual(t.listeners.size, 0)
    assert.strictEqual(t.pending.size, 0)
    assert.deepStrictEqual(t.calls, [])
  })
})
