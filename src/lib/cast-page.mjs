/**
 * The words on a title's cast page (/<kind>/<slug>/characters): one line per
 * main character and a short cast summary, every clause gated on a field the
 * title record holds (the cast list, plus the build-time fields from
 * src/lib/cast-facts.mjs). Request time, string work over one record.
 *
 * Returned as HTML with every name escaped, because the lines carry links to
 * other character pages; `text` is the same words without the tags.
 */
import { listWords } from './answers.mjs'

const big = (n) => Number(n).toLocaleString('en-GB')
const esc = (text) =>
  String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
export const plainOf = (html) =>
  html.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
const link = (slug, name) => `<a href="/character/${esc(slug)}">${esc(name)}</a>`

/** "voiced by A in Japanese and B in English" (an anime only). */
function voiced(c, anime) {
  if (!anime) return ''
  const parts = [c.voice ? `${esc(c.voice)} in Japanese` : '', c.voiceEn ? `${esc(c.voiceEn)} in English` : '']
  return parts.some(Boolean) ? `voiced by ${listWords(parts.filter(Boolean))}` : ''
}

/** One lead: what we hold about them beyond the face. Empty when we hold nothing. */
export function leadLine(c, { anime = false } = {}) {
  const bits = []
  const voice = voiced(c, anime)
  if (voice) bits.push(voice)
  if (c.more?.n > 0) {
    bits.push(`in ${c.more.n} other ${c.more.n === 1 ? 'title' : 'titles'} too${!c.more.top ? '' : c.more.kind ? `, ${c.more.n === 1 ? "" : "among them "}the ${c.more.kind} ${esc(c.more.top)}` : `, the best known ${esc(c.more.top)}`}`)
  } else if (c.more) {
    bits.push('in no other title AniList lists')
  }
  const sayer = c.va?.en ? c.voiceEn : c.voice
  const va = c.va && sayer && anime ? ` ${esc(sayer)} also voices ${link(c.va.slug, c.va.name)}.` : ''
  if (!bits.length && !va) return ''
  const head = bits.length ? `${link(c.slug, c.name)}: ${bits.join('; ')}.` : `${link(c.slug, c.name)}.`
  return head + va
}

/** The cast in numbers, from the record's own cast list and castFacts. */
export function castSummary(item, cast, { anime = false } = {}) {
  const leads = cast.filter((c) => c.role === 'MAIN').length
  const out = [`${big(cast.length)} named characters${leads ? `, ${leads} of them ${leads === 1 ? 'a lead' : 'leads'}` : ''}.`]
  if (anime) {
    const jp = cast.filter((c) => c.voice).length
    const en = cast.filter((c) => c.voiceEn).length
    if (jp || en) {
      out.push(`${listWords([jp ? `${big(jp)} with a Japanese voice` : '', en ? `${big(en)} with an English one` : ''].filter(Boolean))}.`)
    }
  }
  for (const part of item.castFacts?.shared || []) {
    out.push(`${big(part.n)} of them also appear in ${esc(part.title)}.`)
  }
  const top = item.castFacts?.top
  if (top) out.push(`The most favourited face is ${link(top.slug, top.name)}, on ${big(top.favourites)} AniList favourites lists.`)
  return out.join(' ')
}
