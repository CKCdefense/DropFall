import { describe, expect, it } from 'vitest';
import {
  CHAT_MESSAGE_MAX_LENGTH,
  NICKNAME_MAX_LENGTH,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  generateRoomCode,
  isValidRoomCode,
  normalizeRoomCode,
  sanitizeChatText,
  sanitizeNickname,
  sanitizePassword,
  sanitizeRoomName,
} from '../src/protocol/room';

describe('sanitizeNickname', () => {
  it('앞뒤 공백을 정리하고 연속 공백을 하나로 줄인다', () => {
    expect(sanitizeNickname('  생존자   A  ')).toBe('생존자 A');
  });

  it('빈 값과 길이 초과를 거절한다', () => {
    expect(sanitizeNickname('')).toBeNull();
    expect(sanitizeNickname('   ')).toBeNull();
    expect(sanitizeNickname('a'.repeat(NICKNAME_MAX_LENGTH + 1))).toBeNull();
  });

  it('문자열이 아닌 입력을 거절한다', () => {
    expect(sanitizeNickname(undefined)).toBeNull();
    expect(sanitizeNickname(42)).toBeNull();
    expect(sanitizeNickname({ nickname: 'x' })).toBeNull();
  });

  it('제어문자를 제거한다', () => {
    expect(sanitizeNickname(`abc${String.fromCharCode(0)}def`)).toBe('abcdef');
  });
});

describe('sanitizeRoomName', () => {
  it('길이 제한을 넘으면 거절한다', () => {
    expect(sanitizeRoomName('철수의 방')).toBe('철수의 방');
    expect(sanitizeRoomName('a'.repeat(17))).toBeNull();
  });
});

describe('sanitizePassword', () => {
  it('내용을 건드리지 않고 길이만 자른다', () => {
    expect(sanitizePassword('  pw  ')).toBe('  pw  ');
    expect(sanitizePassword('a'.repeat(20))).toHaveLength(16);
    expect(sanitizePassword(undefined)).toBe('');
  });
});

describe('sanitizeChatText', () => {
  it('앞뒤 공백을 정리하고 연속 공백을 하나로 줄인다', () => {
    expect(sanitizeChatText('  안녕   다들   ')).toBe('안녕 다들');
  });

  it('빈 값과 공백뿐인 값을 거절한다', () => {
    expect(sanitizeChatText('')).toBeNull();
    expect(sanitizeChatText('   ')).toBeNull();
  });

  it('길이 제한을 넘으면 거절한다', () => {
    expect(sanitizeChatText('a'.repeat(CHAT_MESSAGE_MAX_LENGTH))).not.toBeNull();
    expect(sanitizeChatText('a'.repeat(CHAT_MESSAGE_MAX_LENGTH + 1))).toBeNull();
  });

  it('문자열이 아닌 입력을 거절한다', () => {
    expect(sanitizeChatText(undefined)).toBeNull();
    expect(sanitizeChatText(42)).toBeNull();
  });
});

describe('room code', () => {
  it('소문자로 입력해도 통한다', () => {
    expect(normalizeRoomCode(' a3f9 ')).toBe('A3F9');
    expect(isValidRoomCode('a3f9')).toBe(true);
  });

  it('길이나 문자가 어긋나면 거절한다', () => {
    expect(isValidRoomCode('A3F')).toBe(false);
    expect(isValidRoomCode('A3F99')).toBe(false);
    expect(isValidRoomCode('A0F9')).toBe(false); // 0은 알파벳에서 제외했다
    expect(isValidRoomCode(undefined)).toBe(false);
  });

  it('생성된 코드는 항상 유효하다', () => {
    for (let i = 0; i < 100; i += 1) {
      const code = generateRoomCode();
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      expect(isValidRoomCode(code)).toBe(true);
    }
  });

  it('rng를 주입하면 결정론적으로 생성된다', () => {
    expect(generateRoomCode(() => 0)).toBe(ROOM_CODE_ALPHABET[0].repeat(ROOM_CODE_LENGTH));
  });
});
