# Internal linking plan (10 Oct 2026)

Source: measure.yml run 38061039441, label `links`, `scripts/measure-links.mjs`.
Counts are indexable pages only.

## What the numbers show

| group | pages | only 1 link in | depth 1-3 | depth 4-5 | depth 6+ |
|---|---|---|---|---|---|
| title | 116,622 | 20,776 | 8,012 | 103,840 | 4,770 |
| like | 79,608 | 61,855 | 1,055 | 34,217 | 44,336 |
| characters | 14,905 | 3,921 | 795 | 12,480 | 1,630 |
| free | 11,197 | 9,364 | 448 | 7,773 | 2,976 |
| character | 151,397 | 0 | 10,426 | 138,035 | 2,936 |

- No orphans: every indexable page has at least 1 link in.
- 22,118 title pages get links ONLY from noindexed pages or hubs.
- Most pages sit 4-5 clicks from home. Guidance says 3 or fewer.
- Links pile on a few big titles (/manga/dandadan 28,142 in).
- `/character/narrator` has 14,193 links in: one generic "Narrator" page
  collects every story's narrator. Looks like a merge of unrelated people.

## Next changes (not built yet; wait 2-3 weeks so Google can read the current round)

1. **Give the 22,118 weakly linked titles links from indexed pages.** In the
   "similar" and "more by the author/studio" modules on indexed title pages,
   prefer picks with few links in. Helps 22,118 titles.
2. **Cut click depth to 3.** Add browse paths from home: A-Z and year/genre
   hub pages with enough per page, linked from the footer. Helps ~104k titles
   and ~138k characters now at depth 4-5.
3. **Fix `/character/narrator`.** Check the slug merge; split per story or
   stop linking generic role names. Removes 14k junk links.
4. **Spread links off the top titles.** Cap how often one title appears in
   related modules site-wide. Frees link weight for the long tail.
5. **/like and /free get one link each (from their title page).** Fine for
   now; revisit only if they show impressions in GSC.
