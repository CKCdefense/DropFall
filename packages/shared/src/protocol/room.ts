// 로비(방 생성/참여) 규격. 클라이언트와 서버가 함께 쓰는 단일 정의다.
//
// 방 코드는 Colyseus의 roomId를 그대로 덮어써서 쓴다(GameRoom#onCreate).
// 덕분에 "목록에서 선택"과 "코드 직접 입력"이 모두 client.joinById(code, ...) 하나로 처리된다.

export const NICKNAME_MAX_LENGTH = 12;
export const ROOM_NAME_MAX_LENGTH = 16;
export const ROOM_PASSWORD_MAX_LENGTH = 16;
export const ROOM_CODE_LENGTH = 4;
export const CHAT_MESSAGE_MAX_LENGTH = 200;

/** 0/O, 1/I/L 처럼 눈으로 구분이 어려운 글자는 뺐다 — 코드를 구두로 불러줄 수 있어야 한다. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export interface CreateRoomOptions {
  nickname: string;
  roomName: string;
  /** 빈 문자열/미지정이면 공개 방 */
  password?: string;
}

export interface JoinRoomOptions {
  nickname: string;
  password?: string;
}

/** GET /rooms 응답 항목 */
export interface RoomListItem {
  /** 방 코드 = roomId */
  roomCode: string;
  roomName: string;
  clients: number;
  maxClients: number;
  hasPassword: boolean;
  locked: boolean;
}

/**
 * 입장 거절 사유. Colyseus ServerError의 code로 실어 보내면
 * 클라이언트에서 `err.code`로 분기할 수 있다.
 * 4000번대는 Colyseus 내부 코드와 겹치지 않는 사용자 정의 영역이다.
 */
export const RoomErrorCode = {
  INVALID_PASSWORD: 4001,
  INVALID_NICKNAME: 4002,
  INVALID_ROOM_NAME: 4003,
} as const;

export type RoomErrorCode = (typeof RoomErrorCode)[keyof typeof RoomErrorCode];

/**
 * 사용자 입력 문자열 정규화 — 제어문자 제거, 연속 공백 축소, trim.
 * 제어문자는 정규식 대신 코드포인트로 거른다(소스에 제어문자를 직접 넣지 않기 위해).
 */
function normalizeText(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  let out = '';
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) continue;
    out += ch;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** 유효하면 정규화된 닉네임, 아니면 null. 서버가 최종 판정한다. */
export function sanitizeNickname(raw: unknown): string | null {
  const value = normalizeText(raw);
  if (value.length === 0 || value.length > NICKNAME_MAX_LENGTH) return null;
  return value;
}

/** 유효하면 정규화된 방 이름, 아니면 null */
export function sanitizeRoomName(raw: unknown): string | null {
  const value = normalizeText(raw);
  if (value.length === 0 || value.length > ROOM_NAME_MAX_LENGTH) return null;
  return value;
}

/** 비밀번호는 내용을 건드리지 않는다 — 앞뒤 공백도 사용자가 의도한 값일 수 있다. */
export function sanitizePassword(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.slice(0, ROOM_PASSWORD_MAX_LENGTH);
}

/** 유효하면 정규화된 채팅 문자열, 공백만 있거나 너무 길면 null. */
export function sanitizeChatText(raw: unknown): string | null {
  const value = normalizeText(raw);
  if (value.length === 0 || value.length > CHAT_MESSAGE_MAX_LENGTH) return null;
  return value;
}

/** 사용자가 소문자로 입력해도 통하게 한다 */
export function normalizeRoomCode(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().toUpperCase();
}

export function isValidRoomCode(raw: unknown): boolean {
  const code = normalizeRoomCode(raw);
  if (code.length !== ROOM_CODE_LENGTH) return false;
  for (const ch of code) {
    if (!ROOM_CODE_ALPHABET.includes(ch)) return false;
  }
  return true;
}

/** rng를 주입받아 테스트에서 결정론적으로 검증할 수 있게 한다. */
export function generateRoomCode(rng: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
    code += ROOM_CODE_ALPHABET[Math.floor(rng() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}
