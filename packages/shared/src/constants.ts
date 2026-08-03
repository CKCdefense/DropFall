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
 * 클라이언트의 보간 지연(`SnapshotInterpolator`)은 **틱 간격이 아니라 이 값**을 기준으로
 * 잡아야 한다. 보간은 "도착한 스냅샷 두 개 사이"를 채우는 것이지 서버 내부 틱과는 무관하다.
 *
 * 지금은 틱과 같게 두지만, 대역폭이 문제가 되면 이 값만 낮추면 된다
 * (틱은 그대로 두고 전송만 줄이는 것이 일반적인 최적화다).
 */
export const PATCH_RATE = TICK_RATE;

export const TILE_SIZE = 16;
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
