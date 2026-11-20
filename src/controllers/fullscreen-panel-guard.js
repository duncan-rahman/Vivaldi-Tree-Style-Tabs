// Works around a Vivaldi bug: with the panel bar visible and no panel open,
// leaving fullscreen (F11 or a fullscreen video) opens the first panel.
//
// In Vivaldi's panel store, entering fullscreen hides the bar and clears
// selectedPanel; with "auto-hide UI in fullscreen" the same update then sets
// selectedPanel to the first available panel. Leaving fullscreen shows the bar
// again and opens selectedPanel, i.e. the first panel.
//
// The guard remembers whether a panel was open when fullscreen started and,
// if none was (and none was opened during fullscreen), closes the panel that
// Vivaldi opens on exit. The bar stays visible.
//
// Vivaldi's window and panel stores both react to the same fullscreen action,
// in an order we can't rely on, so state is evaluated once per update, after
// both have changed (a microtask after the store listeners run).

function createFullscreenPanelGuard({ windowId, windowStore, panelStore, panelActions, defer = queueMicrotask }) {
  let lastFullscreen = windowStore.isFullscreen(windowId)
  let lastContentVisible = panelStore.getIsContentVisible(windowId)
  let openBeforeFullscreen = lastContentVisible
  let openedDuringFullscreen = false
  let settleScheduled = false
  let disposed = false

  function settle() {
    settleScheduled = false
    if (disposed) return

    const fullscreen = windowStore.isFullscreen(windowId)
    const contentVisible = panelStore.getIsContentVisible(windowId)

    if (fullscreen && !lastFullscreen) {
      openBeforeFullscreen = lastContentVisible
      openedDuringFullscreen = false
    } else if (fullscreen && contentVisible) {
      openedDuringFullscreen = true
    } else if (!fullscreen && lastFullscreen) {
      if (contentVisible && !openBeforeFullscreen && !openedDuringFullscreen) {
        panelActions.setContentVisible(windowId, false)
      }
    }

    lastFullscreen = fullscreen
    lastContentVisible = contentVisible
  }

  function scheduleSettle() {
    if (settleScheduled || disposed) return
    settleScheduled = true
    defer(settle)
  }

  windowStore.addListener(scheduleSettle)
  panelStore.addListener(scheduleSettle)

  return {
    dispose() {
      disposed = true
      windowStore.removeListener(scheduleSettle)
      panelStore.removeListener(scheduleSettle)
    },
  }
}

module.exports = { createFullscreenPanelGuard }
