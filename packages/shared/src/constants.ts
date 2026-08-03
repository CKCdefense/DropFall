export const TICK_RATE = 20;
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
