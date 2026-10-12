/**
 * How Manhwa Index's template images look: the site's colours (the same
 * values as src/styles/app.css), its type (Saira, with the site name in the
 * stencil face the header uses) and its mark. render/engine.mjs draws with it.
 *
 * The mark is public/logo-mark.svg, never public/icon-512.png (that file is
 * clipped). The mark is drawn in the colour that suits the page it sits on.
 */
import { join } from 'node:path'

const NIGHT = '#070b1c'
const ROSE = '#e0688a'
const DAWN = '#f5ecdd'

export const THEME = {
  name: 'Manhwa Index',
  domain: 'manhwaindex.com',
  color: { night: NIGHT, raised: '#101733', accent: ROSE, paper: DAWN },
  font: {
    display: 'Saira',
    text: 'Saira',
    brand: 'Saira Stencil One',
    brandWeight: 400,
    brandSize: 30,
    displayBold: 700,
    displayBlack: 900,
    textRegular: 400,
    textMedium: 500,
    textBold: 700,
  },
  fonts: [
    { name: 'Saira', pkg: '@fontsource/saira', file: 'saira', weights: [400, 500, 700, 900] },
    { name: 'Saira Stencil One', pkg: '@fontsource/saira-stencil-one', file: 'saira-stencil-one', weights: [400] },
  ],
  mark: { file: join(process.cwd(), 'public', 'logo-mark.svg'), tones: { dark: ROSE, light: NIGHT, accent: NIGHT } },
}
