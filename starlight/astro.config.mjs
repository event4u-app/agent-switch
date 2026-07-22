// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightThemeRapide from 'starlight-theme-rapide';
import mermaid from 'astro-mermaid';

// https://astro.build/config
export default defineConfig({
	site: 'https://event4u-app.github.io',
	base: '/agent-switch',
	trailingSlash: 'always',
	integrations: [
		starlight({
			title: 'agent-switch',
			description:
				'Switch between multiple Claude Code, Codex, and Antigravity accounts via isolated config-dir profiles.',
			favicon: '/favicon.png',
			logo: {
				src: './public/favicon.png',
			},
			social: [
				{
					icon: 'heart',
					label: 'Sponsor',
					href: 'https://event4u.app',
				},
				{
					icon: 'github',
					label: 'GitHub',
					href: 'https://github.com/event4u-app/agent-switch',
				},
			],
			editLink: {
				baseUrl: 'https://github.com/event4u-app/agent-switch/edit/main/starlight/',
			},
			customCss: [
				'./src/styles/custom.css',
			],
			plugins: [
				starlightThemeRapide(),
			],
			sidebar: [
				{
					label: 'Getting Started',
					collapsed: false,
					items: [
						{ label: 'Introduction', slug: 'getting-started/introduction' },
						{ label: 'Installation & Setup', slug: 'getting-started/installation' },
						{ label: 'Your First Accounts', slug: 'getting-started/first-accounts' },
					],
				},
				{
					label: 'Guides',
					collapsed: true,
					items: [
						{ label: 'Per-Repo Mappings & Sharing', slug: 'guides/mappings-and-sharing' },
						{ label: 'Sessions, Context & Handoff', slug: 'guides/sessions-and-handoff' },
						{ label: 'Providers & Auto-Switch', slug: 'guides/providers-and-autoswitch' },
						{ label: 'The Tray GUI', slug: 'guides/tray-gui' },
					],
				},
				{
					label: 'Reference',
					collapsed: true,
					items: [
						{ label: 'CLI Command Reference', slug: 'reference/cli' },
						{ label: 'Configuration Reference', slug: 'reference/configuration' },
						{ label: 'Platform Support & Troubleshooting', slug: 'reference/platform-support' },
					],
				},
			],
		}),
		mermaid(),
	],
});
