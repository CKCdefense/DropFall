// 게임 로비(대기실) 규격 — 직업 선택, 준비 상태, 게임 시작.
// 클라이언트와 서버가 함께 쓰는 단일 정의다.

/** 방의 진행 단계. 대기실 → 인게임 */
export const RoomPhase = {
  LOBBY: 'lobby',
  PLAYING: 'playing',
} as const;

export type RoomPhase = (typeof RoomPhase)[keyof typeof RoomPhase];

/**
 * 직업. MVP는 3종이다 — 각 직업은 패시브 1 + 액티브 1로 최소 구성한다.
 * (docs/01-game-design.md §5)
 */
export const JOB_IDS = ['engineer', 'medic', 'soldier'] as const;
export type JobId = (typeof JOB_IDS)[number];

export interface JobInfo {
  id: JobId;
  name: string;
  /** 대기실 카드에 한 줄로 보여줄 역할 요약 */
  summary: string;
}

export const JOBS: readonly JobInfo[] = [
  { id: 'engineer', name: '정비공', summary: '건축·수리' },
  { id: 'medic', name: '의사', summary: '치유·부활' },
  { id: 'soldier', name: '군인', summary: '화력' },
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
} as const;

export interface SelectJobMessage {
  job: JobId;
}

export interface SetReadyMessage {
  ready: boolean;
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
