'use strict';

const pkg = require('../package.json');

const manifest = {
	id: 'org.opencc.subtitles',
	version: pkg.version,
	name: 'OpenCC 簡繁轉換字幕',
	description:
		'使用 OpenCC 將簡體中文字幕即時轉換為繁體中文（台灣／香港／OpenCC 標準，可自訂詞彙）。' +
		'完全沒有中文字幕時，可用免金鑰的 Google 翻譯產生繁體字幕。' +
		'字幕來源為 OpenSubtitles，可於設定頁選擇轉換模式、來源與語言。',
	resources: ['subtitles'],
	types: ['movie', 'series'],
	// Deliberately no `idPrefixes`. That field narrows which content the client
	// will ask us about, and `['tt']` — the usual choice, and what most subtitle
	// addons declare — means anything with a non-IMDb id (a local file, another
	// catalog's ids) is never sent to us at all. For a subtitle addon there is
	// nothing to gain from narrowing: an id we cannot look up simply yields an
	// empty list. Leaving it out is what makes "the addon is installed but never
	// called" impossible to cause this way.
	catalogs: [],
	behaviorHints: {
		configurable: true,
		configurationRequired: true,
	},
};

/**
 * Builds the manifest for one request.
 *
 * @param {boolean} hasConfig Stremio hides the Configure button once a config
 *   is already present in the URL.
 * @param {string} baseUrl Absolute URL this addon is reachable at, used for the logo.
 */
function manifestForConfig(hasConfig, baseUrl) {
	const result = { ...manifest, behaviorHints: { ...manifest.behaviorHints } };
	if (baseUrl) result.logo = `${baseUrl}/logo.png`;
	if (hasConfig) {
		delete result.behaviorHints.configurationRequired;
		delete result.behaviorHints.configurable;
	}
	return result;
}

module.exports = { manifest, manifestForConfig };
