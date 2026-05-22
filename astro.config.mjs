// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  vite: {
    plugins: [tailwindcss()]
  },
server: {
    host: true, // or specify '0.0.0.0'
    allowedHosts: ['preview.sushant.art'],
  },
});
