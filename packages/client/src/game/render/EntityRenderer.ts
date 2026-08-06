import Phaser from 'phaser';
import {
  HIT_RADIUS,
  TILE_SIZE,
  buildingsData,
  itemOfSlot,
  monstersData,
  resourcesData,
  type ResourceType,
} from '@dropfall/shared';
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
import { FONT_SMALL, SIZE_SMALL } from '../ui/theme';

/**
 * 월드 안에 그리는 텍스트의 기준 크기(월드 단위). 실제 화면 크기는 여기에 카메라 줌이 곱해진다.
 * Galmuri7의 설계 크기와 같은 7px이라, 정수배 줌에서 항상 선명하다.
 */
const LABEL_FONT_SIZE = SIZE_SMALL;

/**
 * 몬스터 타입별 플레이스홀더 표현.
 * 아트가 들어오면 이 표만 스프라이트 키로 바꾸면 된다 — 렌더 로직은 그대로다.
 */
const MONSTER_COLOR: Record<string, number> = {
  trash: 0xa4576a,
  rusher: 0xd07a4a,
  tanker: 0x8c5ba8,
  ranged: 0x5f9ea0,
  boss: 0xd94f4f,
};
const MONSTER_COLOR_FALLBACK = 0xa4576a;
/**
 * 몬스터의 시각적 크기는 색상표가 아니라 `monstersData[type].hitRadius`(공유 데이터,
 * 실제 판정 반경)에서 그대로 뽑아 쓴다 — 예전엔 이 표에 크기를 따로 박아뒀는데, 실제
 * 피격 판정 반경(HIT_RADIUS 고정값)과 따로 놀아서 몬스터 종류에 따라 그림보다 판정이
 * 최대 2배 넓거나 좁은 문제가 있었다("히트박스가 네모칸이랑 안 맞는다"). 반경 하나를
 * 서버/클라 양쪽이 공유해서 쓰면 이 어긋남 자체가 구조적으로 생길 수 없다.
 */
const MONSTER_HIT_RADIUS_FALLBACK = 10;

/** 자원 노드 타입별 플레이스홀더 색상(docs/backend/24). 크기는 몬스터와 같은 이유로
 * resourcesData[type].hitRadius에서 그대로 뽑는다(그림-판정 어긋남 방지). */
const RESOURCE_COLOR: Record<string, number> = {
  wood: 0x5b8c4a,
  stone: 0x8a8f99,
};
const RESOURCE_COLOR_FALLBACK = 0x8a8f99;
const RESOURCE_HIT_RADIUS_FALLBACK = 14;

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
 * 플레이어-건축물 충돌 디버그 테두리. 하나의 합산 반경을 플레이어 위에만 크게
 * 그리면 건축물의 실제 가장자리와 시각적으로 연결되지 않아 오히려 헷갈린다
 * (world.ts의 `PLAYER_BUILDING_COLLISION_RADIUS` 참고: 이 값은 플레이어 자신의
 * 반경과 건축물 자신의 반경의 "합"이다). 대신 플레이어에는 플레이어 자신의 반경을,
 * 각 건축물에는 건축물 자신의 반경을 각각 그려서 — 두 원의 가장자리가 맞닿는
 * 순간이 곧 "막히는 지점"이 되도록 했다. 색을 다르게 둬서 어느 쪽 반경인지
 * 구분된다.
 */
const PLAYER_COLLISION_DEBUG_COLOR = 0x33ccff;
const BUILDING_COLLISION_DEBUG_COLOR = 0xffcc33;
/**
 * 몬스터 자신의 피격 판정 반경. 몸통 사각형(size = hitRadius*2)이 이미 이 값에서
 * 그대로 계산되긴 하지만, 실제 판정은 **사각형이 아니라 원**이라 네 귀퉁이는 그림만
 * 있고 실제로는 안 맞는 영역이다 — 이 원을 겹쳐 그리면 그 차이가 눈에 보인다("네모
 * 끝을 스쳤는데 왜 안 맞지"의 답).
 */
const MONSTER_COLLISION_DEBUG_COLOR = 0xff5555;
const COLLISION_DEBUG_ALPHA = 0.9;
/** 건축물 자신의 충돌 반경 — world.ts의 isBlockedForPlayer가 쓰는 TILE_SIZE/2와 동일. */
const BUILDING_COLLISION_RADIUS = TILE_SIZE / 2;

/**
 * 보스 공격 예고(텔레그래프) 표시. 위험을 나타내는 붉은 계열 한 가지 색만 쓰고,
 * 대신 예고가 끝나가는(발동이 가까워지는) 정도에 따라 채움 투명도를 올려서
 * "곧 온다"는 긴박감을 준다 — 처음엔 옅게, 끝날수록 진하게.
 */
const TELEGRAPH_COLOR = 0xff3b3b;
const TELEGRAPH_MIN_ALPHA = 0.15;
const TELEGRAPH_MAX_ALPHA = 0.55;
const TELEGRAPH_STROKE_ALPHA = 0.9;
const TELEGRAPH_DEPTH = 9500;

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
  /** 보스 공격 예고(텔레그래프) 표시. 몬스터 id별로 하나씩, 예고 중일 때만 존재한다. */
  private readonly telegraphs = new Map<string, Phaser.GameObjects.Graphics>();
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
  /** 켜면 모든 플레이어 위에 실제 이동-충돌 판정 반경(원)을 겹쳐 그린다(디버그용). */
  private collisionDebugVisible = false;

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
    this.syncTelegraphs(snapshot.monsters);
    this.syncProjectiles(snapshot.projectiles);
    this.syncResourceNodes(snapshot.resourceNodes);
    this.syncBuildings(snapshot.buildings);
  }

  getSprite(sessionId: string): Phaser.GameObjects.Container | undefined {
    return this.players.get(sessionId);
  }

  /**
   * 실제 캐릭터 에셋을 씌우면 그림과 판정 범위가 일치하지 않는 게 눈으로 안 보인다 —
   * 켜면 플레이어에는 플레이어 자신의 충돌 반경을, 건축물에는 건축물 자신의 충돌
   * 반경을 각각 원으로 겹쳐 그려서, 두 원이 맞닿는 지점이 곧 "막히는 지점"임을
   * 눈으로 확인할 수 있게 한다. 몬스터도 같은 이유로 자신의 피격 판정 반경(원)을
   * 겹쳐 그린다 — 몸통 사각형과 크기는 같아도 모양이 달라(사각형 vs 원) 귀퉁이가
   * 실제로 맞는지 헷갈릴 수 있다.
   */
  setCollisionDebugVisible(visible: boolean): void {
    this.collisionDebugVisible = visible;
    for (const map of [this.players, this.buildings, this.monsters]) {
      for (const sprite of map.values()) {
        const circle = sprite.getByName('collisionDebug') as Phaser.GameObjects.Arc | null;
        circle?.setVisible(visible);
      }
    }
  }

  destroy(): void {
    for (const map of [this.players, this.monsters, this.resourceNodes, this.buildings]) {
      for (const sprite of map.values()) sprite.destroy();
      map.clear();
    }
    for (const projectile of this.projectiles.values()) projectile.destroy();
    this.projectiles.clear();
    for (const gfx of this.telegraphs.values()) gfx.destroy();
    this.telegraphs.clear();
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

    // 컨테이너 원점(0,0)이 곧 서버 좌표(player.x/y)이므로, 반경만 플레이어 자신의
    // 충돌 반경(HIT_RADIUS)과 맞추면 스프라이트 origin/오프셋과 무관하게 정확한
    // 판정 범위가 그려진다. 건축물 쪽 반경은 각 건축물에 따로 그린다(createBuilding).
    const collisionDebug = this.scene.add.circle(0, 0, HIT_RADIUS);
    collisionDebug.setStrokeStyle(1, PLAYER_COLLISION_DEBUG_COLOR, COLLISION_DEBUG_ALPHA);
    collisionDebug.setFillStyle(0, 0);
    collisionDebug.setName('collisionDebug');
    collisionDebug.setVisible(this.collisionDebugVisible);

    // 순서는 매 프레임 orderWeaponAgainstBody가 다시 잡는다 — 여기선 전부 넣기만 한다.
    const parts: Phaser.GameObjects.GameObject[] = [aim, ...hands, body, label];
    if (flash) parts.push(flash);
    if (swingFx) parts.push(swingFx);
    parts.push(collisionDebug);

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
    const hitRadius = monstersData[monster.type]?.hitRadius ?? MONSTER_HIT_RADIUS_FALLBACK;
    const size = hitRadius * 2;

    const body = this.scene.add.rectangle(0, 0, size, size, color);
    body.setStrokeStyle(1, 0x1a1c23);

    const barTop = -size / 2 - 4;
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

    const collisionDebug = this.scene.add.circle(0, 0, hitRadius);
    collisionDebug.setStrokeStyle(1, MONSTER_COLLISION_DEBUG_COLOR, COLLISION_DEBUG_ALPHA);
    collisionDebug.setFillStyle(0, 0);
    collisionDebug.setName('collisionDebug');
    collisionDebug.setVisible(this.collisionDebugVisible);

    return this.scene.add.container(monster.x, monster.y, [barBack, bar, body, collisionDebug]);
  }

  // ---------------------------------------------------------------- 보스 공격 예고

  /**
   * 몬스터 스냅샷에서 `telegraphKind`가 있는 것만 골라 위험 범위를 그린다. 매번
   * `Graphics.clear()` 후 다시 그리는 방식이라(포즈/오브젝트 재사용이 아님) 도형이
   * 단순해서(사각형/원 하나) 비용은 무시할 만하고, 대신 매 스냅샷 값이 그대로
   * 반영된다는 게 보장된다.
   */
  private syncTelegraphs(views: MonsterView[]): void {
    const alive = new Set<string>();

    for (const monster of views) {
      if (!monster.telegraphKind) continue;
      alive.add(monster.id);

      let gfx = this.telegraphs.get(monster.id);
      if (!gfx) {
        gfx = this.scene.add.graphics();
        gfx.setDepth(TELEGRAPH_DEPTH);
        this.telegraphs.set(monster.id, gfx);
      }

      // 예고 진행률(0=시작, 1=발동 직전)에 따라 채움을 점점 진하게 — 임박했음을 알린다.
      const progress =
        monster.telegraphTotal > 0
          ? 1 - monster.telegraphRemaining / monster.telegraphTotal
          : 1;
      const alpha = TELEGRAPH_MIN_ALPHA + (TELEGRAPH_MAX_ALPHA - TELEGRAPH_MIN_ALPHA) * progress;

      gfx.clear();
      gfx.fillStyle(TELEGRAPH_COLOR, alpha);
      gfx.lineStyle(1.5, TELEGRAPH_COLOR, TELEGRAPH_STROKE_ALPHA);

      if (monster.telegraphKind === 'charge') {
        this.drawChargeTelegraph(gfx, monster);
      } else {
        gfx.fillCircle(monster.telegraphX, monster.telegraphY, monster.telegraphRadius);
        gfx.strokeCircle(monster.telegraphX, monster.telegraphY, monster.telegraphRadius);
      }
    }

    for (const [id, gfx] of this.telegraphs) {
      if (alive.has(id)) continue;
      gfx.destroy();
      this.telegraphs.delete(id);
    }
  }

  /**
   * 돌진 예고는 시작점(telegraphX/Y)에서 dirX/Y 방향으로 range만큼 뻗은, 폭
   * radius*2짜리 직사각형이다. 회전한 사각형이라 네 꼭짓점을 직접 벡터로 계산해서
   * `fillPoints`/`strokePoints`로 그린다(캔버스 좌표계 회전 명령보다 좌표 계산이
   * 명확해서 검증하기 쉽다).
   */
  private drawChargeTelegraph(gfx: Phaser.GameObjects.Graphics, monster: MonsterView): void {
    const { telegraphX: ox, telegraphY: oy, telegraphDirX: dx, telegraphDirY: dy } = monster;
    const halfWidth = monster.telegraphRadius;
    const length = monster.telegraphRange;
    // dir에 수직인 단위 벡터(90도 회전) — 사각형의 "폭" 방향.
    const perpX = -dy;
    const perpY = dx;

    const points = [
      { x: ox + perpX * halfWidth, y: oy + perpY * halfWidth },
      { x: ox - perpX * halfWidth, y: oy - perpY * halfWidth },
      { x: ox - perpX * halfWidth + dx * length, y: oy - perpY * halfWidth + dy * length },
      { x: ox + perpX * halfWidth + dx * length, y: oy + perpY * halfWidth + dy * length },
    ];

    gfx.fillPoints(points, true);
    gfx.strokePoints(points, true);
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

      // 예전엔 총구 높이에 맞추려고 투사체를 y축으로 18px 띄워서 그렸는데(총구
      // 이펙트와 같은 "가슴 높이" 평면) — 몬스터는 아무 오프셋 없이 실제 좌표에
      // 그대로 그려지니, 화면에 보이는 총알 궤적이 실제 판정 위치보다 계속 위로
      // 떠서 날아가는 꼴이 됐다("맞은 것처럼 안 보이는데 맞았다"/반대의 착시 제보로
      // 발견). 총구에서 막 나가는 연출은 muzzle 이펙트(화면 위치가 고정된 섬광)가
      // 이미 담당하므로, 날아가는 동안의 투사체는 판정과 똑같이 실제 좌표 그대로
      // 그린다.
      sprite.setPosition(Math.round(projectile.x), Math.round(projectile.y));
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
      sprite.setAlpha(node.hp > 0 ? 1 : 0.3);

      // 몬스터/건축물 HP 바와 동일한 규칙 — 맞은 적 없으면 숨긴다.
      const bar = sprite.getByName('hp') as Phaser.GameObjects.Rectangle | null;
      const barBack = sprite.getByName('hpBack') as Phaser.GameObjects.Rectangle | null;
      if (bar && barBack) {
        const ratio = node.maxHp > 0 ? node.hp / node.maxHp : 0;
        const damaged = ratio < 1 && ratio > 0;
        bar.setVisible(damaged);
        barBack.setVisible(damaged);
        bar.width = Math.max(0, HP_BAR_WIDTH * ratio);
      }
    }

    this.removeMissing(this.resourceNodes, alive);
  }

  private createResourceNode(node: ResourceNodeView): Phaser.GameObjects.Container {
    const color = RESOURCE_COLOR[node.type] ?? RESOURCE_COLOR_FALLBACK;
    const hitRadius = resourcesData[node.type as ResourceType]?.hitRadius ?? RESOURCE_HIT_RADIUS_FALLBACK;

    const body = this.scene.add.circle(0, 0, hitRadius, color);
    body.setStrokeStyle(1, 0x1a1c23);

    const barTop = -hitRadius - 4;
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

    return this.scene.add.container(node.x, node.y, [barBack, bar, body]);
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

    const children: Phaser.GameObjects.GameObject[] = [barBack, bar, body];

    // 이동을 막는 건축물(벽/울타리)만 자신의 충돌 반경을 그린다 — 이동을 막지 않는
    // 건축물(향후 확장 대비)까지 원을 그리면 "여기도 막힌다"는 오해를 준다.
    if (buildingsData[building.type]?.blocksMovement) {
      const collisionDebug = this.scene.add.circle(0, 0, BUILDING_COLLISION_RADIUS);
      collisionDebug.setStrokeStyle(1, BUILDING_COLLISION_DEBUG_COLOR, COLLISION_DEBUG_ALPHA);
      collisionDebug.setFillStyle(0, 0);
      collisionDebug.setName('collisionDebug');
      collisionDebug.setVisible(this.collisionDebugVisible);
      children.push(collisionDebug);
    }

    return this.scene.add.container(building.x, building.y, children);
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
