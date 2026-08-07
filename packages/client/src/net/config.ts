/**
 * 서버 주소 해석.
 *
 * 우선순위: ?server= 쿼리 > VITE_SERVER_URL > localhost 기본값
 * 쿼리 오버라이드를 남겨두는 이유는 시연 중 서버를 바꿔야 할 때 재배포 없이
 * 주소만 바꿔 접속하기 위해서다. (docs/02-tech-spec.md §9.4)
 */
const DEFAULT_SERVER_URL = 'http://localhost:2567';

function resolveServerUrl(): string {
  const override = new URLSearchParams(window.location.search).get('server');
  if (override) return override;

  const fromEnv = import.meta.env.VITE_SERVER_URL as string | undefined;
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_SERVER_URL;
}

export const SERVER_URL = resolveServerUrl();

/** Colyseus SDK는 http(s)/ws(s) 어느 쪽이든 받지만, fetch용 주소는 http로 맞춰야 한다. */
export const SERVER_HTTP_URL = SERVER_URL.replace(/^ws/, 'http').replace(/\/$/, '');

const params = new URLSearchParams(window.location.search);

/** 오프라인 모드: ?local=1 이면 서버 없이 브라우저 안에서 시뮬레이션을 돌린다. */
export const IS_LOCAL_MODE = params.get('local') === '1';

/**
 * 로비를 건너뛰고 바로 입장하는 딥링크.
 * 탭을 여러 개 띄워 멀티를 테스트할 때 매번 폼을 채우지 않기 위한 개발 편의 기능이다.
 *
 *   ?create=1&nickname=호스트&roomName=테스트방[&password=xxx]
 *   ?room=A3F9&nickname=게스트[&password=xxx]
 */
export interface AutoEntry {
  mode: 'create' | 'join';
  nickname: string;
  roomName: string;
  roomCode: string;
  password: string;
}

export function readAutoEntry(): AutoEntry | null {
  const nickname = params.get('nickname') ?? '';
  const password = params.get('password') ?? '';
  const roomCode = params.get('room') ?? '';

  if (params.get('create') === '1') {
    return {
      mode: 'create',
      nickname,
      roomName: params.get('roomName') ?? `${nickname}의 방`,
      roomCode: '',
      password,
    };
  }

  if (roomCode) {
    return { mode: 'join', nickname, roomName: '', roomCode, password };
  }

  return null;
}
