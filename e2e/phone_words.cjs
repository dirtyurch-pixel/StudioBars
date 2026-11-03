/* Phone version, step 2: syllables, rhyme colours, rhymes, word meanings and the phrase bank, all on the device. */
const { chromium, devices } = require('playwright')
const { openTool } = require('./tools.cjs')

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
  // a stand-in for Datamuse, so the test never contacts the real service
  const dm = []
  let dmDown = false
  await ctx.route('https://api.datamuse.com/**', async (route) => {
    const u = new URL(route.request().url())
    dm.push({ path: u.pathname + u.search, headers: Object.keys(await route.request().allHeaders()) })
    if (dmDown) return route.fulfill({ status: 503, body: 'down' })
    const q = Object.fromEntries(u.searchParams)
    const body = u.pathname === '/sug' ? [{ word: 'umbrella', score: 9 }, { word: 'umber', score: 5 }]
      : q.ml ? [{ word: 'money', score: 100 }, { word: 'river', score: 90 }]
      : q.sl ? [{ word: 'banc', score: 50 }, { word: 'bang', score: 40 }]
      : q.rel_trg ? [{ word: 'account', score: 80 }]
      : [{ word: 'thank', score: 70 }]
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) })
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

  // the rhyme strip: rhymes for the line above appear by themselves on the next line
  await line(page, 3).click()
  const strip = page.getByRole('group', { name: /^Rhymes for/ })
  await strip.getByRole('button').first().waitFor({ timeout: 20000 })
  const stripName = await strip.getAttribute('aria-label')
  const stripWords = await strip.getByRole('button').allInnerTexts()
  check('moving to the next line shows rhymes for the line above, without pressing anything', stripName === 'Rhymes for shade' && stripWords.includes('made'), JSON.stringify([stripName, stripWords.slice(0, 8)]))
  const before3 = await line(page, 3).inputValue()
  await strip.getByRole('button', { name: 'made', exact: true }).click()
  check('tapping a rhyme adds it to the line and keeps typing going', (await line(page, 3).inputValue()).endsWith('made') && (await page.evaluate(() => document.activeElement?.matches('[data-line-input]'))), await line(page, 3).inputValue())
  await line(page, 3).fill(before3)

  // rhymes
  // on a phone: tap the line, then Rhymes in its toolbar (looks up the line's last word)
  await line(page, 2).click()
  await page.getByRole('button', { name: 'Rhymes', exact: true }).click()
  await page.getByRole('region', { name: /syllable/ }).first().waitFor({ timeout: 20000 })
  const words = await page.locator('.chip-word').allInnerTexts()
  check('rhymes for "shade" include made, grade and fade', ['made', 'grade', 'fade'].every((w) => words.some((x) => x.startsWith(w))), JSON.stringify(words.slice(0, 15)))
  check('rhymes are about sound: "said" is not offered', !words.some((x) => x.startsWith('said')))
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
  await openTool(page, 'Words')
  await page.getByLabel('Word to look up').fill('bank')
  await page.getByRole('button', { name: 'Look up' }).click()
  await page.getByLabel('About bank').waitFor({ timeout: 60000 })
  check('word meanings load on the phone (WordNet)', (await page.getByRole('article').count()) >= 3)
  check('WordNet is credited', (await page.getByText(/WordNet 3\.0/).count()) >= 1)

  // optional online helper (Datamuse): off by default, one word only, saved answers, autocomplete
  check('nothing was sent to the online service while it is off', dm.length === 0, JSON.stringify(dm))
  await page.getByRole('tab', { name: 'Online ideas' }).click()
  const box = page.getByRole('checkbox', { name: /Use the online word helper/ })
  await box.waitFor()
  check('online helper is OFF by default on the phone', !(await box.isChecked()))
  check('it warns about the API key needed from 1 February 2027', await page.getByText(/API key will be required from 1 February 2027/).isVisible())
  await box.click()
  const res = page.getByLabel('Online results')
  await res.getByText('money').waitFor({ timeout: 10000 })
  check('after switching on, online results appear', /Only the word “bank” was sent/.test(await res.innerText()))
  check('exactly one request, with only the word, and no cookies', dm.length === 1 && dm[0].path === '/words?ml=bank&max=30' && !dm[0].headers.includes('cookie'), JSON.stringify(dm))
  await page.getByRole('button', { name: 'Sounds like' }).click()
  await res.getByText('banc').waitFor({ timeout: 10000 })
  check('"Sounds like" asks Datamuse for words that sound alike', dm.some((d) => d.path === '/words?sl=bank&max=30'))
  await page.getByRole('button', { name: 'Related words' }).click()
  await res.getByText('money').waitFor()
  check('going back uses the saved answer (no new request)', dm.filter((d) => d.path.startsWith('/words?ml=bank')).length === 1)
  // autocomplete: only while typing in the box, after a pause, and saved
  const before = dm.length
  const input = page.getByLabel('Word to look up')
  await input.fill('')
  await input.pressSequentially('umbr', { delay: 40 })
  await page.waitForFunction(() => [...document.querySelectorAll('#words-word-sug option')].some((o) => o.value === 'umbrella'), null, { timeout: 5000 })
  const sugs = dm.slice(before).filter((d) => d.path.startsWith('/sug'))
  check('autocomplete suggests words while typing (one request after a pause, not one per letter)', sugs.length === 1 && sugs[0].path === '/sug?s=umbr&max=8', JSON.stringify(sugs))
  // the service is down: plain message, saved answers still work
  dmDown = true
  await input.fill('cloud')
  await page.getByRole('button', { name: 'Look up' }).click()
  await page.getByRole('alert').filter({ hasText: /Cannot reach|problem|Nothing saved/ }).first().waitFor({ timeout: 10000 })
  check('when the service is down it says so plainly', true)
  await input.fill('bank')
  await page.getByRole('button', { name: 'Look up' }).click()
  await res.getByText('money').waitFor({ timeout: 10000 })
  check('a saved word still works while the service is down', true)
  dmDown = false
  await page.getByRole('checkbox', { name: /Use the online word helper/ }).click()
  await page.waitForFunction(() => !document.querySelector('.online-switch input[type=checkbox]').checked)
  const afterOff = dm.length
  await page.getByRole('tab', { name: 'Meanings' }).click()
  await input.fill('storm')
  await page.getByRole('button', { name: 'Look up' }).click()
  await page.getByLabel('About storm').waitFor({ timeout: 30000 })
  check('after switching off, nothing more is sent', dm.length === afterOff)

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
  check('the online service was only contacted while it was switched on', dm.length === afterOff)
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
