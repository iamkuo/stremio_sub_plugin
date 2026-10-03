'use strict';

/**
 * Frame-rate correction.
 *
 * A subtitle timed for one frame rate plays progressively further out of sync
 * on a file with another: the gap is nothing at the start and several minutes
 * by the end. It is the one kind of drift that can be fixed by arithmetic,
 * because the error is a constant *factor*, not a constant offset.
 *
 * The two frame rates that matter are 25 (PAL DVDs, European broadcast) and
 * 24000/1001 ≈ 23.976 (film, BluRay, most streaming). The ratio between them
 * is 1.0427, i.e. about four minutes over a feature film.
 *
 * ## Why automatic detection is deliberately cautious
 *
 * The error is detected by comparing the subtitle's last cue against the film's
 * runtime, and the runtime we can look up is rounded to whole minutes. For a
 * two-and-a-half hour film that rounding alone is ±0.7%, while the frame-rate
 * gap is 4.3% — so the two can be told apart, but only just, and only in one
 * direction:
 *
 * - A subtitle ending *after* the film does (ratio ≈ 1.0427) is definitely
 *   mistimed: correct subtitles cannot run four minutes past the end.
 * - A subtitle ending *before* it does (ratio ≈ 0.9590) might equally be
 *   mistimed or simply be a correct subtitle whose last line lands before the
 *   credits. Runtime rounding is too coarse to tell these apart.
 *
 * So `auto` corrects only the first case, and the second is available as an
 * explicit setting. A wrong guess is worse than no correction: it would break a
 * subtitle that was working.
 */

const FPS_FILM = 24000 / 1001; // 23.976
const FPS_PAL = 25;

/** Applied when the subtitle was timed for 25 fps but the file is 23.976. */
const STRETCH = FPS_PAL / FPS_FILM; // ≈ 1.042709
/** Applied when the subtitle was timed for 23.976 fps but the file is 25. */
const COMPRESS = FPS_FILM / FPS_PAL; // ≈ 0.959041

/** Below this, the runtime is too short for its rounding to be ignored. */
const MIN_RUNTIME_SECONDS = 60 * 60;
/** How close to a frame-rate ratio the measured one must be. */
const RATIO_TOLERANCE = 0.012;
/** Subtitles may overrun slightly; four minutes is not slight. */
const PAST_END_TOLERANCE = 0.02;

const STAMP = /(\d{1,2}):(\d{2}):(\d{2})([.,])(\d{1,3})/g;
const TIMING_LINE = /-->/;

/** `PAL` / `25fps` style markers, which state a frame rate outright. */
const PAL_MARKER = /(?:^|[^a-z0-9])(pal|25fps|25\s?fps|25\.000)(?:[^a-z0-9]|$)/i;
const FILM_MARKER = /(?:^|[^a-z0-9])(23\.976|24fps|24\s?fps|23976)(?:[^a-z0-9]|$)/i;

/** Seconds from an `hh:mm:ss,mmm` match. */
function stampSeconds(match) {
	const [, h, m, s, , ms] = match;
	return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, '0')) / 1000;
}

/** Formats seconds back into `hh:mm:ss,mmm`, preserving the original separator. */
function formatStamp(seconds, separator) {
	const total = Math.max(0, seconds);
	const whole = Math.floor(total);
	const millis = Math.round((total - whole) * 1000);
	const h = String(Math.floor(whole / 3600)).padStart(2, '0');
	const m = String(Math.floor((whole % 3600) / 60)).padStart(2, '0');
	const s = String(whole % 60).padStart(2, '0');
	return `${h}:${m}:${s}${separator}${String(millis).padStart(3, '0')}`;
}

/** The last cue's end time, in seconds, or 0 when the text has no timings. */
function lastCueEnd(text) {
	let last = 0;
	for (const line of String(text || '').split(/\r?\n/)) {
		if (!TIMING_LINE.test(line)) continue;
		STAMP.lastIndex = 0;
		let match;
		while ((match = STAMP.exec(line))) last = Math.max(last, stampSeconds(match));
	}
	return last;
}

/**
 * Multiplies every timing by `factor`, leaving cue numbers and text alone.
 * A factor of exactly 1 returns the input untouched.
 */
function scaleTimings(text, factor) {
	if (!Number.isFinite(factor) || Math.abs(factor - 1) < 1e-6) return text;
	const eol = text.includes('\r\n') ? '\r\n' : '\n';

	return text
		.split(/\r?\n/)
		.map((line) => {
			if (!TIMING_LINE.test(line)) return line;
			return line.replace(STAMP, (match, h, m, s, separator, ms) => {
				const seconds = stampSeconds([match, h, m, s, separator, ms]);
				return formatStamp(seconds * factor, separator);
			});
		})
		.join(eol);
}

/**
 * Decides which factor, if any, applies to this subtitle.
 *
 * @param {object} input
 * @param {string} input.mode `auto` | `off` | `25to23976` | `23976to25`
 * @param {string} [input.subName] the subtitle's own release name
 * @param {string} [input.videoName] the file being played, if Stremio sent it
 * @param {number} [input.lastCueSeconds] last cue end, from the subtitle itself
 * @param {number} [input.runtimeSeconds] film runtime, 0 when unknown
 * @returns {{factor: number, reason: string}}
 */
function detectFpsFactor({ mode, subName, videoName, lastCueSeconds, runtimeSeconds }) {
	if (mode === 'off') return { factor: 1, reason: 'off' };
	if (mode === '25to23976') return { factor: STRETCH, reason: 'manual' };
	if (mode === '23976to25') return { factor: COMPRESS, reason: 'manual' };

	// An explicit frame-rate marker on both sides is the strongest signal there
	// is: it states the frame rate rather than inferring it.
	if (subName && videoName) {
		const subPal = PAL_MARKER.test(subName);
		const subFilm = FILM_MARKER.test(subName);
		const videoPal = PAL_MARKER.test(videoName);
		const videoFilm = FILM_MARKER.test(videoName);

		// Asymmetric on purpose. `PAL` on the video is a positive statement, so
		// its absence means the file is almost certainly film-rate; the film
		// rate itself is the default and rarely spelled out, so its absence
		// proves nothing.
		let suggested = 0;
		if (subPal && !videoPal) suggested = STRETCH;
		else if (subFilm && videoPal) suggested = COMPRESS;

		if (suggested) {
			// The marker says which way, the runtime says whether it happened: if
			// both sides really were the same frame rate, the subtitle would not
			// run short (or long). Without a runtime the marker is trusted alone.
			if (lastCueSeconds && runtimeSeconds >= MIN_RUNTIME_SECONDS) {
				const ratio = lastCueSeconds / runtimeSeconds;
				const consistent = suggested > 1 ? ratio < 1 - RATIO_TOLERANCE : ratio > 1 + RATIO_TOLERANCE;
				if (!consistent) return { factor: 1, reason: 'marker-unconfirmed' };
			}
			return { factor: suggested, reason: 'marker' };
		}
	}

	if (!lastCueSeconds || !runtimeSeconds || runtimeSeconds < MIN_RUNTIME_SECONDS) {
		return { factor: 1, reason: 'no-runtime' };
	}

	// Only the unambiguous direction: a subtitle that overruns the film by the
	// frame-rate gap cannot be correct.
	const ratio = lastCueSeconds / runtimeSeconds;
	if (Math.abs(ratio - STRETCH) <= RATIO_TOLERANCE) return { factor: COMPRESS, reason: 'runtime' };
	if (ratio > 1 + PAST_END_TOLERANCE) return { factor: 1, reason: 'overrun-unknown' };

	return { factor: 1, reason: 'in-sync' };
}

module.exports = {
	lastCueEnd,
	scaleTimings,
	detectFpsFactor,
	FPS_FILM,
	FPS_PAL,
	STRETCH,
	COMPRESS,
	RATIO_TOLERANCE,
	MIN_RUNTIME_SECONDS,
};
