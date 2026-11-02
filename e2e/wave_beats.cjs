/* Waveform and beat markers on the music player. Runs against the PC version and the phone version (APP_URL). */
const { chromium, devices } = require('playwright')

const APP = process.env.APP_URL || 'http://localhost:5173'
const results = []
const check = (name, ok, extra = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** WAV with a loud click every half second (120 BPM) over quiet tone, so the waveform has visible shape. */
function wav(seconds, rate = 8000) {
  const n = Math.floor(seconds * rate)
  const b = Buffer.alloc(44 + n * 2)
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12)
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24)
  b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36)
  b.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) {
    const loud = i % (rate / 2) < rate / 40
    b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 330 * i) / rate) * (loud ? 26000 : 1500)), 44 + i * 2)
  }
  return b
}

;(async () => {
  const browser = await chromium.launch()
  // PHONE=1: a phone-sized touch screen (typing in the tempo box must not hide the player)
  const ctx = await browser.newContext(process.env.PHONE ? { ...devices['Pixel 7'] } : { viewport: { width: 1200, height: 900 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  const player = page.getByLabel('Music player')
  // phones have a slim bar; the waveform, loop and speed live in the full player
  const openPlayer = async () => {
    if (process.env.PHONE) await page.getByLabel('Open player').click({ timeout: 15000 })
  }

  await page.goto(APP)
  await page.getByText(/Import your own tracks|No music loaded|Music library/).first().waitFor()
  if (!(await page.getByLabel('Music library', { exact: true }).isVisible().catch(() => false)))
    await page.getByLabel('Music library and playlists').click()
  const consent = page.getByRole('checkbox').first()
  if (!(await consent.isChecked().catch(() => true))) await consent.check()
  const name = `Beat Test ${Date.now()}`
  await page.setInputFiles('#music-files', [{ name: `${name}.wav`, mimeType: 'audio/wav', buffer: wav(8) }])
  const row = page.getByRole('button', { name: new RegExp(`^Play ${name}$`) }).first()
  await row.waitFor({ timeout: 20000 })
  await row.click()
  await page.getByLabel('Close music library').click().catch(() => {})
  await player.getByLabel('Pause').waitFor({ timeout: 10000 })
  await player.getByLabel('Pause').click()
  await openPlayer()

  // waveform
  const wavePressed = await player.getByLabel('Show waveform and beats').getAttribute('aria-pressed')
  if (wavePressed !== 'true') await player.getByLabel('Show waveform and beats').click()
  const canvas = player.locator('canvas.pl-wave-canvas')
  await canvas.waitFor()
  await page.waitForFunction(() => document.querySelector('canvas.pl-wave-canvas')?.dataset.ready === 'yes', null, { timeout: 15000 })
  check('the waveform is drawn from the track', true)
  const painted = await canvas.evaluate((c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    let n = 0
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++
    return n / (d.length / 4)
  })
  check('the waveform has real shape on it', painted > 0.03, String(painted))

  // tap on the waveform to seek
  const box = await canvas.boundingBox()
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2)
  await sleep(300)
  const seekVal = Number(await player.getByLabel('Seek').inputValue())
  check('tapping the waveform jumps to that point', Math.abs(seekVal - 4) < 0.6, String(seekVal))

  // tap tempo
  check('beat buttons wait for a tempo', await player.getByLabel('Set beat 1 here').isDisabled())
  for (let i = 0; i < 5; i++) {
    await player.getByLabel('Tap tempo').click()
    if (i < 4) await sleep(500)
  }
  await page.waitForFunction(() => /BPM/.test(document.querySelector('.pl-beat-text')?.textContent || ''))
  const bpm = Number(await player.getByLabel('Tempo (BPM)').inputValue())
  check('tapping along sets the tempo', bpm > 100 && bpm < 140, String(bpm))

  // typed tempo, beat 1
  await player.getByLabel('Tempo (BPM)').fill('120')
  await player.getByLabel('Tempo (BPM)').press('Enter')
  await sleep(300)
  await player.getByLabel('Set beat 1 here').click()
  await page.waitForFunction(() => /bar 1, beat 1/.test(document.querySelector('.pl-beat-text')?.textContent || ''))
  check('beat 1 can be set where the playhead is, and bar/beat is shown', true)
  await player.getByLabel('Tempo (BPM)').fill('500')
  await player.getByLabel('Tempo (BPM)').press('Enter')
  check('a silly tempo is refused with a clear message', await player.getByText(/Tempo must be 40 to 240 BPM/).isVisible())
  await player.getByLabel('Tempo (BPM)').fill('120')
  await player.getByLabel('Tempo (BPM)').press('Enter')

  // snap the loop
  const audioSeek = async (s) => {
    await player.getByLabel('Seek').evaluate((el, s) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(el, String(s))
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }, s)
    await sleep(200)
  }
  await audioSeek(4.6)
  await player.getByLabel('Set loop start (A) here').click()
  await audioSeek(6.4)
  await player.getByLabel('Set loop end (B) here').click()
  await player.getByLabel('Snap loop to the beat').click()
  await sleep(300)
  const loopTxt = await player.locator('.pl-loop-text').innerText()
  check('the loop snaps to the nearest beats', /Looping 0:04.*0:06/.test(loopTxt), loopTxt)

  // kept after reload
  await page.reload()
  await openPlayer()
  await player.getByLabel('Show waveform and beats').waitFor({ timeout: 15000 })
  await page.waitForFunction(() => /120 BPM/.test(document.querySelector('.pl-beat-text')?.textContent || ''), null, { timeout: 15000 })
  check('the tempo and beat 1 are kept after a reload', true)

  // waveform switch is remembered
  await player.getByLabel('Show waveform and beats').click()
  check('the waveform can be hidden', (await canvas.count()) === 0)
  await page.reload()
  await openPlayer()
  await player.getByLabel('Show waveform and beats').waitFor({ timeout: 15000 })
  check('hiding it is remembered', (await player.getByLabel('Show waveform and beats').getAttribute('aria-pressed')) === 'false')
  await player.getByLabel('Show waveform and beats').click()

  // clear
  await player.getByLabel('Clear beat markers').click()
  await page.waitForFunction(() => /Tap along/.test(document.querySelector('.pl-beat-text')?.textContent || ''))
  await page.reload()
  await openPlayer()
  await player.getByLabel('Tempo (BPM)').waitFor({ timeout: 15000 })
  await sleep(800)
  check('clearing the beats is kept too', (await player.getByLabel('Tempo (BPM)').inputValue()) === '')

  check('no page errors', errors.length === 0, errors.join(' | '))
  await browser.close()
  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failed}/${results.length} passed`)
  process.exit(failed ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
