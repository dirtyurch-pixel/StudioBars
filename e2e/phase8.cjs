/* Phase 8 acceptance test: melody sketch, chords, lyric-fit and humming (fake microphone). */
const { chromium } = require('playwright')

const APP = process.env.APP_URL || 'http://localhost:5173'
const results = []
const check = (name, ok, extra = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const line = (p, n) => p.getByLabel(new RegExp(`^Line ${n}( \\(locked\\))?$`))
let CURRENT = null

;(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['microphone'] })
  const page = await ctx.newPage()
  CURRENT = page
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))

  await page.goto(APP)
  await page.getByRole('button', { name: '+ New song' }).first().click()
  await page.getByLabel('Title').fill('Melody Test')
  await page.getByRole('button', { name: 'Create song' }).click()
  await line(page, 1).waitFor()
  await line(page, 1).fill('Rain on the glass tonight')
  await line(page, 2).fill('Nobody calls me anymore')
  await page.getByText('Saved', { exact: true }).first().waitFor()
  const lyrics = async () => JSON.stringify(await page.locator('[data-line-input]').evaluateAll((els) => els.map((e) => e.value)))
  const snap = await lyrics()

  await page.getByRole('tab', { name: 'Craft' }).click()
  await page.getByRole('button', { name: 'Melody', exact: true }).click()
  await page.getByRole('group', { name: 'Melody grid' }).waitFor()
  check('melody: a grid with pitch rows and 16th steps is shown', (await page.locator('.mel-cell').count()) >= 25 * 32)

  await page.getByRole('button', { name: 'C4 step 1', exact: true }).click()
  await page.getByRole('button', { name: 'E4 step 5', exact: true }).click()
  await page.getByRole('button', { name: 'G4 step 9', exact: true }).click()
  check('melody: tapping the grid places notes (an eighth long by default)', (await page.locator('.mel-cell.on').count()) === 6)
  await page.getByRole('button', { name: 'C4 step 2 note' }).click()
  check('melody: tapping a note removes it', (await page.locator('.mel-cell.on').count()) === 3 || (await page.locator('.mel-cell.on').count()) === 4)
  await page.getByRole('button', { name: 'C4 step 1', exact: true }).click()

  await page.getByLabel('Chord for bar 1').fill('Am')
  await page.getByLabel('Chord for bar 2').fill('H9')
  await page.getByRole('button', { name: 'Save sketch' }).click()
  await page.getByText(/not a chord symbol/).waitFor()
  check('chords: a made-up chord is refused in plain words and nothing is lost', (await page.locator('.mel-cell.on').count()) >= 4)
  await page.getByLabel('Chord for bar 2').fill('F')
  await page.getByRole('button', { name: 'Save sketch' }).click()
  await page.getByText(/lyrics were not touched/).waitFor()
  check('melody: saving leaves the lyrics unchanged', (await lyrics()) === snap)

  await page.getByRole('button', { name: '▶ Play sketch' }).click()
  check('melody: playing the sketch does not crash', true)

  await page.getByText('Saved', { exact: true }).first().waitFor()
  await page.reload()
  await line(page, 1).waitFor()
  await page.getByRole('tab', { name: 'Craft' }).click()
  await page.getByRole('button', { name: 'Melody', exact: true }).click()
  await page.getByRole('group', { name: 'Melody grid' }).waitFor()
  await sleep(500)
  check('melody: notes and chords are still there after reload', (await page.locator('.mel-cell.on').count()) >= 4 && (await page.getByLabel('Chord for bar 1').inputValue()) === 'Am' && (await page.getByLabel('Chord for bar 2').inputValue()) === 'F')

  await line(page, 1).click()
  await page.getByRole('button', { name: 'Check lyric fit' }).click()
  await page.getByText(/syllables/).first().waitFor()
  check('lyric fit: compares syllables with notes in plain words', /note/.test(await page.getByRole('status').filter({ hasText: /syllable/ }).first().innerText()))

  // humming with the browser's built-in fake microphone (a beep): either notes are found or a friendly message appears; never a crash
  await page.getByRole('button', { name: '🎤 Hum a melody' }).click()
  await sleep(2500)
  await page.getByRole('button', { name: '■ Stop humming' }).click()
  await page.getByText(/Found \d+ notes|No clear pitch/).waitFor({ timeout: 10000 })
  check('humming: ends with a clear message about what was found', true)
  check('humming: lyrics untouched', (await lyrics()) === snap)

  // phone
  const phone = await ctx.newPage()
  CURRENT = phone
  await phone.setViewportSize({ width: 390, height: 780 })
  await phone.goto(APP)
  await phone.getByText('Melody Test').first().click()
  await phone.getByRole('tab', { name: 'Craft' }).click()
  await phone.getByRole('button', { name: 'Melody', exact: true }).click()
  await phone.getByRole('group', { name: 'Melody grid' }).waitFor()
  const sw = await phone.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
  check('phone: the melody grid scrolls inside its box, not the whole page', sw[0] <= sw[1], JSON.stringify(sw))
  await phone.close()

  check('no uncaught page errors', errors.length === 0, errors.join(' | '))
  await browser.close()
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} Phase 8 browser checks passed`)
  process.exit(failed.length ? 1 : 0)
})().catch(async (e) => {
  if (CURRENT) console.error('PAGE TEXT:', ((await CURRENT.locator('body').innerText({ timeout: 2000 }).catch(() => '(unreadable)')) || '').replace(/\s+/g, ' ').slice(0, 700))
  console.error('E2E 8 CRASHED:', e.message.split('\n')[0], '\n', (e.stack || '').split('\n').filter((l) => l.includes('phase8.cjs')).slice(0, 3).join('\n'))
  process.exit(2)
})
