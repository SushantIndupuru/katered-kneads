// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

import vercel from '@astrojs/vercel';

import sitemap from '@astrojs/sitemap';

const hiddenPages = [
  'https://kateredkneads.com/admin/',
  'https://kateredkneads.com/admin/login/',
  'https://kateredkneads.com/admin/orders/',
  'https://kateredkneads.com/admin/pos/',
  'https://kateredkneads.com/admin/sms/',
  'https://kateredkneads.com/admin/stock/',
  'https://kateredkneads.com/order/success/',
  'https://kateredkneads.com/pay/in-person/',
  'https://kateredkneads.com/pay/thanks/',
  'https://kateredkneads.com/cart/'
];


// https://astro.build/config
export default defineConfig({
  site: 'https://kateredkneads.com/',
  output: 'server',

  vite: {
    plugins: [tailwindcss()]
  },

  adapter: vercel(),
  integrations: [sitemap(
    {
      filter: (page) => !hiddenPages.includes(page),
    }
  )]
});