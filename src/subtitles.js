'use strict';

const { decodeConfig, clampPerLanguageLimit } = require('./config');
const { outputLang, convertSubtitle, looksSimplified } = require('./opencc');
const { listSubtitles, normalizeLang } = require('./sources');
const { sourceList } = require('./sources');
const { canonicalLang, canonicalList, languageName, toGoogleLanguage } = require('./langs');
const { rankByMatch } = require('./match');
const { fetchRuntimeSeconds } = require('./cinemeta');
const { encodeToken } = require('./token');

/**
 * Stremio `subtitles` resource handler.
 *
 * Two kinds of entries come out of here:
 *
 * - **Chinese** candidates are converted with OpenCC on download, so the
 *   upstream file is never sent to the player directly.
 * - **Every other configured language** is listed untouched. The file is still
 *   proxied, because upstream encodings are a mess (CP1252, Big5, GBK), but no
 *   conversion is applied — it is served in its original language.
 *
 * When the video has no Chinese subtitle at all, the configured fallback
 * languages (English by default) are machine translated with Google Translate
 * instead. Translation happens on download, not here, so a request is spent
 * only on the subtitle the viewer actually picks.
 *
 * Sources routinely list the same file several times, and a popular film can
 * carry dozens of releases. Stremio's picker shows one row per entry, so
 * duplicates are collapsed and the list is capped per language: a wall of
 * identical rows is worse than a short list.
 */

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
 * Release names are frequently Simplified too, and the picker is part of this
 * addon's UI: `盗梦空间 4K` next to a 繁體中文 label reads as a bug. Only names
 * that genuinely contain Simplified characters are converted, so Latin release
 * tags (`1080p BluRay x264-AMIABLE`) pass through untouched.
 */
function traditionalName(name, cfg) {
	if (!name || !looksSimplified(name)) return name;
	return convertSubtitle(name, { ...cfg, mode: 'always' }).text;
}

/**
 * `繁體中文`, or `繁體中文（subsense）` once several upstreams are configured —
 * otherwise two entries from different addons look identical in the picker.
 */
function withOrigin(kind, item, showOrigin) {
	return showOrigin && item.origin ? `${kind}（${item.origin}）` : kind;
}

/**
 * Name of the converted output, following the configured OpenCC target so a
 * `t2s` setup does not advertise itself as Traditional.
 */
function convertedLabel(cfg) {
	if (cfg.to === 'cn') return '简体中文';
	if (cfg.to === 'hk' || cfg.to === 'hkp') return '繁體中文（香港）';
	return '繁體中文';
}

/**
 * The primary languages, in the order the viewer asked for them.
 *
 * A primary language is a promise: if the film has nothing in it, a machine
 * translation is offered rather than an empty slot. Chinese spellings collapse
 * into one entry so `zht,chi,zh-tw` is not three languages.
 */
function primaryLanguages(cfg) {
	const codes = canonicalList(cfg.langs);
	return codes.length ? codes : ['zh'];
}

/** The secondary languages: a preference, listed only when the film has them. */
function secondaryLanguages(cfg) {
	const primary = primaryLanguages(cfg);
	return canonicalList(cfg.secondary).filter((code) => !primary.includes(code));
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
 * Orders one language's candidates by how well their release name matches the
 * file being played, and keeps the configured number of them.
 *
 * The first entry is flagged when it is a genuine match, so the viewer can see
 * which row belongs to their copy. Stremio sorts the picker unpredictably
 * (stremio-bugs#2223), which is exactly why the match is marked in the label
 * rather than only sorted to the top.
 *
 * @returns {Array<{ item: object, best: boolean }>}
 */
function rankAndPick(items, extras, limit) {
	const videoName = extras && extras.filename;
	// A hash match is a subtitle uploaded for this exact file, which no amount
	// of release-name similarity can outrank.
	const ranked = rankByMatch(items, videoName).sort(
		(a, b) => Number(Boolean(b.item.hashMatch)) - Number(Boolean(a.item.hashMatch)) || a.index - b.index
	);

	// A mark means "this one, out of the several on offer". With a single
	// candidate there is nothing to pick between, so the mark would say nothing
	// — unless it is a hash match, which is worth stating on its own.
	const worthMarking = items.length > 1;

	return ranked
		.slice(0, limit)
		.map((entry, position) => ({
			item: entry.item,
			best: position === 0 && (entry.item.hashMatch || (worthMarking && entry.distinct)),
		}));
}

/**
 * The files a primary language is translated from, ordered by the priority of
 * the configured source languages, so `eng,jpn` prefers English releases and
 * only then Japanese ones.
 *
 * `skip` is the language being translated into: translating a language into
 * itself would be pointless and would occupy a slot that a real translation
 * could use.
 */
function translationSources(from, items, limit, skip) {
	const ranked = [];

	items.forEach((item, index) => {
		const code = canonicalLang(item.lang);
		if (!code || code === skip) return;
		const rank = from.indexOf(code);
		if (rank !== -1) ranked.push({ item, rank, index });
	});

	return ranked
		.sort((a, b) => a.rank - b.rank || a.index - b.index)
		.slice(0, limit)
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

async function handleSubtitles({ type, id, config, baseUrl, extras }) {
	const cfg = decodeConfig(config);
	const items = dedupe(await listSubtitles(cfg, type, id, extras));
	const pathSegment = config || 'default';
	const chineseLang = outputLang(cfg.to);
	const subtitles = [];
	const showOrigin = sourceList(cfg.sources).length > 1;
	const limit = clampPerLanguageLimit(cfg.perLanguageLimit);
	const primary = primaryLanguages(cfg);
	const secondary = secondaryLanguages(cfg);
	const translateFrom = canonicalList(cfg.fallbackLangs);

	// The frame-rate check itself runs on download, because what decides it is
	// whether the subtitle runs short or long — which is only known once the
	// file is fetched. Its two other inputs, the file being played and the
	// film's runtime, exist only on this request, so they are captured here.
	const timing = {};
	if (cfg.fpsMode === 'auto') {
		if (extras && extras.filename) timing.v = String(extras.filename).slice(0, 160);
		const runtimeSeconds = await fetchRuntimeSeconds(type, id);
		if (runtimeSeconds) timing.rt = runtimeSeconds;
	}

	const byLanguage = new Map();
	for (const item of items) {
		const code = canonicalLang(item.lang);
		if (!code) continue;
		if (!byLanguage.has(code)) byLanguage.set(code, []);
		byLanguage.get(code).push(item);
	}

	/** The files the film already has in one language, converted when Chinese. */
	const listExisting = (code, group) => {
		for (const { item, best } of rankAndPick(group, extras, limit)) {
			const name = traditionalName(item.name, cfg);
			const mark = best ? '✓ ' : '';

			if (code === 'zh') {
				subtitles.push({
					id: `opencc:${item.id}`,
					url: `${baseUrl}/srt/${pathSegment}/${encodeToken({ u: item.url, f: item.fileId, n: item.name, ...timing })}.srt`,
					lang: chineseLang,
					label: composeLabel(mark + withOrigin(convertedLabel(cfg), item, showOrigin), name),
				});
				continue;
			}

			// Any other language is listed as it is: the file is proxied for
			// encoding normalisation only, and keeps its original language.
			subtitles.push({
				id: `native:${item.id}`,
				url: `${baseUrl}/srt/${pathSegment}/${encodeToken({ u: item.url, f: item.fileId, n: item.name, r: 1, ...timing })}.srt`,
				lang: normalizeLang(item.lang) || code,
				label: composeLabel(mark + withOrigin(languageName(code), item, showOrigin), name),
			});
		}
	};

	/**
	 * What a primary language falls back to: files in the configured source
	 * languages, translated into that language on download.
	 *
	 * Nothing is offered when Google cannot produce the language at all — better
	 * an absent entry than one that can only fail when the viewer picks it.
	 */
	const listTranslated = (code) => {
		const target = toGoogleLanguage(code, cfg.to);
		if (!target) return;
		const kind = code === 'zh' ? convertedLabel(cfg) : languageName(code);
		for (const item of translationSources(translateFrom, items, limit, code)) {
			subtitles.push({
				id: `machine:${code}:${item.id}`,
				url: `${baseUrl}/srt/${pathSegment}/${encodeToken({
					u: item.url,
					f: item.fileId,
					n: item.name,
					x: 1,
					s: normalizeLang(item.lang),
					g: target,
					...timing,
				})}.srt`,
				lang: code === 'zh' ? chineseLang : code,
				label: composeLabel(`${kind}（Google）`, traditionalName(item.name, cfg)),
			});
		}
	};

	// A primary language is a promise, so a missing one is translated into.
	for (const code of primary) {
		const group = byLanguage.get(code);
		if (group && group.length) listExisting(code, group);
		else listTranslated(code);
	}

	// A secondary language is a preference: listed when the film has it, and
	// otherwise simply absent.
	for (const code of secondary) {
		const group = byLanguage.get(code);
		if (group && group.length) listExisting(code, group);
	}

	return { subtitles: disambiguateLabels(subtitles) };
}

module.exports = {
	handleSubtitles,
	dedupe,
	releaseLabel,
	composeLabel,
	traditionalName,
	convertedLabel,
	primaryLanguages,
	secondaryLanguages,
	rankAndPick,
	withOrigin,
	disambiguateLabels,
	RELEASE_LABEL_LIMIT,
};
