'use strict';

const { decodeConfig } = require('./config');
const { outputLang } = require('./opencc');
const { listSubtitles, normalizeLang, langAllowed, fallbackAllowed } = require('./sources');
const { encodeToken } = require('./token');

/**
 * Stremio `subtitles` resource handler.
 *
 * Chinese candidates are converted with OpenCC on download, so the upstream
 * file is never sent to the player directly.
 *
 * When the video has no Chinese subtitle at all, the configured fallback
 * languages (English by default) are machine translated with DeepL instead —
 * but only if the viewer supplied their own DeepL key. Translation happens on
 * download, not here, so quota is spent only on the subtitle actually picked.
 */
async function handleSubtitles({ type, id, config, baseUrl }) {
	const cfg = decodeConfig(config);
	const items = await listSubtitles(cfg, type, id);
	const pathSegment = config || 'default';
	const lang = outputLang(cfg.to);
	const subtitles = [];

	const chinese = items.filter((item) => langAllowed(cfg, item.lang));
	const translatable = chinese.length || !cfg.deeplKey
		? []
		: items.filter((item) => fallbackAllowed(cfg, item.lang));

	for (const item of chinese) {
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

	for (const item of translatable) {
		subtitles.push({
			id: `deepl:${item.id}`,
			url: `${baseUrl}/srt/${pathSegment}/${encodeToken({
				u: item.url,
				f: item.fileId,
				n: item.name,
				x: 1,
				s: normalizeLang(item.lang),
			})}.srt`,
			lang,
		});
	}

	return { subtitles };
}

module.exports = { handleSubtitles };
