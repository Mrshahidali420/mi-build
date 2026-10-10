/**
 * The questions a person types after a character's name: "who is X", "who
 * voices X", "what manga is X from", "where do I read it".
 *
 * A question is asked only when this record holds its own answer, and the
 * answer is said in this character's facts, not in words every page shares.
 * The old answers each ended on a line like "This is the cast credit AniList
 * gives for the anime.", the same on 170,000 pages; the source is said once,
 * on the page, and the answers keep only what is specific. What the Profile
 * paragraph already says (how many titles, who they share them with, other
 * roles of the same voice, how the story stands) is not asked again here.
 *
 * Request time, like the rest of the page: string work over one record and
 * the lead title the page has already loaded.
 *
 * `lead` is the appearance row for the title the character matters most in.
 * `series` is that title's own record, or null when it could not be loaded.
 * `bio` is the character's description as plain text, already shortened.
 * `facts` is parseFacts(description).facts: the bio's own fact lines.
 */
import { displayName } from './names.mjs'
import { ageOf } from './age.mjs'
import { sectionOf } from './section.mjs'
import { wordOf, verbOf, listWords, uniqueBySite, linksOf } from './answers.mjs'

const ROLE = { MAIN: 'main character', SUPPORTING: 'supporting character', BACKGROUND: 'background character' }
const TITLES_SHOWN = 3

const withYear = (row) => (row.year ? `${row.title} (${row.year})` : row.title)
const article = (word) => (/^[aeiou]/i.test(word) ? 'an' : 'a')

/** "A, B and C", or "A, B, C and 4 more". */
function someTitles(rows, show = TITLES_SHOWN) {
  const names = [...new Set(rows.map(withYear))]
  if (names.length <= show) return listWords(names)
  return `${names.slice(0, show).join(', ')} and ${names.length - show} more`
}

function voiceQ(who, person, field, lang) {
  const voice = person.appearsIn.find((a) => a[field])?.[field]
  if (!voice) return null
  const rows = person.appearsIn.filter((a) => a[field] === voice)
  return {
    q: lang === 'en' ? `Who voices ${who} in English?` : `Who voices ${who}?`,
    a: `${voice} voices ${who} ${lang === 'en' ? 'in the English dub' : 'in Japanese'} of ${someTitles(rows)}.`,
  }
}

function animeQ(who, person, lead, leadKind) {
  if (leadKind === 'anime') return null
  const anime = person.appearsIn.filter((a) => sectionOf(a) === 'anime')
  if (!anime.length) return null
  return {
    q: `Is there an anime of ${lead.title}?`,
    a: `Yes, ${who} appears in ${anime.length === 1 ? 'the anime' : `${anime.length} anime:`} ${someTitles(anime)}.`,
  }
}

/** Asked of a lead, or of a side character who leads another title: never just to say "No" twice. */
function mainQ(who, person, lead) {
  if (lead.role !== 'MAIN' && lead.role !== 'SUPPORTING') return null
  const q = `Is ${who} the main character of ${lead.title}?`
  const elsewhere = person.appearsIn.filter((a) => a.role === 'MAIN' && a.title !== lead.title)
  if (lead.role !== 'MAIN' && !elsewhere.length) return null
  if (lead.role === 'MAIN') {
    const more = elsewhere.length ? `, and of ${someTitles(elsewhere, 2)}` : ''
    return { q, a: `Yes, ${who} is a main character of ${lead.title}${more}.` }
  }
  const but = elsewhere.length ? `, but leads ${someTitles(elsewhere, 2)}` : ''
  return { q, a: `No, ${who} is a supporting character in ${lead.title}${but}.` }
}

function nameQ(who, person, formal, alternates) {
  if (!person.aliases?.length && !person.native) return null
  // The native spelling has its own sentence, so it is left out of the list.
  const tidy = (text) => String(text || '').replace(/\s+/g, ' ').trim()
  const other = alternates.filter((name) => tidy(name) !== tidy(person.native)).slice(0, 4)
  return {
    q: `What is ${who}'s full name?`,
    a:
      (formal ? `Fans write it ${who}, family name first. AniList lists the full name as ${formal}.` : `The full name is ${who}.`) +
      (person.native ? ` In the original script it is written ${person.native}.` : '') +
      (other.length ? ` ${who} is also called ${listWords(other)}.` : ''),
  }
}

function bioFactQs(who, facts) {
  const factOf = (label) => (facts.find((f) => f.label === label)?.value || '').replace(/[.\s]+$/, '')
  const out = []
  const workLabel = ['Occupation', 'Position', 'Rank'].find((label) => factOf(label))
  if (workLabel) {
    const noun = workLabel.toLowerCase()
    out.push({ q: `What is ${who}'s ${noun}?`, a: `${who}'s ${noun}: ${factOf(workLabel)}.` })
  }
  if (factOf('Affiliation')) out.push({ q: `What group is ${who} in?`, a: `${who} is affiliated with ${factOf('Affiliation')}.` })
  return out
}

export function characterFaq(person, lead, leadKind, series, bio = '', height = '', voice = '', facts = [], voiceEn = '') {
  const word = wordOf(leadKind)
  const verb = verbOf(leadKind)
  // The name the page leads with, so every question matches the h1.
  const { primary: who, formal, alternates } = displayName(person)
  const role = ROLE[lead.role] || 'character'
  const authors = listWords((series?.authors || []).map((a) => a.name).filter(Boolean).slice(0, 3))
  const age = ageOf(person.age)
  const sites = series ? uniqueBySite(linksOf(series)).map((l) => l.site) : []
  // voice and voiceEn are what the page found; the rows say where.
  const rows = { ...person, appearsIn: person.appearsIn || [] }

  return [
    // Without a bio the answer is the line the page opens with; asked only
    // when AniList's bio gives it something to say.
    bio && {
      q: `Who is ${who}?`,
      a: `${who} is ${article(role)} ${role} in the ${word} ${lead.title}. ${bio}`,
    },
    age && {
      q: `How old is ${who}?`,
      a: age.plain ? `${who} is ${age.text}.` : `AniList gives ${who}'s age as "${age.text}".`,
    },
    height && { q: `How tall is ${who}?`, a: `${who} is ${height}.` },
    person.birthday && { q: `When is ${who}'s birthday?`, a: `${who}'s birthday is ${person.birthday}.` },
    voice ? voiceQ(who, rows, 'voice', 'jp') : null,
    voiceEn ? voiceQ(who, rows, 'voiceEn', 'en') : null,
    ...bioFactQs(who, facts),
    {
      q: `What ${word} is ${who} from?`,
      a: `${lead.title}, ${article(word)} ${word}${authors ? ` by ${authors}` : ''}${series?.startYear ? ` that started in ${series.startYear}` : ''}.`,
    },
    sites.length ? { q: `Where can I ${verb} ${lead.title}?`, a: `${lead.title} is on ${listWords(sites)}.` } : null,
    animeQ(who, rows, lead, leadKind),
    nameQ(who, person, formal, alternates),
    mainQ(who, rows, lead),
  ].filter(Boolean)
}
