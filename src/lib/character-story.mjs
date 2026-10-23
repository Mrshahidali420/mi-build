/**
 * "The story" paragraph on a character page: what the lead title is, in a few
 * plain sentences, under the character's own profile.
 *
 * Most character pages have no AniList bio (under 1% of the thin ones have
 * one, checked 23 Oct 2026), so a reader who lands on one learns little beyond
 * a name and a title. The lead title's record, which the page has already
 * loaded, says how the story stands, whether it has an anime or a manga
 * behind it, where it sits in a series and what else grew out of it.
 *
 * The sentences are the title page's own (src/lib/prose-story.mjs): same
 * facts, same rules, nothing random, nothing guessed. Only the few that tell a
 * reader most are kept. Plain text: the page escapes it.
 */
import { runFact, adaptFact, chainFact, relativesFact, themesFact } from './prose-story.mjs'
import { render } from './prose.mjs'

export const STORY_MAX = 3

// Printed in this order whatever their weight: what it became, where it sits,
// how it stands, what else there is.
const ORDER = ['adapt', 'chain', 'run', 'relatives', 'themes']

/**
 * @param series the lead title's record, as the page loaded it
 * @param kind 'manhwa' | 'manga' | 'manhua' | 'novel' | 'anime'
 * @param opts.yearSaid true when the profile already gave the story's years
 * @param opts.hasLinks true when the page lists an official place to read or watch
 * @returns {string} the paragraph, or '' when the record holds nothing to say
 */
export function characterStory(series, kind, { yearSaid = false, hasLinks = false } = {}) {
  if (!series?.title) return ''
  const picked = [
    adaptFact(series, kind, hasLinks),
    chainFact(series, kind),
    runFact(series, kind, yearSaid),
    relativesFact(series),
    kind === 'anime' ? themesFact(series) : null,
  ]
    .filter((f) => f && f.sentence)
    .sort((a, b) => b.weight - a.weight || ORDER.indexOf(a.key) - ORDER.indexOf(b.key))
    .slice(0, STORY_MAX)
    .sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key))
  if (!picked.length) return ''
  const text = render(picked.map((f) => f.sentence), series.title)
  // Some sentences never name the story ("All 12 episodes aired..."). Alone
  // under a character's profile they need to say which story they mean.
  return text.includes(series.title) ? text : `In ${series.title}, ${text.charAt(0).toLowerCase()}${text.slice(1)}`
}
