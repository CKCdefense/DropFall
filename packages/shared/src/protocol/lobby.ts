// 게임 로비(대기실) 규격 — 직업 선택, 준비 상태, 게임 시작.
// 클라이언트와 서버가 함께 쓰는 단일 정의다.

/** 방의 진행 단계. 대기실 → 인게임 */
export const RoomPhase = {
  LOBBY: 'lobby',
  PLAYING: 'playing',
} as const;

export type RoomPhase = (typeof RoomPhase)[keyof typeof RoomPhase];

/**
 * 직업. 각 직업은 패시브 1 + 액티브 1로 최소 구성한다. (docs/01-game-design.md §5)
 *
 * **id는 캐릭터 스프라이트 원본 파일명과 같다** (`assets/sprites/characters/{id}.aseprite`).
 * 덕분에 직업 → 스프라이트 프레임 접두사 변환에 별도 표가 필요 없다.
 */
export const JOB_IDS = ['soldier', 'searchman', 'medic', 'engineer'] as const;
export type JobId = (typeof JOB_IDS)[number];

export interface JobInfo {
  id: JobId;
  name: string;
  /** 대기실 카드에 한 줄로 보여줄 역할 요약 */
  summary: string;
}

export const JOBS: readonly JobInfo[] = [
  { id: 'soldier', name: '병사', summary: '화력' },
  { id: 'searchman', name: '탐색꾼', summary: '정찰·채집' },
  { id: 'medic', name: '의무병', summary: '치유·부활' },
  { id: 'engineer', name: '엔지니어', summary: '건축·수리' },
];

export function isJobId(value: unknown): value is JobId {
  return typeof value === 'string' && (JOB_IDS as readonly string[]).includes(value);
}

export function jobName(id: string): string {
  return JOBS.find((job) => job.id === id)?.name ?? '';
}

// ------------------------------------------------------------------ 메시지

/** 클라 → 서버 메시지 타입 이름. 문자열을 양쪽에서 직접 쓰지 않기 위해 상수로 둔다. */
export const LobbyMessage = {
  SELECT_JOB: 'selectJob',
  SET_READY: 'setReady',
  START_GAME: 'startGame',
  SET_COMPANION: 'setCompanion',
} as const;

export interface SelectJobMessage {
  job: JobId;
}

export interface SetReadyMessage {
  ready: boolean;
}

/**
 * 티모시를 데려갈지. **방장만** 바꿀 수 있고 대기실에서만 통한다.
 *
 * 방을 만들 때 정하던 것을 대기실로 옮긴 이유는, 사람이 모이고 직업을 고르고 나서야
 * "동반자가 필요한 구성인가"가 보이기 때문이다 — 방을 만드는 순간에는 아직 아무도 없다.
 */
export interface SetCompanionMessage {
  enabled: boolean;
}

/**
 * 게임 시작 거절 사유. 서버가 클라이언트로 내려보내 그대로 표시한다.
 * 버튼을 비활성화해도 타이밍 차이로 요청이 올 수 있어 서버가 최종 판정한다.
 */
export const StartRejectReason = {
  NOT_HOST: '방장만 게임을 시작할 수 있습니다.',
  NOT_ALL_READY: '아직 준비하지 않은 플레이어가 있습니다.',
  NO_JOB: '직업을 선택하지 않은 플레이어가 있습니다.',
  ALREADY_STARTED: '이미 시작된 게임입니다.',
} as const;

export const LOBBY_ERROR_MESSAGE = 'lobbyError';
