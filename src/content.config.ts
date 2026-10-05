/*
 * HOW TO ADD A GUIDE
 * ==================
 *
 * 1. Make one Markdown file: src/content/guides/<slug>.md. The file name is
 *    the URL: naruto-strongest-characters.md -> /guides/naruto-strongest-characters
 *
 * 2. Frontmatter (every field is checked by the schema below; a wrong one
 *    stops the build with a clear message):
 *
 *    ---
 *    title: Naruto Strongest Characters Ranked
 *    description: 150 to 160 characters. It is the meta description and the
 *      line under the guide on the hub.
 *    category: power-scaling   # power-scaling | versus | ranks-and-powers |
 *                              # watch-order | cosplay | recommendations |
 *                              # beginner | data
 *    keywords: [strongest naruto characters, who is the strongest in naruto]
 *    updated: 2026-10-04
 *    hero:
 *      media: 1735             # AniList media id: its banner is the big picture
 *      alt: Naruto Shippuden key art
 *    entries:
 *      - rank: 1               # leave out for an unranked list
 *        character: 126069     # AniList character id (or media: <id> for a title)
 *        media: 1735           # optional: the series to show; default is the
 *                              # character's most popular title
 *        heading: Kaguya Otsutsuki
 *        text: >-
 *          The written paragraph for this card. Plain text, no Markdown.
 *        stats:
 *          - { label: Peak form, value: Rabbit Goddess }
 *    faq:
 *      - q: Who is the strongest character in Naruto?
 *        a: The answer, in plain sentences.
 *    related: [easy-anime-cosplay-ideas]   # optional: slugs of other guides
 *    ---
 *
 * 3. Body = the written guide in Markdown: intro, method, sections, verdict.
 *    Use ## for section headings (the page owns the one H1). Put a line
 *
 *        <!-- entries -->
 *
 *    where the ranked cards belong. Without it the cards go after the first
 *    two paragraphs.
 *
 * 4. Find AniList ids. Open https://anilist.co, search the character, and the
 *    number in the address is the id (anilist.co/character/17/Naruto-Uzumaki
 *    -> 17). Or ask the API (POST https://graphql.anilist.co):
 *
 *      query { Page(perPage: 5) { characters(search: "Itachi Uchiha") {
 *        id name { full } media(perPage: 2) { nodes { id title { romaji } } } } } }
 *
 *    Check the name that comes back: some are filed under another name
 *    (Obito is "Tobi" 3149, Nagato is "Pain" 3180).
 *
 * 5. Run `npm run guides:media`. It fetches names and pictures for any new id
 *    from AniList, finds each one's page on this site, and rewrites
 *    data/guide-media.json and data/guide-index.json. Commit both files with
 *    the guide. `npm test` fails while the index is out of step with the
 *    guides, so a forgotten step shows up before the build.
 *
 * Data guides (pages built from the catalog, not Markdown) are listed by hand
 * in src/lib/guides-registry.js so the hub and the sitemap include them.
 */
import { defineCollection, z } from 'astro:content'
import { glob } from 'astro/loaders'
import { CATEGORY_KEYS } from './lib/guides.mjs'

const stat = z.object({ label: z.string().min(1), value: z.string().min(1) })

const entry = z
  .object({
    rank: z.number().int().positive().optional(),
    character: z.number().int().positive().optional(),
    media: z.number().int().positive().optional(),
    heading: z.string().min(1),
    text: z.string().min(1),
    alt: z.string().optional(),
    stats: z.array(stat).optional(),
  })
  .refine((e) => e.character || e.media, { message: 'each entry needs a character id or a media id' })

const guides = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/guides' }),
  schema: z.object({
    title: z.string().min(10).max(90),
    description: z.string().min(140).max(170),
    category: z.enum(CATEGORY_KEYS as [string, ...string[]]),
    keywords: z.array(z.string()).default([]),
    updated: z.coerce.date(),
    hero: z
      .object({
        media: z.number().int().positive().optional(),
        character: z.number().int().positive().optional(),
        alt: z.string().optional(),
      })
      .default({}),
    entries: z.array(entry).default([]),
    faq: z.array(z.object({ q: z.string().min(1), a: z.string().min(1) })).default([]),
    related: z.array(z.string()).default([]),
  }),
})

export const collections = { guides }
