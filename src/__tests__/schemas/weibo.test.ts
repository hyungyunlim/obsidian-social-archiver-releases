import { describe, expect, it } from 'vitest';
import { WeiboURLSchema, validateAndDetectPlatform } from '@/schemas/platforms';

const UID = '7740247568';
const MID = '5352537693622943';
const MBLOGID = 'Rm2Kdfcuz';

describe('WeiboURLSchema', () => {
	it.each([
		`https://weibo.com/${UID}/${MID}`,
		`https://weibo.com/${UID}/${MBLOGID}`,
		`https://www.weibo.com/${UID}/${MBLOGID}`,
		`https://m.weibo.cn/detail/${MID}`,
		`https://m.weibo.cn/status/${MBLOGID}`,
	])('accepts the post URL %s', (url) => {
		expect(WeiboURLSchema.safeParse(url).success).toBe(true);
	});

	it.each([
		`https://weibo.com/u/${UID}`,
		'https://weibo.com/tv/show/1034:5352537516081158',
		`https://weibo.com.attacker.example/${UID}/${MID}`,
	])('rejects %s', (url) => {
		expect(WeiboURLSchema.safeParse(url).success).toBe(false);
	});
});

describe('validateAndDetectPlatform — weibo', () => {
	it('routes a Weibo post to the weibo platform', () => {
		const result = validateAndDetectPlatform(`https://weibo.com/${UID}/${MID}`);
		expect(result.valid).toBe(true);
		expect(result.platform).toBe('weibo');
	});

	it('leaves a Weibo profile to the generic web lane', () => {
		const result = validateAndDetectPlatform(`https://weibo.com/u/${UID}`);
		expect(result.platform).not.toBe('weibo');
	});
});
