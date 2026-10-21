// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { sidebar } from './src/sidebar.mjs';

const SITE = 'https://synclet-io.github.io';
const BASE = '/synclet-site';
const ORIGIN = `${SITE}${BASE}/`;
const OG_IMAGE = `${ORIGIN}og-image.png`;
const OG_IMAGE_ALT = 'Synclet: self-hosted data sync for Airbyte Protocol connectors';
const DOCS_DIR = 'src/content/docs';
const BUILD_DATE = new Date();

function lastCommitDate(file) {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cI', '--', file], { encoding: 'utf8' }).trim();
    return out ? new Date(out) : BUILD_DATE;
  } catch {
    return BUILD_DATE;
  }
}

/** Page URL → date of the last commit that touched its source file. */
function pageLastmods() {
  const dates = new Map([[ORIGIN, lastCommitDate('src/pages/index.astro')]]);
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.mdx?$/.test(entry.name)) {
        const slug = relative(DOCS_DIR, path).replace(/\.mdx?$/, '');
        dates.set(`${ORIGIN}${slug}/`, lastCommitDate(path));
      }
    }
  };
  walk(DOCS_DIR);
  return dates;
}

const LASTMODS = pageLastmods();
const GOATCOUNTER_CODE = process.env.PUBLIC_GOATCOUNTER_CODE ?? '';

// https://astro.build/config
export default defineConfig({
  site: SITE,
  base: BASE,
  integrations: [
    starlight({
      title: 'Synclet Docs',
      // Use the compact square mark for the docs nav. The full README hero
      // logo would shrink to an illegible postage stamp here. Starlight
      // shows the configured title next to the mark.
      logo: {
        src: './public/favicon.svg',
      },
      // Starlight auto-prefixes the configured base.
      favicon: '/favicon.svg',
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/synclet-io/synclet' },
      ],
      customCss: ['./src/styles/starlight.css'],
      components: {
        Footer: './src/components/Footer.astro',
      },
      head: [
        { tag: 'meta', attrs: { property: 'og:image', content: OG_IMAGE } },
        { tag: 'meta', attrs: { property: 'og:image:width', content: '1200' } },
        { tag: 'meta', attrs: { property: 'og:image:height', content: '630' } },
        { tag: 'meta', attrs: { property: 'og:image:alt', content: OG_IMAGE_ALT } },
        { tag: 'meta', attrs: { name: 'twitter:image', content: OG_IMAGE } },
        { tag: 'meta', attrs: { name: 'twitter:image:alt', content: OG_IMAGE_ALT } },
        ...(GOATCOUNTER_CODE
          ? [
              {
                tag: 'script',
                attrs: {
                  'data-goatcounter': `https://${GOATCOUNTER_CODE}.goatcounter.com/count`,
                  async: true,
                  src: 'https://gc.zgo.at/count.js',
                },
              },
            ]
          : []),
      ],
      sidebar,
      disable404Route: true,
    }),
    sitemap({
      // Lists only the trailing-slash canonical URLs; the landing page is also reported without one.
      filter: (page) => page.endsWith('/'),
      serialize: (item) => ({ ...item, lastmod: (LASTMODS.get(item.url) ?? BUILD_DATE).toISOString() }),
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});