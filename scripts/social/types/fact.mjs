/**
 * "Fact card": one fact from a title's record, set very large.
 *
 * Data: only what the record states. Its place on AniList's all-time charts
 * (rated or popular), its average score, a long finished run, or that an
 * anime was made from it. A fact the record lacks is never offered. One post
 * per title and fact, and the title then rests for the 30-day title gap.
 *
 * Image: the night colour and type. The figure in the accent colour, the
 * sentence under a hairline, the title with a small cover at the foot.
 */
import { clip, fitSize, sentence } from '../text.mjs'
import { interleave } from '../source.mjs'
import { akaLine, aboutOf, ctaOf, genresLine, single, top, usable } from './shared.mjs'

export const MIN_POPULARITY = 5000
const TOP_RANK = 100
const HIGH_SCORE = 80
const LONG_RUN = 150
const COVER = { width: 300, height: 424 }
const FIGURE_STEPS = [[2, 360], [3, 320], [4, 260], [5, 210], [8, 170]]
const CTA = 'More about it and where to read it: link in the first comment'

/** AniList ranks a comic among manga, manhwa and manhua together; novels have their own chart. */
const chartOf = (t) => (t.section === 'novel' ? 'novels' : 'manga, manhwa and manhua')

/** Every fact the record supports: [{ kind, figure, line, say: [two wordings] }]. */
export function factsOf(t) {
  const facts = []
  const chart = chartOf(t)
  const rated = t.ranks.find((r) => r.type === 'RATED' && r.rank <= TOP_RANK)
  const popular = t.ranks.find((r) => r.type === 'POPULAR' && r.rank <= TOP_RANK)
  if (rated)
    facts.push({
      kind: 'rated',
      figure: `#${rated.rank}`,
      line: `highest rated of all time on AniList, among ${chart}`,
      say: [`${t.title} is number ${rated.rank} on AniList's all-time rating chart for ${chart}.`, `Number ${rated.rank} of all time: that is where AniList readers rate ${t.title} among ${chart}.`],
    })
  if (popular)
    facts.push({
      kind: 'popular',
      figure: `#${popular.rank}`,
      line: `most popular of all time on AniList, among ${chart}`,
      say: [`${t.title} is number ${popular.rank} on AniList's all-time popularity chart for ${chart}.`, `Number ${popular.rank} of all time: that is where ${t.title} stands for popularity on AniList, among ${chart}.`],
    })
  if (t.score >= HIGH_SCORE)
    facts.push({
      kind: 'score',
      figure: `${t.score}%`,
      line: 'average score from AniList readers',
      say: [`AniList readers give ${t.title} an average score of ${t.score}%.`, `${t.title} holds an average score of ${t.score}% on AniList.`],
    })
  if (t.status === 'FINISHED' && t.chapters >= LONG_RUN && t.year && t.endYear)
    facts.push({
      kind: 'run',
      figure: String(t.chapters),
      line: `chapters, from ${t.year} to ${t.endYear}`,
      say: [`${t.title} ran for ${t.chapters} chapters, from ${t.year} to ${t.endYear}.`, `${t.chapters} chapters: that is how long ${t.title} ran, from ${t.year} to ${t.endYear}.`],
    })
  if (t.verb === 'read' && t.adaptation)
    facts.push({
      kind: 'anime',
      figure: 'Anime',
      line: 'There is an anime version of it',
      say: [`There is an anime version of ${t.title}.`, `${t.title} was made into an anime.`],
    })
  return facts
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
    view: { figure: fact.figure, line: fact.line, title: clip(title.title, 60), meta: clip(metaOf(title), 44), about: { ...aboutOf(title, { genres: 2, alt: false }), rating: fact.kind === 'score' ? null : title.rating } },
  }
}

const find = (data) => interleave(data.titles.filter((t) => t.verb === 'read' && t.popularity >= MIN_POPULARITY && usable(t))).flatMap((t) => factsOf(t).map((fact) => toPost(t, fact)))

const readLine = (p, lead) => (p.sites.length ? `${lead} ${p.sites.join(', ')}.` : null)

const captions = [
  (p) => ({ hook: `💡 Did you know? ${p.say[0]}`, facts: [p.about, readLine(p, 'You can read it on'), ...p.more], cta: ctaOf('read', 0) }),
  (p) => ({ hook: `📊 ${p.say[1]}`, facts: [readLine(p, 'It is on'), ...p.more], cta: ctaOf('read', 1) }),
  (p) => ({ hook: `💡 Fact: ${p.say[0]}`, facts: [readLine(p, 'Official platforms:'), ...p.more], cta: ctaOf('read', 2) }),
]

const questions = [(p) => `Did you know that about ${p.title}?`, (p) => `Where does ${p.title} sit on your own list?`, (p) => `Has ${p.title} earned its place, in your view?`]

function template(v, k) {
  const t = k.tone('dark')
  return k.page(
    t,
    { cta: CTA },
    k.row({ justifyContent: 'space-between' }, k.kicker('Fact', { color: t.pop }), k.kicker(v.meta, { color: t.soft, fontSize: 22, letterSpacing: 3 })),
    k.display({ fontSize: fitSize(v.figure, FIGURE_STEPS), fontWeight: k.f.displayBlack, lineHeight: 0.86, marginTop: 44, marginLeft: -10, color: t.pop }, v.figure),
    k.rule(t.ink, 4, { marginTop: 32 }),
    k.display({ ...k.clamp(3), fontSize: v.line.length > 44 ? 54 : 68, lineHeight: 1.04, marginTop: 26, maxWidth: 920 }, v.line),
    k.fill(),
    k.row(
      { alignItems: 'flex-end', marginBottom: 26 },
      k.art(v.art.hero, COVER.width, COVER.height),
      k.col({ marginLeft: 36, width: 600 }, k.display({ ...k.clamp(3), fontSize: v.title.length > 26 ? 46 : 60, lineHeight: 1.04 }, v.title), k.about(v.about, t, { size: 28, width: 600, style: { marginTop: 18 } })),
    ),
  )
}

export default { key: 'fact', name: 'Fact card', urgent: false, gapDays: 300, titleGap: true, window: 150, find, captions, questions, tags: (p) => p.tags, template }
