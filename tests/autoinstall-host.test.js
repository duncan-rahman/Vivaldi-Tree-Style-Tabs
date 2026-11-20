const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const BAT = path.join(__dirname, '..', 'autoinstall', 'host', 'svb-installer.bat')
const ORIGIN = 'chrome-extension://iidhijjmejhlnnjimbkdfaflkgebcllm/'
const SCRIPT_TAG = '<script src="custom.js"></script>'
const WINDOW_HTML = '<!DOCTYPE html><html><head></head><body><div id="app"></div></body></html>'

// Runs the host the way Vivaldi does: cmd.exe launches the .bat with the
// caller origin, and the request/response are length-prefixed JSON.
function runHost(env, { bat = BAT, request = { action: 'install', reason: 'test' } } = {}) {
  const body = Buffer.from(JSON.stringify(request), 'utf8')
  const header = Buffer.alloc(4)
  header.writeUInt32LE(body.length)
  const proc = spawnSync('cmd.exe', ['/d', '/c', bat, ORIGIN, '--parent-window=0'], {
    input: Buffer.concat([header, body]),
    env: { ...process.env, ...env },
  })
  const out = proc.stdout
  assert.ok(out.length >= 4, `no response; stderr: ${proc.stderr}`)
  const length = out.readUInt32LE(0)
  assert.strictEqual(out.length, 4 + length, `unexpected extra output: ${out.toString('utf8')}`)
  return JSON.parse(out.subarray(4).toString('utf8'))
}

describe('auto-installer native host', { skip: process.platform !== 'win32' && 'Windows only' }, () => {
  let root, appDir, distDir, env

  function addVersion(version, { patched }) {
    const uiDir = path.join(appDir, version, 'resources', 'vivaldi')
    fs.mkdirSync(uiDir, { recursive: true })
    fs.writeFileSync(path.join(uiDir, 'window.html'),
      patched ? WINDOW_HTML.replace('</body>', `${SCRIPT_TAG}</body>`) : WINDOW_HTML)
    if (patched) {
      fs.copyFileSync(path.join(distDir, 'custom.js'), path.join(uiDir, 'custom.js'))
      fs.copyFileSync(path.join(distDir, 'svb-folder.html'), path.join(uiDir, 'svb-folder.html'))
    }
    return uiDir
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'svb-autoinstall-'))
    appDir = path.join(root, 'Application')
    distDir = path.join(root, 'dist')
    fs.mkdirSync(appDir)
    fs.mkdirSync(distDir)
    fs.writeFileSync(path.join(distDir, 'custom.js'), '// mod v1')
    fs.writeFileSync(path.join(distDir, 'svb-folder.html'), '<html></html>')
    fs.mkdirSync(path.join(appDir, 'Dictionaries'))
    env = {
      SVB_VIVALDI_APP_DIR: appDir,
      SVB_DIST_DIR: distDir,
      SVB_RUNNING_VERSION: '8.3.4191.45',
      LOCALAPPDATA: root,
    }
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('patches a staged update folder without asking for a restart', () => {
    addVersion('8.3.4191.45', { patched: true })
    const stagedUi = addVersion('8.3.4191.47', { patched: false })

    const result = runHost(env)

    assert.strictEqual(result.ok, true)
    assert.deepStrictEqual(result.versions, ['8.3.4191.45', '8.3.4191.47'])
    assert.deepStrictEqual(result.patched, ['8.3.4191.47'])
    assert.strictEqual(result.restartNeeded, false)
    assert.strictEqual(fs.readFileSync(path.join(stagedUi, 'custom.js'), 'utf8'), '// mod v1')
    const html = fs.readFileSync(path.join(stagedUi, 'window.html'), 'utf8')
    assert.strictEqual(html, WINDOW_HTML.replace('</body>', `${SCRIPT_TAG}</body>`))
    assert.strictEqual(fs.readFileSync(path.join(stagedUi, 'window.html.svb-backup'), 'utf8'), WINDOW_HTML)
  })

  it('asks for a restart when the running version was unpatched', () => {
    addVersion('8.3.4191.45', { patched: false })

    const result = runHost(env)

    assert.deepStrictEqual(result.patched, ['8.3.4191.45'])
    assert.strictEqual(result.restartNeeded, true)
  })

  it('does nothing when everything is up to date', () => {
    const uiDir = addVersion('8.3.4191.45', { patched: true })

    const result = runHost(env)

    assert.deepStrictEqual(result.patched, [])
    assert.strictEqual(result.restartNeeded, false)
    const html = fs.readFileSync(path.join(uiDir, 'window.html'), 'utf8')
    assert.strictEqual(html.split(SCRIPT_TAG).length - 1, 1)
  })

  it('updates an outdated custom.js from a new build', () => {
    const uiDir = addVersion('8.3.4191.45', { patched: true })
    fs.writeFileSync(path.join(distDir, 'custom.js'), '// mod v2')

    const result = runHost(env)

    assert.deepStrictEqual(result.patched, ['8.3.4191.45'])
    assert.strictEqual(result.restartNeeded, true)
    assert.strictEqual(fs.readFileSync(path.join(uiDir, 'custom.js'), 'utf8'), '// mod v2')
  })

  it('installs from the dist folder recorded in config.json when copied out of the repo', () => {
    const uiDir = addVersion('8.3.4191.45', { patched: false })
    const hostDir = path.join(root, 'SvbTreeTabs', 'host')
    fs.mkdirSync(hostDir, { recursive: true })
    for (const file of ['svb-installer.bat', 'svb-installer.ps1']) {
      fs.copyFileSync(path.join(path.dirname(BAT), file), path.join(hostDir, file))
    }
    fs.writeFileSync(path.join(hostDir, 'config.json'), JSON.stringify({ distDir }))
    const { SVB_DIST_DIR, ...envWithoutDist } = env
    void SVB_DIST_DIR

    const result = runHost(envWithoutDist, { bat: path.join(hostDir, 'svb-installer.bat') })

    assert.strictEqual(result.ok, true)
    assert.deepStrictEqual(result.patched, ['8.3.4191.45'])
    assert.strictEqual(fs.readFileSync(path.join(uiDir, 'custom.js'), 'utf8'), '// mod v1')
  })

  it('reports an error when the build is missing', () => {
    addVersion('8.3.4191.45', { patched: false })
    fs.rmSync(path.join(distDir, 'custom.js'))

    const result = runHost(env)

    assert.strictEqual(result.ok, false)
    assert.match(result.error, /npm run build/)
  })
})
