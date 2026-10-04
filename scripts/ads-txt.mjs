/**
 * Refresh public/ads.txt from Ezoic's Ads.txt Manager before each build.
 *
 * Ezoic keeps the full seller list (its partners plus our AdSense row, added
 * in the Ezoic dashboard under Ad Transparency -> Ads.txt). The data job
 * builds every 6 hours, so the file never goes more than 6 hours stale.
 *
 * The file is replaced only when the manager answers with a real list that
 * still holds our AdSense row. A 404 (the domain not set up there yet), a
 * network error or an odd answer keeps the file we already have, so a bad
 * fetch can never leave the site without an ads.txt.
 */
import { readFile, writeFile } from 'node:fs/promises'

const SOURCE = 'https://srv.adstxtmanager.com/19390/manhwaindex.com'
const FILE = new URL('../public/ads.txt', import.meta.url)
const ADSENSE = 'pub-2789392733984505'
const MIN_LINES = 10

async function fetchList() {
  try {
    const res = await fetch(SOURCE, { redirect: 'follow', signal: AbortSignal.timeout(20000) })
    if (!res.ok) return { why: `answered ${res.status}` }
    const text = await res.text()
    const lines = text.split('\n').filter((line) => line.includes(','))
    if (lines.length < MIN_LINES) return { why: `only ${lines.length} seller lines` }
    if (!text.includes(ADSENSE)) return { why: 'the AdSense row is missing' }
    return { text: text.endsWith('\n') ? text : `${text}\n` }
  } catch (error) {
    return { why: error.message }
  }
}

const { text, why } = await fetchList()
if (!text) {
  console.log(`ads.txt: kept the current file (Ezoic ${why})`)
} else {
  const old = await readFile(FILE, 'utf8').catch(() => '')
  if (old === text) console.log('ads.txt: unchanged')
  else {
    await writeFile(FILE, text)
    console.log(`ads.txt: updated from Ezoic, ${text.split('\n').length - 1} lines`)
  }
}
