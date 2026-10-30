# Facebook Page posting

The workflow **Facebook Page post** (`.github/workflows/fb-post.yml`) shares one
title page at a time on the site's Facebook Page:

- a post with the cover picture and a short caption made from real facts
- then, straight away, a first comment with the link, for example
  `Where to read it: https://manhwaindex.com/manhwa/solo-leveling-105398`

One long workflow run does the posting: it posts, waits and posts again, then
starts the next run (see "How it paces the day"). It never runs on a push.

Nothing goes to Facebook until you finish the steps below **and** switch it on.
Until then every run is green and only shows what it would post.

Do every step from your own phone or PC, by hand. Never let a tool or a
browser robot log in to Facebook for you.

## 1. Make the Page

In the Facebook app: Menu → Pages → Create.

- Name: **Manhwa Index**
- Category: **Entertainment website**
- Bio: *Where to read manhwa, manga and manhua legally, and what to read next.*
- Website: `https://manhwaindex.com`
- Profile picture: the site logo. Cover: any wide site banner.

Leave out your phone number, email, city and any personal detail.

## 2. Make a Meta developer app

1. Go to developers.facebook.com and log in with the same Facebook account.
2. My Apps → Create app. Pick the **Business** type (or the use case
   "Manage everything on your Page"). Name it e.g. *Manhwa Index poster*.
3. In the app, add the Pages permissions below (App Review is not needed for
   a Page you manage yourself; Standard access is enough):
   - `pages_show_list`
   - `pages_read_engagement`
   - `pages_manage_posts`
   - `pages_manage_engagement`
4. App settings → Basic: set the Privacy Policy URL to
   `https://manhwaindex.com/privacy`, then switch the app from
   **Development** to **Live** at the top of the dashboard.
   Why: Meta's docs say posts made by an app in Development mode are only
   seen by people who have a role on the app. Live makes them public.

## 3. Get a Page token that does not expire

1. Open the **Graph API Explorer** (developers.facebook.com/tools/explorer).
2. Pick your app. Under "User or Page", choose **Get User Access Token** and
   tick the four permissions from step 2. Approve the pop-up.
3. Copy that token into the **Access Token Debugger**
   (developers.facebook.com/tools/debug/accesstoken) and press
   **Extend Access Token** at the bottom. You now have a long-lived user token.
4. Back in the Explorer, paste the long-lived token and run
   `me/accounts`. Find the Page in the answer. Copy its `id` (the Page ID)
   and its `access_token` (the Page token).
5. Check the Page token in the Debugger: it should say **Expires: Never** and
   list the four permissions.

Keep the token private. Do not paste it in a chat, an email or a file.

## 4. Put it in GitHub

Repo → Settings → Secrets and variables → Actions.

Secrets (tab "Secrets"):

| Name | Value |
|---|---|
| `FB_PAGE_ID` | the Page ID |
| `FB_PAGE_TOKEN` | the Page token |

Variables (tab "Variables"):

| Name | Value |
|---|---|
| `FB_POST_ENABLED` | `false` for now |
| `FB_POSTS_PER_DAY` | `4` to start. Raise it by hand as reach allows; the most it accepts is `24` (one an hour) |

## 5. Test, then switch on

1. Actions → **Facebook Page post** → Run workflow. Tick `dry_run`.
2. Open the run and read the summary. It should say the token works for your
   Page and show sample posts with their first comment.
3. When you like what you see, set the variable `FB_POST_ENABLED` to `true`.
4. Start the chain: Run workflow again with nothing filled in. Within half
   an hour the backstop would start it by itself.

To stop: set `FB_POST_ENABLED` back to `false` **and** cancel the running
"Facebook chain" run in Actions. A run reads the variables when it starts, so
without the cancel it would post until its two hours are up.

The same holds for every variable (`FB_POSTS_PER_DAY`, `FB_POST_TYPES`,
`FB_MIN_GAP_MINUTES`, `FB_AFFILIATE_COMMENT`): a change takes effect when the
next run of the chain starts. To apply it at once, cancel the running chain
and start the workflow by hand.

## If something goes wrong

- **"the Page token was refused"**: the token died (password change, Page role
  removed, or Meta reset it). Do step 3 again and update `FB_PAGE_TOKEN`.
- **"Post failed"**: the post did not go out and the title is marked failed.
  It is not retried, so nothing posts twice. The next run picks another title.
- **"the link comment failed"**: the post is up but the link is missing. Add
  the comment by hand on Facebook.

## How it paces the day

Owner decision, 12 Oct 2026: **as many posts as is safe, under Facebook's
daily limit, never closer than five minutes apart.** Meta publishes no daily
post cap for a Page (the only official limit is a call budget), and third
parties report about 25 a day for business Pages. So the cap starts at 24 and
is raised by hand, with evidence.

Three rules, all read from the ledger's own timestamps:

| Rule | Variable | Unset | Limits |
|---|---|---|---|
| The gap: least minutes between two posts | `FB_MIN_GAP_MINUTES` | 5 | never under 5 |
| The cap: most posts in any 24 hours | `FB_POSTS_PER_DAY` | 24 | never over 288 |
| The pace: posts are spread evenly over the cap | (none) | 24 a day is one an hour | never closer than the gap |

- The day is a **rolling 24 hours**, counted back from now. Midnight never
  opens the door to a burst.
- A claim, a post and a failed post all count. A dry run never does.
- **Links are plain addresses** (28 Oct 2026): no `utm_` query. The site
  counts Facebook visits from the referrer and Facebook's own `fbclid`.

**Reels have a budget of their own** (owner decision, 28 Oct 2026: "a simple
post every 25 minutes, and reels separately"). `FB_POSTS_PER_DAY` counts the
posts and shares only; a reel never takes a post's slot. `FB_REELS_PER_DAY`
reels go out in any 24 hours, spread evenly over the day (5 a day is one
about every 4.8 hours), between the posts, and **never within 5 minutes of
any other post** on the Page. The ledger marks each reel (`reel: true`), so
both budgets are counted from it. The owner's settings: `FB_MIN_GAP_MINUTES`
25 and `FB_POSTS_PER_DAY` 57, which is one post about every 25 minutes.

### The chain

One workflow run posts, waits and posts again for two hours,
then starts the next run and ends. GitHub's hourly schedule dropped runs for
over three hours on 12 Oct 2026, so posting does not depend on it any more.

- **Start it:** Actions → Facebook Page post → Run workflow, nothing filled
  in. (`gh workflow run fb-post.yml` does the same.)
- **The backstop:** a cron job looks every 30 minutes and starts a chain only
  when none is running or waiting. It posts nothing itself.
- **No overlap:** chain runs share one concurrency group, so a second one
  waits for the first to end. The gap is kept from the ledger whatever
  started the run.
- **Two posts by hand:** Run workflow with `count` = 2. It keeps the gap and
  the cap, ignores the even pace, and never starts a chain.
- **A dry run** (`dry_run` ticked) shows what it would post and never starts
  a chain.
- The catalog is restored from the Actions cache at the start of each run, which is why a run lasts two hours here and not five.

### What stops it, and what does not

- **One failed post does not.** It is logged, marked failed in the ledger
  (never retried), the gap passes, and the chain goes on.
- **A refused token, or five failures in a row, do.** The run ends red and
  leaves a note in the ledger; the backstop does not restart a halted chain.
  Fix the cause, then start the workflow by hand.
- **Nothing fresh to post:** it waits 20 minutes and looks again. It never
  repeats an item to fill the time.

### The limit watch

Every sign of a limit is written to the ledger (`health` in `ledger.json` on
the `social-state` branch) and printed in the run's summary:

- **Throttling** (Graph codes 4, 17, 32, 341, 613, 80000 to 80014, HTTP 429,
  or a usage header at 90% and up): the chain backs off, doubling the wait
  each time, an hour at most.
- **A block** (code 368, or a message about being blocked, spam or going too
  fast): no posts for 24 hours, and the cap drops to **75% of what the Page
  had reached** in the last 24 hours.
- Each run's summary ends with **"Highest usage seen this run"**, read from
  Facebook's usage headers.

**Raising the cap** is done by hand, never by the code: when the summaries
show no limit signal and low usage for a few days, set `FB_POSTS_PER_DAY` a
step higher. Changing that number also lifts a cut left by a block.

## Shares (off until you switch them on)

Owner decision, 27 Oct 2026: the two sister Pages share each other's posts,
2 or 3 a day. Each repo reads the OTHER repo's public ledger (`ledger.json`
on its `social-state` branch, from raw.githubusercontent.com), because one
Page cannot read the other through the Graph API.

| Variable | What it does |
|---|---|
| `FB_SHARES_PER_DAY` | shares in any 24 hours. Unset or 0 = off, 4 at most |
| `FB_SHARE_FROM` | the other repo, `owner/name`. Unset = off |
| `FB_SHARE_FROM_NAME` | the other Page's name for the message (optional) |

- **Inside the cap.** A share counts in `FB_POSTS_PER_DAY` and the gap like
  any post. Never two shares in a row, and spread out: with 3 a day, no
  closer than 6 hours apart.
- **What is shared:** a post of the other Page that really went out (it has
  a Facebook post id), between 2 and 72 hours old, that this Page has never
  shared. The newest first, another kind than the last share when one is
  there.
- **How:** `POST /{page-id}/feed` with the post's public address as `link`
  and one plain line as `message`, taking turns: "New on our sister Page:",
  "Worth a look from our sister Page:", "Seen this yet? From our sister
  Page:", "In case you missed it, from our sister Page:" (with ", Name"
  before the colon when `FB_SHARE_FROM_NAME` is set). No first comment, no
  Amazon line, no hashtags.
- **Never in the way.** The other ledger not answering in 15 seconds, broken,
  or holding nothing to share only means no share this time: one line in the
  summary, and the normal post takes the turn. A share Facebook refuses is
  marked `failed` in the ledger (never tried again), written to
  `health.share`, and shares rest for 6 hours; the chain goes on.
- **Dry run.** A dry run shows the share it would make (a `SHARE` block in
  the summary) and sends nothing.

## Template posts (off until you switch them on)

Besides the classic post (a cover and a caption) there are template posts: an
image drawn for the post, 1080 x 1350, with the cover placed whole inside it,
so Facebook never crops the art. Each kind of post has its own design.

| Name | What it posts |
|---|---|
| `where` | The official reading sites of one comic or novel, and how much of it is out |
| `new-title` | A comic or novel that started in the last 75 days and already has an official site |
| `ranking` | Top 5 of a section: the ongoing titles, or one genre, by AniList readers |
| `character` | One lead character of a popular title |
| `fact` | One fact from the record, set very large |
| `next` | What to read next: three titles AniList readers recommend after one you liked |

There is no "new volume" post. The catalog holds how many volumes a title has,
never the day a volume came out, so a new volume cannot be told from an old one.

**Nothing above posts until its name is in the repo variable `FB_POST_TYPES`**
(Settings → Secrets and variables → Actions → Variables). The variable is a
comma list, and the list is exactly what runs:

| `FB_POST_TYPES` | What the Page gets |
|---|---|
| not set, or empty | classic posts only (as before) |
| `classic,where` | classic posts, plus where-to-read posts, in turns |
| `classic,where,fact,ranking` | those four kinds, in turns |
| `where,new-title,ranking,character,fact,next` | template posts only |

Leave `classic` in the list for as long as you want the plain cover posts too.
A name that is misspelt is ignored and named in the run summary; a list with
no usable name falls back to classic posts.

How the kinds share the day:

- They rotate: the kind that posted longest ago goes next.
- Nothing repeats too soon. A new title is posted once. A ranking comes back
  and a `next` post after 2 months, a character after 6 months, `where` and
  `fact` after the usual 30 days per title. Two posts about the same title never go
  out on one day.

Look before you switch a type on:

- On the PC, from the repo folder:
  `npm run social:samples -- --out "C:\some\folder"`
  writes two sample images per type and `captions.md` with every wording of
  each caption. Add `--long` to see the longest titles.
- On GitHub: Actions → **Facebook Page post** → Run workflow, keep `dry_run`
  ticked and write the names in `types` (for example `fact,where`). The run
  summary shows the captions, and the images are in the run's `fb-preview`
  artifact. The `types` box works for dry runs only; it can never post.

The images use the site's own fonts and colours and are made on the runner
(`scripts/social/render/`), with no browser. A run that draws installs the
site's packages first, which adds about a minute; a classic-only run does not.
The words on the images come from the same catalog as the pages; a fact the
record lacks is left out.

## New types, 12 Oct 2026

### `birthday`: character birthday (off until named)

"HAPPY BIRTHDAY" in large type, the character's portrait, the day as a big
number, the name in a solid band, then where the work is. The catalog holds
no birthdays, so a run with `birthday` switched on asks AniList ONE question
a day (the 50 most-favourited characters born today) and keeps the answer in
the ledger (`birthdays`), so the chain does not ask again; with nobody for
this site it asks again after three hours at most. A character is kept only
when one of their works has a live page on this site (comics, manhwa and novels for Manhwa Index), with
at least 100 favourites; five a day at most, most-favourited first, each
character once a year (gap 330 days). Only a character whose birth month and
day are today on the US Eastern clock is used, and only on that day: never
the wrong day. If AniList fails, there are no birthday posts that hour and
nothing else changes. A birthday post does not count as a post about the
title, so it never stops (or is stopped by) an episode card the same day.

### `fanart` and `cosplay` (off until named)

A picture of one character of a comic, manhwa or novel that has a page here: fan art, or a
photo of someone in that character's costume. The picture is posted
raw (owner decision 13 Oct 2026): edge to edge at its own shape, with no
frame and no type on it, and one thin strip under it with only the site
mark, the site name and the address. The image is 1080 wide and as tall as
the picture needs (a very tall one is capped at 1920 and centred, so it
stays whole). The character, who made it and the link are in the caption
and the first comment.

- **Source:** Danbooru (danbooru.donmai.us), no key. Fan art: each hour four
  lead characters of popular titles are looked up as Danbooru character
  tags, and only pictures of that character alone, from that title's series,
  are kept. Cosplay: one page of Danbooru's `cosplay_photo` posts each
  hour, kept when the series is a title on this site.
- **Safe for Facebook** (owner decision 12 Oct 2026: mild fan service yes,
  nudity no). Only pictures Danbooru rates general or sensitive; never
  questionable, explicit, flagged, or unrated. Out always: nudity and sex
  tags (and undressing, see-through), and anything about minors (loli,
  shota, child...); a school-age tag next to anything suggestive is out
  too. A picture rated sensitive, or with an allowed suggestive tag
  (swimsuit, cleavage), counts as ecchi-leaning: at most one in four art
  posts. The list is in `art/safe.mjs`.
- **Rare:** fan art and cosplay together are at most one post in eight on
  the Page, never two in a row.
- **Never twice:** the id and md5 of every picture posted are kept in the
  ledger (`artSeen`) beyond its 90 days; each post's entry also records
  the picture's rating and whether it was ecchi-leaning.
- **Credit:** the first comment's second line is "Art by <artist>: <where
  it was first posted>" ("Photo by" for cosplay), when Danbooru names the
  artist. A pixiv file address becomes the artwork's page. Only artist
  sites are linked (pixiv, fanbox, X, ArtStation, DeviantArt, Instagram,
  Bluesky, Reddit, Tumblr, Skeb, YouTube); any other source (an image
  board such as yande.re, which Facebook refuses as against its Community
  Standards) gives "Art by <artist>" with no link. If Facebook still
  refuses the comment, it is sent again with the site link alone; the post
  counts as posted and the chain goes on.
- **Fails soft:** if Danbooru does not answer, there are no art posts that
  hour.

## Reels (off until you switch them on)

A reel is a short vertical video (1080x1920, 8 to 20 seconds, with music and slide sounds) made
on the runner: slides drawn like the post images, held a few seconds each
with a slow zoom, cross-faded with ffmpeg (installed on the runner only for a run that can make a reel). An opening slide, one slide per
item, and a closing slide with the site name and "Link in the first comment".
Nothing is re-uploaded from anyone: the slides are our own.

| Name in `FB_POST_TYPES` | What it is |
|---|---|
| `reel-ranking` | Top 5 of a genre or of the ongoing titles, counted down from five to one |
| `reel-next` | "If you liked X, read these": three picks from AniList readers |

- **Off by default.** A reel posts only when its name is written in
  `FB_POST_TYPES`, like every template type.
- **Few.** `FB_REELS_PER_DAY` reels in any 24 hours (3 unless set, 10 at
  most; Facebook's own limit is 30 by API), on their own budget since
  28 Oct 2026: not counted in `FB_POSTS_PER_DAY`, spread evenly over the day,
  never within 5 minutes of another post (see "How it paces the day").
- **A reel that fails never stops the other posts.** Whatever Facebook
  answers (a missing permission comes back looking like a refused token), the
  chain writes it in the ledger (`health.reel`: the code and the message)
  and in the run summary, tries no reel for six hours, and goes on with the
  pictures. Only a token that is really dead (code 190) or a block stops
  things, as for any post.
- **Sound.** Every reel has a music bed and a short sound on each change of
  slide: a soft whoosh, and a low hit as the closing slide comes in. The
  music gives way under those sounds, fades in and out, and the mix is
  brought to about -16 LUFS (AAC, 160 kb/s). The music is one of six short
  tracks in `scripts/social/audio/`, all CC0 (public domain); `SOURCES.md` there
  lists each track, its page and its licence. The whoosh and the hit are
  made by ffmpeg itself. A reel always gets the same track, and never the
  track of the reel before it (the ledger keeps each reel's `track`). Add a
  track only if its own page says CC0 or public domain: no commercial music,
  nothing that asks for credit, no soundtrack.
- **Look first.** `npm run social:reels -- --out reel-samples` writes one MP4
  per type and a contact sheet of six frames. A manual dry run with `types`
  set to a reel name keeps the MP4 in the run's `fb-preview` artifact.
- **How it is published** (Reels Publishing API, read 12 Oct 2026): start an
  upload, send the file to `rupload.facebook.com`, finish with
  `video_state=PUBLISHED` and the caption as the description. The poster
  waits until Facebook has processed the reel, then adds the site link as the
  first comment on it.

## Instagram (off until you switch it on)

After a Facebook post goes through, the same post goes to the site's
Instagram account (@manhwaindexofficial), from the same run
(`scripts/social/ig.mjs`). Facebook stays the main Page: an Instagram
failure is written on the post's ledger entry (`ig.error`) and said in the
summary, and Facebook goes on as if nothing happened.

What changes on Instagram:

- **"Link in bio".** Links in an Instagram caption cannot be clicked, so the
  caption line about the first comment becomes "🔗 Link in bio:
  manhwaindex.com", and a template picture is drawn again with "link in
  bio" in place of "link in the first comment". There is no first comment.
  Fan art and cosplay say "Art by <artist>." in the caption.
- **The shape.** Instagram takes pictures from 4:5 to 1.91:1. The template
  pictures are 4:5 already. A taller picture (a cover, a tall fan art) is
  placed whole, uncropped, on the site's night colour.
- **How the picture gets there.** Instagram fetches a picture by its
  address and takes no upload, so each picture is first kept on the Facebook
  Page as an **unpublished** photo (it never shows in the feed) and
  Instagram is given that photo's address.
- **Reels.** A reel goes as the same MP4 (1080x1920, 9:16), by the
  resumable upload: no public address is needed. Instagram takes reels of 3
  seconds to 15 minutes; a reel outside that stays on Facebook. Reels are
  shared to the Instagram feed too. `IG_POST_TYPES=reel` sends only reels.
- **Its own pace.** At most `IG_POSTS_PER_DAY` posts in any 24 hours (8
  unless set, 25 at most), spread evenly: a Facebook post goes to Instagram
  only when the last Instagram post is far enough back. A text-only classic
  post (no cover) stays on Facebook.

### Switch it on

1. **Make the account professional.** In the Instagram app: Settings →
   *Account type and tools* → *Switch to professional account* → **Business**
   (Creator works too). Add the site logo as the profile picture and
   `manhwaindex.com` as the website (the "link in bio").
2. **Link it to the Facebook Page.** On Facebook, open the Page → Settings →
   *Linked accounts* → Instagram → **Connect**, and log in to
   @manhwaindexofficial.
3. **Give the app the Instagram permissions.** In the Meta app from step 2,
   add `instagram_basic` and `instagram_content_publish` (Standard access is
   enough for an account you own).
4. **Make a new Page token** exactly as in step 3, ticking the four Page
   permissions **and** the two Instagram ones. Put it in the
   `FB_PAGE_TOKEN` secret (it replaces the old one and still posts to
   Facebook). If you would rather keep the Facebook token as it is, put the
   new one in an `IG_TOKEN` secret instead.
5. **The Instagram account id is found by itself.** Each run asks the Page
   (`<page-id>?fields=instagram_business_account{id,username}`) and names
   the account it found. The secret `IG_USER_ID` is optional; when set, it
   must match the account linked to the Page.
6. **Put it in GitHub** (Settings → Secrets and variables → Actions):
   - variable `IG_POSTS_PER_DAY` (optional): e.g. `8`
   - variable `IG_POST_TYPES` (optional): only these kinds go to Instagram,
     e.g. `classic,where,fanart,cosplay`; every kind Facebook posts when
     unset
7. **Look first.** Set the variable `IG_POST_ENABLED` to `check`: every run
   finds the account and says what it would post to Instagram, and posts
   nothing there. Or run Actions → *Facebook Page post* with `dry_run`
   ticked.
   The summary says, for each post, whether Instagram would get it, and the
   `fb-preview` artifact holds the Instagram pictures (`*.instagram.jpg`)
   beside the Facebook ones. The run also checks the token and names the
   Instagram account it reached.
8. With `IG_POST_ENABLED` set to `true`, the next run of the chain posts to
   Instagram too. Set it to anything else to stop; Facebook is untouched.

If the summary says "the account check failed", the token lacks the
Instagram permissions or `IG_USER_ID` is wrong: Instagram sits that run out
and Facebook posts as usual.

## What every post carries

A post exists to send people to the site, so each one is built the same way:

- **The image** shows quick context as labelled lines (score, genre, status,
  alt title), has a thin line round the cover so it stands off the page, and
  ends on one line that points at the first comment.
- **The caption**: a hook with an emoji, a short synopsis from the record (cut
  at a sentence end, no credits, no spoiler text), the key facts, a question
  that names the title, the line about the first comment, then up to seven
  hashtags built from the record (title, platform, season, sub-genre, kind,
  genre, one or two community tags). A part the record lacks is left out.
- **The first comment**: the site link, always first, so the preview card is
  the site.

### The Amazon line in the first comment (off)

Set the repo variable `FB_AFFILIATE_COMMENT` to `true` and the first comment
gets a second line for titles the site has a product for:

```
Where to read it: https://.../the-title
Get the book on Amazon: https://www.amazon.com/dp/XXXXXXXXXX?tag=manhwaindex-20
```

- The link is the same product the title page shows (`scripts/social/shop.mjs` reads the
  site's own picks and its own tag). A title with no pick gets no Amazon line;
  nothing is ever a search link.
- The tag is always `manhwaindex-20`. A test fails if any other tag could be written.
- Nothing else is added to the post or the comment about it.
- Any other value, or no variable, keeps the comment to the one site line.

## How it chooses

- About two new items for each older one. New: an anime episode airing today,
  or a series still running. Older: popular titles ("where to read it",
  plain facts, "if you liked it").
- The picture is the largest cover the source has. Older titles only have a
  small cover (230 px wide), which looks soft in the feed, so a title with a
  large cover is always taken first.
- Never the same caption style twice in a row, never the same title within
  30 days, never an adult title, never a page without an official platform.
- The record of what was posted lives on the `social-state` branch
  (`ledger.json`). A post is written there before it is sent, so two runs can
  never post the same title.
- Data comes from the catalog the deploy keeps in the GitHub Actions cache. The
  runner never loads the live site.

## Rules added in the refinement round (12 Oct 2026)

- **The mix.** The same kind of post never goes out twice running while another kind has something to post. News (the classic NEW pool) may outrank the rotation, but never a third time in a row unless nothing else is left (`plan.mjs`, `MAX_STREAK`).
- **Above the fold.** Line 1 of a caption is the hook with the title. Line 2 is the single most useful fact (the platform, the air time or the score). The synopsis, the other facts, the question and the line about the first comment follow.
- **The synopsis** never ends on a teaser question, a lead-in colon, a scrap of a few words or an ellipsis. The image carries one line about the story (the first sentence, 110 characters at most) only when that sentence is whole.
- **The title hashtag** leaves out a season or part suffix and a subtitle ("2nd Cour", "Season 3", the text after a colon).
- **Fact cards** name the title in the sentence on the image, offer one fact per title (the strongest), and skip a title with no strong fact: top 50 of an all-time chart, a long finished run, many years between the first chapter and the anime of the same name, or a score of 8.8 and up. The record holds no trustworthy yearly, seasonal or genre rank, so those are not used.
- **Blank covers.** A cover that is a logo on plain white or black is found with a 48 px probe. A grid or list leaves that tile out when it has another title to show; a post whose main picture is blank is skipped for the run. A ranking keeps its order: a title is never dropped from a ranking for its cover.
- **Small portraits** (AniList characters are 230 px wide) are enlarged at most 1.75 times, with lanczos and a light sharpen, and shown no wider than 400 px.
- **The line about the first comment** on a list post says "Start with #1" when the comment opens the title in first place, and names the list only when the comment opens a list page.
- **The Amazon line** fits the product: "Read the manga it is based on" under an anime post with a manga volume, "Get the Blu-ray on Amazon", "Get the figure on Amazon". Never "the book" for something that is not one, and never "based on" for an original anime.
- **New title** takes only a series still coming out: never a one-shot (by format), a bonus or special chapter, or a side story.
