/**
 * "Fact card": the one fact about a title that is worth stopping for.
 *
 * Data: only what the record states. Every fact a title supports is given a
 * strength, and only the strongest is offered: a place in the top 50 of
 * AniList's all-time charts, a long finished run counted in chapters or in
 * years, many years between the first chapter and the anime of the same
 * name, or a very high average score. A title with no strong fact gets no
 * card. (The record holds no trustworthy yearly or genre rank, so those are
 * not used.) One post per title and fact, and the title then rests for the
 * 30-day title gap.
 *
 * Image: the night colour and type. The figure in the accent colour is the
 * surprising part; the sentence under it names the title; the cover and the
 * labelled lines sit at the foot.
 */
import { clip, fitSize, sentence } from '../text.mjs'
import { interleave } from '../source.mjs'
import { akaLine, aboutOf, ctaOf, genresLine, single, top, usable } from './shared.mjs'

export const MIN_POPULARITY = 5000
export const TOP_RANK = 50
export const HIGH_SCORE = 88
export const LONG_RUN = 300
export const LONG_YEARS = 15
export const ANIME_WAIT = 10
const NAME_MAX = 46
const COVER = { width: 290, height: 410 }
const FIGURE_STEPS = [[2, 320], [3, 280], [4, 230], [5, 190], [8, 140], [10, 112]]
const CTA = 'More about it and where to read it: link in the first comment'

/** AniList ranks a comic among manga, manhwa and manhua together; novels have their own chart. */
const chartOf = (t) => (t.section === 'novel' ? 'novels' : 'manga, manhwa and manhua')

/**
 * Every strong fact the record supports, strongest first:
 * [{ kind, strength, figure, line, say: [two wordings] }]. `line` goes on
 * the image and names the title; `say` opens the caption.
 */
export function factsOf(t) {
  const name = clip(t.title, NAME_MAX)
  const chart = chartOf(t)
  const facts = []
  const rated = t.ranks.find((r) => r.type === 'RATED' && r.rank <= TOP_RANK)
  const popular = t.ranks.find((r) => r.type === 'POPULAR' && r.rank <= TOP_RANK)
  const done = t.status === 'FINISHED' && t.year && t.endYear
  const years = done ? t.endYear - t.year : 0
  const wait = t.animeYear && t.year ? t.animeYear - t.year : 0
  if (rated)
    facts.push({
      kind: 'rated',
      strength: 100 - rated.rank,
      figure: `#${rated.rank}`,
      line: `${name} is number ${rated.rank} on AniList's all-time rating chart for ${chart}`,
      say: [`${t.title} is number ${rated.rank} on AniList's all-time rating chart for ${chart}.`, `Number ${rated.rank} of all time: that is where AniList readers rate ${t.title} among ${chart}.`],
    })
  if (popular)
    facts.push({
      kind: 'popular',
      strength: 95 - popular.rank,
      figure: `#${popular.rank}`,
      line: `${name} is number ${popular.rank} on AniList's all-time popularity chart for ${chart}`,
      say: [`${t.title} is number ${popular.rank} on AniList's all-time popularity chart for ${chart}.`, `Number ${popular.rank} of all time: that is where ${t.title} stands for popularity on AniList, among ${chart}.`],
    })
  if (wait >= ANIME_WAIT)
    facts.push({
      kind: 'wait',
      strength: 60 + Math.min(30, wait),
      figure: `${wait} years`,
      line: `between the first chapter of ${name} (${t.year}) and its anime (${t.animeYear})`,
      say: [`${wait} years passed between the first chapter of ${t.title} (${t.year}) and its anime (${t.animeYear}).`, `${t.title} began in ${t.year}. Its anime came ${wait} years later, in ${t.animeYear}.`],
    })
  if (done && t.chapters >= LONG_RUN)
    facts.push({
      kind: 'run',
      strength: 55 + Math.min(35, Math.round(t.chapters / 50)),
      figure: String(t.chapters),
      line: `chapters of ${name}, published from ${t.year} to ${t.endYear}`,
      say: [`${t.title} ran for ${t.chapters} chapters, from ${t.year} to ${t.endYear}.`, `${t.chapters} chapters: that is how long ${t.title} ran, from ${t.year} to ${t.endYear}.`],
    })
  if (years >= LONG_YEARS)
    facts.push({
      kind: 'years',
      strength: 50 + Math.min(35, years),
      figure: `${years} years`,
      line: `in print: ${name} ran from ${t.year} to ${t.endYear}`,
      say: [`${t.title} ran for ${years} years, from ${t.year} to ${t.endYear}.`, `${years} years: ${t.title} ran from ${t.year} to ${t.endYear}.`],
    })
  if (t.score >= HIGH_SCORE)
    facts.push({
      kind: 'score',
      strength: 45 + (t.score - HIGH_SCORE) * 3,
      figure: t.rating,
      line: `out of 10: the average score AniList readers give ${name}`,
      say: [`AniList readers give ${t.title} an average score of ${t.rating} out of 10.`, `${t.title} holds an average score of ${t.rating} out of 10 on AniList.`],
    })
  return facts.sort((x, y) => y.strength - x.strength)
}

const metaOf = (t) => [t.noun, t.year].filter(Boolean).join(' · ')

function toPost(title, fact) {
  return {
    ...single(title),
    item: `fact:${title.id}:${fact.kind}`,
    label: 'Where to read it',
    say: fact.say,
    // The score is the fact itself on a score card, so it is not said twice.
    more: [fact.kind !== 'score' && title.rating && `It holds ${title.rating} out of 10 on AniList.`, genresLine(title), akaLine(title)],
    about: title.year && title.noun ? sentence(`It is ${/^[aeiou]/i.test(title.noun) ? 'an' : 'a'} ${title.noun} from ${title.year}`) : null,
    sites: top(title.platforms),
    art: { hero: title.image },
    view: { figure: fact.figure, line: fact.line, meta: clip(metaOf(title), 44), about: { ...aboutOf(title, { genres: 2, alt: false }), rating: fact.kind === 'score' ? null : title.rating } },
  }
}

const find = (data) => interleave(data.titles.filter((t) => t.verb === 'read' && t.popularity >= MIN_POPULARITY && usable(t))).flatMap((t) => factsOf(t).slice(0, 1).map((fact) => toPost(t, fact)))

const readLine = (p, lead) => (p.sites.length ? `${lead} ${p.sites.join(', ')}.` : null)

const captions = [
  (p) => ({ hook: `💡 Did you know? ${p.say[0]}`, facts: [readLine(p, 'You can read it on'), p.about, ...p.more], cta: ctaOf('read', 0) }),
  (p) => ({ hook: `📊 ${p.say[1]}`, facts: [readLine(p, 'It is on'), ...p.more], cta: ctaOf('read', 1) }),
  (p) => ({ hook: `💡 Fact: ${p.say[0]}`, facts: [readLine(p, 'Official platforms:'), ...p.more], cta: ctaOf('read', 2) }),
]

const questions = [(p) => `Did you know that about ${p.title}?`, (p) => `Where does ${p.title} sit on your own list?`, (p) => `Has ${p.title} earned its place, in your view?`]

function template(v, k) {
  const t = k.tone('dark')
  return k.page(
    t,
    { cta: CTA },
    k.kicker('Fact', { color: t.pop }),
    k.display({ fontSize: fitSize(v.figure, FIGURE_STEPS), fontWeight: k.f.displayBlack, lineHeight: 0.9, marginTop: 40, marginLeft: -10, color: t.pop }, v.figure),
    k.rule(t.ink, 4, { marginTop: 32 }),
    k.display({ ...k.clamp(4), fontSize: v.line.length > 70 ? 44 : 52, lineHeight: 1.12, marginTop: 26, maxWidth: 936 }, v.line),
    k.fill(),
    k.row(
      { alignItems: 'flex-end', marginBottom: 26 },
      k.art(v.art.hero, COVER.width, COVER.height),
      k.col({ marginLeft: 34, width: 612 }, k.body({ fontSize: 26, color: t.soft, fontWeight: k.f.textBold }, v.meta), k.about(v.about, t, { size: 26, width: 612, style: { marginTop: 14 } })),
    ),
  )
}

export default { key: 'fact', name: 'Fact card', urgent: false, gapDays: 300, titleGap: true, window: 150, find, captions, questions, tags: (p) => p.tags, template }
