import Phaser from 'phaser';
import { weaponsData, type WeaponData } from '@dropfall/shared';
import { GAME_ATLAS } from './playerSprite';
import { ACTION_PLANE_Y } from './plane';

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

/** 스프라이트 좌표계의 중심(32×32 기준). 총기 시트처럼 캔버스가 다르면 visual.center로 덮는다. */
const SPRITE_CENTER = 16;
const DEFAULT_SPRITE_CENTER: Point = { x: SPRITE_CENTER, y: SPRITE_CENTER };
/**
 * 신규 무기 시트(weapons_new.aseprite, 235×62)의 중심. 근접·원거리 18종이 전부 이
 * 캔버스에 **수평·우향**으로 그려져 있어서, 축은 대부분 y가 같은 두 점이면 된다.
 */
const WEAPON_SHEET_CENTER: Point = { x: 117.5, y: 31 };

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
  /**
   * 원본 스프라이트 캔버스의 중심. 도구는 32×32라 (16,16)이지만 총기 시트는 128×64다 —
   * 스프라이트 원점이 중심이라 이 값이 틀리면 무기가 손에서 통째로 밀려난다.
   */
  center?: Point;
  scale: number;
  /**
   * 스프라이트 안에서 **총열(또는 날)이 향하는 방향**(라디안). 권총처럼 총열이 수평인
   * 그림은 0, 대각선으로 누운 소총·도끼는 -20°~-46° 쯤이다.
   */
  forward: number;
  /**
   * 궤도 위에 올릴 기준점(스프라이트 좌표). **총열 축 위의 점**이어야 한다 —
   * 이 점이 조준선 위에 놓이므로, 축 위가 아니면 총구가 조준선에서 벗어난다.
   */
  pivot: Point;
  /** [뒷손, 앞손] 잡는 지점(스프라이트 좌표) */
  grips: [Point, Point];
  /** 그릴 손 개수. 맨손은 무기 스프라이트 자체가 손이라 0이다. */
  handCount: number;
  orbitRadius: number;
  /** ranged 전용: 총구 끝(스프라이트 좌표) */
  muzzle?: Point;
  melee?: MeleeSwing;
  /**
   * 캔버스 안에서 **그림이 실제로 차지하는 사각형**(불투명 픽셀의 경계). 무기 18종이
   * 235×62 캔버스를 공유해서, 인벤토리 아이콘을 캔버스 크기로 맞추면 작은 무기(권총)가
   * 여백까지 칸을 차지해 3분의 1로 쪼그라든다. 아이콘 배율은 이 값을 쓴다.
   */
  artBounds?: { x: number; y: number; width: number; height: number };
}

/**
 * 무기가 공전하는 높이. 컨테이너 원점이 **발밑**이라 y=0이 바닥이다 —
 * 전투 평면(plane.ts)에 맞춰야 총알·몬스터와 높이가 어긋나지 않는다.
 */
export const ORBIT_CENTER_Y = ACTION_PLANE_Y;

/** 이펙트 스프라이트에서 호의 바깥 반지름(px). 원본 캔버스 64 기준 값이다. */
const SWING_FX_RADIUS = 30;

/**
 * 근접 무기를 **가만히 들고 있을 때** 조준선에서 위로 젖히는 각(rad).
 *
 * 예전엔 조준선과 정확히 일직선이라 언제나 찌를 자세로 보였다 — 도끼든 방망이든
 * 창처럼 뻗고 있어서 어색했다. 어깨에 걸치듯 비스듬히 들면 "휘두르기 직전"으로 읽힌다.
 *
 * 이 값이 곧 **휘두르기의 시작점**이기도 하다(아래 windup). 둘이 다르면 좌클릭한 순간
 * 무기가 툭 튀었다가 내려온다.
 */
export const MELEE_REST_TILT = (40 * Math.PI) / 180;

/**
 * 근접 무기를 쥔 손이 몸 중심에서 커서 쪽으로 뻗는 거리(px).
 *
 * 원거리(orbitRadius 기본 9)보다 멀리 잡는다 — 팔을 뻗어야 "무기를 들이대고 있다"로
 * 읽힌다. 무기 그림은 이 지점에서 시작하므로 이 값이 곧 그려지는 사거리의 일부다.
 */
const MELEE_HAND_REACH = 15;

function meleeSwingFrom(weapon: WeaponData): MeleeSwing {
  const halfArc = ((weapon.arc ?? 360) * Math.PI) / 360;
  return {
    halfArc,
    // 들고 있는 자세에서 그대로 내려친다 — 젖히는 각이 곧 평소 자세다.
    windup: MELEE_REST_TILT,
    /**
     * 이펙트 바깥 호를 무기 사거리에 맞춘다. 여기에 몬스터 히트박스(10px)까지 더하면
     * 판정 최대 거리와는 일치하지만, 화면에서는 호가 캐릭터 발밑까지 내려와 몸집을 압도한다.
     * 이펙트는 "날이 지나간 자리"를 그리는 것이지 판정 경계선을 그리는 게 아니다.
     */
    fxScale: (weapon.range ?? 0) / SWING_FX_RADIUS,
  };
}

/**
 * 무기 한 자루의 렌더 설정을 원본에서 **직접 잰 값**으로 만든다.
 *
 * 핵심은 `axis`다 — **총열(또는 날)이 향하는 방향**을 두 점으로 잰다. 예전엔 손잡이에서
 * 무기 끝으로 이은 선을 방향으로 썼는데, 권총처럼 총열은 수평이고 손잡이만 아래로
 * 내려온 그림에서는 그 선이 30° 넘게 기울어서 총구가 커서를 안 가리켰다. 손잡이 위치와
 * 총열 방향은 **별개로** 재야 한다.
 *
 * 궤도에 올리는 점(pivot)은 손잡이가 아니라 **손잡이를 총열 축에 내린 발**이다. 그래야
 * 총열 축이 조준선 위에 정확히 놓여서, 총구가 커서를 향하고 총알이 총구에서 나가는
 * 것처럼 보인다. 손은 그보다 몇 px 아래에 그려진다 — 실총도 손이 총열보다 아래다.
 */
function measured(options: {
  frame: string;
  /** 손이 쥐는 자리(스프라이트 좌표). */
  grip: Point;
  /** 총열/날 위의 두 점. 두 번째가 끝(총구·칼끝)이다. */
  axis: [Point, Point];
  /** 원본 대비 배율. 원본 캔버스 크기가 제각각이라 무기마다 직접 잰다. */
  scale: number;
  orbitRadius: number;
  center?: Point;
  handCount?: number;
  /** ranged면 축의 끝을 총구로 등록한다. melee면 휘두르기 값이 나중에 붙는다. */
  ranged: boolean;
}): WeaponVisual {
  const { frame, grip, axis, scale, orbitRadius, center, ranged } = options;
  const [near, tip] = axis;
  const forward = Math.atan2(tip.y - near.y, tip.x - near.x);

  return {
    frame,
    center,
    scale,
    forward,
    pivot: projectOntoAxis(grip, near, tip),
    // 뒷손은 손잡이, 앞손은 조금 앞. 총열 방향으로 띄워야 두 손이 무기를 따라 놓인다.
    grips: [
      grip,
      { x: grip.x + Math.cos(forward) * HAND_SPACING, y: grip.y + Math.sin(forward) * HAND_SPACING },
    ],
    handCount: options.handCount ?? 2,
    orbitRadius,
    ...(ranged ? { muzzle: tip } : {}),
  };
}

/** 점을 직선 위에 수직으로 내린 발. pivot을 총열 축 위로 올리는 데 쓴다. */
function projectOntoAxis(point: Point, from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return { ...from };

  const t = ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared;
  return { x: from.x + dx * t, y: from.y + dy * t };
}

/** 두 손 사이 간격(스프라이트 px). 원본이 32px든 128px든 손은 같은 크기로 그려진다. */
const HAND_SPACING = 9;

/** 32×32 도구(도끼·곡괭이·망치). 자루 끝이 좌하단, 머리가 우상단인 공통 구도다. */
function toolVisual(frame: string): WeaponVisual {
  return measured({
    frame,
    grip: { x: 8, y: 25 },
    // 자루가 곧 축이다 — 자루 끝에서 머리 쪽으로.
    axis: [
      { x: 8, y: 25 },
      { x: 25, y: 7 },
    ],
    scale: 0.62,
    orbitRadius: 9,
    ranged: false,
  });
}

/**
 * 128×64 총기 시트. grip/axis는 확대한 원본에 8px 격자를 얹어 눈으로 잰 값이다.
 *
 * **궤도 반경은 직접 정하지 않고 weapons.json의 muzzleOffset에서 거꾸로 구한다.**
 * 서버는 총알을 플레이어에서 muzzleOffset만큼 떨어진 곳에 만드는데, 그 거리와 그림상
 * 총구 위치를 각자 손으로 맞춰두면 스프라이트를 손볼 때마다 조용히 어긋난다("총알이
 * 총구가 아닌 데서 나온다"). 총구가 축 위에 있으므로 조준선을 따라 잰 총구 거리는
 * `orbitRadius + 스프라이트상 총구거리 × scale`이다 — 이 식을 뒤집어 반경을 정하면
 * 그려진 총구가 **항상** 총알이 생기는 자리와 같아진다.
 */
function gunVisual(
  weaponId: string,
  frame: string,
  grip: Point,
  axis: [Point, Point],
  scale: number,
  center: Point,
  handCount = 2,
): WeaponVisual {
  const [near, tip] = axis;
  const pivot = projectOntoAxis(grip, near, tip);
  const muzzleDistance = Math.hypot(tip.x - pivot.x, tip.y - pivot.y) * scale;
  const muzzleOffset = weaponsData[weaponId]?.muzzleOffset ?? muzzleDistance;

  return measured({
    frame,
    grip,
    axis,
    scale,
    // 총이 몸 안으로 파고들지는 않게 최소 거리는 남긴다. 여기에 걸린다는 건
    // muzzleOffset이 그림보다 너무 짧다는 뜻이라 데이터를 다시 재야 한다.
    orbitRadius: Math.max(MIN_GUN_ORBIT_RADIUS, muzzleOffset - muzzleDistance),
    center,
    handCount,
    ranged: true,
  });
}

/** 총기가 몸에 파고들지 않도록 남기는 최소 궤도 반경(px). */
const MIN_GUN_ORBIT_RADIUS = 6;

/**
 * 신규 시트 무기들의 불투명 픽셀 경계. grip/axis와 같은 측정 패스에서 나온 값이라
 * 여기 함께 둔다 — 스프라이트를 다시 그리면 이 표도 같이 다시 재야 한다.
 */
const PACK_ART_BOUNDS: Record<string, { x: number; y: number; width: number; height: number }> = {
  bat: { x: 3, y: 11, width: 199, height: 35 },
  stone_spear: { x: 0, y: 19, width: 231, height: 29 },
  fire_axe: { x: 4, y: 0, width: 176, height: 62 },
  knife: { x: 1, y: 13, width: 147, height: 38 },
  machete: { x: 7, y: 20, width: 204, height: 27 },
  tomahauk: { x: 3, y: 1, width: 148, height: 61 },
  beamsword: { x: 0, y: 16, width: 235, height: 24 },
  slingshot: { x: 5, y: 1, width: 72, height: 61 },
  crossbow: { x: 8, y: 0, width: 182, height: 61 },
  rifle: { x: 6, y: 9, width: 226, height: 45 },
  revolver: { x: 3, y: 5, width: 92, height: 52 },
  handgun: { x: 10, y: 7, width: 76, height: 51 },
  smg: { x: 2, y: 0, width: 114, height: 62 },
  double_barrel_shotgun: { x: 4, y: 11, width: 220, height: 46 },
  assault_rifle: { x: 2, y: 1, width: 185, height: 61 },
  pump_shotgun: { x: 9, y: 10, width: 200, height: 44 },
  sniper_rifle: { x: 0, y: 3, width: 235, height: 54 },
  minigun: { x: 4, y: 2, width: 169, height: 56 },
};

/**
 * 신규 시트(235×62)의 원거리 무기. 프레임 이름은 태그에서 유도한다
 * (build-atlas의 `{파일}_{태그}_{프레임}` 규약).
 */
function packGun(
  weaponId: string,
  grip: Point,
  axis: [Point, Point],
  scale: number,
  handCount = 2,
): WeaponVisual {
  return {
    ...gunVisual(
      weaponId,
      `weapons_new_${weaponId}_0`,
      grip,
      axis,
      scale,
      WEAPON_SHEET_CENTER,
      handCount,
    ),
    artBounds: PACK_ART_BOUNDS[weaponId],
  };
}

/**
 * 신규 시트의 근접 무기. 총구가 없으니 궤도 반경을 직접 준다 —
 * 근접은 서버 판정(range)이 스윙 이펙트로 표현되지, 발사 지점과 맞출 대상이 없다.
 */
function packMelee(
  weaponId: string,
  grip: Point,
  axis: [Point, Point],
  scale: number,
  orbitRadius = MELEE_ORBIT_RADIUS,
  handCount = 2,
): WeaponVisual {
  return {
    ...measured({
      frame: `weapons_new_${weaponId}_0`,
      grip,
      axis,
      scale: scale * MELEE_SHRINK,
      orbitRadius,
      center: WEAPON_SHEET_CENTER,
      handCount,
      ranged: false,
    }),
    artBounds: PACK_ART_BOUNDS[weaponId],
  };
}

/**
 * 근접 무기를 몸에서 띄우는 기본 거리(px). 측정 스크립트가 무기 길이를 정할 때 쓴
 * 값과 같다 — 여기와 weapons.json의 range가 "그린 길이 ≈ 판정 사거리"로 맞물린다.
 */
const MELEE_ORBIT_RADIUS = 9;

/**
 * 근접 무기 전체에 곱하는 축소 배율("일괄적으로 축소" 요청).
 *
 * 무기마다 배율을 따로 손대지 않고 여기 한 곳에서 곱하는 이유는, 아래 표의 숫자가
 * **무기끼리의 비율**(방망이 대 나이프의 상대 크기)을 담고 있기 때문이다. 개별로
 * 곱해 적어 두면 다음에 또 "조금만 줄여 줘" 소리를 들었을 때 비율이 흐트러진다.
 *
 * 이 값을 바꾸면 weapons.json의 근접 range도 같이 다시 계산해야 한다 —
 * 그린 길이와 판정 사거리는 한 몸이다(tools/measure-weapons 참고).
 */
const MELEE_SHRINK = 0.75;

export const WEAPON_VISUALS: Record<string, WeaponVisual> = {
  /**
   * 맨손 — 무기를 안 들었을 때의 기본 공격. 손 스프라이트 자체가 무기라
   * 손을 따로 그리지 않는다(handCount 0).
   */
  fist: measured({
    frame: HAND_FRAME,
    grip: { x: 16, y: 16 },
    axis: [
      { x: 12, y: 16 },
      { x: 22, y: 16 },
    ],
    scale: 1,
    orbitRadius: 12,
    handCount: 0,
    ranged: false,
  }),

  // --- 채집 도구: 티어가 올라도 구도는 같고 스프라이트만 바뀐다 ---
  axe_t1: toolVisual('axe_stone_axe_0'),
  axe_t2: toolVisual('axe_iron_axe_0'),
  axe_t3: toolVisual('axe_saw_0'),
  pickax_t1: toolVisual('pickax_stone_axe_0'),
  pickax_t2: toolVisual('pickax_iron_axe_0'),
  pickax_t3: toolVisual('pickax_steel_axe_0'),
  hammer_t1: toolVisual('hammer_stone_hammer_0'),
  hammer_t2: toolVisual('hammer_iron_hammer_0'),

  // --- 근접(신규 시트). grip/axis는 원본의 불투명 픽셀에서 잰 값이다 ---
  bat: packMelee('bat', { x: 27, y: 32 }, [{ x: 27, y: 32 }, { x: 201, y: 31 }], 0.216),
  stone_spear: packMelee(
    'stone_spear',
    { x: 58, y: 33 },
    [{ x: 58, y: 33 }, { x: 230, y: 32 }],
    0.32,
  ),
  fire_axe: packMelee('fire_axe', { x: 38, y: 32 }, [{ x: 38, y: 32 }, { x: 172, y: 30 }], 0.244),
  // 나이프는 한 손 무기다 — 두 손을 그리면 짧은 칼자루에 손이 겹쳐 붙는다.
  knife: packMelee('knife', { x: 19, y: 32 }, [{ x: 19, y: 32 }, { x: 147, y: 31 }], 0.153, 9, 1),
  machete: packMelee('machete', { x: 31, y: 30 }, [{ x: 31, y: 30 }, { x: 210, y: 25 }], 0.219),
  tomahauk: packMelee('tomahauk', { x: 25, y: 26 }, [{ x: 25, y: 26 }, { x: 150, y: 30 }], 0.243),
  beamsword: packMelee(
    'beamsword',
    { x: 28, y: 32 },
    [{ x: 28, y: 32 }, { x: 234, y: 32 }],
    0.246,
  ),

  // --- 원거리(신규 시트). 축은 총열 높이의 수평선이라 near.y = tip.y다 ---
  // 새총만 세로 구도(Y자가 위를 향한다) — 축도 그대로 위로 잡는다.
  slingshot: packGun('slingshot', { x: 57, y: 45 }, [{ x: 57, y: 50 }, { x: 62, y: 6 }], 0.312),
  crossbow: packGun('crossbow', { x: 62, y: 38 }, [{ x: 62, y: 35 }, { x: 189, y: 35 }], 0.257),
  rifle: packGun('rifle', { x: 84, y: 38 }, [{ x: 84, y: 15 }, { x: 231, y: 15 }], 0.246),
  revolver: packGun('revolver', { x: 14, y: 38 }, [{ x: 14, y: 11 }, { x: 94, y: 11 }], 0.244, 1),
  handgun: packGun('handgun', { x: 22, y: 40 }, [{ x: 22, y: 15 }, { x: 85, y: 15 }], 0.257, 1),
  smg: packGun('smg', { x: 39, y: 41 }, [{ x: 39, y: 14 }, { x: 115, y: 14 }], 0.223),
  double_barrel_shotgun: packGun(
    'double_barrel_shotgun',
    { x: 66, y: 40 },
    [{ x: 66, y: 16 }, { x: 223, y: 16 }],
    0.235,
  ),
  assault_rifle: packGun(
    'assault_rifle',
    { x: 82, y: 40 },
    [{ x: 82, y: 20 }, { x: 186, y: 20 }],
    0.233,
  ),
  pump_shotgun: packGun(
    'pump_shotgun',
    { x: 74, y: 40 },
    [{ x: 74, y: 15 }, { x: 208, y: 15 }],
    0.252,
  ),
  sniper_rifle: packGun(
    'sniper_rifle',
    { x: 76, y: 40 },
    [{ x: 76, y: 23 }, { x: 234, y: 23 }],
    0.29,
  ),
  minigun: packGun('minigun', { x: 51, y: 45 }, [{ x: 51, y: 34 }, { x: 172, y: 34 }], 0.332),

  /**
   * 표창은 팩에 없어서 생성기로 만들었다(assets/_generators/weapon_shuriken.lua).
   * 64×64 4날 별이라 중심이 곧 그립이고, 축은 중심에서 오른쪽 날 끝까지다.
   */
  shuriken: gunVisual(
    'shuriken',
    'weapon_shuriken_idle_0',
    { x: 32, y: 32 },
    [{ x: 32, y: 32 }, { x: 58, y: 32 }],
    0.3,
    { x: 32, y: 32 },
    1,
  ),
};

// weapons.json이 근접이라고 한 무기에만 휘두르기 값을 붙인다. 두 곳에 같은 숫자를
// 적어두면 반드시 어긋나므로, 각도·사거리는 항상 서버 데이터에서 유도한다.
for (const [id, visual] of Object.entries(WEAPON_VISUALS)) {
  const weapon = weaponsData[id];
  if (weapon?.type === 'melee') visual.melee = meleeSwingFrom(weapon);
}

/** 표에 없는 무기를 들었을 때의 대체. 맨손은 어떤 상태에서도 그릴 수 있다. */
export const DEFAULT_WEAPON_ID = 'fist';

export function weaponVisual(weaponId: string): WeaponVisual {
  return WEAPON_VISUALS[weaponId] ?? WEAPON_VISUALS[DEFAULT_WEAPON_ID];
}

/** 손에 든 일반 아이템을 그릴 때의 목표 크기(px). 맨손보다 조금 크게 잡아 눈에 띈다. */
const HELD_ITEM_TARGET = 16;

/** 만든 시각 정보를 아이템 id로 캐시한다 — 프레임마다 새로 만들면 GC가 계속 돈다. */
const heldItemCache = new Map<string, WeaponVisual>();

/**
 * 무기가 아닌 아이템(붕대·재료·건축물 등)을 손에 든 모습.
 *
 * 예전엔 무기가 아니면 전부 맨손으로 그려서, 붕대를 들었는지 돌을 들었는지 화면에서
 * 알 수 없었다. 무기와 **같은 배치 규칙**(궤도·회전·휘두르기)에 얹으면 별도 코드 없이
 * 조준 방향을 따라 돌고 공격 모션도 그대로 나온다 — 맨손 공격과 같은 효과라는 점이
 * 그림으로도 이어진다.
 *
 * 크기는 아이템마다 원본 캔버스가 제각각이라(재료 64px, 소모품 32px, 건축물 32px)
 * 그림이 실제로 차지하는 영역을 기준으로 목표 크기에 맞춘다.
 */
export function heldItemVisual(
  scene: Phaser.Scene,
  itemId: string,
  frame: string,
): WeaponVisual {
  const cached = heldItemCache.get(itemId);
  if (cached) return cached;

  const source = scene.textures.get(GAME_ATLAS).get(frame);
  const size = Math.max(source.width, source.height);
  const centre = { x: source.width / 2, y: source.height / 2 };

  const visual: WeaponVisual = {
    ...measured({
      frame,
      // 손은 그림 한가운데를 쥔다. 아이템마다 손잡이가 어디인지 알 수 없으니 가운데가
      // 가장 덜 어색하다.
      grip: centre,
      axis: [centre, { x: centre.x + size / 2, y: centre.y }],
      scale: HELD_ITEM_TARGET / size,
      orbitRadius: 12,
      center: centre,
      handCount: 1,
      ranged: false,
    }),
    // 맨손과 같은 휘두르기 값을 쓴다 — 판정도 맨손(fist)이라 그림과 규칙이 맞는다.
    melee: WEAPON_VISUALS[DEFAULT_WEAPON_ID]!.melee,
  };
  heldItemCache.set(itemId, visual);
  return visual;
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

  // 왼쪽(±90도 밖)을 볼 때만 뒤집는다. 기준은 조준각이다 — 휘두르는 중에 무기가
  // 좌우로 뒤집히면 눈에 거슬린다.
  const facingLeft = Math.abs(aimAngle) > Math.PI / 2;

  /*
   * 휘두르는 방향은 **보는 쪽을 따라간다.**
   *
   * 오른쪽을 볼 때는 위에서 아래로(화면상 시계방향) 내려친다. 왼쪽을 볼 때 같은
   * 부호를 쓰면 몸 쪽에서 바깥으로 퍼올리는 꼴이 된다 — 그림이 좌우로 뒤집혔으니
   * 궤적도 같이 뒤집혀야 날이 앞서 나간다.
   */
  const swingOffset = (pose?.offset ?? 0) * (facingLeft ? -1 : 1);

  /*
   * **손과 무기를 따로 둔다.**
   *
   * 예전엔 기울인 각도로 손 위치까지 같이 돌려서, 무기가 몸 중심을 축으로 빙 돈 것처럼
   * 보였다 — 왼쪽을 볼 때 방망이가 몸을 가로질러 어깨 위에 얹혔다("캐릭터 중심으로
   * 사선으로 잡는 것 같다" 제보).
   *
   * 손은 **커서 쪽으로 뻗고**(handAngle), 무기는 그 손에서 위로 기울여 잡는다(angle).
   * 팔을 뻗어 무기를 비스듬히 든 자세가 된다. 휘두르는 동안엔 손도 궤도를 따라 도니
   * 무기는 손과 같은 각도차를 유지한 채 함께 쓸고 지나간다.
   */
  const handAngle = aimAngle + swingOffset;
  const tilt = visual.melee ? -MELEE_REST_TILT * (facingLeft ? -1 : 1) : 0;
  const angle = handAngle + tilt;
  // 근접은 팔을 뻗은 만큼 손이 몸에서 더 멀다. 원거리는 예전 궤도 반경 그대로다.
  const radius =
    (visual.melee ? MELEE_HAND_REACH : visual.orbitRadius) + (pose?.thrust ?? 0);

  /*
   * 왼쪽을 볼 때의 반전은 **조준선을 거울로 삼는다.**
   *
   * 예전엔 무기마다 x축/y축 중 하나를 골라 뒤집었는데, 그건 무기가 정확히 가로나
   * 세로로 그려졌을 때만 맞는 얘기다. 도끼처럼 45° 누운 그림은 어느 축으로 뒤집어도
   * 날이 엉뚱한 쪽을 향한다("좌우 어느 쪽을 봐도 날이 같은 방향" 제보).
   *
   * 임의의 축 f에 대한 반전은 `flipY(=x축 반전) + 회전 2f`와 같다. 평소 회전이
   * (angle - f)이므로, 거울상은 flipY에 회전 (angle + f)를 주면 정확히 얻어진다.
   * 무기가 어떤 각도로 그려져 있든 이 한 줄이면 맞는다.
   */
  const flipX = false;
  const flipY = facingLeft;
  const rotation = facingLeft ? angle + visual.forward : angle - visual.forward;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  // 손(=무기를 쥔 지점)은 **조준 방향**에 있다. 기울기는 무기 회전에만 들어간다.
  const pivotX = Math.cos(handAngle) * radius;
  const pivotY = Math.sin(handAngle) * radius + ORBIT_CENTER_Y;

  const toContainer = (point: Point): Point =>
    weaponPointToContainer(point, visual, pivotX, pivotY, cos, sin, flipX, flipY);

  weapon.setScale(visual.scale);
  weapon.setRotation(rotation);
  weapon.setFlipX(flipX);
  weapon.setFlipY(flipY);
  // 스프라이트 자체의 원점은 중심이므로, 중심이 어디로 가는지 따로 구해야 한다.
  const center = toContainer(visual.center ?? DEFAULT_SPRITE_CENTER);
  weapon.setPosition(center.x, center.y);

  hands.forEach((hand, index) => {
    // 맨손처럼 무기 스프라이트 자체가 손인 경우엔 손을 겹쳐 그리지 않는다.
    hand.setVisible(index < visual.handCount);
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
    /*
     * 궤적도 무기와 **같이** 뒤집는다.
     *
     * 부채꼴 그림은 위에서 아래로 쓸고 지나가게 그려져 있다. 무기는 왼쪽을 볼 때
     * flipY로 뒤집히고 swingOffset의 부호까지 반대가 되는데, 이펙트만 그대로 두면
     * 날은 아래로 내려오는데 궤적은 위로 올라가는 꼴이 된다("왼쪽 공격 이펙트가
     * 이질적이다" 제보). 회전이 조준각 그대로이므로 flipY 한 줄이 곧 조준선을 축으로
     * 삼은 거울상이다 — 무기에 쓴 것과 같은 규칙이다.
     */
    swingFx.setFlipY(facingLeft);
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
