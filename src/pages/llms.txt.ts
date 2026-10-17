import type { APIRoute } from 'astro';
import { getEntry } from 'astro:content';
import { sidebar } from '../sidebar.mjs';

export const GET: APIRoute = async ({ site }) => {
  const origin = new URL(import.meta.env.BASE_URL.replace(/\/?$/, '/'), site);
  const lines = [
    '# Synclet',
    '',
    '> Synclet is a self-hosted data synchronization platform that runs Airbyte connectors without Airbyte: one Go binary and one PostgreSQL database. MIT licensed.',
    '',
    'Source code: https://github.com/synclet-io/synclet',
  ];

  for (const group of sidebar) {
    lines.push('', `## ${group.label}`, '');
    for (const item of group.items) {
      const page = await getEntry('docs', item.slug);
      if (!page) throw new Error(`llms.txt: no docs page for sidebar slug ${item.slug}`);
      const url = new URL(`${item.slug}/`, origin);
      const description = page.data.description ? `: ${page.data.description}` : '';
      lines.push(`- [${page.data.title}](${url})${description}`);
    }
  }

  return new Response(`${lines.join('\n')}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
