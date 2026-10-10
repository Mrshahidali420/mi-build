#!/usr/bin/env node
/**
 * The title sub-pages, measured like the title and character pages:
 * /characters (Step 4), /like (Step 5) and /free (Step 6). Text only, built
 * from the title shards the way each page builds it.
 *
 *   node scripts/measure-subpages.mjs --mode new --label step6-after
 *   MEASURE_ANSWERS=<copy of the old answers.mjs> node scripts/measure-subpages.mjs --mode old --label step6-before
 *
 * old: the lines those pages printed before Steps 4-6 (the old like/free
 *      answers come from MEASURE_ANSWERS, the old cast lines are below).
 * Also prints the size of the title and character shards, so a CI run after
 * a build reports what the new fields cost.
 */
import { readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { summarize } from './measure-core.mjs'
import { loadSample } from './measure-shards.mjs'
import { sectionOf } from '../src/lib/section.mjs'
import { hasCastPage, hasLikePage, hasFreePage } from '../src/lib/gates.mjs'
import { charactersOf } from '../src/lib/format.js'
import { leadLine, castSummary, plainOf } from '../src/lib/cast-page.mjs'
import { likeAnswer } from '../src/lib/like-answer.mjs'
import { freeAnswer } from '../src/lib/free-answer.mjs'
import { titleSummary } from '../src/lib/title-summary.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const bytesOf = (dir) => readdirSync(dir).reduce((n, f) => n + statSync(join(dir, f)).size, 0)

function castText(item, kind, mode) {
  const cast = charactersOf(item)
  const leads = cast.filter((c) => c.role === 'MAIN')
  if (mode === 'old') {
    const names = leads.slice(0, 3).map((c) => c.name)
    const voices = (kind === 'anime' ? leads : []).filter((c) => c.voice).slice(0, 3)
      .map((c) => `${c.name} is voiced by ${c.voice} in Japanese${c.voiceEn ? ` and ${c.voiceEn} in English` : ''}`)
    return [
      `${item.title} has ${cast.length} named characters on record${names.length ? `, led by ${names.join(', ')}` : ''}. Tap any face for that character's own page: age, height, birthday, and every other story they turn up in.${voices.length ? ` Voice actors: ${voices.join('; ')}.` : ''}`,
      leads.length ? 'The people the story is about.' : '',
      'Supporting and background faces, in the order AniList lists them.',
    ].join(' ')
  }
  const anime = kind === 'anime'
  return [plainOf(castSummary(item, cast, { anime })), ...leads.map((c) => plainOf(leadLine(c, { anime })))].join(' ')
}

function likeText(answer, mode) {
  const why = answer.picks.map((p) => (mode === 'old' ? (p.shared?.length ? `Shares ${p.shared.join(', ')} with the title.` : '') : p.reason ? `${p.reason}.` : ''))
  return [answer.lede, ...why, ...answer.paragraphs.map((p) => p.text)].join(' ')
}

function freeText(item, kind, answer, mode) {
  const own = [answer.lede, ...answer.paragraphs.map((p) => p.text)]
  return (mode === 'old' ? own : [...own, ...titleSummary(item, kind)]).join(' ')
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') ? true : all[i + 1] ?? true] : null)).filter(Boolean))
  const mode = args.mode === 'old' ? 'old' : 'new'
  const old = mode === 'old' ? await import(pathToFileURL(process.env.MEASURE_ANSWERS || join(ROOT, 'src', 'lib', 'answers.mjs')).href) : null
  const records = loadSample({ n: Number(args.n) || 3000, files: Number(args.files) || 60, seed: 11 })
  const rows = { characters: [], like: [], free: [] }
  for (const item of records) {
    const kind = sectionOf(item)
    const names = [item.title, ...(item.similar || []).map((p) => p.title), ...charactersOf(item).map((c) => c.name)]
    if (hasCastPage(item)) rows.characters.push({ site: castText(item, kind, mode), other: '', names })
    if (hasLikePage(item)) rows.like.push({ site: likeText((old?.likeAnswer || likeAnswer)(item, kind), mode), other: '', names })
    if (hasFreePage(item)) {
      const answer = (old?.freeAnswer || freeAnswer)(item, kind)
      const synopsis = mode === 'old' ? String(item.description || '') : ''
      rows.free.push({ site: freeText(item, kind, answer, mode), other: synopsis, names: [...names, ...answer.free.map((r) => r.link.site)] })
    }
  }
  const report = Object.fromEntries(Object.entries(rows).map(([page, list]) => [page, summarize(list)]))
  const shards = { titleBytes: bytesOf(join(ROOT, 'public', 'd', 't')), characterBytes: bytesOf(join(ROOT, 'public', 'd', 'c')) }
  for (const [page, r] of Object.entries(report)) {
    console.log(`${page.padEnd(11)} pages ${String(r.pages).padStart(5)}  words median ${r.medianSiteWords}  near-dup ${r.nearDupRate}  top ${r.topSentences[0]?.share ?? 0} "${(r.topSentences[0]?.sentence || '').slice(0, 70)}"`)
  }
  console.log(`shards: titles ${shards.titleBytes} bytes, characters ${shards.characterBytes} bytes`)
  if (args.dry) return
  const date = new Date().toISOString().slice(0, 10)
  const label = args.label || mode
  const file = join(ROOT, 'tasks', 'measure', `${date}-${label}.json`)
  mkdirSync(dirname(file), { recursive: true })
  // Same shape as the other measures ({ report: { own: {...} } }) so
  // measure-summary.mjs prints it too.
  writeFileSync(file, JSON.stringify({ date, label, mode, sample: records.length, shards, report: { own: report } }, null, 2))
  console.log(`wrote ${file}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
