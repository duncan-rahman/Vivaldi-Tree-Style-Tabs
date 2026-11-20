// Asks the native installer host to (re)install the Tree Style Tabs mod into
// every Vivaldi version folder. Vivaldi stages updates in a new version folder
// while it runs, so the periodic check patches the update before it is used.

const HOST = 'com.svb.treetabs_installer'
const ALARM = 'svb-install-check'
const CHECK_INTERVAL_MINUTES = 30

async function check(reason) {
  let result
  try {
    result = await chrome.runtime.sendNativeMessage(HOST, { action: 'install', reason })
  } catch (error) {
    console.warn('[svb-installer] native host failed:', error.message)
    notify('install-error', 'Tree Style Tabs installer is not set up',
      'Run autoinstall\\register-windows.ps1 from the Vivaldi-Tree-Style-Tabs folder.')
    return
  }

  if (!result || !result.ok) {
    notify('install-error', 'Tree Style Tabs could not be installed', (result && result.error) || 'Unknown error')
    return
  }

  if (result.restartNeeded) {
    notify('restart-needed', 'Tree Style Tabs installed',
      `Restart Vivaldi to load it (version ${result.runningVersion}).`)
  }
}

function notify(id, title, message) {
  chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: 'icon-128.png',
    title,
    message,
  })
}

async function ensureAlarm() {
  const existing = await chrome.alarms.get(ALARM)
  if (!existing) {
    await chrome.alarms.create(ALARM, { periodInMinutes: CHECK_INTERVAL_MINUTES })
  }
}

chrome.runtime.onStartup.addListener(() => {
  ensureAlarm()
  check('startup')
})

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm()
  check('installed')
})

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM) check('alarm')
})
