// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

import vercel from '@astrojs/vercel';

import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'http://kateredkneads.com/',
  output: 'server',

  vite: {
    plugins: [tailwindcss()]
  },

  server: {
      host: true,
      allowedHosts: ['preview.sushant.art'],
    },

  adapter: vercel(),
  integrations: [sitemap()]
});