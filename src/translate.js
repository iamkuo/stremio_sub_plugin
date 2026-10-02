'use strict';

const { translateSubtitle: deeplTranslate } = require('./deepl');
const { translateSubtitle: googleTranslate } = require('./google');
const { toDeepLSource, toDeepLTarget, toGoogleSource, toGoogleTarget } = require('./langs');

/**
 * Fallback translation providers.
 *
 * Google Translate needs no account, so it is the first fallback and works out
 * of the box. DeepL is only reached when Google fails or when the viewer
 * explicitly prefers it, and it needs the viewer's own API key.
 *
 * Order matters: `ORDER` is the priority used by the `auto` preference.
 */
const ORDER = ['google', 'deepl'];

const PROVIDERS = {
	google: {
		id: 'google',
		name: 'Google 翻譯',
		shortName: 'Google',
		requiresKey: false,
		run: (text, cfg, handle) =>
			googleTranslate(text, {
				sourceLang: toGoogleSource(handle.sourceLang),
				targetLang: toGoogleTarget(cfg.to),
			}),
	},
	deepl: {
		id: 'deepl',
		name: 'DeepL',
		shortName: 'DeepL',
		requiresKey: true,
		run: (text, cfg, handle) =>
			deeplTranslate(text, {
				apiKey: cfg.deeplKey,
				sourceLang: toDeepLSource(handle.sourceLang),
				targetLang: toDeepLTarget(cfg.to),
			}),
	},
};

const PREFERENCES = ['auto', 'google', 'deepl'];

/**
 * Providers that can actually run for these settings, in priority order.
 * `auto` tries Google first and keeps DeepL as a safety net.
 */
function providerChain(cfg) {
	const preference = PREFERENCES.includes(cfg.fallbackProvider) ? cfg.fallbackProvider : 'auto';

	return ORDER.filter((id) => {
		const provider = PROVIDERS[id];
		if (preference !== 'auto' && preference !== id) return false;
		if (provider.requiresKey && !cfg.deeplKey) return false;
		return true;
	});
}

/** True when these settings can produce a fallback subtitle at all. */
function hasProvider(cfg) {
	return providerChain(cfg).length > 0;
}

/**
 * Translates a subtitle with the first provider that succeeds.
 *
 * @returns {Promise<{text, characters, requests, segments, provider, providerName, attempts: string[]}>}
 */
async function translateSubtitle(text, cfg, handle) {
	const chain = providerChain(cfg);

	if (!chain.length) {
		const reason =
			cfg.fallbackProvider === 'deepl'
				? '備援翻譯設為 DeepL，但尚未設定 DeepL API Key'
				: '沒有可用的備援翻譯服務';
		throw Object.assign(new Error(reason), { statusCode: 400 });
	}

	const attempts = [];
	let lastError = null;
	for (const id of chain) {
		const provider = PROVIDERS[id];
		try {
			const result = await provider.run(text, cfg, handle);
			return { ...result, provider: id, providerName: provider.name, attempts };
		} catch (error) {
			lastError = error;
			attempts.push(`${provider.name}：${error.message}`);
		}
	}

	// With a single provider there is nothing left to fall back to, so its own
	// error (with its status code and wording) is more useful than a summary.
	if (chain.length === 1 && lastError) throw lastError;

	throw Object.assign(new Error(`備援翻譯失敗（${attempts.join('；')}）`), { statusCode: 502 });
}

module.exports = { ORDER, PROVIDERS, PREFERENCES, providerChain, hasProvider, translateSubtitle };
