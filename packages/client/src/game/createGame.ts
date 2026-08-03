import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '@dropfall/shared';
import type { GameConnection } from '../net/GameConnection';
import { GameScene } from './scenes/GameScene';
import { HudScene } from './scenes/HudScene';

/** 씬들이 연결 객체를 꺼내가는 registry 키. 씬 시작 순서에 의존하지 않기 위해 registry를 쓴다. */
export const CONNECTION_KEY = 'connection';

/**
 * 픽셀아트 필수 설정 (docs/02-tech-spec.md §7.2)
 *  - pixelArt: 텍스처 필터를 NEAREST로. 없으면 확대 시 뭉개진다.
 *  - roundPixels: 좌표 반올림. 없으면 미세하게 떨린다.
 *  - 내부 해상도는 480×270 고정, 화면 크기에 맞춰 통째로 확대한다.
 */
export function createGame(parent: HTMLElement, connection: GameConnection): Phaser.Game {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    pixelArt: true,
    roundPixels: true,
    antialias: false,
    backgroundColor: '#14161d',
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    // 배열의 첫 씬만 자동 시작된다. HUD는 GameScene이 launch로 띄운다.
    scene: [GameScene, HudScene],
  });

  game.registry.set(CONNECTION_KEY, connection);
  return game;
}
