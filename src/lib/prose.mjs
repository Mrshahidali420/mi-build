/**
 * BUILD TIME ONLY. Writes the original overview that sits at the top of every
 * title page.
 *
 * Why this file exists: a page that only reprints the AniList synopsis is
 * copied content, and Google treats it as low value. Every sentence below is
 * built from the structured facts we already hold, so the text is ours.
 *
 * It runs inside scripts/make-shards.mjs, which runs on EVERY build. A title
 * added tomorrow gets its overview tomorrow, with no extra step from anyone.
 *
 * Rules for anything added here:
 *   1. Never state a fact the record does not hold. No guessing.
 *   2. Never print a tag from BLOCKED_TAGS. Those would cost us AdSense.
 *   3. Keep sentences short. Most readers are on a phone.
 */

// Tags that must never reach a page, whatever AniList says about them.
const BLOCKED_TAGS = new Set([
  'Ecchi', 'Nudity', 'Sexual Content', 'Boys Love', 'Girls Love', 'Yaoi', 'Yuri',
  'Incest', 'Lolicon', 'Shotacon', 'Tentacles', 'Prostitution', 'Rape',
  'Sexual Abuse', 'Netorare', 'Netorase', 'Harem', 'Reverse Harem', 'Fetish',
  'Bondage', 'Cross-Dressing', 'Gender Bending', 'Adult', 'Hentai', 'Erotica',
  'Sex Work', 'Teacher', 'Age Gap', 'Cheating', 'Psychosexual', 'Suicide',
  'Self-Harm', 'Gore', 'Torture', 'Cannibalism', 'Drugs', 'Body Horror',
  'Guro', 'Sadism', 'Masochism', 'Slavery', 'Human Trafficking',
])

const KIND_WORDS = { KR: 'manhwa', CN: 'manhua', TW: 'manhua', JP: 'manga' }
const COUNTRY_WORDS = { KR: 'Korean', CN: 'Chinese', TW: 'Taiwanese', JP: 'Japanese' }
const SEASON_WORDS = { WINTER: 'winter', SPRING: 'spring', SUMMER: 'summer', FALL: 'autumn' }

// How a platform note maps to a bucket a reader actually cares about.
const BUCKET_OF_NOTE = {
  'Free, ad-supported': 'free',
  'Free, official': 'free',
  'Free, official channel': 'free',
  'Free episodes': 'free',
  'Free tier': 'free',
  'Free tier and premium': 'free',
  'Free with timer': 'timer',
  'Free with coins': 'coins',
  'Free with library card': 'library',
  Subscription: 'subscription',
  'Paid chapters': 'paid',
  'Buy in print': 'print',
}

/** "A", then "A and B", then "A, B and C". */
function joinWords(list) {
  const clean = list.filter(Boolean)
  if (clean.length === 0) return ''
  if (clean.length === 1) return clean[0]
  return clean.slice(0, -1).join(', ') + ' and ' + clean[clean.length - 1]
}

const unique = (list) => [...new Set((list || []).filter(Boolean))]

/** A stable number from the id, so one title always reads the same way. */
const seedOf = (item) => Math.abs(Number(item.id) || 0)
const pick = (list, seed) => list[seed % list.length]

const safeTags = (item, limit = 4) =>
  (item.tags || []).filter((t) => !BLOCKED_TAGS.has(t)).slice(0, limit)

const safeGenres = (item, limit = 3) =>
  (item.genres || []).filter((g) => !BLOCKED_TAGS.has(g)).slice(0, limit)

/* --------------------------------------------------------------- identity */

function identity(item, kind) {
  const word = kind === 'anime' ? 'anime series' : kind === 'novel' ? 'novel' : KIND_WORDS[item.country] || 'comic'
  const origin = COUNTRY_WORDS[item.country] || ''
  const made = unique(
    (kind === 'anime' ? item.studios : item.authors || []).map((who) =>
      typeof who === 'string' ? who : who && who.name,
    ),
  ).slice(0, 2)
  const parts = []

  const head = origin ? `a ${origin} ${word}` : `a ${word}`
  if (made.length) {
    const verb = kind === 'anime' ? 'It was animated by' : 'It is the work of'
    parts.push(`${item.title} is ${head}. ${verb} ${joinWords(made)}.`)
  } else {
    parts.push(`${item.title} is ${head}.`)
  }

  // When it ran.
  const start = item.startYear
  const end = item.endYear
  if (kind === 'anime' && item.season && item.seasonYear) {
    const season = SEASON_WORDS[item.season]
    parts.push(season ? `It started in ${season} ${item.seasonYear}.` : `It started in ${item.seasonYear}.`)
  } else if (start && end && end !== start) {
    parts.push(`It ran from ${start} to ${end}.`)
  } else if (start && end === start && item.status === 'FINISHED') {
    parts.push(`The whole run came out in ${start}.`)
  } else if (start) {
    parts.push(`It started in ${start}.`)
  }

  // How much of it there is.
  const size = []
  if (item.chapters) size.push(`${item.chapters} chapters`)
  if (item.volumes) size.push(`${item.volumes} volumes`)
  if (item.episodes) size.push(`${item.episodes} episodes`)
  if (size.length) parts.push(`It holds ${joinWords(size)}.`)

  // Where it stands today.
  const goWord = kind === 'anime' ? 'watch it start to end' : 'read it start to end'
  const STATE = {
    FINISHED: `The story is finished, so you can ${goWord}.`,
    RELEASING: 'New parts are still coming out.',
    HIATUS: 'It is on a break, and no restart date is known.',
    NOT_YET_RELEASED: 'It has not started yet.',
    CANCELLED: 'It stopped before the story ended.',
  }
  if (STATE[item.status]) parts.push(STATE[item.status])

  return parts.join(' ')
}

/* ------------------------------------------------------------------ shape */

function shape(item) {
  const genres = safeGenres(item)
  const tags = safeTags(item)
  if (!genres.length && !tags.length) return ''

  const seed = seedOf(item)
  const parts = []

  if (genres.length) {
    const lead = pick(['It sits in', 'Readers file it under', 'The shelf for it is'], seed)
    parts.push(`${lead} ${joinWords(genres.map((g) => g.toLowerCase()))}.`)
  }
  if (tags.length) {
    const lead = pick(
      ['The tags readers add most often are', 'The themes people mark it with are', 'Its most used tags are'],
      seed + 1,
    )
    parts.push(`${lead} ${joinWords(tags.map((t) => t.toLowerCase()))}.`)
  }
  return parts.join(' ')
}

/* ------------------------------------------------------------- where to go */

/** The part a reader came for: how many official places, and which speak English. */
function availability(item, kind) {
  const links = (kind === 'anime' ? item.watchLinks : item.readLinks) || []
  const verb = kind === 'anime' ? 'watch' : 'read'
  if (!links.length) {
    return `We have found no official place to ${verb} ${item.title} yet. This page is rebuilt every day, so a new licence shows up here as soon as it appears.`
  }

  const sites = unique(links.map((l) => l.site))
  const english = unique(
    links.filter((l) => !l.language || l.language === 'English').map((l) => l.site),
  )

  const parts = [
    sites.length === 1
      ? `There is one official place to ${verb} it: ${sites[0]}.`
      : `There are ${sites.length} official places to ${verb} it.`,
  ]
  if (!english.length) {
    parts.push('None of them serve English yet.')
  } else if (english.length === sites.length && sites.length > 1) {
    parts.push('All of them serve English.')
  } else if (sites.length > 1) {
    parts.push(`In English you have ${joinWords(english.slice(0, 6))}.`)
  }
  return parts.join(' ')
}

/** A second sentence: how you pay on each one. */
function payment(item, kind, noteOf) {
  const links = (kind === 'anime' ? item.watchLinks : item.readLinks) || []
  if (!links.length) return ''

  const buckets = new Map()
  for (const site of unique(links.map((l) => l.site))) {
    const bucket = BUCKET_OF_NOTE[noteOf(site)]
    if (!bucket) continue
    if (!buckets.has(bucket)) buckets.set(bucket, [])
    buckets.get(bucket).push(site)
  }
  if (!buckets.size) return ''

  const many = (list, one, more) => `${joinWords(list)} ${list.length > 1 ? more : one}`
  const said = []
  const get = (key) => buckets.get(key)

  if (get('free')) said.push(many(get('free'), 'costs nothing', 'cost nothing'))
  if (get('timer')) said.push(many(get('timer'), 'unlocks parts free on a timer', 'unlock parts free on a timer'))
  if (get('coins')) said.push(many(get('coins'), 'uses coins', 'use coins'))
  if (get('library')) said.push(many(get('library'), 'is free with a library card', 'are free with a library card'))
  if (get('subscription')) said.push(many(get('subscription'), 'needs a subscription', 'need a subscription'))
  if (get('paid')) said.push(many(get('paid'), 'sells single parts', 'sell single parts'))
  if (get('print')) said.push(many(get('print'), 'sells it in print', 'sell it in print'))

  if (!said.length) return ''
  const head = said.length > 2 ? 'The cost is not the same everywhere: ' : ''
  return `${head}${joinWords(said)}.`
}

/* -------------------------------------------------------------- reception */

function reception(item, rank) {
  const parts = []
  if (item.score) {
    parts.push(`AniList members score it ${item.score} out of 100.`)
    if (rank && rank.top && rank.top <= 25) {
      parts.push(`That puts it in the top ${rank.top}% of the ${rank.label} we list.`)
    }
  }
  if (item.favourites >= 1000) {
    parts.push(`${item.favourites.toLocaleString('en-GB')} members keep it in their favourites.`)
  }
  return parts.join(' ')
}

function adaptation(item, kind) {
  if (kind === 'anime') {
    const source = (item.relations || []).find(
      (r) => r.hit && r.hit.kind === 'comic' && /ADAPTATION|SOURCE|PARENT/i.test(r.type || ''),
    )
    return source ? 'It comes from a comic, and that comic has its own page here.' : ''
  }
  if (item.animeInIndex?.length) return 'There is an anime version, and it has its own page on this site.'
  if (item.hasAnime) return 'An anime version exists.'
  return ''
}

/* ----------------------------------------------------------------- public */

/**
 * Builds the overview for one title.
 *
 * @param item   the full catalog record
 * @param kind   'manhwa' | 'manga' | 'manhua' | 'anime'
 * @param noteOf (site) => the platform note string, from format.js
 * @param rank   { top, label } or null
 * @returns { lede, paragraphs } — lede also feeds the meta description
 */
export function buildOverview(item, kind, noteOf, rank) {
  const one = [identity(item, kind), shape(item)].filter(Boolean).join(' ')
  const two = [availability(item, kind), payment(item, kind, noteOf)].filter(Boolean).join(' ')
  const three = [reception(item, rank), adaptation(item, kind)].filter(Boolean).join(' ')

  return {
    lede: one,
    paragraphs: [one, two, three].filter((p) => p.length > 20),
  }
}
