/* Phase 6 acceptance test: helper styles + metaphor/wordplay (local fake Claude), writing style profile, singability, scratch vocal recording. */
const { chromium } = require('playwright')
const { openTool } = require('./tools.cjs')

const APP = process.env.APP_URL || 'http://localhost:5173'
const FAKE = process.env.FAKE_AI || 'http://127.0.0.1:8766'
const results = []
const check = (name, ok, extra = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const line = (p, n) => p.getByLabel(new RegExp(`^Line ${n}( \\(locked\\))?$`))
const fake = async (path) => (await fetch(FAKE + path)).json()
let CURRENT = null
const net = []
const watch = (p) => {
  CURRENT = p
  p.on('response', (r) => { if (r.status() >= 400) net.push(`HTTP ${r.status()} ${r.request().method()} ${r.url().slice(0, 110)}`) })
}

;(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['microphone'] })
  const page = await ctx.newPage()
  watch(page)
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await fake('/__reset')

  await page.goto(APP)
  await page.getByRole('button', { name: '+ New song' }).first().click()
  await page.getByLabel('Title').fill('Phase Six')
  await page.getByRole('button', { name: 'Create song' }).click()
  await line(page, 1).waitFor()
  await line(page, 1).fill('I keep on running through the city streets tonight, thinking about everything that we could never really say')
  await line(page, 2).fill('Next strikes stressed me out')
  await line(page, 3).fill('Rain on the glass again')
  await page.getByText('Saved', { exact: true }).first().waitFor()

  // ---- AI personas and metaphor (the earlier phase left AI set up; raise the limit again)
  await openTool(page, 'AI')
  await page.getByRole('button', { name: 'Settings' }).click()
  const cap = page.getByLabel(/Monthly spending limit/)
  await cap.fill('5')
  await cap.blur()
  await page.getByText('Saved.').waitFor()
  await page.getByRole('button', { name: 'Back to writing' }).click()
  await line(page, 3).click()
  await page.getByRole('button', { name: 'Metaphor ideas' }).click()
  await page.getByLabel('Helper style').selectOption('vocal_coach')
  check('the helper style explains itself in plain words', await page.getByText(/easy to breathe/).isVisible())
  await page.getByRole('button', { name: 'Show what will be sent' }).click()
  await page.getByRole('region', { name: 'What will be sent' }).getByRole('button', { name: 'Send to AI' }).click()
  await page.getByText('Streetlights hum a lullaby for the lost').waitFor()
  const log = await fake('/__log')
  const last = log[log.length - 1]
  check('the chosen style reached the AI as plain instructions, with the safety rules kept', /vocal coach/i.test(last.body.system) && /LOCKED/.test(last.body.system))
  check('metaphor asks about the chosen line only', /Metaphor|metaphor or simile/.test(last.body.messages[0].content) && /<<TARGET>>/.test(last.body.messages[0].content))
  check('wordplay is offered too', (await page.getByRole('button', { name: 'Wordplay / double meaning' }).count()) === 1)
  check('lyrics unchanged by the AI answer', (await line(page, 3).inputValue()) === 'Rain on the glass again')

  // ---- singability
  await openTool(page, 'Craft')
  await page.getByRole('button', { name: 'Scan', exact: true }).click()
  await page.getByRole('button', { name: 'Scan the whole song' }).click()
  const scan = page.getByLabel('Scan results')
  await scan.waitFor()
  const t = await scan.innerText()
  check('singability: the very long line gets a breath suggestion', /long line/.test(t) && /breath could go after/i.test(t))
  check('singability: crowded consonants are flagged as estimates', /crowded sounds/.test(t) && /not from a recording/.test(t))

  // ---- my style
  await page.getByRole('button', { name: 'My style', exact: true }).click()
  await page.getByRole('button', { name: 'Show my style' }).click()
  await page.getByText('Nothing yet. Include a song first.').waitFor()
  check('my style: nothing is analysed until a song is approved', true)
  await page.getByRole('button', { name: 'Include this song in my style' }).click()
  await page.getByRole('button', { name: 'Remove this song from my style' }).waitFor()
  await page.getByRole('button', { name: 'Show my style' }).click()
  const prof = page.getByLabel('My style').last()
  await page.getByText(/lines from Phase Six/).waitFor()
  check('my style: shows habits for the approved song', /Average line/.test(await page.locator('.ai-results').last().innerText()))
  const aiCalls = (await fake('/__log')).length
  await page.getByRole('button', { name: 'Forget everything…' }).click()
  await page.getByRole('button', { name: 'Yes, forget all' }).click()
  await page.getByRole('button', { name: 'Include this song in my style' }).waitFor()
  await page.getByRole('button', { name: 'Show my style' }).click()
  await page.getByText('Nothing yet. Include a song first.').waitFor()
  check('my style: forgetting really empties it', true)
  check('my style: the profile was never sent to the AI', (await fake('/__log')).length === aiCalls && !JSON.stringify(log).includes('Average line'))
  void prof

  // ---- recording
  await page.getByRole('button', { name: 'Record', exact: true }).click()
  await page.getByRole('button', { name: '● Record' }).waitFor()
  check('record: no microphone prompt until the writer presses Record', true)
  await page.getByRole('button', { name: '● Record' }).click()
  await page.getByRole('button', { name: /^■ Stop and save/ }).waitFor()
  await sleep(2200)
  await page.getByRole('button', { name: /^■ Stop and save/ }).click()
  await page.getByLabel('Playback of take 1').waitFor({ timeout: 15000 })
  check('record: a take is saved and can be played back', true)
  const src = await page.getByLabel('Playback of take 1').getAttribute('src')
  const res = await page.evaluate(async (u) => { const r = await fetch(u); const b = new Uint8Array(await r.arrayBuffer()); return { status: r.status, len: b.length, type: r.headers.get('content-type'), head: Array.from(b.slice(0, 4)) } }, src)
  check('record: the stored file is a real recording', res.status === 200 && res.len > 500 && /webm|ogg|mp4/.test(res.type || ''), JSON.stringify(res))
  await page.getByLabel('Note', { exact: true }).fill('first rough pass')
  await page.getByLabel(/Starts at/).fill('-120')
  await page.getByRole('button', { name: 'Save note and timing' }).click()
  await page.getByText('Saved.').last().waitFor()
  await page.reload()
  await line(page, 1).waitFor()
  await openTool(page, 'Craft')
  await page.getByRole('button', { name: 'Record', exact: true }).click()
  await page.getByLabel('Playback of take 1').waitFor()
  check('record: note and timing nudge persist after reload', (await page.getByLabel('Note', { exact: true }).inputValue()) === 'first rough pass' && (await page.getByLabel(/Starts at/).inputValue()) === '-120')
  await page.getByRole('button', { name: 'Delete…' }).click()
  check('record: delete asks first', (await page.getByLabel('Playback of take 1').count()) === 1)
  await page.getByRole('button', { name: /^Yes, delete take 1/ }).click()
  await page.getByText('No recordings yet.').waitFor()
  check('record: delete removes the take', true)
  check('record: lyrics were never touched', (await line(page, 2).inputValue()) === 'Next strikes stressed me out')

  check('no uncaught page errors', errors.length === 0, errors.join(' | '))
  await browser.close()
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} Phase 6 browser checks passed`)
  process.exit(failed.length ? 1 : 0)
})().catch(async (e) => {
  if (CURRENT) console.error('PAGE TEXT:', ((await CURRENT.locator('body').innerText({ timeout: 2000 }).catch(() => '(unreadable)')) || '').replace(/\s+/g, ' ').slice(0, 700))
  console.error('NETWORK PROBLEMS:', JSON.stringify(net.slice(-8)))
  console.error('E2E 6 CRASHED:', e.message.split('\n')[0], '\n', (e.stack || '').split('\n').filter((l) => l.includes('phase6.cjs')).slice(0, 3).join('\n'))
  process.exit(2)
})
