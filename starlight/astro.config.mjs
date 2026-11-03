// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightThemeRapide from 'starlight-theme-rapide';
import starlightLinksValidator from 'starlight-links-validator';
import mermaid from 'astro-mermaid';

const SITE = 'https://event4u-app.github.io';
const BASE = '/agent-switch';
const OG_IMAGE = `${SITE}${BASE}/media/og-image.png`;
const DESCRIPTION =
	'All your Claude Code, Codex and Antigravity accounts signed in side by side — and every session on the one with the most left.';

// Old slugs → new pages, so links into the previous docs keep working.
const redirects = {
	'/getting-started/introduction/': `${BASE}/start-here/why/`,
	'/getting-started/installation/': `${BASE}/start-here/install/`,
	'/getting-started/first-accounts/': `${BASE}/start-here/quick-start/`,
	'/guides/mappings-and-sharing/': `${BASE}/guides/projects-and-pools/`,
	'/guides/sessions-and-handoff/': `${BASE}/guides/move-a-session/`,
	'/guides/providers-and-autoswitch/': `${BASE}/concepts/limits-and-protection/`,
	'/guides/tray-gui/': `${BASE}/guides/desktop-app/`,
	'/guides/desktop-pet/': `${BASE}/guides/notifications-and-pet/`,
	'/reference/platform-support/': `${BASE}/reference/platform-matrix/`,
};

// https://astro.build/config
export default defineConfig({
	site: SITE,
	base: BASE,
	trailingSlash: 'always',
	redirects,
	integrations: [
		starlight({
			title: 'Agent Switch',
			description: DESCRIPTION,
			favicon: '/favicon.png',
			logo: {
				src: './src/assets/icon.png',
				alt: 'Agent Switch',
			},
			lastUpdated: true,
			head: [
				{ tag: 'meta', attrs: { property: 'og:image', content: OG_IMAGE } },
				{ tag: 'meta', attrs: { property: 'og:image:width', content: '1200' } },
				{ tag: 'meta', attrs: { property: 'og:image:height', content: '630' } },
				{ tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
				{ tag: 'meta', attrs: { name: 'twitter:image', content: OG_IMAGE } },
			],
			social: [
				{
					icon: 'github',
					label: 'GitHub',
					href: 'https://github.com/event4u-app/agent-switch',
				},
				{
					icon: 'heart',
					label: 'event4u',
					href: 'https://event4u.app',
				},
			],
			editLink: {
				baseUrl: 'https://github.com/event4u-app/agent-switch/edit/main/starlight/',
			},
			customCss: ['./src/styles/custom.css'],
			plugins: [starlightThemeRapide(), starlightLinksValidator()],
			sidebar: [
				{
					label: 'Start here',
					collapsed: false,
					items: [
						{ slug: 'start-here/why' },
						{ slug: 'start-here/quick-start' },
						{ slug: 'start-here/install' },
					],
				},
				{
					label: 'Concepts',
					collapsed: false,
					items: [
						{ slug: 'concepts/how-it-works' },
						{ slug: 'concepts/which-account' },
						{ slug: 'concepts/limits-and-protection' },
						{ slug: 'concepts/sessions-and-context' },
					],
				},
				{
					label: 'Guides',
					collapsed: true,
					items: [
						{ slug: 'guides/everyday-workflow' },
						{ slug: 'guides/projects-and-pools' },
						{ slug: 'guides/move-a-session' },
						{ slug: 'guides/chat-view' },
						{ slug: 'guides/desktop-app' },
						{ slug: 'guides/notifications-and-pet' },
						{ slug: 'guides/share-settings' },
						{ slug: 'guides/codex' },
						{ slug: 'guides/antigravity' },
						{ slug: 'guides/desktop-apps-and-launchers' },
						{ slug: 'guides/codexbar-ccdeck' },
					],
				},
				{
					label: 'Trust',
					collapsed: true,
					items: [
						{ slug: 'trust/security-and-privacy' },
						{ slug: 'trust/non-goals' },
					],
				},
				{
					label: 'Reference',
					collapsed: true,
					items: [
						{ slug: 'reference/cli' },
						{ slug: 'reference/configuration' },
						{ slug: 'reference/environment' },
						{ slug: 'reference/platform-matrix' },
						{ slug: 'reference/troubleshooting' },
						{ slug: 'reference/glossary' },
						{
							label: 'Release notes',
							link: 'https://github.com/event4u-app/agent-switch/releases',
							attrs: { target: '_blank' },
						},
					],
				},
			],
		}),
		mermaid(),
	],
});
