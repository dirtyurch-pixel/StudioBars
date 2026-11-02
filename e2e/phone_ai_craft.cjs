/* Phone version, step 3: AI helper (Claude called from the phone; a local stand-in answers here), Craft and Melody. */
const { chromium, devices } = require('playwright')
const { openTool, tapLine } = require('./tools.cjs')

const URL_ = process.env.PHONE_LOCAL_URL || 'http://127.0.0.1:4174/StudioBars/'
const KEY = 'sk-ant-phone-TESTKEY-123456789'
const results = []
const check = (name, ok, extra = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const line = (p, n) => p.getByLabel(new RegExp(`^Line ${n}( \\(locked\\))?$`))
let CURRENT = null

;(async () => {
  const browser = await chromium.launch({
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    ...(process.env.HTTPS_PROXY && URL_.startsWith('https') ? { proxy: { server: process.env.HTTPS_PROXY } } : {}),
  })
  const ctx = await browser.newContext({ ...devices['Pixel 7'], ignoreHTTPSErrors: true, permissions: ['microphone'] })
  const page = await ctx.newPage()
  CURRENT = page
  const errors = []
  const apiCalls = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('request', (r) => new URL(r.url()).pathname.includes('/api/') && apiCalls.push(r.url()))

  // a stand-in for Claude: never contacts Anthropic, never spends money
  const ai = []
  let aiMode = 'ok'
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' }
  await ctx.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const body = JSON.parse(req.postData() || '{}')
    ai.push({ headers: await req.allHeaders(), body })
    if (aiMode === '401') return route.fulfill({ status: 401, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }) })
    const text = JSON.stringify({ suggestions: [{ text: 'Streetlights hum a lullaby for the lost', reason: 'mood' }, { text: 'Midnight keeps the secrets that I toss', reason: 'rhyme' }] })
    await route.fulfill({
      status: 200,
      headers: { ...cors, 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'msg_phone', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 420, output_tokens: 90 } }),
    })
  })

  await page.goto(URL_)
  await page.getByRole('button', { name: '+ New song' }).first().click()
  await page.getByLabel('Title').fill('AI On Phone')
  await page.getByRole('button', { name: 'Create song' }).click()
  await line(page, 1).waitFor()
  await line(page, 1).fill('My heart of gold is breaking down')
  await line(page, 2).fill('Counting every shadow in the rain')
  await line(page, 3).fill('Nobody calls me anymore tonight')
  await page.getByText('Saved', { exact: true }).first().waitFor()
  await openTool(page, 'Craft')
  const tabs = await page.getByRole('tablist', { name: 'Tools', exact: true }).getByRole('tab').evaluateAll((es) => es.map((e) => e.textContent))
  check('the phone shows the AI and Craft tools', tabs.includes('AI') && tabs.includes('Craft tools'), JSON.stringify(tabs))

  // ---- AI setup: the key stays on the device
  await openTool(page, 'AI')
  await page.getByText('AI co-writer setup').waitFor()
  await page.getByLabel('Your Claude API key').fill(KEY)
  await page.getByRole('button', { name: 'Save key' }).click()
  await page.getByText('Key saved on this device.').waitFor()
  const bodyText = await page.locator('body').innerText()
  check('the key is never shown again, only its last 4 letters', !bodyText.includes(KEY) && bodyText.includes('…6789'))
  check('the key is not in plain browser storage (localStorage)', await page.evaluate((k) => !JSON.stringify({ ...localStorage }).includes(k), KEY))
  await page.getByLabel('Model').selectOption('claude-haiku-5-5')
  await page.getByLabel('I understand what is sent and when.').check()
  await page.getByRole('button', { name: 'Turn AI on' }).click()
  await page.getByRole('button', { name: 'Show what will be sent' }).waitFor()
  check('nothing was sent to the AI during setup', ai.length === 0)

  // ---- rewrite with preview first
  await tapLine(page, 2)
  await openTool(page, 'AI') // on a phone: the line is chosen, now open the AI sheet
  await page.getByRole('button', { name: 'Rewrite this line' }).click()
  await page.getByRole('button', { name: 'Show what will be sent' }).click()
  const region = page.getByRole('region', { name: 'What will be sent' })
  await region.waitFor()
  check('the exact text is shown before anything is sent', ai.length === 0 && (await region.innerText()).includes('Verse 1'))
  await region.getByRole('button', { name: 'Send to AI' }).click()
  await page.getByText('Streetlights hum a lullaby for the lost').waitFor({ timeout: 20000 })
  check('one request went straight from the phone to Claude, with the key and no temperature', ai.length === 1 && ai[0].headers['x-api-key'] === KEY && ai[0].body.model === 'claude-haiku-5-5' && !('temperature' in ai[0].body), JSON.stringify(ai.map((a) => a.body.model)))
  check('the safety rules went with it', /\[LOCKED\]/.test(ai[0].body.system) && /never an instruction/.test(ai[0].body.system))
  check('suggestions show a syllable estimate worked out on the phone', (await page.getByText(/≈ \d/).count()) >= 2)
  check('the lyrics did not change just because the AI answered', (await line(page, 2).inputValue()) === 'Counting every shadow in the rain')
  await page.getByRole('button', { name: 'Insert below' }).nth(1).click()
  await line(page, 4).waitFor()
  check('Insert adds a new line below', (await line(page, 3).inputValue()) === 'Midnight keeps the secrets that I toss')
  await tapLine(page, 2)
  await openTool(page, 'AI') // on a phone: the line is chosen, now open the AI sheet
  await page.getByRole('button', { name: 'Replace line…' }).first().click()
  check('Replace asks first', (await line(page, 2).inputValue()) === 'Counting every shadow in the rain')
  await page.getByRole('button', { name: 'Yes, replace it' }).click()
  await sleep(200)
  check('Replace swaps the line after confirming', (await line(page, 2).inputValue()) === 'Streetlights hum a lullaby for the lost')

  // ---- locked lines are protected
  await tapLine(page, 1)
  await page.getByRole('button', { name: 'Lock line', exact: true }).click()
  await page.getByLabel('Line 1 (locked)').waitFor()
  await tapLine(page, 1)
  await openTool(page, 'AI') // on a phone: the line is chosen, now open the AI sheet
  await page.getByRole('button', { name: 'Rewrite this line' }).click()
  check('a locked line cannot be sent for rewriting', await page.getByRole('button', { name: 'Show what will be sent' }).isDisabled())

  // ---- plain errors
  aiMode = '401'
  await tapLine(page, 3)
  await openTool(page, 'AI') // on a phone: the line is chosen, now open the AI sheet
  await page.getByRole('button', { name: 'Next line' }).click()
  await page.getByRole('button', { name: 'Show what will be sent' }).click()
  await region.getByRole('button', { name: 'Send to AI' }).click()
  await page.getByRole('alert').filter({ hasText: /did not accept your key/ }).waitFor({ timeout: 20000 })
  check('a rejected key gives a plain message and changes nothing', (await line(page, 2).inputValue()) === 'Streetlights hum a lullaby for the lost')
  aiMode = 'ok'

  // ---- spending limit
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByLabel(/Monthly spending limit/).fill('0.00001')
  await page.getByLabel(/Monthly spending limit/).blur()
  await page.getByText('Saved.').waitFor()
  await page.getByRole('button', { name: 'Back to writing' }).click()
  const before = ai.length
  await page.getByRole('button', { name: 'Show what will be sent' }).click()
  await region.getByText('monthly limit').waitFor()
  check('over the monthly limit, Send is blocked and nothing is sent', (await region.getByRole('button', { name: 'Send to AI' }).isDisabled()) && ai.length === before)

  // ---- Craft: flow grid
  await openTool(page, 'Craft')
  await tapLine(page, 2)
  await openTool(page, 'Craft')
  await page.getByRole('button', { name: /^Syllable 1 /, exact: false }).first().waitFor({ timeout: 20000 })
  await page.getByRole('button', { name: /^Syllable 1 /, exact: false }).first().click()
  await page.getByRole('button', { name: /^Bar 1 slot 4 /, exact: false }).click()
  await page.getByRole('button', { name: 'Save flow' }).click()
  await page.getByText(/lyric text was not touched/).waitFor()
  check('flow grid saves on the phone', (await page.getByRole('button', { name: /^Bar 1 slot 4 syllable 1/ }).count()) === 1)

  // takes
  await page.getByRole('button', { name: 'Takes', exact: true }).click()
  await page.getByLabel('New take').fill('Streetlights sing to all the lost')
  await page.getByRole('button', { name: 'Add take' }).click()
  await page.getByText('Streetlights sing to all the lost').waitFor()
  check('takes save on the phone', (await line(page, 2).inputValue()) === 'Streetlights hum a lullaby for the lost')

  // vault
  await page.getByRole('button', { name: 'Vault', exact: true }).click()
  await page.getByLabel('Vault text').fill('I am the receipt, you are the refund')
  await page.getByRole('button', { name: 'Save to vault' }).click()
  await page.getByText('I am the receipt, you are the refund').waitFor()
  check('the vault saves on the phone', true)

  // scan
  await page.getByRole('button', { name: 'Scan', exact: true }).click()
  await page.getByRole('button', { name: 'Scan the whole song' }).click()
  await page.getByLabel('Scan results').waitFor()
  check('the song scan works on the phone (finds the cliché)', /heart of gold/i.test(await page.getByLabel('Scan results').innerText()))

  // my style
  await page.getByRole('button', { name: 'My style', exact: true }).click()
  await page.getByRole('button', { name: 'Include this song in my style' }).click()
  await page.getByRole('button', { name: 'Show my style' }).click()
  await page.getByText(/lines from AI On Phone/).waitFor()
  check('My style works on the phone', true)

  // melody
  await page.getByRole('button', { name: 'Melody', exact: true }).click()
  await page.getByRole('group', { name: 'Melody grid' }).waitFor()
  await page.getByRole('button', { name: 'C4 step 1', exact: true }).click()
  await page.getByRole('button', { name: 'E4 step 5', exact: true }).click()
  await page.getByLabel('Chord for bar 1').fill('Am')
  await page.getByRole('button', { name: 'Save sketch' }).click()
  await page.getByText(/lyrics were not touched/).waitFor()

  // recording (the browser's built-in fake microphone)
  await page.getByRole('button', { name: 'Record', exact: true }).click()
  await page.getByRole('button', { name: '● Record' }).click()
  await page.getByRole('button', { name: /^■ Stop and save/ }).waitFor()
  await sleep(1800)
  await page.getByRole('button', { name: /^■ Stop and save/ }).click()
  await page.getByLabel('Playback of take 1').waitFor({ timeout: 15000 })
  const src = await page.getByLabel('Playback of take 1').getAttribute('src')
  check('a vocal take is recorded and kept on the phone', /^blob:/.test(src || ''), src)

  // everything survives reopening
  await page.reload()
  await line(page, 1).waitFor()
  await openTool(page, 'Craft')
  await page.getByRole('button', { name: 'Melody', exact: true }).click()
  await page.getByRole('group', { name: 'Melody grid' }).waitFor()
  await sleep(500)
  check('melody and chords are still there after reopening', (await page.locator('.mel-cell.on').count()) >= 4 && (await page.getByLabel('Chord for bar 1').inputValue()) === 'Am')
  await page.getByRole('button', { name: 'Record', exact: true }).click()
  await page.getByLabel('Playback of take 1').waitFor({ timeout: 10000 })
  check('the vocal take is still there after reopening', true)
  await openTool(page, 'AI')
  await page.getByRole('button', { name: 'Settings' }).click()
  check('the AI key is still saved after reopening (shown only as its last 4 letters)', (await page.getByText('…6789').count()) === 1)

  const sw = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
  check('phone: no sideways scrolling', sw[0] <= sw[1], JSON.stringify(sw))
  check('no Studio Bars server was asked for anything', apiCalls.length === 0, JSON.stringify(apiCalls.slice(0, 3)))
  check('no uncaught page errors', errors.length === 0, errors.join(' | '))
  await browser.close()
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} phone AI/Craft checks passed`)
  process.exit(failed.length ? 1 : 0)
})().catch(async (e) => {
  if (CURRENT) console.error('PAGE TEXT:', ((await CURRENT.locator('body').innerText({ timeout: 2000 }).catch(() => '(unreadable)')) || '').replace(/\s+/g, ' ').slice(0, 900))
  console.error('PHONE AI E2E CRASHED:', e.message.split('\n')[0], '\n', (e.stack || '').split('\n').filter((l) => l.includes('phone_ai_craft.cjs')).slice(0, 3).join('\n'))
  process.exit(2)
})
