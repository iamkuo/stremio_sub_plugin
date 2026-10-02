'use strict';

/**
 * SRT/VTT plumbing shared by every translation provider.
 *
 * A subtitle is translated cue by cue: cue numbers and timing lines must pass
 * through untouched, and translating one cue at a time keeps each request small
 * and aligned with what the viewer will actually see.
 */

const INDEX_LINE = /^\s*\d+\s*$/;
const TIMING_LINE = /^\s*\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}\s*-->/;

/**
 * Finds the translatable text of a subtitle. Consecutive non-empty lines that
 * are neither cue numbers nor timing lines form one segment (normally exactly
 * one cue), so each segment is translated with its own context.
 */
function splitSegments(text) {
	const lines = text.split(/\r?\n/);
	const segments = [];
	let current = null;

	lines.forEach((line, index) => {
		if (!line.trim() || INDEX_LINE.test(line) || TIMING_LINE.test(line)) {
			current = null;
			return;
		}
		if (current) current.end = index;
		else {
			current = { start: index, end: index };
			segments.push(current);
		}
	});

	return { lines, segments };
}

/** Puts translated segments back between the original numbers and timings. */
function assembleSubtitle(text, lines, segments, translations) {
	const output = [];
	let cursor = 0;

	segments.forEach((segment, index) => {
		while (cursor < segment.start) output.push(lines[cursor++]);
		output.push(...String(translations[index] ?? '').split('\n'));
		cursor = segment.end + 1;
	});
	while (cursor < lines.length) output.push(lines[cursor++]);

	return output.join(text.includes('\r\n') ? '\r\n' : '\n');
}

/**
 * Runs one provider over every cue of a subtitle.
 *
 * @param {string} text
 * @param {(texts: string[]) => Promise<{texts: string[], requests: number}>} translate
 * @returns {Promise<{text: string, characters: number, requests: number, segments: number}>}
 */
async function translateSubtitleText(text, translate) {
	const { lines, segments } = splitSegments(text);
	if (!segments.length) return { text, characters: 0, requests: 0, segments: 0 };

	const sources = segments.map((segment) => lines.slice(segment.start, segment.end + 1).join('\n'));
	const { texts: translations, requests = 0 } = await translate(sources);

	if (!Array.isArray(translations) || translations.length !== sources.length) {
		throw new Error('翻譯服務回傳的段數與請求不符');
	}

	return {
		text: assembleSubtitle(text, lines, segments, translations),
		characters: sources.reduce((total, source) => total + source.length, 0),
		requests,
		segments: segments.length,
	};
}

/**
 * Runs `worker` over every item with at most `limit` in flight, preserving
 * order. A feature length subtitle is dozens of requests, and doing them one at
 * a time makes the player wait a minute for its subtitles.
 */
async function mapWithConcurrency(items, limit, worker) {
	const results = new Array(items.length);
	let next = 0;

	const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
		for (;;) {
			const index = next;
			next += 1;
			if (index >= items.length) return;
			results[index] = await worker(items[index], index);
		}
	});

	await Promise.all(runners);
	return results;
}

module.exports = {
	splitSegments,
	assembleSubtitle,
	translateSubtitleText,
	mapWithConcurrency,
	INDEX_LINE,
	TIMING_LINE,
};
