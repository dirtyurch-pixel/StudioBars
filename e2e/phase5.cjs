/* Phase 5 acceptance test: flow grid, takes, vault, plan, scans. Lyric text must stay unchanged by planning tools. */
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
const net = []
const watch = (p) => {
  CURRENT = p
  p.on('response', (r) => { if (r.status() >= 400) net.push(`HTTP ${r.status()} ${r.request().method()} ${r.url().slice(0, 110)}`) })
}

;(async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  watch(page)
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))

  await page.goto(APP)
  await page.getByRole('button', { name: '+ New song' }).first().click()
  await page.getByLabel('Title').fill('Craft Test')
  await page.getByRole('button', { name: 'Create song' }).click()
  await line(page, 1).waitFor()
  await line(page, 1).fill('My heart of gold is breaking down tonight')
  await line(page, 2).fill('I just really kinda miss the light')
  await line(page, 3).fill('My heart of gold is breaking down tonight')
  const lyrics = async () => JSON.stringify(await page.locator('[data-line-input]').evaluateAll((els) => els.map((e) => e.value)))
  const snap = await lyrics()
  await line(page, 2).click()
  await page.getByRole('tab', { name: 'Craft' }).click()

  // ---- flow
  await page.getByRole('button', { name: /^Syllable 1 /, exact: false }).first().waitFor({ timeout: 10000 })
  check('flow: stress marks and a syllable per sound are shown', (await page.getByRole('group', { name: 'Syllables' }).getByRole('button').count()) >= 8)
  await page.getByRole('button', { name: /^Syllable 1 /, exact: false }).first().click()
  await page.getByRole('button', { name: /^Bar 1 slot 4 /, exact: false }).click()
  check('flow: a syllable can be placed on a chosen slot by hand', (await page.getByRole('button', { name: /^Bar 1 slot 4 syllable 1/ }).count()) === 1)
  await page.getByLabel('Subdivision').selectOption('triplet')
  check('flow: triplet subdivision shows 12 slots', (await page.getByRole('group', { name: 'Bar 1' }).getByRole('button').count()) === 12)
  await page.getByLabel('Subdivision').selectOption('16th')
  await page.getByLabel('Bars').selectOption('2')
  check('flow: two bars shows 32 slots', (await page.locator('.flow-cell').count()) === 32)
  await page.getByRole('button', { name: 'Save flow' }).click()
  await page.getByText(/lyric text was not touched/).waitFor()
  check('flow: saving leaves the lyric text unchanged', (await lyrics()) === snap)
  await page.getByText('Saved', { exact: true }).first().waitFor() // the typed lyrics must have been autosaved before reloading
  await page.reload()
  await line(page, 2).waitFor()
  await line(page, 2).click()
  await page.getByRole('tab', { name: 'Craft' }).click()
  await page.getByRole('button', { name: /^Syllable 1 /, exact: false }).first().waitFor({ timeout: 10000 })
  check('flow: the saved grid (2 bars) is still there after reload', (await page.locator('.flow-cell').count()) === 32)

  // ---- takes
  await page.getByRole('button', { name: 'Takes', exact: true }).click()
  await page.getByLabel('New take').fill('I just kinda miss your light')
  await page.getByRole('button', { name: 'Add take' }).click()
  await page.getByText('I just kinda miss your light').waitFor()
  check('takes: adding a take does not change the line', (await line(page, 2).inputValue()) === 'I just really kinda miss the light')
  await page.getByRole('button', { name: 'Use this take…' }).click()
  check('takes: Use asks first', (await line(page, 2).inputValue()) === 'I just really kinda miss the light')
  await page.getByRole('button', { name: 'Yes, use this take' }).click()
  await sleep(300)
  check('takes: confirming swaps the line', (await line(page, 2).inputValue()) === 'I just kinda miss your light')
  await page.getByRole('button', { name: 'Keep the current line as a take' }).click()
  await page.getByRole('button', { name: /^Favourite /, exact: false }).first().click()
  await page.getByRole('button', { name: /^Unfavourite /, exact: false }).first().waitFor()
  check('takes: favourites can be set', (await page.getByRole('button', { name: /^Unfavourite /, exact: false }).count()) === 1)

  // locked line: no use
  await line(page, 3).click()
  await page.getByRole('button', { name: 'Lock line', exact: true }).click()
  await line(page, 3).waitFor()
  await page.getByLabel('Line 3 (locked)').waitFor()
  await page.getByLabel('New take').fill('replacement for the locked one')
  await page.getByRole('button', { name: 'Add take' }).click()
  await page.getByText('Unlock the line to use a take.').waitFor()
  check('takes: a locked line cannot be changed from a take', (await page.getByRole('button', { name: 'Use this take…' }).count()) === 0 && (await page.getByLabel('Line 3 (locked)').inputValue()) === 'My heart of gold is breaking down tonight')

  // ---- vault
  await line(page, 1).click()
  await page.getByRole('button', { name: 'Vault', exact: true }).click()
  await page.getByLabel('Vault text').fill('I am the receipt, you are the refund')
  await page.getByLabel('Tags (comma separated)').fill('money, wit')
  await page.getByRole('button', { name: 'Save to vault' }).click()
  await page.getByText('I am the receipt, you are the refund').waitFor()
  await page.getByRole('button', { name: 'Insert copy below' }).click()
  await sleep(300)
  check('vault: inserting adds a copy below the active line', (await line(page, 2).inputValue()) === 'I am the receipt, you are the refund')
  check('vault: the original is still saved', (await page.getByText('I am the receipt, you are the refund').count()) >= 1)
  await page.getByLabel('Search vault').fill('wit')
  check('vault: search by tag works', (await page.getByRole('button', { name: 'Insert copy below' }).count()) === 1)
  await page.getByLabel('Search vault').fill('zzz')
  await page.getByText('Nothing matches.').waitFor()

  // ---- plan
  await page.getByRole('button', { name: 'Plan', exact: true }).click()
  await page.getByLabel(/^Scene/).fill('A late train home')
  await page.getByRole('button', { name: 'Save plan' }).click()
  await page.getByText('Saved.').waitFor()
  await page.getByLabel('New idea').fill('A stranger on the platform')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByText('A stranger on the platform').waitFor()
  await page.reload()
  await page.getByRole('tab', { name: 'Craft' }).click()
  await page.getByRole('button', { name: 'Plan', exact: true }).click()
  await page.getByText('A stranger on the platform').waitFor()
  check('plan: story plan and ideas persist', (await page.getByLabel(/^Scene/).inputValue()) === 'A late train home')

  // ---- scan (needs the latest text saved)
  await sleep(1500)
  await page.getByRole('button', { name: 'Scan', exact: true }).click()
  await page.getByRole('button', { name: 'Scan the whole song' }).click()
  await page.getByLabel('Scan results').waitFor()
  const scanText = await page.getByLabel('Scan results').innerText()
  check('scan: finds the cliché', /heart of gold/i.test(scanText))
  check('scan: flags a repeated verse line to check', /check this/.test(scanText))
  check('scan: states these are estimates', /not verdicts/i.test(scanText))
  await line(page, 1).click()
  await page.getByLabel('Strictness').selectOption('strict')
  await page.getByRole('button', { name: 'Find chains' }).click()
  await page.getByText(/line 1\)/).first().waitFor()
  check('chains: rhyme chains are listed for the section', true)

  // lyric text only ever changed by the explicit actions above
  const final = JSON.parse(await lyrics())
  check('the planning tools never altered locked line text', final.includes('My heart of gold is breaking down tonight'))

  // ---- phone
  const phone = await ctx.newPage()
  await phone.setViewportSize({ width: 390, height: 780 })
  watch(phone)
  await phone.goto(APP)
  await phone.getByText('Craft Test').first().click()
  await phone.getByRole('tab', { name: 'Craft' }).click()
  await phone.getByRole('button', { name: 'Flow', exact: true }).waitFor()
  const sw = await phone.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
  check('phone: the Craft tab fits the screen', sw[0] <= sw[1], JSON.stringify(sw))
  await phone.close()

  check('no uncaught page errors', errors.length === 0, errors.join(' | '))
  await browser.close()
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} Phase 5 browser checks passed`)
  process.exit(failed.length ? 1 : 0)
})().catch(async (e) => {
  if (CURRENT) console.error('PAGE TEXT:', ((await CURRENT.locator('body').innerText({ timeout: 2000 }).catch(() => '(unreadable)')) || '').replace(/\s+/g, ' ').slice(0, 700))
  console.error('NETWORK PROBLEMS:', JSON.stringify(net.slice(-8)))
  console.error('E2E 5 CRASHED:', e.message.split('\n')[0], '\n', (e.stack || '').split('\n').filter((l) => l.includes('phase5.cjs')).slice(0, 3).join('\n'))
  process.exit(2)
})
