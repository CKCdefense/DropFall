/**
 * 서버 권위 시뮬레이션 틱(과 클라이언트 입력 전송) 주기.
 *
 * 원래 20Hz였으나, 홈서버 사양(6코어/11GiB, docs/backend/13) 기준 CPU 여유가 압도적이라
 * 60Hz로 올렸다 — 20Hz는 입력 하나가 반영되기까지 최소 50ms 단위로 끊는다는 뜻이라,
 * 서버가 아무리 빨라도 이 상수를 안 올리면 반응성 자체가 좋아지지 않는다.
 *
 * 팀 전체가 이 값을 전제로 작업할 수 있는 잠금 상수다(docs/02-tech-spec.md §4.1,
 * docs/backend/05-backend-demo-plan.md §5) — 다시 바꾸게 되면 반드시 팀에 공지할 것.
 */
export const TICK_RATE = 60;

/**
 * 서버가 **클라이언트로 상태를 내보내는** 주기(Hz).
 *
 * Colyseus에서 시뮬레이션 틱(`setSimulationInterval`)과 상태 전송(`Room.patchRate`)은
 * 완전히 별개다. `patchRate`를 건드리지 않으면 기본값 20Hz(50ms)로 남아서, 서버를 60Hz로
 * 돌려도 **클라이언트는 20Hz로만 본다** — 실측 15.9Hz였다(docs/frontend/05).
 * 그래서 GameRoom이 `this.patchRate = 1000 / PATCH_RATE`를 명시적으로 설정한다.
 *
 * 클라이언트의 보간 지연(`SnapshotInterpolator`)은 **틱 간격이 아니라 이 값**과 네트워크
 * 지터를 기준으로 잡는다. 보간은 "도착한 스냅샷 두 개 사이"를 채우는 것이지 서버 내부
 * 틱과는 무관하다. 지금은 시간 기준 고정값(120ms)에 이 값 기반 하한만 걸려 있어서
 * (`NETWORK_INTERP_DELAY_MS`), 이 상수를 낮춰도 보간이 저절로 안전하게 따라온다.
 *
 * 한동안 TICK_RATE와 같은 60으로 뒀는데(반응성 우선), 홈서버에 2인 이상이 실제
 * 네트워크로 접속하자 심하게 끊기는 문제가 생겼다 — 패치는 **클라이언트 소켓마다
 * 독립적으로** 나가므로, 대역폭 사용량이 인원수에 그대로 곱해진다(1명 60Hz → 2명이면
 * 사실상 초당 전송량 2배). 홈서버 업로드 대역폭이 병목이라 인원이 늘수록 밀리는
 * 정확히 그 증상이었다(docs/backend/47).
 *
 * 처음엔 20까지 낮췄는데(60Hz 무압축 대비 대역폭 1/3), 그러자 이번엔 **자기 캐릭터
 * 조작 자체가 느리게 느껴진다**는 문제가 나왔다 — 그때는 자기 캐릭터도 클라이언트 예측
 * (prediction) 없이 서버 스냅샷을 그대로 보간해서 그렸으므로, PATCH_RATE가 곧 "내 입력이
 * 화면에 반영되기까지 걸리는 지연"이기도 했다 — 원래(60Hz) 33ms였던 게 20Hz에서 100ms가
 * 되어 체감상 확실히 느려졌다. 그래서 서버의 WebSocket 압축(permessage-deflate,
 * `packages/server/src/index.ts`)을 켜서 확보한 여유를 반응성 쪽에 다시 썼다 — 40을
 * 거쳐 TICK_RATE와 같은 60까지 실험적으로 올렸는데, **다인 실접속 대역폭 재검증 없이
 * 그대로 방치됐다**(docs/backend/57).
 *
 * 그 뒤 자기 캐릭터 클라이언트 예측 + 재조정이 들어왔다(`PlayerPredictor.ts`,
 * docs/backend/55) — 이제 자기 캐릭터는 입력 즉시 로컬에서 먼저 그려지므로, PATCH_RATE는
 * "내 조작 반응성"과 완전히 무관해졌다. 즉 60까지 올렸던 이유 자체가 사라졌다. 그래서
 * 대역폭 쪽으로 다시 낮추는 실험을 시작했다 — 20(이미 검증된 안전값)으로 한 번에 가는
 * 대신 60에서 50으로 먼저 낮춰서 확인했다. **2인 실접속 검증 완료(docs/backend/58) —
 * 끊김 없음, 50으로 확정.** 몬스터/투사체가 늘어 페이로드가 커지면 재검증하고, 필요하면
 * 더 낮춘다(40→20 순으로, 단일 상수라 되돌리기 쉽다).
 */
export const PATCH_RATE = 50;

export const TILE_SIZE = 16;
/** 맵 그리드 크기(타일). 기술명세 §5.1 예시(128×128)를 그대로 따른다. */
export const MAP_SIZE_TILES = 128;
/** 그리드 (0,0) 셀의 좌상단 월드 좌표(원점을 맵 중앙에 두기 위한 오프셋). */
export const MAP_ORIGIN = -(MAP_SIZE_TILES * TILE_SIZE) / 2;

/**
 * 월드 좌표 → 그리드 셀 좌표. 서버(World/FlowField)와 클라이언트(건축 배치 미리보기)가
 * 똑같은 셀을 가리켜야 하므로, 이 변환은 양쪽이 공유하는 상수(TILE_SIZE, MAP_ORIGIN)로
 * 딱 한 곳에서만 정의한다 — 클라이언트가 자기 나름대로 다시 계산하면 반올림 경계나
 * 상수 변경 시 서버와 조용히 어긋날 수 있다.
 */
export function worldToCell(x: number, y: number): { cx: number; cy: number } {
  return {
    cx: Math.floor((x - MAP_ORIGIN) / TILE_SIZE),
    cy: Math.floor((y - MAP_ORIGIN) / TILE_SIZE),
  };
}

/** 그리드 셀 좌표 → 그 셀 중심의 월드 좌표(건축물 배치, 미리보기 스냅 등에 쓴다). */
export function cellCenterWorld(cx: number, cy: number): { x: number; y: number } {
  return {
    x: MAP_ORIGIN + cx * TILE_SIZE + TILE_SIZE / 2,
    y: MAP_ORIGIN + cy * TILE_SIZE + TILE_SIZE / 2,
  };
}
/**
 * 화면에 보여줄 월드 영역의 기준 크기(월드 단위 = px).
 *
 * 캔버스 자체는 창 크기(네이티브 해상도)로 두고, **월드 카메라만 정수배로 줌**한다.
 * 이 값은 "대략 이만큼 보이게 한다"는 기준일 뿐 캔버스 해상도가 아니다.
 * 저해상도 캔버스를 통째로 확대하면 UI 텍스트까지 같이 뭉개지고,
 * 특히 한글은 8px에서 판독이 불가능하다. (docs/02-tech-spec.md §7.1)
 */
export const WORLD_VIEW_WIDTH = 480;
export const WORLD_VIEW_HEIGHT = 270;

/** 월드 카메라 줌 범위. 정수배만 쓴다 — 소수배는 픽셀 크기가 들쭉날쭉해진다. */
export const MIN_CAMERA_ZOOM = 2;
export const MAX_CAMERA_ZOOM = 4;

/**
 * 캔버스 크기에 맞는 월드 카메라 줌을 구한다.
 * 창이 커도 시야가 무한정 넓어지지 않도록 상한을 둔다 — 협동 게임에서
 * 모니터 크기가 곧 정보량 차이가 되면 안 된다.
 */
export function computeCameraZoom(canvasWidth: number, canvasHeight: number): number {
  const fit = Math.min(canvasWidth / WORLD_VIEW_WIDTH, canvasHeight / WORLD_VIEW_HEIGHT);
  return Math.min(MAX_CAMERA_ZOOM, Math.max(MIN_CAMERA_ZOOM, Math.floor(fit)));
}
export const MAX_CLIENTS_PER_ROOM = 4;

/**
 * 클라이언트가 입력을 보내는 주기(Hz). 서버 틱과 동일하게 맞춘다.
 * 서버는 "마지막 입력을 새 입력이 올 때까지 매 틱 반복 적용"하는 모델이라,
 * 클라가 이보다 빠르게 보내면 중간 입력이 덮어써져 그냥 버려진다.
 */
export const INPUT_SEND_RATE = TICK_RATE;
