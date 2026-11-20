const { describe, it } = require('node:test')
const assert = require('node:assert')
const { createFullscreenPanelGuard } = require('../src/controllers/fullscreen-panel-guard.js')

const WINDOW_ID = 7
const FIRST_PANEL = 'WEBPANEL_first'
const OTHER_PANEL = 'WEBPANEL_other'

// Mirrors Vivaldi 8.3's panel store reducer for WINDOW_STATE_CHANGED: D()
// toggles the bar with Z() on entering/leaving fullscreen, and with auto-hide
// in fullscreen an empty selectedPanel is filled with the first panel.
// `order` is the order in which the two stores notify their listeners.
function createFakeVivaldi({ order, barVisible = true, contentVisible = false, selectedPanel = OTHER_PANEL }) {
  const win = { fullscreen: false }
  const panel = { barVisible, contentVisible, selectedPanel, visibilityBeforeMinimalUI: undefined }
  const listeners = { window: new Set(), panel: new Set() }
  const calls = []

  const withListeners = (name, methods) => ({
    ...methods,
    addListener: fn => listeners[name].add(fn),
    removeListener: fn => listeners[name].delete(fn),
  })
  const emit = () => order.forEach(name => [...listeners[name]].forEach(fn => fn()))

  function togglePanelBar() {
    if (panel.contentVisible) {
      panel.barVisible = false
      panel.contentVisible = false
    } else if (panel.barVisible) {
      panel.barVisible = false
      panel.selectedPanel = undefined
    } else {
      panel.barVisible = true
      if (panel.selectedPanel) panel.contentVisible = true
    }
  }

  return {
    panel,
    calls,
    listeners,
    windowStore: withListeners('window', {
      isFullscreen: () => win.fullscreen,
      isHTML5Fullscreen: () => win.fullscreen,
    }),
    panelStore: withListeners('panel', {
      getIsContentVisible: () => panel.contentVisible,
      getFirstAvailablePanel: () => FIRST_PANEL,
    }),
    panelActions: {
      setContentVisible(winId, visible) {
        calls.push(['setContentVisible', winId, visible])
        panel.contentVisible = visible
        if (visible) panel.barVisible = true
        emit()
      },
      togglePanel() {},
      showNextPanel() {},
    },
    setFullscreen(fullscreen) {
      win.fullscreen = fullscreen
      const visible = panel.barVisible
      if (fullscreen ? visible : visible !== panel.visibilityBeforeMinimalUI) togglePanelBar()
      if (fullscreen) panel.visibilityBeforeMinimalUI = visible
      if (fullscreen && !panel.selectedPanel) panel.selectedPanel = FIRST_PANEL
      emit()
    },
    openPanel(id) {
      panel.barVisible = true
      panel.contentVisible = true
      panel.selectedPanel = id
      emit()
    },
  }
}

const flush = () => new Promise(resolve => setImmediate(resolve))

async function enterAndExitFullscreen(vivaldi, duringFullscreen) {
  vivaldi.setFullscreen(true)
  await flush()
  if (duringFullscreen) {
    duringFullscreen()
    await flush()
  }
  vivaldi.setFullscreen(false)
  await flush()
}

function startGuard(vivaldi) {
  return createFullscreenPanelGuard({
    windowId: WINDOW_ID,
    windowStore: vivaldi.windowStore,
    panelStore: vivaldi.panelStore,
    panelActions: vivaldi.panelActions,
  })
}

const ORDERS = [['window', 'panel'], ['panel', 'window']]

describe('fullscreen panel guard', () => {
  it('reproduces the Vivaldi bug without the guard', async () => {
    const vivaldi = createFakeVivaldi({ order: ORDERS[0] })

    await enterAndExitFullscreen(vivaldi)

    assert.strictEqual(vivaldi.panel.contentVisible, true)
    assert.strictEqual(vivaldi.panel.selectedPanel, FIRST_PANEL)
  })

  for (const order of ORDERS) {
    describe(`stores notify ${order.join(' then ')}`, () => {
      it('closes the first panel Vivaldi opens on exit, keeping the bar visible', async () => {
        const vivaldi = createFakeVivaldi({ order })
        startGuard(vivaldi)

        await enterAndExitFullscreen(vivaldi)

        assert.strictEqual(vivaldi.panel.contentVisible, false)
        assert.strictEqual(vivaldi.panel.barVisible, true)
        assert.deepStrictEqual(vivaldi.calls, [['setContentVisible', WINDOW_ID, false]])
      })

      it('keeps a panel open that was open before fullscreen', async () => {
        const vivaldi = createFakeVivaldi({ order, contentVisible: true })
        startGuard(vivaldi)

        await enterAndExitFullscreen(vivaldi)

        assert.strictEqual(vivaldi.panel.contentVisible, true)
        assert.strictEqual(vivaldi.panel.selectedPanel, OTHER_PANEL)
        assert.deepStrictEqual(vivaldi.calls, [])
      })

      it('keeps a panel open that was opened during fullscreen', async () => {
        const vivaldi = createFakeVivaldi({ order })
        startGuard(vivaldi)

        await enterAndExitFullscreen(vivaldi, () => vivaldi.openPanel(OTHER_PANEL))

        assert.strictEqual(vivaldi.panel.contentVisible, true)
        assert.deepStrictEqual(vivaldi.calls, [])
      })

      it('does nothing when the panel bar was hidden', async () => {
        const vivaldi = createFakeVivaldi({ order, barVisible: false })
        startGuard(vivaldi)

        await enterAndExitFullscreen(vivaldi)

        assert.strictEqual(vivaldi.panel.contentVisible, false)
        assert.strictEqual(vivaldi.panel.barVisible, false)
        assert.deepStrictEqual(vivaldi.calls, [])
      })
    })
  }

  it('stops listening after dispose', async () => {
    const vivaldi = createFakeVivaldi({ order: ORDERS[0] })
    startGuard(vivaldi).dispose()

    await enterAndExitFullscreen(vivaldi)

    assert.strictEqual(vivaldi.listeners.window.size, 0)
    assert.strictEqual(vivaldi.listeners.panel.size, 0)
    assert.deepStrictEqual(vivaldi.calls, [])
  })
})
