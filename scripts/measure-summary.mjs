#!/usr/bin/env node
/**
 * A short markdown table from measure JSON files (measure-shards.mjs and
 * measure-characters.mjs both write { report: { own, page, ... } }), for the
 * GitHub Actions step summary. Small on purpose: the numbers, not the dump.
 *
 *   node scripts/measure-summary.mjs tasks/measure/a.json tasks/measure/b.json
 */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

const pct = (n) => (typeof n === 'number' ? `${Math.round(n * 1000) / 10}%` : '-')

function table(file) {
  const { label, sample, report } = JSON.parse(readFileSync(file, 'utf8'))
  const lines = [`### ${label || basename(file)} (${sample} pages)`, '', '| scope | group | pages | own words median | site share | near-dup | top sentence |', '|---|---|---|---|---|---|---|']
  for (const scope of ['own', 'page']) {
    for (const [group, r] of Object.entries(report[scope] || {})) {
      const top = r.topSentences?.[0]
      lines.push(`| ${scope} | ${group} | ${r.pages} | ${r.medianSiteWords} | ${pct(r.siteShare)} | ${pct(r.nearDupRate)} | ${top ? `${pct(top.share)} "${top.sentence.slice(0, 60).replace(/\|/g, '/')}"` : '-'} |`)
    }
  }
  return lines.join('\n')
}

console.log(process.argv.slice(2).map(table).join('\n\n'))
