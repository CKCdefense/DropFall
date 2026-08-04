import type { JobId } from '@dropfall/shared';
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
  const frame = atlas?.frames[`${job}_front_0`];
  if (!atlas || !frame) return null;

  const node = el('div', { class: 'portrait' });
  const { x, y, w, h } = frame.frame;

  // 배경 이미지를 프레임 크기에 맞춰 확대한 뒤, 원하는 칸이 보이도록 밀어낸다.
  node.style.setProperty('--frame-w', `${w}`);
  node.style.setProperty('--frame-h', `${h}`);
  node.style.backgroundImage = `url('${resolveAssetUrl('assets/atlas/game.png')}')`;
  node.style.backgroundSize = `calc(${atlas.meta.size.w} * var(--portrait-scale) * 1px) calc(${atlas.meta.size.h} * var(--portrait-scale) * 1px)`;
  node.style.backgroundPosition = `calc(${-x} * var(--portrait-scale) * 1px) calc(${-y} * var(--portrait-scale) * 1px)`;
  node.style.width = `calc(${w} * var(--portrait-scale) * 1px)`;
  node.style.height = `calc(${h} * var(--portrait-scale) * 1px)`;

  return node;
}
