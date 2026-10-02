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
 * languages (English by default) are machine translated with Google Translate
 * instead. Translation happens on download, not here, so a request is spent
 * only on the subtitle the viewer actually picks.
 *
 * Sources routinely list the same file several times, and a popular film can
 * carry dozens of releases. Stremio's picker shows one row per entry, so
 * duplicates are collapsed and the list is capped: a wall of identical rows is
 * worse than a short list.
 */

const MAX_CONVERTED_ENTRIES = 5;
/** Hard upper bound; the viewer picks the actual length with `fallbackLimit`. */
const MAX_FALLBACK_ENTRIES = 5;
const RELEASE_LABEL_LIMIT = 30;

/** Trailing language tags in release names (`....x264-AMIABLE.cht.srt`). */
const LANGUAGE_TOKEN = /^(cht|chs|chi|zho|zht|zh|cn|tw|hk|eng|en|jpn|ja|kor|ko|spa|es|fra|fre|deu|ger|ita)$/i;

/**
 * Compact, human readable hint of which release a subtitle came from.
 *
 * Release names start with the film title, which every candidate shares and
 * the viewer already knows; the part that actually tells releases apart is the
 * tail (`1080p BluRay x264-AMIABLE`). So a long name keeps its last whole
 * tokens and drops the title, rather than being cut off after the title.
 */
function releaseLabel(name) {
	const cleaned = String(name || '')
		.replace(/\.(srt|vtt|ass|ssa|sub|txt|zip)$/i, '')
		.replace(/[._]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	if (!cleaned) return '';

	const tokens = cleaned.split(' ');
	while (tokens.length > 1 && LANGUAGE_TOKEN.test(tokens[tokens.length - 1])) tokens.pop();
	const trimmed = tokens.join(' ');
	if (trimmed.length <= RELEASE_LABEL_LIMIT) return trimmed;

	let tail = '';
	for (let index = tokens.length - 1; index >= 0; index -= 1) {
		const candidate = tokens.slice(index).join(' ');
		if (candidate.length > RELEASE_LABEL_LIMIT - 1) break;
		tail = candidate;
	}
	return tail ? `…${tail}` : `…${trimmed.slice(0, RELEASE_LABEL_LIMIT - 1)}`;
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
		.slice(0, Math.min(Math.max(1, Number(cfg.fallbackLimit) || 1), MAX_FALLBACK_ENTRIES))
		.map((entry) => entry.item);
}

/**
 * Two genuinely different releases can still compact to the same label. A
 * numeric suffix keeps every row in the picker distinguishable.
 */
function disambiguateLabels(subtitles) {
	const seen = new Map();
	for (const entry of subtitles) {
		if (!entry.label) continue;
		const count = (seen.get(entry.label) || 0) + 1;
		seen.set(entry.label, count);
		if (count > 1) entry.label = `${entry.label} (${count})`;
	}
	return subtitles;
}

async function handleSubtitles({ type, id, config, baseUrl }) {
	const cfg = decodeConfig(config);
	const items = await listSubtitles(cfg, type, id);
	const pathSegment = config || 'default';
	const lang = outputLang(cfg.to);
	const subtitles = [];

	const chinese = dedupe(items.filter((item) => langAllowed(cfg, item.lang))).slice(0, MAX_CONVERTED_ENTRIES);
	// `fallbackCandidates` already yields nothing when no fallback language is
	// configured, so an empty list is the only switch needed here.
	const translatable = chinese.length ? [] : fallbackCandidates(cfg, dedupe(items));
	const fallbackLabel = '繁體中文（Google）';

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
			id: `machine:${item.id}`,
			url: `${baseUrl}/srt/${pathSegment}/${encodeToken({
				u: item.url,
				f: item.fileId,
				n: item.name,
				x: 1,
				s: normalizeLang(item.lang),
			})}.srt`,
			lang,
			label: composeLabel(fallbackLabel, item.name),
		});
	}

	return { subtitles: disambiguateLabels(subtitles) };
}

module.exports = {
	handleSubtitles,
	dedupe,
	releaseLabel,
	composeLabel,
	disambiguateLabels,
	MAX_CONVERTED_ENTRIES,
	MAX_FALLBACK_ENTRIES,
	RELEASE_LABEL_LIMIT,
};
