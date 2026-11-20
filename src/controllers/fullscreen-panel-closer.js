// Vivaldi can open a panel by itself around fullscreen: entering fullscreen
// fills an empty selectedPanel with the first panel, which then opens. Panels
// never need to open by themselves, so close panel content after this window
// leaves fullscreen. Nothing happens while the window is fullscreen.
//
// The exit is detected from vivaldi.windowPrivate.onStateChanged, the event
// Vivaldi's own window-state handling uses (chrome.windows.onBoundsChanged and
// fullscreenchange don't fire in the UI page for video fullscreen). Vivaldi may
// open the panel before or shortly after the exit, so the close is repeated a
// few times; closing an already closed panel is a no-op.

const CLOSE_DELAYS_MS = [0, 250, 750, 1500]

function createFullscreenPanelCloser({ windowId, windowPrivate, panelActions, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let fullscreen = false
  let disposed = false
  const timers = new Set()

  function closePanel() {
    try {
      panelActions.setContentVisible(windowId, false)
    } catch (error) {
      console.warn('[svb] failed to close panel after fullscreen', error)
    }
  }

  function onStateChanged(changedWindowId, state) {
    if (disposed || changedWindowId !== windowId) return
    const nextFullscreen = state === 'fullscreen'
    if (fullscreen && !nextFullscreen) {
      for (const delay of CLOSE_DELAYS_MS) {
        const timer = setTimer(() => {
          timers.delete(timer)
          if (!disposed) closePanel()
        }, delay)
        timers.add(timer)
      }
    }
    fullscreen = nextFullscreen
  }

  windowPrivate.onStateChanged.addListener(onStateChanged)

  return {
    dispose() {
      disposed = true
      windowPrivate.onStateChanged.removeListener(onStateChanged)
      for (const timer of timers) clearTimer(timer)
      timers.clear()
    },
  }
}

module.exports = { createFullscreenPanelCloser, CLOSE_DELAYS_MS }
