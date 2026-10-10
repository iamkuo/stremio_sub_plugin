'use strict';

/**
 * ASS/SSA to SRT.
 *
 * Sources hand back Advanced SubStation scripts as readily as SRT: SubSense
 * answers with SubsPlease's `.ass` files, which are the common release format
 * for anime. They are not SRT with different punctuation — the cues live in
 * `Dialogue:` lines whose fields are declared by a `Format:` line, the times are
 * centiseconds, and the text carries `{...}` override blocks and `\N` breaks.
 *
 * Served unchanged the player finds no cue at all in them and reports
 * "no tracks"; on the translation path the script's own header is taken for
 * subtitle text and sent to the translator, which rejects it. Converting on the
 * way in means every path downstream sees an ordinary SRT.
 */

const ASS_HEADER = /^\s*\uFEFF?\[Script Info\]/i;
const EVENTS_SECTION = /^\[events\]$/i;
/** Fields of a `Dialogue:` line when `[Events]` declares no `Format:`. */
const DEFAULT_FIELDS = ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];

/** `\p1` switches to vector drawing until `\p0`: what follows is shape data. */
const DRAWING_BLOCK = /\{[^}]*\\p[1-9]\d*[^}]*\}[\s\S]*?\{[^}]*\\p0[^}]*\}/gi;
const OVERRIDE_BLOCK = /\{[^}]*\}/g;

/**
 * True when the text is an ASS/SSA script rather than SRT or VTT.
 *
 * @param {string} text
 * @returns {boolean}
 */
function looksLikeAss(text) {
	const sample = String(text || '').slice(0, 4000);
	return ASS_HEADER.test(sample) || /\[Events\]/i.test(sample) || /^\s*Dialogue\s*:/im.test(sample);
}

/**
 * `0:00:00.95` to `00:00:00,950`.
 *
 * ASS counts centiseconds, SRT milliseconds, so the fraction is scaled by its
 * own width rather than being padded.
 *
 * @returns {string|null} null when the field is not a time
 */
function assTime(value) {
	const match = /^\s*(\d+):(\d{1,2}):(\d{1,2})[.:](\d{1,3})\s*$/.exec(String(value || ''));
	if (!match) return null;

	const [, hours, minutes, seconds, fraction] = match;
	const millis = String(Number(fraction) * Math.pow(10, 3 - fraction.length)).padStart(3, '0');
	return (
		`${String(Number(hours)).padStart(2, '0')}:` +
		`${minutes.padStart(2, '0')}:${seconds.padStart(2, '0')},${millis}`
	);
}

/** Strips override blocks and turns ASS line breaks into real ones. */
function assText(value) {
	return String(value || '')
		.replace(DRAWING_BLOCK, '')
		.replace(OVERRIDE_BLOCK, '')
		.replace(/\\[Nn]/g, '\n')
		.replace(/\\h/g, ' ')
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean)
		.join('\n');
}

/**
 * Converts an ASS/SSA script into SRT.
 *
 * @param {string} text
 * @returns {string} SRT, or '' when the script holds no usable dialogue
 */
function assToSrt(text) {
	const lines = String(text || '').split(/\r?\n/);
	const cues = [];
	let inEvents = false;
	let fields = null;

	for (const raw of lines) {
		const line = raw.trim();

		if (/^\[.*\]$/.test(line)) {
			// `[V4+ Styles]` declares its own `Format:`, so the section is tracked
			// rather than trusting whichever `Format:` came last.
			inEvents = EVENTS_SECTION.test(line);
			fields = null;
			continue;
		}
		if (/^Format\s*:/i.test(line)) {
			if (inEvents) {
				fields = line
					.slice(line.indexOf(':') + 1)
					.split(',')
					.map((name) => name.trim().toLowerCase());
			}
			continue;
		}

		const dialogue = /^(Dialogue|Comment)\s*:\s?(.*)$/i.exec(line);
		if (!dialogue || !inEvents) continue;
		// A `Comment:` line is an author's note, not something to show.
		if (/^comment$/i.test(dialogue[1])) continue;

		const columns = fields && fields.includes('text') ? fields : DEFAULT_FIELDS;
		const startAt = columns.indexOf('start');
		const endAt = columns.indexOf('end');
		const textAt = columns.indexOf('text');
		if (startAt < 0 || endAt < 0 || textAt < 0) continue;

		// Only the fields before the text are split off: the text is last and
		// routinely contains commas of its own.
		const parts = dialogue[2].split(',');
		const head = parts.slice(0, textAt);
		const start = assTime(head[startAt]);
		const end = assTime(head[endAt]);
		const content = assText(parts.slice(textAt).join(','));
		if (!start || !end || !content) continue;

		cues.push(`${start} --> ${end}\n${content}`);
	}

	if (!cues.length) return '';
	return `${cues.map((cue, index) => `${index + 1}\n${cue}`).join('\n\n')}\n`;
}

module.exports = { looksLikeAss, assToSrt, assTime, assText };
