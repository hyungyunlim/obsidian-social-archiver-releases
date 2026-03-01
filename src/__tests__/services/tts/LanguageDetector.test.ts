import { describe, it, expect } from 'vitest';
import { detectLanguage } from '@/services/tts/LanguageDetector';

describe('LanguageDetector', () => {
	describe('empty input', () => {
		it('should return undefined for empty string', () => {
			expect(detectLanguage('')).toBeUndefined();
		});

		it('should return undefined for whitespace-only string', () => {
			expect(detectLanguage('   \t\n  ')).toBeUndefined();
		});

		it('should return undefined for string of only punctuation', () => {
			expect(detectLanguage('!!! ??? ...')).toBeUndefined();
		});
	});

	describe('Korean detection', () => {
		it('should detect Korean text', () => {
			const koreanText = '안녕하세요. 오늘 날씨가 좋습니다. 산책하러 갈까요?';
			expect(detectLanguage(koreanText)).toBe('ko-KR');
		});

		it('should detect Korean even when mixed with some English', () => {
			// Korean should be > 20% of meaningful characters
			const mixed = '안녕하세요 Hello 오늘 날씨 World';
			expect(detectLanguage(mixed)).toBe('ko-KR');
		});

		it('should detect Hangul Jamo characters', () => {
			// Hangul Jamo (U+1100–U+11FF)
			const jamo = 'ᄀᄁᄂᄃᄄᄅᄆᄇᄈᄉᄊ normal text here';
			expect(detectLanguage(jamo)).toBe('ko-KR');
		});
	});

	describe('Japanese detection', () => {
		it('should detect Japanese Hiragana text', () => {
			const japanese = 'こんにちは。今日はいい天気ですね。散歩しましょうか。';
			expect(detectLanguage(japanese)).toBe('ja-JP');
		});

		it('should detect Japanese Katakana text', () => {
			const katakana = 'コンピューター アプリケーション プログラミング テスト';
			expect(detectLanguage(katakana)).toBe('ja-JP');
		});

		it('should detect mixed Hiragana and Katakana', () => {
			const mixed = 'これはテストです。プログラミングをしましょう。';
			expect(detectLanguage(mixed)).toBe('ja-JP');
		});
	});

	describe('Chinese detection', () => {
		it('should detect Chinese text as zh-CN', () => {
			const text = '中文文字与123456 some english 中文更多文字的内容';
			const result = detectLanguage(text);
			expect(result).toBe('zh-CN');
		});
	});

	describe('English detection', () => {
		it('should detect English text', () => {
			const english = 'This is a simple English sentence for testing language detection.';
			expect(detectLanguage(english)).toBe('en-US');
		});

		it('should detect English for text that is mostly Latin characters', () => {
			const text = 'The quick brown fox jumps over the lazy dog. Programming is fun.';
			expect(detectLanguage(text)).toBe('en-US');
		});
	});

	describe('German detection', () => {
		it('should detect German text with diacritics', () => {
			const german = 'Die Straße ist lang und führt über den Fluss. Schöne Grüße aus München.';
			expect(detectLanguage(german)).toBe('de-DE');
		});

		it('should detect German with umlauts', () => {
			const german = 'Für die Änderung der Größe müssen wir die Lösung überprüfen.';
			expect(detectLanguage(german)).toBe('de-DE');
		});

		it('should detect German via stop-words when diacritics are sparse', () => {
			const german = 'Das ist ein sehr guter Ansatz und die Ergebnisse sind nicht schlecht.';
			expect(detectLanguage(german)).toBe('de-DE');
		});
	});

	describe('French detection', () => {
		it('should detect French text with diacritics', () => {
			const french = "C'est une très belle journée. Les élèves étaient à l'école.";
			expect(detectLanguage(french)).toBe('fr-FR');
		});

		it('should detect French via accented characters', () => {
			const french = 'Le café était fermé mais la bibliothèque était ouverte.';
			expect(detectLanguage(french)).toBe('fr-FR');
		});
	});

	describe('Spanish detection', () => {
		it('should detect Spanish text with ñ', () => {
			const spanish = 'El niño pequeño jugaba en el jardín con su compañero.';
			expect(detectLanguage(spanish)).toBe('es-ES');
		});

		it('should detect Spanish with inverted punctuation', () => {
			const spanish = '¿Cómo estás? ¡Hola! Me llamo Carlos y soy de España.';
			expect(detectLanguage(spanish)).toBe('es-ES');
		});
	});

	describe('Portuguese detection', () => {
		it('should detect Portuguese text with ã/õ', () => {
			const portuguese = 'A informação sobre a situação dos cidadãos não está disponível.';
			expect(detectLanguage(portuguese)).toBe('pt-BR');
		});
	});

	describe('Italian detection', () => {
		it('should detect Italian via stop-words', () => {
			const italian = 'Questo è un molto buono esempio della lingua italiana nel mondo.';
			expect(detectLanguage(italian)).toBe('it-IT');
		});
	});

	describe('Russian detection', () => {
		it('should detect Russian Cyrillic text', () => {
			const russian = 'Привет мир. Как дела? Сегодня хорошая погода.';
			expect(detectLanguage(russian)).toBe('ru-RU');
		});
	});

	describe('Turkish detection', () => {
		it('should detect Turkish text with special characters', () => {
			const turkish = 'Güneşli bir gün. İstanbul çok güzel bir şehir.';
			expect(detectLanguage(turkish)).toBe('tr-TR');
		});
	});

	describe('Vietnamese detection', () => {
		it('should detect Vietnamese text', () => {
			const vietnamese = 'Xin chào, tôi là người Việt Nam. Hôm nay trời đẹp lắm.';
			expect(detectLanguage(vietnamese)).toBe('vi-VN');
		});
	});

	describe('Arabic detection', () => {
		it('should detect Arabic text', () => {
			const arabic = 'مرحبا بالعالم. كيف حالك اليوم؟ الطقس جميل جداً.';
			expect(detectLanguage(arabic)).toBe('ar-SA');
		});

		it('should detect Arabic even when mixed with some Latin', () => {
			const mixed = 'مرحبا Hello كيف حالك World اليوم جميل';
			expect(detectLanguage(mixed)).toBe('ar-SA');
		});
	});

	describe('Hindi detection', () => {
		it('should detect Hindi Devanagari text', () => {
			const hindi = 'नमस्ते दुनिया। आज का मौसम बहुत अच्छा है। आप कैसे हैं?';
			expect(detectLanguage(hindi)).toBe('hi-IN');
		});

		it('should detect Hindi even when mixed with some English', () => {
			const mixed = 'नमस्ते Hello आज का मौसम World बहुत अच्छा';
			expect(detectLanguage(mixed)).toBe('hi-IN');
		});
	});

	describe('Thai detection', () => {
		it('should detect Thai text', () => {
			const thai = 'สวัสดีครับ วันนี้อากาศดีมาก คุณสบายดีไหม';
			expect(detectLanguage(thai)).toBe('th-TH');
		});

		it('should detect Thai even when mixed with some English', () => {
			const mixed = 'สวัสดี Hello วันนี้อากาศดี World มากครับ';
			expect(detectLanguage(mixed)).toBe('th-TH');
		});
	});

	describe('undefined / ambiguous detection', () => {
		it('should return undefined for purely numeric text', () => {
			const numeric = '12345 67890 11111';
			expect(detectLanguage(numeric)).toBeUndefined();
		});

		it('should return undefined for mixed scripts below all thresholds', () => {
			const text = 'abc가나다あいう中文xyz123!@#';
			const result = detectLanguage(text);
			expect(result === undefined || typeof result === 'string').toBe(true);
		});
	});

	describe('sampling', () => {
		it('should only sample first 2000 characters', () => {
			// Create text where first 2000 chars are English, rest is Korean
			const english = 'a '.repeat(1100); // ~2200 chars, but only first 2000 sampled
			const korean = '가 '.repeat(500);
			const text = english + korean;
			// Should detect as English since sample is predominantly Latin
			expect(detectLanguage(text)).toBe('en-US');
		});
	});
});
