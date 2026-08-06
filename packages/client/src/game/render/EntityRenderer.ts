import Phaser from 'phaser';
import { itemOfSlot, monstersData } from '@dropfall/shared';
import type {
  BuildingView,
  MonsterView,
  PlayerView,
  ProjectileView,
  ResourceNodeView,
  WorldSnapshot,
} from '../../net/GameConnection';
import {
  GAME_ATLAS,
  PLAYER_ORIGIN_Y,
  directionFromAngle,
  hasPlayerSprite,
  idleFrame,
  registerPlayerAnimations,
  spritePrefix,
  walkAnimKey,
} from './playerSprite';
import { ACTION_PLANE_Y } from './plane';
import {
  BULLET_ANIM,
  DEFAULT_WEAPON_ID,
  HAND_FRAME,
  MUZZLE_ANIM,
  SWING_ANIM,
  SWING_STRIKE_DELAY_MS,
  bulletFrame,
  hasBulletFx,
  hasHandSprite,
  hasMuzzleFx,
  hasSwingFx,
  hasWeaponSprites,
  isSwingFinished,
  layoutWeapon,
  orderWeaponAgainstBody,
  registerBulletAnimation,
  registerMuzzleAnimation,
  registerSwingAnimation,
  weaponVisual,
  type SwingState,
  type WeaponParts,
} from './weaponFx';
import { FONT_SMALL, SIZE_SMALL, applyTextShadow } from '../ui/theme';

/**
 * 월드 안에 그리는 텍스트의 기준 크기(월드 단위). 실제 화면 크기는 여기에 카메라 줌이 곱해진다.
 * Galmuri7의 설계 크기와 같은 7px이라, 정수배 줌에서 항상 선명하다.
 */
const LABEL_FONT_SIZE = SIZE_SMALL;

/**
 * 몬스터 타입별 플레이스홀더 색.
 *
 * **크기는 여기 없다** — monsters.json의 hitRadius에서 가져온다. 플레이스홀더 단계에서는
 * "보이는 덩치 = 맞는 범위"여야 판정이 어긋났는지 눈으로 바로 알 수 있다.
 * 아트가 들어오면 이 표를 스프라이트 키로 바꾸면 된다.
 */
const MONSTER_COLOR: Record<string, number> = {
  trash: 0xa4576a,
  rusher: 0xd07a4a,
  tanker: 0x8c5ba8,
  ranged: 0x5f9ea0,
  boss: 0xd94f4f,
};
const MONSTER_COLOR_FALLBACK = 0xa4576a;

/** 자원 노드 타입별 플레이스홀더 표현(docs/backend/24). */
const RESOURCE_STYLE: Record<string, { color: number; size: number }> = {
  wood: { color: 0x5b8c4a, size: 10 },
  stone: { color: 0x8a8f99, size: 9 },
};
const RESOURCE_FALLBACK = { color: 0x8a8f99, size: 9 };

/** 건축물 타입별 플레이스홀더 표현. 울타리는 낮고 얇게, 벽은 크고 두껍게 그려서 구분한다. */
const BUILDING_STYLE: Record<string, { color: number; size: number }> = {
  fence: { color: 0xb08a5c, size: 12 },
  wall: { color: 0x6b6f78, size: 16 },
};
const BUILDING_FALLBACK = { color: 0x6b6f78, size: 14 };

/** 이 거리보다 적게 움직였으면 정지로 본다(보간 지터로 걷기 애니메이션이 떨리는 것 방지) */
const MOVE_EPSILON = 0.15;

/** 닉네임 라벨을 머리 위로 띄우는 거리(월드 단위). 캐릭터 32px 중 그림은 y 2~29에 있다. */
const LABEL_OFFSET_SPRITE = 30;
const LABEL_OFFSET_PLACEHOLDER = 12;

/** 두 손의 컨테이너 내 이름. 손잡이를 앞뒤로 나눠 잡는다. */
const HAND_NAMES = ['hand0', 'hand1'] as const;

/** 투사체는 항상 위에 그린다. */
const PROJECTILE_DEPTH = 9000;


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
  private readonly projectiles = new Map<string, Phaser.GameObjects.Sprite | Phaser.GameObjects.Arc>();
  private readonly resourceNodes = new Map<string, Phaser.GameObjects.Container>();
  private readonly buildings = new Map<string, Phaser.GameObjects.Container>();
  /** 이동 여부 판정용 직전 좌표 */
  private readonly lastPositions = new Map<string, { x: number; y: number }>();
  private readonly hasSprite: boolean;
  private readonly hasWeapon: boolean;
  private readonly hasMuzzle: boolean;
  private readonly hasHands: boolean;
  private readonly hasSwing: boolean;
  private readonly hasBullet: boolean;
  /**
   * 플레이어별로 마지막에 그린 무기. 스냅샷의 장착 무기와 달라졌을 때만 스프라이트
   * 프레임을 갈아끼우기 위한 캐시다 — 상태의 출처는 어디까지나 스냅샷이다.
   */
  private readonly equipped = new Map<string, string>();
  /** 진행 중인 휘두르기. 끝나면 지운다. */
  private readonly swings = new Map<string, SwingState>();
  private zoom = 1;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly ownSessionId: string,
  ) {
    this.hasSprite = hasPlayerSprite(scene);
    if (this.hasSprite) registerPlayerAnimations(scene);

    this.hasWeapon = hasWeaponSprites(scene);
    this.hasHands = hasHandSprite(scene);
    this.hasMuzzle = hasMuzzleFx(scene);
    this.hasSwing = hasSwingFx(scene);
    this.hasBullet = hasBulletFx(scene);
    if (this.hasMuzzle) registerMuzzleAnimation(scene);
    if (this.hasSwing) registerSwingAnimation(scene);
    if (this.hasBullet) registerBulletAnimation(scene);
  }

  /** 매 프레임 호출. 휘두르기처럼 스냅샷과 무관하게 시간이 흐르는 연출을 진행시킨다. */
  advance(deltaMs: number): void {
    for (const [id, swing] of this.swings) {
      swing.elapsedMs += deltaMs;

      // 이펙트는 예비동작이 끝나고 날이 실제로 지나갈 때 터진다. 시작과 동시에 터뜨리면
      // 아직 뒤로 젖히는 중인데 베인 자국이 먼저 보인다.
      if (!swing.fxPlayed && swing.elapsedMs >= SWING_STRIKE_DELAY_MS) {
        swing.fxPlayed = true;
        this.playFx(id, 'swingFx', SWING_ANIM);
      }

      if (isSwingFinished(swing)) this.swings.delete(id);
    }
  }

  /**
   * 스냅샷의 장착 무기를 반영한다. 바뀐 경우에만 프레임을 갈아끼우고 진행 중인
   * 휘두르기를 끊는다 — 매 프레임 setFrame을 부르면 애니메이션이 초기화된다.
   */
  private syncWeapon(sessionId: string, weaponId: string): void {
    if (this.equipped.get(sessionId) === weaponId) return;
    this.equipped.set(sessionId, weaponId);
    this.swings.delete(sessionId);

    const weapon = this.players.get(sessionId)?.getByName('aim');
    if (weapon instanceof Phaser.GameObjects.Sprite && this.hasWeapon) {
      weapon.setFrame(weaponVisual(weaponId).frame);
    }
  }

  weaponOf(sessionId: string): string {
    return this.equipped.get(sessionId) ?? DEFAULT_WEAPON_ID;
  }

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
    this.syncResourceNodes(snapshot.resourceNodes);
    this.syncBuildings(snapshot.buildings);
  }

  getSprite(sessionId: string): Phaser.GameObjects.Container | undefined {
    return this.players.get(sessionId);
  }

  destroy(): void {
    for (const map of [this.players, this.monsters, this.resourceNodes, this.buildings]) {
      for (const sprite of map.values()) sprite.destroy();
      map.clear();
    }
    for (const projectile of this.projectiles.values()) projectile.destroy();
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

      // 무기는 서버가 정한다 — 손에 무기가 없으면(소모품 등) 직전 무기를 그대로 든 채 둔다.
      const equippedWeaponId = itemOfSlot(player.slots[player.selectedSlot])?.weaponId;
      if (equippedWeaponId) this.syncWeapon(player.id, equippedWeaponId);

      const aim = sprite.getByName('aim');
      if (aim instanceof Phaser.GameObjects.Sprite) {
        // 무기 일습(무기·양손·이펙트)을 궤도 위에 배치한다
        const parts = this.readWeaponParts(sprite, aim);
        const visual = weaponVisual(this.weaponOf(player.id));
        layoutWeapon(parts, visual, player.aimAngle, this.swings.get(player.id) ?? null);
        orderWeaponAgainstBody(sprite, parts, player.aimAngle);
      } else if (aim instanceof Phaser.GameObjects.Rectangle) {
        aim.setPosition(Math.cos(player.aimAngle) * 12, Math.sin(player.aimAngle) * 12);
      }

      if (this.hasSprite) this.updatePlayerSprite(sprite, player);
    }

    for (const map of [this.lastPositions, this.swings, this.equipped]) {
      for (const id of map.keys()) {
        if (!alive.has(id)) map.delete(id);
      }
    }
    this.removeMissing(this.players, alive);
  }

  private createPlayer(player: PlayerView): Phaser.GameObjects.Container {
    const isMe = player.id === this.ownSessionId;

    // 스프라이트가 있으면 그걸 쓰고, 없으면 도형으로 대체한다.
    const body: Phaser.GameObjects.GameObject = this.hasSprite
      ? this.scene.add
          .sprite(0, 0, GAME_ATLAS, idleFrame(spritePrefix(player.job), 'front'))
          // 원점을 발밑에 두면 컨테이너 위치(= 서버 좌표)가 바닥에 닿는다.
          .setOrigin(0.5, PLAYER_ORIGIN_Y)
          .setName('body')
      : this.createPlaceholderBody(isMe);

    // 무기: 스프라이트가 있으면 장착 무기, 없으면 조준 방향을 알려주는 막대
    const aim: Phaser.GameObjects.GameObject = this.hasWeapon
      ? this.scene.add
          .sprite(0, 0, GAME_ATLAS, weaponVisual(this.weaponOf(player.id)).frame)
          .setName('aim')
      : this.scene.add.rectangle(12, 0, 6, 2, 0xf2e9d0).setName('aim');

    // 손잡이를 앞뒤로 나눠 잡는 두 손. 무기가 있을 때만 의미가 있다.
    const hands =
      this.hasWeapon && this.hasHands
        ? HAND_NAMES.map((name) =>
            this.scene.add.sprite(0, 0, GAME_ATLAS, HAND_FRAME).setName(name),
          )
        : [];

    // 이펙트. 평소엔 숨겨두고 공격할 때만 재생한다.
    const flash = this.hasMuzzle
      ? this.scene.add.sprite(0, 0, GAME_ATLAS, `${MUZZLE_ANIM}_0`).setName('flash').setVisible(false)
      : null;
    const swingFx = this.hasSwing
      ? this.scene.add.sprite(0, 0, GAME_ATLAS, `${SWING_ANIM}_0`).setName('swingFx').setVisible(false)
      : null;

    // 원점이 발밑이라 스프라이트는 위로 뻗는다 — 라벨을 머리 위로 올려야 얼굴을 가리지 않는다.
    const labelY = this.hasSprite ? -LABEL_OFFSET_SPRITE : -LABEL_OFFSET_PLACEHOLDER;

    const label = this.scene.add
      .text(0, labelY, player.nickname, {
        fontFamily: FONT_SMALL,
        fontSize: `${LABEL_FONT_SIZE}px`,
        color: isMe ? '#6fd08c' : '#cfd6e4',
      })
      .setOrigin(0.5, 1);
    label.setName('label');
    label.setResolution(this.zoom);
    // 닉네임도 지형 위에 그대로 얹힌다 — 풀·모래 무늬에 묻히지 않게 그림자를 준다.
    applyTextShadow(label);

    // 순서는 매 프레임 orderWeaponAgainstBody가 다시 잡는다 — 여기선 전부 넣기만 한다.
    const parts: Phaser.GameObjects.GameObject[] = [aim, ...hands, body, label];
    if (flash) parts.push(flash);
    if (swingFx) parts.push(swingFx);

    return this.scene.add.container(player.x, player.y, parts);
  }

  /** 컨테이너에서 무기 일습을 꺼낸다. 손이 없는 구성(에셋 미존재)도 허용한다. */
  private readWeaponParts(
    container: Phaser.GameObjects.Container,
    weapon: Phaser.GameObjects.Sprite,
  ): WeaponParts {
    const hands = HAND_NAMES.map((name) => container.getByName(name)).filter(
      (part): part is Phaser.GameObjects.Sprite => part instanceof Phaser.GameObjects.Sprite,
    );

    return {
      weapon,
      hands,
      flash: container.getByName('flash') as Phaser.GameObjects.Sprite | null,
      swingFx: container.getByName('swingFx') as Phaser.GameObjects.Sprite | null,
    };
  }

  /**
   * 공격 연출을 한 번 재생한다. 무기 종류에 따라 총구 화염이거나 휘두르기다.
   * 홀드 연사로 매 프레임 불려도 되도록, 진행 중인 휘두르기는 다시 시작하지 않는다.
   */
  playAttack(sessionId: string): void {
    const weaponId = this.weaponOf(sessionId);
    if (weaponVisual(weaponId).melee) this.startSwing(sessionId);
    else this.playFx(sessionId, 'flash', MUZZLE_ANIM);
  }

  private startSwing(sessionId: string): void {
    if (this.swings.has(sessionId)) return;
    this.swings.set(sessionId, { elapsedMs: 0, fxPlayed: false });
  }

  private playFx(sessionId: string, partName: string, animKey: string): void {
    const part = this.players.get(sessionId)?.getByName(partName);
    if (!(part instanceof Phaser.GameObjects.Sprite)) return;

    part.setVisible(true);
    part.play(animKey, true);
    // 애니메이션이 끝나면 스스로 숨는다 — 남아 있으면 마지막 프레임이 계속 붙어 있다.
    part.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => part.setVisible(false));
  }

  private createPlaceholderBody(isMe: boolean): Phaser.GameObjects.Rectangle {
    const rect = this.scene.add.rectangle(0, 0, 12, 16, isMe ? 0x6fd08c : 0x5b8dd9);
    rect.setStrokeStyle(1, 0x1a1c23);
    rect.setName('body');
    return rect;
  }

  /**
   * 방향은 조준각으로 정하고, 걷기 애니메이션은 실제로 움직일 때만 재생한다.
   * 스냅샷에 속도가 없어서 직전 프레임 좌표와의 차이로 이동 여부를 판단한다.
   */
  private updatePlayerSprite(container: Phaser.GameObjects.Container, player: PlayerView): void {
    const body = container.getByName('body');
    if (!(body instanceof Phaser.GameObjects.Sprite)) return;

    const job = spritePrefix(player.job);
    const { direction, flipX } = directionFromAngle(player.aimAngle);
    body.setFlipX(flipX);

    const previous = this.lastPositions.get(player.id);
    const moved = previous
      ? Math.hypot(player.x - previous.x, player.y - previous.y) > MOVE_EPSILON
      : false;
    this.lastPositions.set(player.id, { x: player.x, y: player.y });

    if (moved && player.hp > 0) {
      const key = walkAnimKey(job, direction);
      // 같은 애니메이션이 이미 돌고 있으면 재시작하지 않는다(계속 첫 프레임에 머무는 것 방지).
      if (body.anims.currentAnim?.key !== key || !body.anims.isPlaying) body.play(key, true);
    } else {
      body.anims.stop();
      body.setFrame(idleFrame(job, direction));
    }
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
    const color = MONSTER_COLOR[monster.type] ?? MONSTER_COLOR_FALLBACK;
    // 보이는 크기 = 판정 크기. 플레이스홀더가 히트박스를 그대로 보여준다.
    const size = (monstersData[monster.type]?.hitRadius ?? 6) * 2;

    // 총알과 같은 높이 평면에 올린다. 발밑(월드 좌표)에 그리면 총알이 머리 위로 지나간다.
    const body = this.scene.add.rectangle(0, ACTION_PLANE_Y, size, size, color);
    body.setStrokeStyle(1, 0x1a1c23);

    const barTop = ACTION_PLANE_Y - size / 2 - 4;
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

  private syncProjectiles(views: ProjectileView[]): void {
    const alive = new Set<string>();

    for (const projectile of views) {
      alive.add(projectile.id);

      let sprite = this.projectiles.get(projectile.id);
      if (!sprite) {
        sprite = this.createProjectile(projectile);
        this.projectiles.set(projectile.id, sprite);
      }

      // 총구·휘두르기 이펙트와 같은 "가슴 높이" 평면에 올린다. 월드 좌표 그대로 그리면
      // 총알만 발밑을 스치듯 날아가서 총구에서 나온 것처럼 보이지 않는다.
      sprite.setPosition(Math.round(projectile.x), Math.round(projectile.y) + ACTION_PLANE_Y);
    }

    this.removeMissing(this.projectiles, alive);
  }

  private createProjectile(
    projectile: ProjectileView,
  ): Phaser.GameObjects.Sprite | Phaser.GameObjects.Arc {
    if (!this.hasBullet) {
      const dot = this.scene.add.circle(projectile.x, projectile.y, 2, 0xf2e9d0);
      dot.setDepth(PROJECTILE_DEPTH);
      return dot;
    }

    const sprite = this.scene.add.sprite(projectile.x, projectile.y, GAME_ATLAS, bulletFrame());
    // 진행 방향은 발사 시점에 정해져 바뀌지 않는다 — 생성할 때 한 번만 돌려두면 된다.
    sprite.setRotation(projectile.angle);
    sprite.setDepth(PROJECTILE_DEPTH);
    sprite.play(BULLET_ANIM);
    return sprite;
  }

  // ---------------------------------------------------------------- 자원 노드

  private syncResourceNodes(views: ResourceNodeView[]): void {
    const alive = new Set<string>();

    for (const node of views) {
      alive.add(node.id);

      let sprite = this.resourceNodes.get(node.id);
      if (!sprite) {
        sprite = this.createResourceNode(node);
        this.resourceNodes.set(node.id, sprite);
      }

      sprite.setDepth(node.y);
      // 고갈되면(리스폰 대기 중) 흐리게 — 지금은 캘 수 없다는 걸 한눈에 보이게 한다.
      sprite.setAlpha(node.remainingHarvests > 0 ? 1 : 0.3);
    }

    this.removeMissing(this.resourceNodes, alive);
  }

  private createResourceNode(node: ResourceNodeView): Phaser.GameObjects.Container {
    const style = RESOURCE_STYLE[node.type] ?? RESOURCE_FALLBACK;
    const body = this.scene.add.circle(0, 0, style.size / 2, style.color);
    body.setStrokeStyle(1, 0x1a1c23);
    return this.scene.add.container(node.x, node.y, [body]);
  }

  // ---------------------------------------------------------------- 건축물

  private syncBuildings(views: BuildingView[]): void {
    const alive = new Set<string>();

    for (const building of views) {
      alive.add(building.id);

      let sprite = this.buildings.get(building.id);
      if (!sprite) {
        sprite = this.createBuilding(building);
        this.buildings.set(building.id, sprite);
      }

      sprite.setDepth(building.y);

      // 몬스터 HP 바와 동일한 규칙 — 멀쩡하면 숨긴다.
      const bar = sprite.getByName('hp') as Phaser.GameObjects.Rectangle | null;
      const barBack = sprite.getByName('hpBack') as Phaser.GameObjects.Rectangle | null;
      if (bar && barBack) {
        const ratio = building.maxHp > 0 ? building.hp / building.maxHp : 0;
        const damaged = ratio < 1;
        bar.setVisible(damaged);
        barBack.setVisible(damaged);
        bar.width = Math.max(0, HP_BAR_WIDTH * ratio);
      }
    }

    this.removeMissing(this.buildings, alive);
  }

  private createBuilding(building: BuildingView): Phaser.GameObjects.Container {
    const style = BUILDING_STYLE[building.type] ?? BUILDING_FALLBACK;

    const body = this.scene.add.rectangle(0, 0, style.size, style.size, style.color);
    body.setStrokeStyle(1, 0x1a1c23);

    const barTop = -style.size / 2 - 4;
    const barBack = this.scene.add
      .rectangle(-HP_BAR_WIDTH / 2, barTop, HP_BAR_WIDTH, HP_BAR_HEIGHT, 0x2b303c)
      .setOrigin(0, 0.5);
    const bar = this.scene.add
      .rectangle(-HP_BAR_WIDTH / 2, barTop, HP_BAR_WIDTH, HP_BAR_HEIGHT, 0x6fd08c)
      .setOrigin(0, 0.5);
    bar.setName('hp');
    barBack.setName('hpBack');
    barBack.setVisible(false);
    bar.setVisible(false);

    return this.scene.add.container(building.x, building.y, [barBack, bar, body]);
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
