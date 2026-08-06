import Phaser from 'phaser';
import type { GameConnection } from '../net/GameConnection';
import { weaponsData } from '@dropfall/shared';
import { WEAPON_VISUALS } from './render/weaponFx';
import { GameScene } from './scenes/GameScene';
import { HudScene } from './scenes/HudScene';

/** 씬들이 연결 객체를 꺼내가는 registry 키. 씬 시작 순서에 의존하지 않기 위해 registry를 쓴다. */
export const CONNECTION_KEY = 'connection';
/** HudScene이 건축모드 표시줄을 그리려고 GameScene의 InputController를 꺼내가는 키. */
/**
 * HudScene이 등록하는 "지금 포인터가 UI 위인가" 판정. 모달은 차단막 없이 게임 위에
 * 떠 있으므로, 게임 입력(발사·건축)이 모달을 뚫고 나가지 않게 이 콜백으로 막는다.
 * 발사는 이벤트가 아니라 매 프레임 폴링이라 Phaser의 이벤트 전파만으로는 안 막힌다.
 */
export const HUD_BLOCK_KEY = 'hudBlocksPointer';

/** HudScene이 등록하는 코어 상호작용 콜백. GameScene의 E 입력이 이걸 먼저 부른다. */
export const CORE_INTERACT_KEY = 'coreInteract';

export const INPUT_CONTROLLER_KEY = 'inputController';

/**
 * 렌더링 정책 (docs/02-tech-spec.md §7.1~7.2)
 *
 * 캔버스는 **네이티브 해상도**(창 크기)로 두고, 월드 카메라만 정수배로 줌한다.
 *  - 저해상도 캔버스를 통째로 확대하는 방식은 UI 텍스트까지 뭉갠다.
 *    특히 한글은 자소 조합 구조라 8px에서 판독이 불가능하다.
 *  - FIT 스케일은 소수배(예: 2.49배) 확대가 나와서 픽셀 크기가 들쭉날쭉해진다.
 *
 * 픽셀아트 룩은 정수배 카메라 줌 + pixelArt/roundPixels로 유지된다.
 */
export function createGame(parent: HTMLElement, connection: GameConnection): Phaser.Game {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    pixelArt: true,
    roundPixels: true,
    antialias: false,
    backgroundColor: '#14161d',
    scale: {
      // 캔버스가 부모 크기를 그대로 따라간다. 확대/축소 없음.
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.NO_CENTER,
    },
    // 배열의 첫 씬만 자동 시작된다. HUD는 GameScene이 launch로 띄운다.
    scene: [GameScene, HudScene],
  });

  game.registry.set(CONNECTION_KEY, connection);

  // 개발 중 콘솔/자동화에서 상태를 들여다보기 위한 핸들. 프로덕션 번들에는 포함되지 않는다.
  // weaponsData/WEAPON_VISUALS까지 얹어두면 "그려진 총구와 서버가 총알을 만드는 지점이
  // 같은가" 같은 정합성 확인을 브라우저에서 그대로 돌려볼 수 있다.
  if (import.meta.env.DEV) {
    (window as unknown as { __dropfall?: unknown }).__dropfall = {
      game,
      connection,
      weaponsData,
      weaponVisuals: WEAPON_VISUALS,
    };
  }

  return game;
}
