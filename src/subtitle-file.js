'use strict';

const iconv = require('iconv-lite');
const { convertSubtitle, TRADITIONAL_TARGETS } = require('./opencc');
const { toDeepLSource, toDeepLTarget } = require('./langs');
const { translateSubtitle } = require('./deepl');
const { resolveDownloadLink } = require('./sources');
const { decodeToken } = require('./token');

const CACHE_TTL = 60 * 60 * 1000; // 1 hour
const CACHE_LIMIT = 200;
const cache = new Map();

function cacheGet(key) {
	const hit = cache.get(key);
	if (!hit) return null;
	if (Date.now() > hit.expires) {
		cache.delete(key);
		return null;
	}
	return hit.value;
}

function cacheSet(key, value) {
	if (cache.size >= CACHE_LIMIT) {
		const oldest = cache.keys().next().value;
		cache.delete(oldest);
	}
	cache.set(key, { value, expires: Date.now() + CACHE_TTL });
}

/**
 * Subtitle files come from third parties in whatever encoding they like.
 * Prefer BOM, then the declared charset, then UTF-8, then the common Chinese
 * legacy encodings.
 */
function decodeBuffer(buffer, contentType) {
	if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
		return buffer.subarray(3).toString('utf8');
	}
	if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return iconv.decode(buffer, 'utf16le');
	if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) return iconv.decode(buffer, 'utf16be');

	const declared = /charset=["']?([\w-]+)/i.exec(contentType || '');
	if (declared && !/utf-?8/i.test(declared[1])) {
		const decoded = iconv.decode(buffer, declared[1]);
		if (!decoded.includes('\uFFFD')) return decoded;
	}

	const utf8 = buffer.toString('utf8');
	if (!utf8.includes('\uFFFD')) return utf8;

	for (const encoding of ['gbk', 'big5']) {
		const decoded = iconv.decode(buffer, encoding);
		if (!decoded.includes('\uFFFD')) return decoded;
	}
	return iconv.decode(buffer, 'gbk');
}

async function downloadSubtitle(url) {
	const response = await fetch(url, {
		headers: { 'User-Agent': 'OpenCC-Stremio-Subtitles v1.0' },
		signal: AbortSignal.timeout(20000),
	});
	if (!response.ok) throw new Error(`字幕下載失敗（HTTP ${response.status}）`);
	const buffer = Buffer.from(await response.arrayBuffer());
	return { buffer, contentType: response.headers.get('content-type') || '' };
}

/**
 * Machine translates a subtitle with the viewer's own DeepL key.
 *
 * DeepL's `ZH-HANT` output is already Traditional Chinese, but it does not
 * apply Taiwan/Hong Kong vocabulary, so the configured OpenCC pair is run
 * afterwards when the target is a Traditional variant. That step is a no-op
 * for character conversion and only localises wording.
 */
async function translateWithDeepL(source, cfg, handle) {
	if (!cfg.deeplKey) {
		throw Object.assign(new Error('這個字幕需要 DeepL 翻譯，但尚未設定 DeepL API Key'), { statusCode: 400 });
	}

	const targetLang = toDeepLTarget(cfg.to);
	const result = await translateSubtitle(source, {
		apiKey: cfg.deeplKey,
		sourceLang: toDeepLSource(handle.sourceLang),
		targetLang,
	});

	if (TRADITIONAL_TARGETS.has(cfg.to)) {
		try {
			return convertSubtitle(result.text, { ...cfg, mode: 'always' }).text;
		} catch {
			return result.text;
		}
	}
	return result.text;
}

/**
 * Serves one converted or translated subtitle file.
 *
 * @returns {{ body: string, contentType: string, filename: string }}
 */
async function buildSubtitleFile({ cfg, token, configSegment }) {
	const handle = decodeToken(token);
	if (!handle) throw Object.assign(new Error('無效的字幕連結'), { statusCode: 400 });

	const cacheKey = `${configSegment}:${token}`;
	const cached = cacheGet(cacheKey);
	if (cached) return cached;

	let url = handle.url;
	if (!url && handle.fileId) url = await resolveDownloadLink(cfg, handle.fileId);
	if (!url) throw Object.assign(new Error('找不到字幕來源'), { statusCode: 404 });

	const { buffer, contentType } = await downloadSubtitle(url);
	const source = decodeBuffer(buffer, contentType);

	const baseName = String(handle.name || 'subtitle').replace(/\.(srt|vtt|ass|ssa)$/i, '') || 'subtitle';
	const extension = /\.vtt$/i.test(handle.name || '') ? 'vtt' : 'srt';

	let body;
	if (handle.raw) body = source;
	else if (handle.translate) body = await translateWithDeepL(source, cfg, handle);
	else body = convertSubtitle(source, cfg).text;

	const result = {
		body,
		contentType: extension === 'vtt' ? 'text/vtt; charset=utf-8' : 'application/x-subrip; charset=utf-8',
		filename: `${baseName}.${extension}`,
	};

	cacheSet(cacheKey, result);
	return result;
}

module.exports = { buildSubtitleFile, decodeBuffer, translateWithDeepL };
