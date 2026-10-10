/**
 * "Where to read X free and legal" (/<kind>/<slug>/free). The single
 * highest-volume question about any title. Answered straight: yes and where,
 * and then, for each platform, how much of THIS title it gives away,
 * measured against the title's own chapter or episode count where we hold it.
 *
 * Every line comes from the platform facts (src/lib/platform-facts.js) and
 * the title record. The paragraph every free page used to share ("Why every
 * link here is an official one") is gone; /how-we-check-links says it once.
 */
import { verbOf, wordOf, unitOf, listWords, freeSplit, linksOf, STATUS_WORD } from './answers.mjs'
import { freeWords, PAY_WORDS } from './title-faq.mjs'

const REGION_ONLY = { Korea: 'in Korea only', Japan: 'in Japan only', China: 'in China only', 'Some countries': 'in some countries only', 'US and Canada': 'in the US and Canada only' }

/** "WEBTOON keeps all but the newest of its 120 chapters free, with no account needed" */
export function freeLine(row, unit, count) {
  const what = freeWords(row.facts, unit, count)
  if (!what) return ''
  const where = REGION_ONLY[row.facts.region] || ''
  const account = row.facts.account === true ? 'after you sign in' : row.facts.account === false ? 'with no account needed' : ''
  return `${row.link.site} ${what}${[where, account].filter(Boolean).map((t) => `, ${t}`).join('')}.`
}

/** "Tappytoon charges coins per chapter." From the platform's payment fact only. */
const payLine = (row) => (PAY_WORDS[row.facts.pay] ? `${row.link.site} ${PAY_WORDS[row.facts.pay]}.` : '')

export function freeAnswer(item, kind) {
  const verb = verbOf(kind)
  const word = wordOf(kind)
  const unit = unitOf(kind)
  const count = kind === 'anime' ? item.episodes : item.chapters
  const { free, paid, unknown } = freeSplit(linksOf(item))
  const freeNames = free.map((r) => r.link.site)
  const status = STATUS_WORD[item.status] || 'listed'
  const heading = `Where to ${verb} ${item.title} free and legal`
  const paragraphs = []
  let lede

  if (free.length > 0) {
    lede = `Yes, you can ${verb} ${item.title} for free, and legally, on ${listWords(freeNames)}.`
    const lines = free.map((r) => freeLine(r, unit, count)).filter(Boolean)
    if (lines.length) paragraphs.push({ heading: 'How much is free on each', text: lines.join(' ') })
  } else if (paid.length > 0 || unknown.length > 0) {
    lede = `No, there is no free and legal way to ${verb} ${item.title} at the moment.`
  } else {
    lede = `Not yet. No platform we track has an official licence for ${item.title}, free or paid.`
  }

  const rest = [...paid, ...unknown]
  if (free.length > 0 && rest.length > 0) {
    const pays = rest.map(payLine).filter(Boolean)
    paragraphs.push({
      heading: 'Where the rest of it is',
      text: pays.length
        ? pays.join(' ')
        : `${listWords(rest.map((r) => r.link.site))} also ${rest.length === 1 ? 'carries' : 'carry'} it, for money.`,
    })
  }

  const description =
    free.length > 0
      ? `${item.title} is free and legal to ${verb} on ${listWords(freeNames.slice(0, 3))}. ` +
        `Here is how much of it is free on each one, and what the rest costs.`
      : `${item.title} has no free and legal ${kind === 'anime' ? 'stream' : 'read'} right now. Here is every official platform that carries it, and how each one charges.`

  return {
    heading,
    pageTitle:
      free.length > 0
        ? `Where to ${verb} ${item.title} free (and legal) — ${listWords(freeNames.slice(0, 2))}`
        : `Is ${item.title} free to ${verb}? — the official answer`,
    description,
    lede,
    paragraphs,
    free,
    paid,
    unknown,
    status,
    word,
  }
}
