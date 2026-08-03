export const TICK_RATE = 20;
export const TILE_SIZE = 16;
export const GAME_WIDTH = 480;
export const GAME_HEIGHT = 270;
export const MAX_CLIENTS_PER_ROOM = 4;

/**
 * 클라이언트가 입력을 보내는 주기(Hz). 서버 틱과 동일하게 맞춘다.
 * 서버는 "마지막 입력을 새 입력이 올 때까지 매 틱 반복 적용"하는 모델이라,
 * 클라가 이보다 빠르게 보내면 중간 입력이 덮어써져 그냥 버려진다.
 */
export const INPUT_SEND_RATE = TICK_RATE;
