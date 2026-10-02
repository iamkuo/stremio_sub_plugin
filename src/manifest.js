'use strict';

const pkg = require('../package.json');

const manifest = {
	id: 'org.opencc.subtitles',
	version: pkg.version,
	name: 'OpenCC 簡繁轉換字幕',
	description:
		'使用 OpenCC 將簡體中文字幕即時轉換為繁體中文（台灣／香港／OpenCC 標準，可自訂詞彙）。' +
		'字幕來源為 OpenSubtitles，可於設定頁選擇轉換模式、來源與語言。',
	resources: ['subtitles'],
	types: ['movie', 'series'],
	idPrefixes: ['tt'],
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
