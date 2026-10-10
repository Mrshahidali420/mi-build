/**
 * The answer pages.
 *
 * Every page on this site should answer one question a real person typed into
 * a search box, in our own words, from facts we already hold. These builders
 * take one catalog record and return the text for a whole page.
 *
 * Two rules keep this file safe:
 *   1. It imports platform-facts.js and names.mjs (pure, import-free) and
 *      NOTHING else. No catalog, no JSON. That lets the Worker run it at
 *      request time and lets make-shards.mjs run it at build time from plain
 *      node.
 *   2. It states only what the record and the platform facts already say.
 *      No guessing, no prices, no promises about a licence we cannot see.
 *
 * Because platform facts belong to the PLATFORM, a title added tomorrow gets
 * a complete set of answer pages tomorrow with no extra step.
 */
import { factsFor, FREE, PAY } from './platform-facts.js'

/* -------------------------------------------------------------- tiny words */

const KIND_WORD = { manhwa: 'manhwa', manhua: 'manhua', manga: 'manga', novel: 'novel', anime: 'anime' }
const STATUS_WORD = {
  FINISHED: 'finished',
  RELEASING: 'still releasing',
  NOT_YET_RELEASED: 'not out yet',
  CANCELLED: 'cancelled',
  HIATUS: 'on hiatus',
}

export const wordOf = (kind) => KIND_WORD[kind] || 'comic'
export const verbOf = (kind) => (kind === 'anime' ? 'watch' : 'read')
export const unitOf = (kind) => (kind === 'anime' ? 'episodes' : 'chapters')

/** "a, b and c" — the way a person says a list out loud. */
export function listWords(names) {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** One title can sit on the same platform in four languages. Say it once. */
export function uniqueBySite(links = []) {
  const seen = new Set()
  const out = []
  for (const link of links) {
    if (!link || !link.site || seen.has(link.site)) continue
    seen.add(link.site)
    out.push(link)
  }
  return out
}

export const linksOf = (item) => (item.kind === 'anime' ? item.watchLinks : item.readLinks) || []

/* ------------------------------------------------ cheapest first, grouped */

/**
 * How much of the work a reader gets without paying. Lower is better for the
 * reader, so this is the first sort key. A platform we hold no facts for sits
 * in the middle: we will not promote it, and we will not bury it either.
 */
const FREE_COST = {
  [FREE.ALL]: 0,
  [FREE.MOST]: 1,
  [FREE.EARLY]: 2,
  [FREE.TIMER]: 3,
  [FREE.SOME]: 4,
  [FREE.SOME_EP]: 4,
  [FREE.TRIAL]: 6,
  [FREE.NONE]: 7,
}
const UNKNOWN_COST = 5

/** How the money leaves your pocket when the free part runs out. */
const PAY_COST = {
  [PAY.ADS]: 0,
  [PAY.LIBRARY]: 1,
  [PAY.SUB_FREE]: 2,
  [PAY.SUB]: 3,
  [PAY.COINS]: 4,
  [PAY.BUY]: 5,
  [PAY.PRINT]: 6,
}

const costOf = (facts) => [
  FREE_COST[facts.free] ?? UNKNOWN_COST,
  PAY_COST[facts.pay] ?? 4,
  facts.region === 'Worldwide' ? 0 : 1,
  facts.account ? 1 : 0,
]

/**
 * One row per platform, cheapest for the reader first.
 *
 * AniList hands us one link per language edition, so WEBTOON could fill four
 * rows of the same table and say the same thing four times. Here the editions
 * are merged into one row that names the languages.
 *
 * The order is the value this page adds. AniList gives an arbitrary list; a
 * reader wants to know which door is open without paying, and that is a fact
 * we can work out from the platform facts we already hold.
 */
export function rankedRows(links = []) {
  const bySite = new Map()
  for (const link of links) {
    if (!link || !link.site) continue
    const row = bySite.get(link.site)
    if (row) {
      if (link.language && !row.languages.includes(link.language)) row.languages.push(link.language)
      continue
    }
    bySite.set(link.site, {
      link,
      facts: factsFor(link.site),
      languages: link.language ? [link.language] : [],
    })
  }

  const rows = [...bySite.values()]
  for (const row of rows) row.cost = costOf(row.facts)
  rows.sort((a, b) => {
    for (let i = 0; i < a.cost.length; i++) {
      if (a.cost[i] !== b.cost[i]) return a.cost[i] - b.cost[i]
    }
    return a.link.site.localeCompare(b.link.site)
  })
  return rows
}

/**
 * One sentence naming the best door in, and what it costs.
 *
 * This is the sentence the reader came for, and it exists nowhere else: it is
 * our ranking, in our words, over facts we keep. Returns null when we hold no
 * facts, because a guess here is worse than silence.
 */
export function bestValue(rows, kind) {
  const top = rows[0]
  if (!top || !top.facts.free) return null
  const unit = unitOf(kind)
  const site = top.link.site
  const free = top.facts.free

  let what
  if (free === FREE.ALL) what = `the whole thing, for nothing`
  else if (free === FREE.MOST) what = `most of it, for nothing`
  else if (free === FREE.EARLY) what = `every ${unit.slice(0, -1)} but the newest, for nothing`
  else if (free === FREE.TIMER) what = `one ${unit.slice(0, -1)} at a time, for nothing, if you wait`
  else if (free === FREE.SOME || free === FREE.SOME_EP) what = `the opening ${unit}, for nothing`
  else return null

  const region = top.facts.region && top.facts.region !== 'Worldwide' ? ` in ${top.facts.region}` : ''
  // One sentence: the stock lines that used to follow it ("No account
  // needed.", "Everything below is the same read for more money.") read the
  // same on every page.
  const account = top.facts.account ? ', though it asks you to sign in' : ', with no account needed'
  return `Cheapest legal way in: ${site}${region}, which gives you ${what}${account}.`
}

/* ------------------------------------------------------------ free or not */

// A trial ends and "none" was never free. Everything else gives a reader
// something real without a card.
const NOT_REALLY_FREE = new Set([FREE.NONE, FREE.TRIAL])

/**
 * Splits the official platforms into three groups: ones that give something
 * away, ones that do not, and ones we hold no facts for. The third group is
 * never called free. Silence is better than a wrong promise.
 */
export function freeSplit(links) {
  const free = []
  const paid = []
  const unknown = []
  for (const link of uniqueBySite(links)) {
    const facts = factsFor(link.site)
    const row = { link, facts }
    if (!facts.free) unknown.push(row)
    else if (NOT_REALLY_FREE.has(facts.free)) paid.push(row)
    else free.push(row)
  }
  return { free, paid, unknown }
}

/** How the free part works, in one sentence, grouped so we never repeat. */
function howFreeWorks(rows, kind) {
  const unit = unitOf(kind)
  const lines = []
  const has = (text) => rows.some((r) => r.facts.free === text)

  if (has(FREE.ALL)) lines.push(`Some of them carry the whole thing for nothing.`)
  if (has(FREE.MOST)) lines.push(`Some carry most of it for nothing.`)
  if (has(FREE.EARLY)) {
    lines.push(`On most of them the older ${unit} are free and only the newest ones cost money.`)
  }
  if (has(FREE.TIMER)) {
    lines.push(`Some hand you one more ${unit.slice(0, -1)} every few hours if you are happy to wait.`)
  }
  if (has(FREE.SOME) || has(FREE.SOME_EP)) {
    lines.push(`Some give you the opening ${unit} and then ask you to pay.`)
  }
  return lines
}

/* ------------------------------------------------ page 1: the free answer */

/**
 * "Where to read X free and legal". The single highest-volume question about
 * any title, and the one a pirate site normally wins. We answer it honestly:
 * yes and where, or no and why.
 */
export function freeAnswer(item, kind) {
  const verb = verbOf(kind)
  const word = wordOf(kind)
  const unit = unitOf(kind)
  const { free, paid, unknown } = freeSplit(linksOf(item))
  const freeNames = free.map((r) => r.link.site)
  const paidNames = paid.map((r) => r.link.site)
  const status = STATUS_WORD[item.status] || 'listed'

  const heading = `Where to ${verb} ${item.title} free and legal`
  const paragraphs = []
  let lede

  if (free.length > 0) {
    lede =
      `Yes. You can ${verb} ${item.title} for free, and legally, on ` +
      `${listWords(freeNames)}. ${free.length === 1 ? 'That platform holds' : 'These platforms hold'} ` +
      `the licence, so nobody is taking a risk here.`

    const works = howFreeWorks(free, kind)
    if (works.length) {
      paragraphs.push({
        heading: 'What free means here',
        text:
          `Free is not the same on every platform. ${works.join(' ')} ` +
          `The table above says exactly what each one gives you, and which country it works in.`,
      })
    }
  } else if (paid.length > 0 || unknown.length > 0) {
    lede =
      `No. There is no free and legal way to ${verb} ${item.title} at the moment. ` +
      `The ${paidNames.length + unknown.length === 1 ? 'one platform that holds' : 'platforms that hold'} ` +
      `the licence ${paidNames.length + unknown.length === 1 ? 'asks' : 'ask'} for money before you start.`
    paragraphs.push({
      heading: 'What it does cost',
      text:
        `${listWords([...paidNames, ...unknown.map((r) => r.link.site)])} ` +
        `${paidNames.length + unknown.length === 1 ? 'is' : 'are'} the official ${
          kind === 'anime' ? 'streaming' : 'reading'
        } ` +
        `${paidNames.length + unknown.length === 1 ? 'home' : 'homes'} for this ${word}. ` +
        `The table above shows how each one charges and where it works. ` +
        `Prices move, so we do not print numbers we cannot keep true.`,
    })
  } else {
    lede =
      `Not yet. No platform we track has an official licence for ${item.title}, ` +
      `free or paid. That normally changes once a ${word} gets popular.`
    paragraphs.push({
      heading: 'What to do meanwhile',
      text:
        `We rebuild this index every day. The moment a publisher or a streaming service ` +
        `picks ${item.title} up, it appears on this page. Nothing else on this page will ` +
        `change: we will never point you at a copy that nobody paid for.`,
    })
  }

  if (free.length > 0 && (paid.length > 0 || unknown.length > 0)) {
    paragraphs.push({
      heading: `Where the rest of it is`,
      text:
        `${listWords([...paidNames, ...unknown.map((r) => r.link.site)])} also ` +
        `${paid.length + unknown.length === 1 ? 'carries' : 'carry'} ${item.title}, ` +
        `but ${paid.length + unknown.length === 1 ? 'it asks' : 'they ask'} for money up front. ` +
        `That is usually how you reach the newest ${unit} on the day they come out.`,
    })
  }

  paragraphs.push({
    heading: 'Why every link here is an official one',
    text:
      `A scan site costs you nothing and pays the people who made ${item.title} nothing. ` +
      `It also tends to carry the kind of advert you do not want on your phone. ` +
      `manhwaindex lists licensed platforms only. We hold no ${unit} of our own, ` +
      `and we take no cut from the platforms we send you to.`,
  })

  const description =
    free.length > 0
      ? `${item.title} is free and legal to ${verb} on ${listWords(freeNames.slice(0, 3))}. ` +
        `Here is how much of it is free on each one, and what the rest costs.`
      : `${item.title} has no free and legal ${
          kind === 'anime' ? 'stream' : 'read'
        } right now. Here is every official platform that carries it, and how each one charges.`

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
  }
}

/* ------------------------------------------------ page 2: the "like" answer */

/**
 * "Manhwa like X". A recommendation page only earns its place if it says WHY
 * each pick belongs and WHERE you can legally get it. Both come from the
 * record, so both are true for a title added tomorrow.
 */
export function likeAnswer(item, kind) {
  const word = wordOf(kind)
  const verb = verbOf(kind)
  const picks = (item.similar || []).map((p) => {
    const sites = uniqueBySite(p.kind === 'anime' ? p.watchLinks : p.readLinks).map((l) => l.site)
    return { ...p, sites }
  })
  // A pick you can actually go and read is worth more than one you cannot.
  picks.sort((a, b) => b.sites.length - a.sites.length)

  const shared = [...new Set(picks.flatMap((p) => p.shared || []))].slice(0, 4)
  const withLinks = picks.filter((p) => p.sites.length > 0).length

  const heading = `${word.charAt(0).toUpperCase()}${word.slice(1)} like ${item.title}`
  const lede =
    picks.length > 0
      ? `${picks.length} ${word} in this index sit closest to ${item.title}. ` +
        `${shared.length ? `They pull from the same shelves: ${listWords(shared.map((s) => s.toLowerCase()))}. ` : ''}` +
        `${withLinks} of them have an official place to ${verb} them right now.`
      : `We have no close match for ${item.title} in the index yet.`

  const paragraphs = [
    {
      heading: 'How these were picked',
      text:
        `Nothing here is a hand-written list. Every ${word} in the index is compared with ` +
        `${item.title} on the genres both carry. A title needs at least two genres in common ` +
        `to appear, and the most-read ones come first. The list is rebuilt every day, so a ` +
        `${word} added this week can show up here next week.`,
    },
    {
      heading: 'What the platform names mean',
      text:
        `Under each cover we print the official platforms that carry that title. ` +
        `If a title shows no platform, no publisher has licensed it in a language we track. ` +
        `We list it anyway, because knowing a ${word} is not available yet is also an answer.`,
    },
  ]

  return {
    heading,
    pageTitle: `${heading} — ${picks.length} similar titles you can ${verb} legally`,
    description:
      picks.length > 0
        ? `${picks.length} ${word} similar to ${item.title}, picked on shared genres, each with the official platforms that carry it.`
        : `Similar titles to ${item.title}.`,
    lede,
    paragraphs,
    picks,
  }
}

/* ------------------------------------------------ opening and ending songs */

// Rows come from data/themes.json via make-shards (item.themes):
// { type: 'OP'|'ED', seq, title, artists: [..], episodes?, version? }.

/** "OP1", "ED2". */
export const themeLabel = (row) => `${row.type}${row.seq}`

/** "1-13" -> "episodes 1–13", "1" -> "episode 1". Anything odd is kept as it came. */
export function episodesWords(row) {
  const text = (row.episodes || '').trim()
  if (!text) return ''
  if (/^\d+$/.test(text)) return `episode ${text}`
  if (/^[\d\s,-]+$/.test(text)) return `episodes ${text.replace(/(\d)\s*-\s*(\d)/g, '$1–$2').replace(/-$/, ' on')}`
  return text
}

/** '"Kaikai Kitan" by Eve'. */
export function songWords(row) {
  const by = listWords(row.artists || [])
  return by ? `"${row.title}" by ${by}` : `"${row.title}"`
}

// The title page FAQ lives in src/lib/title-faq.mjs.

// The character page FAQ lives in src/lib/character-faq.mjs.

/** JSON-LD for a question set. Google reads this; a person reads the block. */
export const faqJsonld = (faq) => ({
  '@type': 'FAQPage',
  mainEntity: faq.map((row) => ({
    '@type': 'Question',
    name: row.q,
    acceptedAnswer: { '@type': 'Answer', text: row.a },
  })),
})

/* ----------------------------------------------------- the platform itself */

/**
 * The platform hub pages describe a PLATFORM, not a title, so they need their
 * own sentences. These turn the same four facts the comparison table uses into
 * plain English a reader can act on.
 *
 * `unit` is "chapters" for a reading platform and "episodes" for a streaming
 * one, so one set of sentences covers both shelves.
 */
const PAY_SENTENCE = {
  [PAY.ADS]: 'You pay nothing. Advertising pays for it.',
  [PAY.COINS]: 'You buy coins first, then spend the coins on single UNITS.',
  [PAY.BUY]: 'You buy each UNIT on its own.',
  [PAY.SUB]: 'You pay a fee every month.',
  [PAY.SUB_FREE]: 'There is a free level. A monthly fee opens the rest.',
  [PAY.PRINT]: 'You buy the book, in print or as an ebook.',
  [PAY.LIBRARY]: 'It costs nothing if you have a library card.',
}

const FREE_SENTENCE = {
  [FREE.ALL]: 'Every UNIT is free.',
  [FREE.MOST]: 'Most UNITS are free.',
  [FREE.EARLY]: 'Every UNIT is free except the newest ones.',
  [FREE.SOME]: 'The first chapters of each series are free.',
  [FREE.SOME_EP]: 'The first episodes of each series are free.',
  [FREE.TIMER]: 'You get one free UNIT at a time. Then you wait, or you pay.',
  [FREE.TRIAL]: 'There is a free trial, and nothing more.',
  [FREE.NONE]: 'Nothing is free here.',
}

const fill = (sentence, unit) =>
  sentence.split('UNITS').join(unit).split('UNIT').join(unit.slice(0, -1))

/**
 * Where the service works. The region strings are already written for a
 * reader, so they are used as they stand; only "Some countries" needs help,
 * because on its own it tells nobody anything.
 */
const regionSentence = (region) => {
  if (region === 'Worldwide') return 'It works in almost every country.'
  if (region === 'Some countries') {
    return 'It only works in some countries. Its own page lists which ones.'
  }
  return `It only works in ${region}.`
}

/**
 * Three to five short sentences saying what this platform asks of a reader.
 * Returns null when we hold no facts for it, because a guess is worse than
 * silence.
 */
export function platformHow(name, facts, unit) {
  if (!facts || !facts.pay) return null
  const lines = [`${name} works like this.`]
  if (PAY_SENTENCE[facts.pay]) lines.push(fill(PAY_SENTENCE[facts.pay], unit))
  if (FREE_SENTENCE[facts.free]) lines.push(fill(FREE_SENTENCE[facts.free], unit))
  if (facts.region) lines.push(regionSentence(facts.region))
  lines.push(facts.account ? 'You must make an account.' : 'You do not need an account.')
  return lines.join(' ')
}

/**
 * The questions a person types before they open a platform. Answered from the
 * same four facts, so the answer can never drift from the table.
 */
export function platformFaq(name, facts, unit, verb, counts) {
  const rows = []
  if (facts && facts.free) {
    rows.push({
      q: `Is ${name} free?`,
      a: `${fill(FREE_SENTENCE[facts.free] || '', unit)} ${
        PAY_SENTENCE[facts.pay] ? fill(PAY_SENTENCE[facts.pay], unit) : ''
      }`.trim(),
    })
  }
  if (facts && facts.region) {
    rows.push({
      q: `Does ${name} work in my country?`,
      a:
        facts.region === 'Worldwide'
          ? `${name} works in almost every country. A few series are still blocked in some places, because the licence is sold country by country.`
          : facts.region === 'Some countries'
            ? `${name} is only open in some countries. Its own page lists which ones. Outside that list most of the library is blocked.`
            : `${name} is made for ${facts.region}. Outside that area most of the library is blocked.`,
    })
  }
  if (facts && facts.account !== null && facts.account !== undefined) {
    rows.push({
      q: `Do I need an account for ${name}?`,
      a: facts.account
        ? `Yes. You must sign in before you can ${verb}.`
        : `No. You can start to ${verb} without signing in. An account only saves your place.`,
    })
  }
  if (counts && counts.total > 0) {
    rows.push({
      q: `How many titles on this site are on ${name}?`,
      a: `${counts.total.toLocaleString()} of them. That is what this index has found so far, and it grows every day.`,
    })
  }
  return rows
}
