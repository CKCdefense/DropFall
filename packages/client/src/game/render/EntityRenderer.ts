import Phaser from 'phaser';
import type { MonsterView, PlayerView, WorldSnapshot } from '../../net/GameConnection';

/** 월드 안에 그리는 텍스트의 기준 크기(월드 단위). 실제 화면 크기는 여기에 카메라 줌이 곱해진다. */
const LABEL_FONT_SIZE = 7;

/**
 * 몬스터 타입별 플레이스홀더 표현.
 * 아트가 들어오면 이 표만 스프라이트 키로 바꾸면 된다 — 렌더 로직은 그대로다.
 */
const MONSTER_STYLE: Record<string, { color: number; size: number }> = {
  trash: { color: 0xa4576a, size: 10 },
  rusher: { color: 0xd07a4a, size: 9 },
  tanker: { color: 0x8c5ba8, size: 16 },
  ranged: { color: 0x5f9ea0, size: 10 },
  boss: { color: 0xd94f4f, size: 24 },
};
const MONSTER_FALLBACK = { color: 0xa4576a, size: 10 };

const HP_BAR_WIDTH = 16;
const HP_BAR_HEIGHT = 2;

/**
 * 스냅샷 → Phaser 스프라이트 동기화 계층. 클라이언트 렌더링의 뼈대다.
 *
 * 스냅샷이 서버에서 왔는지 로컬 시뮬에서 왔는지 이 클래스는 모른다.
 * 지금은 플레이어·몬스터·투사체를 도형으로 그린다 — 전부 플레이스홀더이고,
 * 아틀라스가 준비되면 각 create* 메서드만 스프라이트로 교체하면 된다.
 */
export class EntityRenderer {
  private readonly players = new Map<string, Phaser.GameObjects.Container>();
  private readonly monsters = new Map<string, Phaser.GameObjects.Container>();
  private readonly projectiles = new Map<string, Phaser.GameObjects.Arc>();
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
    for (const sprite of this.players.values()) {
      const label = sprite.getByName('label') as Phaser.GameObjects.Text | null;
      label?.setResolution(zoom);
    }
  }

  sync(snapshot: WorldSnapshot): void {
    this.syncPlayers(snapshot.players);
    this.syncMonsters(snapshot.monsters);
    this.syncProjectiles(snapshot.projectiles);
  }

  getSprite(sessionId: string): Phaser.GameObjects.Container | undefined {
    return this.players.get(sessionId);
  }

  destroy(): void {
    for (const map of [this.players, this.monsters]) {
      for (const sprite of map.values()) sprite.destroy();
      map.clear();
    }
    for (const dot of this.projectiles.values()) dot.destroy();
    this.projectiles.clear();
  }

  // ---------------------------------------------------------------- 플레이어

  private syncPlayers(views: PlayerView[]): void {
    const alive = new Set<string>();

    for (const player of views) {
      alive.add(player.id);

      let sprite = this.players.get(player.id);
      if (!sprite) {
        sprite = this.createPlayer(player);
        this.players.set(player.id, sprite);
      }

      // 정수 스냅 — roundPixels와 함께 서브픽셀 흔들림을 막는다.
      sprite.setPosition(Math.round(player.x), Math.round(player.y));
      // 탑다운 깊이 정렬: 아래에 있을수록 앞에 그린다.
      sprite.setDepth(player.y);
      // 다운된 플레이어는 흐리게 — 부활 대상임을 한눈에 보이게 한다.
      sprite.setAlpha(player.hp > 0 ? 1 : 0.35);

      const aim = sprite.getByName('aim') as Phaser.GameObjects.Rectangle | null;
      if (aim) {
        aim.setPosition(Math.cos(player.aimAngle) * 12, Math.sin(player.aimAngle) * 12);
      }
    }

    this.removeMissing(this.players, alive);
  }

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

  // ---------------------------------------------------------------- 몬스터

  private syncMonsters(views: MonsterView[]): void {
    const alive = new Set<string>();

    for (const monster of views) {
      alive.add(monster.id);

      let sprite = this.monsters.get(monster.id);
      if (!sprite) {
        sprite = this.createMonster(monster);
        this.monsters.set(monster.id, sprite);
      }

      sprite.setPosition(Math.round(monster.x), Math.round(monster.y));
      sprite.setDepth(monster.y);

      // HP 바는 피해를 입었을 때만 보인다 — 멀쩡한 몬스터까지 바가 뜨면 화면이 시끄럽다.
      const bar = sprite.getByName('hp') as Phaser.GameObjects.Rectangle | null;
      const barBack = sprite.getByName('hpBack') as Phaser.GameObjects.Rectangle | null;
      if (bar && barBack) {
        const ratio = monster.maxHp > 0 ? monster.hp / monster.maxHp : 0;
        const damaged = ratio < 1;
        bar.setVisible(damaged);
        barBack.setVisible(damaged);
        bar.width = Math.max(0, HP_BAR_WIDTH * ratio);
      }
    }

    this.removeMissing(this.monsters, alive);
  }

  private createMonster(monster: MonsterView): Phaser.GameObjects.Container {
    const style = MONSTER_STYLE[monster.type] ?? MONSTER_FALLBACK;

    const body = this.scene.add.rectangle(0, 0, style.size, style.size, style.color);
    body.setStrokeStyle(1, 0x1a1c23);

    const barTop = -style.size / 2 - 4;
    const barBack = this.scene.add
      .rectangle(-HP_BAR_WIDTH / 2, barTop, HP_BAR_WIDTH, HP_BAR_HEIGHT, 0x2b303c)
      .setOrigin(0, 0.5);
    const bar = this.scene.add
      .rectangle(-HP_BAR_WIDTH / 2, barTop, HP_BAR_WIDTH, HP_BAR_HEIGHT, 0xd9756b)
      .setOrigin(0, 0.5);
    bar.setName('hp');
    barBack.setName('hpBack');

    // 체력이 가득할 땐 배경 바도 숨긴다.
    barBack.setVisible(false);
    bar.setVisible(false);

    return this.scene.add.container(monster.x, monster.y, [barBack, bar, body]);
  }

  // ---------------------------------------------------------------- 투사체

  private syncProjectiles(views: { id: string; x: number; y: number }[]): void {
    const alive = new Set<string>();

    for (const projectile of views) {
      alive.add(projectile.id);

      let dot = this.projectiles.get(projectile.id);
      if (!dot) {
        dot = this.scene.add.circle(projectile.x, projectile.y, 2, 0xf2e9d0);
        dot.setDepth(9000); // 투사체는 항상 위에
        this.projectiles.set(projectile.id, dot);
      }

      dot.setPosition(Math.round(projectile.x), Math.round(projectile.y));
    }

    this.removeMissing(this.projectiles, alive);
  }

  // ---------------------------------------------------------------- 공통

  private removeMissing(
    map: Map<string, Phaser.GameObjects.GameObject>,
    alive: Set<string>,
  ): void {
    for (const [id, sprite] of map) {
      if (alive.has(id)) continue;
      sprite.destroy();
      map.delete(id);
    }
  }
}
