/* The Settings page: reachable from the home screen, holds AI, online helper, player and (phone) storage settings. */
const { chromium, devices } = require('playwright')

const APP = process.env.APP_URL || 'http://localhost:5173'
const PHONE_BUILD = APP.includes('/StudioBars/')
const results = []
const check = (name, ok, extra = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`)
}

;(async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext(process.env.PHONE ? { ...devices['Pixel 7'] } : { viewport: { width: 1200, height: 900 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))

  await page.goto(APP)
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('heading', { name: 'AI co-writer' }).waitFor()
  check('the home screen has a Settings button that opens the settings page', page.url().endsWith('#/settings'))
  await page.getByLabel('AI setup').waitFor()
  check('AI setup is on the settings page (key box and spending limit)',
    (await page.getByLabel('Your Claude API key').count()) === 1 && (await page.getByText(/Monthly spending limit/).count()) === 1)
  check('the online word helper switch is there', (await page.getByText(/Use the online word helper/).count()) === 1)
  check('storage and backups show only on the phone version',
    (await page.getByRole('heading', { name: 'Storage and backups' }).count()) === (PHONE_BUILD ? 1 : 0))
  if (PHONE_BUILD) check('backup buttons are on the settings page', (await page.getByRole('button', { name: 'Back up all songs' }).count()) === 1)

  const box = page.getByLabel('Show the waveform and beat markers in the player')
  const before = await box.isChecked()
  await box.setChecked(!before)
  await page.reload()
  await page.getByLabel('Show the waveform and beat markers in the player').waitFor()
  check('the waveform setting is remembered', (await page.getByLabel('Show the waveform and beat markers in the player').isChecked()) === !before)

  await page.getByRole('button', { name: '← My songs' }).click()
  await page.getByText('My songs').first().waitFor()
  check('back to my songs', !page.url().includes('settings'))
  check('no page errors', errors.length === 0, errors.join(' | '))
  await browser.close()
  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failed}/${results.length} passed`)
  process.exit(failed ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
