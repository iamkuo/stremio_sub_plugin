'use strict';

/** Sanity checks for the auto-detection character set (see tools/build.js). */

const assert = require('assert');
const chars = require('../src/data/simplified-chars');
const { looksSimplified } = require('../src/opencc');

const set = new Set(Array.from(chars));

/** Characters that must be recognised as Simplified. */
const SIMPLIFIED = [
	'这说国学时电见语汉简体转换对开关门问题点线车马鸟鱼乐买卖爱儿头长义艺忆应与无书让认谁请谢',
	'记词讲论议识试读写画听声觉观视频员军农产业东轮轻载输辆银钱铁钢错锁钟键针钉铅铝铜铺链销镜',
	'队阳阴际陆陈随险隐难韩页顶顺须项顾预领颗颜风飞饭饮馆骑验鲜鸡鸣鹅黄齿龙质张图团园圆围场坏块坚坛',
];

/** Characters that are valid Traditional (or identical in both) and must not be flagged. */
const NOT_SIMPLIFIED = '吃秘峰群台后里面云万黑高骨征凶伙熏厘咨雇据丑杰启弃';

/** Whole-text samples. */
const SIMPLIFIED_TEXT = [
	'我已经把这个问题解决了',
	'这个软件里面的视频',
	'请把门关起来',
];
const TRADITIONAL_TEXT = [
	'他語無倫次，但是提到你的名字',
	'這個軟體裡面的影片和滑鼠，腳踏車',
	'我父親是個農民，那時候的人差不多都是農民',
	'你是來殺我的嗎',
	'你好，世界',
];

let failures = 0;

for (const group of SIMPLIFIED) {
	for (const char of group) {
		if (!set.has(char)) {
			console.log(`missing simplified char: ${char}`);
			failures += 1;
		}
	}
}

for (const char of NOT_SIMPLIFIED) {
	if (set.has(char)) {
		console.log(`false positive char: ${char}`);
		failures += 1;
	}
}

for (const text of SIMPLIFIED_TEXT) {
	if (!looksSimplified(text)) {
		console.log(`not detected as simplified: ${text}`);
		failures += 1;
	}
}

for (const text of TRADITIONAL_TEXT) {
	if (looksSimplified(text)) {
		const wrong = Array.from(text).filter((char) => set.has(char));
		console.log(`false positive on traditional text: ${text} -> ${wrong.join('')}`);
		failures += 1;
	}
}

assert.strictEqual(Array.from(chars).length, set.size, 'generated set must not contain duplicates');

console.log(`detection set: ${set.size} characters, ${failures} failure(s)`);
process.exit(failures ? 1 : 0);
