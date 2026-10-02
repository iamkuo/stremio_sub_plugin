'use strict';

/**
 * Live check for the fallback translation chain against the real providers.
 *
 * Starts nothing: point it at a running addon. It lists a film that has no
 * Chinese subtitle upstream, downloads the fallback entry and reports which
 * provider served it plus how much Simplified Chinese survived.
 *
 *   PUB=http://127.0.0.1:7100 node test/live-google.js tt2380307
 */

const PUB = (process.env.PUB || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const SIMPLIFIED = new Set(Array.from(require('../src/data/simplified-chars')));

const IDS = process.argv.slice(2);

function encodeConfig(settings) {
	return Buffer.from(JSON.stringify(settings), 'utf8').toString('base64url');
}

async function main() {
	const config = encodeConfig({ fl: 'eng', t: 'twp' });
	console.log(`addon   : ${PUB}`);
	console.log(`config  : ${config}`);

	for (const id of IDS) {
		const started = Date.now();
		const listResponse = await fetch(`${PUB}/${config}/subtitles/movie/${id}.json`);
		const list = await listResponse.json();
		const subtitles = list.subtitles || [];
		console.log(`\n=== ${id} : ${subtitles.length} fallback entries`);

		if (!subtitles.length) {
			console.log('  no fallback subtitle available');
			continue;
		}

		const entry = subtitles[0];
		console.log(`  label : ${entry.label}`);
		const fileResponse = await fetch(entry.url);
		const body = await fileResponse.text();
		const seconds = ((Date.now() - started) / 1000).toFixed(1);

		if (fileResponse.status !== 200) {
			console.log(`  FAILED: HTTP ${fileResponse.status} → ${body.trim().slice(0, 160)}`);
			continue;
		}

		const simplified = [...new Set(Array.from(body).filter((char) => SIMPLIFIED.has(char)))];
		const cues = (body.match(/-->/g) || []).length;
		const sample = body.split(/\r?\n/).find((line) => line.trim() && !/^\d+$/.test(line) && !line.includes('-->'));

		console.log(`  bytes : ${body.length} ・ cues: ${cues} ・ ${seconds}s`);
		console.log(`  sample: ${String(sample || '').slice(0, 60)}`);
		console.log(`  simplified chars left: ${simplified.length}${simplified.length ? ` (${simplified.slice(0, 12).join('')})` : ''}`);
	}
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
