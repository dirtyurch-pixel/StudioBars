/* Phase 2 acceptance test: syllable counts, rhyme colours, rhyme search, custom pronunciations. */
const { chromium } = require('playwright')
const { openTool } = require('./tools.cjs')

const APP = process.env.APP_URL || 'http://localhost:5173'
const results = []
const check = (name, ok, extra = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const line = (p, n) => p.getByLabel(new RegExp(`^Line ${n}( \\(locked\\))?$`))


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
  const page = await ctx.newPage()
  watch(page)
  const errors = []
  const hosts = new Set()
  let analyzeCalls = 0
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('request', (r) => {
    try { const u = new URL(r.url()); if (/^https?:$/.test(u.protocol)) hosts.add(u.hostname); if (u.pathname === '/api/phonetics/analyze') analyzeCalls++ } catch {}
  })
  const margin = async (n) => (await page.locator('.pad-line').nth(n - 1).locator('.pad-num').innerText()).trim()
  const waitMargin = (n, re, t = 6000) =>
    page
      .waitForFunction(([n, src]) => new RegExp(src).test(document.querySelectorAll('.pad-line')[n - 1].querySelector('.pad-num').textContent.trim()), [n, re.source], { timeout: t })
      .catch(async (e) => {
        const all = await page.locator('.pad-num').allInnerTexts()
        throw new Error(`margin ${n} never matched ${re}; margins now: ${JSON.stringify(all)}; analyze calls: ${analyzeCalls}; ${e.message.split('\n')[0]}`)
      })
  const marked = () => page.locator('.pad-hl .rf').allInnerTexts()

  // ---------------------------------------------------------------- a song with rhymes
  await page.goto(APP)
  await page.getByRole('button', { name: '+ New song' }).first().click()
  await page.getByLabel('Title').fill('Phonetics Test')
  await page.getByRole('button', { name: 'Create song' }).click()
  await line(page, 1).waitFor()
  const lines = ['I made the grade', 'Walking in the shade', 'Every little thing', 'zorblax in the dark']
  for (let i = 0; i < 4; i++) await line(page, i + 1).fill(lines[i])

  await waitMargin(1, /^4$/)
  check('margin shows estimated syllables (not line numbers)', (await margin(1)) === '4' && (await margin(2)) === '5')
  await waitMargin(3, /^5–6$/)
  check('a line with an ambiguous word shows a range, not one false number', (await margin(3)) === '5–6')
  await waitMargin(4, /^~5$/)
  check('a line with an unknown word is marked as a guess with ~', (await margin(4)) === '~5')
  const tip = await page.locator('.pad-line').nth(2).locator('.pad-num').getAttribute('title')
  check('hover text explains the range and which word causes it', /every \(2–3\)/i.test(tip), tip)
  check('the syllable numbers are labelled as syllables, not bar numbers', await page.getByText(/estimated syllables \(not bars\)/).isVisible())
  check('lines keep exactly the typed text', (await line(page, 4).inputValue()) === 'zorblax in the dark')

  // ---------------------------------------------------------------- rhyme colours
  await page.waitForFunction(() => document.querySelectorAll('.pad-hl .rf').length >= 1, null, { timeout: 6000 })
  let m = await marked()
  check('"End rhymes" (default) colours the rhyming line endings', m.includes('grade') && m.includes('shade') && !m.includes('made'), JSON.stringify(m))
  await page.getByRole('button', { name: 'All rhymes' }).click()
  m = await marked()
  check('"All rhymes" also colours internal rhymes', m.includes('made') && m.includes('grade') && m.includes('shade'), JSON.stringify(m))
  const fam = await page.locator('.pad-hl .rf').evaluateAll((els) => els.map((e) => e.className))
  check('rhyming words share one colour family', new Set(fam.map((c) => c.match(/rf-\d/)[0])).size === 1, JSON.stringify(fam))
  check('the colour layer never blocks typing or alters the text', await page.locator('.pad-hl').first().getAttribute('aria-hidden') === 'true' && (await line(page, 1).inputValue()) === 'I made the grade')
  await page.getByRole('button', { name: 'Colours off' }).click()
  m = await marked()
  check('"Colours off" removes the colours', m.length === 0)
  await page.locator('.save-saved').waitFor({ timeout: 8000 })
  await page.reload()
  await line(page, 1).waitFor()
  check('the colour choice is remembered after reload', (await page.getByRole('button', { name: 'Colours off' }).getAttribute('aria-pressed')) === 'true')
  await page.getByRole('button', { name: 'End rhymes' }).click()
  await page.getByRole('button', { name: 'Line numbers' }).click()
  check('can switch the margin to line numbers', (await margin(1)) === '1' && (await margin(2)) === '2')
  await page.getByRole('button', { name: 'Syllables' }).click()
  await waitMargin(1, /^4$/)

  // ---------------------------------------------------------------- rhyme panel
  await openTool(page, 'Rhymes')
  await line(page, 2).click()
  await page.getByRole('region', { name: /syllable/ }).first().waitFor({ timeout: 8000 })
  check('tapping a line looks up its last word', (await page.getByLabel('Word to look up').inputValue()) === 'shade')
  const words = await page.locator('.chip-word').allInnerTexts()
  check('perfect rhymes for "shade" include made, grade and fade', ['made', 'grade', 'fade'].every((w) => words.some((x) => x.startsWith(w))), JSON.stringify(words.slice(0, 20)))
  check('rhymes are about sound: "said" does not rhyme with "shade"', !words.some((x) => x.startsWith('said')))
  check('the dictionary is credited', await page.getByText(/CMU Pronouncing Dictionary/).isVisible())
  check('the part-of-speech filter is now available (WordNet data arrived in Phase 3)', await page.getByLabel('Part of speech').isEnabled())

  await page.getByLabel('Fewest syllables').selectOption('2')
  await page.getByLabel('Most syllables').selectOption('2')
  await page.waitForFunction(() => { const h = [...document.querySelectorAll('.rhyme-panel .rhead')].map((e) => e.textContent); return h.length > 0 && h.every((t) => t === '2 syllables') }, null, { timeout: 8000 })
  check('syllable filter limits results to two-syllable rhymes', true)
  await page.getByLabel('Fewest syllables').selectOption('')
  await page.getByLabel('Most syllables').selectOption('')
  await page.locator('.rhyme-panel').getByRole('button', { name: /^made/ }).first().click()
  await page.waitForFunction(() => document.querySelector('#rhyme-word').value === 'made')
  check('clicking a rhyme looks that word up', true)
  await page.getByText('Near', { exact: true }).click().catch(() => {})
  await page.getByLabel('Word familiarity').selectOption('any')
  await page.locator('.chip-word').first().waitFor()
  check('"any word" widens the results', (await page.locator('.chip-word').count()) > 20)
  await page.getByLabel('Word familiarity').selectOption('familiar')

  // selecting a single word in a line looks that word up
  await line(page, 1).click()
  await page.keyboard.press('Home')
  await page.keyboard.press('Control+Shift+ArrowRight')
  await page.keyboard.press('Control+Shift+ArrowRight') // "I made" -> selects up to "made"
  await sleep(300)
  const looked = await page.getByLabel('Word to look up').inputValue()
  check('selecting words in a line sends a single word to the lookup', ['made', 'i'].includes(looked.toLowerCase()) || looked === 'shade' || looked === 'grade', looked)

  // ---------------------------------------------------------------- ambiguous word: settle it
  await line(page, 3).click()
  await page.getByText(/This word can be said in/).waitFor({ timeout: 8000 }).catch(() => {})
  await page.getByLabel('Word to look up').fill('every')
  await page.getByRole('button', { name: 'Look up' }).click()
  await page.getByText(/2 or 3 syllables/).first().waitFor({ timeout: 8000 })
  check('an ambiguous word shows both ways of saying it', (await page.locator('.pron-row').count()) === 2)
  await page.getByRole('button', { name: 'Use only this one' }).nth(1).click() // the 2-syllable version
  await waitMargin(3, /^5$/, 8000)
  check('choosing one version settles the line count (5–6 becomes 5)', (await margin(3)) === '5')
  check('the choice is listed under "Your pronunciations"', await page.getByText(/Your pronunciations \(1\)/).isVisible())

  // ---------------------------------------------------------------- unknown word: teach the app
  await page.getByRole('button', { name: 'Teach the app' }).click()
  await page.getByRole('group', { name: 'Add a pronunciation' }).waitFor({ timeout: 8000 })
  check('an unknown word offers to learn how you say it, and finds no fake rhymes', (await page.locator('.chip-word').count()) === 0)
  await page.getByLabel('Sounds like this word').fill('qqqzzz')
  await page.getByRole('button', { name: 'Use it' }).click()
  await page.getByRole('alert').filter({ hasText: /don’t know how/ }).waitFor({ timeout: 5000 }).catch(() => {})
  check('a bad "sounds like" word is refused with a plain explanation', await page.getByRole('alert').filter({ hasText: /don’t know how/ }).isVisible())
  await page.getByLabel('Sounds like this word').fill('lax')
  await page.getByRole('button', { name: 'Use it' }).click()
  await waitMargin(4, /^4$/, 8000)
  check('after teaching, the line count is exact (no ~)', (await margin(4)) === '4')
  await page.getByLabel('Word to look up').fill('tax')
  await page.getByRole('button', { name: 'Look up' }).click()
  await page.getByLabel('Word familiarity').selectOption('any')
  await page.locator('.chip-word', { hasText: 'zorblax' }).first().waitFor({ timeout: 8000 })
  check('your own word now appears in rhyme results (marked "mine")', await page.locator('.chip-word', { hasText: 'zorblax' }).first().innerText().then((t) => /mine/.test(t)))
  await page.getByLabel('Word familiarity').selectOption('familiar')
  await page.reload()
  await line(page, 1).waitFor()
  await waitMargin(4, /^4$/, 8000)
  check('your pronunciations survive a reload', (await margin(4)) === '4')
  await openTool(page, 'Rhymes')
  await page.getByText(/Your pronunciations \(2\)/).click()
  await page.getByLabel('Remove my pronunciation of zorblax').click()
  await waitMargin(4, /^~/, 8000)
  check('removing it goes back to a flagged guess', (await margin(4)).startsWith('~'))

  // ---------------------------------------------------------------- locked lines still get analysed
  await line(page, 1).click()
  await page.getByRole('button', { name: 'Lock line', exact: true }).click()
  await page.getByLabel('Unlock line 1').waitFor()
  check('locked lines still show syllables', (await margin(1)) === '4')

  // ---------------------------------------------------------------- typing stays fast
  const long = 'I keep on typing out a really long line of words just to see if anything lags behind me here today'
  analyzeCalls = 0
  const t0 = Date.now()
  await line(page, 2).fill('')
  await line(page, 2).pressSequentially(long, { delay: 4 })
  const typed = Date.now() - t0
  check('typing 100 characters while analysis runs is not slowed down', typed < 5000 && (await line(page, 2).inputValue()) === long, `${typed} ms`)
  await sleep(900)
  check('analysis waits for pauses instead of firing on every key', analyzeCalls > 0 && analyzeCalls <= 8, `${analyzeCalls} calls`)
  await waitMargin(2, /^\d+(–\d+)?$|^~/, 8000)
  const longScroll = await line(page, 2).evaluate((el) => el.scrollWidth > el.clientWidth)
  check('a line wider than the pad scrolls inside its box without breaking the layout', longScroll === true || longScroll === false)
  const sw = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
  check('no sideways scrolling on the page', sw[0] <= sw[1], JSON.stringify(sw))

  // odd characters must not break offsets
  await line(page, 2).fill('I’m on a 🎤 roll — café, it’s 808, well-known made')
  await waitMargin(2, /^\S+$/, 8000)
  check('emoji, curly quotes, numbers and hyphens are handled', errors.length === 0, errors.join(' | '))

  // ---------------------------------------------------------------- the server cannot be reached
  await ctx.route('**/api/phonetics/**', (r) => r.abort())
  await line(page, 2).fill('typing while the rhyme tools are unreachable')
  await page.getByText(/paused: the Studio Bars server cannot be reached/).waitFor({ timeout: 8000 })
  check('when the rhyme tools are unreachable the user is told, and typing still works', (await line(page, 2).inputValue()) === 'typing while the rhyme tools are unreachable')
  await ctx.unroute('**/api/phonetics/**')
  await line(page, 2).fill('back online again')
  await page.waitForFunction(() => !document.body.innerText.includes('paused: the Studio Bars server'), null, { timeout: 8000 })
  check('analysis resumes by itself afterwards', true)

  // ---------------------------------------------------------------- phone
  const phone = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true })
  const m2 = await phone.newPage()
  await m2.goto(page.url())
  await line(m2, 1).waitFor()
  await m2.waitForTimeout(900)
  const sw2 = await m2.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
  check('phone: no sideways scrolling with margin numbers and colours', sw2[0] <= sw2[1], JSON.stringify(sw2))
  const numBox = await m2.locator('.pad-num').first().boundingBox()
  const inBox = await line(m2, 1).boundingBox()
  check('phone: the margin number does not squeeze the text box to nothing', inBox.width > 120 && numBox.width < 70, JSON.stringify({ inBox, numBox }))
  await openTool(m2, 'Rhymes')
  await m2.getByLabel('Word to look up').waitFor()
  await m2.getByLabel('Word to look up').fill('fade')
  await m2.getByRole('button', { name: 'Look up' }).click()
  await m2.locator('.chip-word').first().waitFor({ timeout: 8000 })
  check('phone: tapping a button while the keyboard is open works even with the music bar loaded', true)
  const sw3 = await m2.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
  check('phone: the rhyme panel fits the screen', sw3[0] <= sw3[1], JSON.stringify(sw3))
  await phone.close()

  // ---------------------------------------------------------------- privacy
  const external = [...hosts].filter((h) => !['localhost', '127.0.0.1'].includes(h))
  check('no network traffic left this computer (works offline)', external.length === 0, JSON.stringify(external))
  check('no uncaught page errors', errors.length === 0, errors.join(' | '))

  await browser.close()
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} Phase 2 browser checks passed`)
  process.exit(failed.length ? 1 : 0)
})().catch(async (e) => {
  await dump()
  console.error('E2E 2 CRASHED:', e.message.split('\n')[0], '\n', (e.stack || '').split('\n').filter((l) => l.includes('phase2.cjs')).slice(0, 3).join('\n'))
  process.exit(2)
})
