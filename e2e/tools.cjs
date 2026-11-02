/* Opening a tool in the song editor: tools are grouped (Write, Words, Craft, More) since Design A. */
const WHERE = {
  Notes: ['Write'],
  Rhymes: ['Words', 'Rhymes'],
  Words: ['Words', 'Dictionary'],
  AI: ['Craft', 'AI'],
  Craft: ['Craft', 'Craft tools'],
  Music: ['More', 'Music'],
  History: ['More', 'History'],
  Export: ['More', 'Export'],
}
async function openTool(page, name) {
  const [group, sub] = WHERE[name]
  // on a phone, while a lyric line has the keyboard the tools step aside: tap Done first, like a person would
  if (await page.evaluate(() => !!document.documentElement.dataset.writing)) {
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await page.waitForFunction(() => !document.documentElement.dataset.writing)
  }
  await page.getByRole('tablist', { name: 'Tool groups' }).getByRole('tab', { name: group, exact: true }).click()
  if (sub) await page.getByRole('tablist', { name: 'Tools', exact: true }).getByRole('tab', { name: sub, exact: true }).click()
}
/** Tap a lyric line the way a person would on a phone: close the tool sheet first if it covers the page. */
async function tapLine(page, n) {
  const close = page.getByRole('button', { name: 'Close tools' })
  if (await close.isVisible().catch(() => false)) await close.click()
  await page.getByLabel(new RegExp(`^Line ${n}( \\(locked\\))?$`)).click()
}
module.exports = { openTool, tapLine }
