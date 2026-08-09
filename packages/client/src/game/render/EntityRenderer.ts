import Phaser from 'phaser';
import {
  BARE_HANDS_WEAPON_ID,
  HIT_RADIUS,
  TILE_SIZE,
  USE_FX,
  buildingsData,
  companionData,
  isWithinCoreInteract,
  itemOfSlot,
  monstersData,
  resourcesData,
  weaponsData,
  worldToCell,
  type ResourceType,
} from '@dropfall/shared';
import type {
  BuildingView,
  ColonyView,
  CompanionView,
  DroppedItemView,
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
  hasJobSprite,
  hasPlayerSprite,
  idleFrame,
  registerPlayerAnimations,
  spritePrefix,
  walkAnimKey,
} from './playerSprite';
import { ACTION_PLANE_Y } from './plane';
import { hasItemFrame, itemFrame } from './itemSprite';
import {
  BULLET_ANIM,
  DEFAULT_WEAPON_ID,
  HAND_FRAME,
  MUZZLE_ANIM,
  SWING_ANIM,
  SWING_STRIKE_DELAY_MS,
  bulletFrame,
  hasBulletFx,
  heldItemVisual,
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
  type WeaponVisual,
} from './weaponFx';
import {
  MONSTER_ATLAS,
  MONSTER_ORIGIN_Y,
  monsterAttackAnim,
  monsterScale,
  hasMonsterSprite,
  monsterAnimKey,
  monsterArtOffsetX,
  monsterIdleFrame,
  monsterSpriteHeight,
  registerMonsterAnimations,
} from './monsterSprite';
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
  demon: 0xa4576a,
  hellhound: 0xd07a4a,
  blood: 0x7e2b3c,
  eyeball: 0xc9c26b,
  lava_slime: 0xd96f32,
  minotaur: 0x8c5ba8,
  boss_demon: 0xd94f4f,
  boss_knight: 0x4a4f6b,
  boss_golem: 0xb0622f,
  boss_dark_knight: 0x2e2b3f,
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

/**
 * 피격 시 흰색으로 번쩍이는 시간(ms). 60ms면 60fps에서 서너 프레임이다 — 눈에는
 * 확실히 걸리면서 잔상으로 남지는 않는 길이다. 더 길면 연사 중에 계속 하얗게 뜬다.
 */
const HIT_FLASH_MS = 60;

/** 자원 노드 타입별 플레이스홀더 색상(docs/backend/24). 크기는 몬스터와 같은 이유로
 * resourcesData[type].hitRadius에서 그대로 뽑는다(그림-판정 어긋남 방지). */
const RESOURCE_COLOR: Record<string, number> = {
  wood: 0x5b8c4a,
  stone: 0x8a8f99,
};
const RESOURCE_COLOR_FALLBACK = 0x8a8f99;
const RESOURCE_HIT_RADIUS_FALLBACK = 14;

/**
 * AI 동반자("티모시") 비주얼. 전용 그림이 없는 동안은 기존 직업 스프라이트를
 * 틴트 입혀 재사용한다 — 이 상수 하나만 바꾸면 나중에 전용 그림/색으로 교체된다
 * (docs/superpowers/specs/2026-08-07-ai-companion-timothy-design.md).
 */
const COMPANION_SPRITE_JOB = spritePrefix('searchman');
const COMPANION_TINT = 0xf2c14e;
const COMPANION_PLACEHOLDER_COLOR = 0xf2c14e;

/**
 * 스프라이트가 있는 건축물. 방향(h/v)은 이웃 배치에서 자동으로 고른다 —
 * 서버·설치 UI에 방향 개념을 추가하지 않기 위해서다.
 * 프레임이 아틀라스에 없으면 아래 플레이스홀더 표로 떨어진다.
 */
/** 무기가 아닌 아이템을 손에 든 상태를 가리키는 키 접두사(§visualOf). */
const HELD_ITEM_PREFIX = 'item:';

const BUILDING_SPRITE: Record<string, { h: string; v: string }> = {
  // wood.aseprite: 울타리는 가운데가 뚫려 있고(총알 통과 규칙과 일치) 벽은 꽉 차 있다.
  fence: { h: 'wood_fence_front_0', v: 'wood_fence_side_0' },
  wall: { h: 'wood_wall_front_0', v: 'wood_wall_side_0' },
  // build_tier.aseprite: 같은 실루엣에 재질만 다르다(돌 → 철).
  stone_fence: { h: 'build_tier_stone_fence_front_0', v: 'build_tier_stone_fence_side_0' },
  stone_wall: { h: 'build_tier_stone_wall_front_0', v: 'build_tier_stone_wall_side_0' },
  iron_fence: { h: 'build_tier_iron_fence_front_0', v: 'build_tier_iron_fence_side_0' },
  iron_wall: { h: 'build_tier_iron_wall_front_0', v: 'build_tier_iron_wall_side_0' },
  // spikes.aseprite: 바닥에 눕는 판이라 방향이 없다 — h/v 둘 다 같은 프레임을 쓴다.
  spike: { h: 'spikes_spike_front_0', v: 'spikes_spike_front_0' },
  stone_spike: { h: 'spikes_stone_spike_front_0', v: 'spikes_stone_spike_front_0' },
  iron_spike: { h: 'spikes_iron_spike_front_0', v: 'spikes_iron_spike_front_0' },
};

/** 건축물 타입별 플레이스홀더 표현. 울타리는 낮고 얇게, 벽은 크고 두껍게 그려서 구분한다. */
const BUILDING_STYLE: Record<string, { color: number; size: number }> = {
  fence: { color: 0xb08a5c, size: 12 },
  wall: { color: 0x6b6f78, size: 16 },
  stone_fence: { color: 0x8a8c8c, size: 12 },
  stone_wall: { color: 0x696a6a, size: 16 },
  iron_fence: { color: 0xa6b0be, size: 12 },
  iron_wall: { color: 0x747e8c, size: 16 },
  // 스파이크는 벽·울타리보다 납작하게 — 막는 물건이 아니라 밟는 물건이다.
  spike: { color: 0xb08a5c, size: 8 },
  stone_spike: { color: 0x8a8c8c, size: 8 },
  iron_spike: { color: 0xa6b0be, size: 8 },
};
const BUILDING_FALLBACK = { color: 0x6b6f78, size: 14 };

/**
 * 콜로니 플레이스홀더(docs/backend/35). 종류가 하나뿐이라 색상표가 필요 없다 —
 * 건축물보다 눈에 띄게 크게 그려서 "이건 부술 수 있는 랜드마크"임을 시각적으로 구분한다.
 */
const COLONY_COLOR = 0x7a3fb0;

/**
 * 자원 노드 스프라이트. 내구도 구간마다 겉모습이 변한다 — 항목은 [최소 체력비율, 프레임]
 * 쌍이고 위에서부터 먼저 맞는 것을 쓴다.
 *
 * 마지막 단계(부서지기 직전 모습)는 파괴 시점이 아니라 **30% 아래**부터 나온다.
 * 파괴 순간에만 나오면 그 모습을 볼 시간이 없다 — "곧 부서진다"는 예고가 역할이다.
 */
/**
 * 타격 이펙트. 노드 종류마다 다르다 — 나무는 잎이 흩날리고 돌은 조각이 튄다.
 * offsetY는 이펙트가 터지는 높이(나무는 수관, 돌은 몸통 가운데).
 */
const GATHER_FX: Record<string, { anim: string; prefix: string; offsetY: number }> = {
  wood: { anim: 'fx_gather_leaf', prefix: 'fx_gather_leaf_', offsetY: -40 },
  stone: { anim: 'fx_gather_shard', prefix: 'fx_gather_shard_', offsetY: -12 },
};
const GATHER_FX_FRAMES = 5;
const GATHER_FX_RATE = 16;

/**
 * 플레이어 피격 이펙트(fx_hurt.lua). 6프레임을 18fps로 — 0.33초짜리 짧은 임팩트라
 * 연타로 맞아도 겹치지 않고 끊어져 보인다. 가슴 높이(ACTION_PLANE_Y)에 얹는다.
 */
const HURT_FX_ANIM = 'fx_hurt_hit';
const HURT_FX_PREFIX = 'fx_hurt_hit_';
const HURT_FX_FRAMES = 6;
const HURT_FX_RATE = 18;
/**
 * 피격 시 몸이 좌우로 떨리는 폭(px)과 왕복 시간(ms). 카메라 대신 **캐릭터만** 흔든다 —
 * 화면 전체가 흔들리면 조준까지 흔들려서, 맞을수록 반격이 어려워지는 역효과가 났다.
 * 자원 노드 타격(§playNodeHit)과 같은 yoyo 두 번 = 전체 약 180ms짜리 잔떨림이다.
 */
const HURT_BODY_SHAKE_PIXELS = 2;
const HURT_BODY_SHAKE_MS = 45;
/**
 * 소모품 사용 이펙트. 서버가 정해 준 종류(USE_FX)를 그림으로만 바꾼다 —
 * 어떤 아이템이 어느 이펙트인지는 서버 판단이고, 여기서 아이템 표를 다시 읽지 않는다.
 *
 * 회복은 원래 루프용으로 그려진 10프레임이라 조금 느리게(14fps, 약 0.7초) 한 바퀴만 돌린다.
 * 버프·스탯은 한 번 터지고 끝나는 8프레임이라 더 빠르게(18fps, 약 0.44초) 넘긴다.
 */
const USE_FX_ANIMS: Record<
  number,
  { anim: string; prefix: string; frames: number; rate: number }
> = {
  [USE_FX.heal]: { anim: 'fx_use_heal', prefix: 'fx_heal_heal_', frames: 10, rate: 14 },
  [USE_FX.buff]: { anim: 'fx_use_buff', prefix: 'fx_boost_buff_', frames: 8, rate: 18 },
  [USE_FX.statup]: { anim: 'fx_use_statup', prefix: 'fx_boost_statup_', frames: 8, rate: 18 },
};

/**
 * 소모품 이펙트의 **바닥선 비율**(캔버스 높이 대비). 원점을 여기로 잡아야 이펙트의
 * 발밑 고리가 캐릭터 발밑에 놓인다.
 *
 * 예전엔 원점을 캔버스 한가운데(0.5)로 두고 캐릭터 위치에 놓았는데, 이펙트 그림은
 * 가운데가 아니라 y=33(40px 캔버스)에 바닥이 그려져 있어서 **13px 아래로 밀렸다** —
 * 고리가 발밑이 아니라 정강이 아래 땅에 떠 있었다. 세 이펙트 모두 같은 규격이라 값이
 * 하나다(생성기의 GROUND / 캔버스 높이 = 33 / 40).
 */
const USE_FX_GROUND_Y = 33 / 40;

/**
 * 레벨업 이펙트(fx_levelup.lua) — 하얀 빛기둥이 한 번 번쩍한다. 6프레임을 14fps로,
 * 약 0.43초짜리 짧은 섬광이다.
 *
 * 예전엔 금빛 기둥에 고리·불티·별 광채까지 얹은 10프레임이었는데, 레벨업은 캐릭터에게
 * 일어나는 일이지 화면에 일어나는 일이라 거창한 연출이 정작 캐릭터를 가렸다.
 */
const LEVEL_UP_ANIM = 'fx_levelup';
const LEVEL_UP_PREFIX = 'fx_levelup_levelup_';
const LEVEL_UP_FRAMES = 6;
const LEVEL_UP_RATE = 14;
/** 그림의 바닥선 비율(생성기의 GROUND 40 / 캔버스 높이 48). 소모품 이펙트와 같은 규약이다. */
const LEVEL_UP_GROUND_Y = 40 / 48;
/**
 * 레벨업 때 캐릭터가 하얗게 점멸하는 횟수와 간격(ms), 그리고 시작을 늦추는 시간.
 *
 * 기둥과 **겹치지 않게 늦춘다.** 동시에 터뜨렸더니 하얘진 캐릭터와 흰 기둥이 한 덩어리로
 * 뭉쳐서 실루엣이 통째로 사라졌다 — 기둥이 번쩍한 뒤에 캐릭터가 깜빡여야 둘 다 읽힌다.
 */
const LEVEL_UP_BLINKS = 3;
const LEVEL_UP_BLINK_GAP_MS = 130;
const LEVEL_UP_BLINK_DELAY_MS = 160;

/** 피격 아웃라인 색(눌린 빨강 — fx_hurt 팔레트와 동일)과 유지 시간(ms). */
const HURT_OUTLINE_COLOR = 0xd95c4a;
const HURT_OUTLINE_MS = 150;

/** 타격 흔들림 — 미세하고 빠르게. 크면 우스꽝스럽고 느리면 얻어맞는 느낌이 안 난다. */
const SHAKE_PIXELS = 1.5;
const SHAKE_DURATION_MS = 45;

const RESOURCE_STAGES: Record<string, [number, string][]> = {
  stone: [
    [0.65, 'stone_full_0'],
    [0.3, 'stone_cracked_0'],
    [0, 'stone_broken_0'],
  ],
  wood: [[0, 'tree_full_0']],
};

/**
 * 바닥 드롭을 그릴 크기(px). 원본이 재료는 64px, 몬스터 드랍은 32px로 제각각이라
 * 배율을 고정하면 어떤 건 커지고 어떤 건 점만 해진다 — 화면 크기를 기준으로 되맞춘다.
 * 캐릭터가 32px이니 한 손에 들 만한 크기다.
 */
const DROP_SIZE = 14;
const DROP_BOB_PIXELS = 2;
const DROP_BOB_PERIOD_MS = 1400;
/**
 * 코어. 충돌은 스프라이트 윤곽을 실측한 8각 발자국(shared/coreShape.ts)이 판정한다 —
 * 눈으로 찾는 랜드마크가 먼저고, 부딪히는 크기는 그대로다.
 */
const CORE_FRAME = 'core__0';
/**
 * 코어 위에 뜨는 "E" 키 안내. 원점이 아래쪽(0.5, 1)이라 화살표 끝이 이 y를 가리킨다 —
 * 코어 몸통 꼭대기보다 조금 위에 둔다.
 */
const KEY_PROMPT_FRAME = 'ui_keyprompt_e_0';
/**
 * 코어 스프라이트 꼭대기(원점 0.68 기준 -73px) 바로 위. 더 띄우면 화살표가 무엇을
 * 가리키는지 흐려진다 — 실제로 -96에서는 코어와 한 덩어리로 안 읽혔다.
 */
const KEY_PROMPT_Y = -80;
/** 둥둥 뜨는 폭(px)과 한 번 오르내리는 시간(ms). */
const KEY_PROMPT_BOB = 5;
const KEY_PROMPT_BOB_MS = 900;

const CORE_SPRITE_SIZE = 128;
/** 원래 0.42였고, 랜드마크로 잘 보이도록 2배로 키웠다. */
const CORE_SCALE = 0.84;
/**
 * 앵커(=월드 원점)를 받침대의 시각적 중심에 둔다. 처음엔 캐릭터처럼 발밑(0.86)에
 * 뒀는데, 그러면 받침대 중심이 원점보다 ~19px 위에 그려져서 원점 대칭인 건축
 * 구역·광원과 코어가 서로 어긋나 보였다. 이 값을 바꾸면 coreShape.ts의 발자국도
 * 같이 다시 재야 한다.
 */
const CORE_ORIGIN_Y = 0.68;
/**
 * 스프라이트 안 수정(가운데 청록 구슬)의 중심과 크기. 원본에서 밝은 픽셀 범위를 재서
 * 넣었다 — 반짝임이 이 자리에 정확히 얹혀야 "수정이 빛난다"로 보이고, 밝기 맥동은
 * 이 영역만 잘라내 덧그린다.
 */
const CORE_CRYSTAL = { x: 63, y: 26 };


const CORE_CRYSTAL_CROP = { x: 33, y: 0, width: 62, height: 58 };

/**
 * 이펙트 배율은 코어 배율에 비례한다. 코어를 키웠는데 이펙트가 그대로면 반짝임이
 * 구슬 안에 파묻히고, 승급 고리가 받침대도 못 덮는다.
 */
const CORE_GLINT_SCALE_RATIO = 2.4;
const CORE_UPGRADE_SCALE_RATIO = 1.9;

/** 수정 반짝임. 주기적으로 한 번씩 재생한다. */
const CORE_GLINT_ANIM = 'fx_core_glint';
const CORE_GLINT_PREFIX = 'fx_core_glint_';
const CORE_GLINT_FRAMES = 12;
const CORE_GLINT_RATE = 14;
/** 반짝임 사이 간격(ms). 너무 잦으면 배경 소음이 되고, 너무 뜸하면 못 본다. */
const CORE_GLINT_MIN_GAP_MS = 3200;
const CORE_GLINT_MAX_GAP_MS = 5200;

/** 티어 상승 연출. 한 번 터지고 끝난다. */
const CORE_UPGRADE_ANIM = 'fx_core_upgrade';
const CORE_UPGRADE_PREFIX = 'fx_core_upgrade_';
const CORE_UPGRADE_FRAMES = 14;
/** 14프레임 × 14fps = 1초. 더 빠르면 고리가 퍼지는 걸 눈으로 못 쫓는다. */
const CORE_UPGRADE_RATE = 14;

/**
 * 수정 밝기 맥동. 애니메이션 프레임이 아니라 **같은 그림을 덧대어 밝히는** 방식이라
 * (가산 합성 + 알파 트윈), 스프라이트를 다시 그리지 않고도 밝기가 실제로 오르내린다.
 * 숨 쉬듯 느려야 살아 있는 느낌이 나고, 빠르면 깜빡이는 전구가 된다.
 */
const CORE_PULSE_MIN_ALPHA = 0.06;
const CORE_PULSE_MAX_ALPHA = 0.34;
const CORE_PULSE_DURATION_MS = 1600;

/** 코어 플레이스홀더(아틀라스가 없을 때). 예전 GameScene이 그리던 그대로다. */
const CORE_PLACEHOLDER_SIZE = TILE_SIZE * 2;
const CORE_PLACEHOLDER_FILL = 0x3a4658;

/**
 * 코어 스프라이트의 "북쪽 사각지대". 앵커(CORE_ORIGIN_Y=0.68)가 받침대 중심에 있어서
 * 그림이 앵커보다 위로(북쪽, y가 음수인 방향) 훨씬 더 뻗는다 — 8각 발자국(coreShape.ts)의
 * 충돌 경계는 y≈-27에서 끝나지만 그림 꼭대기는 y≈-73까지 올라간다. 그 사이(발자국
 * 바깥이라 몬스터가 설 수 있지만 그림에는 가려지는 구간)에 뭔가 있으면, 코어를
 * 반투명하게 만들어 12시 방향에서 공격하는 몬스터가 뒤에 가려 안 보이던 문제
 * (실제 제보)를 없앤다. 여유를 두어 발자국/그림 경계보다 살짝 넉넉하게 잡았다 —
 * 안 보이는 것보다 조금 일찍 흐려지는 쪽이 낫다.
 */
const CORE_BLIND_ZONE_HALF_WIDTH = 55;
const CORE_BLIND_ZONE_NORTH = -80;
const CORE_BLIND_ZONE_SOUTH = -20;
/** 사각지대에 뭔가 있을 때 코어 몸체가 흐려지는 정도/속도. */
const CORE_FADE_ALPHA = 0.4;
const CORE_FADE_TWEEN_MS = 150;

/**
 * 코어가 맞은 순간의 알림 — 몸체 흰색 플래시 + **실루엣 테두리가 붉게 두 번 깜빡인다.**
 *
 * 예전엔 코어를 감싸는 얇은 원이 커지며 사라졌는데, 코어 그림이 원형이 아니라
 * 테두리가 어디에도 닿지 않고 공중에 떠 보였다. 캐릭터 피격(§spawnHurtOutline)과 같은
 * 문법 — 실루엣을 밀어 깔아 외곽선을 만드는 방식 — 으로 통일하면 "무엇이 맞았는지"가
 * 형태로 읽힌다. 색은 캐릭터보다 어둡게 눌러 코어의 청록색과 부딪히지 않게 했고,
 * 두께는 코어 그림이 커서 2px이다(캐릭터는 1px).
 */
const CORE_HIT_OUTLINE_MS = 480;
const CORE_HIT_OUTLINE_COLOR = 0xa8322a;
const CORE_HIT_OUTLINE_THICKNESS = 2;
/** 깜빡임 횟수(켜짐→꺼짐을 이만큼 반복). */
const CORE_HIT_BLINKS = 2;
const CORE_PLACEHOLDER_STROKE = 0x7f8fa6;

const COLONY_SIZE = 28;
const COLONY_FRAME = 'colony_idle_0';
/** 원본 125x128 → 코어(2타일)보다 조금 큰 랜드마크 크기로 줄인다. */
const COLONY_SCALE = 0.45;

/** 이 거리보다 적게 움직였으면 정지로 본다(보간 지터로 걷기 애니메이션이 떨리는 것 방지) */
const MOVE_EPSILON = 0.15;
/**
 * 좌표가 안 변해도 걷기를 유지하는 프레임 수. 20Hz 스냅샷을 60fps로 그리면 세 프레임에
 * 한 번꼴로만 좌표가 갱신되므로, 그보다 넉넉해야 한다(몬스터도 같은 값을 쓴다).
 */
const STILL_GRACE_FRAMES = 6;

/**
 * 쓰러진 몸이 눕는 각도(라디안). 발밑 원점을 축으로 도니 90도가 곧 "바닥에 완전히
 * 누움"이다.
 */
const DOWNED_TILT = Math.PI / 2;

/**
 * 쓰러진 몸의 고정 자세. 정면(카메라 쪽) 그림을 눕히면 **하늘을 보고 누운** 자세가 된다.
 * 좌우 반전도 하지 않는다 — 쓰러진 사람에게는 조준 방향이 없다.
 */
const DOWNED_POSE = { direction: 'front', flipX: false } as const;

/**
 * 유령의 불투명도. **쓰러짐에는 쓰지 않는다** — 누운 그림 자체가 이미 상태를 말하는데
 * 반투명까지 얹으면 바닥에 녹아 어디 쓰러졌는지 잘 안 보인다. 유령은 반대로, 서 있는
 * 그림이라 이 투명도가 산 사람과 구분해 주는 유일한 표시다.
 */
const GHOST_ALPHA = 0.35;

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
 * 재장전 게이지. 닉네임 **바로 위**에 둔다 — 처음엔 이름표 아래(머리 위)에 뒀더니
 * 머리카락에 겹쳐서 지저분했다. 탄약 숫자는 화면 아래 HUD에도 있지만, "지금 못 쏜다"는
 * 사실은 캐릭터에서 눈을 떼지 않고 읽혀야 한다.
 */
const RELOAD_BAR_WIDTH = 18;
const RELOAD_BAR_HEIGHT = 3;
const RELOAD_BAR_OFFSET_Y = -(LABEL_FONT_SIZE + 4);
const RELOAD_BAR_BACK = 0x2b303c;
const RELOAD_BAR_FILL = 0xe0c060;

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
  private readonly droppedItems = new Map<string, Phaser.GameObjects.Container>();
  /** 드롭 흔들기 애니메이션용 누적 시간(ms). */
  private dropBobElapsed = 0;
  private readonly buildings = new Map<string, Phaser.GameObjects.Container>();
  private readonly colonies = new Map<string, Phaser.GameObjects.Container>();
  /** AI 동반자("티모시"). 방(팀)당 1마리라 코어처럼 맵이 아니라 단일 필드다. */
  private companion?: Phaser.GameObjects.Container;
  /** 코어(원점 고정). 스프라이트 + 반짝임 + 승급 이펙트를 한 컨테이너에 담는다. */
  private core?: Phaser.GameObjects.Container;
  /** 코어 위 "E" 안내. 상호작용 사거리 안에 들어왔을 때만 보인다. */
  private corePrompt?: Phaser.GameObjects.Sprite;
  /** 다음 반짝임까지 남은 시간(ms). */
  private glintTimer = CORE_GLINT_MIN_GAP_MS;
  /** 직전 스냅샷의 코어 티어. 늘어난 순간에만 승급 이펙트를 터뜨린다. */
  private lastCoreTier: number | null = null;
  /** 직전 스냅샷의 코어 체력. 줄어든 순간에만 피격 연출을 터뜨린다(플레이어/몬스터와 같은 방식). */
  private lastCoreHp: number | null = null;
  /** 코어 사각지대(§CORE_BLIND_ZONE_*)가 지금 비어있는지 — 매번 트윈을 새로 걸지
   * 않고 상태가 바뀔 때만 걸기 위한 플래그. */
  private coreBlindZoneOccupied = false;

  /** 보스 공격 예고(텔레그래프) 표시. 몬스터 id별로 하나씩, 예고 중일 때만 존재한다. */
  private readonly telegraphs = new Map<string, Phaser.GameObjects.Graphics>();
  /** 이동 여부 판정용 직전 좌표 */
  private readonly lastPositions = new Map<string, { x: number; y: number }>();
  /** 노드 타격 감지용 직전 체력. 스냅샷에는 "맞았다"는 이벤트가 없어서 체력 감소로 추론한다. */
  private readonly lastNodeHp = new Map<string, number>();
  private readonly hasSprite: boolean;
  /** 티모시 전용 — 아틀라스는 있어도 재사용 대상 직업(searchman) 그림이 아직 없을 수 있다. */
  private readonly hasCompanionSprite: boolean;
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
  /**
   * 티모시가 자원을 캘 때의 휘두르기.
   *
   * `swings` 맵에 같이 넣지 않는 이유는 그 맵이 **플레이어 목록에 없는 id를 매 프레임
   * 지우기** 때문이다(§syncPlayers 끝). 티모시는 플레이어가 아니라 지워진다.
   */
  private companionSwing: SwingState | null = null;
  private zoom = 1;
  /** 켜면 모든 플레이어 위에 실제 이동-충돌 판정 반경(원)을 겹쳐 그린다(디버그용). */
  private collisionDebugVisible = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly ownSessionId: string,
  ) {
    this.hasSprite = hasPlayerSprite(scene);
    if (this.hasSprite) registerPlayerAnimations(scene);
    this.hasCompanionSprite = this.hasSprite && hasJobSprite(scene, COMPANION_SPRITE_JOB);

    this.hasWeapon = hasWeaponSprites(scene);
    this.hasHands = hasHandSprite(scene);
    this.hasMuzzle = hasMuzzleFx(scene);
    this.hasSwing = hasSwingFx(scene);
    this.hasBullet = hasBulletFx(scene);
    if (this.hasMuzzle) registerMuzzleAnimation(scene);
    registerMonsterAnimations(scene);
    this.registerGatherAnimations();
    this.registerCoreAnimations();
    if (this.hasSwing) registerSwingAnimation(scene);
    if (this.hasBullet) registerBulletAnimation(scene);
  }

  /** 매 프레임 호출. 휘두르기처럼 스냅샷과 무관하게 시간이 흐르는 연출을 진행시킨다. */
  advance(deltaMs: number): void {
    this.dropBobElapsed += deltaMs;
    this.tickCoreGlint(deltaMs);

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

    this.advanceCompanionSwing(deltaMs);
  }

  /**
   * 티모시의 휘두르기 한 프레임. 캐는 동안은 **끝나면 곧바로 다시 시작한다** — 채집은
   * 한 번의 동작이 아니라 계속 두들기는 일이라, 플레이어의 단발 공격과 달리 반복된다.
   */
  private advanceCompanionSwing(deltaMs: number): void {
    const swing = this.companionSwing;
    if (!swing) return;

    swing.elapsedMs += deltaMs;
    if (!swing.fxPlayed && swing.elapsedMs >= SWING_STRIKE_DELAY_MS) {
      swing.fxPlayed = true;
      const part = this.companion?.getByName('swingFx');
      if (part instanceof Phaser.GameObjects.Sprite) {
        part.setVisible(true);
        part.play(SWING_ANIM, true);
        part.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => part.setVisible(false));
      }
    }
    if (isSwingFinished(swing)) this.companionSwing = null;
  }

  /**
   * 스냅샷의 장착 무기를 반영한다. 바뀐 경우에만 프레임을 갈아끼우고 진행 중인
   * 휘두르기를 끊는다 — 매 프레임 setFrame을 부르면 애니메이션이 초기화된다.
   */
  private syncWeapon(sessionId: string, heldKey: string): void {
    if (this.equipped.get(sessionId) === heldKey) return;
    this.equipped.set(sessionId, heldKey);
    this.swings.delete(sessionId);

    const weapon = this.players.get(sessionId)?.getByName('aim');
    if (weapon instanceof Phaser.GameObjects.Sprite && this.hasWeapon) {
      weapon.setFrame(this.visualOf(heldKey).frame);
    }
  }

  weaponOf(sessionId: string): string {
    return this.equipped.get(sessionId) ?? DEFAULT_WEAPON_ID;
  }

  /**
   * 손에 든 것을 가리키는 키 → 그리는 방법.
   *
   * 무기는 무기표(WEAPON_VISUALS)를, 그 밖의 아이템은 아이콘에서 즉석으로 만든 것을
   * 쓴다(§heldItemVisual). 키에 접두사를 붙여 두 세계를 한 문자열로 다룬다 — 이 키가
   * 곧 "지금 그림이 최신인가" 판정에 쓰이므로 하나여야 한다.
   */
  private visualOf(heldKey: string): WeaponVisual {
    if (!heldKey.startsWith(HELD_ITEM_PREFIX)) return weaponVisual(heldKey);
    const itemId = heldKey.slice(HELD_ITEM_PREFIX.length);
    const frame = itemFrame(itemId);
    if (!frame || !hasItemFrame(this.scene, frame)) return weaponVisual(DEFAULT_WEAPON_ID);
    return heldItemVisual(this.scene, itemId, frame);
  }

  /**
   * 이 플레이어가 손에 든 것의 키. 무기면 무기 id, 무기가 아닌데 그림이 있으면
   * `item:<id>`, 아무것도 아니면 맨손이다.
   */
  private heldKeyOf(player: PlayerView): string {
    const item = itemOfSlot(player.slots[player.selectedSlot]);
    if (!item) return DEFAULT_WEAPON_ID;
    if (item.kind === 'weapon' && item.weaponId) return item.weaponId;

    const itemId = player.slots[player.selectedSlot]?.itemId;
    if (!itemId) return DEFAULT_WEAPON_ID;
    const frame = itemFrame(itemId);
    return frame && hasItemFrame(this.scene, frame)
      ? `${HELD_ITEM_PREFIX}${itemId}`
      : DEFAULT_WEAPON_ID;
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
      const speech = sprite.getByName('speech') as Phaser.GameObjects.Text | null;
      speech?.setResolution(zoom);
    }
    const companionLabel = this.companion?.getByName('label') as Phaser.GameObjects.Text | null;
    companionLabel?.setResolution(zoom);
    const companionSpeech = this.companion?.getByName('speech') as Phaser.GameObjects.Text | null;
    companionSpeech?.setResolution(zoom);
  }

  /**
   * `localOverride`: 내 캐릭터(로컬 플레이어)의 위치를 스냅샷 값 대신 이걸로 그린다 —
   * `PlayerPredictor`가 네트워크 도착 시각과 무관하게 계산한 예측 좌표다(docs/backend/55).
   * 다른 필드(hp/조준각/장비)는 그대로 스냅샷을 쓴다. 원격 플레이어/몬스터 등 나머지는
   * 영향받지 않는다 — 여전히 순수 보간이다.
   */
  sync(snapshot: WorldSnapshot, localOverride?: { id: string; x: number; y: number }): void {
    this.syncCore(snapshot.status.coreTier, snapshot.status.coreHp);
    this.syncCorePrompt(snapshot.players);
    this.syncPlayers(snapshot.players, localOverride);
    this.syncMonsters(snapshot.monsters);
    this.syncTelegraphs(snapshot.monsters);
    this.syncProjectiles(snapshot.projectiles);
    this.syncResourceNodes(snapshot.resourceNodes);
    this.syncBuildings(snapshot.buildings);
    this.syncColonies(snapshot.colonies);
    this.syncDroppedItems(snapshot.droppedItems);
    this.syncCompanion(snapshot.companion);
    // 몬스터 좌표가 필요해서(사각지대 판정) syncMonsters 다음에 한다.
    this.updateCoreBlindZone(snapshot.monsters);
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
    for (const map of [
      this.players,
      this.monsters,
      this.resourceNodes,
      this.buildings,
      this.colonies,
    ]) {
      for (const sprite of map.values()) sprite.destroy();
      map.clear();
    }
    for (const projectile of this.projectiles.values()) projectile.destroy();
    this.projectiles.clear();
    for (const gfx of this.telegraphs.values()) gfx.destroy();
    this.telegraphs.clear();
  }

  // ---------------------------------------------------------------- 플레이어

  private syncPlayers(views: PlayerView[], localOverride?: { id: string; x: number; y: number }): void {
    const alive = new Set<string>();

    for (const player of views) {
      alive.add(player.id);

      let sprite = this.players.get(player.id);
      if (!sprite) {
        sprite = this.createPlayer(player);
        this.players.set(player.id, sprite);
      }

      // 피격은 몬스터와 같은 방식으로 **체력이 줄었는지**로 안다 — 서버에 필드를
      // 새로 만들지 않아도 되고, 누가 때렸든(몬스터 평타·보스 검술·돌진) 똑같이 반응한다.
      const lastHp = sprite.getData('hp') as number | undefined;
      if (lastHp !== undefined && player.hp < lastHp) this.playPlayerHurt(sprite);
      sprite.setData('hp', player.hp);

      // 내 캐릭터면 예측 좌표를, 아니면(원격) 스냅샷(보간된) 좌표를 그대로 쓴다.
      const useOverride = localOverride?.id === player.id;
      const renderX = useOverride ? localOverride.x : player.x;
      const renderY = useOverride ? localOverride.y : player.y;

      // 정수 스냅 — roundPixels와 함께 서브픽셀 흔들림을 막는다.
      sprite.setPosition(Math.round(renderX), Math.round(renderY));
      // 탑다운 깊이 정렬: 아래에 있을수록 앞에 그린다.
      sprite.setDepth(renderY);

      /*
       * 소모품 이펙트는 **번호가 바뀐 순간**에만 튼다.
       *
       * 회복을 체력 증가로 알아낼 수도 있지만 그러면 체력이 저절로 차는 자연회복까지
       * 이펙트가 붙고, 진통제처럼 체력이 전혀 안 변하는 버프는 아예 잡히지 않는다.
       * 처음 본 플레이어(값이 없을 때)는 재생하지 않는다 — 방에 들어서자마자 남이
       * 예전에 먹은 게 터지면 안 된다.
       */
      const lastUseSeq = sprite.getData('useFxSeq') as number | undefined;
      if (lastUseSeq !== undefined && lastUseSeq !== player.useFxSeq) {
        this.playUseFx(sprite, player.useFxKind);
      }
      sprite.setData('useFxSeq', player.useFxSeq);

      // 레벨업도 같은 규칙 — 번호가 바뀐 순간에만 튼다.
      const lastLevelSeq = sprite.getData('levelUpSeq') as number | undefined;
      if (lastLevelSeq !== undefined && lastLevelSeq !== player.levelUpSeq) {
        this.playLevelUpFx(sprite);
      }
      sprite.setData('levelUpSeq', player.levelUpSeq);

      // 유령만 흐리게 — 쓰러진 몸은 누운 그림 자체가 상태를 말한다(§GHOST_ALPHA).
      sprite.setAlpha(player.lifeState === 'ghost' ? GHOST_ALPHA : 1);

      // 무기는 서버가 정한다. 무기가 아닌 걸 들었으면 맨손이다 — 소모품을 든 동안에도
      // 좌클릭으로 때릴 수 있으므로(서버의 BARE_HANDS_WEAPON_ID) 그림도 맨손이어야 한다.
      // 그림은 "손에 든 것"을 그대로 따라간다 — 무기가 아니어도 들고 있으면 보여야 한다.
      // 전투 판정은 여전히 무기 여부로 갈린다(서버의 BARE_HANDS_WEAPON_ID).
      this.syncWeapon(player.id, this.heldKeyOf(player));
      const equippedWeaponId =
        itemOfSlot(player.slots[player.selectedSlot])?.weaponId ?? BARE_HANDS_WEAPON_ID;
      this.updateReloadBar(sprite, player, equippedWeaponId);

      const aim = sprite.getByName('aim');
      if (aim instanceof Phaser.GameObjects.Sprite) {
        // 무기 일습(무기·양손·이펙트)을 궤도 위에 배치한다
        const parts = this.readWeaponParts(sprite, aim);
        const visual = this.visualOf(this.weaponOf(player.id));
        layoutWeapon(parts, visual, player.aimAngle, this.swings.get(player.id) ?? null);
        orderWeaponAgainstBody(sprite, parts, player.aimAngle);
        /*
         * 쓰러지거나 유령이면 무기와 손을 감춘다.
         *
         * 무기 배치는 **서 있는 몸**을 전제로 한 궤도 계산이라, 쓰러진 몸 옆에 방망이가
         * 허공에 떠 있는 그림이 된다. 손을 놓았다고 보는 편이 자세와도 맞는다.
         */
        const armed = player.lifeState === 'alive';
        parts.weapon.setVisible(armed);
        parts.hands.forEach((hand) => hand.setVisible(armed && hand.visible));
        parts.swingFx?.setVisible(armed && parts.swingFx.visible);
      } else if (aim instanceof Phaser.GameObjects.Rectangle) {
        aim.setPosition(Math.cos(player.aimAngle) * 12, Math.sin(player.aimAngle) * 12);
      }

      if (this.hasSprite) this.updatePlayerSprite(sprite, player, renderX, renderY);
    }

    for (const map of [this.lastPositions, this.swings, this.equipped]) {
      for (const id of map.keys()) {
        if (!alive.has(id)) map.delete(id);
      }
    }
    this.removeMissing(this.players, alive);
  }

  /**
   * 플레이어 피격 연출 — 몬스터 피격(§flashSprite)과 같은 문법에 세 가지를 더한다.
   *
   *  1) 흰색 플래시: 실루엣 통째로. 어떤 직업 스프라이트든 똑같이 확실하게 읽힌다.
   *  2) 붉은 아웃라인: 몸 실루엣을 4방향 1px로 복제해 뒤에 깐다 — 픽셀아트의 고전
   *     외곽선 기법이다. 플래시(흰색)가 꺼진 뒤에도 잠깐 남아 "맞았다"의 여운을 만든다.
   *  3) 몸 떨림: 캐릭터 스프라이트만 1~2px 좌우로 떤다. 카메라를 흔들지 않는 이유:
   *     화면 전체가 흔들리면 조준까지 흔들려서 맞을수록 반격이 어려워졌다.
   *
   * 피격 스파크(fx_hurt)는 가슴 높이에 얹는다 — 플래시가 "맞았다"면 스파크는
   * "여기를 맞았다"다.
   */
  private playPlayerHurt(container: Phaser.GameObjects.Container): void {
    const body = container.getByName('body');
    if (body instanceof Phaser.GameObjects.Sprite) {
      this.flashSprite(body);
      this.spawnHurtOutline(container, body);

      // 몸 떨림 — 컨테이너가 아니라 자식만 흔들어야 HP 바·라벨까지 같이 떨리지 않는다.
      if (!this.scene.tweens.isTweening(body)) {
        this.scene.tweens.add({
          targets: body,
          x: { from: 0, to: HURT_BODY_SHAKE_PIXELS },
          duration: HURT_BODY_SHAKE_MS,
          yoyo: true,
          repeat: 1,
          onComplete: () => body.setX(0),
        });
      }
    }

    if (this.scene.anims.exists(HURT_FX_ANIM)) {
      const burst = this.scene.add
        .sprite(container.x, container.y + ACTION_PLANE_Y, GAME_ATLAS, `${HURT_FX_PREFIX}0`)
        .setDepth(container.y + 1);
      burst.play(HURT_FX_ANIM);
      burst.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => burst.destroy());
    }
  }

  /**
   * 소모품 사용 이펙트. **그림의 바닥선을 캐릭터 발밑에 맞춰** 겹쳐 놓는다 — 세 이펙트
   * 모두 발밑 고리를 포함해 그려져 있어서, 피격 스파크처럼 가슴 높이로 올리면 고리가
   * 배 위에 뜬다.
   *
   * 깊이는 캐릭터보다 한 단계 위다. 회복 십자가는 몸을 가려도 되는 종류의 그림이고,
   * 뒤로 깔면 캐릭터에 거의 다 먹힌다.
   */
  private playUseFx(container: Phaser.GameObjects.Container, kind: number): void {
    const fx = USE_FX_ANIMS[kind];
    if (!fx || !this.scene.anims.exists(fx.anim)) return;

    const burst = this.scene.add
      .sprite(container.x, container.y, GAME_ATLAS, `${fx.prefix}0`)
      // 그림의 바닥선을 캐릭터 발밑에 맞춘다(§USE_FX_GROUND_Y).
      .setOrigin(0.5, USE_FX_GROUND_Y)
      .setDepth(container.y + 1);
    burst.play(fx.anim);
    burst.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => burst.destroy());
  }

  /**
   * 레벨업 — **캐릭터가 하얗게 몇 번 점멸하고 빛기둥이 번쩍한다.**
   *
   * 점멸은 그림이 아니라 스프라이트 틴트로 낸다(피격 플래시와 같은 문법) — 어떤 직업이든
   * 같은 실루엣으로 반응하고, 직업마다 이펙트를 그릴 필요가 없다.
   *
   * 기둥은 **캐릭터 뒤에** 깐다. 앞에 두면 정작 레벨이 오른 사람이 가려진다.
   * 사라짐은 프레임이 아니라 알파로 처리한다 — 그림에서 밝기를 디더로 표현하면
   * 기둥이 얼룩덜룩해져 "빛"이 아니라 "무늬"로 보인다.
   */
  private playLevelUpFx(container: Phaser.GameObjects.Container): void {
    const body = container.getByName('body');
    if (body instanceof Phaser.GameObjects.Sprite) {
      for (let i = 0; i < LEVEL_UP_BLINKS; i += 1) {
        this.scene.time.delayedCall(LEVEL_UP_BLINK_DELAY_MS + i * LEVEL_UP_BLINK_GAP_MS, () => {
          if (body.active) this.flashSprite(body);
        });
      }
    }

    if (!this.scene.anims.exists(LEVEL_UP_ANIM)) return;
    const burst = this.scene.add
      .sprite(container.x, container.y, GAME_ATLAS, `${LEVEL_UP_PREFIX}0`)
      .setOrigin(0.5, LEVEL_UP_GROUND_Y)
      .setDepth(container.y - 1);
    burst.play(LEVEL_UP_ANIM);
    this.scene.tweens.add({
      targets: burst,
      alpha: 0,
      duration: (LEVEL_UP_FRAMES / LEVEL_UP_RATE) * 1000,
      ease: 'Quad.easeIn',
    });
    burst.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => burst.destroy());
  }

  /**
   * 붉은 1px 아웃라인. 몸과 같은 프레임을 4방향(상하좌우)으로 1px씩 밀어 **몸 뒤에**
   * 깔면 실루엣 가장자리만 삐져나와 외곽선처럼 보인다 — 셰이더 없이 픽셀아트 결을
   * 유지하는 고전 기법이다. 잠깐 쓰고 버리는 스프라이트 4장이라 풀링은 과하다.
   *
   * 유지되는 동안 매 프레임 몸의 프레임/반전/좌표를 따라간다 — 안 따라가면 걷는 중에
   * 아웃라인만 옛 포즈로 남아 유령처럼 어긋난다.
   */
  private spawnHurtOutline(
    container: Phaser.GameObjects.Container,
    body: Phaser.GameObjects.Sprite,
  ): void {
    const offsets: readonly (readonly [number, number])[] = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    const clones = offsets.map(([dx, dy]) => {
      const clone = this.scene.add
        .sprite(body.x + dx, body.y + dy, GAME_ATLAS, body.frame.name)
        .setOrigin(body.originX, body.originY)
        .setTintFill(HURT_OUTLINE_COLOR);
      container.addAt(clone, 0); // 몸보다 뒤에
      return { clone, dx, dy };
    });

    const follow = this.scene.time.addEvent({
      delay: 16,
      loop: true,
      callback: () => {
        for (const { clone, dx, dy } of clones) {
          if (!clone.active) continue;
          clone.setFrame(body.frame.name);
          clone.setFlipX(body.flipX);
          clone.setPosition(body.x + dx, body.y + dy);
        }
      },
    });

    this.scene.time.delayedCall(HURT_OUTLINE_MS, () => {
      follow.remove();
      for (const { clone } of clones) clone.destroy();
    });
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

    // 채팅 말풍선. 티모시와 같은 패턴 — 평소엔 빈 텍스트로 자리를 차지하지 않다가
    // 채팅이 오면 showPlayerSpeech가 채워 넣고 페이드아웃시킨다.
    const speech = this.scene.add
      .text(0, labelY - LABEL_FONT_SIZE - 2, '', {
        fontFamily: FONT_SMALL,
        fontSize: `${LABEL_FONT_SIZE}px`,
        color: '#f2f5fa',
        align: 'center',
        wordWrap: { width: 200 },
      })
      .setOrigin(0.5, 1)
      .setAlpha(0)
      .setName('speech');
    speech.setResolution(this.zoom);
    applyTextShadow(speech);

    // 컨테이너 원점(0,0)이 곧 서버 좌표(player.x/y)이므로, 반경만 플레이어 자신의
    // 충돌 반경(HIT_RADIUS)과 맞추면 스프라이트 origin/오프셋과 무관하게 정확한
    // 판정 범위가 그려진다. 건축물 쪽 반경은 각 건축물에 따로 그린다(createBuilding).
    const collisionDebug = this.scene.add.circle(0, 0, HIT_RADIUS);
    collisionDebug.setStrokeStyle(1, PLAYER_COLLISION_DEBUG_COLOR, COLLISION_DEBUG_ALPHA);
    collisionDebug.setFillStyle(0, 0);
    collisionDebug.setName('collisionDebug');
    collisionDebug.setVisible(this.collisionDebugVisible);

    // 재장전 게이지(평소엔 숨김). 이름표 바로 아래에서 왼쪽부터 차오른다.
    const reloadBarY = labelY + RELOAD_BAR_OFFSET_Y;
    const reloadBack = this.scene.add
      .rectangle(-RELOAD_BAR_WIDTH / 2, reloadBarY, RELOAD_BAR_WIDTH, RELOAD_BAR_HEIGHT, RELOAD_BAR_BACK)
      .setOrigin(0, 0.5)
      .setName('reloadBack')
      .setVisible(false);
    const reloadBar = this.scene.add
      .rectangle(-RELOAD_BAR_WIDTH / 2, reloadBarY, RELOAD_BAR_WIDTH, RELOAD_BAR_HEIGHT, RELOAD_BAR_FILL)
      .setOrigin(0, 0.5)
      .setName('reloadBar')
      .setVisible(false);

    // 순서는 매 프레임 orderWeaponAgainstBody가 다시 잡는다 — 여기선 전부 넣기만 한다.
    const parts: Phaser.GameObjects.GameObject[] = [
      aim,
      ...hands,
      body,
      label,
      speech,
      reloadBack,
      reloadBar,
    ];
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
  /**
   * `x`/`y`는 스냅샷의 `player.x`/`player.y`가 아니라 **실제로 화면에 그려지는**
   * 좌표를 받는다(`syncPlayers`가 계산한 renderX/renderY — 내 캐릭터면 예측 좌표).
   * 걷기/정지 애니메이션 판정을 렌더 좌표로 해야, 예측으로는 부드럽게 움직이는데
   * 애니메이션만 옛 보간 신호를 보고 멈춰 있는 것처럼 보이는 불일치가 안 생긴다.
   */
  private updatePlayerSprite(
    container: Phaser.GameObjects.Container,
    player: PlayerView,
    x: number,
    y: number,
  ): void {
    const body = container.getByName('body');
    if (!(body instanceof Phaser.GameObjects.Sprite)) return;

    const job = spritePrefix(player.job);
    const downed = player.lifeState === 'downed';
    /*
     * **쓰러진 몸은 커서를 따라가지 않는다.**
     *
     * 살아 있을 때는 조준 방향이 곧 몸의 방향이지만, 쓰러진 사람에게는 조준이라는 게
     * 없다 — 그런데도 커서를 따라 좌우가 뒤집히고 누운 쪽이 바뀌면 시체가 빙글 도는
     * 그림이 된다. 눕는 순간의 방향으로 굳혀 두지 않고 **아예 한 자세로 고정한다**:
     * 정면(카메라 쪽) 그림을 눕히면 하늘을 보고 누운 자세가 된다.
     */
    const { direction, flipX } = downed
      ? DOWNED_POSE
      : directionFromAngle(player.aimAngle);
    body.setFlipX(flipX);

    const previous = this.lastPositions.get(player.id);
    const moved = previous ? Math.hypot(x - previous.x, y - previous.y) > MOVE_EPSILON : false;
    this.lastPositions.set(player.id, { x, y });

    /*
     * **한 프레임 안 움직였다고 바로 멈추지 않는다.**
     *
     * 좌표는 매 렌더 프레임 바뀌지 않는다 — 서버 스냅샷은 20Hz고, 보간기가 다음
     * 스냅샷을 기다리는 동안 두 프레임이 같은 좌표로 나올 수 있다. 그때마다
     * `anims.stop()`을 걸면 다음 프레임에 다시 play가 걸리면서 **애니메이션이 영원히
     * 첫 프레임에 머문다** — 실제로 걷는데 캐릭터가 뻣뻣하게 미끄러지던 원인이다.
     *
     * 몬스터(§syncMonsters)가 이미 같은 방식으로 유예를 두고 있어 규칙을 맞췄다.
     */
    const stillFrames = (container.getData('still') as number | undefined) ?? 0;
    container.setData('still', moved ? 0 : stillFrames + 1);
    const walking = (moved || stillFrames < STILL_GRACE_FRAMES) && player.lifeState === 'alive';

    /*
     * **쓰러지면 눕는다.**
     *
     * 원점이 발밑(PLAYER_ORIGIN_Y 0.94)이라 그 점을 축으로 90도 돌리면 발은 제자리에
     * 두고 몸만 옆으로 눕는다 — 넘어진 자세가 그대로 나온다. 각도도 방향과 마찬가지로
     * **한 쪽으로 고정**이다(위 DOWNED_POSE 참고).
     *
     * 유령은 눕히지 않는다. 떠다니는 상태라 서 있는 그림이 맞다.
     */
    body.setRotation(downed ? DOWNED_TILT : 0);

    if (walking) {
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

      // 피격은 **체력이 줄었는지**로 안다. 서버에 필드를 새로 만들지 않아도 되고,
      // 누가 때렸든(내 공격·팀원·포탑) 똑같이 반응한다는 장점이 덤으로 붙는다.
      const lastHp = sprite.getData('hp') as number | undefined;
      const tookDamage = lastHp !== undefined && monster.hp < lastHp;
      sprite.setData('hp', monster.hp);

      const nextX = Math.round(monster.x);
      const nextY = Math.round(monster.y);
      this.updateMonsterAnim(sprite, monster, nextX - sprite.x, tookDamage);
      sprite.setPosition(nextX, nextY);
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

    // 사라진 몬스터는 그냥 지우지 않고 죽는 모습을 남긴다(§spawnMonsterCorpse).
    for (const [id, sprite] of this.monsters) {
      if (alive.has(id)) continue;
      this.spawnMonsterCorpse(sprite);
      sprite.destroy();
      this.monsters.delete(id);
    }
  }

  /**
   * 공격/걷기/대기 전환과 좌우 반전.
   *
   * **공격은 서버가 알려준다**(`attacking`) — 클라이언트는 몬스터가 무엇을 때리는지
   * 모르므로 위치만 보고는 추측할 수 없다. 다만 그 값을 매 프레임 그대로 따르지 않고
   * **켜지는 순간(false→true)에 한 번 재생**한다: 서버 플래그는 패치 주기에 맞춰
   * 여러 프레임 동안 켜져 있어서, 그대로 따르면 같은 모션이 매 프레임 처음부터 다시
   * 시작해 첫 장에서 덜덜 떨린다.
   *
   * 방향도 서버 값을 쓴다. 이동량으로 추정하면 제자리에서 공격하는 동안(=방향이 가장
   * 중요한 순간) 마지막 이동 방향에 얼어붙어, 플레이어가 돌아 들어가면 등을 보고
   * 때리게 된다.
   */
  /**
   * 재장전 게이지. 서버가 내려주는 남은 시간을 무기의 총 재장전 시간으로 나눠 채운다 —
   * 남은 시간만으로는 "얼마나 남았나"를 알 수 없고, 총 시간은 데이터에 이미 있어서
   * 동기화 필드를 늘릴 이유가 없다.
   */
  private updateReloadBar(
    container: Phaser.GameObjects.Container,
    player: PlayerView,
    weaponId: string,
  ): void {
    const back = container.getByName('reloadBack') as Phaser.GameObjects.Rectangle | null;
    const bar = container.getByName('reloadBar') as Phaser.GameObjects.Rectangle | null;
    if (!back || !bar) return;

    const total = weaponsData[weaponId]?.reloadTime ?? 0;
    const reloading = player.reloadRemaining > 0 && total > 0;
    back.setVisible(reloading);
    bar.setVisible(reloading);
    if (!reloading) return;

    const progress = Math.min(1, Math.max(0, 1 - player.reloadRemaining / total));
    bar.width = RELOAD_BAR_WIDTH * progress;
  }

  private updateMonsterAnim(
    container: Phaser.GameObjects.Container,
    monster: MonsterView,
    deltaX: number,
    tookDamage: boolean,
  ): void {
    const body = container.getByName('body');
    if (!(body instanceof Phaser.GameObjects.Sprite)) return;

    body.setFlipX(monster.facingLeft);
    // 그림이 캔버스 중앙에서 치우친 만큼 되돌린다 — 안 하면 판정 원의 한가운데에
    // 서 있지 않은 것처럼 보인다(§monsterArtOffsetX). 반전하면 치우침도 뒤집힌다.
    body.setX(monsterArtOffsetX(monster.type, monster.facingLeft));

    // 피격은 무엇보다 우선한다 — 때린 쪽에 즉시 반응이 돌아와야 손맛이 산다.
    // 공격 모션 중이어도 끊고 들어간다(연사로 계속 맞으면 계속 밀리는 게 맞다).
    const hurtKey = monsterAnimKey(monster.type, 'hurt');
    if (tookDamage) {
      this.flashSprite(body);
      if (this.scene.anims.exists(hurtKey)) {
        body.play(hurtKey, true);
        return;
      }
    }
    if (body.anims.currentAnim?.key === hurtKey && body.anims.isPlaying) return;

    // 어느 동작을 재생할지는 서버가 정한다 — 보스는 검술 세 종류의 사거리·각도가
    // 전부 달라서, 그림과 판정이 같은 기술을 가리켜야 한다.
    const attackKey = monsterAnimKey(monster.type, monsterAttackAnim(monster.attackAnim));
    // 공격 번호가 **바뀐 순간**에 한 번 재생한다. 예전엔 attacking 불리언의 false→true
    // 전이를 봤는데, 모션 길이가 공격 주기와 비슷한 몬스터(헬하운드: 0.76초 모션 /
    // 0.8초 주기)는 꺼져 있는 구간이 40ms뿐이라 20Hz 동기화가 그 창을 건너뛰기 일쑤였다.
    // 그러면 플래그가 계속 켜져 있는 것처럼 보여 첫 공격 뒤로 모션이 아예 안 나왔다.
    const lastSeq = container.getData('attackSeq') as number | undefined;
    container.setData('attackSeq', monster.attackSeq);
    const started = lastSeq !== undefined && lastSeq !== monster.attackSeq;

    if (started && monster.attacking && this.scene.anims.exists(attackKey)) {
      body.play(attackKey, true);
      return;
    }
    // 공격 모션은 끝까지 재생하고 나서 이동/대기로 돌아간다(반복 없는 애니메이션이라
    // 끝나면 isPlaying이 false가 된다).
    if (body.anims.currentAnim?.key.includes('_attack') && body.anims.isPlaying) return;

    // 픽셀 단위로 반올림된 좌표라, 아주 느린 몬스터는 프레임에 따라 delta가 0이 된다 —
    // 그때마다 걷기가 끊기지 않도록 정지 판정에 약간의 유예를 둔다.
    const moving = deltaX !== 0;
    const stillFrames = (container.getData('still') as number | undefined) ?? 0;
    container.setData('still', moving ? 0 : stillFrames + 1);

    const key = monsterAnimKey(monster.type, moving || stillFrames < STILL_GRACE_FRAMES ? 'walk' : 'idle');
    if (body.anims.currentAnim?.key !== key || !body.anims.isPlaying) body.play(key, true);
  }

  /**
   * 맞은 순간 흰색으로 한 번 번쩍인다.
   *
   * 피격 모션만으로는 약하다 — 4프레임짜리라 난전에서는 눈에 안 들어오고, 몬스터마다
   * 동작 크기도 제각각이다. 실루엣을 통째로 흰색으로 칠하는 건(setTintFill) 어떤
   * 그림이든 똑같이 확실하게 읽히는 고전적인 피격 표현이다.
   *
   * 스프라이트가 그 사이에 사라질 수 있어서(처치) 콜백에서 살아있는지 확인한다.
   */
  private flashSprite(body: Phaser.GameObjects.Sprite): void {
    body.setTintFill(0xffffff);
    this.scene.time.delayedCall(HIT_FLASH_MS, () => {
      if (body.active) body.clearTint();
    });
  }

  /**
   * 죽는 모습을 잠깐 남긴다. 서버는 처치 즉시 몬스터를 지우므로(스냅샷에서 사라진다)
   * 시체는 순수하게 클라이언트가 만드는 잔상이다 — 판정에는 아무 영향이 없다.
   * 애니메이션이 끝나면 스스로 사라진다.
   */
  private spawnMonsterCorpse(container: Phaser.GameObjects.Container): void {
    const body = container.getByName('body');
    if (!(body instanceof Phaser.GameObjects.Sprite)) return;

    const type = container.getData('type') as string | undefined;
    if (!type || !this.scene.anims.exists(monsterAnimKey(type, 'death'))) return;

    const corpse = this.scene.add
      .sprite(container.x, container.y, MONSTER_ATLAS, monsterIdleFrame(type))
      .setOrigin(0.5, MONSTER_ORIGIN_Y)
      .setScale(monsterScale(type))
      .setFlipX(body.flipX)
      // 산 몬스터보다 아래에 깔아서 시체가 전투를 가리지 않게 한다.
      .setDepth(container.y - 1);

    corpse.play(monsterAnimKey(type, 'death'));
    corpse.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      this.scene.tweens.add({
        targets: corpse,
        alpha: 0,
        duration: 400,
        onComplete: () => corpse.destroy(),
      });
    });
  }

  private createMonster(monster: MonsterView): Phaser.GameObjects.Container {
    const color = MONSTER_COLOR[monster.type] ?? MONSTER_COLOR_FALLBACK;
    const hitRadius = monstersData[monster.type]?.hitRadius ?? MONSTER_HIT_RADIUS_FALLBACK;
    const size = hitRadius * 2;

    // 스프라이트가 있으면 그림을, 없으면(에셋 미보유) 도형 플레이스홀더를 쓴다.
    // 그림은 **발밑을 원점**으로 잡아 y=0(월드 좌표 그대로)에 세운다 — 도형과 달리
    // 실제로 서 있는 모습이라, 몸통 중앙을 억지로 ACTION_PLANE_Y에 맞추면 땅에 파묻힌다.
    const spriteHeight = monsterSpriteHeight(monster.type);
    const useSprite = hasMonsterSprite(this.scene, monster.type);

    // 총알과 같은 높이 평면(plane.ts)에 올린다 — 발밑(월드 좌표) 그대로 그리면 총알이
    // 머리 위로 지나가는 것처럼 보인다. 판정은 항상 월드 좌표(컨테이너 자체 위치)로
    // 이뤄지니 이 오프셋은 순수하게 보이는 위치만 바꾼다.
    const body: Phaser.GameObjects.GameObject = useSprite
      ? this.scene.add
          .sprite(0, 0, MONSTER_ATLAS, monsterIdleFrame(monster.type))
          .setOrigin(0.5, MONSTER_ORIGIN_Y)
          .setScale(monsterScale(monster.type))
      : (() => {
          const rect = this.scene.add.rectangle(0, ACTION_PLANE_Y, size, size, color);
          rect.setStrokeStyle(1, 0x1a1c23);
          return rect;
        })();
    body.setName('body');

    // HP 바는 머리 위에 띄운다 — 그림이면 실측 높이, 도형이면 사각형 위쪽 기준.
    const barTop = useSprite ? -spriteHeight - 4 : ACTION_PLANE_Y - size / 2 - 4;
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

    // 몸통과 같은 평면(ACTION_PLANE_Y)에 그린다 — 판정 자체는 항상 월드 좌표에서
    // 이뤄지지만(컨테이너 위치가 곧 monster.x/y), 이 원은 "보이는 몸통 = 맞는 범위"를
    // 눈으로 확인시키려는 디버그용이라 시각적으로 몸통과 정확히 겹쳐야 의미가 있다.
    const collisionDebug = this.scene.add.circle(0, ACTION_PLANE_Y, hitRadius);
    collisionDebug.setStrokeStyle(1, MONSTER_COLLISION_DEBUG_COLOR, COLLISION_DEBUG_ALPHA);
    collisionDebug.setFillStyle(0, 0);
    collisionDebug.setName('collisionDebug');
    collisionDebug.setVisible(this.collisionDebugVisible);

    const container = this.scene.add.container(monster.x, monster.y, [
      barBack,
      bar,
      body,
      collisionDebug,
    ]);
    // 죽을 때 어떤 그림으로 쓰러질지 알아야 해서 타입을 들고 있는다(스냅샷에서 이미
    // 사라진 뒤라 그 시점엔 조회할 곳이 없다).
    container.setData('type', monster.type);
    return container;
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

      // 총구·몬스터 몸통·휘두르기 이펙트와 같은 "가슴 높이" 평면(ACTION_PLANE_Y)에
      // 올린다. 예전엔 이 오프셋을 투사체에만 주고 몬스터는 실제 좌표 그대로 그려서
      // 화면상 궤적이 판정 위치와 계속 어긋났었는데(backend/33), 지금은 몬스터
      // 몸통도 같은 평면에 올리고(§createMonster) 조준각도 그 평면 기준으로
      // 보정하므로(InputController.updateAim) 둘 다 같은 양만큼 뜬 채로 서로
      // 상대적으로는 정확히 맞물린다.
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

      // 리스폰될 때 같은 자리가 아니라 같은 군집 안 새 위치로 옮겨간다(docs/backend/39)
      // — 예전엔 자원 노드가 절대 안 움직인다는 전제로 생성 시점에만 위치를 잡았는데,
      // 이제는 매 스냅샷 갱신해야 리스폰 이동이 화면에도 반영된다. 보간 없이 순간
      // 이동으로 처리한다(리스폰이라는 사건 자체가 "펑 하고 새로 생긴다"는 연출과
      // 더 잘 맞는다).
      sprite.setPosition(Math.round(node.x), Math.round(node.y));
      sprite.setDepth(node.y);
      // 고갈되면(리스폰 대기 중) 아예 숨긴다 — 예전엔 흐리게 표시했지만, 리스폰이
      // 이제 같은 자리가 아니라 군집 안 새 위치로 옮겨가므로(docs/backend/39)
      // 옛 자리에 "여기 있었다"는 잔상을 남길 이유가 없어졌다(docs/backend/43).
      sprite.setVisible(node.hp > 0);

      // 내구도가 깎이면 겉모습도 단계적으로 바뀐다(돌 3단계).
      const body = sprite.getByName('body');
      const frame = this.resourceFrame(node);
      if (frame && body instanceof Phaser.GameObjects.Sprite && body.frame.name !== frame) {
        body.setFrame(frame);
      }

      // 체력이 줄었다 = 맞았다. 스냅샷에 타격 이벤트가 따로 없어서 이 추론으로 연출한다.
      const previousHp = this.lastNodeHp.get(node.id);
      if (previousHp !== undefined && node.hp < previousHp) {
        this.playNodeHit(node, body instanceof Phaser.GameObjects.Sprite ? body : null);
      }
      this.lastNodeHp.set(node.id, node.hp);

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

    for (const id of this.lastNodeHp.keys()) {
      if (!alive.has(id)) this.lastNodeHp.delete(id);
    }
    this.removeMissing(this.resourceNodes, alive);
  }

  /**
   * 코어. 맵 원점에 고정된 하나뿐인 물체라 다른 엔티티처럼 id로 관리하지 않는다.
   *
   * 예전엔 GameScene이 사각형 하나를 배경(depth -900)에 깔아뒀다. 스프라이트가
   * 생기면서 **깊이 정렬 대상**이 됐다 — 코어 앞에 선 플레이어는 코어보다 앞에
   * 그려져야 한다. 다른 물체와 같은 규칙(y 좌표 = depth)을 쓴다.
   */
  private syncCore(coreTier: number, coreHp: number): void {
    if (!this.core) this.core = this.createCore();

    // 티어가 **늘어난** 순간에만 터뜨린다. 처음 받은 값은 기준점으로만 쓴다 —
    // 접속하자마자 이미 3티어인 방에 들어가도 이펙트가 터지면 안 된다.
    if (this.lastCoreTier !== null && coreTier > this.lastCoreTier) this.playCoreUpgrade();
    this.lastCoreTier = coreTier;

    // 체력이 줄었다 = 맞았다. 플레이어/몬스터 피격과 같은 추론이다(스냅샷에 타격
    // 이벤트가 따로 없다). 처음 받은 값은 기준점으로만 쓴다.
    if (this.lastCoreHp !== null && coreHp < this.lastCoreHp) this.playCoreHit();
    this.lastCoreHp = coreHp;
  }

  /**
   * 코어 위 "E" 안내를 켜고 끈다.
   *
   * **판정은 서버와 같은 함수(isWithinCoreInteract)를 쓴다.** HUD의 하단 안내 문구도
   * 같은 값을 보므로, 글자는 떴는데 키캡은 안 뜨는 어긋남이 생기지 않는다.
   *
   * 둥둥 뜨는 트윈은 만들 때 한 번만 건다 — 보일 때마다 새로 걸면 트윈이 쌓인다.
   */
  private syncCorePrompt(players: PlayerView[]): void {
    const me = players.find((player) => player.id === this.ownSessionId);
    const visible = me !== undefined && me.hp > 0 && isWithinCoreInteract(me.x, me.y);

    if (!this.corePrompt) {
      if (!visible) return; // 필요해지기 전까지는 만들지 않는다
      if (!this.scene.textures.get(GAME_ATLAS).has(KEY_PROMPT_FRAME)) return;
      this.corePrompt = this.scene.add
        .sprite(0, KEY_PROMPT_Y, GAME_ATLAS, KEY_PROMPT_FRAME)
        // 화살표 끝이 원점이라, 이 좌표가 곧 "가리키는 지점"이다.
        .setOrigin(0.5, 1)
        .setDepth(KEY_PROMPT_Y);
      this.scene.tweens.add({
        targets: this.corePrompt,
        y: KEY_PROMPT_Y - KEY_PROMPT_BOB,
        duration: KEY_PROMPT_BOB_MS,
        ease: 'Sine.easeInOut',
        yoyo: true,
        repeat: -1,
      });
    }
    this.corePrompt.setVisible(visible);
  }

  /**
   * 코어 피격 연출 — "공격당하고 있다"는 게 눈에 안 띈다는 제보로 추가했다.
   * 몸체를 한 번 흰색으로 플래시하고, 그보다 오래 남는 붉은 테두리 펄스를 더한다
   * (플레이어 피격의 흰색+붉은 아웃라인 조합과 같은 문법 — §playPlayerHurt).
   * 코어는 화면 중앙에 크게 있어서 카메라 흔들림 없이도 눈에 잘 들어온다.
   */
  private playCoreHit(): void {
    if (!this.core) return;
    const body = this.core.getByName('body');

    if (body instanceof Phaser.GameObjects.Sprite) {
      this.flashSprite(body);
    } else if (body instanceof Phaser.GameObjects.Rectangle) {
      // 아틀라스가 없을 때(플레이스홀더 사각형)도 같은 문법으로 반응한다.
      const original = body.fillColor;
      body.setFillStyle(0xffffff);
      this.scene.time.delayedCall(HIT_FLASH_MS, () => {
        if (body.active) body.setFillStyle(original);
      });
    }

    if (body instanceof Phaser.GameObjects.Sprite) this.spawnCoreHitOutline(body);
  }

  /**
   * 코어 실루엣을 따라 붉은 테두리를 깔고 깜빡이게 한다.
   *
   * 캐릭터 피격 아웃라인과 같은 기법이다 — 같은 프레임을 상하좌우로 밀어 **본체 뒤에**
   * 깔면 가장자리만 삐져나와 외곽선이 된다. 코어는 제자리에 서 있고 프레임도 안 바뀌므로
   * 캐릭터처럼 매 프레임 따라다닐 필요가 없다(그래서 추적 타이머가 없다).
   */
  private spawnCoreHitOutline(body: Phaser.GameObjects.Sprite): void {
    if (!this.core) return;

    const t = CORE_HIT_OUTLINE_THICKNESS;
    const offsets: readonly (readonly [number, number])[] = [
      [t, 0],
      [-t, 0],
      [0, t],
      [0, -t],
    ];
    const clones = offsets.map(([dx, dy]) =>
      this.scene.add
        .sprite(body.x + dx, body.y + dy, GAME_ATLAS, body.frame.name)
        .setOrigin(body.originX, body.originY)
        .setScale(body.scaleX, body.scaleY)
        .setTintFill(CORE_HIT_OUTLINE_COLOR),
    );
    for (const clone of clones) this.core.addAt(clone, 0); // 본체보다 뒤에

    this.scene.tweens.add({
      targets: clones,
      alpha: { from: 1, to: 0.15 },
      duration: CORE_HIT_OUTLINE_MS / (CORE_HIT_BLINKS * 2),
      yoyo: true,
      repeat: CORE_HIT_BLINKS - 1,
      onComplete: () => {
        for (const clone of clones) clone.destroy();
      },
    });
  }

  /**
   * 코어 스프라이트가 그려내는 "북쪽 사각지대"(§CORE_BLIND_ZONE_*)에 몬스터가
   * 있으면 코어를 반투명하게 만든다 — 12시 방향에서 코어를 때리는 몬스터가 코어
   * 그림에 완전히 가려져 안 보이던 문제(실제 제보)에 대한 대응이다. 판정은
   * "지금 사각지대가 비었는지"만 매번 새로 계산하고, 상태가 실제로 바뀔 때만
   * 트윈을 새로 건다(매 스냅샷 다시 걸면 트윈이 끊겨 흐려지다 마는 것처럼 보인다).
   */
  private updateCoreBlindZone(monsters: MonsterView[]): void {
    if (!this.core) return;

    const occupied = monsters.some(
      (monster) =>
        Math.abs(monster.x) <= CORE_BLIND_ZONE_HALF_WIDTH &&
        monster.y >= CORE_BLIND_ZONE_NORTH &&
        monster.y <= CORE_BLIND_ZONE_SOUTH,
    );
    if (occupied === this.coreBlindZoneOccupied) return;
    this.coreBlindZoneOccupied = occupied;

    const body = this.core.getByName('body');
    if (!(body instanceof Phaser.GameObjects.Sprite || body instanceof Phaser.GameObjects.Rectangle))
      return;

    this.scene.tweens.killTweensOf(body);
    this.scene.tweens.add({
      targets: body,
      alpha: occupied ? CORE_FADE_ALPHA : 1,
      duration: CORE_FADE_TWEEN_MS,
    });
  }

  /** 반짝임 타이머. 매 프레임 호출된다(sync가 아니라 update 쪽 흐름). */
  private tickCoreGlint(deltaMs: number): void {
    const glint = this.core?.getByName('glint');
    if (!(glint instanceof Phaser.GameObjects.Sprite)) return;

    this.glintTimer -= deltaMs;
    if (this.glintTimer > 0 || glint.anims.isPlaying) return;

    // 간격을 매번 조금씩 다르게 준다 — 정확히 일정하면 기계처럼 보인다.
    this.glintTimer =
      CORE_GLINT_MIN_GAP_MS + Math.random() * (CORE_GLINT_MAX_GAP_MS - CORE_GLINT_MIN_GAP_MS);
    glint.setVisible(true);
    glint.play(CORE_GLINT_ANIM);
  }

  private playCoreUpgrade(): void {
    const burst = this.core?.getByName('upgrade');
    if (!(burst instanceof Phaser.GameObjects.Sprite)) return;
    burst.setVisible(true);
    burst.play(CORE_UPGRADE_ANIM);
  }

  private createCore(): Phaser.GameObjects.Container {
    const hasSprite =
      this.scene.textures.exists(GAME_ATLAS) && this.scene.textures.get(GAME_ATLAS).has(CORE_FRAME);

    const body: Phaser.GameObjects.GameObject = hasSprite
      ? this.scene.add
          .sprite(0, 0, GAME_ATLAS, CORE_FRAME)
          .setOrigin(0.5, CORE_ORIGIN_Y)
          .setScale(CORE_SCALE)
          .setName('body')
      : this.scene.add
          .rectangle(0, 0, CORE_PLACEHOLDER_SIZE, CORE_PLACEHOLDER_SIZE, CORE_PLACEHOLDER_FILL)
          .setStrokeStyle(1, CORE_PLACEHOLDER_STROKE)
          .setName('body');

    const parts: Phaser.GameObjects.GameObject[] = [body];

    // 이펙트는 수정 자리에 얹는다. 스프라이트 안 좌표를 컨테이너 좌표로 옮기려면
    // 원점(0.5, CORE_ORIGIN_Y)만큼 빼고 배율을 곱하면 된다.
    if (hasSprite) {
      const crystalX = (CORE_CRYSTAL.x - CORE_SPRITE_SIZE * 0.5) * CORE_SCALE;
      const crystalY = (CORE_CRYSTAL.y - CORE_SPRITE_SIZE * CORE_ORIGIN_Y) * CORE_SCALE;

      // 밝기 맥동: 코어 그림을 한 장 더 얹되 **수정 부분만 잘라내** 가산 합성한다.
      // 잘라내기는 위치를 바꾸지 않으므로 본체와 정확히 겹친다 — 그래서 좌표 계산이
      // 따로 필요 없다.
      const pulse = this.scene.add
        .sprite(0, 0, GAME_ATLAS, CORE_FRAME)
        .setOrigin(0.5, CORE_ORIGIN_Y)
        .setScale(CORE_SCALE)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setAlpha(CORE_PULSE_MIN_ALPHA)
        .setName('pulse');
      pulse.setCrop(
        CORE_CRYSTAL_CROP.x,
        CORE_CRYSTAL_CROP.y,
        CORE_CRYSTAL_CROP.width,
        CORE_CRYSTAL_CROP.height,
      );
      parts.push(pulse);

      this.scene.tweens.add({
        targets: pulse,
        alpha: CORE_PULSE_MAX_ALPHA,
        duration: CORE_PULSE_DURATION_MS,
        ease: 'Sine.easeInOut',
        yoyo: true,
        repeat: -1,
      });

      if (this.scene.anims.exists(CORE_GLINT_ANIM)) {
        parts.push(
          this.scene.add
            .sprite(crystalX, crystalY, GAME_ATLAS, `${CORE_GLINT_PREFIX}0`)
            .setScale(CORE_SCALE * CORE_GLINT_SCALE_RATIO)
            .setVisible(false)
            .setName('glint'),
        );
      }
      if (this.scene.anims.exists(CORE_UPGRADE_ANIM)) {
        parts.push(
          this.scene.add
            .sprite(crystalX, crystalY, GAME_ATLAS, `${CORE_UPGRADE_PREFIX}0`)
            .setScale(CORE_SCALE * CORE_UPGRADE_SCALE_RATIO)
            .setVisible(false)
            .setName('upgrade'),
        );
      }
    }

    const container = this.scene.add.container(0, 0, parts);
    // 다른 물체와 같은 깊이 규칙. 코어는 원점에 있으므로 y=0이다.
    container.setDepth(0);

    // 이펙트는 한 번 재생하고 숨는다 — 마지막 프레임이 남아 있으면 잔상이 된다.
    for (const name of ['glint', 'upgrade']) {
      const fx = container.getByName(name);
      if (fx instanceof Phaser.GameObjects.Sprite) {
        fx.on(Phaser.Animations.Events.ANIMATION_COMPLETE, () => fx.setVisible(false));
      }
    }
    return container;
  }

  private registerCoreAnimations(): void {
    if (!this.scene.textures.exists(GAME_ATLAS)) return;
    const texture = this.scene.textures.get(GAME_ATLAS);

    for (const [key, prefix, frames, frameRate] of [
      [CORE_GLINT_ANIM, CORE_GLINT_PREFIX, CORE_GLINT_FRAMES, CORE_GLINT_RATE],
      [CORE_UPGRADE_ANIM, CORE_UPGRADE_PREFIX, CORE_UPGRADE_FRAMES, CORE_UPGRADE_RATE],
    ] as const) {
      if (this.scene.anims.exists(key)) continue;
      if (!texture.has(`${prefix}0`)) continue;
      this.scene.anims.create({
        key,
        frames: this.scene.anims.generateFrameNames(GAME_ATLAS, { prefix, start: 0, end: frames - 1 }),
        frameRate,
        repeat: 0,
      });
    }
  }

  private registerGatherAnimations(): void {
    if (!this.scene.textures.exists(GAME_ATLAS)) return;

    if (
      !this.scene.anims.exists(HURT_FX_ANIM) &&
      this.scene.textures.get(GAME_ATLAS).has(`${HURT_FX_PREFIX}0`)
    ) {
      this.scene.anims.create({
        key: HURT_FX_ANIM,
        frames: this.scene.anims.generateFrameNames(GAME_ATLAS, {
          prefix: HURT_FX_PREFIX,
          start: 0,
          end: HURT_FX_FRAMES - 1,
        }),
        frameRate: HURT_FX_RATE,
        repeat: 0,
      });
    }

    if (
      !this.scene.anims.exists(LEVEL_UP_ANIM) &&
      this.scene.textures.get(GAME_ATLAS).has(`${LEVEL_UP_PREFIX}0`)
    ) {
      this.scene.anims.create({
        key: LEVEL_UP_ANIM,
        frames: this.scene.anims.generateFrameNames(GAME_ATLAS, {
          prefix: LEVEL_UP_PREFIX,
          start: 0,
          end: LEVEL_UP_FRAMES - 1,
        }),
        frameRate: LEVEL_UP_RATE,
        repeat: 0,
      });
    }

    for (const fx of Object.values(USE_FX_ANIMS)) {
      if (this.scene.anims.exists(fx.anim)) continue;
      if (!this.scene.textures.get(GAME_ATLAS).has(`${fx.prefix}0`)) continue;
      this.scene.anims.create({
        key: fx.anim,
        frames: this.scene.anims.generateFrameNames(GAME_ATLAS, {
          prefix: fx.prefix,
          start: 0,
          end: fx.frames - 1,
        }),
        frameRate: fx.rate,
        repeat: 0,
      });
    }

    for (const fx of Object.values(GATHER_FX)) {
      if (this.scene.anims.exists(fx.anim)) continue;
      if (!this.scene.textures.get(GAME_ATLAS).has(`${fx.prefix}0`)) continue;
      this.scene.anims.create({
        key: fx.anim,
        frames: this.scene.anims.generateFrameNames(GAME_ATLAS, {
          prefix: fx.prefix,
          start: 0,
          end: GATHER_FX_FRAMES - 1,
        }),
        frameRate: GATHER_FX_RATE,
        repeat: 0,
      });
    }
  }

  /** 노드 타격 연출: 종류별 파편 이펙트 + 몸통이 미세하고 빠르게 흔들린다. */
  private playNodeHit(node: ResourceNodeView, body: Phaser.GameObjects.Sprite | null): void {
    const fx = GATHER_FX[node.type];
    if (fx && this.scene.anims.exists(fx.anim)) {
      const burst = this.scene.add
        .sprite(node.x, node.y + fx.offsetY, GAME_ATLAS, `${fx.prefix}0`)
        .setDepth(node.y + 1);
      burst.play(fx.anim);
      burst.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => burst.destroy());
    }

    if (body && !this.scene.tweens.isTweening(body)) {
      // yoyo 왕복 두 번 — 전체 180ms짜리 짧은 진동이다. 컨테이너가 아니라 자식 스프라이트를
      // 흔들어야 HP 바까지 같이 떨리지 않는다.
      this.scene.tweens.add({
        targets: body,
        x: { from: 0, to: SHAKE_PIXELS },
        duration: SHAKE_DURATION_MS,
        yoyo: true,
        repeat: 1,
        onComplete: () => body.setX(0),
      });
    }
  }

  /** 남은 체력 비율로 파손 단계를 고른다. 단계가 하나뿐인 자원은 항상 그 프레임이다. */
  private resourceFrame(node: ResourceNodeView): string | null {
    const stages = RESOURCE_STAGES[node.type];
    if (!stages || !this.scene.textures.exists(GAME_ATLAS)) return null;
    if (!this.scene.textures.get(GAME_ATLAS).has(stages[0][1])) return null;

    const ratio = node.maxHp > 0 ? Math.max(0, node.hp) / node.maxHp : 1;
    for (const [threshold, frame] of stages) {
      if (ratio >= threshold) return frame;
    }
    return stages[stages.length - 1][1];
  }

  private createResourceNode(node: ResourceNodeView): Phaser.GameObjects.Container {
    const frame = this.resourceFrame(node);
    if (frame) {
      // 접지선을 캐릭터와 같은 규칙(발밑)으로 둔다 — 바닥에 박혀 있는 것처럼 보인다.
      const body = this.scene.add
        .sprite(0, 0, GAME_ATLAS, frame)
        .setOrigin(0.5, PLAYER_ORIGIN_Y)
        .setName('body');
      return this.scene.add.container(node.x, node.y, [body]);
    }

    return this.createResourceNodePlaceholder(node);
  }

  private createResourceNodePlaceholder(node: ResourceNodeView): Phaser.GameObjects.Container {
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

    // 같은 타입 건축물의 셀 집합. 방향(가로/세로) 선택에 쓴다.
    const occupied = new Set<string>();
    for (const building of views) {
      const cell = worldToCell(building.x, building.y);
      occupied.add(`${building.type}:${cell.cx},${cell.cy}`);
    }

    for (const building of views) {
      alive.add(building.id);

      let sprite = this.buildings.get(building.id);
      if (!sprite) {
        sprite = this.createBuilding(building);
        this.buildings.set(building.id, sprite);
      }

      // 접지선이 셀 아래변에 있으므로 깊이도 아래변 기준이라야 캐릭터(발밑 기준)와
      // 앞뒤가 맞는다.
      sprite.setDepth(building.y + TILE_SIZE / 2);
      this.applyBuildingOrientation(sprite, building, occupied);

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

  /**
   * 이웃 배치를 보고 가로/세로 스프라이트의 표시 여부를 정한다.
   *
   * 코너·T자 전용 아트를 만드는 대신 **두 방향을 겹쳐 그린다** — 좌우 이웃이 있으면
   * 가로를, 상하 이웃이 있으면 세로를 켠다. 교차 칸(코너/T/십자)은 둘 다 켜져서
   * 두 줄이 그 칸에서 자연스럽게 만난다. 한 방향만 고르면 다른 쪽 줄이 교차 칸에
   * 닿지 못하고 끊겨 보인다(실제로 세로 줄 위에 가로 줄을 설치하면 그랬다).
   *
   * 새 건축물이 옆에 붙으면 기존 것의 표시도 바뀌므로 매 동기화마다 다시 판정한다.
   */
  private applyBuildingOrientation(
    container: Phaser.GameObjects.Container,
    building: BuildingView,
    occupied: Set<string>,
  ): void {
    const bodyH = container.getByName('bodyH');
    const bodyV = container.getByName('bodyV');
    if (!(bodyH instanceof Phaser.GameObjects.Sprite)) return;
    if (!(bodyV instanceof Phaser.GameObjects.Sprite)) return;

    const cell = worldToCell(building.x, building.y);
    const has = (dx: number, dy: number) =>
      occupied.has(`${building.type}:${cell.cx + dx},${cell.cy + dy}`);

    const horizontal = has(-1, 0) || has(1, 0);
    const vertical = has(0, -1) || has(0, 1);

    // 혼자 서 있으면 가로가 기본이다 — 정면 뷰가 "이게 뭔지" 제일 잘 읽힌다.
    bodyH.setVisible(horizontal || !vertical);
    bodyV.setVisible(vertical);
  }

  private hasBuildingSprite(type: string): boolean {
    const frames = BUILDING_SPRITE[type];
    return (
      frames !== undefined &&
      this.scene.textures.exists(GAME_ATLAS) &&
      this.scene.textures.get(GAME_ATLAS).has(frames.h)
    );
  }

  private createBuilding(building: BuildingView): Phaser.GameObjects.Container {
    if (this.hasBuildingSprite(building.type)) {
      return this.createBuildingSprite(building);
    }

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

  // ---------------------------------------------------------------- 바닥 드롭

  private syncDroppedItems(views: DroppedItemView[]): void {
    const alive = new Set<string>();
    // 위아래로 살짝 흔든다 — 바닥 무늬에 섞이지 않고 "주울 수 있는 것"으로 읽힌다.
    const bob =
      Math.sin((this.dropBobElapsed / DROP_BOB_PERIOD_MS) * Math.PI * 2) * DROP_BOB_PIXELS;

    for (const drop of views) {
      alive.add(drop.id);

      let sprite = this.droppedItems.get(drop.id);
      if (!sprite) {
        sprite = this.createDroppedItem(drop);
        this.droppedItems.set(drop.id, sprite);
      }

      sprite.setPosition(Math.round(drop.x), Math.round(drop.y) + Math.round(bob));
      sprite.setDepth(drop.y);

      const count = sprite.getByName('count');
      if (count instanceof Phaser.GameObjects.Text) {
        // 1개짜리는 숫자를 안 띄운다 — 항상 "1"이면 정보가 아니라 잡음이다.
        count.setText(drop.count > 1 ? String(drop.count) : '');
      }
    }

    this.removeMissing(this.droppedItems, alive);
  }

  private createDroppedItem(drop: DroppedItemView): Phaser.GameObjects.Container {
    // 바닥 드롭과 UI 아이콘은 같은 표를 본다(itemSprite.ts).
    const frame = itemFrame(drop.itemId);
    const hasFrame =
      frame !== undefined &&
      this.scene.textures.exists(GAME_ATLAS) &&
      this.scene.textures.get(GAME_ATLAS).has(frame);

    const sprite = hasFrame ? this.scene.add.sprite(0, 0, GAME_ATLAS, frame) : null;
    if (sprite) sprite.setScale(DROP_SIZE / Math.max(sprite.width, sprite.height));

    const body: Phaser.GameObjects.GameObject =
      sprite ?? this.scene.add.rectangle(0, 0, 8, 8, 0xd2ae76).setStrokeStyle(1, 0x1a1c23);

    const count = this.scene.add
      .text(6, 4, '', { fontFamily: FONT_SMALL, fontSize: `${SIZE_SMALL}px`, color: '#f2f5fa' })
      .setOrigin(0.5, 0.5)
      .setName('count');
    applyTextShadow(count);

    return this.scene.add.container(drop.x, drop.y, [body, count]);
  }

  // ---------------------------------------------------------------- 콜로니

  private syncColonies(views: ColonyView[]): void {
    const alive = new Set<string>();

    for (const colony of views) {
      alive.add(colony.id);

      let sprite = this.colonies.get(colony.id);
      if (!sprite) {
        sprite = this.createColony(colony);
        this.colonies.set(colony.id, sprite);
      }

      sprite.setDepth(colony.y);
      // 정화돼도 구조물은 남는다(colony.ts) — 빈 껍데기는 흐리게, 단계가 오를수록
      // 크게 그려서 위협도를 한눈에 보이게 한다. 저장분은 위에 숫자로 띄운다.
      sprite.setAlpha(colony.purified ? 0.4 : 1);
      sprite.setScale(1 + (colony.stage - 1) * 0.18);
      const label = sprite.getByName('stored') as Phaser.GameObjects.Text | null;
      label?.setText(colony.purified ? '' : `${colony.stored}`);
    }

    this.removeMissing(this.colonies, alive);
  }

  private createColony(colony: ColonyView): Phaser.GameObjects.Container {
    // 저장된 몬스터 수. "얼마나 키워졌나/얼마나 남았나"가 정화 판단의 핵심 정보라
    // 월드에 바로 띄운다 — 두 생성 경로(스프라이트/도형)가 같은 이름표를 공유한다.
    const stored = this.scene.add
      .text(0, -COLONY_SIZE - 4, '', {
        fontFamily: FONT_SMALL,
        fontSize: `${SIZE_SMALL}px`,
        color: '#d9b8f2',
      })
      .setOrigin(0.5, 1)
      .setName('stored');
    applyTextShadow(stored);

    // 스프라이트가 있으면 쓴다. 원본이 125x128이라 타일 격자에 맞게 줄이고, 접지선을
    // 캐릭터와 같은 규칙(발밑)으로 둔다.
    if (this.scene.textures.exists(GAME_ATLAS) && this.scene.textures.get(GAME_ATLAS).has(COLONY_FRAME)) {
      const sprite = this.scene.add
        .sprite(0, 0, GAME_ATLAS, COLONY_FRAME)
        .setOrigin(0.5, PLAYER_ORIGIN_Y)
        .setScale(COLONY_SCALE)
        .setName('body');
      return this.scene.add.container(colony.x, colony.y, [sprite, stored]);
    }

    const body = this.scene.add.rectangle(0, 0, COLONY_SIZE, COLONY_SIZE, COLONY_COLOR);
    body.setStrokeStyle(2, 0x1a1c23);
    return this.scene.add.container(colony.x, colony.y, [body, stored]);
  }

  // ---------------------------------------------------------------- 티모시(AI 동반자)

  /**
   * 방(팀)당 1마리라 코어처럼 diff-and-update 루프가 필요 없다.
   *
   * 방 설정으로 티모시를 껐으면(`absent`) 스프라이트를 아예 만들지 않는다 — 투명하게만
   * 두면 이름표와 말풍선이 빈 자리에 계속 떠 있다.
   */
  private syncCompanion(view: CompanionView): void {
    if (view.state === 'absent') return;
    if (!this.companion) {
      this.companion = this.createCompanion(view);
    }
    const sprite = this.companion;

    sprite.setPosition(Math.round(view.x), Math.round(view.y));
    sprite.setDepth(view.y);
    // 다운되면 흐리게 — 플레이어 다운 표현과 같은 신호를 쓴다.
    sprite.setAlpha(view.state === 'downed' ? 0.35 : 1);

    if (this.hasCompanionSprite) this.updateCompanionSprite(sprite, view);
  }

  private createCompanion(view: CompanionView): Phaser.GameObjects.Container {
    const body: Phaser.GameObjects.GameObject = this.hasCompanionSprite
      ? this.scene.add
          .sprite(0, 0, GAME_ATLAS, idleFrame(COMPANION_SPRITE_JOB, 'front'))
          .setOrigin(0.5, PLAYER_ORIGIN_Y)
          .setTint(COMPANION_TINT)
          .setName('body')
      : this.scene.add
          .rectangle(0, 0, 12, 16, COMPANION_PLACEHOLDER_COLOR)
          .setStrokeStyle(1, 0x1a1c23)
          .setName('body');

    const labelY = this.hasCompanionSprite ? -LABEL_OFFSET_SPRITE : -LABEL_OFFSET_PLACEHOLDER;
    const label = this.scene.add
      .text(0, labelY, companionData.name, {
        fontFamily: FONT_SMALL,
        fontSize: `${LABEL_FONT_SIZE}px`,
        color: '#f2c14e',
      })
      .setOrigin(0.5, 1)
      .setName('label');
    label.setResolution(this.zoom);
    applyTextShadow(label);

    // 대사 말풍선. 이름표보다 한 칸 위, 평소엔 빈 텍스트라 자리를 차지하지 않는다
    // (showCompanionSpeech가 대사가 올 때만 채워 넣고 페이드아웃시킨다).
    const speech = this.scene.add
      .text(0, labelY - LABEL_FONT_SIZE - 2, '', {
        fontFamily: FONT_SMALL,
        fontSize: `${LABEL_FONT_SIZE}px`,
        color: '#f2f5fa',
        align: 'center',
        wordWrap: { width: 160 },
      })
      .setOrigin(0.5, 1)
      .setAlpha(0)
      .setName('speech');
    speech.setResolution(this.zoom);
    applyTextShadow(speech);

    /*
     * 손과 휘두르기 이펙트. **플레이어의 맨손 일습을 그대로** 붙인다 — 티모시는 도구
     * 없이 캐므로 주먹 배치(WEAPON_VISUALS.fist)가 그대로 맞고, 같은 layoutWeapon을
     * 쓰면 손 위치·좌우 반전 규칙을 두 벌로 관리하지 않아도 된다.
     */
    const parts: Phaser.GameObjects.GameObject[] = [body, label, speech];
    if (this.hasCompanionSprite && this.hasWeapon && this.hasHands) {
      parts.push(
        this.scene.add
          .sprite(0, 0, GAME_ATLAS, weaponVisual(BARE_HANDS_WEAPON_ID).frame)
          .setTint(COMPANION_TINT)
          .setName('aim'),
        ...HAND_NAMES.map((name) =>
          this.scene.add.sprite(0, 0, GAME_ATLAS, HAND_FRAME).setTint(COMPANION_TINT).setName(name),
        ),
      );
      if (this.hasSwing) {
        parts.push(
          this.scene.add
            .sprite(0, 0, GAME_ATLAS, `${SWING_ANIM}_0`)
            .setName('swingFx')
            .setVisible(false),
        );
      }
    }

    return this.scene.add.container(view.x, view.y, parts);
  }

  /**
   * 티모시가 새 대사를 말할 때 머리 위에 잠깐 띄운다(코어 AI 토스트와 달리 캐릭터
   * 본인 옆에 붙어 나온다 — "애정 가는 캐릭터"라는 목적에 맞춰 화면 상단이 아니라
   * 월드 안 캐릭터 옆에서 말하게 했다). 대사가 연달아 오면 진행 중인 페이드를
   * 취소하고 새로 띄운다(HudScene.showAiToast와 동일한 규칙).
   */
  showCompanionSpeech(text: string): void {
    const speech = this.companion?.getByName('speech') as Phaser.GameObjects.Text | null;
    if (!speech) return; // 아직 첫 스냅샷을 못 받아 컨테이너가 없으면 조용히 무시한다.

    this.scene.tweens.killTweensOf(speech);
    speech.setText(text).setAlpha(1);
    this.scene.tweens.add({
      targets: speech,
      alpha: 0,
      duration: 600,
      delay: 4000,
    });
  }

  /** 플레이어 채팅 한 줄을 그 사람 머리 위에 잠깐 띄운다. showCompanionSpeech와 동일한 규칙. */
  showPlayerSpeech(playerId: string, text: string): void {
    const container = this.players.get(playerId);
    const speech = container?.getByName('speech') as Phaser.GameObjects.Text | null;
    if (!speech) return; // 아직 그 플레이어 스프라이트가 없으면(늦게 스냅샷 도착 등) 조용히 무시한다.

    this.scene.tweens.killTweensOf(speech);
    speech.setText(text).setAlpha(1);
    this.scene.tweens.add({
      targets: speech,
      alpha: 0,
      duration: 600,
      delay: 4000,
    });
  }

  private updateCompanionSprite(container: Phaser.GameObjects.Container, view: CompanionView): void {
    const body = container.getByName('body');
    if (!(body instanceof Phaser.GameObjects.Sprite)) return;

    const angle = Math.atan2(view.facingY, view.facingX);
    const { direction, flipX } = directionFromAngle(angle);
    body.setFlipX(flipX);

    const moving = view.state === 'traveling' || view.state === 'returning';
    if (moving) {
      const key = walkAnimKey(COMPANION_SPRITE_JOB, direction);
      if (body.anims.currentAnim?.key !== key || !body.anims.isPlaying) body.play(key, true);
    } else {
      body.anims.stop();
      body.setFrame(idleFrame(COMPANION_SPRITE_JOB, direction));
    }

    /*
     * 캐는 중이면 손을 휘두른다. **끝나는 대로 다시 시작한다**(advanceCompanionSwing) —
     * 캐고 있다는 걸 한 번 휘두르고 마는 것으로는 알 수 없다. 예전엔 아무 동작도 없어서
     * 자원 앞에 가만히 서 있는 것처럼 보였다.
     */
    if (view.state === 'harvesting' && !this.companionSwing) {
      this.companionSwing = { elapsedMs: 0, fxPlayed: false };
    }

    const aim = container.getByName('aim');
    if (aim instanceof Phaser.GameObjects.Sprite) {
      const parts = this.readWeaponParts(container, aim);
      layoutWeapon(parts, this.visualOf(BARE_HANDS_WEAPON_ID), angle, this.companionSwing);
      orderWeaponAgainstBody(container, parts, angle);
    }
  }

  /**
   * 스프라이트 건축물. 에셋 규격(assets/README.md · docs/frontend/09):
   * 32x32 캔버스, 접지선은 아래에서 2px 위 — 캐릭터와 같은 원점(0.5, 0.94)을 쓰고,
   * 접지선을 셀의 아래변에 맞춘다. 그림은 위로 뻗어 위칸을 자연스럽게 침범한다.
   */
  private createBuildingSprite(building: BuildingView): Phaser.GameObjects.Container {
    const frames = BUILDING_SPRITE[building.type];

    // 가로/세로 스프라이트를 둘 다 만들어 두고 이웃 배치에 따라 켜고 끈다
    // (applyBuildingOrientation). 세로를 먼저 넣어 가로가 위에 그려진다.
    const bodyV = this.scene.add
      .sprite(0, TILE_SIZE / 2, GAME_ATLAS, frames.v)
      .setOrigin(0.5, PLAYER_ORIGIN_Y)
      .setName('bodyV')
      .setVisible(false);
    const body = this.scene.add
      .sprite(0, TILE_SIZE / 2, GAME_ATLAS, frames.h)
      .setOrigin(0.5, PLAYER_ORIGIN_Y)
      .setName('bodyH');

    // 그림이 셀 위로 뻗으므로 HP 바는 스프라이트 꼭대기보다 위에 둔다.
    const barTop = -TILE_SIZE - 6;
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

    const children: Phaser.GameObjects.GameObject[] = [barBack, bar, bodyV, body];

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
