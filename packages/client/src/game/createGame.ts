import Phaser from 'phaser';
import type { GameConnection } from '../net/GameConnection';
import { GameScene } from './scenes/GameScene';
import { HudScene } from './scenes/HudScene';

/** 씬들이 연결 객체를 꺼내가는 registry 키. 씬 시작 순서에 의존하지 않기 위해 registry를 쓴다. */
export const CONNECTION_KEY = 'connection';

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
  return game;
}
