'use strict';

/**
 * Live check against a running addon: converts a few real subtitles and diffs
 * them against the upstream file the entry was built from. The upstream URL is
 * read out of the addon's own token, so the check needs nothing but the addon.
 *
 *   PUB=https://host CFG=<base64url config> node test/live-check.js
 */

const SIMPLIFIED = new Set(Array.from(require('../src/data/simplified-chars')));

const PUB = process.env.PUB || 'http://127.0.0.1:7000';
const CFG = process.env.CFG || 'default';

/** The upstream file an entry was built from, read out of the entry's token. */
function upstreamUrl(entryUrl) {
	try {
		const token = new URL(entryUrl).pathname.split('/').pop().replace(/\.srt$/i, '');
		const data = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
		return data.u || null;
	} catch {
		return null;
	}
}

const TARGETS = [
	['movie', 'tt0816692'],
	['movie', 'tt1375666'],
	['movie', 'tt4154796'],
	['movie', 'tt6751668'],
	['movie', 'tt2380307'],
	['movie', 'tt0437086'],
	['movie', 'tt0106063'],
	['series', 'tt0903747:1:1'],
];

function textLines(text) {
	return text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line && !/^\d+$/.test(line) && !line.includes('-->'));
}

function leftovers(text) {
	return [...new Set(Array.from(text).filter((char) => SIMPLIFIED.has(char)))];
}

async function main() {
	let convertedTotal = 0;
	let rawTotal = 0;

	for (const [type, id] of TARGETS) {
		let entries;
		try {
			const response = await fetch(`${PUB}/${CFG}/subtitles/${type}/${id}.json`);
			entries = (await response.json()).subtitles || [];
		} catch (error) {
			console.log(`${id.padEnd(14)} request failed: ${error.message}`);
			continue;
		}

		if (!entries.length) {
			console.log(`${id.padEnd(14)} no Chinese subtitle upstream`);
			continue;
		}

		const converted = await (await fetch(entries[0].url)).text();
		const raw = upstreamUrl(entries[0].url);
		const original = raw ? await (await fetch(raw)).text().catch(() => null) : null;

		const before = original ? leftovers(original) : leftovers(converted);
		const after = leftovers(converted);

		const convertedLines = textLines(converted);
		const originalLines = original ? textLines(original) : convertedLines;
		let changed = 0;
		for (let i = 0; i < convertedLines.length; i += 1) {
			if (convertedLines[i] !== originalLines[i]) changed += 1;
		}

		convertedTotal += 1;
		if (original) rawTotal += 1;

		console.log(
			`${id.padEnd(14)} lines=${convertedLines.length} changed=${changed} ` +
				`| simplified chars ${before.length} -> ${after.length}` +
				`${before.length ? ' [' + before.join('') + ']' : ''}` +
				`${after.length ? ' leftover [' + after.join('') + ']' : ''}`
		);

		const sampleIndex = convertedLines.findIndex((line, i) => line !== originalLines[i]);
		if (sampleIndex >= 0) {
			console.log(`   before: ${originalLines[sampleIndex]}`);
			console.log(`   after : ${convertedLines[sampleIndex]}`);
		}
	}

	console.log(`\nchecked ${convertedTotal} subtitle(s), ${rawTotal} with a raw copy for diffing`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
