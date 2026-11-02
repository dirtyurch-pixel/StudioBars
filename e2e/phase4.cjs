/* Phase 4 acceptance test: AI co-writer against a LOCAL stand-in for Claude (no internet, no money). */
const { chromium } = require('playwright')
const { openTool } = require('./tools.cjs')

const APP = process.env.APP_URL || 'http://localhost:5173'
const FAKE = process.env.FAKE_AI || 'http://127.0.0.1:8766'
const KEY = 'sk-ant-e2e-SECRETKEY-987654321'
const results = []
const check = (name, ok, extra = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const line = (p, n) => p.getByLabel(new RegExp(`^Line ${n}( \\(locked\\))?$`))
const fake = async (path) => (await fetch(FAKE + path)).json()
const fakeLog = () => fake('/__log')

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
  const aiBodies = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('request', (r) => { try { const u = new URL(r.url()); if (/^https?:$/.test(u.protocol)) hosts.add(u.hostname) } catch {} })
  page.on('response', async (r) => { if (r.url().includes('/api/ai/')) aiBodies.push(await r.text().catch(() => '')) })
  await fake('/__reset')

  await page.goto(APP)
  await page.getByRole('button', { name: '+ New song' }).first().click()
  await page.getByLabel('Title').fill('AI Test')
  await page.getByRole('button', { name: 'Create song' }).click()
  await line(page, 1).waitFor()
  await line(page, 1).fill('I walk alone beneath the city lights')
  await line(page, 2).fill('Counting every shadow in the rain')
  await line(page, 3).fill('Nobody calls me anymore tonight')

  // ---- setup
  await openTool(page, 'AI')
  await page.getByText('AI co-writer setup').waitFor()
  check('AI is off until the writer sets it up', await page.getByRole('button', { name: 'Show what will be sent' }).count() === 0)
  await page.getByLabel('Your Claude API key').fill(KEY)
  await page.getByRole('button', { name: 'Save key' }).click()
  await page.getByText('Key saved on this computer.').waitFor()
  const body1 = await page.locator('body').innerText()
  check('the key is never shown again, only its last 4 letters', !body1.includes(KEY) && body1.includes('…4321'))
  check('the key is not kept in browser storage', await page.evaluate((k) => !JSON.stringify({ ...localStorage }).includes(k) && !JSON.stringify({ ...sessionStorage }).includes(k), KEY))
  await page.getByLabel('Model').selectOption('claude-haiku-5-5')
  check('turning AI on needs the tick box', await page.getByRole('button', { name: 'Turn AI on' }).isDisabled())
  await page.getByLabel('I understand what is sent and when.').check()
  await page.getByRole('button', { name: 'Turn AI on' }).click()
  await page.getByRole('button', { name: 'Show what will be sent' }).waitFor()
  check('nothing has been sent to the AI yet', (await fakeLog()).length === 0)

  // ---- rewrite flow
  await line(page, 2).click()
  await page.getByRole('button', { name: 'Rewrite this line' }).click()
  await page.getByText('Working on line 2').waitFor()
  await page.getByRole('button', { name: 'Show what will be sent' }).click()
  const region = page.getByRole('region', { name: 'What will be sent' })
  await region.waitFor()
  check('the exact text is shown before anything is sent', (await region.innerText()).includes('Verse 1') && (await fakeLog()).length === 0)
  await region.getByText('See the exact text').click()
  check('preview contains the writer’s lyrics and marks the target', (await region.innerText()).includes('Counting every shadow in the rain <<TARGET>>'))
  await region.getByRole('button', { name: 'Send to AI' }).click()
  await page.getByText('Streetlights hum a lullaby for the lost').waitFor()
  let log = await fakeLog()
  check('exactly one request reached the AI, with the saved key, and no temperature', log.length === 1 && log[0].auth.includes(KEY) && !('temperature' in log[0].body), JSON.stringify(log.map((l) => [l.path, l.auth.length])))
  check('suggestions are labelled as AI and show a syllable estimate', (await page.getByText('AI suggestion', { exact: true }).count()) === 3 && (await page.getByText(/≈ \d/).count()) >= 3)
  check('the lyrics did not change just because the AI answered', (await line(page, 2).inputValue()) === 'Counting every shadow in the rain')

  // preview does not change anything
  await page.getByRole('button', { name: 'Preview' }).first().click()
  check('Preview shows old and new together', await page.getByText('Now:').isVisible())
  check('Preview changed nothing', (await line(page, 2).inputValue()) === 'Counting every shadow in the rain')

  // insert below
  await page.getByRole('button', { name: 'Insert below' }).nth(1).click()
  await line(page, 4).waitFor()
  check('Insert adds a new line below the active line', (await line(page, 3).inputValue()) === 'Midnight keeps the secrets that I toss' && (await line(page, 4).inputValue()) === 'Nobody calls me anymore tonight')
  await line(page, 3).click()
  await page.keyboard.press('Control+z')
  await sleep(300)
  check('Undo takes the inserted line back out', (await line(page, 4).count()) === 0 || (await line(page, 3).inputValue()) === 'Nobody calls me anymore tonight')

  // replace needs confirmation
  await line(page, 2).click()
  await page.getByRole('button', { name: 'Replace line…' }).first().click()
  check('Replace asks first and has not changed the line yet', (await line(page, 2).inputValue()) === 'Counting every shadow in the rain')
  await page.getByRole('button', { name: 'Yes, replace it' }).click()
  await sleep(200)
  check('Replace swaps the line after confirming', (await line(page, 2).inputValue()) === 'Streetlights hum a lullaby for the lost')

  // ---- locked lines
  await line(page, 1).click()
  await page.getByRole('button', { name: 'Lock line', exact: true }).click()
  await line(page, 1).waitFor()
  await page.getByRole('button', { name: 'Rewrite this line' }).click()
  await page.getByText(/locked/).first().waitFor()
  const before = (await fakeLog()).length
  check('a locked line cannot be sent for rewriting', await page.getByRole('button', { name: 'Show what will be sent' }).isDisabled() && (await fakeLog()).length === before)
  await page.getByRole('button', { name: 'Next line' }).click()
  await page.getByRole('button', { name: 'Show what will be sent' }).click()
  await region.waitFor()
  await region.getByText('See the exact text').click()
  check('locked lines are marked read-only for the AI', (await region.innerText()).includes('[LOCKED]'))
  await region.getByRole('button', { name: 'Send to AI' }).click()
  await page.getByRole('button', { name: 'Insert below' }).first().waitFor()
  await page.getByRole('button', { name: 'Insert below' }).first().click()
  check('the locked line is untouched after the AI works around it', (await page.getByLabel('Line 1 (locked)').inputValue()) === 'I walk alone beneath the city lights')

  // ---- failures keep the lyrics
  const lyrics = async () => JSON.stringify(await page.locator('[data-line-input]').evaluateAll((els) => els.map((e) => e.value)))
  const snap = await lyrics()
  for (const [mode, expect] of [['bad', /could not be used|Nothing was changed/], ['down', /having trouble|Nothing was changed/], ['refuse', /declined/]]) {
    await fake(`/__mode?m=${mode}`)
    await page.getByRole('button', { name: 'Show what will be sent' }).click()
    await region.waitFor()
    await region.getByRole('button', { name: 'Send to AI' }).click()
    const alert = page.getByRole('alert')
    await alert.first().waitFor({ timeout: 20000 })
    check(`AI problem (${mode}) gives a plain message and changes nothing`, expect.test(await alert.first().innerText()) && (await lyrics()) === snap, await alert.first().innerText())
    await fake('/__mode?m=ok')
    await page.getByRole('button', { name: 'Show what will be sent' }).waitFor()
  }

  // ---- spending limit
  await page.getByRole('button', { name: 'Settings' }).click()
  const cap = page.getByLabel(/Monthly spending limit/)
  await cap.fill('0.00001')
  await cap.blur()
  await page.getByText('Saved.').waitFor()
  await page.getByRole('button', { name: 'Back to writing' }).click()
  const n = (await fakeLog()).length
  await page.getByRole('button', { name: 'Show what will be sent' }).click()
  await region.getByText('monthly limit').waitFor()
  check('over the monthly limit: Send is blocked', await region.getByRole('button', { name: 'Send to AI' }).isDisabled() && (await region.innerText()).includes('monthly limit'))
  check('nothing was sent while over the limit', (await fakeLog()).length === n)

  // ---- phone
  const phone = await ctx.newPage()
  await phone.setViewportSize({ width: 390, height: 780 })
  watch(phone)
  await phone.goto(APP)
  await phone.getByText('AI Test').first().click()
  await openTool(phone, 'AI')
  await phone.getByRole('button', { name: 'Settings' }).waitFor()
  const sw = await phone.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
  check('phone: the AI tab fits the screen', sw[0] <= sw[1], JSON.stringify(sw))
  await phone.close()

  check('the key never appeared in any answer from the server', aiBodies.length > 0 && aiBodies.every((b) => !b.includes(KEY)))
  const external = [...hosts].filter((h) => !['localhost', '127.0.0.1'].includes(h))
  check('the browser itself never contacted the AI or anything but this computer', external.length === 0, JSON.stringify(external))
  check('no uncaught page errors', errors.length === 0, errors.join(' | '))

  await browser.close()
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} Phase 4 browser checks passed`)
  process.exit(failed.length ? 1 : 0)
})().catch(async (e) => {
  await dump()
  console.error('E2E 4 CRASHED:', e.message.split('\n')[0], '\n', (e.stack || '').split('\n').filter((l) => l.includes('phase4.cjs')).slice(0, 3).join('\n'))
  process.exit(2)
})
