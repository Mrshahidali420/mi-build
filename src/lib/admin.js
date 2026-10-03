/**
 * The shared parts of the reading room at /my-admin.
 *
 * The door, the date ranges, and the small helpers that turn a database row
 * into a sentence a person can read. The pages themselves only ask questions
 * and draw tables.
 */

const COOKIE = 'mi_admin'
const THIRTY_DAYS = 60 * 60 * 24 * 30

/** 'YYYY-MM-DD', counted back from now, in UTC. */
export function dayKey(shift = 0, now = Date.now()) {
  return new Date(now - shift * 86400000).toISOString().slice(0, 10)
}

/**
 * A one-way fingerprint. The same word always gives the same answer, and the
 * answer can never be turned back into the word.
 */
async function fingerprint(word) {
  const bytes = new TextEncoder().encode(`manhwaindex:${word}`)
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * The door. One secret word, kept as the Cloudflare secret ADMIN_SECRET.
 * The word is never stored: the cookie holds its fingerprint only.
 *
 * Returns { db, secret, signedIn, wrongWord }.
 */
export async function gate(Astro, env) {
  const db = env?.ANALYTICS || null
  const secret = env?.ADMIN_SECRET || ''
  if (!secret) return { db, secret: '', signedIn: false, wrongWord: false }

  const wanted = await fingerprint(secret)

  if (Astro.request.method === 'POST') {
    const form = await Astro.request.formData()
    const given = String(form.get('word') || '')
    if (given && (await fingerprint(given)) === wanted) {
      Astro.cookies.set(COOKIE, wanted, {
        path: '/my-admin',
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: THIRTY_DAYS,
      })
      return { db, secret, signedIn: true, wrongWord: false }
    }
    return { db, secret, signedIn: false, wrongWord: true }
  }

  return {
    db,
    secret,
    signedIn: sameText(Astro.cookies.get(COOKIE)?.value || '', wanted),
    wrongWord: false,
  }
}

/**
 * Two strings compared in time that does not depend on where they differ,
 * so the answer time cannot be used to guess the fingerprint one character
 * at a time.
 */
function sameText(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** One cookie's value out of a raw Cookie header, or ''. */
export function cookieFrom(header, name = COOKIE) {
  for (const part of String(header || '').split(';')) {
    const at = part.indexOf('=')
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim()
  }
  return ''
}

/**
 * The same door as gate(), for a request that is not a page: the admin
 * buttons' endpoint. True only when ADMIN_SECRET is set and the request
 * carries the cookie gate() hands out after the right word. There is no
 * other way in: no header, no query string, no second secret.
 */
export async function isOwner(request, env) {
  const secret = env?.ADMIN_SECRET || ''
  if (!secret) return false
  const given = cookieFrom(request.headers.get('cookie'))
  if (!given) return false
  return sameText(given, await fingerprint(secret))
}

/** Ask the database one question. A broken query gives an empty answer, never
 * a broken page. */
export async function ask(db, sql, ...args) {
  if (!db) return []
  try {
    const out = await db.prepare(sql).bind(...args).all()
    return out.results || []
  } catch (e) {
    return []
  }
}

/**
 * "The newest rows", without an index on time. The id only ever grows, and a
 * row can only be written AFTER it happened (the page sends a visit's rows
 * when it ends), so anything from the last few minutes always sits inside the
 * last few thousand ids. Reading by id costs
 * nothing to find and never more than this many rows, however big the table.
 * 3000 rows is several days of traffic today and well over an hour even at
 * 50,000 page views a day.
 */
export const RECENT_ROWS = 3000
export const RECENT = `id > (SELECT COALESCE(MAX(id), 0) FROM events) - ${RECENT_ROWS}`

/** The same, for a question with one answer. */
export async function askOne(db, sql, ...args) {
  const rows = await ask(db, sql, ...args)
  return rows[0] || {}
}

// --------------------------------------------------------------- date ranges

/**
 * The five time windows, and where each one reads from.
 *
 * `raw` means the one-by-one `events` table: exact, and able to say "people"
 * and show a journey, but only the last 30 days are kept.
 * `rolled` means the small nightly tables: cheap, and kept forever, but a day
 * is only added there after midnight.
 */
export const RANGES = [
  { key: 'today', label: 'Today' },
  { key: '24h', label: 'Last 24 hours' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'all', label: 'All time' },
]

export function rangeOf(url, fallback = 'today') {
  const key = url.searchParams.get('range') || fallback
  const found = RANGES.find((r) => r.key === key) || RANGES[0]
  const now = Date.now()
  const today = dayKey(0, now)

  if (found.key === 'today') {
    return { ...found, mode: 'raw', fromDay: today, toDay: today, sinceTs: 0, exactPeople: true }
  }
  if (found.key === '24h') {
    return {
      ...found,
      mode: 'raw',
      fromDay: dayKey(1, now),
      toDay: today,
      sinceTs: now - 86400000,
      exactPeople: true,
    }
  }
  if (found.key === 'all') {
    return { ...found, mode: 'all', fromDay: '0000-00-00', toDay: today, sinceTs: 0, exactPeople: false }
  }
  const back = found.key === '7d' ? 6 : 29
  return {
    ...found,
    mode: 'mixed',
    fromDay: dayKey(back, now),
    toDay: today,
    today,
    sinceTs: 0,
    exactPeople: false,
  }
}

/** Keep the chosen range when moving between tabs. Always spelled out, even
 * for Today, because some tabs open on a longer range when none is given. */
export function withRange(path, range) {
  return `${path}?range=${range.key}`
}

// -------------------------------------------------------------- plain English

/** One piece of a path, said as words: "solo-leveling" -> "Solo Leveling". */
const titleCase = (part) =>
  String(part || '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())

// The answer pages hang off a title: /manhwa/solo-leveling/free. Naming one by
// its last piece alone gives every one of them the same name, "Free", and the
// report cannot say which story earned the click. The story name goes first,
// because the story is the thing being reported on.
const ANSWER_PAGES = { free: 'Free', like: 'Similar', buy: 'Buy', characters: 'Characters' }

/** A page address, said as a name. */
export function humanize(path, label) {
  if (label) return label
  if (!path || path === '/') return 'Home'
  const parts = path.replace(/^\//, '').split('/')
  const last = parts[parts.length - 1] || ''
  if (parts.length === 3 && ANSWER_PAGES[last]) {
    return `${titleCase(parts[1])} — ${ANSWER_PAGES[last]}`
  }
  return titleCase(last) || path
}

/** The section a page belongs to, said as a word. The key is the first part
 * of the address, so every top-level page on the site needs one here, or the
 * report shows the raw address part instead. */
export const SECTIONS = {
  home: 'Home',
  manhwa: 'Manhwa',
  manga: 'Manga',
  manhua: 'Manhua',
  novel: 'Novels',
  anime: 'Anime',
  character: 'Characters',
  shop: 'Shop',
  browse: 'Browse',
  genre: 'Genres',
  mood: 'What to read next',
  schedule: 'Airing this week',
  platform: 'Platforms',
  'where-to-read': 'Where to read',
  'where-to-watch': 'Where to watch',
  search: 'Search',
  'my-list': 'My list',
  about: 'About',
  contact: 'Contact',
  privacy: 'Privacy',
  dmca: 'Copyright',
  entry: 'Arrived from outside',
}

export function sectionName(type) {
  return SECTIONS[type] || type || 'Other'
}

// Cloudflare gives a two letter country code. The browser engine already
// knows the full name of every country, so no list has to be kept here.
const REGION = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' })
  } catch (e) {
    return null
  }
})()

/** "SG" becomes "Singapore". A code that is not known is given back as it came. */
export function countryName(code) {
  const c = String(code || '').trim().toUpperCase()
  if (!c || c === '??' || c === 'XX' || c === 'T1') return 'Unknown'
  try {
    return (REGION && REGION.of(c)) || c
  } catch (e) {
    return c
  }
}

/** A sending site, said as a name. */
const SOURCES = {
  'google.com': 'Google search',
  'www.google.com': 'Google search',
  'bing.com': 'Bing search',
  'duckduckgo.com': 'DuckDuckGo',
  'l.facebook.com': 'Facebook',
  'facebook.com': 'Facebook',
  't.co': 'Twitter / X',
  'out.reddit.com': 'Reddit',
  'reddit.com': 'Reddit',
  'www.reddit.com': 'Reddit',
  'com.google.android.googlequicksearchbox': 'Google app',
  'yandex.com': 'Yandex search',
}

export function sourceName(source) {
  if (!source) return 'Typed the address'
  if (source.startsWith('utm:')) return `Your own link: ${source.slice(4)}`
  if (SOURCES[source]) return SOURCES[source]
  if (source.startsWith('www.google.')) return 'Google search'
  return source
}

/** Milliseconds, said as time. */
export function fmtDwell(ms) {
  const s = Math.round((Number(ms) || 0) / 1000)
  if (s <= 0) return '—'
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  const rest = s % 60
  return rest ? `${m} min ${rest} s` : `${m} min`
}

/** A clock time, UTC. */
export function clock(ts) {
  return `${new Date(ts).toISOString().slice(11, 16)} UTC`
}

// ----------------------------------------------------------- Pakistan time
//
// The reading room at /my-admin is read by one person, in Pakistan. Every
// clock face it draws — the click feed, the page feed, "last seen", the
// night job's closed-at line, the hour-by-hour chart — speaks Pakistan time,
// UTC+5 with no daylight saving, never the server's own UTC. Day keys, the
// five date ranges and what "today" means all stay UTC underneath (see
// dayKey/rangeOf above): only the clock FACE changes here, not the clock.
// clock() above is left alone because it also answers a public question —
// "when does this episode air in Japan" — where UTC is the right unit.

export const ADMIN_TZ = 'Asia/Karachi'

// Read the hour/minute out in 24-hour form first, then say them as words.
// Intl's own hour12 option gives "12:08 AM" (uppercase, and "12" spelled two
// different ways depending on locale); reading the 24-hour parts and doing
// the am/pm math by hand gives one predictable shape everywhere: "1:26 pm".
const ADMIN_HM = new Intl.DateTimeFormat('en-GB', {
  timeZone: ADMIN_TZ,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const ADMIN_DAY_HM = new Intl.DateTimeFormat('en-GB', {
  timeZone: ADMIN_TZ,
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const ADMIN_DAY = new Intl.DateTimeFormat('en-GB', {
  timeZone: ADMIN_TZ,
  day: 'numeric',
  month: 'short',
})

const ADMIN_WEEKDAY = new Intl.DateTimeFormat('en-GB', {
  timeZone: ADMIN_TZ,
  weekday: 'short',
})

// The PKT calendar date of a timestamp, as 'YYYY-MM-DD', for comparing two
// timestamps' days without touching the server's own UTC date.
const ADMIN_YMD = new Intl.DateTimeFormat('en-CA', {
  timeZone: ADMIN_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

// Node's ICU spells September "Sept" in the short form; every other month
// stays three letters. Trimmed back to "Sep" so every month reads the same
// width, matching the spelled-out examples ("28 Sep").
const shortMonth = (s) => s.replace(/\bSept\b/, 'Sep')

/** "13:26" -> "1:26 pm". "00:34" -> "12:34 am". Hour and minute are already
 * in the target time zone; this only chooses the words. */
function say12Hour(hour, minute) {
  const ampm = hour >= 12 ? 'pm' : 'am'
  const h12 = hour % 12 || 12
  return `${h12}:${String(minute).padStart(2, '0')} ${ampm}`
}

/** en-GB's 24-hour "HH:MM" pulled back apart into numbers. */
function readHM(formatter, ts) {
  const [h, m] = formatter.format(new Date(ts)).split(':').map(Number)
  return [h, m]
}

/** A clock time, Pakistan time, 12-hour with am/pm. Used everywhere inside
 * /my-admin: "1:26 pm PKT". */
export function adminClock(ts) {
  const [h, m] = readHM(ADMIN_HM, ts)
  return `${say12Hour(h, m)} PKT`
}

/** A day and a clock time, Pakistan time: "24 Sep, 12:08 pm PKT". For a "last
 * closed" or "last ran" line, where the day alone is not enough. */
export function adminDateTime(ts) {
  const stamp = ADMIN_DAY_HM.format(new Date(ts))
  const [dayPart, hmPart] = stamp.split(', ')
  const [h, m] = hmPart.split(':').map(Number)
  return `${shortMonth(dayPart)} ${say12Hour(h, m)} PKT`
}

/** The hour-by-hour chart on Now is bucketed by UTC hour (see the SQL in
 * my-admin.astro) so the bucket itself never moves. Only the label on each
 * column is said in Pakistan time: UTC hour 0 is 5 am in Pakistan. */
export function pktHourLabel(utcHour) {
  const h = ((Number(utcHour) || 0) + 5) % 24
  const ampm = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 || 12
  return `${h12} ${ampm}`
}

/** The PKT calendar date of a timestamp, as 'YYYY-MM-DD'. */
function pktDayKey(ts) {
  return ADMIN_YMD.format(new Date(ts))
}

/** A date header for a time-ordered feed, in Pakistan time: "Today, 28 Sep",
 * "Yesterday, 27 Sep", or "Fri, 26 Sep" for anything older. `now` is the
 * moment the page was drawn, so "Today" always means the reader's today, not
 * whenever the row happened to be written. */
export function pktDayLabel(ts, now = Date.now()) {
  const day = pktDayKey(ts)
  const dm = shortMonth(ADMIN_DAY.format(new Date(ts)))
  if (day === pktDayKey(now)) return `Today, ${dm}`
  if (day === pktDayKey(now - 86400000)) return `Yesterday, ${dm}`
  return `${ADMIN_WEEKDAY.format(new Date(ts))}, ${dm}`
}

/**
 * Split a time-ordered list of rows (newest first) into groups under a PKT
 * day header, for a feed. A new group starts only when the PKT calendar date
 * actually changes between one row and the next, so this never reorders rows
 * and never merges two different days into one header even if the rows
 * happen to share a label by coincidence — consecutive rows only, same as
 * groupRepeats (admin-chart.js). `tsOf` reads the timestamp off a row;
 * defaults to `row.ts`.
 *
 * Returns [{ label, rows }, ...].
 */
export function groupByPktDay(rows, now = Date.now(), tsOf = (row) => row.ts) {
  const groups = []
  for (const row of rows || []) {
    const label = pktDayLabel(tsOf(row), now)
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.rows.push(row)
    else groups.push({ label, rows: [row] })
  }
  return groups
}

/** A big number with spaces, so 12400 reads as 12 400. */
export function num(value) {
  return String(Math.round(Number(value) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

/** Clicks per hundred views. The one number that says if a page does its job. */
export function handOff(clicks, views) {
  if (!views) return 0
  return Math.round((clicks / views) * 1000) / 10
}

/** An event name, said as words: affiliate_amazon_books -> amazon books. */
export function words(name) {
  return String(name || '').replace(/_/g, ' ')
}

/** What an Amazon link was for, said as a word. Top picks carry a pick_
 * prefix and their own kinds (plush, poster). Shared by the click feed on Now
 * and the Money tab, so the two never name the same click differently. */
const SHOPS = {
  books: 'Manga and books',
  book: 'Manga and books',
  figures: 'Figures',
  figure: 'Figures',
  discs: 'Blu-ray and DVD',
  prints: 'Art prints',
  poster: 'Posters',
  plush: 'Plushies',
  apparel: 'Clothes',
  merch: 'Merch',
  'trial-prime': 'Prime Video trial',
  'trial-ku': 'Kindle Unlimited trial',
}
export function shopName(kind) {
  const bare = String(kind || 'merch').replace(/^pick_/, '')
  return SHOPS[bare] || words(bare)
}

/** Where an Amazon link sat on the page. */
export const SPOTS = {
  pick: 'Top picks',
  buybox: 'Buy box',
  shop: 'Shop page',
  themes: 'Theme songs box',
  trial: 'Shop shelf trial card',
}

// ------------------------------------------------------------ search links

/**
 * A handful of outbound links are themselves a search, not a destination: a
 * Google search, or the YouTube/Spotify search a theme song's listen link
 * opens (src/components/Themes.astro). Their stored `label` says nothing
 * useful — old rows, from before that link carried its own data-platform,
 * hold whatever text the click happened to glue together — so the click feed
 * reads the query straight out of the link's own address instead. That means
 * this works the same on a row written five minutes ago and one written
 * before this fix shipped, because it never looks at `label` at all.
 *
 * Amazon's search (the third listen link) is not covered here: it is a buy
 * link first, and the click feed already reads it through the ordinary buy
 * path (shop_kind, detail), which says more about it than "search" would.
 *
 * Returns { service, query } or null when `target` is not one of these.
 */
export function searchTarget(target) {
  let url
  try {
    url = new URL(String(target || ''))
  } catch (e) {
    return null
  }
  const host = url.hostname.replace(/^www\./, '')

  if (host === 'google.com' || host.endsWith('.google.com')) {
    if (!url.pathname.startsWith('/search')) return null
    const q = url.searchParams.get('q')
    return q ? { service: 'Google', query: q } : null
  }
  if (host === 'youtube.com' && url.pathname === '/results') {
    const q = url.searchParams.get('search_query')
    return q ? { service: 'YouTube', query: q } : null
  }
  if (host === 'open.spotify.com' && url.pathname.startsWith('/search/')) {
    const q = url.pathname.slice('/search/'.length).replace(/\/$/, '')
    if (!q) return null
    try {
      return { service: 'Spotify', query: decodeURIComponent(q) }
    } catch (e) {
      return { service: 'Spotify', query: q }
    }
  }
  return null
}

// ------------------------------------------------------------- click filter

/** The click feed's filter chips, in the order they are drawn. An empty key
 * means "All". The kind column only ever holds these four values (see CLICK
 * in src/lib/action-sql.js), so nothing is ever left out of every chip. */
export const CLICK_FILTERS = [
  { key: '', label: 'All' },
  { key: 'buy', label: 'Buy (Amazon)' },
  { key: 'read', label: 'Read' },
  { key: 'watch', label: 'Watch' },
  { key: 'other', label: 'Other' },
]

/** Which chip a request asked for, from ?clicks=. An address with no such
 * kind — a typo, an old link, nothing at all — is the same as asking for
 * "All", never a broken page. */
export function clickFilterOf(url) {
  const key = url.searchParams.get('clicks') || ''
  return CLICK_FILTERS.find((f) => f.key === key) || CLICK_FILTERS[0]
}
