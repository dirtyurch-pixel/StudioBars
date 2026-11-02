/* Phone version: a COMPLETE backup moves everything to a brand-new device, exactly, and checks itself. */
const { chromium } = require('playwright')
const { openTool } = require('./tools.cjs')
const fs = require('fs')

const URL_ = process.env.PHONE_LOCAL_URL || 'http://127.0.0.1:4174/StudioBars/'
const KEY = 'sk-ant-backup-test-000000006789'
const results = []
const check = (name, ok, extra = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const line = (p, n) => p.getByLabel(new RegExp(`^Line ${n}( \\(locked\\))?$`))

function wav(seconds, rate = 8000) {
  const n = Math.floor(seconds * rate)
  const b = Buffer.alloc(44 + n * 2)
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12)
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24)
  b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36)
  b.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 4) * 9000), 44 + i * 2)
  return b
}

;(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] })
  const errors = []
  const device = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, acceptDownloads: true, permissions: ['microphone'] })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => errors.push(String(e)))
    return { ctx, page }
  }

  // ------------------------------------------------ phone A: real work
  const A = await device()
  let page = A.page
  await page.goto(URL_)
  await page.getByRole('button', { name: '+ New song' }).first().click()
  await page.getByLabel('Title').fill('Backup Me')
  await page.getByRole('button', { name: 'Create song' }).click()
  await line(page, 1).fill('Keep this bar forever')
  await line(page, 2).fill('Second bar here')
  await page.getByText('Saved', { exact: true }).first().waitFor()
  await line(page, 1).click()
  await page.getByRole('button', { name: 'Lock line', exact: true }).click()
  await page.getByLabel('Line 1 (locked)').waitFor()
  await openTool(page, 'History')
  await page.getByLabel('Save a snapshot of this song now').fill('my-checkpoint')
  await page.getByRole('button', { name: 'Save snapshot' }).click()
  await page.getByText('my-checkpoint').waitFor()
  // a recording
  await openTool(page, 'Craft')
  await page.getByRole('button', { name: 'Record', exact: true }).click()
  await page.getByRole('button', { name: '● Record' }).click()
  await page.getByRole('button', { name: /^■ Stop and save/ }).waitFor()
  await sleep(1500)
  await page.getByRole('button', { name: /^■ Stop and save/ }).click()
  await page.getByLabel('Playback of take 1').waitFor({ timeout: 15000 })
  // an AI key (must NOT travel in a backup)
  await openTool(page, 'AI')
  await page.getByLabel('Your Claude API key').fill(KEY)
  await page.getByRole('button', { name: 'Save key' }).click()
  await page.getByText('Key saved on this device.').waitFor()
  // music with a tempo
  await page.getByLabel('Back to my songs').click()
  await page.getByLabel('Music library and playlists').click()
  await page.getByRole('checkbox').first().check()
  await page.setInputFiles('#music-files', [{ name: 'My Beat.wav', mimeType: 'audio/wav', buffer: wav(4) }])
  await page.getByRole('button', { name: /^Play My Beat$/ }).first().click()
  await page.getByLabel('Close music library').click()
  await page.getByLabel('Pause').click()
  if ((await page.getByLabel('Show waveform and beats').getAttribute('aria-pressed')) !== 'true') await page.getByLabel('Show waveform and beats').click()
  await page.getByLabel('Tempo (BPM)').fill('93')
  await page.getByLabel('Tempo (BPM)').press('Enter')
  await page.getByText(/93 BPM/).first().waitFor()

  // ------------------------------------------------ back up
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Back up everything' }).waitFor()
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Back up everything' }).click()])
  const file = await dl.path()
  const raw = fs.readFileSync(file)
  await page.getByText(/Backup checked ✓/).waitFor()
  const said = await page.getByText(/Backup checked ✓/).innerText()
  check('the backup checks itself and lists what is inside', /1 song .*history snapshot.*1 recording.*1 music track/.test(said), said)
  check('the message says the download STARTED (not that it is safely stored)', /Download started/.test(said) && /somewhere safe/.test(said))
  check('the backup file is one .sbbackup file', /\.sbbackup$/.test(dl.suggestedFilename()) && raw.subarray(0, 8).toString() === 'SBARCH01')
  check('the AI key is not in the backup', !raw.includes(Buffer.from(KEY)))
  await page.getByRole('button', { name: '← My songs' }).click()
  check('the home screen shows the backup was made today', (await page.getByText('Last backup made today').count()) === 1)

  // ------------------------------------------------ phone B: brand new, nothing on it
  const B = await device()
  page = B.page
  await page.goto(URL_)
  await page.getByText('No songs yet').waitFor()
  await page.getByRole('button', { name: 'Manage backups' }).click()
  // a damaged copy is refused before anything changes
  const bad = Buffer.from(raw)
  bad[bad.length - 5] ^= 0xff
  const badPath = file + '-damaged'
  fs.writeFileSync(badPath, bad)
  await page.getByLabel('Backup file').setInputFiles(badPath)
  await page.getByText(/damaged/).waitFor()
  check('a damaged backup is refused with a clear message', true)
  await page.getByLabel('Backup file').setInputFiles(file)
  await page.getByText(/Backup checked ✓ made/).waitFor()
  await page.getByRole('button', { name: 'Add what’s missing' }).click()
  await page.getByText(/Restored and checked ✓/).waitFor({ timeout: 20000 })
  check('restore on a new phone says it was checked', true)
  await page.getByRole('button', { name: '← My songs' }).click()
  await page.getByText('Backup Me').click()
  await page.getByLabel('Line 1 (locked)').waitFor()
  check('the song comes back with its lock', (await page.getByLabel('Line 1 (locked)').inputValue()) === 'Keep this bar forever')
  await openTool(page, 'History')
  const snap = await page.getByText('my-checkpoint').first().waitFor({ timeout: 10000 }).then(() => true, () => false)
  check('history snapshots come back', snap)
  await openTool(page, 'Craft')
  await page.getByRole('button', { name: 'Record', exact: true }).click()
  await page.getByLabel('Playback of take 1').waitFor({ timeout: 10000 })
  const playable = await page.getByLabel('Playback of take 1').evaluate(
    (a) => new Promise((res) => { if (a.readyState >= 1) res(true); a.onloadedmetadata = () => res(true); a.onerror = () => res(false); a.load(); setTimeout(() => res(a.readyState >= 1), 5000) }),
  )
  check('the recording comes back and can be played', playable)
  await openTool(page, 'AI')
  await page.getByText('AI co-writer setup').waitFor()
  check('the AI key did NOT travel to the new phone', (await page.getByText('…6789').count()) === 0 && (await page.getByText(/No key yet/).count()) === 1)
  await page.getByLabel('Back to my songs').click()
  await page.getByLabel('Music library and playlists').click()
  await page.getByRole('button', { name: /^Play My Beat$/ }).first().click()
  await page.getByLabel('Close music library').click()
  if ((await page.getByLabel('Show waveform and beats').getAttribute('aria-pressed')) !== 'true') await page.getByLabel('Show waveform and beats').click()
  await page.waitForFunction(() => /93 BPM/.test(document.querySelector('.pl-beat-text')?.textContent || ''), null, { timeout: 10000 })
  check('the music and its beat markers come back', true)
  await page.waitForFunction(() => document.querySelector('canvas.pl-wave-canvas')?.dataset.ready === 'yes', null, { timeout: 15000 })
  check('the restored music file is real audio (waveform drawn)', true)

  // ------------------------------------------------ phone A again: replace everything
  page = A.page
  await page.getByRole('button', { name: '+ New song' }).first().click()
  await page.getByLabel('Title').fill('Only On This Phone')
  await page.getByRole('button', { name: 'Create song' }).click()
  await line(page, 1).fill('extra')
  await page.getByText('Saved', { exact: true }).first().waitFor()
  await page.getByLabel('Back to my songs').click()
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Restore a backup…' }).waitFor()
  await page.getByLabel('Backup file').setInputFiles(file)
  await page.getByRole('button', { name: 'Replace everything on this device…' }).click()
  await page.getByRole('button', { name: 'Yes, replace everything' }).click()
  await page.getByText(/This device now matches the backup/).waitFor({ timeout: 20000 })
  const keyKept = await page.getByText('…6789').first().waitFor({ timeout: 15000 }).then(() => true, () => false)
  check('the AI key on this phone is kept after replacing', keyKept)
  await page.getByRole('button', { name: '← My songs' }).click()
  await page.getByText('Backup Me').waitFor()
  check('replace makes this phone match the backup exactly', (await page.getByText('Only On This Phone').count()) === 0 && (await page.locator('.song-card').count()) === 1)

  check('no page errors', errors.length === 0, errors.join(' | '))
  await browser.close()
  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failed}/${results.length} backup/restore checks passed`)
  process.exit(failed ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
