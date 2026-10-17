// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import tailwindcss from '@tailwindcss/vite';
import { sidebar } from './src/sidebar.mjs';

const BASE = '/synclet-site';
const GOATCOUNTER_CODE = process.env.PUBLIC_GOATCOUNTER_CODE ?? '';

// https://astro.build/config
export default defineConfig({
  site: 'https://synclet-io.github.io',
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
      head: GOATCOUNTER_CODE
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
        : [],
      sidebar,
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});