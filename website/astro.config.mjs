// @ts-check
import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'
import starlightLinksValidator from 'starlight-links-validator'

export default defineConfig({
  // Used for canonical URLs and the sitemap.
  site: 'https://kothar.sh',
  // Static files only: no SSR adapter, nothing Cloudflare-specific.
  output: 'static',
  trailingSlash: 'ignore',
  // No dev toolbar over the pages while working on them.
  devToolbar: { enabled: false },
  integrations: [
    starlight({
      title: 'Kothar',
      description: 'A desktop app for running coding agents.',
      favicon: '/favicon.svg',
      head: [
        { tag: 'link', attrs: { rel: 'icon', href: '/favicon.png', type: 'image/png', sizes: '64x64' } },
        { tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' } },
      ],
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/billwang7599/kothar' }],
      editLink: { baseUrl: 'https://github.com/billwang7599/kothar/edit/main/website/' },
      customCss: [
        '@fontsource-variable/archivo/wdth.css',
        '@fontsource/ibm-plex-mono/400.css',
        '@fontsource/ibm-plex-mono/600.css',
        './src/styles/theme.css',
      ],
      // The same tabs, GitHub link and Download pill as the Overview and Features pages.
      components: {
        Header: './src/components/StarlightHeader.astro',
        MobileMenuFooter: './src/components/StarlightMobileMenuFooter.astro',
      },
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
