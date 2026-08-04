import Phaser from 'phaser';
import { weaponsData, type WeaponData } from '@dropfall/shared';
import { GAME_ATLAS } from './playerSprite';

/**
 * 손에 든 무기 + 양손 + 이펙트.
 *
 * 무기는 캐릭터에 붙어 있지 않고 **일정 거리를 두고 공전한다** — 조준 방향으로 팔을 뻗은
 * 느낌을 내기 위해서다. 손 두 개를 손잡이 위치에 겹쳐 얹어 "무기를 쥐고 있다"를 표현한다.
 *
 * 무기마다 다른 값은 전부 WEAPON_VISUALS 표에 모여 있다. 새 무기를 추가할 때
 * 손대야 하는 곳은 그 표 하나뿐이고, 배치·회전·휘두르기 로직은 공용이다.
 */

export const HAND_FRAME = 'hand__0';
export const MUZZLE_ANIM = 'fx_shot_muzzle';
export const SWING_ANIM = 'fx_swing_arc';
export const BULLET_ANIM = 'fx_bullet_tracer';
const MUZZLE_PREFIX = 'fx_shot_muzzle_';
const SWING_PREFIX = 'fx_swing_arc_';
const BULLET_PREFIX = 'fx_bullet_tracer_';
const MUZZLE_FRAMES = 4;
const SWING_FRAMES = 8;
const BULLET_FRAMES = 2;
/** 총구 화염은 짧아야 한다. 4프레임 24fps ≈ 167ms. */
const MUZZLE_FRAME_RATE = 24;
/** 예광탄은 날아가는 내내 반복 재생한다. 두 프레임이 빠르게 교차해 반짝이는 정도. */
const BULLET_FRAME_RATE = 16;

interface Point {
  x: number;
  y: number;
}

/** 스프라이트 좌표계의 중심(32×32 기준) */
const SPRITE_CENTER = 16;

/** 근접 무기 휘두르기 파라미터. 시간 비율은 전부 SWING_DURATION_MS 기준이다. */
interface MeleeSwing {
  /** 부채꼴 절반 각도(라디안). weapons.json의 arc에서 유도한다 — 판정과 연출이 어긋나면 안 된다. */
  halfArc: number;
  /** 내려치기 전에 뒤로 당기는 각도(라디안). 예비 동작이 있어야 타격감이 산다. */
  windup: number;
  /** 이펙트 배율. 서버 판정 거리에 맞춰 계산된다. */
  fxScale: number;
}

export interface WeaponVisual {
  frame: string;
  scale: number;
  /**
   * 스프라이트가 기본으로 향하는 방향(라디안).
   * 권총은 총구가 오른쪽(+x)이라 0, 도끼·곡괭이는 날이 위(-y)라 -π/2다.
   */
  forward: number;
  /**
   * 왼쪽을 볼 때 뒤집을 축. 가로로 누운 무기는 y축(위아래 반전), 세로로 선 무기는
   * x축(좌우 반전)으로 뒤집어야 자루가 아니라 겉모습만 미러링된다.
   */
  mirror: 'x' | 'y';
  /** 궤도 위에 올릴 기준점(스프라이트 좌표). 이 점이 캐릭터에서 orbitRadius만큼 떨어진다. */
  pivot: Point;
  /** [뒷손, 앞손] 잡는 지점(스프라이트 좌표) */
  grips: [Point, Point];
  /**
   * 원본 스프라이트를 좌우로 뒤집은 채 기본 자세로 삼는다.
   *
   * 근접 무기는 위에서 아래로 휘두르는데(시계방향), 날이 진행 방향 반대쪽에 그려져
   * 있으면 칼등으로 때리는 꼴이 된다. 원본을 고치는 대신 여기서 뒤집는다 —
   * 손잡이가 pivot 기준 좌우대칭이라 손 위치는 그대로 유지된다.
   */
  baseFlipX?: boolean;
  orbitRadius: number;
  /** ranged 전용: 총구 끝(스프라이트 좌표) */
  muzzle?: Point;
  melee?: MeleeSwing;
}

/**
 * 컨테이너 원점이 **발밑**이라 y=0이 바닥이다 — 몸통 중심 높이를 따로 잡아야
 * 무기가 발치가 아니라 가슴 높이에서 돈다.
 */
export const ORBIT_CENTER_Y = -14;

/** 이펙트 스프라이트에서 호의 바깥 반지름(px). 원본 캔버스 64 기준 값이다. */
const SWING_FX_RADIUS = 30;

function meleeSwingFrom(weapon: WeaponData): MeleeSwing {
  const halfArc = ((weapon.arc ?? 360) * Math.PI) / 360;
  return {
    halfArc,
    // 부채꼴이 넓을수록 크게 당긴다. 좁은 무기가 크게 젖히면 판정 밖까지 나가 보인다.
    windup: halfArc * 0.6,
    /**
     * 이펙트 바깥 호를 무기 사거리에 맞춘다. 여기에 몬스터 히트박스(10px)까지 더하면
     * 판정 최대 거리와는 일치하지만, 화면에서는 호가 캐릭터 발밑까지 내려와 몸집을 압도한다.
     * 이펙트는 "날이 지나간 자리"를 그리는 것이지 판정 경계선을 그리는 게 아니다.
     */
    fxScale: (weapon.range ?? 0) / SWING_FX_RADIUS,
  };
}

/**
 * 무기별 렌더 설정. pivot/grips/muzzle 좌표는 원본 스프라이트를 픽셀 단위로 재서 넣은 값이다.
 *  - handgun: 총구 x29·y8~10, 손잡이(갈색) x7~12·y15~25
 *  - axe:     날 y2~18, 자루 x16~20·y19~29
 *  - pickax:  날 y3~11, 자루 x15~18·y12~29
 */
export const WEAPON_VISUALS: Record<string, WeaponVisual> = {
  pistol: {
    frame: 'handgun__0',
    // 권총 원본은 32×32라 캐릭터와 같은 크기다. 그대로 두면 총이 사람만 해진다.
    scale: 0.55,
    forward: 0,
    mirror: 'y',
    // 스프라이트 중심을 그대로 궤도에 올린다.
    pivot: { x: SPRITE_CENTER, y: SPRITE_CENTER },
    grips: [
      { x: 9, y: 18 },
      { x: 13, y: 17 },
    ],
    orbitRadius: 11,
    muzzle: { x: 30, y: 9 },
  },
  axe: {
    frame: 'axe__0',
    scale: 0.62,
    forward: -Math.PI / 2,
    mirror: 'x',
    // 자루 끝(뒷손)을 궤도에 올린다. 무기 중심을 올리면 긴 무기일수록 손이 몸에서 떨어진다.
    pivot: { x: 18, y: 27 },
    grips: [
      { x: 18, y: 27 },
      { x: 18, y: 22 },
    ],
    orbitRadius: 9,
    // 원본은 날이 자루 왼쪽에 있다. 그대로 두면 내려칠 때 날이 뒤를 향한다.
    baseFlipX: true,
  },
  pickax: {
    frame: 'pickax__0',
    scale: 0.62,
    forward: -Math.PI / 2,
    mirror: 'x',
    pivot: { x: 16, y: 27 },
    grips: [
      { x: 16, y: 27 },
      { x: 16, y: 22 },
    ],
    orbitRadius: 9,
  },
};

// weapons.json이 근접이라고 한 무기에만 휘두르기 값을 붙인다. 두 곳에 같은 숫자를
// 적어두면 반드시 어긋나므로, 각도·사거리는 항상 서버 데이터에서 유도한다.
for (const [id, visual] of Object.entries(WEAPON_VISUALS)) {
  const weapon = weaponsData[id];
  if (weapon?.type === 'melee') visual.melee = meleeSwingFrom(weapon);
}

export const DEFAULT_WEAPON_ID = 'pistol';

export function weaponVisual(weaponId: string): WeaponVisual {
  return WEAPON_VISUALS[weaponId] ?? WEAPON_VISUALS[DEFAULT_WEAPON_ID];
}

// ---------------------------------------------------------------- 에셋 유무

function hasFrame(scene: Phaser.Scene, frame: string): boolean {
  return scene.textures.exists(GAME_ATLAS) && scene.textures.get(GAME_ATLAS).has(frame);
}

/** 하나라도 없으면 무기 렌더링 자체를 끄고 도형 플레이스홀더로 돌아간다. */
export function hasWeaponSprites(scene: Phaser.Scene): boolean {
  return Object.values(WEAPON_VISUALS).every((visual) => hasFrame(scene, visual.frame));
}

export function hasHandSprite(scene: Phaser.Scene): boolean {
  return hasFrame(scene, HAND_FRAME);
}

export function hasMuzzleFx(scene: Phaser.Scene): boolean {
  return hasFrame(scene, `${MUZZLE_PREFIX}0`);
}

export function hasSwingFx(scene: Phaser.Scene): boolean {
  return hasFrame(scene, `${SWING_PREFIX}0`);
}

export function hasBulletFx(scene: Phaser.Scene): boolean {
  return hasFrame(scene, `${BULLET_PREFIX}0`);
}

export function bulletFrame(): string {
  return `${BULLET_PREFIX}0`;
}

function registerFxAnimation(
  scene: Phaser.Scene,
  key: string,
  prefix: string,
  frames: number,
  frameRate: number,
): void {
  if (scene.anims.exists(key)) return;

  scene.anims.create({
    key,
    frames: scene.anims.generateFrameNames(GAME_ATLAS, { prefix, start: 0, end: frames - 1 }),
    frameRate,
    repeat: 0,
  });
}

export function registerMuzzleAnimation(scene: Phaser.Scene): void {
  registerFxAnimation(scene, MUZZLE_ANIM, MUZZLE_PREFIX, MUZZLE_FRAMES, MUZZLE_FRAME_RATE);
}

export function registerBulletAnimation(scene: Phaser.Scene): void {
  if (scene.anims.exists(BULLET_ANIM)) return;

  scene.anims.create({
    key: BULLET_ANIM,
    frames: scene.anims.generateFrameNames(GAME_ATLAS, {
      prefix: BULLET_PREFIX,
      start: 0,
      end: BULLET_FRAMES - 1,
    }),
    frameRate: BULLET_FRAME_RATE,
    repeat: -1,
  });
}

export function registerSwingAnimation(scene: Phaser.Scene): void {
  // 8프레임이 내려치기 구간과 같은 길이로 끝나야 이펙트와 무기가 따로 놀지 않는다.
  registerFxAnimation(
    scene,
    SWING_ANIM,
    SWING_PREFIX,
    SWING_FRAMES,
    (SWING_FRAMES * 1000) / SWING_FX_DURATION_MS,
  );
}

// ---------------------------------------------------------------- 휘두르기

/** 한 번 휘두르는 데 걸리는 시간(ms). 가장 느린 무기(도끼 1.5회/초)보다 짧아야 겹치지 않는다. */
export const SWING_DURATION_MS = 360;
/** 예비동작이 끝나고 내려치기가 시작되는 시점(진행률) */
const STRIKE_START = 0.3;
/** 내려치기가 끝나고 복귀가 시작되는 시점(진행률) */
const STRIKE_END = 0.65;
/** 예비동작이 끝나고 실제로 날이 지나가기까지의 지연(ms). 이펙트는 이때 터져야 한다. */
export const SWING_STRIKE_DELAY_MS = SWING_DURATION_MS * STRIKE_START;
/** 이펙트 재생 길이 = 내려치기 구간 길이 */
const SWING_FX_DURATION_MS = SWING_DURATION_MS * (STRIKE_END - STRIKE_START);
/** 내려치는 동안 무기를 앞으로 밀어내는 거리(px). 뻗는 느낌을 준다. */
const THRUST_DISTANCE = 5;

/** 끝에서 부드럽게 멎는다. 예비동작·복귀처럼 "천천히 자리잡는" 구간에 쓴다. */
function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/** 초반에 확 튀어나갔다가 끝에서 멎는다. 내려치기의 속도감을 만든다. */
function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

export interface SwingState {
  /** 휘두르기 시작 후 경과 시간(ms) */
  elapsedMs: number;
  /** 이펙트를 이미 터뜨렸는지. 예비동작이 끝나는 순간 한 번만 재생한다. */
  fxPlayed: boolean;
}

/**
 * 휘두르기 진행에 따른 각도 오프셋(라디안)과 앞으로 미는 거리.
 *
 * 세 구간이다: 뒤로 당기고(-windup) → 반대편 끝까지 훑고(+halfArc) → 원위치로 돌아온다.
 * 각 구간의 이징이 다른 게 핵심이다 — 전부 같은 속도로 움직이면 로봇팔처럼 보인다.
 */
export function swingPose(melee: MeleeSwing, elapsedMs: number): { offset: number; thrust: number } {
  const t = Math.min(1, elapsedMs / SWING_DURATION_MS);

  if (t < STRIKE_START) {
    return { offset: -melee.windup * easeOut(t / STRIKE_START), thrust: 0 };
  }

  if (t < STRIKE_END) {
    const k = (t - STRIKE_START) / (STRIKE_END - STRIKE_START);
    const eased = easeOutCubic(k);
    return {
      offset: -melee.windup + (melee.halfArc + melee.windup) * eased,
      // 가운데를 지날 때 가장 많이 뻗는다.
      thrust: THRUST_DISTANCE * Math.sin(Math.PI * k),
    };
  }

  const k = (t - STRIKE_END) / (1 - STRIKE_END);
  return { offset: melee.halfArc * (1 - easeOut(k)), thrust: 0 };
}

export function isSwingFinished(state: SwingState): boolean {
  return state.elapsedMs >= SWING_DURATION_MS;
}

// ---------------------------------------------------------------- 배치

/**
 * 무기 스프라이트 안의 한 점(총구, 손잡이 등)을 컨테이너 좌표로 옮긴다.
 * 무기의 축소·회전·반전을 모두 반영해야 부속물이 무기에 정확히 붙어 있는다.
 * pivot이 원점이므로, pivot 자신은 그대로 궤도 위 좌표가 된다.
 */
function weaponPointToContainer(
  point: Point,
  visual: WeaponVisual,
  pivotX: number,
  pivotY: number,
  cos: number,
  sin: number,
  flipX: boolean,
  flipY: boolean,
): Point {
  const mirrorX = flipX ? -1 : 1;
  const mirrorY = flipY ? -1 : 1;

  const localX = (point.x - visual.pivot.x) * visual.scale * mirrorX;
  const localY = (point.y - visual.pivot.y) * visual.scale * mirrorY;

  return {
    x: pivotX + localX * cos - localY * sin,
    y: pivotY + localX * sin + localY * cos,
  };
}

export interface WeaponParts {
  weapon: Phaser.GameObjects.Sprite;
  hands: Phaser.GameObjects.Sprite[];
  flash: Phaser.GameObjects.Sprite | null;
  swingFx: Phaser.GameObjects.Sprite | null;
}

/** 조준각(+휘두르기 진행)에 맞춰 무기·양손·이펙트를 궤도 위에 배치한다. */
export function layoutWeapon(
  parts: WeaponParts,
  visual: WeaponVisual,
  aimAngle: number,
  swing: SwingState | null,
): void {
  const { weapon, hands, flash, swingFx } = parts;

  const pose = visual.melee && swing ? swingPose(visual.melee, swing.elapsedMs) : null;
  // 휘두르는 동안에는 무기가 조준선에서 벗어나 궤도를 따라 훑고 지나간다.
  const angle = aimAngle + (pose?.offset ?? 0);
  const radius = visual.orbitRadius + (pose?.thrust ?? 0);

  // 왼쪽(±90도 밖)을 볼 때만 뒤집는다. 회전만 시키면 무기가 거꾸로 보인다.
  // 기준은 조준각이다 — 휘두르는 중에 무기가 좌우로 뒤집히면 눈에 거슬린다.
  const facingLeft = Math.abs(aimAngle) > Math.PI / 2;
  // baseFlipX(기본 자세 뒤집기)와 방향 반전은 같은 축이라 XOR로 합친다.
  // 둘 다 켜지면 서로 상쇄되어 원본 방향으로 돌아온다.
  const flipX = (facingLeft && visual.mirror === 'x') !== Boolean(visual.baseFlipX);
  const flipY = facingLeft && visual.mirror === 'y';

  // 스프라이트의 forward가 angle을 향하도록 돌린다.
  const rotation = angle - visual.forward;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  const pivotX = Math.cos(angle) * radius;
  const pivotY = Math.sin(angle) * radius + ORBIT_CENTER_Y;

  const toContainer = (point: Point): Point =>
    weaponPointToContainer(point, visual, pivotX, pivotY, cos, sin, flipX, flipY);

  weapon.setScale(visual.scale);
  weapon.setRotation(rotation);
  weapon.setFlipX(flipX);
  weapon.setFlipY(flipY);
  // 스프라이트 자체의 원점은 중심이므로, 중심이 어디로 가는지 따로 구해야 한다.
  const center = toContainer({ x: SPRITE_CENTER, y: SPRITE_CENTER });
  weapon.setPosition(center.x, center.y);

  hands.forEach((hand, index) => {
    const point = toContainer(visual.grips[index] ?? visual.grips[0]);
    // 손은 캐릭터와 같은 32×32 캔버스에 그려져 원래 크기가 맞다 — 무기 배율을 적용하지 않는다.
    hand.setPosition(point.x, point.y);
  });

  if (flash) {
    const muzzle = visual.muzzle ? toContainer(visual.muzzle) : { x: pivotX, y: pivotY };
    flash.setScale(visual.scale);
    flash.setRotation(rotation);
    flash.setPosition(muzzle.x, muzzle.y);
  }

  if (swingFx && visual.melee) {
    // 부채꼴 이펙트는 무기가 아니라 **플레이어**를 중심으로 돈다 — 서버 판정과 같은 기준이다.
    swingFx.setScale(visual.melee.fxScale);
    swingFx.setRotation(aimAngle);
    swingFx.setPosition(0, ORBIT_CENTER_Y);
  }
}

/**
 * 조준 방향에 따라 무기 일습을 몸 앞/뒤로 보낸다.
 * 위를 볼 때(뒷모습) 무기가 몸 앞에 있으면 등 뒤에서 무기가 튀어나온 것처럼 보인다.
 */
export function orderWeaponAgainstBody(
  container: Phaser.GameObjects.Container,
  parts: WeaponParts,
  aimAngle: number,
): void {
  const facingUp = Math.sin(aimAngle) < -0.5;
  const ordered: Phaser.GameObjects.GameObject[] = [parts.weapon, ...parts.hands];

  for (const part of ordered) {
    if (facingUp) container.sendToBack(part);
    else container.bringToTop(part);
  }

  // 이펙트는 항상 맨 위 — 몸이나 손에 가리면 안 된다.
  if (parts.flash) container.bringToTop(parts.flash);
  if (parts.swingFx) container.bringToTop(parts.swingFx);
}
