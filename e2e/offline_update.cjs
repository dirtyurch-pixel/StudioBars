/* Phone version: offline readiness, word meanings downloaded for offline, and updates that wait for the writer. */
const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')

const URL_ = process.env.PHONE_LOCAL_URL || 'http://127.0.0.1:4174/StudioBars/'
const DIST = process.env.PHONE_DIST // the built phone files being served (this test briefly changes sw.js there)
const results = []
const check = (name, ok, extra = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`)
}
const line = (p, n) => p.getByLabel(new RegExp(`^Line ${n}( \\(locked\\))?$`))

;(async () => {
  const swPath = DIST && path.join(DIST, 'sw.js')
  const original = swPath && fs.readFileSync(swPath, 'utf8')
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  try {
    await page.goto(URL_)
    await page.evaluate(() => navigator.serviceWorker.ready)
    await page.reload()
    await page.waitForFunction(() => !!navigator.serviceWorker.controller)
    // a cache that belongs to some OTHER app on the same web address
    await page.evaluate(async () => (await caches.open('other-app-cache')).put('/other', new Response('mine')))

    await page.getByRole('button', { name: 'Settings' }).click()
    const status = page.getByRole('list', { name: 'Works offline' })
    await status.waitFor()
    await page.getByText('Rhymes and syllable counts work offline').waitFor({ timeout: 20000 })
    check('settings shows the app and the rhymes dictionary are ready offline',
      (await status.getByText('The app opens with no connection').count()) === 1)
    check('word meanings are honestly shown as not downloaded yet', (await status.getByText(/Word meanings need a connection/).count()) === 1)
    await page.getByRole('button', { name: /Download word meanings for offline/ }).click()
    await page.getByText('Word meanings work offline').waitFor({ timeout: 120000 })
    check('word meanings can be downloaded for offline use', true)

    // offline: a meaning lookup still works
    await page.getByRole('button', { name: '← My songs' }).click()
    await page.getByRole('button', { name: '+ New song' }).first().click()
    await page.getByLabel('Title').fill('Offline Song')
    await page.getByRole('button', { name: 'Create song' }).click()
    await line(page, 1).fill('first line')
    await page.getByText('Saved', { exact: true }).first().waitFor()
    await ctx.setOffline(true)
    await page.reload()
    await line(page, 1).waitFor({ timeout: 20000 })
    await page.getByRole('tab', { name: 'Words' }).click()
    await page.getByLabel('Word to look up').fill('river')
    await page.getByRole('button', { name: 'Look up' }).click()
    const got = await page.getByLabel('About river').waitFor({ timeout: 60000 }).then(() => true, () => false)
    check('with no connection, word meanings still work after downloading', got)
    await ctx.setOffline(false)

    // an update arrives: it must wait, and only switch when the writer taps Reload (after saving)
    if (!DIST) throw new Error('PHONE_DIST not set')
    fs.writeFileSync(swPath, original.replace(/const CACHE = '([^']+)'/, "const CACHE = '$1-next'"))
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update())
    await page.getByText('A new version of Studio Bars is ready.').waitFor({ timeout: 20000 })
    check('a new version shows "ready" instead of swapping by itself', true)
    const before = await page.evaluate(() => navigator.serviceWorker.controller.scriptURL)
    await line(page, 1).fill('typed right before updating')
    await page.getByRole('button', { name: 'Reload to update' }).click()
    await page.waitForEvent('load', { timeout: 20000 })
    await line(page, 1).waitFor({ timeout: 20000 })
    check('my last typing was saved before the update reloaded the page', (await line(page, 1).inputValue()) === 'typed right before updating')
    const caches_ = await page.evaluate(() => caches.keys())
    check('the update removed only Studio Bars’ old files, not another app’s',
      caches_.includes('other-app-cache') && caches_.filter((k) => k.startsWith('studio-bars-')).length === 1, JSON.stringify(caches_))
    check('the new version is running', (await page.getByText('A new version of Studio Bars is ready.').count()) === 0 && !!before)
  } finally {
    if (swPath) fs.writeFileSync(swPath, original)
  }
  check('no page errors', errors.length === 0, errors.join(' | '))
  await browser.close()
  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failed}/${results.length} offline/update checks passed`)
  process.exit(failed ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
