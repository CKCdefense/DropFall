import type { JobId } from '@dropfall/shared';
import { itemFrame, itemIconFit } from '../game/render/itemSprite';
import { resolveAssetUrl } from './assets';
import { el } from './dom';

/**
 * 대기실에서 보여줄 캐릭터 초상화.
 *
 * 인게임 스프라이트는 Phaser 아틀라스(PNG 한 장)에 들어 있는데, 대기실은 DOM이라
 * Phaser를 쓸 수 없다. 대신 **아틀라스 PNG를 CSS 배경으로 깔고 프레임 위치만큼 밀어서**
 * 한 칸을 잘라 쓴다. 별도 초상화 에셋을 만들 필요가 없다.
 *
 * 아틀라스 JSON은 앱 시작 시 한 번만 받아 캐시한다. 없으면 조용히 실패하고
 * 호출부가 텍스트 플레이스홀더로 대체한다.
 */

interface AtlasFrame {
  frame: { x: number; y: number; w: number; h: number };
}

interface AtlasData {
  frames: Record<string, AtlasFrame>;
  meta: { size: { w: number; h: number } };
}

let atlas: AtlasData | null = null;

export async function loadCharacterAtlas(): Promise<void> {
  try {
    const response = await fetch(resolveAssetUrl('assets/atlas/game.json'));
    if (!response.ok) return;
    atlas = (await response.json()) as AtlasData;
  } catch {
    // 아틀라스가 아직 없는 상태 — 오류가 아니다.
  }
}

/** 해당 직업의 정면 첫 프레임을 잘라낸 요소. 프레임이 없으면 null */
export function characterPortrait(job: JobId): HTMLElement | null {
  return cropFrame(`${job}_front_0`, 'portrait');
}

/**
 * 직업 아이콘(character_icon.aseprite의 직업별 태그).
 *
 * 초상화(인게임 스프라이트)와 **다른 그림**이다 — 초상화는 서 있는 전신이라 작게 줄이면
 * 뭉개지는데, 아이콘은 그 크기에서 읽히게 그려져 있다. 직업 선택 버튼처럼 작게 여러 개를
 * 늘어놓는 자리에 쓴다.
 */
export function jobIcon(job: JobId): HTMLElement | null {
  return cropFrame(`character_icon_${job}_0`, 'job-icon');
}

/**
 * 아이템 아이콘. **인게임과 같은 표**(itemSprite.itemFrame)를 본다 — 대기실에서 본
 * 그림과 인벤토리에서 볼 그림이 다르면 같은 물건인지 알 수 없다.
 */
export function itemIcon(itemId: string, boxSize = ITEM_ICON_BOX): HTMLElement | null {
  const name = itemFrame(itemId);
  const frame = name ? atlas?.frames[name] : undefined;
  if (!name || !frame) return null;

  /*
   * 아이콘 원본은 재료 64px·무기 128px로 제각각이라 **칸에 맞춰 줄여야** 한다. 배율은
   * 인게임과 같은 계산(itemIconFit)을 쓰고, 무기처럼 캔버스 안에서 그림이 치우친 것은
   * 그 보정만큼 밀어 가운데에 세운다.
   *
   * 인게임이 길쭉한 아이콘에 주는 기울기는 여기서 쓰지 않는다 — 대기실 칸이 훨씬 작아
   * 기울여 봐야 알아보기만 어려워진다.
   */
  const fit = itemIconFit(itemId, frame.frame.w, frame.frame.h, boxSize);
  const node = cropFrame(name, 'item-icon', fit.scale);
  if (node && (fit.offsetX !== 0 || fit.offsetY !== 0)) {
    node.style.transform = `translate(${fit.offsetX * fit.scale}px, ${fit.offsetY * fit.scale}px)`;
  }
  return node;
}

/**
 * 아이템 아이콘이 들어갈 칸의 기준 크기(px).
 *
 * 칸 자체는 화면 폭에 따라 늘고 줄지만 아이콘은 이 크기로 고정한다 — 픽셀 그림을 칸
 * 크기에 실시간으로 맞추면 배율이 계속 바뀌어 획 굵기가 흔들린다.
 */
const ITEM_ICON_BOX = 30;

/**
 * 아틀라스 PNG를 배경으로 깔고 한 프레임만큼 밀어 잘라낸 요소.
 *
 * @param scale 배율. 안 주면 CSS(`--crop-scale`)가 정한다 — 초상화·직업 아이콘처럼
 *   자리마다 크기가 다른 것들이 그 길을 쓴다.
 */
function cropFrame(frameName: string, className: string, scale?: number): HTMLElement | null {
  const frame = atlas?.frames[frameName];
  if (!atlas || !frame) return null;

  const node = el('div', { class: className });
  if (scale !== undefined) node.style.setProperty('--crop-scale', `${scale}`);
  const { x, y, w, h } = frame.frame;

  // 배경 이미지를 프레임 크기에 맞춰 확대한 뒤, 원하는 칸이 보이도록 밀어낸다.
  // 배율은 CSS가 정한다(--crop-scale) — 초상화와 아이콘이 같은 코드를 쓰되 크기는
  // 각자 자리에 맞게 다르다.
  node.style.setProperty('--frame-w', `${w}`);
  node.style.setProperty('--frame-h', `${h}`);
  node.style.backgroundImage = `url('${resolveAssetUrl('assets/atlas/game.png')}')`;
  node.style.backgroundSize = `calc(${atlas.meta.size.w} * var(--crop-scale) * 1px) calc(${atlas.meta.size.h} * var(--crop-scale) * 1px)`;
  node.style.backgroundPosition = `calc(${-x} * var(--crop-scale) * 1px) calc(${-y} * var(--crop-scale) * 1px)`;
  node.style.width = `calc(${w} * var(--crop-scale) * 1px)`;
  node.style.height = `calc(${h} * var(--crop-scale) * 1px)`;

  return node;
}
