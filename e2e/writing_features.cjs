/* Full-page lyrics, syllable targets and performance mode (phone version, PC-sized and phone-sized screens). */
const { chromium, devices } = require('playwright')

const URL_ = process.env.PHONE_LOCAL_URL || 'http://127.0.0.1:4174/StudioBars/'
const results = []
const check = (name, ok, extra = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`)
}
const line = (p, n) => p.getByLabel(new RegExp(`^Line ${n}( \\(locked\\))?$`))

;(async () => {
  const browser = await chromium.launch()
  const errors = []

  // ---- PC size: syllable target and performance mode
  const pc = await browser.newContext({ viewport: { width: 1280, height: 860 } })
  const page = await pc.newPage()
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(URL_)
  await page.getByRole('button', { name: '+ New song' }).first().click()
  await page.getByLabel('Title').fill('Rehearse Me')
  await page.getByRole('button', { name: 'Create song' }).click()
  await line(page, 1).fill('I made the grade')
  await line(page, 1).press('Enter')
  await line(page, 2).fill('Walking slowly in the summer shade tonight')
  await page.getByText('Saved', { exact: true }).first().waitFor()
  await page.getByLabel('Syllable target from').fill('6')
  await page.getByLabel('Syllable target to').fill('8')
  await page.getByLabel('Syllable target to').press('Enter')
  await page.waitForFunction(() => document.querySelectorAll('.pad-num.off-target').length === 2, null, { timeout: 10000 })
  const marks = await page.locator('.pad-num.off-target').evaluateAll((es) => es.map((e) => [...e.classList].find((c) => c === 'under' || c === 'over')))
  check('syllable target: a short line is marked under, a long line over', JSON.stringify(marks) === '["under","over"]', JSON.stringify(marks))
  await page.reload()
  await line(page, 1).waitFor()
  await page.waitForFunction(() => document.querySelectorAll('.pad-num.off-target').length === 2, null, { timeout: 10000 })
  check('syllable target is remembered after reopening', true)

  await page.getByLabel('Song menu').click()
  await page.getByRole('menuitem', { name: 'Performance mode (rehearse)' }).click()
  const perf = page.getByRole('dialog', { name: 'Performance mode' })
  await perf.waitFor()
  check('performance mode shows the lyrics big', (await perf.getByText('Walking slowly in the summer shade tonight').count()) === 1)
  const before = await perf.locator('.perform-lyrics').evaluate((e) => parseFloat(getComputedStyle(e).fontSize))
  await perf.getByRole('button', { name: 'Bigger text' }).click()
  const after = await perf.locator('.perform-lyrics').evaluate((e) => parseFloat(getComputedStyle(e).fontSize))
  check('performance mode: the text can be made bigger', after > before && before >= 22, JSON.stringify([before, after]))
  await perf.getByRole('button', { name: 'Medium' }).click()
  check('performance mode: auto-scroll can be switched on', (await perf.getByRole('button', { name: 'Medium' }).getAttribute('aria-pressed')) === 'true')
  await page.keyboard.press('Escape')
  check('Escape leaves performance mode', (await perf.count()) === 0)
  await pc.close()

  // ---- phone: full-page lyrics
  const ph = await browser.newContext({ ...devices['Pixel 7'] })
  const m = await ph.newPage()
  m.on('pageerror', (e) => errors.push(String(e)))
  await m.goto(URL_)
  await m.getByRole('button', { name: '+ New song' }).first().click()
  await m.getByLabel('Title').fill('Full Page')
  await m.getByRole('button', { name: 'Create song' }).click()
  await line(m, 1).fill('Only the words on the page')
  await m.getByRole('button', { name: 'Done' }).click()
  await m.getByLabel('Full page lyrics').click()
  check('full page: the header and music bar step aside', !(await m.getByLabel('Song title').isVisible()) && !(await m.getByLabel('Music player').isVisible()))
  check('full page: the lyrics and section tabs stay', (await line(m, 1).isVisible()) && (await m.getByRole('tab', { name: 'Verse 1' }).isVisible()))
  await line(m, 1).click()
  check('full page: while typing, the rhyme strip and line toolbar still sit on the keyboard', await m.getByRole('toolbar', { name: 'This line' }).isVisible())
  await m.getByRole('button', { name: 'Done' }).click()
  await m.getByLabel('Exit full page').click()
  check('full page: the exit button brings everything back', await m.getByLabel('Song title').isVisible())
  const sw = await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
  check('phone: no sideways scrolling', sw)
  await ph.close()

  check('no page errors', errors.length === 0, errors.join(' | '))
  await browser.close()
  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failed}/${results.length} writing-feature checks passed`)
  process.exit(failed ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
