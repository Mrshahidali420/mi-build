import { defineConfig } from 'astro/config'
import cloudflare from '@astrojs/cloudflare'

// Hybrid rendering. Listings, the home page and the sitemaps are built as
// files. Title pages and character pages are rendered by the Worker when a
// reader asks for one, so the catalog can grow past the 20,000 file limit
// the free plan puts on static assets.
export default defineConfig({
  site: 'https://manhwaindex.com',
  output: 'server',
  adapter: cloudflare({ imageService: 'passthrough' }),
  trailingSlash: 'never',
  build: {
    format: 'file',
    // The stylesheet used to travel inside every page, about 87 KB of the
    // HTML each time. It now goes to hashed files under /_astro/, which every
    // page shares and the browser keeps for a year (public/_headers), so a
    // reader downloads it once per visit to the site, not once per page. The
    // Worker-rendered title and character pages link the same files.
    // 'auto' still keeps that big file shared, but inlines the tiny ones
    // (under 4 KB, like the font faces) so they stop blocking first paint.
    inlineStylesheets: 'auto',
  },
  image: {
    // Covers are served straight from AniList's CDN, so no local processing.
    remotePatterns: [{ protocol: 'https', hostname: 's4.anilist.co' }],
  },
})
