/**
 * "Ranking": a top five, by genre or of what is still coming out, for one
 * section (manhwa, manga, manhua).
 *
 * Data: the titles of a section, ordered by how many AniList users have them
 * on a list (the record's popularity). One ranking for the ongoing titles of
 * each section and one for each common genre; each comes back at most every
 * two months, so the kind keeps moving through genres and sections.
 *
 * Image: TOP 5 and what it ranks, then five rows: the place, a small cover,
 * the title and the count.
 */
import { clip, compact, isDrawable, listOf } from '../text.mjs'
import { INNER } from '../render/parts.mjs'

export const TOP = 5
export const SECTIONS = ['manhwa', 'manga', 'manhua']
export const GENRES = ['Action', 'Romance', 'Fantasy', 'Comedy', 'Drama', 'Adventure', 'Supernatural', 'Slice of Life', 'Mystery', 'Sci-Fi', 'Horror', 'Sports']
const ROW_HEIGHT = 152
const THUMB = { width: 92, height: 130 }

/**
 * Every ranking on offer, a different section each time:
 * [{ key, heading, noun, titles }]. `titles` come in most popular first.
 */
export function scopesOf(titles) {
  const bySection = new Map(SECTIONS.map((section) => [section, titles.filter((t) => t.section === section && isDrawable(t.title))]))
  const kinds = [{ key: 'ongoing', word: 'ongoing', fits: (t) => t.status === 'RELEASING' }, ...GENRES.map((genre) => ({ key: genre.toLowerCase().replace(/[^a-z]+/g, '-'), word: genre.toLowerCase(), fits: (t) => t.genres.includes(genre) }))]
  return kinds
    .flatMap((kind) => SECTIONS.map((section) => ({ key: `${section}:${kind.key}`, heading: `${kind.word} ${section}`, noun: `${kind.word} ${section}`, titles: bySection.get(section).filter(kind.fits) })))
    .filter((scope) => scope.titles.length >= TOP)
}

function toPost(scope) {
  const five = scope.titles.slice(0, TOP)
  return {
    item: `rank:${scope.key}`,
    title: null,
    path: five[0].path,
    label: `${five[0].title}: where to read it`,
    tags: [five[0].section, 'top5'],
    names: five.map((t) => t.title),
    noun: scope.noun,
    art: { thumbs: five.map((t) => t.image) },
    view: { heading: scope.heading, rows: five.map((t, i) => ({ rank: i + 1, title: clip(t.title, 54), count: compact(t.popularity), score: t.score ? `${t.score}%` : null })) },
  }
}

const find = (data) => scopesOf(data.titles).map(toPost)

const captions = [
  (p) => [`The five most popular ${p.noun} on AniList right now: ${listOf(p.names)}.`],
  (p) => [`Top 5 ${p.noun}, by AniList readers: ${listOf(p.names)}.`],
  (p) => [`${p.names[0]} leads the ${p.noun} on AniList, ahead of ${listOf(p.names.slice(1, 4))}.`],
]

function template(v, k) {
  const t = k.tone('dark')
  const heading = v.heading.toUpperCase()
  return k.page(
    t,
    k.row(
      { alignItems: 'flex-end', height: 190 },
      k.display({ fontSize: 236, fontWeight: k.f.displayBlack, lineHeight: 0.8, color: t.pop, marginLeft: -8 }, 'TOP 5'),
    ),
    k.display({ fontSize: heading.length > 18 ? 58 : heading.length > 13 ? 72 : 88, fontWeight: k.f.displayBlack, lineHeight: 1, marginTop: 18 }, heading),
    k.col(
      { marginTop: 22 },
      v.rows.map((r, i) =>
        k.row(
          { alignItems: 'center', height: ROW_HEIGHT, borderTop: `2px solid ${t.line}` },
          k.display({ fontSize: 96, fontWeight: k.f.displayBlack, color: t.pop, width: 100, lineHeight: 1 }, r.rank),
          k.box({ width: THUMB.width, height: THUMB.height, alignItems: 'center', justifyContent: 'center', marginRight: 28, flexShrink: 0 }, k.art(v.art.thumbs[i], THUMB.width, THUMB.height)),
          k.col(
            { width: INNER - 100 - THUMB.width - 28 },
            k.display({ ...k.clamp(2), fontSize: r.title.length > 28 ? 36 : 46, lineHeight: 1.04 }, r.title),
            k.body({ fontSize: 25, color: t.soft, marginTop: 6 }, [r.score && `${r.score} score`, `${r.count} readers`].filter(Boolean).join(' · ')),
          ),
        ),
      ),
    ),
    k.fill(),
    k.body({ fontSize: 22, color: t.soft, marginBottom: 12 }, 'Ranked by readers on AniList'),
  )
}

export default { key: 'ranking', name: 'Ranking', urgent: false, gapDays: 60, titleGap: false, window: 1, find, captions, tags: (p) => p.tags, template }
