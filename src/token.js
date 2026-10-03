'use strict';

/**
 * Opaque handles for the subtitle endpoint. A token only ever describes *which*
 * upstream file to fetch and what to do with it:
 *
 *   `u` = direct URL, `f` = OpenSubtitles.com file id, `n` = file name,
 *   `r` = serve the raw original, `x` = machine translate, `s` = source language.
 *   `v` = name of the file being played, `rt` = film runtime in seconds. Both
 *   exist only for the frame-rate check, which cannot run until the subtitle's
 *   own length is known — i.e. on download, not while the list is built.
 *
 * The conversion settings always come from the config segment of the URL.
 */
function encodeToken(data) {
	const compact = {};
	if (data.u) compact.u = data.u;
	if (data.f) compact.f = data.f;
	if (data.n) compact.n = data.n;
	if (data.r) compact.r = 1;
	if (data.x) compact.x = 1;
	if (data.s) compact.s = data.s;
	if (data.v) compact.v = data.v;
	if (data.rt) compact.rt = data.rt;
	return Buffer.from(JSON.stringify(compact), 'utf8').toString('base64url');
}

function decodeToken(token) {
	try {
		const raw = JSON.parse(Buffer.from(String(token), 'base64url').toString('utf8'));
		if (!raw || typeof raw !== 'object') return null;
		return {
			url: raw.u,
			fileId: raw.f,
			name: raw.n,
			raw: raw.r === 1,
			translate: raw.x === 1,
			sourceLang: raw.s,
			videoName: raw.v,
			runtimeSeconds: Number(raw.rt) > 0 ? Number(raw.rt) : 0,
		};
	} catch {
		return null;
	}
}

module.exports = { encodeToken, decodeToken };
