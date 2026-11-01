/* Phone / tablet mode: the app served from ONE address by the backend, locked with a PIN, installable. */
const { chromium, devices } = require('playwright')

const URL_ = process.env.PHONE_URL || 'http://127.0.0.1:8100'
const PIN = '246810'
const results = []
const check = (name, ok, extra = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`)
}
let CURRENT = null

;(async () => {
  const browser = await chromium.launch()
  // a phone-sized, touch device
  const ctx = await browser.newContext({ ...devices['Pixel 7'] })
  const page = await ctx.newPage()
  CURRENT = page
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))

  await page.goto(URL_)
  await page.getByLabel('PIN', { exact: true }).waitFor()
  check('without the PIN the app shows only a PIN screen', (await page.getByText('My songs').count()) === 0)
  const api = await page.evaluate(() => fetch('/api/songs').then((r) => r.status))
  check('without the PIN the lyrics API refuses (401)', api === 401, String(api))

  await page.getByLabel('PIN', { exact: true }).fill('111111')
  await page.getByRole('button', { name: 'Open' }).click()
  await page.getByRole('alert').waitFor()
  check('a wrong PIN is refused with a plain message', /not right/.test(await page.getByRole('alert').innerText()))

  await page.getByLabel('PIN', { exact: true }).fill(PIN)
  await page.getByRole('button', { name: 'Open' }).click()
  await page.getByRole('button', { name: '+ New song' }).first().waitFor()
  check('the right PIN opens the app', true)

  await page.getByRole('button', { name: '+ New song' }).first().click()
  await page.getByLabel('Title').fill('Phone Song')
  await page.getByRole('button', { name: 'Create song' }).click()
  await page.getByLabel(/^Line 1/).waitFor()
  await page.getByLabel(/^Line 1/).fill('Typing this from a phone')
  await page.waitForTimeout(1500)
  await page.reload()
  await page.getByLabel(/^Line 1/).waitFor()
  check('a song written on the phone saves and reloads (cookie sign-in persisted)', (await page.getByLabel(/^Line 1/).inputValue()) === 'Typing this from a phone')

  const sw = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
  check('phone: the editor fits the screen', sw[0] <= sw[1], JSON.stringify(sw))

  const man = await page.evaluate(() => fetch('/manifest.webmanifest').then((r) => r.json()))
  check('the app can be installed (name, icons, standalone)', man.display === 'standalone' && man.icons.length >= 2 && man.name === 'Studio Bars')
  const icon = await page.evaluate(() => fetch('/icon-192.png').then((r) => r.status))
  check('install icon is served without needing the PIN', icon === 200)

  const traversal = await page.evaluate(() => fetch('/..%2f..%2fetc/passwd').then((r) => r.text()))
  check('the web server cannot be tricked into reading other files', !traversal.includes('root:'))

  // tablet size
  await page.setViewportSize({ width: 820, height: 1180 })
  await page.getByLabel(/^Line 1/).waitFor()
  const tw = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
  check('tablet: the editor fits the screen', tw[0] <= tw[1], JSON.stringify(tw))

  check('no uncaught page errors', errors.length === 0, errors.join(' | '))
  await browser.close()
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} phone-mode browser checks passed`)
  process.exit(failed.length ? 1 : 0)
})().catch(async (e) => {
  if (CURRENT) console.error('PAGE TEXT:', ((await CURRENT.locator('body').innerText({ timeout: 2000 }).catch(() => '(unreadable)')) || '').replace(/\s+/g, ' ').slice(0, 600))
  console.error('E2E 7 CRASHED:', e.message.split('\n')[0])
  process.exit(2)
})
