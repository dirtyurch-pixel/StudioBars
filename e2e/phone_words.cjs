/* Phone version, step 2: syllables, rhyme colours, rhymes, word meanings and the phrase bank, all on the device. */
const { chromium, devices } = require('playwright')

const URL_ = process.env.PHONE_LOCAL_URL || 'http://127.0.0.1:4174/StudioBars/'
const results = []
const check = (name, ok, extra = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`)
}
const line = (p, n) => p.getByLabel(new RegExp(`^Line ${n}( \\(locked\\))?$`))
let CURRENT = null

;(async () => {
  const browser = await chromium.launch(process.env.HTTPS_PROXY && URL_.startsWith('https') ? { proxy: { server: process.env.HTTPS_PROXY } } : {})
  const ctx = await browser.newContext({ ...devices['Pixel 7'], ignoreHTTPSErrors: true })
  const page = await ctx.newPage()
  CURRENT = page
  const errors = []
  const apiCalls = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('request', (r) => {
    if (new URL(r.url()).pathname.includes('/api/')) apiCalls.push(r.url())
  })
  const margin = async (n) => (await page.locator('.pad-line').nth(n - 1).locator('.pad-num').innerText()).trim()
  const waitMargin = (n, re, t = 20000) =>
    page.waitForFunction(([n, src]) => new RegExp(src).test(document.querySelectorAll('.pad-line')[n - 1]?.querySelector('.pad-num')?.textContent.trim() ?? ''), [n, re.source], { timeout: t })

  // a phone that already has songs from step 1 (database version 1) must upgrade without losing them
  await page.goto(URL_ + 'manifest.webmanifest')
  await page.evaluate(
    () =>
      new Promise((res, rej) => {
        const open = indexedDB.open('studio-bars', 1)
        open.onupgradeneeded = () => {
          open.result.createObjectStore('songs')
          open.result.createObjectStore('revisions')
        }
        open.onsuccess = () => {
          const t = open.result.transaction('songs', 'readwrite')
          const now = new Date().toISOString()
          t.objectStore('songs').put(
            { id: 'oldsong00001', title: 'Written In Step One', concept: '', mood: '', point_of_view: '', bpm: null, time_signature: null, version: 1, created_at: now, updated_at: now, genres: [], deleted_at: null,
              sections: [{ id: 'oldsect00001', label: 'Verse 1', section_type: 'verse', lines: [{ id: 'oldline00001', text: 'still here after the update', is_locked: true, comments: [] }] }] },
            'oldsong00001',
          )
          t.oncomplete = () => { open.result.close(); res(true) }
        }
        open.onerror = () => rej(open.error)
      }),
  )
  await page.goto(URL_)
  await page.getByText('Written In Step One').waitFor()
  check('songs saved by step 1 survive the update', true)
  await page.getByRole('button', { name: '+ New song' }).first().click()
  await page.getByLabel('Title').fill('Rhymes On Phone')
  await page.getByRole('button', { name: 'Create song' }).click()
  await line(page, 1).waitFor()
  const lines = ['I made the grade', 'Walking in the shade', 'Every little thing', 'zorblax in the dark']
  for (let i = 0; i < 4; i++) await line(page, i + 1).fill(lines[i])

  await waitMargin(1, /^4$/)
  check('syllable numbers in the margin work on the phone', (await margin(1)) === '4' && (await margin(2)) === '5')
  await waitMargin(3, /^5–6$/)
  check('ambiguous words show a range', (await margin(3)) === '5–6')
  await waitMargin(4, /^~5$/)
  check('unknown words are marked as a guess', (await margin(4)) === '~5')
  await page.waitForFunction(() => document.querySelectorAll('.pad-hl .rf').length >= 1, null, { timeout: 10000 })
  const marked = await page.locator('.pad-hl .rf').allInnerTexts()
  check('rhyme colours appear on the rhyming line endings', marked.includes('grade') && marked.includes('shade'), JSON.stringify(marked))
  check('no "server cannot be reached" message', (await page.getByText(/server cannot be reached/).count()) === 0)

  // rhymes
  await page.getByRole('tab', { name: 'Rhymes' }).click()
  await line(page, 2).click()
  await page.getByRole('region', { name: /syllable/ }).first().waitFor({ timeout: 20000 })
  const words = await page.locator('.chip-word').allInnerTexts()
  check('rhymes for "shade" include made, grade and fade', ['made', 'grade', 'fade'].every((w) => words.some((x) => x.startsWith(w))), JSON.stringify(words.slice(0, 15)))
  check('rhymes are about sound: "said" is not offered', !words.some((x) => x.startsWith('said')))
  check('no online rhymes section on the phone', (await page.getByText('Online rhymes (optional)').count()) === 0)
  await page.getByLabel('Part of speech').selectOption('noun')
  await page.getByText(/usually used as a noun/).waitFor({ timeout: 90000 })
  check('part-of-speech filter works on the phone (WordNet loaded on the device)', true)
  await page.getByLabel('Part of speech').selectOption('')

  // teach a pronunciation choice
  await page.getByLabel('Word to look up').fill('every')
  await page.getByRole('button', { name: 'Look up' }).click()
  await page.getByRole('button', { name: 'Use only this one' }).nth(1).waitFor()
  await page.getByRole('button', { name: 'Use only this one' }).nth(1).click()
  await waitMargin(3, /^5$/)
  check('choosing how a word is said settles the syllable count', (await margin(3)) === '5')

  // phrase rhymes
  await page.getByRole('tab', { name: /Phrase \(experimental\)/ }).click()
  await page.getByLabel('Phrase', { exact: true }).fill('pay attention')
  await page.getByRole('button', { name: 'Find rhymes' }).click()
  await page.getByRole('region', { name: 'Phrase rhymes' }).waitFor({ timeout: 20000 })
  const pr = await page.getByRole('region', { name: 'Phrase rhymes' }).locator('.chip-word').allInnerTexts()
  check('phrase rhymes work ("pay attention" → tension, mention)', pr.some((t) => t.startsWith('tension')) && pr.some((t) => t.startsWith('mention')), JSON.stringify(pr.slice(0, 8)))

  // meanings
  await page.getByRole('tab', { name: 'Words' }).click()
  await page.getByLabel('Word to look up').fill('bank')
  await page.getByRole('button', { name: 'Look up' }).click()
  await page.getByLabel('About bank').waitFor({ timeout: 60000 })
  check('word meanings load on the phone (WordNet)', (await page.getByRole('article').count()) >= 3)
  check('WordNet is credited', (await page.getByText(/WordNet 3\.0/).count()) >= 1)
  check('no online ideas tab on the phone', (await page.getByRole('tab', { name: 'Online ideas' }).count()) === 0)

  // phrase bank
  await page.getByRole('tab', { name: 'My phrases' }).click()
  await page.getByRole('button', { name: '+ Add phrase' }).click()
  await page.getByLabel('Phrase or slang word').fill('finna')
  await page.getByLabel('What it means').fill('about to; fixing to')
  await page.getByLabel(/How it sounds/).fill('finer')
  await page.getByLabel(/^Tags/).fill('slang')
  await page.getByRole('button', { name: 'Add to my phrases' }).click()
  await page.getByText('about to; fixing to').waitFor()
  check('the phrase bank saves on the phone', true)

  // offline: reopen with no connection, syllables still work (wait until the app is ready for offline use)
  await page.evaluate(() => navigator.serviceWorker.ready)
  await ctx.setOffline(true)
  await page.reload()
  await line(page, 1).waitFor({ timeout: 20000 })
  await waitMargin(1, /^4$/)
  check('with no internet, reopening still shows syllables (dictionary kept on the device)', (await margin(1)) === '4')
  await ctx.setOffline(false)

  const sw = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
  check('phone: no sideways scrolling', sw[0] <= sw[1], JSON.stringify(sw))
  check('no server was asked for anything', apiCalls.length === 0, JSON.stringify(apiCalls.slice(0, 5)))
  check('no uncaught page errors', errors.length === 0, errors.join(' | '))

  await browser.close()
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} phone rhyme/word checks passed`)
  process.exit(failed.length ? 1 : 0)
})().catch(async (e) => {
  if (CURRENT) console.error('PAGE TEXT:', ((await CURRENT.locator('body').innerText({ timeout: 2000 }).catch(() => '(unreadable)')) || '').replace(/\s+/g, ' ').slice(0, 900))
  console.error('PHONE WORDS E2E CRASHED:', e.message.split('\n')[0], '\n', (e.stack || '').split('\n').filter((l) => l.includes('phone_words.cjs')).slice(0, 3).join('\n'))
  process.exit(2)
})
