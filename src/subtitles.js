'use strict';

const { decodeConfig } = require('./config');
const { outputLang } = require('./opencc');
const { listSubtitles, normalizeLang, langAllowed, langList } = require('./sources');
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
 *
 * Sources routinely list the same file several times, and a popular film can
 * carry dozens of releases. Stremio's picker shows one row per entry, so
 * duplicates are collapsed and the list is capped: a wall of identical rows is
 * worse than a short list.
 */

const MAX_CONVERTED_ENTRIES = 5;
const MAX_FALLBACK_ENTRIES = 5;
const RELEASE_LABEL_LIMIT = 24;

/**
 * Compact, human readable hint of which release a subtitle came from.
 * Release file names are long and full of dots, so they are normalised and
 * truncated rather than shown verbatim.
 */
function releaseLabel(name) {
	const cleaned = String(name || '')
		.replace(/\.(srt|vtt|ass|ssa|sub|txt|zip)$/i, '')
		.replace(/[._]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	if (!cleaned) return '';
	if (cleaned.length <= RELEASE_LABEL_LIMIT) return cleaned;
	return `${cleaned.slice(0, RELEASE_LABEL_LIMIT - 1).trimEnd()}…`;
}

/** Joins the kind and the release hint into one compact label. */
function composeLabel(kind, name) {
	const release = releaseLabel(name);
	return release ? `${kind} · ${release}` : kind;
}

/**
 * One entry per underlying file. The proxy source happily returns the same
 * download URL under several ids, which the picker would otherwise show as
 * identical duplicates.
 */
function dedupe(items) {
	const seen = new Set();
	const unique = [];
	for (const item of items) {
		const key = item.url || `f:${item.fileId}` || item.id;
		if (seen.has(key)) continue;
		seen.add(key);
		unique.push(item);
	}
	return unique;
}

/**
 * Fallback candidates ordered by the priority of the configured language list,
 * so `eng,jpn` prefers English releases and only then Japanese ones.
 */
function fallbackCandidates(cfg, items) {
	const priority = langList(cfg.fallbackLangs);
	const ranked = [];

	items.forEach((item, index) => {
		const rank = priority.indexOf(normalizeLang(item.lang));
		if (rank !== -1) ranked.push({ item, rank, index });
	});

	return ranked
		.sort((a, b) => a.rank - b.rank || a.index - b.index)
		.slice(0, MAX_FALLBACK_ENTRIES)
		.map((entry) => entry.item);
}

async function handleSubtitles({ type, id, config, baseUrl }) {
	const cfg = decodeConfig(config);
	const items = await listSubtitles(cfg, type, id);
	const pathSegment = config || 'default';
	const lang = outputLang(cfg.to);
	const subtitles = [];

	const chinese = dedupe(items.filter((item) => langAllowed(cfg, item.lang))).slice(0, MAX_CONVERTED_ENTRIES);
	const translatable = chinese.length || !cfg.deeplKey ? [] : fallbackCandidates(cfg, dedupe(items));

	for (const item of chinese) {
		subtitles.push({
			id: `opencc:${item.id}`,
			url: `${baseUrl}/srt/${pathSegment}/${encodeToken({ u: item.url, f: item.fileId, n: item.name })}.srt`,
			lang,
			label: composeLabel('繁體中文', item.name),
		});

		if (cfg.keepOriginal) {
			subtitles.push({
				id: `opencc-raw:${item.id}`,
				url: `${baseUrl}/srt/${pathSegment}/${encodeToken({ u: item.url, f: item.fileId, n: item.name, r: 1 })}.srt`,
				lang: normalizeLang(item.lang) || lang,
				label: composeLabel('簡體原文', item.name),
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
			label: composeLabel('繁體中文（DeepL）', item.name),
		});
	}

	return { subtitles };
}

module.exports = {
	handleSubtitles,
	dedupe,
	releaseLabel,
	composeLabel,
	MAX_CONVERTED_ENTRIES,
	MAX_FALLBACK_ENTRIES,
	RELEASE_LABEL_LIMIT,
};
