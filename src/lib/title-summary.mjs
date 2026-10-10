/**
 * Two lines about a title, for the sub-pages (/free, /buy) that used to repeat
 * the title page's synopsis and facts table word for word. The full synopsis,
 * facts and cast stay on the title page, which these lines link to.
 *
 * Every clause is gated on its field. Request time, string work only.
 */
import { wordOf, unitOf, listWords } from './answers.mjs'
import { charactersOf } from './format.js'
import { isBlocked } from './prose-words.mjs'

const big = (n) => Number(n).toLocaleString('en-GB')
const article = (word) => (/^[aeiou]/i.test(word) ? 'an' : 'a')

/** What it is, who made it, how it stands and how long it is. */
function whatLine(item, kind) {
  const word = wordOf(kind)
  const makers = kind === 'anime'
    ? (item.studios || []).slice(0, 1).map((s) => `animated by ${s}`)
    : [listWords([...new Set((item.authors || []).map((a) => a && a.name).filter(Boolean))].slice(0, 2))].filter(Boolean).map((a) => `by ${a}`)
  const start = item.startYear ? `first out in ${item.startYear}` : ''
  const state =
    item.status === 'FINISHED' && item.endYear && item.endYear !== item.startYear
      ? `finished in ${item.endYear}`
      : item.status === 'RELEASING'
        ? 'still coming out'
        : item.status === 'HIATUS'
          ? 'on hiatus'
          : ''
  const count = kind === 'anime' ? item.episodes : item.chapters
  const length = count ? `at ${big(count)} ${count === 1 ? unitOf(kind).slice(0, -1) : unitOf(kind)}` : ''
  const tail = [start, state, length].filter(Boolean).join(', ')
  return `${item.title} is ${article(word)} ${word}${makers[0] ? ` ${makers[0]}` : ''}${tail ? `, ${tail}` : ''}.`
}

/** What it is about, in the record's own genres, and who leads it. */
function whoLine(item) {
  const genres = (item.genres || []).filter((g) => !isBlocked(g)).slice(0, 3).map((g) => g.toLowerCase())
  const leads = charactersOf(item).filter((c) => c.role === 'MAIN').slice(0, 2).map((c) => c.name)
  if (!genres.length && !leads.length) return ''
  if (!genres.length) return `It is led by ${listWords(leads)}.`
  return `It is ${listWords(genres)}${leads.length ? `, led by ${listWords(leads)}` : ''}.`
}

/** @returns {string[]} one or two lines */
export function titleSummary(item, kind) {
  return [whatLine(item, kind), whoLine(item)].filter(Boolean)
}
