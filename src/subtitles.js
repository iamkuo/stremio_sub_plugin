'use strict';

const { decodeConfig } = require('./config');
const { outputLang } = require('./opencc');
const { listSubtitles, normalizeLang } = require('./sources');
const { encodeToken } = require('./token');

/**
 * Stremio `subtitles` resource handler.
 *
 * Every candidate is returned twice-pointing at our own server, which performs
 * the OpenCC conversion on download. The upstream file is never sent to the
 * player directly, so the player always receives Traditional Chinese.
 */
async function handleSubtitles({ type, id, config, baseUrl }) {
	const cfg = decodeConfig(config);
	const items = await listSubtitles(cfg, type, id);
	const pathSegment = config || 'default';
	const lang = outputLang(cfg.to);
	const subtitles = [];

	for (const item of items) {
		subtitles.push({
			id: `opencc:${item.id}`,
			url: `${baseUrl}/srt/${pathSegment}/${encodeToken({ u: item.url, f: item.fileId, n: item.name })}.srt`,
			lang,
		});

		if (cfg.keepOriginal) {
			subtitles.push({
				id: `opencc-raw:${item.id}`,
				url: `${baseUrl}/srt/${pathSegment}/${encodeToken({ u: item.url, f: item.fileId, n: item.name, r: 1 })}.srt`,
				lang: normalizeLang(item.lang) || lang,
			});
		}
	}

	return { subtitles };
}

module.exports = { handleSubtitles };
