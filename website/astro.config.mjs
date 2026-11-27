// @ts-check
import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'
import starlightLinksValidator from 'starlight-links-validator'

export default defineConfig({
  // Placeholder until the domain is confirmed. Used for canonical URLs and the sitemap.
  site: 'https://kothar.dev',
  // Static files only: no SSR adapter, nothing Cloudflare-specific.
  output: 'static',
  trailingSlash: 'ignore',
  integrations: [
    starlight({
      title: 'Kothar',
      description: 'A desktop app for running coding agents.',
      logo: { src: './src/assets/logo.svg', alt: 'Kothar' },
      favicon: '/favicon.svg',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/billwang7599/kothar' }],
      editLink: { baseUrl: 'https://github.com/billwang7599/kothar/edit/main/website/' },
      customCss: ['@fontsource-variable/inter', './src/styles/theme.css'],
      // Fails the build on a broken internal link.
      plugins: [starlightLinksValidator()],
      sidebar: [
        { label: 'Start here', items: ['docs', 'docs/getting-started'] },
        {
          label: 'Using Kothar',
          items: [
            'docs/engines',
            'docs/spaces',
            'docs/workers',
            'docs/memory',
            'docs/permissions',
            'docs/extensions',
            'docs/usage',
            'docs/cli',
          ],
        },
        { label: 'Build', items: ['docs/writing-an-extension'] },
        { label: 'Help', items: ['docs/faq'] },
      ],
    }),
  ],
})
