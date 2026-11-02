/* Phase 1B acceptance test: music library, playlists, player, loops, speed, song links. */
const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')

const APP = process.env.APP_URL || 'http://localhost:5173'
const MEDIA_DIR = process.env.MEDIA_DIR
const results = []
const check = (name, ok, extra = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const line = (p, n) => p.getByLabel(new RegExp(`^Line ${n}( \\(locked\\))?$`))
const saved = (p) => p.locator('.save-saved').waitFor({ timeout: 8000 })

/** A real mono 16-bit WAV (sine tone) of the given length. */
function wav(seconds, freq, rate = 8000) {
  const n = Math.floor(seconds * rate)
  const b = Buffer.alloc(44 + n * 2)
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12)
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24)
  b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36)
  b.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 8000), 44 + i * 2)
  return b
}
const TRACKS = [
  ['01 Slow Tide', 60, 220], ['02 Short One', 3, 262], ['03 Night Drive', 8, 294], ['04 Low Light', 8, 330],
  ['05 Rooftop', 8, 349], ['06 Static', 8, 392], ['07 Afterglow', 8, 440], ['08 Haze', 8, 494],
  ['09 Neon', 8, 523], ['10 Last Call', 8, 587],
]
const files = TRACKS.map(([n, s, f]) => ({ name: `${n}.wav`, mimeType: 'audio/wav', buffer: wav(s, f) }))
const badFiles = [
  { name: 'damaged.wav', mimeType: 'audio/wav', buffer: Buffer.concat([Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt '), Buffer.alloc(40, 7)]) },
  { name: 'fake.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('this is definitely not an mp3 file at all') },
  { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('lyrics ideas') },
]


// Diagnostics printed if a suite crashes: what the page was showing and which requests failed.
const net = []
let CURRENT = null
const watch = (p) => {
  CURRENT = p
  p.on('requestfailed', (r) => net.push(`FAILED ${r.method()} ${r.url().slice(0, 110)} ${r.failure()?.errorText || ''}`))
  p.on('response', (r) => { if (r.status() >= 400) net.push(`HTTP ${r.status()} ${r.request().method()} ${r.url().slice(0, 110)}`) })
  p.on('console', (m) => { if (m.type() === 'error') net.push(`CONSOLE ${m.text().slice(0, 140)}`) })
}
const dump = async () => {
  if (CURRENT) console.error('PAGE TEXT:', ((await CURRENT.locator('body').innerText({ timeout: 2000 }).catch(() => '(page unreadable)')) || '').replace(/\s+/g, ' ').slice(0, 700))
  console.error('NETWORK PROBLEMS (last 10):', JSON.stringify(net.slice(-10), null, 1))
}

;(async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  // capture the app's <audio> elements so the test can read real playback state
  await ctx.addInitScript(() => {
    const R = window.Audio
    window.__audios = []
    window.Audio = function (...a) {
      const el = new R(...a)
      window.__audios.push(el)
      el.__loadstarts = 0
      el.addEventListener('loadstart', () => el.__loadstarts++)
      return el
    }
    window.Audio.prototype = R.prototype
  })
  const page = await ctx.newPage()
  watch(page)
  const errors = []
  const hosts = new Set()
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('request', (r) => { try { const u = new URL(r.url()); if (/^https?:$/.test(u.protocol)) hosts.add(u.hostname) } catch {} })
  const A = () => page.evaluate(() => {
    const a = window.__audios.find((x) => x.currentSrc) || window.__audios[0]
    return a ? { t: a.currentTime, paused: a.paused, src: a.currentSrc, rate: a.playbackRate, pp: a.preservesPitch, d: a.duration, loads: a.__loadstarts, vol: a.volume } : null
  })
  const seekTo = (s) => page.evaluate((s) => { (window.__audios.find((x) => x.currentSrc)).currentTime = s }, s)
  const barText = () => page.getByLabel('Music player').innerText()
  const openLib = async () => { if (!(await page.getByLabel('Music library', { exact: true }).isVisible().catch(() => false))) await page.getByLabel('Music library and playlists').click() }
  const closeLib = async () => { if (await page.getByLabel('Close music library').isVisible().catch(() => false)) await page.getByLabel('Close music library').click() }

  // ---------------------------------------------------------------- import
  await page.goto(APP)
  await page.getByText(/Import your own tracks|No music loaded/).first().waitFor()
  check('player bar is visible with an empty library', await page.getByLabel('Music player').isVisible())
  await openLib()
  check('file chooser is locked until consent is given', await page.locator('#music-files').isDisabled())
  await page.getByRole('checkbox').check()
  await page.setInputFiles('#music-files', [...files, ...badFiles])
  const results1 = page.getByLabel('Import results')
  await results1.getByRole('listitem').nth(12).waitFor({ timeout: 60000 })
  const txt = await results1.innerText()
  check('10 good files imported', (txt.match(/✓/g) || []).length === 10, txt)
  check('damaged WAV reported, not imported', /damaged\.wav[^\n]*can't play/i.test(txt), txt)
  check('fake MP3 reported, not imported', /fake\.mp3/.test(txt) && /✕ fake\.mp3/.test(txt), txt)
  check('text file reported as unsupported', /notes\.txt[^\n]*not a supported audio type/.test(txt), txt)
  check('library lists exactly the 10 good tracks', (await page.locator('.trk').count()) === 10)
  if (MEDIA_DIR) {
    const onDisk = fs.readdirSync(MEDIA_DIR).filter((f) => !f.startsWith('.'))
    check('only the 10 good files were copied to private storage', onDisk.length === 10 && !fs.readdirSync(MEDIA_DIR).some((f) => f.startsWith('.incoming')), JSON.stringify(onDisk))
  }
  // rename a track
  await page.locator('.trk', { hasText: '02 Short One' }).getByRole('button', { name: 'Rename' }).click()
  await page.getByLabel('Track title').fill('02 Short One (edited)')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByText('02 Short One (edited)').first().waitFor()
  check('track can be renamed', true)

  // ---------------------------------------------------------------- playlists
  await page.getByRole('tab', { name: 'Playlists' }).click()
  await page.getByPlaceholder('New playlist name').fill('Writing night')
  await page.getByRole('button', { name: 'Create playlist' }).click()
  const add = async (title) => page.locator('#pl-add').selectOption({ label: title })
  const titles = ['01 Slow Tide', '02 Short One (edited)', '03 Night Drive', '04 Low Light', '01 Slow Tide']
  for (let i = 0; i < titles.length; i++) {
    await add(titles[i])
    // wait for the server to confirm each one (a fixed pause was too short on slow machines)
    await page.waitForFunction((n) => document.querySelectorAll('ol.tracks .trk-title').length >= n, i + 1)
  }
  let rows = await page.locator('ol.tracks .trk-title').allInnerTexts()
  check('playlist keeps repeated tracks on purpose', rows.length === 5 && rows[0] === rows[4], JSON.stringify(rows))
  await page.getByLabel('Move 03 Night Drive up').click()
  await page.waitForFunction(() => document.querySelectorAll('ol.tracks .trk-title')[1]?.textContent?.includes('03 Night Drive'), null, { timeout: 5000 }).catch(() => {})
  rows = await page.locator('ol.tracks .trk-title').allInnerTexts()
  check('reordering a playlist works', rows[1] === '03 Night Drive' && rows[2] === '02 Short One (edited)', JSON.stringify(rows))
  await page.getByRole('button', { name: '← All playlists' }).click()
  await page.getByPlaceholder('New playlist name').fill('Throwaway')
  await page.getByRole('button', { name: 'Create playlist' }).click()
  await add('05 Rooftop')
  await page.getByRole('button', { name: 'Delete playlist' }).click()
  await page.getByRole('button', { name: 'Yes, delete playlist' }).click()
  await page.getByRole('tab', { name: 'Tracks' }).click()
  check('deleting a playlist keeps the audio in the library', (await page.locator('.trk').count()) === 10)

  // ---------------------------------------------------------------- a song to write in
  await closeLib()
  await page.getByRole('button', { name: '+ New song' }).first().click()
  await page.getByLabel('Title').fill('Music Test')
  await page.getByLabel('Start with').selectOption('verse-chorus')
  await page.getByRole('button', { name: 'Create song' }).click()
  await line(page, 1).waitFor()

  // ---------------------------------------------------------------- play the playlist while writing
  await openLib()
  await page.getByRole('tab', { name: 'Playlists' }).click()
  await page.getByRole('button', { name: 'Open playlist Writing night' }).click()
  await page.getByRole('button', { name: '▶ Play playlist' }).click()
  await closeLib()
  await page.waitForFunction(() => window.__audios.some((a) => a.currentSrc && !a.paused && a.currentTime > 0.3), null, { timeout: 15000 })
  const s1 = await A()
  check('playlist plays: audio is really running', !s1.paused && s1.t > 0.3)
  check('player shows the track and position in the playlist', /01 Slow Tide/.test(await barText()) && /1 of 5/.test(await barText()))

  // type, switch sections, lock, open tools, snapshot: music must not blink
  const before = await A()
  await line(page, 1).fill('Typing while the music plays')
  await page.keyboard.type(' and more words typed quickly', { delay: 8 })
  await page.getByRole('tab', { name: 'Chorus' }).click()
  await line(page, 1).fill('Chorus line')
  await page.getByRole('tab', { name: 'Verse 2' }).click()
  await page.getByRole('tab', { name: 'Verse 1' }).click()
  await page.getByLabel('Lock line 1').click()
  await page.getByLabel('Unlock line 1').waitFor()
  await page.getByRole('tab', { name: 'History' }).click()
  await page.getByLabel('Save a snapshot of this song now').fill('during music')
  await page.getByRole('button', { name: 'Save snapshot' }).click()
  await page.getByText('during music').waitFor()
  await page.getByRole('tab', { name: 'Export' }).click()
  await saved(page)
  await sleep(1200)
  const after = await A()
  check('music kept playing through typing, section changes, locking, autosave and snapshots', !after.paused && after.t > before.t && after.src === before.src, JSON.stringify({ before, after }))
  check('the track was never reloaded or restarted while editing', after.loads === before.loads, `${before.loads} -> ${after.loads}`)

  // leave the song and come back: still playing
  await page.getByLabel('Back to my songs').click()
  await page.getByText('Music Test').first().waitFor()
  const mid = await A()
  await page.getByText('Music Test').first().click()
  await line(page, 1).waitFor()
  await sleep(600)
  const back = await A()
  check('navigating away and back does not reset playback', !back.paused && back.t > mid.t && back.loads === before.loads, JSON.stringify({ mid, back }))

  // ---------------------------------------------------------------- transport
  await page.getByLabel('Pause').click()
  await sleep(200)
  const p1 = await A()
  await sleep(500)
  const p2 = await A()
  check('pause stops the audio', p1.paused && Math.abs(p2.t - p1.t) < 0.05)
  await page.getByLabel('Seek').evaluate((el) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, '9'); el.dispatchEvent(new Event('input', { bubbles: true })) })
  await sleep(150)
  check('seek moves the playhead', Math.abs((await A()).t - 9) < 0.5)
  // playlist order is: 01 Slow Tide, 03 Night Drive, 02 Short One, 04 Low Light, 01 Slow Tide
  await page.getByLabel('Next track').click()
  await page.waitForFunction(() => /03 Night Drive/.test(document.querySelector('[aria-label="Music player"]').innerText))
  { const bt = await barText(); check('Next goes to the next track in the playlist', /2 of 5/.test(bt), JSON.stringify(bt)) }
  await page.getByLabel('Previous track').click()
  await page.waitForFunction(() => /01 Slow Tide/.test(document.querySelector('[aria-label="Music player"]').innerText))
  check('Previous within 3 s goes back to the previous track', /1 of 5/.test(await barText()))
  await page.getByLabel('Next track').click()
  await page.waitForFunction(() => /03 Night Drive/.test(document.querySelector('[aria-label="Music player"]').innerText))
  // auto-advance when a track ends
  await seekTo(7.3)
  await page.waitForFunction(() => /02 Short One/.test(document.querySelector('[aria-label="Music player"]').innerText), null, { timeout: 10000 })
  check('a track that ends moves on to the next one by itself', /3 of 5/.test(await barText()))
  // repeat one
  await page.getByLabel(/^Repeat: /).click() // all
  await page.getByLabel(/^Repeat: /).click() // one
  check('repeat cycles off → all → one', (await page.getByLabel('Repeat: one').count()) === 1)
  await seekTo(2.5)
  await sleep(1500)
  check('repeat one replays the same track', /02 Short One/.test(await barText()) && (await A()).t < 2.4)
  await page.getByLabel('Repeat: one').click() // off
  // shuffle
  await page.getByLabel('Shuffle').click()
  check('shuffle can be switched on', (await page.getByLabel('Shuffle').getAttribute('aria-pressed')) === 'true')
  await page.getByLabel('Shuffle').click()
  // volume / mute
  await page.getByLabel('Mute').click()
  await page.getByLabel('Unmute').waitFor()
  await page.getByLabel('Unmute').click()
  check('mute and unmute work', true)

  // ---------------------------------------------------------------- speed with pitch preserved
  await page.getByLabel('Playback speed').selectOption('0.85')
  const sp = await A()
  check('speed 0.85× is applied', Math.abs(sp.rate - 0.85) < 0.001)
  check('pitch is preserved at the slower speed', sp.pp === true)
  await page.getByLabel('Playback speed').selectOption('0.75')
  check('speed 0.75× is applied', Math.abs((await A()).rate - 0.75) < 0.001)
  await page.getByLabel('Playback speed').selectOption('1')
  check('lyrics are untouched by speed changes', (await line(page, 1).inputValue()).startsWith('Typing while the music plays'))

  // ---------------------------------------------------------------- A–B loop
  await page.getByLabel('Next track').click()
  await page.waitForFunction(() => /04 Low Light/.test(document.querySelector('[aria-label="Music player"]').innerText))
  await seekTo(2)
  await sleep(200)
  await page.getByLabel('Set loop start (A) here').click()
  await seekTo(4)
  await sleep(200)
  await page.getByLabel('Set loop end (B) here').click()
  await page.getByText(/Looping 0:0[12]–0:0[34]/).waitFor()
  await seekTo(3)
  const samples = []
  for (let i = 0; i < 28; i++) { samples.push((await A()).t); await sleep(150) }
  const inside = samples.every((t) => t > 1.7 && t < 4.5)
  const wrapped = samples.some((t, i) => i > 0 && t < samples[i - 1] - 0.5)
  check('A–B loop keeps playback between A and B', inside, JSON.stringify(samples.map((x) => +x.toFixed(2))))
  check('A–B loop jumps back to A when it reaches B', wrapped)
  // seek with the slider, like a user would (the app knows about its own seeks)
  await page.getByLabel('Seek').evaluate((el) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, '6'); el.dispatchEvent(new Event('input', { bubbles: true })) })
  await sleep(200)
  await page.getByLabel('Set loop start (A) here').click()
  await page.getByRole('alert').filter({ hasText: /before the end/ }).waitFor({ timeout: 3000 }).catch(() => {})
  check('an A after B is rejected with a message', await page.getByRole('alert').filter({ hasText: /before the end/ }).isVisible())
  await sleep(300)

  // ---------------------------------------------------------------- link music to the song, reload
  await page.getByRole('tab', { name: 'Music' }).click()
  await page.getByRole('button', { name: /Link current track/ }).click()
  await page.getByText('1.0×', { exact: false }).first().waitFor({ timeout: 5000 }).catch(() => {})
  await page.getByLabel('Writing session').waitFor()
  check('Writing Session strip shows the linked music', /04 Low Light/.test(await page.getByLabel('Writing session').innerText()))
  await page.getByLabel('Playback speed').selectOption('0.85')
  await sleep(1500) // link autosave
  await page.getByLabel('Pause').click()
  await sleep(1200)
  await page.reload()
  await line(page, 1).waitFor()
  await page.waitForFunction(() => window.__audios.some((a) => a.currentSrc), null, { timeout: 15000 })
  await sleep(800)
  const re = await A()
  check('after reload the linked music is loaded but NOT auto-playing', re.paused && /04 Low Light/.test(await barText()))
  check('after reload the saved loop is restored', /Looping 0:0[12]–0:0[34]/.test(await barText()))
  check('after reload the saved speed is restored', Math.abs(re.rate - 0.85) < 0.001)

  // ---------------------------------------------------------------- missing file + relink
  if (MEDIA_DIR) {
    const names = fs.readdirSync(MEDIA_DIR).filter((f) => !f.startsWith('.'))
    fs.unlinkSync(path.join(MEDIA_DIR, names[3]))
    await page.reload()
    await line(page, 1).waitFor()
    await openLib()
    await page.locator('.trk.missing').waitFor({ timeout: 10000 })
    const title = await page.locator('.trk.missing .trk-title').innerText()
    check('a deleted file is shown as missing, not a crash', (await page.locator('.trk.missing').count()) === 1 && (await page.getByText(/File missing/).count()) >= 1, title)
    check('missing track cannot be played', await page.getByLabel(`Play ${title}`, { exact: true }).isDisabled())
    const src = TRACKS.find(([n]) => title.startsWith(n))
    await page.locator('.trk.missing input[type=file]').setInputFiles({ name: 'restored.wav', mimeType: 'audio/wav', buffer: wav(src[1], src[2]) })
    await page.locator('.trk.missing').waitFor({ state: 'detached', timeout: 10000 })
    check('relinking restores the track and keeps its title', (await page.locator('.trk', { hasText: title }).count()) === 1)
    await page.getByRole('tab', { name: 'Playlists' }).click()
    await page.getByRole('button', { name: 'Open playlist Writing night' }).click()
    await page.locator('ol.tracks .trk').first().waitFor({ timeout: 5000 })
    check('playlist metadata survived the missing-file episode', (await page.locator('ol.tracks .trk').count()) === 5)
    await closeLib()
  }

  // ---------------------------------------------------------------- phone
  const phone = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true })
  await phone.addInitScript(() => {})
  const m = await phone.newPage()
  const url = page.url()
  await m.goto(url)
  await line(m, 1).waitFor()
  await m.waitForTimeout(800)
  const sw = await m.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
  check('phone: no sideways scrolling with the player bar', sw[0] <= sw[1], JSON.stringify(sw))
  const barBox = await m.getByLabel('Music player').boundingBox()
  check('phone: player bar sits at the bottom of the screen', Math.abs(barBox.y + barBox.height - 780) < 3, JSON.stringify(barBox))
  await m.getByLabel('Next track').scrollIntoViewIfNeeded()
  // keyboard open on a phone: viewport shrinks, bar collapses to essentials, line stays visible above it
  await line(m, 4).tap()
  await m.setViewportSize({ width: 390, height: 400 })
  await m.waitForTimeout(700)
  const compact = await m.getByLabel('Music player').evaluate((el) => el.classList.contains('compact'))
  check('phone: player collapses while typing', compact)
  check('phone: play/pause stays reachable while typing', await m.getByLabel(/^(Play|Pause)$/).isVisible())
  const lb = await line(m, 4).boundingBox()
  const bb = await m.getByLabel('Music player').boundingBox()
  check('phone: the active lyric line is not hidden behind the player', lb.y >= 0 && lb.y + lb.height <= bb.y + 1, JSON.stringify({ lb, bb }))
  await m.setViewportSize({ width: 390, height: 780 })
  await m.keyboard.press('Tab')
  await phone.close()

  // ---------------------------------------------------------------- privacy
  const external = [...hosts].filter((h) => !['localhost', '127.0.0.1'].includes(h))
  check('no network traffic left this computer', external.length === 0, JSON.stringify(external))
  check('no uncaught page errors', errors.length === 0, errors.join(' | '))

  await browser.close()
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} Phase 1B browser checks passed`)
  process.exit(failed.length ? 1 : 0)
})().catch(async (e) => {
  await dump()
  console.error('E2E 1B CRASHED:', e.message)
  process.exit(2)
})
