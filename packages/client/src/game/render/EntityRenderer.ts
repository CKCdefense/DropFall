import Phaser from 'phaser';
import type { PlayerView, WorldSnapshot } from '../../net/GameConnection';

/** 월드 안에 그리는 텍스트의 기준 크기(월드 단위). 실제 화면 크기는 여기에 카메라 줌이 곱해진다. */
const LABEL_FONT_SIZE = 7;

/**
 * 스냅샷 → Phaser 스프라이트 동기화 계층. 클라이언트 렌더링의 뼈대다.
 *
 * 스냅샷이 서버에서 왔는지 로컬 시뮬에서 왔는지 이 클래스는 모른다.
 * 앞으로 몬스터·투사체·건축물이 전부 여기에 얹힌다.
 */
export class EntityRenderer {
  private readonly sprites = new Map<string, Phaser.GameObjects.Container>();
  private zoom = 1;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly ownSessionId: string,
  ) {}

  /**
   * 카메라 줌이 바뀌면 월드 텍스트의 렌더 해상도도 같이 올린다.
   * 안 그러면 7px로 래스터화된 글자를 3~4배 늘리게 되어 한글이 뭉개진다.
   */
  setZoom(zoom: number): void {
    this.zoom = zoom;
    for (const sprite of this.sprites.values()) {
      const label = sprite.getByName('label') as Phaser.GameObjects.Text | null;
      label?.setResolution(zoom);
    }
  }

  sync(snapshot: WorldSnapshot): void {
    const alive = new Set<string>();

    for (const player of snapshot.players) {
      alive.add(player.id);

      let sprite = this.sprites.get(player.id);
      if (!sprite) {
        sprite = this.createPlayer(player);
        this.sprites.set(player.id, sprite);
      }

      // 정수 스냅 — roundPixels와 함께 서브픽셀 흔들림을 막는다.
      sprite.setPosition(Math.round(player.x), Math.round(player.y));
      // 탑다운 깊이 정렬: 아래에 있을수록 앞에 그린다.
      sprite.setDepth(player.y);

      const aim = sprite.getByName('aim') as Phaser.GameObjects.Rectangle | null;
      if (aim) {
        aim.setPosition(Math.cos(player.aimAngle) * 12, Math.sin(player.aimAngle) * 12);
      }
    }

    for (const [id, sprite] of this.sprites) {
      if (alive.has(id)) continue;
      sprite.destroy();
      this.sprites.delete(id);
    }
  }

  getSprite(sessionId: string): Phaser.GameObjects.Container | undefined {
    return this.sprites.get(sessionId);
  }

  destroy(): void {
    for (const sprite of this.sprites.values()) sprite.destroy();
    this.sprites.clear();
  }

  /**
   * 아직 아트가 없다. 도형 플레이스홀더로 전 시스템을 먼저 굴리고,
   * 아틀라스가 준비되면 이 메서드만 스프라이트로 교체한다.
   * (docs/04-roadmap.md — 아트는 W6에 일괄 교체)
   */
  private createPlayer(player: PlayerView): Phaser.GameObjects.Container {
    const isMe = player.id === this.ownSessionId;
    const color = isMe ? 0x6fd08c : 0x5b8dd9;

    const body = this.scene.add.rectangle(0, 0, 12, 16, color);
    body.setStrokeStyle(1, 0x1a1c23);

    const aim = this.scene.add.rectangle(12, 0, 6, 2, 0xf2e9d0);
    aim.setName('aim');

    const label = this.scene.add
      .text(0, -12, player.nickname, {
        fontFamily: 'ui-monospace, monospace',
        fontSize: `${LABEL_FONT_SIZE}px`,
        color: isMe ? '#6fd08c' : '#cfd6e4',
      })
      .setOrigin(0.5, 1);
    label.setName('label');
    label.setResolution(this.zoom);

    return this.scene.add.container(player.x, player.y, [aim, body, label]);
  }
}
