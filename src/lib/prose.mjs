/**
 * BUILD TIME ONLY. Writes the site's own text for every title page.
 *
 * How it works: `facts()` looks at one record and builds every true sentence
 * it can say about it, each with a weight. Rare, distinguishing facts weigh
 * more than common ones (a place in a reading order beats a genre list). The
 * heaviest few become the "at a glance" paragraph that opens the Read / Watch
 * section; the next few become the "in short" paragraph above the synopsis.
 *
 * Which sentences a page gets, and how each one is built, follows from the
 * facts its record holds: a 10-chapter one-volume story is described in a
 * different sentence from a 300-chapter one. There are no synonym swaps and
 * nothing random: the same record always gives the same text.
 *
 * It runs inside scripts/make-shards.mjs on every build, so the Worker does no
 * extra work per request.
 *
 * Rules for anything added here:
 *   1. Never state a fact the record does not hold. No guessing.
 *   2. Never print a tag from BLOCKED_TAGS. Those would cost us AdSense.
 *   3. The title appears at most once per paragraph ("it" after that).
 *   4. No search phrases ("read X online free"). Short and true beats padded.
 */

// The facts live in four modules, by subject: prose-where (platforms),
// prose-nolink (pages with no English platform), prose-story (the work
// itself) and prose-reception (how readers took it). This file picks and
// orders them.
import { BLOCKED_TAGS, joinWords, unique, capital, fact, linksOf } from './prose-words.mjs'
import { whereComic, whereAnime, noneFact, freeFact, payFact, reachFact, accountFact } from './prose-where.mjs'
import { pagesFact, alikeFact, alikeWhy } from './prose-nolink.mjs'
import {
  runFact, chainFact, relativesFact, adaptFact, aliasFact, makersFact, identityFact, altTitleFact,
  dubFact, themesFact, castFact,
} from './prose-story.mjs'
import {
  chartFact, scoreFact, malFact, readersFact, dropFact, favouritesFact, recFact, shapeFact,
} from './prose-reception.mjs'

export { BLOCKED_TAGS, joinWords }

// The order sentences are printed in, whatever their weight. A reader gets
// "where" before "how much", and the story before the extras.
const ORDER = [
  'where', 'none', 'languages', 'free', 'pay', 'reach', 'account', 'pages', 'alike', 'identity', 'adapt', 'chain',
  'relatives', 'run', 'altTitle', 'alias', 'makers', 'dub', 'themes', 'cast', 'chart',
  'rank', 'mal', 'score', 'readers', 'drop', 'favourites', 'rec', 'shape',
]

const GLANCE_MAX = 5
const GLANCE_MIN = 3
const GLANCE_FLOOR = 30
const MORE_MAX = 10

/* ----------------------------------------------------------------- output */

/**
 * Every true sentence this record supports, with its weight. A sentence uses
 * "@" for the title; `render` turns the first one into the title and the rest
 * into "it".
 *
 * @param item   the full catalog record
 * @param kind   'manhwa' | 'manga' | 'manhua' | 'novel' | 'anime'
 * @param noteOf (site) => the platform note string, or null
 * @param rank   { top, label } or null
 * @returns [{ key, weight, sentence }]
 */
export function facts(item, kind, noteOf = null, rank = null) {
  const links = linksOf(item, kind)
  const out = []
  // A year already given by the "no official edition" sentence is not repeated.
  let yearSaid = false
  let none = null
  if (links.length) {
    if (kind === 'anime') out.push(whereAnime(links, noteOf))
    else out.push(...whereComic(links, noteOf))
    // One platform: its details already ride on the "where" sentence.
    if (unique(links.map((l) => l.site)).length > 1) {
      const free = freeFact(links)
      const pay = payFact(links, kind, noteOf, Boolean(free))
      // "How the rest is paid" joins the "who gives most away" sentence.
      out.push(...(free && pay ? [joined(free, pay)] : [free, pay]), reachFact(links), accountFact(links))
    }
  } else {
    none = noneFact(item, kind)
    yearSaid = /\d{4}/.test(none.sentence)
  }
  const run = runFact(item, kind, yearSaid)
  const yearInRun = Boolean(run && item.startYear && run.sentence.includes(String(item.startYear)))
  const makers = makersFact(item, kind)
  let identity = identityFact(item, kind, yearSaid || yearInRun, Boolean(makers))
  // No official place: "X, a Japanese romance manga by Y, ended in 2007, and
  // no publisher has..." One sentence that is this title's own, not two.
  if (none && identity.phrase && none.sentence.startsWith('@ ')) {
    none = fact(none.key, none.weight, `@, ${identity.phrase},${none.sentence.slice(1)}`)
    identity = null
  }
  out.push(
    none,
    // Official pages matter most where there is no platform to send a reader to.
    links.length ? null : pagesFact(item),
    kind === 'anime' ? null : alikeFact(item),
    adaptFact(item, kind, links.length > 0),
    chainFact(item, kind),
    relativesFact(item),
    run,
    identity,
    altTitleFact(item),
    aliasFact(item),
    makers,
    kind === 'anime' ? dubFact(item) : null,
    kind === 'anime' ? themesFact(item) : null,
    castFact(item),
    chartFact(item),
    scoreFact(item, rank),
    malFact(item),
    ...joinedOrBoth(readersFact(item, kind), dropFact(item)),
    favouritesFact(item),
    recFact(item),
    shapeFact(item),
  )
  return out.filter((f) => f && f.sentence)
}

/** Two facts as one sentence: the first keeps its key and the higher weight. */
function joined(a, b) {
  // A plain opening word is lowered after the semicolon; a name is not.
  const plain = /^(It|Its|Only|More|About)\b/.test(b.sentence)
  const tail = plain ? b.sentence.charAt(0).toLowerCase() + b.sentence.slice(1) : b.sentence
  return fact(a.key, Math.max(a.weight, b.weight), `${a.sentence.slice(0, -1)}; ${tail}`)
}

const joinedOrBoth = (a, b) => (a && b ? [joined(a, b)] : [a, b])

/** Heaviest first; ties keep the reading order, so the choice never wobbles. */
const byWeight = (a, b) => b.weight - a.weight || ORDER.indexOf(a.key) - ORDER.indexOf(b.key)
const byOrder = (a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key)

/**
 * Joins sentences and names the title once: at the first "@", or at a leading
 * "It" when that comes first. Every later "@" becomes "it".
 */
export function render(sentences, title) {
  let named = false
  return sentences
    .map((sentence) => {
      if (!named && !sentence.includes('@')) {
        const lead = sentence.match(/^Its?\b/)
        if (lead) {
          named = true
          return `${title}${lead[0] === 'Its' ? "'s" : ''}${sentence.slice(lead[0].length)}`
        }
      }
      return sentence.replace(/@('s)?/g, (match, owner, at) => {
        if (!named) {
          named = true
          return `${title}${owner ? "'s" : ''}`
        }
        const word = owner ? 'its' : 'it'
        return at === 0 ? capital(word) : word
      })
    })
    .join(' ')
}

/**
 * Builds the site's text for one title.
 *
 * @returns { glance, more, alikeWhy? }
 *   glance    the opening paragraph of Read / Watch (also the meta lede)
 *   more      paragraphs for the "in short" block above the synopsis
 *   alikeWhy  one line per item.alike pick, same order (only when there are picks)
 */
export function buildOverview(item, kind, noteOf, rank) {
  const all = facts(item, kind, noteOf, rank).sort(byWeight)
  let take = Math.min(GLANCE_MAX, all.length)
  // Low-weight filler only joins the glance when it would be too short without it.
  while (take > GLANCE_MIN && all[take - 1].weight < GLANCE_FLOOR) take--
  const glance = all.slice(0, take).sort(byOrder)
  const rest = all.slice(take, take + MORE_MAX).sort(byOrder)
  const more = rest.length ? render(rest.map((f) => f.sentence), item.title) : ''
  const why = kind === 'anime' ? [] : alikeWhy(item)
  return {
    glance: render(glance.map((f) => f.sentence), item.title),
    more: more.length > 20 ? [more] : [],
    ...(why.some(Boolean) ? { alikeWhy: why } : {}),
  }
}
