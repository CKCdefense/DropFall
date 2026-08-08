import { MAP_ORIGIN, MAP_SIZE_TILES, TILE_SIZE, cellCenterWorld, worldToCell } from '../constants';
import {
  buildingsData,
  coloniesData,
  companionData,
  corePersonaData,
  chargeMaterialOf,
  chargingData,
  coreUpgradesData,
  craftingData,
  levelsData,
  xpToNextLevel,
  itemsData,
  jobStats,
  shopData,
  loadoutData,
  monstersData,
  resourcesData,
  wavesData,
  weaponsData,
  type BuildingType,
  type DropRange,
  type MeleeAttackData,
  type MeleeHitData,
  type MonsterData,
  type CoreUpgradeTier,
  type CraftRecipe,
  type ItemKind,
  type ItemRarity,
  type MonsterType,
  type ResourceType,
} from '../data';
import type { PlayerInputMessage } from '../protocol/messages';
import { FlowField, type FlowFieldGrid } from './ai/flowField';
import { BuildingRegistry, type BuildingEntity } from './building';
import {
  COLONY_RADIUS,
  ColonyRegistry,
  colonyStageData,
  maxColonyStage,
  type ColonyEntity,
} from './colony';
import { createCompanion, type CompanionEntity } from './companion';
import {
  applyPersonaEvent,
  createInitialPersonaTraits,
  type CorePersonaTraits,
  type PersonaEvent,
} from './corePersona';
import {
  applyCompanionPersonaEvent,
  createInitialCompanionTraits,
  type CompanionPersonaEvent,
  type CompanionPersonaEventKind,
  type CompanionPersonaTurn,
} from './companionPersona';
import {
  FULL_ARC,
  HIT_RADIUS,
  WeaponAmmo,
  WeaponCooldowns,
  angleDifference,
  circlesOverlap,
  projectileSweepHits,
  resolveFire,
  tickProjectiles,
  withinMeleeArc,
  type FireResult,
  type MeleeHit,
  type ProjectileEntity,
} from './combat';
import { Inventory, type InventorySlot } from './inventory';
import { CoreStorage, STORAGE_SLOT_COUNT } from './storage';
import { coreDistance, isWithinCoreInteract } from './coreShape';
import { ExploredMap } from './explored';
import { normalizeMoveVector, resolvePlayerMove } from './movement';
import {
  isPlayerBlocked,
  PLAYER_BUILDING_COLLISION_RADIUS,
  PLAYER_COLONY_COLLISION_RADIUS,
} from './playerCollision';
import { SpatialGrid } from './spatialGrid';
import { WaveManager, isBossType, type GamePhase } from './wave';
import { runDevCommand, type DevCommandResult, type DevWorldAccess } from './devCommands';

/** moveItem이 받는 컨테이너 이름. 네트워크 경계를 넘어오므로 값부터 검증한다. */
export type SlotContainer = 'inventory' | 'storage' | 'charge' | 'craft';

/** moveItem이 컨테이너에게 요구하는 최소한의 계약. 창고·인벤토리·충전 슬롯이 모두 만족한다. */
interface SlotAccess {
  takeAt(index: number): InventorySlot | null;
  placeAt(index: number, incoming: InventorySlot): InventorySlot | null;
}

/**
 * 건축물 종류 → 그것을 세우는 아이템. **items.json에서 거꾸로 만든다** — 손으로 적어 두면
 * 아이템이 늘 때 한쪽만 고쳐져 조용히 어긋난다(해머로 뜯었는데 아무것도 안 나온다).
 */
const BUILDING_ITEM_OF: Record<string, string> = Object.fromEntries(
  Object.entries(itemsData)
    .filter(([, item]) => item.buildingType !== undefined)
    .map(([itemId, item]) => [item.buildingType as string, itemId]),
);

function isContainerName(value: unknown): value is SlotContainer {
  return (
    value === 'inventory' || value === 'storage' || value === 'charge' || value === 'craft'
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * 몬스터의 원형 히트박스 반경(px). 타입마다 덩치가 다르므로 데이터에서 읽는다 —
 * 예전에는 전부 고정값(HIT_RADIUS)이라, 작은 몬스터는 몸에서 한참 떨어진 곳에서 맞고
 * 보스는 몸 안쪽까지 들어와야 맞았다.
 */
function monsterRadius(monster: MonsterEntity): number {
  return monstersData[monster.type]?.hitRadius ?? HIT_RADIUS;
}

const FLOW_FIELD_GRID: FlowFieldGrid = {
  widthInTiles: MAP_SIZE_TILES,
  heightInTiles: MAP_SIZE_TILES,
  tileSize: TILE_SIZE,
  originX: MAP_ORIGIN,
  originY: MAP_ORIGIN,
};
/**
 * 코어 충돌은 반경이 아니라 **8각 발자국**(coreShape.ts)으로 판정한다. 스프라이트가
 * 3/4 시점 다각형이라 원 하나로는 옆구리를 파고들거나 투명 픽셀까지 막는다 —
 * 모든 코어 거리 판정은 coreDistance() 하나를 쓴다.
 */

/**
 * 바닥 드롭을 주울 수 있는 반경(px). 캐릭터 반경보다 넉넉하게 잡아야 정확히 밟지 않아도
 * 주워진다 — 너무 넓으면 여러 개가 한 번에 사정권에 들어와 "주우러 다니는" 맛이 없어진다.
 */
/**
 * 드롭을 주울 수 있는 거리(px). 클라이언트도 같은 값으로 "지금 주울 게 있나"를 판정해야
 * 코어 앞에서 E가 창고를 열지 아이템을 줍을지 서버와 같은 결론을 낸다.
 */
export const PICKUP_RADIUS = 22;

/**
 * 아무것도 안 들었을 때 쓰는 기본 무기(weapons.json의 key). 손이 비었다고 아무것도
 * 못 하면 도구를 잃었을 때 할 수 있는 게 없어진다 — 대신 데미지가 매우 낮다.
 */
export const BARE_HANDS_WEAPON_ID = 'fist';

/**
 * 달리기(Shift). 스태미나를 태워 이동속도를 올린다 — 낮에 자원을 찾아 멀리 나가고,
 * 밤에 몰리면 빠져나오는 데 쓴다. 배율이 너무 높으면 걷기가 무의미해지고, 너무 낮으면
 * 스태미나를 쓸 이유가 없다.
 */
// export: 클라이언트 예측(PlayerPredictor)이 스프린트 입력을 즉시 반영하려면 서버와
// 같은 배율을 알아야 한다 — 값이 갈라지면 스프린트 중 매 프레임 되당김이 보인다.
export const SPRINT_SPEED_MULTIPLIER = 1.6;
/** 달리는 동안 초당 소모되는 스태미나. 기본 100이면 약 5초 전력질주다. */
const SPRINT_STAMINA_DRAIN = 20;
/** 걷거나 멈춰 있을 때 초당 회복량. 소모보다 느려야 "아껴 쓴다"는 판단이 생긴다. */
const STAMINA_REGEN = 12;
/**
 * 달리기를 멈춘 뒤 회복이 시작되기까지의 지연(초). 없으면 달리기·놓기를 반복해서
 * 사실상 무한히 달릴 수 있다.
 */
const STAMINA_REGEN_DELAY = 0.8;
/**
 * 자연 회복 속도(hp/초). "2초당 1"이라 아주 느리다 — 전투 중에 의미 있는 양이 아니라,
 * 밤을 넘기지 않고도 붕대 없이 조금씩 아무는 정도다. 다운(hp 0) 상태에서는 돌지 않는다:
 * 부활은 동료가 해야 하는 일이다(§revivePlayers).
 */
const HP_REGEN_PER_SECOND = 0.5;

/** 개발 커맨드로 몬스터를 부를 때 코어에서 띄우는 거리(px). 바로 옆에 붙여 놓으면 코어가 즉사한다. */
const DEV_SPAWN_RADIUS = 160;

/**
 * 공격 모션을 켜 두는 시간(초). 클라이언트는 이 값이 켜지는 **순간**(false→true)에
 * 공격 애니메이션을 한 번 재생한다 — 그래서 정확한 길이가 아니라 "네트워크로 그 전이가
 * 확실히 전달될 만큼"만 되면 된다. 20Hz 패치 기준 0.4초면 여덟 번쯤 실려 나간다.
 * 가장 짧은 공격 주기(0.8초)보다 짧아야 연속 공격이 한 번으로 뭉치지 않는다.
 */
const ATTACK_ANIM_SECONDS = 0.4;

/** 수호대가 콜로니 곁으로 "도착했다"고 보는 여유 거리(px). 충돌 반경 바로 바깥이다. */
const GUARD_HOME_ARRIVE_MARGIN = 10;
/** 이 거리보다 가까운 몬스터끼리는 서로 밀어낸다 — 군집 분리(기술명세 §5.3). */
const SEPARATION_RADIUS = HIT_RADIUS * 2.5;
/**
 * 몬스터 공간 분할 격자(SpatialGrid)의 칸 크기(px). `SEPARATION_RADIUS`(=25px)나
 * 흔한 투사체 히트 판정 반경보다 넉넉히 크게 잡아서, 질의 반경이 한두 칸 안에서
 * 끝나게 한다(너무 작으면 질의마다 훑는 칸 수가 늘어 이득이 줄어든다).
 */
const MONSTER_GRID_CELL_SIZE = 64;
/**
 * 몬스터 타입별 히트박스 반경(`monsterRadius`)의 최댓값. 그리드 질의 반경에 이 값을
 * 더해야, 큰(보스급) 몬스터가 질의 중심에서 격자 반경만큼 떨어져 있어도(중심은
 * 범위 밖이지만 몸이 걸치는 경우) 후보에서 빠뜨리지 않는다.
 */
const MAX_MONSTER_HIT_RADIUS = Math.max(
  HIT_RADIUS,
  ...Object.values(monstersData).map((data) => data.hitRadius ?? HIT_RADIUS),
);
/** 분리력이 주 이동 방향을 완전히 덮어쓰지 않도록 두는 가중치. */
const SEPARATION_WEIGHT = 0.6;
/** 한 번 잡은 어그로 타겟은 아그로 반경의 이 배수를 벗어나기 전까진 유지한다(타겟 떨림 방지). */
const AGGRO_LEASH_MULTIPLIER = 1.5;
/**
 * 몬스터가 완전히 자유롭게(폴백 없이) 움직이지 못한 채 이 시간(초) 이상 이어지면
 * 탈출 점프를 시도한다(docs/backend/42). 정상적인 장애물 모서리 우회(축 슬라이딩/
 * 접선 미끄러짐)는 보통 1초 안에 끝나므로, 그보다 살짝 여유를 둬서 정상 우회
 * 도중에 불필요하게 끼어들지 않게 한다.
 */
const STUCK_ESCAPE_SECONDS = 1.5;
/** 탈출 점프 거리(px) — 자원 노드/콜로니 키프아웃 반경보다 확실히 크게 잡아 한 번에 벗어나게 한다. */
const STUCK_ESCAPE_DISTANCE = 40;
/** 탈출 점프 각도 재시도 횟수. world.ts의 다른 배치 재시도(`pickClusterNodePosition` 등)와 같은 값. */
const STUCK_ESCAPE_ATTEMPTS = 8;
/**
 * 몬스터가 "처음" 플레이어를 발견할 때만 적용하는 시야각(120도, 바라보는 방향 기준 ±60도).
 * cos(60°)=0.5 — 내적(dot product)이 이 값 이상이면 시야각 안이다. atan2/acos 없이 내적
 * 하나로 판정할 수 있어 후보 플레이어 수만큼 곱셈 몇 번이면 끝난다(이미 거리 계산에 쓰는
 * hypot 외에 추가 삼각함수 호출이 없다).
 *
 * 한 번 타겟을 잡은 뒤(leash 유지 중)에는 이 조건을 다시 걸지 않는다 — 몬스터가 등 뒤로
 * 돌아간 플레이어를 갑자기 놓치면 오히려 더 부자연스럽다. "발견"에만 걸고 "추격 유지"엔
 * 안 거는 게 사람이 느끼기에도, 게임 로직으로도 자연스럽다.
 */
const AGGRO_FOV_COS_HALF_ANGLE = Math.cos(Math.PI / 3);
/**
 * 보스가 스폰된 직후 특수 패턴(돌진/광역)을 처음 쓸 수 있게 되기까지의 유예 시간(초).
 * 스폰하자마자 바로 예고 없이(사실은 예고가 있지만) 패턴을 쓰면 플레이어가 상황을
 * 파악하기도 전에 위협이 시작돼 불공평하게 느껴진다.
 */
const BOSS_FIRST_PATTERN_DELAY = 3;

/**
 * 자원 노드 배치(플레이스홀더, docs/backend/26). 한 지점에 몰아서 "군집"으로 배치한다 —
 * 낮 시간에 "저 방향에 나무숲/채석장이 있었지" 하고 기억해서 찾아가는 경험을 노린다.
 * 클러스터 중심은 코어를 기준으로 [MIN,MAX] 반경 띠 안에서 무작위로 고르고, 그 중심
 * 주변 `CLUSTER_JITTER_RADIUS` 안에 노드를 흩뿌린다. 총 개수(클러스터 수 × 클러스터당
 * 개수)는 기존 고정 원 배치(나무 10/돌 6)와 같게 맞췄다 — 이번 변경은 "어디에 있는지"만
 * 바꾸고 "얼마나 있는지"(밸런스)는 건드리지 않는다.
 */
const WOOD_CLUSTER_COUNT = 2;
const WOOD_NODES_PER_CLUSTER = 5;
const STONE_CLUSTER_COUNT = 2;
const STONE_NODES_PER_CLUSTER = 3;
/**
 * 클러스터 중심이 코어로부터 떨어져야 하는 최소/최대 거리(px). 맵 자체는 훨씬
 * 크지만(MAP_SIZE_TILES 기준 코어에서 최대 1024px), 그 전체를 다 쓰면 낮 시간
 * 안에 왕복하기엔 너무 멀다 — 밤 웨이브/콜로니 스폰 반경(900px, backend/35)
 * 안쪽으로만 좁혀서, 위험을 살짝 감수하는 정도의 거리로 맞췄다.
 *
 * 최소 거리는 **코어 업그레이드 전 기본 건설 가능 반경**(`coreUpgradesData.
 * baseBuildRadius`=250px, backend/38)보다 넉넉히 멀리 뒀다 — 안 그러면 자원
 * 군집이 코어 바로 코앞까지 파고들어서 건축은 물론 그냥 이동조차 불편해진다
 * (실제로 250 이하였을 때 이 문제가 보고됐다, docs/backend/39).
 */
const CLUSTER_MIN_DISTANCE = 260;
const CLUSTER_MAX_DISTANCE = 500;
/** 클러스터 중심 주변으로 노드가 흩어지는 반경(px). */
const CLUSTER_JITTER_RADIUS = 80;
/**
 * 같은 클러스터 안에서 노드끼리 이 거리보다 가깝게는 두지 않는다(완전히 겹치는 것
 * 방지). 자원 노드를 근접 타격 대상으로 바꾸면서 판정 반경(resourcesData.hitRadius,
 * 14px)에 맞춰 시각적으로도 커졌다 — 간격이 그보다 좁으면 옆 노드와 그림이 겹친다.
 */
const MIN_NODE_SPACING = 36;

export interface PlayerEntity {
  id: string;
  x: number;
  y: number;
  aimAngle: number;
  lastProcessedSeq: number;
  hp: number;

  /** 흔한 몬스터(잡몹/돌진/탱커) 처치로 받는 휴대 자원. 나무/돌과 동일하게 코어에
   * 입고(E)해야 팀 공유(coreSharedScrap)가 된다. */

  /** 퀵슬롯. 장착 무기도 여기서 나온다 — 클라이언트가 무기를 주장할 수 없다. */
  inventory: Inventory;
  /** 이번 틱에 몬스터에게 맞았는지. 매 틱 시작 시 초기화되고, damagePlayer()가 세팅한다. */
  tookDamageThisTick: boolean;

  /**
   * 고른 직업. 기초 스탯(체력·공격력·스태미나)이 여기서 나온다. 로비에서 정해지므로
   * 참가 시점엔 비어 있고, 게임이 시작될 때 호출자가 setPlayerJob으로 알려준다.
   */
  job: string;
  /** 남은 스태미나. 달리면 줄고 걷거나 멈추면 찬다. */
  stamina: number;
  /** 이번 틱에 달리기를 눌렀는가(입력). 실제로 달렸는지는 스태미나가 정한다. */
  sprinting: boolean;
  /** 달리기를 멈춘 뒤 회복이 시작되기까지 남은 시간(초). */
  staminaRegenDelay: number;
  /** 음식(도넛/당근케이크)으로 늘어난 최대 체력. 직업 기초 체력에 더해진다. */
  maxHpBonus: number;
  /**
   * 음식(너겟/라자냐)으로 쌓인 공격력. 직업 기초 공격력과 같은 축이라 **고정값**으로
   * 더한다 — 배율과 고정값을 섞으면 "공격력 스탯"이 무엇을 뜻하는지 화면에서 설명할
   * 수 없다(HUD에 숫자 하나로 나와야 한다).
   */
  attackFlatBonus: number;
  /** 음식(초콜릿/사과주스)으로 쌓인 이동속도 증가율의 합. 스태미나 게이지 도입 전의 해석. */
  staminaBonus: number;
  /** 진통제: 남은 시간(초) 동안 체력이 1 아래로 떨어지지 않는다. */
  hpFloorTimer: number;
  /** 아드레날린: 남은 시간(초) 동안 이동속도에 speedBuffMultiplier를 곱한다. */
  speedBuffTimer: number;
  speedBuffMultiplier: number;
  /** 점사 모드(돌격소총 전용 토글). burst 스펙이 없는 무기를 들면 무시된다. */
  burstMode: boolean;
  /**
   * 마지막으로 쓴 소모품의 종류(USE_FX). 이펙트를 무엇으로 틀지 클라이언트에 알린다.
   * 값이 남아 있어도 useFxSeq가 바뀌지 않으면 다시 재생하지 않는다.
   */
  useFxKind: number;
  /**
   * 소모품을 쓸 때마다 1씩 오르는 번호(255에서 0으로 되돌아간다).
   *
   * "지금 썼다"를 불리언으로 두면 20Hz 동기화에서 한 틱짜리 참을 놓쳐 이펙트가 통째로
   * 사라진다 — 몬스터 공격 애니메이션에서 겪은 것과 같은 문제(attackSeq)라 같은 해법을 쓴다.
   */
  useFxSeq: number;
  /** 만드는 중인 레시피 id(없으면 빈 문자열)와 남은 시간(초). */
  craftRecipeId: string;
  craftTimer: number;
  /**
   * 다 만들어 **꺼내 가기를 기다리는** 물건. 창고로 바로 밀어 넣지 않는 이유는,
   * 만든 사람이 결과를 눈으로 확인하고 직접 가져가야 "내가 만들었다"가 되기 때문이다.
   * 여기가 차 있으면 다음 제작을 걸 수 없다 — 덮어쓰면 앞의 결과가 사라진다.
   */
  craftOutput: InventorySlot | null;
  /** 레벨과 다음 레벨까지 쌓인 경험치. 경험치는 몬스터 처치로만 오른다. */
  level: number;
  xp: number;
  /** 아직 안 쓴 스탯 포인트. 레벨업 때마다 levelsData.spPerLevel만큼 쌓인다. */
  statPoints: number;
  /**
   * SP로 찍은 횟수. 스탯별로 나눠 두는 이유는 화면에 "무엇에 몇 점 썼는지"를 그대로
   * 보여줄 수 있어서다 — 합계 하나만 두면 되돌리기도 표시도 못 한다.
   */
  spentHp: number;
  spentAttack: number;
  spentStamina: number;
  /** 레벨이 오를 때마다 1씩 오르는 번호. 클라이언트가 레벨업 이펙트를 틀 신호다(useFxSeq와 같은 방식). */
  levelUpSeq: number;
}

/**
 * 소모품 사용 이펙트 종류. 서버가 무엇을 먹었는지 알고 클라이언트는 그림만 고르면 된다 —
 * 아이템 표를 클라이언트가 다시 읽어 분류하면 규칙이 두 벌이 된다.
 */
export const USE_FX = {
  none: 0,
  /** 치료(붕대·알약·AID): 초록 십자 회복 이펙트 */
  heal: 1,
  /** 일시 버프(진통제·아드레날린): 청록빛이 몸으로 모여든다 */
  buff: 2,
  /** 영구 스탯(음식): 금빛 화살표가 위로 솟는다 */
  statup: 3,
} as const;

export interface ResourceNodeEntity {
  id: string;
  type: ResourceType;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** 0이면 채집 가능(살아있음). 고갈되면 resourcesData[type].respawnSeconds로 세팅되고 매 틱 감소한다. */
  respawnTimer: number;
  /**
   * 이 노드가 속한 군집(클러스터) 중심 좌표. 리스폰될 때 같은 군집 안에서만 새
   * 위치를 고르기 위해 기억해 둔다 — x/y 자신은 리스폰마다 바뀌지만 이 값은
   * 노드가 존재하는 내내 고정이다.
   */
  clusterX: number;
  clusterY: number;
}

/**
 * 바닥에 떨어진 아이템. 자원 노드를 완전히 부수면 생긴다.
 *
 * 예전에는 노드를 부순 순간 채집자의 지갑에 자원이 꽂혔다. 드롭을 거쳐야 "부수는 일"과
 * "줍는 일"이 나뉘어서, 밤이 오면 못 주운 자원을 두고 도망칠지 같은 선택이 생긴다.
 */
export interface DroppedItemEntity {
  id: string;
  itemId: string;
  count: number;
  x: number;
  y: number;
}

/**
 * 보스 전용 특수 공격 패턴(돌진/광역)의 상태 머신. 일반 몹은 항상 `{ kind: 'idle' }`로
 * 고정이다 — `meleeAttacks` 데이터가 없는 타입은 `tickBossPattern`이
 * 첫 검사에서 바로 false를 반환하므로 이 상태를 실제로 오갈 일이 없다.
 *
 * idle → meleeSwing → meleeRecover → idle 순으로만 전이한다.
 * 예고(Telegraph) 상태의 값(방향/지점)은 예고 "시작 시점"에 한 번 고정된다 — 그래야
 * 화면에 미리 보여준 위험 범위와 실제로 피해가 들어가는 범위가 정확히 일치한다(타겟이
 * 예고 도중 움직여도 범위가 따라가면 "본 대로 피했는데 맞는" 상황이 생긴다).
 */
export type BossPatternState =
  | { kind: 'idle' }
  /**
   * 근접 검술 진행 중. 바닥 표시 없이 **동작 자체가 예고**라(무기를 치켜드는 프레임),
   * 클라이언트가 어느 동작을 재생할지 알 수 있게 `index`(meleeAttacks 배열 위치)를
   * 들고 있는다.
   *
   * 동작 하나가 타격 하나는 아니다 — 흑기사 1번 기술처럼 2연타가 있어서, 경과 시간
   * (`elapsed`)을 재면서 아직 안 터진 타격(`nextHit`)의 시점을 넘길 때마다 판정한다.
   */
  | {
      kind: 'meleeSwing';
      elapsed: number;
      index: number;
      nextHit: number;
      dirX: number;
      dirY: number;
      /** 돌진(dash)이 있는 기술에서 이미 쓸고 지나간 대상. 한 번의 돌진에 한 사람이
       * 여러 번 맞지 않게 한다(매 틱 판정하면 가만히 선 사람이 수십 번 맞는다). */
      dashHitIds: Set<string>;
      /** 돌진이 시작된 자리. 직사각형 판정이 "출발점부터 지금까지"를 덮으려면 필요하다. */
      dashOriginX?: number;
      dashOriginY?: number;
    }
  /** 판정 후 경직. 이 동안은 이동도 다음 공격도 없다 — 플레이어가 반격할 틈이다. */
  | { kind: 'meleeRecover'; timer: number }
  /**
   * 평타 예고. **모든 몬스터가 쓴다**(잡몹·보스 공통).
   *
   * 예전에는 사거리에 들어온 순간 곧바로 피해를 줬다 — 예고가 없으니 피할 방법이
   * 아예 없었고, 그림도 맞은 뒤에야 재생됐다. 이제 공격을 "시도"하면 이 상태로
   * 들어가 멈춰 서서 휘두르고, `timer`가 0이 되는 순간 **사거리를 다시 재서** 정산한다.
   * 그 사이 빠져나간 대상은 헛친다.
   */
  | { kind: 'basicSwing'; timer: number; target: BasicAttackTarget };

/** 평타가 노리는 대상. 예고가 끝나는 순간 이 대상이 아직 사거리 안인지 다시 잰다. */
export type BasicAttackTarget =
  | { kind: 'player'; id: string }
  | { kind: 'companion' }
  | { kind: 'building'; id: string }
  | { kind: 'core' };

export interface MonsterEntity {
  id: string;
  type: MonsterType;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  attackCooldown: number;
  /** 현재 추격 중인 플레이어 id(어그로 있는 타입만). 히스테리시스로 타겟을 유지하는 데 쓴다. */
  targetPlayerId?: string;
  /**
   * 바라보는 방향(단위 벡터). 이동/공격 로직이 이미 계산해 둔 방향 벡터를 그대로 재사용해서
   * 매 틱 갱신한다 — 새로 삼각함수를 호출하지 않는다. 시야각 기반 어그로 판정(§AGGRO_FOV)에 쓴다.
   */
  facingX: number;
  facingY: number;
  /** 보스 전용 특수 패턴 상태(§BossPatternState). 일반 몹은 항상 idle이다. */
  pattern: BossPatternState;
  /** 다음 특수 패턴을 쓸 수 있게 되기까지 남은 시간(초). meleeAttacks가 없는 타입은 쓰지 않는다. */
  specialAttackCooldown: number;
  /**
   * `moveMonster`가 이동을 전혀 못 시킨 채(축 슬라이딩·접선 미끄러짐까지 다 막힘)
   * 연속으로 흐른 시간(초). 이동에 성공하면 0으로 리셋된다. 자원 노드 여러 개가
   * 촘촘히 둘러싼 "주머니"에 갇히면 계속 쌓이는데, 임계값을 넘으면 탈출 점프를
   * 시도한다(docs/backend/42) — 이게 없으면 그런 위치에서 영원히 못 움직인다.
   */
  stuckSeconds: number;
  /**
   * 콜로니 수호대라면 소속 콜로니 id. 있으면 코어 침공 AI 대신 수호 AI를 탄다 —
   * 리시 반경 안의 플레이어만 공격하고, 아무도 없으면 콜로니로 귀환해 저장 상태로
   * 복귀한다(stored 복원). 웨이브/침공 복제 몬스터는 undefined다.
   */
  homeColonyId?: string;
  /** 수호대 전용: 콜로니 곁에 도착한 뒤 저장 상태로 복귀하기까지 누적된 대기(초). */
  guardReturnTimer: number;
  /**
   * 근접 검술별 남은 쿨다운(초). meleeAttacks 배열과 같은 순서다 — 기술마다 따로
   * 돌아야 "멀면 찌르기, 붙으면 내려치기"처럼 거리에 따라 다른 기술이 나온다.
   */
  meleeCooldowns: number[];
  /**
   * 지금 재생해야 할 공격 동작 번호(0=없음, 1~3=Attack01~03). 잡몹은 항상 1이고,
   * 검술이 여러 개인 보스만 값이 갈린다.
   */
  attackAnim: number;
  /**
   * 공격 모션이 남은 시간(초). 실제로 피해를 넣은 순간 ATTACK_ANIM_SECONDS로 채워지고
   * 매 틱 줄어든다. 전투 판정에는 전혀 쓰지 않는다 — 클라이언트가 공격 애니메이션을
   * 재생할 시점을 알려주기 위해서만 존재한다(그림 없이는 알 방법이 없다).
   */
  attackAnimTimer: number;
  /**
   * 공격을 시작할 때마다 1씩 오르는 번호. 클라이언트는 이 값이 **바뀌는 순간** 공격
   * 애니메이션을 재생한다.
   *
   * 예전엔 "공격 중인가"(attackAnimTimer > 0) 불리언의 false→true 전이만 보고 재생했는데,
   * 모션 길이(예고 0.36 + 0.4초)가 공격 주기(헬하운드 0.8초)와 거의 같아 **꺼져 있는
   * 구간이 40ms**밖에 안 됐다. 상태 동기화는 20Hz(50ms)라 그 창을 통째로 건너뛰면
   * 클라이언트 눈에는 플래그가 계속 켜져 있는 것처럼 보여서, 첫 공격 이후 모션이
   * 영영 재생되지 않았다(코어처럼 쉬지 않고 때리는 상황에서 실제로 그랬다).
   * 번호는 값이 달라진 사실만으로 판정되므로 샘플 타이밍과 무관하다.
   */
  attackSeq: number;
}

export interface CoreState {
  hp: number;
  maxHp: number;
  /**
   * 팀 전체가 공유하는 자원 창고. 플레이어 개인의 wood/stone은 "아직 코어에 입고하지
   * 않은, 손에 든" 양이고, 건축 비용은 여기(공유 자원)에서만 나간다 — 자원을 모아서
   * 함께 쓰는 협동 경험을 만들려는 의도다(자원채집 도구 도입에 맞춰 재설계, 이전엔
   * 채집 즉시 개인 지갑에 꽂혔었다).
   */
  /**
   * 팀 공용 창고. 예전의 sharedWood/sharedStone/sharedScrap 숫자 필드를 대체한다 —
   * 자원 종류가 늘 때마다 필드를 추가할 필요가 없고(몬스터 드랍이 그 예다), 도구도 같은
   * 방식으로 보관할 수 있다. 특정 재료 개수는 storage.countOf로 묻는다.
   */
  storage: CoreStorage;
  /**
   * 자원 게이지. 나무·돌을 **충전**해서 채우고 건축·제작·수리가 여기서 나간다.
   *
   * 창고에 든 나무 개수를 그대로 비용으로 쓰지 않는 이유는, 그러면 "무엇을 몇 개
   * 갖고 있나"가 곧 전력이 되어 창고 20칸이 사실상 상한이 되기 때문이다. 게이지로
   * 바꾸면 상한이 코어 강화로 자라고, 재료 종류가 늘어도 비용 표는 숫자 하나다.
   */
  resource: number;
  maxResource: number;
  /**
   * 에너지 게이지. 몬스터 드랍을 충전하거나 콜로니 정화·보스 처치로 채우고,
   * 코어 강화와 상점 구매가 여기서 나간다. 예전의 `money`(돈)를 대체한다 —
   * 돈과 에너지가 따로 있으면 "판 돈으로 산다"와 "모아서 강화한다"가 서로 무관해져서,
   * 밤에 번 것이 무엇에 쓰이는지가 두 갈래로 흩어졌다.
   */
  energy: number;
  maxEnergy: number;
  /**
   * 코어 충전 슬롯. 여기 올려둔 재료가 시간에 걸쳐 게이지로 바뀐다.
   * 게이지가 가득 차면 소화가 멈추고 재료는 슬롯에 그대로 남는다.
   */
  chargeSlots: (InventorySlot | null)[];
  /**
   * 구매한 코어 업그레이드 단계(0부터 시작, 미구매 상태). `coreUpgradesData.tiers[tier]`가
   * "다음에 살 단계"를 가리킨다 — `upgradeCore()`가 이 인덱스로 다음 단계 비용/보너스를
   * 조회한 뒤 tier를 1 늘린다.
   */
  tier: number;
  /**
   * 오늘의 상점 진열(아이템 id 목록). 낮이 시작될 때마다 새로 뽑는다 —
   * 고정 진열이면 "돈이 모이면 언젠가 다 산다"가 되어 그날그날의 선택이 사라진다.
   */
  shopStock: string[];
}

let nextMonsterId = 1;
let nextResourceNodeId = 1;
let nextBuildingId = 1;
let nextDropId = 1;

export interface WorldOptions {
  /** 자원 노드 군집 배치에 쓰는 RNG. 테스트에서 결정론적으로 검증하려고 주입한다(wave.ts와 동일 패턴). */
  rng?: () => number;
  /**
   * AI 동반자(티모시)를 둘지. 방을 만들 때 정하고 도중에 바뀌지 않는다 —
   * 게임이 시작된 뒤 티모시가 생기거나 사라지면 자원 수급과 어그로가 통째로 달라진다.
   * 기본값은 켬(기존 동작).
   */
  companion?: boolean;
}

export class World {
  private players = new Map<string, PlayerEntity>();
  private inputs = new Map<string, PlayerInputMessage>();
  private monsters = new Map<string, MonsterEntity>();
  /**
   * `monsters`와 항상 같은 내용을 담고 있어야 하는 공간 분할 인덱스(docs/backend/45).
   * 몬스터가 추가/제거/이동될 때마다(addMonster/damageMonster/moveMonster, monsters를
   * clear()하는 디버그 커맨드들) 같이 갱신한다 — 매 틱 통째로 다시 만들지 않고 계속
   * 살아있는 상태로 들고 가는 이유는 SpatialGrid 클래스 주석 참고.
   */
  private readonly monsterGrid = new SpatialGrid(MONSTER_GRID_CELL_SIZE);
  private projectiles = new Map<string, ProjectileEntity>();
  private readonly cooldowns = new WeaponCooldowns();
  private readonly ammo = new WeaponAmmo();
  /**
   * 진행 중인 점사(burst). 방아쇠 1번에 count발이 interval 간격으로 나가야 해서
   * 첫 발 이후의 나머지를 틱에서 예약 발사한다. 플레이어당 하나만 진행된다.
   */
  private readonly bursts = new Map<string, { weaponId: string; shotsLeft: number; timer: number }>();
  private readonly waveManager = new WaveManager({ playerCount: () => this.players.size });
  private readonly buildings = new BuildingRegistry();
  /** 코어 AI 페르소나 트레잇. 웨이브 종료/콜로니 파괴/코어 상호작용마다 조금씩 바뀐다. */
  private personaTraits: CorePersonaTraits = createInitialPersonaTraits();
  /** GameRoom이 매 틱 drainPersonaEvents()로 비워가는 큐 — LLM 호출은 여기서 하지 않는다
   * (shared/sim은 fetch 등 Node/DOM API를 쓸 수 없다, docs/02-tech-spec.md §2.1). */
  private pendingPersonaEvents: PersonaEvent[] = [];
  /** 코어 상호작용 트리거의 마지막 발생 시각(elapsedSeconds 기준). 스팸 방지 쿨다운에 쓴다. */
  private lastCoreInteractionAt = -Infinity;
  /** 티모시와 플레이어 사이의 관계 트레잇 — 방 전체가 아니라 플레이어 id별로 따로 쌓인다. */
  private companionTraits = new Map<string, CorePersonaTraits>();
  private pendingCompanionPersonaEvents: CompanionPersonaEvent[] = [];
  /** 티모시 대사(LLM 호출/브로드캐스트) 자체의 방 전역 마지막 발생 시각. 트레잇 누적과는
   * 별개다 — 누가 됐든 너무 자주 말하지 않게만 막는다. */
  private lastCompanionCommentaryAt = -Infinity;
  /** "@티모시 ..." 채팅 전용 쿨다운 시각. 위 잡담 쿨다운과 별개 풀이다(companionPersona.ts 참고). */
  private lastCompanionMessageAt = -Infinity;
  /** "@티모시 ..." 대화 기록 — 플레이어별로 최근 몇 마디만(historyMessageLimit) 세션 동안 들고 있다. */
  private companionConversations = new Map<string, CompanionPersonaTurn[]>();
  /**
   * 쿨다운 중에 들어온 "@티모시 ..." 질문을 버리지 않고 쌓아두는 큐. 쿨다운이 끝나는
   * 즉시(tick마다 확인) 가장 오래된 것부터 하나씩 꺼내 처리한다 — 연달아 두 번 물어보면
   * 두 번째가 조용히 씹히던 문제(실제로 겪음)를 이렇게 고쳤다. 무한정 쌓이지 않게
   * 개수를 제한한다(그래도 넘치면 그건 진짜 스팸으로 보고 거절한다).
   */
  private queuedCompanionMessages: { playerId: string; message: string }[] = [];
  private static readonly MAX_QUEUED_COMPANION_MESSAGES = 3;
  private readonly resourceNodes = new Map<string, ResourceNodeEntity>();
  private readonly droppedItems = new Map<string, DroppedItemEntity>();
  private readonly colonies = new ColonyRegistry();
  /**
   * 이번 밤의 콜로니 침공 복제분 대기열. 밤 시작에 buildNightContingents()가 만들고
   * tickContingents()가 콜로니 방향에서 무리 단위로 내보낸다. 다음 밤 시작에 통째로
   * 교체된다.
   */
  private readonly contingents: { x: number; y: number; queue: MonsterType[]; timer: number }[] =
    [];
  /**
   * AI 동반자("티모시"). 방(팀)당 1마리라 players/monsters처럼 Map으로 관리하지 않는다
   * (docs/superpowers/specs/2026-08-07-ai-companion-timothy-design.md). 코어는 항상
   * 원점(0,0)이라 스폰 위치도 생성자에서 바로 정할 수 있다 — startColonies처럼 인원수를
   * 기다릴 필요가 없다.
   */
  private companion: CompanionEntity = createCompanion(0, 0);

  /**
   * 충전 슬롯별 소수점 진행분. 틱마다 내림하면 60Hz에서 "초당 2개"가 매번 0개로
   * 잘려 영원히 아무것도 안 탄다 — 남는 몫을 여기 모아 둔다.
   */
  private readonly chargeProgress: number[] = Array.from(
    { length: chargingData.slotCount },
    () => 0,
  );

  /**
   * 티모시가 지금 "거기 있는가". 몬스터 표적·피해·수확·상호작용이 전부 이 하나를 본다.
   *
   * 예전엔 자리마다 `state !== 'downed'`를 직접 적었는데, 방 설정으로 끄는 기능이
   * 생기면서 확인할 것이 둘이 됐다. 한 곳이라도 빠지면 없는 티모시를 몬스터가 때리러
   * 가는 식으로 조용히 어긋난다.
   */
  private companionActive(): boolean {
    return this.companion.state !== 'downed' && this.companion.state !== 'absent';
  }
  /**
   * 콜로니가 차지한 그리드 셀("cx,cy" 키) 집합. 콜로니는 위치가 절대 안 바뀌고,
   * 정화돼도 구조물은 남으므로(재설계 후 "파괴" 개념이 없다) 배치 시점
   * (`startColonies`)에 한 번만 계산하면 판이 끝날 때까지 그대로다.
   * FlowField의 `isBlocked` 콜백이 여기 기록된 셀도 같이 막힌 것으로 본다.
   *
   * 코어 자신의 셀은 절대 여기 넣지 않는다 — FlowField의 목표(target) 셀이 막히면
   * `recompute()`가 전체 계산을 포기해버린다(치명적). 몬스터는 어차피
   * 발자국 가장자리에서 attackRange만큼 떨어져 멈춰 코어를 공격하므로 코어 셀까지 들어갈
   * 필요가 없어 막을 이유도 없다 — 코어의 플레이어/투사체 하드 충돌은 이 집합과
   * 무관하게 `isBlockedForPlayer`/`projectileHitsObstacle`이 원점 좌표로 직접 검사한다.
   */
  private readonly colonyObstacleCells = new Set<string>();
  /**
   * 자원 노드가 차지한 그리드 셀 집합. 콜로니와 달리 **위치도 존재 여부도 바뀐다**
   * — 고갈(hp 0)되면 더 이상 막지 않고, 리스폰될 때 같은 군집 안 새 위치로
   * 옮겨간다(docs/backend/39). 그래서 한 번만 캐싱하지 않고, 고갈/리스폰이 일어날
   * 때마다 `rebuildResourceObstacleCells()`로 통째로 다시 계산한다.
   */
  private readonly resourceObstacleCells = new Set<string>();
  private readonly rng: () => number;
  private readonly flowField = new FlowField(
    FLOW_FIELD_GRID,
    (cx, cy) =>
      this.buildings.isBlockedForMovement(cx, cy) ||
      this.colonyObstacleCells.has(`${cx},${cy}`) ||
      this.resourceObstacleCells.has(`${cx},${cy}`),
  );
  private readonly core: CoreState = {
    hp: wavesData.coreHp,
    maxHp: wavesData.coreHp,
    storage: new CoreStorage(),
    resource: 0,
    maxResource: coreUpgradesData.baseMaxResource,
    energy: 0,
    maxEnergy: coreUpgradesData.baseMaxEnergy,
    chargeSlots: Array.from({ length: chargingData.slotCount }, () => null),
    tier: coreUpgradesData.startTier,
    shopStock: [],
  };
  private elapsedSeconds = 0;
  /** 이번 낮 페이즈에 스킵 투표를 던진 플레이어 id 집합. 만장일치면 skipDay()를 부른다. */
  private skipVotes = new Set<string>();
  /** 팀이 밝힌 지역(explored.ts). 누가 봤든 전원이 공유한다. */
  private readonly explored = new ExploredMap();
  /**
   * 플레이어별로 마지막에 시야를 갱신한 칸. 같은 칸에 서 있는 동안은 다시 계산하지
   * 않는다 — 원형 시야 한 번이 ~450칸이라 매 틱 돌리면 낭비다.
   */
  private readonly lastRevealCell = new Map<string, number>();

  constructor(options: WorldOptions = {}) {
    this.rng = options.rng ?? Math.random;
    // 티모시를 끈 방에서는 'absent'로 세워 둔다. 이 상태는 게임 내내 바뀌지 않으므로
    // 이후 모든 판정이 companionActive() 하나로 걸러진다.
    if (options.companion === false) this.companion.state = 'absent';
    // 콜로니는 여기서 아직 안 만든다 — 접속 인원수가 몇 명일지는 생성 시점엔 알 수
    // 없다(서버는 로비가 끝나야 확정된다). 인원이 확정되면 호출자가 startColonies()를
    // 명시적으로 불러야 한다(docs/backend/41).
    this.seedResourceNodes();
    this.rebuildResourceObstacleCells();
    // 정적 장애물 표시가 끝난 뒤에 계산해야 최초 FlowField가 이미 이걸 반영한다.
    // 이 시점엔 콜로니가 없어 colonyObstacleCells도 비어 있다 — startColonies()가
    // 나중에 다시 계산한다.
    this.recomputeFlowField();

    // 도구는 개인이 아니라 팀 창고에서 시작한다 — 누가 무엇을 들지 정하는 것부터가
    // 협동의 첫 결정이다. 인원과 무관하게 한 세트만 들어간다.
    for (const entry of loadoutData.coreStorage) {
      this.core.storage.add(entry.itemId, entry.count);
    }

    // 게임은 낮으로 시작한다 — 첫날 진열도 여기서 뽑아둔다. 둘 다 콜로니(인원수)와
    // 무관하므로 startColonies()가 아니라 생성 시점에 정해진다.
    this.rollShopStock();
  }

  /**
   * 콜로니를 접속 인원수만큼(사분면당 최대 1개, 최대 4개) 무작위 배치한다
   * (docs/backend/41). `World` 생성 시점엔 인원을 몰라서 생성자가 아니라 이 메서드로
   * 분리했다 — 인원이 확정된 바로 그 시점에 호출자가 정확히 한 번 불러야 한다
   * (서버는 로비가 끝나 게임이 실제로 시작될 때, 로컬 모드는 유일한 플레이어를
   * 추가한 직후). 두 번 부르면 사분면당 1개 제약이 깨지므로 호출부가 책임진다.
   */
  startColonies(count: number): void {
    this.colonies.seed(count, this.rng);
    this.rebuildColonyObstacleCells();
    this.recomputeFlowField();
  }

  /**
   * 콜로니의 위치를 기준으로 차단 셀 집합을 계산한다. 배치(`startColonies`) 때 한 번이면
   * 된다 — 재설계 후 콜로니는 파괴되지 않아 존재 여부가 변하지 않는다.
   */
  private rebuildColonyObstacleCells(): void {
    this.colonyObstacleCells.clear();
    for (const colony of this.colonies.values()) {
      const { cx, cy } = worldToCell(colony.x, colony.y);
      this.colonyObstacleCells.add(`${cx},${cy}`);
    }
  }

  /**
   * 살아있는(hp>0) 자원 노드의 현재 위치를 기준으로 차단 셀 집합을 통째로 다시
   * 계산한다. 고갈/리스폰(위치 변경)이 일어날 때마다 호출해야 한다 — 콜로니와
   * 달리 캐싱만 해 두면 안 되는 이유(§resourceObstacleCells)를 그대로 반영한다.
   */
  private rebuildResourceObstacleCells(): void {
    this.resourceObstacleCells.clear();
    for (const node of this.resourceNodes.values()) {
      if (node.hp <= 0) continue; // 고갈되면 더 이상 막지 않는다
      const { cx, cy } = worldToCell(node.x, node.y);
      this.resourceObstacleCells.add(`${cx},${cy}`);
    }
  }

  addPlayer(id: string, x = 0, y = 0): void {
    const inventory = new Inventory();
    for (const entry of loadoutData.playerStarting) inventory.add(entry.itemId, entry.count);

    const stats = jobStats('');
    this.players.set(id, {
      id,
      x,
      y,
      aimAngle: 0,
      lastProcessedSeq: 0,
      hp: stats.maxHp,
      inventory,
      tookDamageThisTick: false,
      job: '',
      stamina: stats.maxStamina,
      sprinting: false,
      staminaRegenDelay: 0,
      maxHpBonus: 0,
      attackFlatBonus: 0,
      staminaBonus: 0,
      hpFloorTimer: 0,
      speedBuffTimer: 0,
      speedBuffMultiplier: 1,
      burstMode: false,
      useFxKind: USE_FX.none,
      useFxSeq: 0,
      craftRecipeId: '',
      craftTimer: 0,
      craftOutput: null,
      level: 1,
      xp: 0,
      statPoints: 0,
      spentHp: 0,
      spentAttack: 0,
      spentStamina: 0,
      levelUpSeq: 0,
    });
  }

  /**
   * 직업을 확정한다. 로비에서 고르므로 참가 시점엔 알 수 없다 — 게임이 시작될 때
   * 호출자가 정확히 한 번 알려준다. 체력·스태미나는 새 최대치로 가득 채운다(시작 전이다).
   */
  setPlayerJob(playerId: string, job: string): void {
    const player = this.players.get(playerId);
    if (!player) return;
    player.job = job;
    const stats = jobStats(job);
    player.hp = stats.maxHp + player.maxHpBonus;
    player.stamina = this.playerMaxStamina(player);
  }

  /**
   * 스태미나 소모·회복. **실제로 달리고 있을 때만** 탄다 — 제자리에서 Shift를 누르고
   * 있다고 줄면 플레이어는 이유를 알 수 없다.
   */
  private tickStamina(player: PlayerEntity, dtSeconds: number): void {
    const input = this.inputs.get(player.id);
    const moving = input !== undefined && (input.moveX !== 0 || input.moveY !== 0);
    const running = player.sprinting && moving && player.stamina > 0 && player.hp > 0;

    if (running) {
      player.stamina = Math.max(0, player.stamina - SPRINT_STAMINA_DRAIN * dtSeconds);
      player.staminaRegenDelay = STAMINA_REGEN_DELAY;
      return;
    }

    // 지연이 남아 있으면 먼저 깎고, **남은 시간만큼은 같은 틱에 회복시킨다** — 지연만
    // 깎고 끝내면 한 틱이 길 때(테스트의 큰 dt, 프레임 드랍) 그 틱의 회복이 통째로 증발한다.
    let seconds = dtSeconds;
    if (player.staminaRegenDelay > 0) {
      const spent = Math.min(player.staminaRegenDelay, seconds);
      player.staminaRegenDelay -= spent;
      seconds -= spent;
      if (seconds <= 0) return;
    }
    player.stamina = Math.min(
      this.playerMaxStamina(player),
      player.stamina + STAMINA_REGEN * seconds,
    );
  }

  /**
   * 아주 느린 자연 회복. 소수점을 그대로 들고 다닌다 — 정수로 깎아 저장하면 0.5씩
   * 오르는 값이 매 틱 버려져서 영영 차지 않는다(틱당 0.025hp).
   */
  private tickHpRegen(player: PlayerEntity, dtSeconds: number): void {
    if (player.hp <= 0) return; // 다운 상태는 동료가 일으켜야 한다
    const maxHp = this.playerMaxHp(player);
    if (player.hp >= maxHp) return;
    player.hp = Math.min(maxHp, player.hp + HP_REGEN_PER_SECOND * dtSeconds);
  }

  /** 직업 기초 체력 + 음식 보너스. 회복 상한·부활·HP바가 전부 이 값을 쓴다. */
  playerMaxHp(player: PlayerEntity): number {
    return (
      jobStats(player.job).maxHp +
      player.maxHpBonus +
      player.spentHp * levelsData.statPerPoint.maxHp
    );
  }

  /** 직업 기초 스태미나. 음식의 "스태미나" 보너스는 이동속도로 가고 최대치는 안 건드린다. */
  playerMaxStamina(player: PlayerEntity): number {
    return jobStats(player.job).maxStamina + player.spentStamina * levelsData.statPerPoint.stamina;
  }

  /**
   * 무기 데미지에 더해지는 고정 공격력. 직업 기초값 + 음식(너겟/라자냐)으로 쌓은 몫이다.
   * 배율(attackBonus)과 달리 약한 무기일수록 체감이 크다.
   */
  playerAttack(player: PlayerEntity): number {
    return (
      jobStats(player.job).attack +
      player.attackFlatBonus +
      player.spentAttack * levelsData.statPerPoint.attack
    );
  }

  // ---------------------------------------------------------------- 레벨/경험치

  /**
   * 경험치를 **살아 있는 모두**에게 나눠 준다(나누지 않고 같은 양을 각자 받는다).
   *
   * 막타를 친 사람만 주려면 투사체마다 쏜 사람을 실어 날라야 하고, 그 사람이 죽거나
   * 나가면 경험치가 증발한다. 무엇보다 드랍을 바닥에 떨어뜨린 것과 같은 이유다 —
   * 막타로 보상이 갈리면 협동이 아니라 킬 경쟁이 된다.
   *
   * 쓰러진 사람은 못 받는다. 뒤에 누워만 있어도 크는 건 곤란하다.
   */
  private grantXp(amount: number): void {
    if (amount <= 0) return;
    for (const player of this.players.values()) {
      if (player.hp <= 0) continue;
      player.xp += amount;
      // 한 번에 두 레벨이 오를 수도 있다(보스). while로 남는 경험치까지 흘려보낸다.
      while (player.xp >= xpToNextLevel(player.level)) {
        player.xp -= xpToNextLevel(player.level);
        player.level += 1;
        player.statPoints += levelsData.spPerLevel;
        player.levelUpSeq = (player.levelUpSeq + 1) % 256;
      }
      // 최대 레벨에서는 xpToNextLevel이 Infinity라 위 루프가 돌지 않는다 —
      // 그대로 두면 경험치만 무한히 쌓이므로 게이지가 가득 찬 상태로 고정한다.
      if (player.level >= levelsData.maxLevel) player.xp = 0;
    }
  }

  /**
   * 스탯 포인트를 하나 쓴다. 되돌릴 수는 없다 — 되돌리기를 넣으면 밤마다 최적으로
   * 갈아끼우는 게 정답이 되어 선택이 선택이 아니게 된다.
   *
   * 체력·스태미나는 최대치가 오른 만큼 현재치도 같이 채운다. 안 그러면 "찍었는데
   * 아무 일도 안 일어난다"로 보인다(음식의 최대 체력 증가와 같은 규칙).
   */
  spendStatPoint(playerId: string, stat: unknown): void {
    const player = this.players.get(playerId);
    if (!player || player.statPoints <= 0) return;
    if (stat !== 'maxHp' && stat !== 'attack' && stat !== 'stamina') return;

    player.statPoints -= 1;
    if (stat === 'maxHp') {
      player.spentHp += 1;
      player.hp = Math.min(this.playerMaxHp(player), player.hp + levelsData.statPerPoint.maxHp);
    } else if (stat === 'attack') {
      player.spentAttack += 1;
    } else {
      player.spentStamina += 1;
      player.stamina = Math.min(
        this.playerMaxStamina(player),
        player.stamina + levelsData.statPerPoint.stamina,
      );
    }
  }

  /**
   * 이동속도 배율 = 영구 스태미나 보너스 × 아드레날린 × 달리기.
   * 달리기는 **스태미나가 남아 있고 실제로 달리기를 누른 동안**에만 곱해진다.
   */
  playerSpeedMultiplier(player: PlayerEntity): number {
    const sprint = player.sprinting && player.stamina > 0 ? SPRINT_SPEED_MULTIPLIER : 1;
    return (
      (1 + player.staminaBonus) *
      (player.speedBuffTimer > 0 ? player.speedBuffMultiplier : 1) *
      sprint
    );
  }

  removePlayer(id: string): void {
    this.lastRevealCell.delete(id);
    this.players.delete(id);
    this.inputs.delete(id);
    this.cooldowns.removePlayer(id);
    this.ammo.removePlayer(id);
    this.bursts.delete(id);
    this.skipVotes.delete(id);
  }

  // 클라이언트 입력은 신뢰하지 않는다 — 서버 권위 모델의 경계에서 타입/범위를 강제한다.
  // 필드가 없거나 숫자가 아니면(NaN 포함) 통째로 무시한다 — 한 번이라도 NaN이 x/y에
  // 섞이면 이후 모든 tick에서 계속 NaN으로 오염되기 때문에 여기서 반드시 걸러야 한다.
  setInput(id: string, input: PlayerInputMessage): void {
    if (
      typeof input !== 'object' ||
      input === null ||
      !isFiniteNumber(input.seq) ||
      !isFiniteNumber(input.moveX) ||
      !isFiniteNumber(input.moveY) ||
      !isFiniteNumber(input.aimAngle)
    ) {
      return;
    }

    // 순서가 뒤바뀌었거나 중복된 입력은 버린다. 받아들이면 lastProcessedSeq가 되감기고,
    // 클라이언트가 이미 확정한 구간을 다시 재조정하면서 캐릭터가 튄다.
    const previous = this.inputs.get(id);
    if (previous && input.seq <= previous.seq) return;

    const { moveX, moveY } = normalizeMoveVector(input.moveX, input.moveY);
    this.inputs.set(id, {
      seq: input.seq,
      moveX,
      moveY,
      aimAngle: input.aimAngle,
    });
    // 달리기는 이동 입력과 달리 되감기 대상이 아니라 "지금 누르고 있나"라는 상태다 —
    // 순서가 뒤바뀐 입력에서도 마지막으로 받은 값을 그대로 쓴다.
    const player = this.players.get(id);
    if (player) player.sprinting = input.sprint === true;
  }

  /**
   * 퀵슬롯 선택. 잘못된 번호는 조용히 무시한다.
   * 선택만 바꾸는 동작이라 페이즈(낮/밤)와 무관하게 허용한다.
   */
  selectSlot(playerId: string, index: unknown): void {
    this.players.get(playerId)?.inventory.select(index);
  }

  /**
   * 선택 중인 소모품 사용. 효과 적용은 여기서 한다 — 인벤토리는 "무엇이 소모됐는지"만
   * 알려주고, 그게 게임 상태에 어떤 의미인지는 World가 결정한다.
   */
  useSelectedItem(playerId: string): void {
    const player = this.players.get(playerId);
    // 쓰러진 플레이어는 스스로 회복할 수 없다 — 부활은 동료가 해야 한다.
    if (!player || player.hp <= 0) return;

    const selected = player.inventory.itemOfSelected();
    if (!selected) return;

    // 효과가 없는 상황이면 **소모하지 않는다.** 체력이 가득인데 붕대만 날리는 일이
    // 없어야 한다 — 어떤 효과든 "지금 의미가 있는가"를 먼저 묻고 나서 꺼낸다.
    // 버프(진통제/아드레날린)·영구 스탯(음식)은 언제 써도 의미가 있어 검사하지 않는다.
    const maxHp = this.playerMaxHp(player);
    const heals = selected.healAmount !== undefined || selected.healPercent !== undefined;
    const hasBuffOrStat =
      selected.hpFloorSeconds !== undefined ||
      selected.speedMultiplier !== undefined ||
      selected.statBonus !== undefined;
    if (heals && !hasBuffOrStat && player.hp >= maxHp) return;
    if (selected.coreHealAmount !== undefined && this.core.hp >= this.core.maxHp) return;
    if (
      !heals &&
      !hasBuffOrStat &&
      selected.coreHealAmount === undefined &&
      selected.energyAmount === undefined
    ) {
      return; // 소모품이 아니다(무기·재료를 들고 있다)
    }

    const item = player.inventory.consumeSelected();
    if (!item) return;

    if (item.healAmount !== undefined) {
      player.hp = Math.min(maxHp, player.hp + item.healAmount);
    }
    if (item.healPercent !== undefined) {
      // 비율 회복은 최대 체력 기준이다 — 음식으로 최대치가 늘면 회복량도 같이 는다.
      player.hp = Math.min(maxHp, player.hp + Math.round(maxHp * item.healPercent));
    }
    if (item.hpFloorSeconds !== undefined) {
      // 겹쳐 쓰면 남은 시간과 새 시간 중 긴 쪽 — 더하기로 하면 쟁여놓고 연타해 사실상 무적이 된다.
      player.hpFloorTimer = Math.max(player.hpFloorTimer, item.hpFloorSeconds);
    }
    if (item.speedMultiplier !== undefined && item.speedSeconds !== undefined) {
      player.speedBuffMultiplier = item.speedMultiplier;
      player.speedBuffTimer = Math.max(player.speedBuffTimer, item.speedSeconds);
    }
    if (item.statBonus !== undefined) {
      if (item.statBonus.stat === 'maxHp') {
        player.maxHpBonus += item.statBonus.amount;
        // 최대치만 늘고 현재 체력이 그대로면 "먹었는데 체감이 없다" — 늘어난 만큼 같이 채운다.
        player.hp = Math.min(this.playerMaxHp(player), player.hp + item.statBonus.amount);
      } else if (item.statBonus.stat === 'attack') {
        player.attackFlatBonus += item.statBonus.amount;
      } else {
        player.staminaBonus += item.statBonus.amount;
      }
    }
    if (item.coreHealAmount !== undefined) {
      this.core.hp = Math.min(this.core.maxHp, this.core.hp + item.coreHealAmount);
    }
    if (item.energyAmount !== undefined) {
      this.addEnergy(item.energyAmount);
    }

    /*
     * 이펙트 종류를 정한다. **음식이 우선**이다 — 음식은 최대 체력이 늘면서 체력도 같이
     * 차므로 회복 조건에도 걸리는데, 도넛을 먹었을 때 보고 싶은 것은 "회복했다"가 아니라
     * "스탯이 올랐다"이다. 코어 회복·에너지처럼 내 몸에 아무 일도 안 일어나는 아이템은
     * 캐릭터 위에 띄울 그림이 없으니 none으로 둔다(이펙트를 안 튼다).
     */
    const kind =
      item.statBonus !== undefined
        ? USE_FX.statup
        : item.hpFloorSeconds !== undefined || item.speedMultiplier !== undefined
          ? USE_FX.buff
          : item.healAmount !== undefined || item.healPercent !== undefined
            ? USE_FX.heal
            : USE_FX.none;
    if (kind !== USE_FX.none) {
      player.useFxKind = kind;
      player.useFxSeq = (player.useFxSeq + 1) % 256;
    }
  }

  /**
   * 공격 요청 처리.
   *
   * 무기는 **서버가 인벤토리에서 읽는다** — 예전에는 클라이언트가 weaponId를 실어 보냈는데,
   * 그러면 갖고 있지도 않은 무기를 주장할 수 있었다. 클라이언트는 이제 "공격했다"는
   * 사실만 보낸다.
   */
  fireWeapon(playerId: string): void {
    const player = this.players.get(playerId);
    // 쓰러진 플레이어는 공격할 수 없다 — useSelectedItem과 같은 규칙(§668).
    if (!player || player.hp <= 0) return;
    // fireWeapon()은 tick()과 무관하게 아무 때나(발사 요청이 오는 즉시) 불릴 수 있다.
    // monsterGrid는 moveMonster()를 거칠 때만 점진적으로 갱신되는데, 몬스터 좌표가
    // moveMonster를 거치지 않고 직접 바뀌는 경로(테스트의 직접 대입, 향후 추가될
    // 수 있는 순간이동류 효과 등)가 있으면 그 사이 그리드가 낡을 수 있다 — 발사
    // 판정(근접/총구 간격) 직전에 한 번 다시 채워서 항상 정확한 상태로 쓴다. 몬스터
    // 수만큼(O(M))이라 비싸지 않다.
    this.rebuildMonsterGrid();

    // 무기를 안 들었으면 맨손이다. 붕대 같은 소모품을 들고 있을 때는 좌클릭이
    // "사용"이라 여기까지 오지 않는다(클라이언트가 useSlot으로 보낸다).
    const weaponId = player.inventory.equippedWeaponId ?? BARE_HANDS_WEAPON_ID;
    if (!this.cooldowns.canFire(playerId, weaponId, this.elapsedSeconds)) return;
    // 탄창 검사(원거리만 해당). 재장전 중이거나 빈 탄창이면 발사되지 않고, 빈 탄창은
    // 이 호출 안에서 자동 재장전이 시작된다. 쿨다운보다 뒤에 검사해야 실패한 시도가
    // 발사 주기를 밀어내지 않는다.
    if (!this.ammo.tryConsume(playerId, weaponId)) return;

    this.cooldowns.recordFire(playerId, weaponId, this.elapsedSeconds);
    this.fireOneShot(player, weaponId);

    // 점사 모드: 방아쇠 1번 = burst.count발. 첫 발은 방금 나갔고, 나머지는 틱에서
    // interval 간격으로 이어 쏜다(탄약은 발마다 소모).
    const weapon = weaponsData[weaponId];
    if (weapon?.burst && player.burstMode) {
      this.bursts.set(playerId, {
        weaponId,
        shotsLeft: weapon.burst.count - 1,
        timer: weapon.burst.interval,
      });
    }
  }

  /**
   * 한 발 발사의 공통 경로 — 즉시 발사(fireWeapon)와 점사 후속탄(tickBursts)이 같이 쓴다.
   * 음식으로 쌓은 공격력 보너스도 여기서 곱한다(근접·투사체·산탄 전부 일관되게).
   */
  private fireOneShot(player: PlayerEntity, weaponId: string): void {
    const result: FireResult = resolveFire({
      playerId: player.id,
      weaponId,
      x: player.x,
      y: player.y,
      aimAngle: player.aimAngle,
    });

    // 공격력 스탯은 **한 번의 공격**에 더한다. 산탄은 펠릿마다 더하면 6배로 불어나므로
    // 나눠 싣는다 — "한 발의 총 위력 = 무기 위력 + 공격력"이 어느 무기에서나 같아야 한다.
    //
    // 그런데 "한 발당 고정값"을 그대로 두면 연사속도(fireRate)가 빠른 무기일수록
    // 초당 챙기는 보너스가 커진다 — 스탯을 공격력에 몰빵하고 연사 무기를 들면 DPS가
    // 몇 배로 뛰어 보스가 무의미해지는 원인이었다(docs/backend 데모 준비도 리뷰 피드백
    // #1). fireRate로 나눠서 **초당 보너스**를 무기 종류와 무관하게 고정한다 — 위
    // 펠릿 나누기와 같은 원칙을 시간 축에도 적용한 것.
    const attack = this.playerAttack(player) / (weaponsData[weaponId]?.fireRate || 1);
    const pellets = result.projectiles?.length ?? 1;
    for (const projectile of result.projectiles ?? []) {
      projectile.damage += attack / pellets;
      // 총구가 플레이어 좌표에서 muzzleOffset만큼 떨어진 곳에서 "순간이동하듯" 생겨난다
      // (연출용 총구 위치 보정, backend/frontend 병합분). 그런데 몬스터가 그 사이
      // 간격(0~muzzleOffset)에 딱 붙어 있으면, 투사체가 몬스터를 지나친 자리에서
      // 시작해 버려서 조준이 정확해도 절대 맞힐 수 없었다(돌진형 몬스터가 근접
      // 사거리까지 파고든 뒤 총으로는 못 잡는 버그로 제보받음). 총구가 "생겨나기 전"
      // 그 간격을 지나가는 순간 몬스터가 있었을지를 먼저 검사해서, 있었으면 투사체를
      // 날리는 대신 그 자리에서 바로 맞힌 것으로 처리한다.
      if (!this.resolveMuzzleGapHit(player, projectile)) {
        this.projectiles.set(projectile.id, projectile);
      }
    }
    if (result.meleeHit) {
      result.meleeHit.damage += attack;
      this.applyMeleeHit(result.meleeHit);
      this.applyMeleeHitToResourceNode(player, result.meleeHit, weaponId);
      this.applyMeleeHitToRepair(result.meleeHit, weaponId);
      this.applyMeleeHitToBuilding(result.meleeHit, weaponId);
    }
  }

  /**
   * 해머로 때리면 건축물이 **수리된다.**
   *
   * 별도의 수리 모드나 키를 만들지 않은 이유는, 해머는 이미 "짓는 도구"라 벽을 향해
   * 휘두르는 동작이 곧 고치는 것으로 읽히기 때문이다. 다른 무기로는 아무 일도
   * 일어나지 않는다(아군 건축물은 원래 공격 대상이 아니다).
   *
   * 자원 노드와 같은 이유로 **가장 가까운 하나만** 고친다 — 한 번 휘둘러 벽 다섯 개가
   * 같이 차오르면 수리에 드는 자원이 의미를 잃는다.
   */
  private applyMeleeHitToRepair(hit: MeleeHit, weaponId: string): void {
    if (weaponsData[weaponId]?.toolFamily !== 'hammer') return;

    let target: BuildingEntity | undefined;
    let targetDistance = Infinity;
    for (const building of this.buildings.values()) {
      if (building.hp >= building.maxHp) continue; // 멀쩡한 건 건너뛴다
      if (!withinMeleeArc(hit, building.x, building.y, TILE_SIZE / 2)) continue;
      const distance = Math.hypot(building.x - hit.originX, building.y - hit.originY);
      if (distance >= targetDistance) continue;
      target = building;
      targetDistance = distance;
    }
    if (!target) return;

    const data = buildingsData[target.type];
    if (this.core.resource < data.repairCost) return;
    this.core.resource -= data.repairCost;
    target.hp = Math.min(target.maxHp, target.hp + data.repairPerHit);
  }

  /**
   * 근접 타격이 건축물을 부순다. 주먹이든 무기든 때리면 깎인다 — 잘못 세운 벽을
   * 치우려고 별도의 철거 모드를 켤 이유가 없어졌다(건축모드는 제거됐다).
   *
   * **해머만 아이템을 돌려준다.** 해머는 짓는 도구라 뜯어서 회수하는 게 자연스럽고,
   * 그 외 무기로 때려 부수면 부서진 것이니 남는 게 없다. 그래서 해머는 멀쩡한
   * 건축물을 **한 방에** 뜯는다 — 여러 번 때려야 하면 그 사이 타격이 수리로 읽혀
   * (§applyMeleeHitToRepair) 영원히 못 뜯는다.
   *
   * 자원 노드와 같은 이유로 **가장 가까운 하나만** 때린다.
   */
  private applyMeleeHitToBuilding(hit: MeleeHit, weaponId: string): void {
    const isHammer = weaponsData[weaponId]?.toolFamily === 'hammer';

    let target: BuildingEntity | undefined;
    let targetDistance = Infinity;
    for (const building of this.buildings.values()) {
      // 해머는 성한 것만 뜯는다. 상한 것은 수리 쪽이 가져간다.
      if (isHammer && building.hp < building.maxHp) continue;
      if (!withinMeleeArc(hit, building.x, building.y, TILE_SIZE / 2)) continue;
      const distance = Math.hypot(building.x - hit.originX, building.y - hit.originY);
      if (distance >= targetDistance) continue;
      target = building;
      targetDistance = distance;
    }
    if (!target) return;

    if (isHammer) {
      // 뜯은 자리에 아이템으로 떨군다 — 인벤토리가 꽉 차도 사라지지 않는다.
      const itemId = BUILDING_ITEM_OF[target.type];
      if (itemId) this.dropItem(itemId, 1, target.x, target.y);
      this.removeBuilding(target);
      return;
    }

    target.hp = Math.max(0, target.hp - hit.damage);
    if (target.hp <= 0) this.removeBuilding(target);
  }

  /** 건축물을 지우고 길찾기를 다시 계산한다. 부순 경로가 여럿이라 한 곳에 모았다. */
  private removeBuilding(building: BuildingEntity): void {
    this.buildings.remove(building.id);
    this.recomputeFlowField();
  }

  /** 진행 중인 점사의 후속탄을 발사한다. 무기를 바꾸거나 다운되면 남은 점사는 버린다. */
  private tickBursts(dtSeconds: number): void {
    for (const [playerId, burst] of this.bursts) {
      const player = this.players.get(playerId);
      const equipped = player?.inventory.equippedWeaponId ?? BARE_HANDS_WEAPON_ID;
      if (!player || player.hp <= 0 || equipped !== burst.weaponId) {
        this.bursts.delete(playerId);
        continue;
      }
      burst.timer -= dtSeconds;
      // 한 틱에 interval이 여러 번 지나도 발사는 틱당 한 발이면 충분하다(틱 50ms,
      // interval 70ms — 실제로 겹칠 일이 없고, 겹쳐도 다음 틱에 이어 쏜다).
      if (burst.timer > 0) continue;
      if (this.ammo.tryConsume(playerId, burst.weaponId)) {
        this.rebuildMonsterGrid();
        this.fireOneShot(player, burst.weaponId);
        burst.shotsLeft -= 1;
        burst.timer += weaponsData[burst.weaponId]?.burst?.interval ?? 0;
      } else {
        burst.shotsLeft = 0; // 탄이 떨어졌다 — 남은 점사는 없던 일로 하고 재장전에 맡긴다
      }
      if (burst.shotsLeft <= 0) this.bursts.delete(playerId);
    }
  }

  /** 수동 재장전(R). 장착 중인 원거리 무기가 대상이다. 가득이거나 이미 장전 중이면 무시. */
  reloadWeapon(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player || player.hp <= 0) return;
    const weaponId = player.inventory.equippedWeaponId;
    if (!weaponId) return;
    this.ammo.startReload(playerId, weaponId);
  }

  /**
   * 점사 모드 토글(돌격소총). burst 스펙이 있는 무기를 들고 있을 때만 뒤집는다 —
   * 아무 무기에서나 눌러 켜지면 나중에 돌격소총을 들었을 때 의도치 않게 점사가 된다.
   */
  toggleFireMode(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player) return;
    const weaponId = player.inventory.equippedWeaponId;
    if (!weaponId || !weaponsData[weaponId]?.burst) return;
    player.burstMode = !player.burstMode;
  }

  /** HUD 동기화용 탄약 조회. 근접/맨손이면 null. */
  ammoView(playerId: string): { loaded: number; magazine: number; reloadRemaining: number } | null {
    const player = this.players.get(playerId);
    if (!player) return null;
    const weaponId = player.inventory.equippedWeaponId ?? BARE_HANDS_WEAPON_ID;
    const weapon = weaponsData[weaponId];
    if (!weapon?.magazine) return null;
    const view = this.ammo.view(playerId, weaponId);
    if (!view) return null;
    return { loaded: view.loaded, magazine: weapon.magazine, reloadRemaining: view.reloadRemaining };
  }

  /**
   * 낮 스킵 투표. 만장일치(접속 중인 전원 동의) 방식이다(docs/backend/11 §4.1) — 협동
   * 게임에서 한 명이 일방적으로 스킵을 강요하지 못하게 한다. day 페이즈가 아니거나
   * 존재하지 않는 플레이어의 투표는 무시한다.
   */
  castSkipVote(playerId: string): void {
    if (this.waveManager.currentPhase !== 'day') return;
    const player = this.players.get(playerId);
    if (!player || player.hp <= 0) return;

    this.skipVotes.add(playerId);
    if (this.players.size > 0 && this.skipVotes.size >= this.players.size) {
      this.waveManager.skipDay();
      this.skipVotes.clear();
    }
  }

  /**
   * 근접 공격 하나가 자원 노드도 때렸는지 검사한다. `fireWeapon`에서 몬스터 판정
   * (`applyMeleeHit`)과 나란히 호출된다 — 몬스터 여러 마리를 한 번에 베는 것과 달리
   * 자원 노드는 **가장 가까운 것 하나만** 맞힌다(군집으로 뭉쳐 있어서 광역으로 여러
   * 노드를 한 스윙에 캐버리면 채집이 무의미해진다).
   *
   * `requiredTool`과 실제 장착 무기가 정확히 일치해야 데미지가 들어간다 — 도끼로는
   * 나무만, 곡괭이로는 돌만 캘 수 있다(자원채집 도구가 도입된 이후 처음으로 실제
   * 강제되는 규칙 — 예전엔 근접 무기 아무거나로도 "채집 요청"이 통과됐다).
   */
  private applyMeleeHitToResourceNode(player: PlayerEntity, hit: MeleeHit, weaponId: string): void {
    let target: ResourceNodeEntity | undefined;
    let targetDistance = Infinity;
    for (const node of this.resourceNodes.values()) {
      if (node.hp <= 0) continue;
      const data = resourcesData[node.type];
      // 티어가 올라도 계열은 같다 — 도끼 T1/T2/T3 모두 나무를 캔다.
      // 맨손(harvestsAny)은 종류를 안 가리는 대신 데미지가 매우 낮다.
      const weapon = weaponsData[weaponId];
      if (!weapon?.harvestsAny && data.requiredTool !== weapon?.toolFamily) continue;
      if (!withinMeleeArc(hit, node.x, node.y, data.hitRadius)) continue;
      const distance = Math.hypot(node.x - hit.originX, node.y - hit.originY);
      if (distance >= targetDistance) continue;
      target = node;
      targetDistance = distance;
    }
    if (!target) return;

    const data = resourcesData[target.type];
    // 채집 효율(gatherMultiplier)은 노드에만 적용된다 — 전투 데미지와 분리된 축이라
    // "효율 좋음" 도구가 몬스터까지 세게 때리지 않는다.
    const gather = weaponsData[weaponId]?.gatherMultiplier ?? 1;
    target.hp = Math.max(0, target.hp - hit.damage * gather);
    if (target.hp > 0) return;

    target.respawnTimer = data.respawnSeconds;
    // 고갈된 순간 그 자리는 더 이상 아무것도 막지 않는다("다 캐면 지나갈 수 있다",
    // docs/backend/39) — FlowField가 이 칸을 다시 열린 것으로 즉시 반영하게 한다.
    this.rebuildResourceObstacleCells();
    this.recomputeFlowField();

    // 부순 사람 지갑에 바로 꽂지 않고 바닥에 떨군다 — 줍는 행동이 따로 있어야
    // "부수기"와 "회수"가 분리된다. 자원 종류가 늘어도 분기 없이 데이터로 처리된다.
    this.dropItem(data.dropItemId, data.yieldOnDeplete, target.x, target.y);
  }

  /** 바닥에 아이템을 떨군다. 노드 파괴 외에 몬스터 드랍 등으로도 쓸 수 있다. */
  private dropItem(itemId: string, count: number, x: number, y: number): void {
    const id = `drop_${nextDropId++}`;
    this.droppedItems.set(id, { id, itemId, count, x, y });
  }

  /**
   * 근처 드롭을 줍는다(E). 반경 안에서 가장 가까운 것 하나만 줍는다 — 한 번에 바닥을
   * 쓸어담으면 "주우러 다니는" 행동 자체가 사라진다.
   *
   * 인벤토리가 꽉 차면 들어간 만큼만 줄이고 나머지는 바닥에 남긴다. 조용히 증발시키면
   * 플레이어는 자기 자원이 어디 갔는지 알 수 없다.
   */
  pickUpNearestDrop(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player || player.hp <= 0) return;


    let target: DroppedItemEntity | undefined;
    let targetDistance = Infinity;
    for (const drop of this.droppedItems.values()) {
      const distance = Math.hypot(drop.x - player.x, drop.y - player.y);
      if (distance > PICKUP_RADIUS || distance >= targetDistance) continue;
      target = drop;
      targetDistance = distance;
    }
    if (!target) return;

    const leftover = player.inventory.add(target.itemId, target.count);
    if (leftover === target.count) return; // 한 개도 못 넣었다 — 그대로 둔다

    if (leftover > 0) target.count = leftover;
    else this.droppedItems.delete(target.id);
  }

  getDroppedItems(): ReadonlyMap<string, DroppedItemEntity> {
    return this.droppedItems;
  }

  /**
   * 슬롯 사이로 아이템을 옮긴다. 드래그앤드롭이 그대로 이 한 함수로 표현된다.
   *
   * 컨테이너를 문자열로 받는 이유: 인벤토리↔창고, 인벤토리 내부 재배치(퀵슬롯 순서
   * 바꾸기)를 전부 같은 경로로 처리하기 위해서다. 방향마다 함수를 따로 두면 규칙
   * (스택 병합·자리 바꾸기)을 여러 벌 구현하게 된다.
   *
   * 창고가 얽힌 이동은 코어 근처에서만 된다. 인벤토리 내부 재배치는 어디서든 가능하다.
   */
  moveItem(
    playerId: string,
    from: unknown,
    fromIndex: unknown,
    to: unknown,
    toIndex: unknown,
  ): void {
    const player = this.players.get(playerId);
    if (!player || player.hp <= 0) return;
    if (!isContainerName(from) || !isContainerName(to)) return;
    if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return;
    if (from === to && fromIndex === toIndex) return;

    // 창고와 충전 슬롯은 둘 다 코어의 것이라 코어 앞에서만 만질 수 있다.
    const touchesCore = from !== 'inventory' || to !== 'inventory';
    if (touchesCore && !this.isNearCore(player)) return;

    const source = this.container(player, from);
    const target = this.container(player, to);

    const taken = source.takeAt(fromIndex as number);
    if (!taken) return;

    // 충전 슬롯은 태울 수 있는 것만 받는다. 무기를 던져 넣어도 아무 일이 안 일어나면
    // "왜 안 타지"가 되므로, 아예 들어가지 않게 해서 화면에서 거절이 보이게 한다.
    if (to === 'charge' && !World.canCharge(taken.itemId)) {
      source.placeAt(fromIndex as number, taken);
      return;
    }

    // 목적지에서 밀려난 것(자리 바꾸기)이나 다 못 들어간 것(스택 초과)은 원래 자리로
    // 되돌린다. 안 그러면 아이템이 조용히 사라진다.
    const displaced = target.placeAt(toIndex as number, taken);
    if (displaced) source.placeAt(fromIndex as number, displaced);

    // 창고로 들어간 이동이면 티모시가 반응한다(스왑으로 밀려난 아이템이 있어도
    // taken 자체는 목적지에 자리 잡았으므로 "납품"으로 친다).
    if (to === 'storage') this.enqueueCompanionPersonaEvent('coreDeposit', playerId);
  }

  /**
   * 이름을 실제 컨테이너로 바꾼다. 충전 슬롯은 Inventory가 아니라 배열이라 같은
   * 인터페이스(takeAt/placeAt)만 흉내 내는 얇은 어댑터를 씌운다 — moveItem이
   * 컨테이너 종류마다 분기하지 않게 하려는 것이다.
   */
  private container(player: PlayerEntity, name: SlotContainer): SlotAccess {
    if (name === 'storage') return this.core.storage;
    if (name === 'inventory') return player.inventory;
    if (name === 'craft') {
      // 제작 결과 칸은 한 칸짜리다 — **꺼내 가기만** 되고 넣을 수는 없다.
      return {
        takeAt: (index) => {
          if (index !== 0) return null;
          const slot = player.craftOutput;
          player.craftOutput = null;
          return slot;
        },
        placeAt: (_index, incoming) => incoming, // 되돌린다 = 여기엔 못 넣는다
      };
    }
    return {
      takeAt: (index) => {
        const slot = this.core.chargeSlots[index] ?? null;
        if (!slot) return null;
        this.core.chargeSlots[index] = null;
        this.chargeProgress[index] = 0;
        return slot;
      },
      placeAt: (index, incoming) => {
        // 티어로 잠긴 칸은 받지 않는다(되돌린다).
        if (index < 0 || index >= this.openChargeSlotCount()) return incoming;
        const existing = this.core.chargeSlots[index] ?? null;
        // 같은 재료면 합치고, 다르면 자리를 바꾼다(창고 규칙과 같다).
        if (existing && existing.itemId === incoming.itemId) {
          existing.count += incoming.count;
          return null;
        }
        this.core.chargeSlots[index] = incoming;
        this.chargeProgress[index] = 0;
        return existing;
      },
    };
  }

  /**
   * 쉬프트 클릭 빠른 이동(docs/backend/44) — 목적지 칸을 사람이 고르지 않고
   * 반대편 컨테이너(인벤토리↔창고)에 자동으로 넣는다. `Inventory.add()`가 이미
   * "같은 아이템에 먼저 쌓고, 남으면 빈 칸을 새로 연다" 규칙으로 목적지를 고르므로
   * (`pickUpNearestDrop()`이 바닥 드롭을 주울 때 쓰는 것과 같은 메서드) 그대로
   * 재사용한다. 목적지가 꽉 차서 일부만 옮겨지면 옮겨진 만큼만 원래 칸에서 빼고
   * (`removeAt`), 하나도 못 옮기면 원래 칸을 그대로 둔다 — `moveItem`의 "다 못
   * 들어가면 되돌린다" 원칙과 같은 결과다.
   */
  /**
   * 창고 칸 하나를 비운다(폐기).
   *
   * **없애지 않고 바닥에 떨군다.** 창고가 꽉 차서 자리를 만들려는 게 목적인데, 아주
   * 지우면 잘못 누른 순간 되돌릴 방법이 없다. 바닥에 나오면 마음이 바뀌었을 때 다시
   * 주우면 되고, 놔두면 어차피 사라지는 것도 아니다 — "자리를 비운다"는 목적은 그대로
   * 달성된다.
   */
  discardFromStorage(playerId: string, index: unknown): void {
    const player = this.players.get(playerId);
    if (!player || player.hp <= 0) return;
    if (!Number.isInteger(index)) return;
    // 창고를 만지는 다른 조작(moveItem/quickMoveItem)과 같은 규칙 — 코어 앞이어야 한다.
    if (!this.isNearCore(player)) return;

    const slot = this.core.storage.slotAt(index as number);
    if (!slot) return;

    // 칸을 비우기 **전에** 내용을 복사해 둔다 — slotAt은 살아 있는 칸을 그대로 돌려주므로,
    // 먼저 지우면 그 참조의 count가 0이 되어 아무것도 안 떨어진다(실제로 그랬다).
    const { itemId, count } = slot;
    this.core.storage.removeAt(index as number, count);
    this.dropItem(itemId, count, player.x, player.y);
  }

  quickMoveItem(playerId: string, container: unknown, index: unknown, to?: unknown): void {
    const player = this.players.get(playerId);
    if (!player || player.hp <= 0) return;
    if (!isContainerName(container)) return;
    if (!Number.isInteger(index)) return;

    // 인벤토리↔창고 중 한쪽은 항상 코어 것이라 근접 검사는 매번 적용된다.
    if (!this.isNearCore(player)) return;

    /*
     * 목적지를 **화면이 정한다.** 예전엔 "반대편"이 항상 창고였는데, 코어 탭에 충전
     * 슬롯이 생기면서 같은 쉬프트 클릭이 두 곳을 가리키게 됐다. 눈에 보이는 곳으로
     * 가는 게 가장 덜 놀랍다 — 그래서 클라이언트가 지금 열린 탭을 실어 보낸다.
     * 안 보내면 예전 그대로 창고로 간다.
     */
    if (to === 'charge' && container === 'inventory') {
      this.quickChargeFromInventory(player, index as number);
      return;
    }

    // 인벤토리는 창고로 보내고, **코어 쪽 칸(창고·충전·제작)은 전부 인벤토리로 꺼낸다.**
    //
    // 예전엔 "storage면 창고, 아니면 인벤토리"로 뭉뚱그렸는데, isContainerName이
    // charge/craft도 통과시키므로 충전 칸이나 제작 결과 칸을 쉬프트 클릭하면 그 이름이
    // 인벤토리로 오인됐다 — 누른 적도 없는 **같은 번호의 인벤토리 칸**이 창고로 딸려
    // 들어갔다. 컨테이너마다 목적지를 명시해서 이름이 늘어도 조용히 새지 않게 한다.
    if (container === 'inventory') {
      const slot = player.inventory.slotAt(index as number);
      if (!slot) return;

      const leftover = this.core.storage.add(slot.itemId, slot.count);
      if (leftover === slot.count) return; // 하나도 못 옮겼다 — 원래 칸 그대로 둔다

      player.inventory.removeAt(index as number, slot.count - leftover);
      this.enqueueCompanionPersonaEvent('coreDeposit', playerId);
      return;
    }

    const source = this.container(player, container);
    const taken = source.takeAt(index as number);
    if (!taken) return;

    const leftover = player.inventory.add(taken.itemId, taken.count);
    // 인벤토리가 꽉 차 다 못 받으면 남은 만큼 원래 자리로 되돌린다 — 조용히 사라지면 안 된다.
    if (leftover > 0) source.placeAt(index as number, { itemId: taken.itemId, count: leftover });
  }

  /**
   * 인벤토리 한 칸을 충전 슬롯으로 밀어 넣는다(쉬프트 클릭).
   *
   * 같은 재료가 이미 타고 있으면 거기에 합치고, 없으면 **열려 있는 빈 슬롯**을 쓴다.
   * 태울 수 없는 물건이거나 자리가 없으면 아무 일도 안 일어난다 — 거절을 눈에 보이게
   * 하는 건 화면 몫이다(붉은 테두리).
   */
  private quickChargeFromInventory(player: PlayerEntity, index: number): void {
    const slot = player.inventory.slotAt(index);
    if (!slot || !World.canCharge(slot.itemId)) return;

    const open = this.openChargeSlotCount();
    let targetIndex = -1;
    for (let i = 0; i < open; i += 1) {
      if (this.core.chargeSlots[i]?.itemId === slot.itemId) {
        targetIndex = i;
        break;
      }
      if (targetIndex < 0 && !this.core.chargeSlots[i]) targetIndex = i;
    }
    if (targetIndex < 0) return;

    const taken = player.inventory.takeAt(index);
    if (!taken) return;
    const existing = this.core.chargeSlots[targetIndex];
    if (existing) existing.count += taken.count;
    else this.core.chargeSlots[targetIndex] = taken;
  }

  /**
   * 지금 쓸 수 있는 충전 슬롯 수 = **코어 티어**. 배열 자체는 최대 개수로 잡아 두고
   * 앞에서부터 티어만큼만 연다 — 티어가 오를 때 배열을 늘리면 이미 담긴 재료의
   * 칸 번호가 흔들린다.
   */
  openChargeSlotCount(): number {
    return Math.max(0, Math.min(this.core.chargeSlots.length, this.core.tier));
  }

  /** 코어 상호작용(창고 열기 등)이 가능한 거리인지. 클라이언트도 같은 판정을 보여준다. */
  isNearCore(player: PlayerEntity): boolean {
    return isWithinCoreInteract(player.x, player.y);
  }

  canInteractWithCore(playerId: string): boolean {
    const player = this.players.get(playerId);
    return player ? this.isNearCore(player) : false;
  }

  /**
   * 코어 업그레이드 요청. `core.tier`번째(0-based) 단계를 팀 공유 에너지로 산다 —
   * 코어 체력(즉시 회복 + 최대치 증가)·건설 가능 반경·제작/스텟증가 해금이 전부
   * 한 번에 적용된다(docs/backend/38). 마지막 단계까지 다 샀거나 에너지가
   * 부족하면 조용히 무시한다.
   */
  upgradeCore(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player || player.hp <= 0) return;

    // tiers는 "다음 티어로 올리는" 목록이라, 티어 1이 0번 항목을 산다.
    const tier = coreUpgradesData.tiers[this.core.tier - coreUpgradesData.startTier];
    if (!tier) return; // 이미 최고 티어
    if (this.core.resource < tier.cost.resource) return;
    if (this.core.energy < tier.cost.energy) return;

    this.core.resource -= tier.cost.resource;
    this.core.energy -= tier.cost.energy;
    this.core.tier += 1;
    this.core.maxHp += tier.coreHpBonus;
    this.core.hp += tier.coreHpBonus;
    // 상한만 늘린다 — 채워 주지 않는다. 강화 직후 게이지가 비는 게 "다시 모아야
    // 다음 단계"라는 리듬을 만든다.
    this.core.maxResource += tier.maxResourceBonus;
    this.core.maxEnergy += tier.maxEnergyBonus;
  }

  /** 다음 강화 단계(비용/효과). 최고 티어면 undefined — UI가 버튼을 잠근다. */
  nextCoreUpgrade(): CoreUpgradeTier | undefined {
    return coreUpgradesData.tiers[this.core.tier - coreUpgradesData.startTier];
  }

  /**
   * 제작 시작. 재료는 코어 게이지에서 **즉시** 나가고 결과물은 craftSeconds 뒤에
   * 창고로 들어간다.
   *
   * 비용을 먼저 받는 이유는, 제작 중에 남이 같은 자원으로 다른 걸 만들어 버리면
   * 완성 순간에 "돈이 없다"로 실패해야 하는데 그때는 이미 2초를 기다린 뒤라서다.
   * 결과물이 창고가 아니라 손에 들어가지 않는 것은 예전과 같다 — 가방이 꽉 찼을 때
   * 결과물이 증발하는 경로를 아예 만들지 않는다.
   *
   * 한 사람이 동시에 두 개를 걸 수는 없다. 코어 앞을 떠나도 진행은 계속된다 —
   * 코어가 만드는 것이지 사람이 들고 만드는 게 아니다.
   */
  craftItem(playerId: string, recipeId: unknown): void {
    const player = this.players.get(playerId);
    if (!player || player.hp <= 0 || !this.isNearCore(player)) return;
    if (typeof recipeId !== 'string') return;
    if (player.craftRecipeId) return; // 이미 만드는 중
    if (player.craftOutput) return; // 앞서 만든 걸 아직 안 가져갔다

    const recipe = craftingData.recipes.find((entry) => entry.id === recipeId);
    if (!recipe) return;
    if (this.core.tier < recipe.requiresTier) return;
    if (!this.spendCoreCost(recipe.cost)) return;

    player.craftRecipeId = recipe.id;
    player.craftTimer = craftingData.craftSeconds;
  }

  /**
   * 자원/에너지를 한꺼번에 차감한다. **하나라도 모자라면 아무것도 쓰지 않는다** —
   * 자원만 깎이고 실패하면 그만큼이 조용히 증발한다.
   */
  private spendCoreCost(cost: { resource: number; energy?: number }): boolean {
    const energy = cost.energy ?? 0;
    if (this.core.resource < cost.resource || this.core.energy < energy) return false;
    this.core.resource -= cost.resource;
    this.core.energy -= energy;
    return true;
  }

  /** 제작 진행. 완성되면 결과물이 창고로 들어간다. */
  private tickCrafting(dtSeconds: number): void {
    for (const player of this.players.values()) {
      if (!player.craftRecipeId) continue;
      player.craftTimer -= dtSeconds;
      if (player.craftTimer > 0) continue;

      const recipe = craftingData.recipes.find((entry) => entry.id === player.craftRecipeId);
      player.craftRecipeId = '';
      player.craftTimer = 0;
      if (!recipe) continue;

      /*
       * 결과는 **제작 칸에 그대로 둔다.** 창고로 바로 보내면 만든 물건이 스무 칸
       * 어딘가에 섞여 들어가 무엇이 새로 생겼는지 알 수 없다. 꺼내 가는 건 드래그
       * 한 번이면 된다.
       *
       * 시작할 때 결과 칸이 비어 있음을 이미 확인했으므로 여기서 덮어쓸 걱정은 없다.
       */
      player.craftOutput = { itemId: recipe.itemId, count: recipe.count ?? 1 };
    }
  }

  /** 코어 티어에서 만들 수 있는 레시피들. 클라이언트가 목록을 그릴 때도 같은 규칙을 쓴다. */
  availableRecipes(): CraftRecipe[] {
    return craftingData.recipes.filter((recipe) => recipe.requiresTier <= this.core.tier);
  }

  /**
   * 상점에서 산다. 대금은 **에너지**로 나가고 물건은 창고로 들어간다.
   *
   * 판매는 없앴다. 드랍템은 코어 충전을 거쳐 에너지가 되므로, 판매까지 두면 같은
   * 일을 하는 경로가 둘이 되고 "충전은 시간이 드는데 판매는 즉시"라 아무도 충전하지
   * 않게 된다.
   */
  buyFromShop(playerId: string, itemId: unknown): void {
    const player = this.players.get(playerId);
    if (!player || player.hp <= 0 || !this.isNearCore(player)) return;
    if (typeof itemId !== 'string') return;
    // 오늘 진열된 것만 살 수 있다. 어제 봤던 id를 그대로 보내도 통하지 않는다.
    if (!this.core.shopStock.includes(itemId)) return;

    const price = itemsData[itemId]?.buyPrice;
    if (price === undefined || this.core.energy < price) return;

    // 창고에 자리가 없으면 에너지만 나가는 일이 없도록 먼저 넣어보고 판단한다.
    const leftover = this.core.storage.add(itemId, 1);
    if (leftover > 0) return;

    this.core.energy -= price;
  }

  // ---------------------------------------------------------------- 코어 충전

  /** 에너지를 상한까지만 더한다. 콜로니 정화·보스 처치·충전이 모두 이 문을 지난다. */
  private addEnergy(amount: number): void {
    this.core.energy = Math.min(this.core.maxEnergy, this.core.energy + amount);
  }

  /**
   * 충전 슬롯을 한 틱 돌린다 — 재료를 조금씩 먹어 게이지로 바꾼다.
   *
   * **게이지가 가득 차면 멈추고 재료는 슬롯에 남는다.** 넘치는 만큼을 버리면
   * "언제 다 탔는지" 모른 채 재료가 사라지고, 자동으로 되돌려주면 슬롯이 비어
   * 무엇을 넣었는지 잊는다. 남겨 두면 화면만 봐도 "가득 차서 멈췄다"가 읽힌다.
   *
   * 소수점 진행분(chargeProgress)을 슬롯마다 들고 있는 이유는, 틱마다 내림하면
   * 60Hz에서 초당 2개가 0개로 사라지기 때문이다.
   */
  private tickCoreCharge(dtSeconds: number): void {
    const perSlot = chargingData.itemsPerSecond * dtSeconds;
    // 잠긴 슬롯(티어보다 뒤)은 돌지 않는다 — 애초에 넣을 수도 없다.
    const open = this.openChargeSlotCount();
    for (let index = 0; index < open; index += 1) {
      const slot = this.core.chargeSlots[index];
      if (!slot) {
        this.chargeProgress[index] = 0;
        continue;
      }
      const material = chargeMaterialOf(slot.itemId);
      if (!material) continue; // 넣을 수 없는 물건이 어쩌다 들어갔다면 그냥 둔다

      const gauge = material.gauge === 'resource' ? 'resource' : 'energy';
      const max = gauge === 'resource' ? this.core.maxResource : this.core.maxEnergy;
      if (this.core[gauge] >= max) continue; // 가득 참 — 재료를 그대로 남긴다

      this.chargeProgress[index] += perSlot;
      const eaten = Math.min(slot.count, Math.floor(this.chargeProgress[index]));
      if (eaten <= 0) continue;
      this.chargeProgress[index] -= eaten;

      slot.count -= eaten;
      this.core[gauge] = Math.min(max, this.core[gauge] + material.amount * eaten);
      if (slot.count <= 0) {
        this.core.chargeSlots[index] = null;
        this.chargeProgress[index] = 0;
      }
    }
  }

  /** 충전 슬롯이 이 아이템을 받는가. 클라이언트 미리보기도 같은 규칙을 쓴다. */
  static canCharge(itemId: string): boolean {
    return chargeMaterialOf(itemId) !== undefined;
  }

  /**
   * 오늘의 상점 진열을 새로 뽑는다. 무기와 소모품을 **따로** 뽑아서, 운 나쁜 날에
   * 회복약이 하나도 없는 진열이 나오지 않게 한다.
   */
  private rollShopStock(): void {
    this.core.shopStock = [
      ...this.rollRotation('weapon', shopData.weaponsPerDay),
      ...this.rollRotation('consumable', shopData.consumablesPerDay),
    ];
  }

  /**
   * 후보에서 `count`개를 등급 가중치에 따라 **중복 없이** 뽑는다.
   *
   * **등급을 먼저 뽑고, 그 등급 안에서 하나를 고른다.** 후보 하나하나에 자기 등급의
   * 가중치를 얹어 한 번에 뽑는 방식이 더 간단해 보이지만, 그러면 등급별 후보 수가
   * 확률을 왜곡한다 — 전설 무기가 2종, 에픽이 1종이면 전설이 에픽보다 두 배 자주
   * 나온다(실제로 10%로 맞춘 가중치가 11.8%로 측정됐다). 등급을 먼저 뽑으면 몇 종이
   * 있든 shop.json의 비율이 그대로 등장 확률이 된다.
   *
   * 뽑힌 것은 후보에서 빼고 다음 판을 돌린다. 어떤 등급이 동나면 그 등급은 후보
   * 목록에서 사라지고 나머지 등급끼리 가중치를 다시 나눈다 — 진열 칸이 비는 것보다
   * 낫다. 후보 자체가 모자라면 있는 만큼만 낸다.
   */
  private rollRotation(kind: ItemKind, count: number): string[] {
    const byRarity = new Map<ItemRarity, string[]>();
    for (const [itemId, item] of Object.entries(itemsData)) {
      if (item.kind !== kind || !item.rarity || item.buyPrice === undefined) continue;
      if ((shopData.rarityWeights[item.rarity] ?? 0) <= 0) continue;
      const bucket = byRarity.get(item.rarity);
      if (bucket) bucket.push(itemId);
      else byRarity.set(item.rarity, [itemId]);
    }

    const picked: string[] = [];
    for (let i = 0; i < count && byRarity.size > 0; i += 1) {
      const rarity = this.pickWeighted([...byRarity.keys()]);
      const bucket = byRarity.get(rarity)!;
      const index = Math.min(bucket.length - 1, Math.floor(this.rng() * bucket.length));

      picked.push(bucket[index]!);
      bucket.splice(index, 1);
      if (bucket.length === 0) byRarity.delete(rarity);
    }
    return picked;
  }

  /** 남아 있는 등급 중 하나를 가중치대로 뽑는다. */
  private pickWeighted(rarities: ItemRarity[]): ItemRarity {
    const total = rarities.reduce(
      (sum, rarity) => sum + (shopData.rarityWeights[rarity] ?? 0),
      0,
    );
    let roll = this.rng() * total;
    for (const rarity of rarities) {
      roll -= shopData.rarityWeights[rarity] ?? 0;
      if (roll < 0) return rarity;
    }
    return rarities[rarities.length - 1]!; // rng가 1에 극히 가까울 때의 안전망
  }

  /** 코어 원점 기준 건설 가능 반경(px). 구매한 단계만큼 baseBuildRadius에 누적된다. */
  getBuildRadius(): number {
    let radius = coreUpgradesData.baseBuildRadius;
    for (let i = 0; i < this.core.tier - coreUpgradesData.startTier; i += 1) {
      radius += coreUpgradesData.tiers[i]?.buildRadiusBonus ?? 0;
    }
    return radius;
  }

  /** 현재 단계 이하 어떤 단계에서든 제작이 해금됐으면 true(한 번 해금되면 계속 유지). */
  isCraftingUnlocked(): boolean {
    return coreUpgradesData.tiers
      .slice(0, this.core.tier - coreUpgradesData.startTier)
      .some((tier) => tier.unlocksCrafting);
  }

  /** 플레이어 스텟 증가 시스템 해금 여부. 아직 그걸 실제로 쓸 UI/구매 로직은 없다 — 플래그만. */
  isStatUpgradesUnlocked(): boolean {
    return coreUpgradesData.tiers
      .slice(0, this.core.tier - coreUpgradesData.startTier)
      .some((tier) => tier.unlocksStatUpgrades);
  }


  /**
   * 손에 든 건축 아이템으로 설치한다(아이템 한 개 = 비용).
   *
   * 건축 모드(B)와 규칙은 같지만 **비용을 내는 곳이 다르다** — 이쪽은 코어 창고가 아니라
   * 내 인벤토리에서 한 개가 빠진다. 그래서 낮에 미리 만들어 들고 나가면 코어에서 멀리
   * 떨어진 곳에서도 벽을 세울 수 있다(창고 자원은 코어 앞에서만 쓸 수 있는 것과 다르다).
   *
   * 무엇을 지을지는 클라이언트가 고르지 않는다 — 선택된 칸에 실제로 무엇이 들어 있는지
   * 서버가 읽는다(무기와 같은 규칙, §fireWeapon).
   */
  placeHeldBuilding(playerId: string, cx: unknown, cy: unknown): void {
    const player = this.players.get(playerId);
    if (!player) return;

    const held = player.inventory.heldItem();
    if (!held || held.kind !== 'building' || !held.buildingType) return;
    if (!buildingsData[held.buildingType as BuildingType]) return;
    if (!this.canPlaceBuildingAt(playerId, cx, cy)) return;

    // 아이템을 먼저 뺀다. 설치는 위 검사를 통과한 뒤라 실패하지 않는다.
    if (!player.inventory.consumeSelectedOne()) return;
    this.spawnBuilding(held.buildingType as BuildingType, cx as number, cy as number);
  }

  /**
   * 이 칸에 건축물을 세울 수 있는가. 비용을 어디서 내든(창고/아이템) 자리 규칙은 같아야
   * 하므로 한 곳에 모았다 — 규칙이 두 벌이면 한쪽만 고쳐져서 조용히 갈라진다.
   */
  canPlaceBuildingAt(playerId: string, cx: unknown, cy: unknown): boolean {
    if (!isFiniteNumber(cx) || !isFiniteNumber(cy)) return false;
    if (!Number.isInteger(cx) || !Number.isInteger(cy)) return false;
    if (cx < 0 || cy < 0 || cx >= MAP_SIZE_TILES || cy >= MAP_SIZE_TILES) return false;
    if (!this.buildings.canPlace(cx, cy)) return false;

    const { x, y } = cellCenterWorld(cx, cy);
    // 코어 업그레이드로 건설 가능 구역이 늘어난다(docs/backend/38) — 구역 밖은 아직 못 짓는다.
    // 구역은 원이 아니라 **정사각형**(변의 절반 = getBuildRadius)이다. 격자에 짓는
    // 게임에서 원형 경계는 모서리 칸이 애매하게 잘리는데, 정사각형은 칸 단위로
    // 딱 떨어진다.
    if (Math.max(Math.abs(x), Math.abs(y)) > this.getBuildRadius()) return false;

    // 코어 발자국과 겹치는 셀은 전부 금지다 — 스프라이트에 파묻히는 벽이 지어지면 안 된다.
    if (coreDistance(x, y) <= TILE_SIZE / 2) return false;

    for (const node of this.resourceNodes.values()) {
      const nodeCell = worldToCell(node.x, node.y);
      if (nodeCell.cx === cx && nodeCell.cy === cy) return false;
    }

    for (const other of this.players.values()) {
      const otherCell = worldToCell(other.x, other.y);
      if (otherCell.cx === cx && otherCell.cy === cy) return false;
    }

    const player = this.players.get(playerId);
    return player !== undefined && player.hp > 0;
  }

  private spawnBuilding(type: BuildingType, cx: number, cy: number): void {
    const { x, y } = cellCenterWorld(cx, cy);
    const id = `building_${nextBuildingId++}`;
    this.buildings.place(id, type, cx, cy, x, y);
    this.recomputeFlowField();
  }

  /**
   * 테스트용: 특정 웨이브(1-based)로 즉시 이동한다(docs/backend/23). 이전 웨이브의
   * 몬스터가 필드에 남아 있으면 새 웨이브 몬스터와 섞여 테스트 결과가 헷갈리니
   * 함께 정리한다 — 코어/플레이어 HP는 건드리지 않는다(그건 테스트하려는 대상일 수
   * 있으니). 웨이브 번호가 범위를 벗어나 실제로 이동하지 않았으면 몬스터도 그대로
   * 둔다.
   */
  debugJumpToWave(waveNumber: number): void {
    if (this.waveManager.debugJumpToWave(waveNumber)) {
      this.monsters.clear();
      this.monsterGrid.clear();
    }
  }

  /**
   * 살아 있는 플레이어 주변을 밝힌다. **칸이 바뀐 사람만** 계산한다 — 제자리에 선
   * 동안 같은 원을 매 틱 다시 칠할 이유가 없다.
   */
  private revealAroundPlayers(): void {
    for (const player of this.players.values()) {
      if (player.hp <= 0) continue;

      const { cx, cy } = worldToCell(player.x, player.y);
      const cell = cy * MAP_SIZE_TILES + cx;
      if (this.lastRevealCell.get(player.id) === cell) continue;

      this.lastRevealCell.set(player.id, cell);
      this.explored.revealAround(player.x, player.y);
    }
  }

  /**
   * 팀이 밝힌 지역의 비트맵(칸당 1비트, 2KB). 서버는 이걸 스키마에 복사해 내려보내고
   * 로컬 모드는 그대로 읽는다 — 복사본이 아니라 내부 버퍼다(읽기 전용으로 쓸 것).
   */
  getExplored(): Uint8Array {
    return this.explored.raw;
  }

  /**
   * 새 낮이 시작될 때 한 번 일어나는 일들. 정상 진행(웨이브 클리어)과 개발 커맨드가
   * **같은 함수**를 쓴다 — 둘이 갈라지면 "커맨드로 넘긴 낮"에서만 상점이 안 바뀌는
   * 식의 차이가 생긴다.
   */
  private onDayBegan(): void {
    this.revivePlayers();
    this.reviveCompanion();
    this.skipVotes.clear();
    // 하루가 지나면 상점 물건이 통째로 바뀐다. 오늘 못 산 전설은 오늘로 끝이다.
    this.rollShopStock();
    // 정화된 콜로니는 재보급, 살아남은 콜로니는 성장(§settleColoniesOnDayBegan).
    this.settleColoniesOnDayBegan();
  }

  /**
   * 사람과 같은 타이밍에 티모시도 회복시킨다 — 새 부활 상호작용을 만들지 않고
   * 기존 "낮 시작 시 전원 풀피" 훅에 얹는다(docs/superpowers/specs/
   * 2026-08-07-ai-companion-timothy-design.md). 다운 중이 아니었으면(hp 이미 가득)
   * 아무 효과 없다.
   */
  private reviveCompanion(): void {
    if (this.companion.state === 'absent') return;
    const wasDowned = this.companion.state === 'downed';
    this.companion.hp = this.companion.maxHp;
    if (!wasDowned) return;
    this.companion.state = 'seeking';
    const nearestId = this.findNearestPlayerId(this.companion.x, this.companion.y);
    if (nearestId) this.enqueueCompanionPersonaEvent('companionRevived', nearestId);
  }

  /**
   * 개발자 커맨드 한 줄을 실행한다(devCommands.ts).
   *
   * **켜고 끄는 판단은 여기서 하지 않는다** — 호출하는 쪽(로컬 모드, 또는 개발
   * 플래그가 켜진 서버)이 판단해서 부른다. World가 스스로 "개발 모드인가"를 들고
   * 있으면 그 플래그가 시뮬레이션 규칙 곳곳으로 새기 쉽다.
   */
  runDevCommand(playerId: string, line: string): DevCommandResult {
    return runDevCommand(this.devAccess(), playerId, line);
  }

  /**
   * 개발 커맨드가 월드를 건드릴 수 있는 통로. private 필드를 커맨드 모듈에 통째로
   * 열어주는 대신, 필요한 동작만 골라 함수로 넘긴다.
   */
  private devAccess(): DevWorldAccess {
    return {
      hasPlayer: (playerId) => this.players.has(playerId),

      giveToInventory: (playerId, itemId, count) =>
        this.players.get(playerId)?.inventory.add(itemId, count) ?? count,
      giveToStorage: (itemId, count) => this.core.storage.add(itemId, count),
      dropAtPlayer: (playerId, itemId, count) => {
        const player = this.players.get(playerId);
        if (player) this.dropItem(itemId, count, player.x, player.y);
      },
      clearInventory: (playerId) => {
        const inventory = this.players.get(playerId)?.inventory;
        if (!inventory) return;
        for (let index = 0; index < inventory.toView().slots.length; index += 1) {
          inventory.takeAt(index);
        }
      },
      clearStorage: () => {
        for (let index = 0; index < STORAGE_SLOT_COUNT; index += 1) this.core.storage.takeAt(index);
      },

      setResource: (amount) => {
        this.core.resource = Math.max(0, Math.min(this.core.maxResource, amount));
        return this.core.resource;
      },
      setEnergy: (amount) => {
        this.core.energy = Math.max(0, Math.min(this.core.maxEnergy, amount));
        return this.core.energy;
      },
      setLevel: (playerId, level) => {
        const player = this.players.get(playerId);
        if (!player) return 0;
        const target = Math.max(1, Math.min(levelsData.maxLevel, level));
        // 올라간 만큼 SP도 같이 준다 — 레벨만 올려 두면 정작 확인하려던 SP가 없다.
        if (target > player.level) player.statPoints += (target - player.level) * levelsData.spPerLevel;
        player.level = target;
        player.xp = 0;
        player.levelUpSeq = (player.levelUpSeq + 1) % 256;
        return player.level;
      },
      setTier: (tier) => {
        const maxTier = coreUpgradesData.startTier + coreUpgradesData.tiers.length;
        this.core.tier = Math.max(coreUpgradesData.startTier, Math.min(maxTier, tier));
        return this.core.tier;
      },

      jumpToWave: (waveNumber) => {
        const moved = this.waveManager.debugJumpToWave(waveNumber);
        if (moved) this.clearAllMonsters();
        return moved;
      },
      forceDay: () => {
        this.clearAllMonsters();
        // 스폰 큐까지 비워야 낮에 몬스터가 계속 튀어나오지 않는다. 낮에 딸린 일은
        // 정상 진행과 같은 함수로 처리한다.
        if (this.waveManager.debugEndNight() && this.waveManager.currentPhase === 'day') {
          this.onDayBegan();
          this.enqueuePersonaEvent('waveEnd');
          this.enqueueCompanionWaveEndEvent();
        }
      },
      spawnMonsters: (type, count) => {
        for (let i = 0; i < count; i += 1) {
          // 코어 주변 원형으로 흩뿌린다. 한 점에 겹쳐 놓으면 분리 로직이 튄다.
          const angle = (i / count) * Math.PI * 2;
          const radius = DEV_SPAWN_RADIUS + (i % 3) * TILE_SIZE;
          this.addMonster(type, Math.cos(angle) * radius, Math.sin(angle) * radius);
        }
      },
      clearMonsters: () => this.clearAllMonsters(),

      healPlayer: (playerId) => {
        const player = this.players.get(playerId);
        if (player) player.hp = this.playerMaxHp(player);
      },
      setPlayerHp: (playerId, amount) => {
        const player = this.players.get(playerId);
        if (!player) return 0;
        // **상한을 두지 않는다.** 보스 한 방을 버티며 패턴을 끝까지 보는 게 이 커맨드의
        // 용도라, 최대치로 잘라버리면 정작 쓸 데가 없어진다. 체력 바가 넘치는 문제는
        // 그리는 쪽에서 비율을 1로 조여 막는다(HudScene/PartyPanel).
        player.hp = amount;
        return player.hp;
      },
      setCoreHp: (amount) => {
        this.core.hp = Math.min(this.core.maxHp, amount);
      },
      rerollShop: () => this.rollShopStock(),
      forceCoreVoice: () => this.enqueuePersonaEvent('coreInteract'),
    };
  }

  tick(dtSeconds: number): void {
    this.elapsedSeconds += dtSeconds;

    // 이번 틱의 피격 여부를 새로 센다 — damagePlayer()가 이번 틱 중 세팅하고,
    // tickChannels()가 tickMonsters() 이후(=피격이 이미 반영된 뒤)에 읽는다.
    // 소모품 버프 타이머(진통제/아드레날린)도 같은 자리에서 감소시킨다.
    for (const player of this.players.values()) {
      player.tookDamageThisTick = false;
      if (player.hpFloorTimer > 0) player.hpFloorTimer -= dtSeconds;
      if (player.speedBuffTimer > 0) player.speedBuffTimer -= dtSeconds;
      this.tickStamina(player, dtSeconds);
      this.tickHpRegen(player, dtSeconds);
    }
    this.ammo.tick(dtSeconds);
    this.tickBursts(dtSeconds);
    this.tickCoreCharge(dtSeconds);
    this.tickCrafting(dtSeconds);

    for (const [id, player] of this.players) {
      const input = this.inputs.get(id);
      if (!input) continue;
      // 쓰러진 플레이어도 이동은 할 수 있다(도망/은신 등 최소한의 조작은 남겨둔다) —
      // 공격·제작·건축 등 그 외 행동만 막는다(아래 각 메서드의 hp 체크 참고).
      this.movePlayer(player, input.moveX, input.moveY, dtSeconds);
      player.aimAngle = input.aimAngle;
      player.lastProcessedSeq = input.seq;
    }

    const previousPhase = this.waveManager.currentPhase;
    this.waveManager.tick(
      dtSeconds,
      // 아직 스폰 대기 중인 콜로니 침공 복제분도 "살아있는" 것으로 계산해야 한다 —
      // 본대가 먼저 전멸해도 복제분이 다 나올 때까지 밤이(보스가) 오지 않게.
      () => this.monsters.size + this.pendingContingentCount(),
      (type, x, y) => this.addMonster(type, x, y),
    );
    // 밤이 끝나고 새 낮이 시작되는 시점(웨이브 클리어) — 다운된 플레이어를 부활시키고
    // 지난 낮의 스킵 투표를 초기화한다(docs/backend/11 §4.1).
    if (previousPhase !== 'day' && this.waveManager.currentPhase === 'day') {
      this.onDayBegan();
    }
    // 낮이 끝나고 밤이 시작되는 시점 — 콜로니 저장분이 복제되어 침공에 합류한다.
    if (previousPhase === 'day' && this.waveManager.currentPhase === 'night') {
      this.buildNightContingents();
    }
    // 밤이 끝난 시점(다음 낮이든 최종 승리든) — 코어 AI 페르소나가 그 웨이브를 코멘트한다.
    if (
      previousPhase === 'night' &&
      (this.waveManager.currentPhase === 'day' || this.waveManager.currentPhase === 'victory')
    ) {
      this.enqueuePersonaEvent('waveEnd');
      this.enqueueCompanionWaveEndEvent();
    }

    this.revealAroundPlayers();

    this.tickMonsters(dtSeconds);
    this.tickCompanion(dtSeconds);
    this.tickQueuedCompanionMessages();
    this.tickResourceNodes(dtSeconds);
    // tickMonsters() 다음에 불러야 한다 — 이번 틱에 죽은 수호대가 guardIds에서
    // 이미 빠진 뒤여야 정화 판정이 한 틱 늦지 않는다.
    this.tickColonyGuards(dtSeconds);
    this.tickContingents(dtSeconds);

    tickProjectiles(this.projectiles, dtSeconds);
    this.resolveProjectileHits();

    if (this.core.hp <= 0) this.waveManager.markDefeat();
    this.checkAllPlayersDown();
  }

  getPlayers(): ReadonlyMap<string, PlayerEntity> {
    return this.players;
  }

  getMonsters(): ReadonlyMap<string, MonsterEntity> {
    return this.monsters;
  }

  getProjectiles(): ReadonlyMap<string, ProjectileEntity> {
    return this.projectiles;
  }

  getCore(): Readonly<CoreState> {
    return this.core;
  }

  getBuildings(): ReadonlyMap<string, BuildingEntity> {
    return this.buildings.entries();
  }

  getResourceNodes(): ReadonlyMap<string, ResourceNodeEntity> {
    return this.resourceNodes;
  }

  getColonies(): ReadonlyMap<string, ColonyEntity> {
    return this.colonies.entries();
  }

  getCompanion(): Readonly<CompanionEntity> {
    return this.companion;
  }

  getWavePhase(): GamePhase {
    return this.waveManager.currentPhase;
  }

  /** 현재 페이즈가 끝나기까지 남은 시간(초). HUD의 웨이브 다이얼이 쓴다. */
  getPhaseTimeRemaining(): number {
    return this.waveManager.phaseTimeRemaining;
  }

  /** 보스 등장까지 남은 예고 시간(초). 0이면 예고 중이 아니다. */
  getBossWarningRemaining(): number {
    return this.waveManager.bossWarningRemaining;
  }

  /**
   * 이번 밤에 잡아야 할 **잡몹** 총 마릿수. 낮에는 0이라 HUD가 이 값만 보고
   * 몬스터 표시를 켜고 끌 수 있다.
   *
   * 보스는 빼고 센다 — 잡몹을 전멸시켜야 나오는 별개의 국면이고, 그때부터는 보스
   * 체력바가 진행도를 맡는다. 보스를 섞으면 "다 잡았는데 1마리 남음"으로 보인다.
   */
  getWaveMonsterTotal(): number {
    return this.waveManager.currentPhase === 'night' ? this.waveManager.waveMonsterCount : 0;
  }

  /** 아직 남은 잡몹 수 = 살아있는 잡몹 + 아직 안 나온 스폰 큐. */
  getWaveMonsterRemaining(): number {
    if (this.waveManager.currentPhase !== 'night') return 0;
    let alive = 0;
    for (const monster of this.monsters.values()) {
      if (!isBossType(monster.type)) alive += 1;
    }
    return alive + this.waveManager.pendingSpawnCount;
  }

  getCurrentWave(): number {
    return this.waveManager.currentWave;
  }

  /** 현재 낮 스킵 투표에 동의한 인원 수. 필요 인원은 접속 중인 전원(getPlayers().size)이다. */
  getSkipVoteCount(): number {
    return this.skipVotes.size;
  }

  /** 트레잇을 갱신하고 큐에 이벤트를 적재한다. LLM 호출은 GameRoom 몫이라 여기선 하지 않는다. */
  private enqueuePersonaEvent(kind: PersonaEvent['kind']): void {
    this.personaTraits = applyPersonaEvent(this.personaTraits, kind, corePersonaData.eventWeights, {
      min: corePersonaData.traitMin,
      max: corePersonaData.traitMax,
    });
    this.pendingPersonaEvents.push({
      kind,
      traits: this.personaTraits,
      wave: this.waveManager.currentWave,
    });
  }

  /**
   * 코어 모달을 연 플레이어의 상호작용 요청. 쿨다운(corePersonaData.coreInteractionCooldownSeconds)
   * 안이면 조용히 무시한다 — 연타로 대사가 도배되는 걸 막는다(룸 전역 쿨다운, 플레이어별 아님).
   * 성공하면 true.
   */
  requestCoreInteraction(): boolean {
    const cooldown = corePersonaData.coreInteractionCooldownSeconds;
    if (this.elapsedSeconds - this.lastCoreInteractionAt < cooldown) return false;
    this.lastCoreInteractionAt = this.elapsedSeconds;
    this.enqueuePersonaEvent('coreInteract');
    return true;
  }

  /** 쌓인 페르소나 이벤트를 전부 꺼내고 큐를 비운다. GameRoom이 매 틱 폴링한다. */
  drainPersonaEvents(): PersonaEvent[] {
    if (this.pendingPersonaEvents.length === 0) return [];
    const events = this.pendingPersonaEvents;
    this.pendingPersonaEvents = [];
    return events;
  }

  private companionTraitFor(playerId: string): CorePersonaTraits {
    let traits = this.companionTraits.get(playerId);
    if (!traits) {
      traits = createInitialCompanionTraits();
      this.companionTraits.set(playerId, traits);
    }
    return traits;
  }

  /**
   * 트레잇은 이벤트마다 항상 갱신한다(대사 쿨다운과 무관하게 관계는 계속 쌓인다).
   * 실제 대사(LLM 호출/브로드캐스트) 큐는 방 전역 쿨다운을 통과했을 때만 채운다 —
   * 그러지 않으면 코어 납품처럼 짧은 시간에 여러 번 일어나는 이벤트가 대사를 도배한다.
   */
  private enqueueCompanionPersonaEvent(kind: CompanionPersonaEventKind, playerId: string): void {
    const traits = applyCompanionPersonaEvent(this.companionTraitFor(playerId), kind);
    this.companionTraits.set(playerId, traits);

    const cooldown = companionData.persona.interactionCooldownSeconds;
    if (this.elapsedSeconds - this.lastCompanionCommentaryAt < cooldown) return;
    this.lastCompanionCommentaryAt = this.elapsedSeconds;

    this.pendingCompanionPersonaEvents.push({
      kind,
      playerId,
      traits,
      wave: this.waveManager.currentWave,
    });
  }

  /**
   * 웨이브 종료는 방 전체 이벤트라 특정 행위자가 없다 — 그 순간 티모시와 가장 가까운
   * 플레이어를 향해 말한다. 정상 진행(tick)과 개발 커맨드(day)가 같은 함수를 쓴다.
   */
  private enqueueCompanionWaveEndEvent(): void {
    if (!this.companionActive()) return;
    const nearestId = this.findNearestPlayerId(this.companion.x, this.companion.y);
    if (nearestId) this.enqueueCompanionPersonaEvent('waveEnd', nearestId);
  }

  /** 특정 지점에서 가장 가까운, 다운되지 않은 플레이어 id. 후보가 없으면 undefined. */
  private findNearestPlayerId(x: number, y: number): string | undefined {
    let nearestId: string | undefined;
    let nearestDistance = Infinity;
    for (const [id, player] of this.players) {
      if (player.hp <= 0) continue;
      const distance = Math.hypot(player.x - x, player.y - y);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestId = id;
      }
    }
    return nearestId;
  }

  /** 티모시 옆에서 상호작용(E)했음을 알린다. 사거리 밖이면 조용히 무시하고 false. */
  requestCompanionInteraction(playerId: string): boolean {
    const player = this.players.get(playerId);
    if (!player || player.hp <= 0) return false;
    if (!this.companionActive()) return false;
    const distance = Math.hypot(player.x - this.companion.x, player.y - this.companion.y);
    if (distance > companionData.interactRange) return false;
    this.enqueueCompanionPersonaEvent('proximityInteract', playerId);
    return true;
  }

  /**
   * 채팅으로 "@티모시 ..." 하고 직접 말을 걸었을 때. 거리 제한이 없다(채팅 자체가 방
   * 전체에 항상 보이는 것과 같은 맥락) — 대신 `enqueueCompanionPersonaEvent`의 방 전역
   * 잡담 쿨다운과는 별개인 자체 쿨다운만 통과해야 한다. 쿨다운 중이면 버리지 않고
   * 큐에 쌓아뒀다가 tick()에서 쿨다운이 끝나는 대로 순서대로 하나씩 내보낸다(연달아
   * 두 번 물어보면 두 번째가 조용히 씹히던 문제를 이렇게 고쳤다) — 대신 큐가
   * MAX_QUEUED_COMPANION_MESSAGES를 넘기면 그건 진짜 스팸으로 보고 거절한다.
   */
  sendCompanionMessage(playerId: string, message: string): boolean {
    if (!this.players.has(playerId)) return false;
    // 없는 티모시에게 말을 걸면 조용히 무시한다 — 답이 돌아오지 않는 게 맞다.
    if (this.companion.state === 'absent') return false;
    const cooldown = companionData.persona.playerMessageCooldownSeconds;
    if (this.elapsedSeconds - this.lastCompanionMessageAt < cooldown) {
      if (this.queuedCompanionMessages.length >= World.MAX_QUEUED_COMPANION_MESSAGES) return false;
      this.queuedCompanionMessages.push({ playerId, message });
      return true;
    }
    this.emitCompanionMessage(playerId, message);
    return true;
  }

  /** sendCompanionMessage의 실제 처리부 — 쿨다운을 이미 통과했다고 가정한다. */
  private emitCompanionMessage(playerId: string, message: string): void {
    this.lastCompanionMessageAt = this.elapsedSeconds;
    const traits = applyCompanionPersonaEvent(this.companionTraitFor(playerId), 'playerMessage');
    this.companionTraits.set(playerId, traits);
    // 지금까지의 대화 기록(이번 메시지 이전까지)을 이벤트에 실어 보낸다 — 이번 메시지
    // 자체는 buildCompanionPersonaPrompt가 새 user 턴으로 따로 붙인다. 복사본을 넘겨야
    // 한다 — 안 그러면 바로 아래 pushCompanionHistory가 같은 배열 객체를 이어서 밀어
    // 넣어서, 이 이벤트에 실린 "이전까지의 기록"에 방금 보낸 메시지까지 같이 보이게 된다.
    const history = [...this.getCompanionHistory(playerId)];
    this.pendingCompanionPersonaEvents.push({
      kind: 'playerMessage',
      playerId,
      traits,
      wave: this.waveManager.currentWave,
      message,
      history,
    });
    this.pushCompanionHistory(playerId, 'user', message);
  }

  /** 쿨다운이 끝났고 큐에 대기 중인 질문이 있으면 가장 오래된 것 하나를 내보낸다. tick()이 매 틱 부른다. */
  private tickQueuedCompanionMessages(): void {
    if (this.queuedCompanionMessages.length === 0) return;
    const cooldown = companionData.persona.playerMessageCooldownSeconds;
    if (this.elapsedSeconds - this.lastCompanionMessageAt < cooldown) return;
    const next = this.queuedCompanionMessages.shift()!;
    this.emitCompanionMessage(next.playerId, next.message);
  }

  /** "@티모시 ..." 대화 기록(이 플레이어와 나눈 최근 대화). GameRoom이 프롬프트에 이어 붙인다. */
  getCompanionHistory(playerId: string): readonly CompanionPersonaTurn[] {
    return this.companionConversations.get(playerId) ?? [];
  }

  /** LLM이 실제로 뭐라고 답했는지 기록한다 — GameRoom이 응답을 받은 뒤 호출한다. */
  recordCompanionReply(playerId: string, reply: string): void {
    this.pushCompanionHistory(playerId, 'assistant', reply);
  }

  private pushCompanionHistory(playerId: string, role: CompanionPersonaTurn['role'], content: string): void {
    const history = this.companionConversations.get(playerId) ?? [];
    history.push({ role, content });
    const limit = companionData.persona.historyMessageLimit;
    while (history.length > limit) history.shift();
    this.companionConversations.set(playerId, history);
  }

  /** 쌓인 티모시 대사 이벤트를 전부 꺼내고 큐를 비운다. GameRoom이 매 틱 폴링한다. */
  drainCompanionPersonaEvents(): CompanionPersonaEvent[] {
    if (this.pendingCompanionPersonaEvents.length === 0) return [];
    const events = this.pendingCompanionPersonaEvents;
    this.pendingCompanionPersonaEvents = [];
    return events;
  }

  /** 코어 셀로 Flow Field를 다시 계산한다. 생성자, 건축물 설치/파괴 시에만 호출한다(매 틱 금지). */
  private recomputeFlowField(): void {
    const coreCell = worldToCell(0, 0);
    this.flowField.recompute(coreCell.cx, coreCell.cy);
  }

  /** 자원 노드를 코어 주변에 군집(클러스터)으로 배치한다. 클래스 상단 상수 주석 참고. */
  private seedResourceNodes(): void {
    this.seedResourceClusters('wood', WOOD_CLUSTER_COUNT, WOOD_NODES_PER_CLUSTER);
    this.seedResourceClusters('stone', STONE_CLUSTER_COUNT, STONE_NODES_PER_CLUSTER);
  }

  private seedResourceClusters(type: ResourceType, clusterCount: number, nodesPerCluster: number): void {
    const data = resourcesData[type];

    for (let i = 0; i < clusterCount; i += 1) {
      const clusterAngle = this.rng() * Math.PI * 2;
      const clusterDistance =
        CLUSTER_MIN_DISTANCE + this.rng() * (CLUSTER_MAX_DISTANCE - CLUSTER_MIN_DISTANCE);
      const clusterX = Math.cos(clusterAngle) * clusterDistance;
      const clusterY = Math.sin(clusterAngle) * clusterDistance;

      const placed: { x: number; y: number }[] = [];
      for (let n = 0; n < nodesPerCluster; n += 1) {
        const position = this.pickClusterNodePosition(clusterX, clusterY, placed, data.hitRadius);
        placed.push(position);

        const id = `resource_${nextResourceNodeId++}`;
        this.resourceNodes.set(id, {
          id,
          type,
          x: position.x,
          y: position.y,
          hp: data.hp,
          maxHp: data.hp,
          respawnTimer: 0,
          clusterX,
          clusterY,
        });
        // 셀 등록은 여기서 하지 않는다 — 생성자가 시딩이 다 끝난 뒤
        // rebuildResourceObstacleCells()를 한 번만 불러 한꺼번에 계산한다.
      }
    }
  }

  /**
   * 클러스터 중심 주변 `CLUSTER_JITTER_RADIUS` 안에서 무작위 위치를 고른다. 이미 놓인
   * 것(같은 군집의 다른 노드)과 `MIN_NODE_SPACING`보다 가깝거나, 지금 서 있는
   * 플레이어와 겹치면 다시 뽑는다 — 몇 번 재시도해도 계속 안 되면(좁은 지터 반경
   * 안에 노드가 너무 많거나 플레이어가 하필 그 자리에 서 있는 극단적인 경우)
   * 완벽한 조건보다 무한 재시도 방지가 우선이라 마지막으로 뽑은 위치를 그냥 쓴다.
   *
   * 최초 시딩(World 생성자)과 리스폰 재배치(§relocateRespawnedNode) 둘 다 이
   * 메서드를 쓴다 — 생성자 시점엔 아직 플레이어가 한 명도 없어서(addPlayer()는
   * 항상 그 이후에 불린다) 플레이어 충돌 검사가 자동으로 아무 효과가 없다.
   */
  private pickClusterNodePosition(
    centerX: number,
    centerY: number,
    placed: { x: number; y: number }[],
    nodeRadius: number,
  ): { x: number; y: number } {
    const MAX_ATTEMPTS = 8;
    let candidate = { x: centerX, y: centerY };

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const angle = this.rng() * Math.PI * 2;
      const radius = this.rng() * CLUSTER_JITTER_RADIUS;
      candidate = { x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius };

      const tooCloseToSibling = placed.some(
        (p) => Math.hypot(p.x - candidate.x, p.y - candidate.y) < MIN_NODE_SPACING,
      );
      const overlapsPlayer = [...this.players.values()].some((player) =>
        circlesOverlap(player.x, player.y, candidate.x, candidate.y, HIT_RADIUS + nodeRadius),
      );
      if (!tooCloseToSibling && !overlapsPlayer) return candidate;
    }

    return candidate;
  }

  /**
   * 고갈됐다가 리스폰하는 노드를 같은 군집 안 새 무작위 위치로 옮긴다(docs/backend/39)
   * — 항상 같은 자리에 다시 나던 걸 바꿔서, 자주 캐는 자리 하나가 사실상 영구
   * 장애물처럼 남지 않게 한다. `pickClusterNodePosition`을 그대로 재사용하되
   * "이미 놓인 것"으로 같은 군집의 **살아있는** 형제 노드만 넘긴다(다른 군집이나
   * 고갈된 노드는 겹쳐도 상관없다).
   */
  private relocateRespawnedNode(node: ResourceNodeEntity): void {
    const data = resourcesData[node.type];
    const siblings: { x: number; y: number }[] = [];
    for (const other of this.resourceNodes.values()) {
      if (other === node || other.hp <= 0) continue;
      if (other.clusterX !== node.clusterX || other.clusterY !== node.clusterY) continue;
      siblings.push({ x: other.x, y: other.y });
    }

    const position = this.pickClusterNodePosition(node.clusterX, node.clusterY, siblings, data.hitRadius);
    node.x = position.x;
    node.y = position.y;
  }

  /** 몬스터를 추가하고 id를 돌려준다 — 수호대 소환처럼 스폰 직후 추가 설정이 필요한 곳용. */
  private addMonster(type: MonsterType, x: number, y: number): string {
    const data = monstersData[type];
    const id = `monster_${nextMonsterId++}`;
    // 스폰 직후엔 코어를 향해 걷기 시작하니, 초기 시야 방향도 코어 쪽으로 잡아둔다.
    const distanceToCore = Math.hypot(x, y);
    const facingX = distanceToCore > 0 ? -x / distanceToCore : 0;
    const facingY = distanceToCore > 0 ? -y / distanceToCore : -1;
    this.monsters.set(id, {
      id,
      type,
      x,
      y,
      hp: data.hp,
      maxHp: data.hp,
      attackCooldown: 0,
      facingX,
      facingY,
      pattern: { kind: 'idle' },
      specialAttackCooldown: data.meleeAttacks ? BOSS_FIRST_PATTERN_DELAY : 0,
      stuckSeconds: 0,
      guardReturnTimer: 0,
      attackAnimTimer: 0,
      attackSeq: 0,
      attackAnim: 0,
      meleeCooldowns: (data.meleeAttacks ?? []).map(() => 0),
    });
    this.monsterGrid.insert(id, x, y);
    return id;
  }

  /**
   * 다운된(hp 0) 플레이어는 이미 전투 불능이라 몬스터의 추격/공격 대상에서 제외한다.
   * 시야각(§AGGRO_FOV_COS_HALF_ANGLE) 밖의 플레이어도 후보에서 제외한다 — 몬스터의
   * `facingX/Y`와 플레이어 방향 단위 벡터의 내적으로 판정한다(플레이어가 몬스터와
   * 정확히 같은 좌표면 방향을 정의할 수 없으니 그 경우만 시야각 검사를 건너뛴다).
   */
  private findNearestPlayer(monster: MonsterEntity, radius: number): PlayerEntity | undefined {
    let nearest: PlayerEntity | undefined;
    let nearestDistance = radius;

    for (const player of this.players.values()) {
      if (player.hp <= 0) continue;
      const dx = player.x - monster.x;
      const dy = player.y - monster.y;
      const distance = Math.hypot(dx, dy);
      if (distance > nearestDistance) continue;

      if (distance > 0) {
        const facingDot = (dx / distance) * monster.facingX + (dy / distance) * monster.facingY;
        if (facingDot < AGGRO_FOV_COS_HALF_ANGLE) continue;
      }

      nearest = player;
      nearestDistance = distance;
    }

    return nearest;
  }

  /**
   * 플레이어에게 데미지를 적용하는 유일한 경로. hp를 깎는 것뿐 아니라
   * `tookDamageThisTick`도 같이 세팅한다 — 콜로니 채널링의 "피격 시 중단"
   * 판정(tickChannels)이 이 플래그를 읽는다. 몬스터가 플레이어를 때리는 모든
   * 경로(추격 공격, 보스 돌진/광역)가 반드시 이 메서드를 거쳐야 한다.
   */
  private damagePlayer(player: PlayerEntity, amount: number): void {
    // 진통제 지속 중에는 체력이 1 아래로 떨어지지 않는다 — 다운을 3초 미루는 보험.
    const floor = player.hpFloorTimer > 0 ? 1 : 0;
    player.hp = Math.max(floor, player.hp - amount);
    player.tookDamageThisTick = true;
  }

  /** 웨이브를 클리어하고 새 낮이 시작될 때 다운된 플레이어를 전원 부활시킨다. */
  private revivePlayers(): void {
    for (const player of this.players.values()) {
      player.hp = this.playerMaxHp(player);
    }
  }

  /**
   * 접속 중인 플레이어 전원이 다운(hp 0) 상태면 즉시 패배 처리한다(docs/backend/11 §4.1).
   * 플레이어가 아무도 없으면(전원 퇴장) 패배 조건이 아니다.
   */
  private checkAllPlayersDown(): void {
    if (this.players.size === 0) return;
    const allDown = [...this.players.values()].every((player) => player.hp <= 0);
    if (allDown) this.waveManager.markDefeat();
  }

  /** 고갈된 자원 노드의 리스폰 타이머를 감소시키고, 다 되면 채집 가능 상태로 되돌린다. */
  /**
   * 고갈된 자원 노드의 리스폰 타이머를 감소시키고, 다 되면 채집 가능 상태로 되돌린다
   * — 이때 같은 자리가 아니라 같은 군집 안 새 위치로 옮긴다(§relocateRespawnedNode,
   * docs/backend/39). 한 틱에 여러 노드가 동시에 리스폰될 수 있어서, 장애물 셀
   * 재계산은 노드마다 하지 않고 루프가 끝난 뒤 한 번만 한다.
   */
  private tickResourceNodes(dtSeconds: number): void {
    let anyRespawned = false;

    for (const node of this.resourceNodes.values()) {
      if (node.respawnTimer <= 0) continue;
      node.respawnTimer -= dtSeconds;
      if (node.respawnTimer <= 0) {
        node.hp = resourcesData[node.type].hp;
        node.respawnTimer = 0;
        this.relocateRespawnedNode(node);
        anyRespawned = true;
      }
    }

    if (anyRespawned) {
      this.rebuildResourceObstacleCells();
      this.recomputeFlowField();
    }
  }

  /**
   * 콜로니 수호대 소환/정화 판정. `tickMonsters()` 이후에 불러야 한다 — 이번 틱에
   * 죽은 수호대가 guardIds에서 이미 빠진 뒤여야 정화가 한 틱 늦지 않는다.
   *
   * 소환 규칙: 살아있는 플레이어가 트리거 반경 안에 있으면 저장분에서 한 마리씩
   * 꺼내 소환하고, 동시 수호대 수(guardConcurrent)를 유지하도록 보충한다. 저장분
   * 전체가 한꺼번에 쏟아지지 않게 하는 건 압박 유지와 "입구 낚시" 방지를 겸한다 —
   * 대신 순차 보충이라 플레이어가 하나씩 끊어 먹는 것도 자연히 가능하다(설계 의도).
   *
   * **저장분이 바닥나도 플레이어가 계속 있으면** guardTrickleSeconds(느린 주기)로
   * "여분" 수호대가 계속 나온다(stored는 안 깎는다 — 깎을 게 없다). 1단계 저장분
   * (4마리)만으로는 아침 내내 지켜도 순식간에 끝나버려서 파밍이 사실상 불가능했던
   * 문제를 푼다(데모 준비도 리뷰 피드백 #3) — 대신 저장분 소진 시절보다는 느리게
   * 나오게 해서 "무한 파밍"과 "적당한 압박"의 중간을 잡는다.
   *
   * 트리클 수호대가 (죽지 않고) 물러나 귀환하면 기존 로직이 stored를 복원하는데,
   * 원래 저장분에서 나온 게 아니라도 그대로 둔다 — 어차피 단계 상한(stages[].stored)
   * 으로 막혀 있고, "지키고 있으면 콜로니가 든든해 보인다"는 체감과도 맞는다.
   *
   * 페이즈(낮/밤) 무관하게 돈다 — 밤에도 콜로니에 접근하면 수호대가 나온다.
   */
  private tickColonyGuards(dtSeconds: number): void {
    for (const colony of this.colonies.values()) {
      if (colony.purified) continue;

      const triggered = this.anyAlivePlayerWithin(colony.x, colony.y, coloniesData.triggerRadius);

      // 정화: 저장분도 수호대도 남지 않았고, 아무도 트리클을 유지하고 있지 않을 때만.
      // 플레이어가 트리거 반경 안에 있으면(triggered) 저장분이 0이어도 트리클로 계속
      // 나올 수 있으므로 아직 "비워졌다"고 볼 수 없다 — 순서를 triggered 판정보다
      // 먼저 두면 저장분이 막 바닥난 순간 트리클이 시작되기도 전에 정화돼버린다.
      if (colony.stored <= 0 && colony.guardIds.size === 0 && !triggered) {
        this.purifyColony(colony);
        continue;
      }

      if (!triggered) {
        // 아무도 없으면 보충 타이머를 초기값으로 되돌린다 — 다음 접근 때 곧바로
        // 첫 수호대가 나오게(경계에서 들락거리며 타이머만 갉는 것 방지).
        colony.guardRespawnTimer = 0;
        continue;
      }

      if (colony.guardIds.size >= coloniesData.guardConcurrent) continue;

      const hasStored = colony.stored > 0;
      colony.guardRespawnTimer -= dtSeconds;
      if (colony.guardRespawnTimer > 0) continue;
      colony.guardRespawnTimer = hasStored
        ? coloniesData.guardRespawnSeconds
        : coloniesData.guardTrickleSeconds;

      const stage = colonyStageData(colony.stage);
      const type = stage.types[Math.floor(this.rng() * stage.types.length)] as MonsterType;

      // 콜로니 중심 좌표 그대로 스폰시키면 콜로니 자신의 하드 충돌 반경(docs/backend/38)
      // 안에서 태어나 영구히 끼어버린다(docs/backend/40). 경계 바로 바깥에 스폰한다.
      const spawnMonsterR = monstersData[type]?.hitRadius ?? HIT_RADIUS;
      const angle = this.rng() * Math.PI * 2;
      const offset = COLONY_RADIUS + spawnMonsterR + 2; // 여유 2px — 겹침 없이 확실히 밖
      const guardId = this.addMonster(
        type,
        colony.x + Math.cos(angle) * offset,
        colony.y + Math.sin(angle) * offset,
      );
      const guard = this.monsters.get(guardId);
      if (guard) {
        guard.homeColonyId = colony.id;
        if (hasStored) colony.stored -= 1;
        colony.guardIds.add(guardId);
      }
    }
  }

  /**
   * 수호대 한 마리의 틱. 일반 몬스터와 달리 **콜로니 중심** 기준으로 판단한다 —
   * 자기 위치 기준이면 추격 중에 리시가 몬스터를 따라 이동해 무한 추격이 된다.
   *
   * 1) 리시 반경(콜로니 기준) 안에 살아있는 플레이어가 있으면 가장 가까운 쪽을 요격.
   * 2) 없으면 콜로니 곁으로 귀환. 도착 후 returnDespawnSeconds가 지나면 저장 상태로
   *    복귀한다 — 엔티티가 사라지고 콜로니 stored가 복원된다("자연스럽게 돌아가
   *    수호하다가 저장 상태로").
   */
  private tickGuard(monster: MonsterEntity, data: MonsterData, dtSeconds: number): void {
    const colony = this.colonies.get(monster.homeColonyId!);
    if (!colony) {
      // 방어적 처리 — 소속 콜로니가 없으면(있을 수 없는 상태) 일반 몬스터로 강등한다.
      monster.homeColonyId = undefined;
      return;
    }

    // 요격 대상: 리시 반경(콜로니 기준) 안에서 수호대 자신과 가장 가까운 생존자.
    let target: PlayerEntity | undefined;
    let bestDistance = Infinity;
    for (const player of this.players.values()) {
      if (player.hp <= 0) continue;
      if (Math.hypot(player.x - colony.x, player.y - colony.y) > coloniesData.leashRadius) continue;
      const distance = Math.hypot(player.x - monster.x, player.y - monster.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        target = player;
      }
    }

    if (target) {
      monster.guardReturnTimer = 0;
      if (bestDistance > 0) {
        monster.facingX = (target.x - monster.x) / bestDistance;
        monster.facingY = (target.y - monster.y) / bestDistance;
      }

      // 벽으로 길을 막았으면 침공 몬스터와 같은 규칙으로 그 벽부터 부순다.
      const blocker = this.findBlockingBuildingInRange(monster, data.attackRange);
      if (blocker) {
        if (monster.attackCooldown <= 0) {
          this.startBasicAttack(monster, data, { kind: 'building', id: blocker.id });
        }
      } else if (bestDistance <= data.attackRange) {
        if (monster.attackCooldown <= 0) {
          this.startBasicAttack(monster, data, { kind: 'player', id: target.id });
        }
      } else {
        this.moveMonster(monster, monster.facingX, monster.facingY, data.speed, dtSeconds);
      }
      return;
    }

    // 귀환: 콜로니 충돌 반경 바로 바깥까지 다가간 뒤 잠시 서성이다 저장 상태로.
    const homeDistance = Math.hypot(colony.x - monster.x, colony.y - monster.y);
    const arriveDistance = COLONY_RADIUS + monsterRadius(monster) + GUARD_HOME_ARRIVE_MARGIN;
    if (homeDistance > arriveDistance) {
      monster.guardReturnTimer = 0;
      monster.facingX = (colony.x - monster.x) / homeDistance;
      monster.facingY = (colony.y - monster.y) / homeDistance;
      this.moveMonster(monster, monster.facingX, monster.facingY, data.speed, dtSeconds);
      return;
    }

    monster.guardReturnTimer += dtSeconds;
    if (monster.guardReturnTimer < coloniesData.returnDespawnSeconds) return;

    this.monsters.delete(monster.id);
    colony.guardIds.delete(monster.id);
    // 단계 재보급(settleColoniesOnDayBegan)이 사이에 끼어도 저장분이 상한을 넘지 않게 조인다.
    colony.stored = Math.min(colony.stored + 1, colonyStageData(colony.stage).stored);
  }

  /**
   * 개발 커맨드 전용: 몬스터를 전부 치우면서 콜로니 수호대 장부와 침공 대기열도 함께
   * 비운다 — 장부에 유령 id가 남으면 동시 수호대 상한이 영구히 차서 소환이 멈춘다.
   */
  private clearAllMonsters(): void {
    this.monsters.clear();
    this.monsterGrid.clear();
    this.contingents.length = 0;
    for (const colony of this.colonies.values()) colony.guardIds.clear();
  }

  /**
   * 평타를 **시도**한다 — 그 자리에 멈춰 휘두르는 그림을 재생하고, 예고가 끝나는
   * 순간에야 정산한다(§basicSwing). 쿨다운은 시도 시점에 걸어서 예고 중에 또
   * 시도하거나 헛친 뒤 곧바로 다시 치는 일이 없게 한다.
   */
  private startBasicAttack(
    monster: MonsterEntity,
    data: MonsterData,
    target: BasicAttackTarget,
  ): void {
    // 보스에게는 평타가 없다 — 패턴 3개(meleeAttacks)가 공격의 전부이고, 그중 하나가
    // 자주 나오는 동작 역할을 한다. 예전엔 여기서 Attack01을 평타로 재생해서, 같은
    // 그림이 "평타"와 "1번 기술" 양쪽으로 쓰이며 서로를 덮어썼다.
    if (data.meleeAttacks) return;

    monster.attackCooldown = data.attackInterval;
    monster.pattern = { kind: 'basicSwing', timer: data.attackWindupSeconds, target };
    // 모션은 지금 켠다 — 맞은 뒤에 휘두르면 예고가 아니다.
    this.markAttack(monster, 1, data.attackWindupSeconds + ATTACK_ANIM_SECONDS);
  }

  /**
   * 평타 예고 진행. 시간이 다 되면 **사거리를 다시 재서** 정산한다 — 예고 중에
   * 빠져나간 대상은 맞지 않는다(이게 "피할 수 있다"의 전부다).
   */
  private tickBasicSwing(monster: MonsterEntity, data: MonsterData, dtSeconds: number): boolean {
    const pattern = monster.pattern as Extract<BossPatternState, { kind: 'basicSwing' }>;
    pattern.timer -= dtSeconds;
    if (pattern.timer > 0) return true;

    this.resolveBasicHit(monster, data, pattern.target);
    monster.pattern = { kind: 'idle' };
    // 한 번 휘둘렀으니 다시 "시야 안 가장 가까운 사람"을 고른다(§clearAggroAfterAttack).
    this.clearAggroAfterAttack(monster);
    return true;
  }

  /** 예고가 끝난 순간의 정산. 대상별로 사거리를 다시 재고, 벗어났으면 헛친다. */
  private resolveBasicHit(
    monster: MonsterEntity,
    data: MonsterData,
    target: BasicAttackTarget,
  ): void {
    const inRange = (x: number, y: number, extra = 0): boolean =>
      Math.hypot(x - monster.x, y - monster.y) <= data.attackRange + extra;

    switch (target.kind) {
      case 'player': {
        const player = this.players.get(target.id);
        if (player && player.hp > 0 && inRange(player.x, player.y, HIT_RADIUS)) {
          this.damagePlayer(player, data.damage);
        }
        break;
      }
      case 'companion': {
        if (
          this.companionActive() &&
          inRange(this.companion.x, this.companion.y, HIT_RADIUS)
        ) {
          this.damageCompanion(data.damage);
        }
        break;
      }
      case 'building': {
        const building = this.buildings.get(target.id);
        if (building && inRange(building.x, building.y)) {
          building.hp = Math.max(0, building.hp - data.damage);
          if (building.hp <= 0) {
            this.buildings.remove(building.id);
            this.recomputeFlowField();
          }
        }
        break;
      }
      case 'core': {
        if (coreDistance(monster.x, monster.y) <= data.attackRange) {
          this.core.hp = Math.max(0, this.core.hp - data.damage);
        }
        break;
      }
    }

    // 휘두른 자리에 티모시가 서 있으면 함께 맞는다 — 노린 대상은 아니지만 칼이 지나간다.
    if (
      target.kind !== 'companion' &&
      this.companionActive() &&
      inRange(this.companion.x, this.companion.y, HIT_RADIUS)
    ) {
      this.damageCompanion(data.damage);
    }
  }

  /**
   * 공격 모션을 켠다. 피해가 실제로 들어간 자리마다 부른다(빗나간 시도에는 안 켠다).
   * `anim`은 재생할 동작 번호 — 검술이 여러 개인 보스만 1이 아닌 값을 넘긴다.
   */
  private markAttack(monster: MonsterEntity, anim = 1, seconds = ATTACK_ANIM_SECONDS): void {
    monster.attackAnimTimer = seconds;
    monster.attackAnim = anim;
    // uint8로 실려 나가므로 한 바퀴 돌려 쓴다 — 클라이언트는 크기가 아니라 "달라졌는가"만 본다.
    monster.attackSeq = (monster.attackSeq + 1) % 256;
  }

  /** 정화 처리: 단계 보상 지급 후 1단계 빈 껍데기로. 다음 낮에 재보급된다(onDayBegan). */
  private purifyColony(colony: ColonyEntity): void {
    this.addEnergy(colonyStageData(colony.stage).purifyEnergy);
    colony.stage = 1;
    colony.stored = 0;
    colony.purified = true;
    this.enqueuePersonaEvent('colonyDestroyed');
  }

  /** 살아있는 플레이어 중 (x,y)에서 radius 안에 있는 사람이 하나라도 있는가. */
  private anyAlivePlayerWithin(x: number, y: number, radius: number): boolean {
    for (const player of this.players.values()) {
      if (player.hp <= 0) continue;
      if (circlesOverlap(player.x, player.y, x, y, radius)) return true;
    }
    return false;
  }

  /**
   * 밤 시작에 콜로니 저장분의 일부를 **복제**해 침공 대기열로 만든다. 저장분 자체는
   * 줄지 않는다 — 줄면 "밤에는 콜로니가 비어 정화가 공짜"라는 허점이 생긴다.
   * 대기열은 tickContingents()가 웨이브와 같은 무리 리듬으로 콜로니 방향에서
   * 내보낸다("콜로니가 있는 방향에서 몰려온다").
   */
  private buildNightContingents(): void {
    this.contingents.length = 0;
    for (const colony of this.colonies.values()) {
      if (colony.purified || colony.stored <= 0) continue;
      const count = Math.floor(colony.stored * coloniesData.waveContributionRatio);
      if (count <= 0) continue;

      const stage = colonyStageData(colony.stage);
      const queue: MonsterType[] = [];
      for (let i = 0; i < count; i += 1) {
        queue.push(stage.types[Math.floor(this.rng() * stage.types.length)] as MonsterType);
      }
      this.contingents.push({ x: colony.x, y: colony.y, queue, timer: 0 });
    }
  }

  /**
   * 새 낮이 시작될 때의 콜로니 정산. 정화된 빈 껍데기는 1단계 저장분으로 재보급되고
   * (정화 즉시 재보급하면 그 자리에서 무한 보상 파밍이 된다 — 하루에 한 번만),
   * 살아남은(정화 안 된) 콜로니는 한 단계 성장한다(저장분 대략 2배, 최대 3단계).
   */
  private settleColoniesOnDayBegan(): void {
    for (const colony of this.colonies.values()) {
      if (colony.purified) {
        colony.purified = false;
        colony.stored = colonyStageData(colony.stage).stored;
      } else {
        colony.stage = Math.min(colony.stage + 1, maxColonyStage());
        colony.stored = colonyStageData(colony.stage).stored;
      }
      colony.guardRespawnTimer = 0;
    }
  }

  /**
   * 침공 복제분을 무리 단위로 내보낸다. 무리 크기/간격은 현재 웨이브 항목을 그대로
   * 따라가 본대와 같은 리듬으로 밀려온다. 밤이 아니면(승리/패배 포함) 대기열만
   * 남고 소진되지 않는데, 어차피 다음 밤 시작에 새로 만들어 덮으므로 문제없다.
   */
  private tickContingents(dtSeconds: number): void {
    if (this.waveManager.currentPhase !== 'night') return;
    const entry = wavesData.waves[this.waveManager.currentWave - 1];
    const groupSize = entry?.groupSize ?? 4;
    const interval = entry?.groupIntervalSeconds ?? 12;

    for (const contingent of this.contingents) {
      if (contingent.queue.length === 0) continue;
      contingent.timer -= dtSeconds;
      if (contingent.timer > 0) continue;
      contingent.timer = interval;

      for (let i = 0; i < groupSize; i += 1) {
        const type = contingent.queue.shift();
        if (!type) break;
        const spawnMonsterR = monstersData[type]?.hitRadius ?? HIT_RADIUS;
        const angle = this.rng() * Math.PI * 2;
        const offset = COLONY_RADIUS + spawnMonsterR + 2;
        this.addMonster(
          type,
          contingent.x + Math.cos(angle) * offset,
          contingent.y + Math.sin(angle) * offset,
        );
      }
    }
  }

  /** 아직 스폰 대기 중인 침공 복제분 총 마릿수. 밤 종료 판정에 산 몬스터처럼 계산된다. */
  private pendingContingentCount(): number {
    let total = 0;
    for (const contingent of this.contingents) total += contingent.queue.length;
    return total;
  }

  /** 살아있는(hp>0) 자원 노드 중 (x,y)에서 가장 가까운 것. 없으면 undefined. */
  private findNearestHarvestableNode(x: number, y: number): ResourceNodeEntity | undefined {
    let nearest: ResourceNodeEntity | undefined;
    let nearestDistance = Infinity;
    for (const node of this.resourceNodes.values()) {
      if (node.hp <= 0) continue;
      const distance = Math.hypot(node.x - x, node.y - y);
      if (distance < nearestDistance) {
        nearest = node;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  /**
   * 티모시를 (targetX, targetY) 방향으로 한 스텝 이동시킨다. `movePlayer`처럼 3단계
   * 폴백(전체 이동 → X축만 → Y축만)을 쓰지만, 그것도 다 막히면 몬스터(`moveMonsterInner`,
   * docs/backend/40)와 같은 접선 미끄러짐 + 탈출 점프까지 이어받는다 — "코어로
   * 돌아가는" 게 티모시의 정상적인 목적지 자체라(§tickCompanion의 returning 상태가
   * 코어 원점을 향해 곧장 걷는다), 축 슬라이딩만으로는 못 빠져나가는 각도에서
   * 코어 자체에 막혀 영원히 멈추는 버그가 실제로 있었다. 장애물 판정은 플레이어와
   * 같은 `isBlockedForPlayer`를 쓰고(1마리뿐이라 몬스터 전용 분리 벡터는 필요 없다),
   * 접선/탈출 계산은 플레이어·티모시가 막히는 대상(건축물·자원·콜로니·코어)까지
   * 다루는 `findNearestObstacleCenterForPlayer`를 쓴다.
   */
  private moveCompanionToward(targetX: number, targetY: number, dtSeconds: number): void {
    const companion = this.companion;
    const dx = targetX - companion.x;
    const dy = targetY - companion.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= 0) return;

    const dirX = dx / distance;
    const dirY = dy / distance;
    companion.facingX = dirX;
    companion.facingY = dirY;

    const step = companionData.moveSpeed * dtSeconds;
    const fullX = companion.x + dirX * step;
    const fullY = companion.y + dirY * step;
    if (!this.isBlockedForPlayer(fullX, fullY)) {
      companion.x = fullX;
      companion.y = fullY;
      companion.stuckSeconds = 0; // 완전히 자유로운 이동 — 확실히 안 막혔다
      return;
    }

    // 여기부터는 뭔가 막혀서 폴백이 필요한 상태다 — moveMonsterInner와 같은 이유로
    // 폴백이 성공해도 stuckSeconds는 리셋하지 않는다(여러 장애물에 둘러싸인 "주머니"에서
    // 매 틱 조금씩만 미끄러지며 계속 폴백에 의존하는 상태를 놓치지 않기 위함).
    companion.stuckSeconds += dtSeconds;

    // dirX/dirY가 정확히 0이면 그 축 "이동"은 제자리라(현재 좌표 그대로), 우연히
    // 막힘 검사를 통과해도 실제로는 안 움직인 것이다 — 방향 성분이 실제로 있을 때만
    // 그 축 결과를 인정한다(moveMonsterInner와 같은 안전장치).
    if (dirX !== 0 && !this.isBlockedForPlayer(fullX, companion.y)) {
      companion.x = fullX;
    } else if (dirY !== 0 && !this.isBlockedForPlayer(companion.x, fullY)) {
      companion.y = fullY;
    } else {
      const obstacle = this.findNearestObstacleCenterForPlayer(companion.x, companion.y);
      if (obstacle) {
        const radialX = companion.x - obstacle.x;
        const radialY = companion.y - obstacle.y;
        const radialLength = Math.hypot(radialX, radialY);

        if (radialLength > 0) {
          const tangentAX = -radialY / radialLength;
          const tangentAY = radialX / radialLength;
          const tangentBX = radialY / radialLength;
          const tangentBY = -radialX / radialLength;
          const useTangentA = tangentAX * dirX + tangentAY * dirY >= tangentBX * dirX + tangentBY * dirY;
          const tangentX = useTangentA ? tangentAX : tangentBX;
          const tangentY = useTangentA ? tangentAY : tangentBY;

          const tangentFullX = companion.x + tangentX * step;
          const tangentFullY = companion.y + tangentY * step;
          if (!this.isBlockedForPlayer(tangentFullX, tangentFullY)) {
            companion.x = tangentFullX;
            companion.y = tangentFullY;
          }
        }
      }
    }

    if (companion.stuckSeconds >= STUCK_ESCAPE_SECONDS) {
      this.tryEscapeStuckCompanion(dirX, dirY);
      companion.stuckSeconds = 0;
    }
  }

  /** `tryEscapeStuckMonster`의 티모시 버전 — 원래 가려던 방향을 정면으로 두고
   * 좌우로 부채꼴을 넓혀가며 처음 안 막힌 자리로 점프한다. */
  private tryEscapeStuckCompanion(normX: number, normY: number): void {
    const companion = this.companion;
    const desiredAngle =
      normX !== 0 || normY !== 0 ? Math.atan2(normY, normX) : Math.atan2(companion.y, companion.x);

    const ANGLE_STEP = Math.PI / 8; // 22.5도
    for (let attempt = 0; attempt < STUCK_ESCAPE_ATTEMPTS; attempt += 1) {
      const side = attempt % 2 === 0 ? 1 : -1;
      const magnitude = Math.ceil(attempt / 2);
      const angle = desiredAngle + side * magnitude * ANGLE_STEP + (this.rng() - 0.5) * 0.1;
      const candidateX = companion.x + Math.cos(angle) * STUCK_ESCAPE_DISTANCE;
      const candidateY = companion.y + Math.sin(angle) * STUCK_ESCAPE_DISTANCE;
      if (!this.isBlockedForPlayer(candidateX, candidateY)) {
        companion.x = candidateX;
        companion.y = candidateY;
        return;
      }
    }
  }

  /**
   * AI 동반자(티모시) 상태머신 — 자원 채집/운반만 한다(전투/대사 없음,
   * docs/superpowers/specs/2026-08-07-ai-companion-timothy-design.md).
   */
  private tickCompanion(dtSeconds: number): void {
    const companion = this.companion;
    if (!this.companionActive()) return;

    if (companion.state === 'seeking') {
      const node = this.findNearestHarvestableNode(companion.x, companion.y);
      if (!node) return; // 캘 게 없으면 그 자리에서 대기
      companion.targetNodeId = node.id;
      companion.state = 'traveling';
      return;
    }

    if (companion.state === 'traveling') {
      const node = companion.targetNodeId ? this.resourceNodes.get(companion.targetNodeId) : undefined;
      if (!node || node.hp <= 0) {
        // 다른 사람이 먼저 캤을 수도 있다 — 노드가 사라졌으면 다시 찾는다.
        companion.targetNodeId = undefined;
        companion.state = 'seeking';
        return;
      }
      const distance = Math.hypot(node.x - companion.x, node.y - companion.y);
      if (distance <= companionData.harvestRange) {
        companion.state = 'harvesting';
      } else {
        this.moveCompanionToward(node.x, node.y, dtSeconds);
      }
      return;
    }

    if (companion.state === 'harvesting') {
      const node = companion.targetNodeId ? this.resourceNodes.get(companion.targetNodeId) : undefined;
      if (!node || node.hp <= 0) {
        companion.targetNodeId = undefined;
        companion.state = 'seeking';
        return;
      }
      companion.harvestTimer -= dtSeconds;
      if (companion.harvestTimer > 0) return;
      companion.harvestTimer = companionData.harvestIntervalSeconds;

      const data = resourcesData[node.type];
      node.hp = Math.max(0, node.hp - companionData.harvestDamage);
      if (node.hp > 0) return;

      // 사람이 캘 때와 같은 고갈 부수효과(리스폰 타이머/장애물 재계산) — 다른 점은
      // 바닥에 드랍 아이템을 만들지 않고 바로 들고 간다는 것뿐이다(인벤토리/줍기 UI가
      // 없는 봇이라 그 단계를 생략한다).
      node.respawnTimer = data.respawnSeconds;
      this.rebuildResourceObstacleCells();
      this.recomputeFlowField();
      if (node.type === 'wood') companion.carriedWood += data.yieldOnDeplete;
      else companion.carriedStone += data.yieldOnDeplete;

      companion.targetNodeId = undefined;
      const carried = companion.carriedWood + companion.carriedStone;
      companion.state = carried >= companionData.capacity ? 'returning' : 'seeking';
      return;
    }

    if (companion.state === 'returning') {
      if (isWithinCoreInteract(companion.x, companion.y)) {
        companion.state = 'depositing';
      } else {
        this.moveCompanionToward(0, 0, dtSeconds);
      }
      return;
    }

    // depositing
    if (companion.carriedWood > 0) this.core.storage.add('wood', companion.carriedWood);
    if (companion.carriedStone > 0) this.core.storage.add('stone', companion.carriedStone);
    companion.carriedWood = 0;
    companion.carriedStone = 0;
    companion.state = 'seeking';
  }

  private damageCompanion(amount: number): void {
    if (!this.companionActive()) return;
    this.companion.hp = Math.max(0, this.companion.hp - amount);
    if (this.companion.hp <= 0) {
      this.companion.state = 'downed';
      // 피해를 주는 쪽이 모두 'downed'를 걸러내므로 이 전환은 딱 한 번만 일어난다.
      const nearestId = this.findNearestPlayerId(this.companion.x, this.companion.y);
      if (nearestId) this.enqueueCompanionPersonaEvent('companionDowned', nearestId);
    }
  }

  /**
   * 몬스터 행동: 어그로 반경 + 시야각(120도) 안에 플레이어가 있으면 직접 추격(돌진형/보스),
   * 아니면 Flow Field를 따라 코어로 향한다(잡몹/탱커형). 사거리 안에 들어오면 이동을
   * 멈추고 공격 주기(attackInterval)마다 대미지를 준다. 실제 이동에는 군집 분리를
   * 섞어서(moveMonster) 여러 마리가 완전히 겹쳐 스택되지 않게 한다.
   *
   * 살아있는 목표(추격 타겟/코어)보다 **막는 건축물이 항상 우선**이다 — 처음엔 반대로
   * "타겟이 사거리 안이면 무조건 타겟부터"였는데, 그러면 코어/플레이어를 벽으로 완전히
   * 둘러싸도 몬스터가 raw 거리만으로 사거리 판정을 통과해서 벽을 그냥 뚫고 공격해
   * 버렸다(실제로 코어를 8방향 벽으로 둘러싼 뒤 관찰해서 재현 확인, docs/backend/27) —
   * 벽이 있으나 마나였다. 이제는 공격 사거리 안에 이동을 막는 건축물이 있으면 그것부터
   * 처리하고, 없을 때만 타겟/코어를 공격한다(docs/backend/24, 기술명세 §5.3 "막힘 감지"의
   * 단순화 버전 — 정밀한 우회 비용 비교 대신 기존 근접 판정과 동일한 반경 기반 규칙을 쓴다).
   *
   * `facingX/Y`는 이 함수가 매 틱 끝에 갱신한다 — 추격 중이면 타겟 방향, 코어를 공격
   * 중이면 코어 방향, 그 외엔 Flow Field 방향. 전부 이미 계산해 둔 벡터라 이 갱신
   * 자체는 추가 비용이 거의 없다(대입 두 번).
   */
  private tickMonsters(dtSeconds: number): void {
    // 이번 틱 시작 시점 기준으로 그리드를 다시 채운다 — moveMonster를 안 거치고
    // 몬스터 좌표가 바뀔 수 있는 경로(테스트의 직접 대입 등, fireWeapon과 같은 이유)를
    // 대비한 안전망이다. 이후 이 루프 안에서 moveMonster가 호출될 때마다 증분
    // 갱신되므로(try/finally), 이 틱 안에서는 항상 "지금까지 처리된 몬스터는 최신
    // 위치, 아직 처리 안 된 몬스터는 이번 틱 시작 위치"를 정확히 반영한다 — 기존
    // (그리드 도입 전) computeSeparation이 살아있는 this.monsters를 그대로 순회하며
    // 갖던 것과 같은 순서 의존적 동작이다.
    this.rebuildMonsterGrid();
    for (const monster of this.monsters.values()) {
      const data = monstersData[monster.type];
      monster.attackCooldown = Math.max(0, monster.attackCooldown - dtSeconds);
      monster.attackAnimTimer = Math.max(0, monster.attackAnimTimer - dtSeconds);
      if (monster.attackAnimTimer === 0) monster.attackAnim = 0;
      for (let i = 0; i < monster.meleeCooldowns.length; i += 1) {
        monster.meleeCooldowns[i] = Math.max(0, monster.meleeCooldowns[i]! - dtSeconds);
      }

      // 보스 특수 패턴이 이번 틱의 이동/공격을 전부 처리했으면(예고 중이라 멈춰 있거나
      // 돌진 중이거나) 아래 일반 추격/이동 로직은 건너뛴다. meleeAttacks가 없는
      // 타입(잡몹 등)은 매 틱 이 검사 하나만 거치고 바로 false를 반환한다.
      if (this.tickAttackPattern(monster, data, dtSeconds)) continue;

      // 콜로니 수호대는 코어 침공 AI를 아예 타지 않는다 — 리시 안 플레이어 요격,
      // 없으면 귀환 후 저장 복귀가 전부다.
      if (monster.homeColonyId) {
        this.tickGuard(monster, data, dtSeconds);
        continue;
      }

      const target = data.aggroRadius
        ? this.resolveAggroTarget(monster, data.aggroRadius)
        : undefined;

      if (target) {
        const distance = Math.hypot(target.x - monster.x, target.y - monster.y);
        // 거리가 0이면 방향을 정의할 수 없으니(같은 좌표) 바라보던 방향을 그대로 둔다.
        if (distance > 0) {
          monster.facingX = (target.x - monster.x) / distance;
          monster.facingY = (target.y - monster.y) / distance;
        }

        const blocker = this.findBlockingBuildingInRange(monster, data.attackRange);
        if (blocker) {
          if (monster.attackCooldown <= 0) {
            this.startBasicAttack(monster, data, { kind: 'building', id: blocker.id });
          }
        } else if (distance <= data.attackRange) {
          if (monster.attackCooldown <= 0) {
            this.startBasicAttack(monster, data, { kind: 'player', id: target.id });
          }
        } else {
          // 자원 노드/콜로니가 경로를 막아도 moveMonster가 축 슬라이딩으로 알아서
          // 미끄러지며 우회한다(docs/backend/40) — 여기서 따로 멈출지 말지 검사하지 않는다.
          this.moveMonster(monster, monster.facingX, monster.facingY, data.speed, dtSeconds);
        }
        continue;
      }

      const distanceToCore = Math.hypot(monster.x, monster.y);

      const blocker = this.findBlockingBuildingInRange(monster, data.attackRange);
      if (blocker) {
        if (monster.attackCooldown <= 0) {
          this.startBasicAttack(monster, data, { kind: 'building', id: blocker.id });
        }
        continue;
      }

      // 코어로 가는 길에 티모시가 서 있으면 그를 먼저 친다. 추격 대상은 사람뿐이라
      // (resolveAggroTarget) 여기서 따로 봐 주지 않으면, 몬스터가 티모시를 그대로
      // 지나쳐 코어만 때리게 된다.
      if (
        this.companionActive() &&
        Math.hypot(this.companion.x - monster.x, this.companion.y - monster.y) <=
          data.attackRange + HIT_RADIUS
      ) {
        if (monster.attackCooldown <= 0) {
          this.startBasicAttack(monster, data, { kind: 'companion' });
        }
        continue;
      }

      // 코어 "도달"은 중심 거리가 아니라 발자국 가장자리 기준이다 — 어느 방향에서
      // 와도 보이는 받침대 앞에서 멈춰 때린다.
      if (coreDistance(monster.x, monster.y) <= data.attackRange) {
        if (distanceToCore > 0) {
          monster.facingX = -monster.x / distanceToCore;
          monster.facingY = -monster.y / distanceToCore;
        }
        if (monster.attackCooldown <= 0) {
          this.startBasicAttack(monster, data, { kind: 'core' });
        }
        continue;
      }

      // 코어까지 막힌 셀이 없으면 Flow Field(격자 8방향으로만 방향을 낼 수 있어 각도가
      // 유한하게 끊긴다) 대신 코어를 향한 진짜 연속각으로 직진시킨다 — 실제로 피할
      // 장애물이 있을 때만 Flow Field 방향으로 우회한다(backend/21).
      const direct = this.flowField.hasLineOfSight(monster.x, monster.y, 0, 0);
      let dir = direct
        ? { x: -monster.x / distanceToCore, y: -monster.y / distanceToCore }
        : this.flowField.sampleDirection(monster.x, monster.y);

      if (dir.x === 0 && dir.y === 0) {
        // Flow Field로도 도달 경로를 못 찾은 경우 — 예를 들어 코어를 건축물로 완전히
        // 둘러싸면 Dijkstra가 그 안쪽에 아예 도달을 못 해서 바깥의 모든 셀이 도달 불가로
        // 남는다. 그렇다고 몬스터를 그 자리에 멈춰 세우면 "건물로 코어를 완전히 둘러싸면
        // 무적이 된다"는 방어 게임으로선 말이 안 되는 허점이 생긴다. 우회로가 없어도
        // 코어를 향해 계속 직진시켜서, 결국 가로막은 건축물에 부딪히면(사거리 안에
        // 들어오면) 위 `findBlockingBuildingInRange`가 잡아서 부수기 시작하게 한다.
        dir = { x: -monster.x / distanceToCore, y: -monster.y / distanceToCore };
      }

      monster.facingX = dir.x;
      monster.facingY = dir.y;

      // FlowField는 셀(16px) 단위로만 "막혔다/열렸다"를 판정하는데, 자원 노드/콜로니의
      // 실제 충돌 원은 셀 경계와 딱 맞아떨어지지 않는다 — 그래서 셀 기준으로는
      // "우회하는 경로"로 보여도, 그 경로가 실제 충돌 원 아주 가까이(또는 코너를 스치듯)
      // 지나가는 순간이 생길 수 있다. moveMonster의 축 슬라이딩이 그 마지막 몇십 px의
      // 정밀도를 담당한다(docs/backend/40) — 셀 기반 라우팅은 큰 그림의 우회만 맡는다.
      this.moveMonster(monster, dir.x, dir.y, data.speed, dtSeconds);
    }
  }

  /**
   * 보스 전용 검술의 상태 전이를 한 틱 진행한다. `meleeAttacks` 데이터가
   * 없는 타입(잡몹 등)은 이 검사 하나만 거치고 즉시
   * false를 반환해서 일반 몹의 틱 비용을 사실상 늘리지 않는다.
   *
   * true를 반환하면 이번 틱의 이동/공격을 이 메서드가 전부 처리했다는 뜻이라, 호출부
   * (tickMonsters)는 일반 추격/코어 공격/Flow Field 이동 로직을 건너뛰어야 한다 —
   * 예고 중에는 몬스터가 그 자리에 멈춰 있어야 화면에 미리 보여준 위험 범위와 실제
   * 판정 범위가 어긋나지 않는다.
   */
  private tickAttackPattern(monster: MonsterEntity, data: MonsterData, dtSeconds: number): boolean {
    switch (monster.pattern.kind) {
      case 'basicSwing':
        return this.tickBasicSwing(monster, data, dtSeconds);
      case 'meleeSwing':
        return this.tickMeleeSwing(monster, data, dtSeconds);
      case 'meleeRecover':
        return this.tickMeleeRecover(monster, dtSeconds);
      case 'idle':
        return data.meleeAttacks ? this.tryStartBossPattern(monster, data, dtSeconds) : false;
    }
  }

  /**
   * 유휴 상태에서 특수 패턴 발동을 시도한다. 쿨다운이 남아있거나 아그로 타겟이 없으면
   * false를 반환해서 그 틱은 평소처럼(추격/코어 공격/이동) 행동한다 — 특수 패턴은
   * 평소 행동을 "대체"하는 것이지 별도로 얹는 게 아니다.
   */
  private tryStartBossPattern(monster: MonsterEntity, data: MonsterData, dtSeconds: number): boolean {
    monster.specialAttackCooldown = Math.max(0, monster.specialAttackCooldown - dtSeconds);
    if (monster.specialAttackCooldown > 0) return false;

    // 무엇을 향해 휘두를지 정한다. 사람이 우선이고, 아무도 없으면 코어를 부순다 —
    // 보스에겐 별도의 평타가 없어서(패턴 3개가 전부다) 여기서 대상을 못 찾으면
    // 코어를 때릴 방법 자체가 없어진다.
    const target = this.bossPatternTarget(monster, data);
    if (!target) return false;

    const dxToTarget = target.x - monster.x;
    const dyToTarget = target.y - monster.y;
    // 방향은 중심까지의 거리로 정규화하고(단위벡터여야 한다), 사거리 비교만 대상의
    // 덩치를 뺀 "가장자리까지의 거리"로 한다 — 코어처럼 발자국이 크면 중심 거리로는
    // 검이 닿는데도 사거리 밖으로 판정된다.
    const centreDistance = Math.hypot(dxToTarget, dyToTarget);
    const targetDistance = Math.max(0, centreDistance - target.radius);

    // 쿨다운이 끝났고 사거리가 닿는 기술 중에서 **가중치로** 하나 고른다. 거리로 후보가
    // 갈리므로 붙으면 짧은 기술, 떨어지면 긴 기술이 나오고, 가중치가 "자주 나오는 동작"과
    // "가끔 나오는 큰 동작"을 나눈다 — 평타와 스킬이 따로 있는 게 아니라 셋 다 패턴이다.
    if (data.meleeAttacks) {
      const ready: number[] = [];
      data.meleeAttacks.forEach((attack, index) => {
        if ((monster.meleeCooldowns[index] ?? 0) > 0) return;
        // 타격이 여러 번인 기술은 그중 가장 먼 사거리로 후보를 가린다. 돌진이 붙은
        // 기술은 **돌진으로 좁히는 거리까지 더해서** 본다 — 간격을 메우는 게 돌진의
        // 존재 이유인데, 최종 사거리만 보면 이미 붙어 있을 때만 나와서 무의미해진다.
        const dashTravel = attack.dash
          ? attack.dash.speed * (attack.dash.toSeconds - attack.dash.fromSeconds)
          : 0;
        const reach = Math.max(...attack.hits.map((hit) => hit.range)) + dashTravel;
        if (targetDistance > reach) return;
        ready.push(index);
      });

      if (ready.length > 0) {
        const index = this.pickWeightedAttack(data.meleeAttacks, ready);
        const chosen = data.meleeAttacks[index]!;
        const dirX = centreDistance > 0 ? dxToTarget / centreDistance : monster.facingX;
        const dirY = centreDistance > 0 ? dyToTarget / centreDistance : monster.facingY;
        monster.facingX = dirX;
        monster.facingY = dirY;
        monster.pattern = {
          kind: 'meleeSwing',
          elapsed: 0,
          index,
          nextHit: 0,
          dirX,
          dirY,
          dashHitIds: new Set(),
        };
        // **동작이 곧 예고**이므로 모션은 지금 켠다. 타격 순간에 켜면 예고 내내 보스가
        // 가만히 서 있다가 맞은 뒤에야 칼을 휘두른다(실측으로 확인: 모션 지연 667ms =
        // 피해 지연 667ms). 판정 시점(atSeconds)은 재생 속도에 맞춰 잡혀 있어서,
        // 여기서 켜야 "칼이 뻗는 프레임에 맞는다"가 성립한다.
        const lastHitAt = chosen.hits[chosen.hits.length - 1]!.atSeconds;
        this.markAttack(monster, chosen.anim, lastHitAt + chosen.recoverSeconds);
        return true;
      }
      // 쓸 수 있는 검술이 없으면(전부 쿨다운이거나 너무 멀다) 평소처럼 추격한다.
      return false;
    }

    return false;
  }

  /**
   * 보스가 이번 패턴으로 노릴 대상. 사람 → 티모시 → 코어 순이다.
   *
   * 보스에겐 평타가 따로 없다(패턴 3개가 전부). 그래서 잡몹처럼 "쿨다운이면 평타"로
   * 흘려보낼 곳이 없고, 대상 선택을 여기서 한 번에 해결해야 코어도 부술 수 있다.
   * 반환하는 radius는 대상의 덩치다 — 코어는 발자국이 커서 중심까지의 거리로 재면
   * 검이 닿는데도 사거리 밖으로 판정된다.
   */
  private bossPatternTarget(
    monster: MonsterEntity,
    data: MonsterData,
  ): { x: number; y: number; radius: number } | undefined {
    const player = data.aggroRadius
      ? this.resolveAggroTarget(monster, data.aggroRadius)
      : undefined;
    if (player) return { x: player.x, y: player.y, radius: HIT_RADIUS };

    // 티모시는 **이미 검이 닿는 거리에 있을 때만** 노린다. 아그로 반경(수백 px)으로
    // 잡으면, 멀리 있는 티모시를 겨눈 채 사거리 밖이라 아무 기술도 못 쓰고, 그렇다고
    // 코어 앞이라 움직이지도 않는 교착에 빠진다(실제로 그랬다). 쫓아갈 대상은 사람뿐이다.
    if (this.companionActive()) {
      const distance = Math.hypot(this.companion.x - monster.x, this.companion.y - monster.y);
      const reach = Math.max(
        ...(data.meleeAttacks ?? []).flatMap((attack) => attack.hits.map((h) => h.range)),
      );
      if (distance - HIT_RADIUS <= reach) {
        return { x: this.companion.x, y: this.companion.y, radius: HIT_RADIUS };
      }
    }

    // 코어는 항상 원점이다. 중심까지의 거리에서 발자국 반경을 빼야 "가장자리까지의
    // 거리"가 되므로, 몬스터 위치에서 잰 coreDistance로 반경을 역산한다.
    const centreDistance = Math.hypot(monster.x, monster.y);
    const edgeDistance = coreDistance(monster.x, monster.y);
    return { x: 0, y: 0, radius: Math.max(0, centreDistance - edgeDistance) };
  }

  /**
   * 쓸 수 있는 기술 중 하나를 가중치로 고른다. 가중치가 없으면 1로 본다 —
   * 전부 없으면 예전과 같은 균등 추첨이 된다.
   */
  private pickWeightedAttack(attacks: readonly MeleeAttackData[], ready: readonly number[]): number {
    let total = 0;
    for (const index of ready) total += attacks[index]!.weight ?? 1;

    let roll = this.rng() * total;
    for (const index of ready) {
      roll -= attacks[index]!.weight ?? 1;
      if (roll <= 0) return index;
    }
    return ready[ready.length - 1]!;
  }

  /**
   * 근접 검술 진행 — 무기를 휘두르는 동안 멈춰 서 있는다. **방향은 시작 시점에
   * 고정한다**: 동작 내내 플레이어를 따라 돌면 "동작을 보고 옆으로 빠진다"는 이 기술의
   * 유일한 대응 수단이 사라진다.
   *
   * 경과 시간을 재면서 각 타격의 시점을 넘길 때마다 판정을 넣는다. 한 틱이 여러 타격
   * 시점을 한꺼번에 넘길 수도 있어서(느린 틱) `while`로 밀린 것까지 전부 처리한다 —
   * 안 그러면 2연타 중 하나가 조용히 사라진다.
   */
  private tickMeleeSwing(monster: MonsterEntity, data: MonsterData, dtSeconds: number): boolean {
    const pattern = monster.pattern as Extract<BossPatternState, { kind: 'meleeSwing' }>;
    const attack = data.meleeAttacks?.[pattern.index];
    if (!attack) {
      monster.pattern = { kind: 'idle' };
      return false;
    }

    monster.facingX = pattern.dirX;
    monster.facingY = pattern.dirY;
    pattern.elapsed += dtSeconds;

    // 돌진 구간이면 앞으로 밀고 나가면서 닿는 대상을 한 번씩 쓸어버린다.
    if (
      attack.dash &&
      pattern.elapsed >= attack.dash.fromSeconds &&
      pattern.elapsed <= attack.dash.toSeconds
    ) {
      this.tickMeleeDash(monster, attack.dash, pattern, dtSeconds);
    }

    while (
      pattern.nextHit < attack.hits.length &&
      pattern.elapsed >= attack.hits[pattern.nextHit]!.atSeconds
    ) {
      this.resolveMeleeHit(monster, attack, attack.hits[pattern.nextHit]!, pattern.dirX, pattern.dirY);
      pattern.nextHit += 1;
    }

    if (pattern.nextHit < attack.hits.length) return true;

    monster.meleeCooldowns[pattern.index] = attack.cooldown;
    monster.pattern = { kind: 'meleeRecover', timer: attack.recoverSeconds };
    return true;
  }

  /**
   * 돌진 한 틱 — 고정된 방향으로 밀고 나가며 몸에 닿는 대상을 **한 번씩만** 때린다.
   * 이동은 평소와 같은 `moveMonster`를 쓴다. 거구 보스는 crushesObstacles라 나무를
   * 밟고 지나가고, 그렇지 않은 타입이면 장애물 앞에서 자연히 멈춘다.
   */
  private tickMeleeDash(
    monster: MonsterEntity,
    dash: NonNullable<MeleeAttackData['dash']>,
    pattern: Extract<BossPatternState, { kind: 'meleeSwing' }>,
    dtSeconds: number,
  ): void {
    // 출발점은 첫 틱에 한 번만 기록한다 — 직사각형 판정이 "여기서부터 지금까지"를 덮는다.
    if (pattern.dashOriginX === undefined) {
      pattern.dashOriginX = monster.x;
      pattern.dashOriginY = monster.y;
    }
    this.moveMonster(monster, pattern.dirX, pattern.dirY, dash.speed, dtSeconds);

    const hits = (x: number, y: number): boolean => this.dashCovers(dash, pattern, monster, x, y);

    for (const player of this.players.values()) {
      if (player.hp <= 0 || pattern.dashHitIds.has(player.id)) continue;
      if (!hits(player.x, player.y)) continue;
      this.damagePlayer(player, dash.damage);
      pattern.dashHitIds.add(player.id);
    }

    if (
      this.companionActive() &&
      !pattern.dashHitIds.has('companion') &&
      hits(this.companion.x, this.companion.y)
    ) {
      this.damageCompanion(dash.damage);
      pattern.dashHitIds.add('companion');
    }
  }

  /**
   * 돌진이 이 지점을 덮었는가.
   *
   * `halfWidth`가 있으면 **출발점에서 현재 위치까지의 직사각형**이다 — 진행 방향으로
   * 얼마나 왔는지(along)와 옆으로 얼마나 벗어났는지(side)를 따로 재서, 길이는 돌진
   * 거리로 폭은 데이터로 정한다. 원 판정은 폭이 곧 사거리라 길게 만들수록 사방이
   * 넓어져 옆으로 피할 방향이 사라진다(골렘 돌격에서 실제로 그랬다).
   *
   * `halfWidth`가 없으면 예전처럼 몬스터를 중심으로 한 원이다.
   */
  private dashCovers(
    dash: NonNullable<MeleeAttackData['dash']>,
    pattern: Extract<BossPatternState, { kind: 'meleeSwing' }>,
    monster: MonsterEntity,
    x: number,
    y: number,
  ): boolean {
    if (dash.halfWidth === undefined) {
      return circlesOverlap(monster.x, monster.y, x, y, (dash.radius ?? 0) + HIT_RADIUS);
    }

    const originX = pattern.dashOriginX ?? monster.x;
    const originY = pattern.dashOriginY ?? monster.y;
    const travelled = (monster.x - originX) * pattern.dirX + (monster.y - originY) * pattern.dirY;
    const along = (x - originX) * pattern.dirX + (y - originY) * pattern.dirY;
    // 진행 방향의 수직 성분. dir은 단위벡터라 이 식이 곧 옆으로 벗어난 거리다.
    const side = Math.abs((x - originX) * -pattern.dirY + (y - originY) * pattern.dirX);

    // 앞뒤로는 몸통 반경만큼 여유를 준다 — 출발점 바로 앞이나 도착점 바로 뒤에 붙어
    // 있는 대상이 통로 밖으로 새는 게 더 이상하다.
    const margin = monsterRadius(monster);
    return along >= -margin && along <= travelled + margin && side <= dash.halfWidth + HIT_RADIUS;
  }

  /** 검을 휘두른 뒤 경직. 그냥 시간만 흘려보낸다(이동·공격 없음). */
  private tickMeleeRecover(monster: MonsterEntity, dtSeconds: number): boolean {
    const pattern = monster.pattern as Extract<BossPatternState, { kind: 'meleeRecover' }>;
    pattern.timer -= dtSeconds;
    if (pattern.timer <= 0) {
      monster.pattern = { kind: 'idle' };
      // 기술 하나가 끝났으니 다시 "가장 가까운 사람"을 고른다 — 보스도 같은 규칙이다.
      this.clearAggroAfterAttack(monster);
    }
    return true;
  }

  /**
   * 검술 판정 한 번. 플레이어와 티모시 모두 부채꼴 안에 있으면 맞는다 —
   * 플레이어 무기와 **같은 함수**(withinMeleeArc)를 써서 "보이는 부채꼴 = 맞는 범위"
   * 규칙이 양쪽에서 어긋나지 않게 한다.
   */
  private resolveMeleeHit(
    monster: MonsterEntity,
    attack: MeleeAttackData,
    swing: MeleeHitData,
    dirX: number,
    dirY: number,
  ): void {
    const hit = {
      // ownerId는 "누구의 명중으로 칠지"를 가리는 값이라 플레이어 무기에만 의미가
      // 있다(withinMeleeArc는 쓰지 않는다). 몬스터 공격에는 주인이 없으니 몬스터
      // 자신의 id를 넣어 형태만 맞춘다.
      ownerId: monster.id,
      originX: monster.x,
      originY: monster.y,
      range: swing.range,
      aimAngle: Math.atan2(dirY, dirX),
      // 360도면 halfArc가 π가 되어 withinMeleeArc가 방향을 아예 안 본다(전방향 광역).
      halfArc: (swing.arc * Math.PI) / 360,
      damage: swing.damage,
    };

    for (const player of this.players.values()) {
      if (player.hp <= 0) continue;
      if (!withinMeleeArc(hit, player.x, player.y, HIT_RADIUS)) continue;
      this.damagePlayer(player, swing.damage);
    }
    if (this.companionActive() && withinMeleeArc(hit, this.companion.x, this.companion.y, HIT_RADIUS)) {
      this.damageCompanion(swing.damage);
    }

    // 코어와 앞을 막은 건축물도 같은 부채꼴에 든다. 보스는 평타가 없어졌으므로
    // (§startBasicAttack) 이 판정이 없으면 코어를 부술 방법 자체가 사라진다 —
    // 휘두른 자리에 있는 것은 사람이든 벽이든 다 맞는 게 자연스럽기도 하다.
    const coreEdge = coreDistance(monster.x, monster.y);
    if (coreEdge <= swing.range) {
      const toCore = Math.atan2(-monster.y, -monster.x);
      if (hit.halfArc >= FULL_ARC || angleDifference(toCore, hit.aimAngle) <= hit.halfArc) {
        this.core.hp = Math.max(0, this.core.hp - swing.damage);
      }
    }
    for (const building of this.buildings.values()) {
      if (!buildingsData[building.type].blocksMovement) continue;
      if (!withinMeleeArc(hit, building.x, building.y, TILE_SIZE / 2)) continue;
      building.hp = Math.max(0, building.hp - swing.damage);
      if (building.hp <= 0) this.removeBuilding(building);
    }
    // 여기서 markAttack을 다시 부르지 않는다 — 동작 시작 때 이미 켰고, 2연타에서
    // 다시 켜면 애니메이션이 첫 장부터 재시작해 두 번째 타격이 어긋난다.
  }

  /** 공격 사거리 안의, 이동을 막는(blocksMovement) 건축물 중 가장 가까운 것을 찾는다. */
  private findBlockingBuildingInRange(
    monster: MonsterEntity,
    range: number,
  ): BuildingEntity | undefined {
    let nearest: BuildingEntity | undefined;
    let nearestDistance = range;

    for (const building of this.buildings.values()) {
      if (!buildingsData[building.type].blocksMovement) continue;
      const distance = Math.hypot(building.x - monster.x, building.y - monster.y);
      if (distance <= nearestDistance) {
        nearest = building;
        nearestDistance = distance;
      }
    }

    return nearest;
  }

  /**
   * 이동을 막는(blocksMovement) 건축물, 그리고 코어/자원 노드/콜로니와 겹치는지
   * 검사한다(플레이어 하드 충돌, docs/backend/38). 건축물은 `blocksMovement`
   * 타입만 막지만 코어/자원/콜로니는 예외 없이 전부 막는다(사용자가 "코어, 나무,
   * 돌, 콜로니 다" 통과 못 하게 해달라고 명시).
   */
  /**
   * 실제 판정은 `playerCollision.ts`의 `isPlayerBlocked`다 — 클라이언트 예측
   * (`PlayerPredictor`)이 같은 함수를 스냅샷 데이터로 그대로 호출해서 서버와
   * 어긋나지 않게 하려고 순수 함수로 뽑아 뒀다. 이 메서드는 `World`가 들고 있는
   * Map들을 그 함수가 받는 형태로 넘겨주는 얇은 어댑터일 뿐이다.
   */
  private isBlockedForPlayer(x: number, y: number): boolean {
    return isPlayerBlocked(
      x,
      y,
      this.buildings.values(),
      this.resourceNodes.values(),
      this.colonies.values(),
    );
  }

  /**
   * 몬스터가 (x,y)에 있다고 가정했을 때 자원 노드/콜로니와 겹치는지 검사한다.
   * `isBlockedForPlayer`와 같은 모양이지만 반경이 `HIT_RADIUS`(플레이어 고정값) 대신
   * 인자로 받은 몬스터 반경(`monsterRadius(monster)`, 타입마다 다름)이다.
   *
   * 건축물은 여기서 다루지 않는다 — 몬스터에게 건축물은 "부수는 대상"이라
   * `findBlockingBuildingInRange`가 따로 처리한다(가로막으면 멈추는 게 아니라
   * 공격해서 없앤다). 코어도 다루지 않는다 — 몬스터의 목표 자체라 막으면 안 된다
   * (docs/backend/38).
   */
  /**
   * `crushes`가 true면 자원 노드/콜로니를 통과한다(거구 보스). 회피가 물리적으로
   * 불가능한 덩치라 막아봐야 갈리기만 하고, 거대한 보스가 나무 한 그루에 멈춰 서는
   * 그림도 이상하다(§MonsterData.crushesObstacles).
   */
  private isBlockedForMonster(
    x: number,
    y: number,
    monsterR: number,
    crushes = false,
  ): boolean {
    if (crushes) return false;
    for (const node of this.resourceNodes.values()) {
      if (node.hp <= 0) continue; // 고갈된 자리는 통과할 수 있다(docs/backend/39)
      if (circlesOverlap(x, y, node.x, node.y, monsterR + resourcesData[node.type].hitRadius)) {
        return true;
      }
    }
    for (const colony of this.colonies.values()) {
      if (circlesOverlap(x, y, colony.x, colony.y, monsterR + COLONY_RADIUS)) return true;
    }
    return false;
  }

  /**
   * (x,y) 기준으로 "경계에 가장 바짝 붙어 있는" 자원 노드/콜로니의 중심 좌표를 찾는다.
   * `moveMonster`의 접선(탄젠트) 미끄러짐 폴백이 쓴다 — 원형 장애물은 어느 방향이
   * 막혔는지가 아니라 "장애물 중심에서 몬스터로 향하는 방향"을 알아야 그 방향에
   * 수직인 접선으로 미끄러뜨릴 수 있다. 거리에서 막힘 반경을 뺀 값(음수면 이미
   * 겹친 것)이 가장 작은 후보를 고른다 — 지금 이 몬스터를 막고 있는 바로 그
   * 장애물을 찾기 위함이다.
   */
  private findNearestObstacleCenter(
    x: number,
    y: number,
    monsterR: number,
  ): { x: number; y: number } | undefined {
    let nearest: { x: number; y: number } | undefined;
    let nearestGap = Infinity;

    for (const node of this.resourceNodes.values()) {
      if (node.hp <= 0) continue;
      const gap = Math.hypot(node.x - x, node.y - y) - (monsterR + resourcesData[node.type].hitRadius);
      if (gap < nearestGap) {
        nearestGap = gap;
        nearest = { x: node.x, y: node.y };
      }
    }
    for (const colony of this.colonies.values()) {
      const gap = Math.hypot(colony.x - x, colony.y - y) - (monsterR + COLONY_RADIUS);
      if (gap < nearestGap) {
        nearestGap = gap;
        nearest = { x: colony.x, y: colony.y };
      }
    }

    return nearest;
  }

  /**
   * `findNearestObstacleCenter`의 플레이어/티모시용 버전 — `isBlockedForPlayer`가
   * 막는 것과 정확히 같은 대상(이동을 막는 건축물, 자원 노드, 콜로니, 코어)을 본다.
   * 몬스터용은 코어/건축물을 안 다루는데(몬스터에게 코어는 목표, 건축물은 부수는
   * 대상이라 따로 처리), 티모시는 코어로 "돌아가는" 것 자체가 목적지라 코어 자체가
   * 장애물로 잡힐 일이 흔하다 — 실제로 이 케이스에서 막혀서 못 움직이는 버그가
   * 있었다.
   *
   * 코어는 원이 아니라 8각형(coreShape.ts)이지만, 접선 방향만 필요한 이 용도로는
   * 원점을 중심으로 근사해도 충분하다(받침대가 원점 대칭에 가깝게 설계됨,
   * §CORE_ORIGIN_Y). 거리 자체(gap)는 `coreDistance`가 실제 윤곽 기준으로 정확히
   * 재준다.
   */
  private findNearestObstacleCenterForPlayer(
    x: number,
    y: number,
  ): { x: number; y: number } | undefined {
    let nearest: { x: number; y: number } | undefined;
    let nearestGap = Infinity;

    for (const building of this.buildings.values()) {
      if (!buildingsData[building.type].blocksMovement) continue;
      const gap = Math.hypot(building.x - x, building.y - y) - PLAYER_BUILDING_COLLISION_RADIUS;
      if (gap < nearestGap) {
        nearestGap = gap;
        nearest = { x: building.x, y: building.y };
      }
    }
    for (const node of this.resourceNodes.values()) {
      if (node.hp <= 0) continue;
      const gap = Math.hypot(node.x - x, node.y - y) - (HIT_RADIUS + resourcesData[node.type].hitRadius);
      if (gap < nearestGap) {
        nearestGap = gap;
        nearest = { x: node.x, y: node.y };
      }
    }
    for (const colony of this.colonies.values()) {
      const gap = Math.hypot(colony.x - x, colony.y - y) - PLAYER_COLONY_COLLISION_RADIUS;
      if (gap < nearestGap) {
        nearestGap = gap;
        nearest = { x: colony.x, y: colony.y };
      }
    }
    // 마지막 후보라 갱신 후 다시 비교할 일이 없다 — nearestGap을 더 안 건드린다.
    if (coreDistance(x, y) < nearestGap) {
      nearest = { x: 0, y: 0 };
    }

    return nearest;
  }

  /**
   * 플레이어를 건축물과 겹치지 않는 선에서 이동시킨다.
   *
   * 전체 이동이 막히면 X축만, 그것도 막히면 Y축만 시도한다(축 슬라이딩) — 벽에 대각선으로
   * 부딪혔을 때 완전히 멈추는 대신 벽을 따라 미끄러지듯 이동하게 하기 위함이다.
   */
  private movePlayer(
    player: PlayerEntity,
    moveX: number,
    moveY: number,
    dtSeconds: number,
  ): void {
    const speed = this.playerSpeedMultiplier(player);
    const resolved = resolvePlayerMove(player.x, player.y, moveX, moveY, dtSeconds, speed, (x, y) =>
      this.isBlockedForPlayer(x, y),
    );
    player.x = resolved.x;
    player.y = resolved.y;
  }

  /**
   * 어그로 규칙(멀티/싱글 공통).
   *
   *   시야 안에서 가장 가까운 플레이어를 잡는다 → 사거리에 들어오면 **공격 1회** →
   *   그 즉시 타겟을 놓고 다시 탐색한다. 시야 안에 아무도 없을 때만 코어로 향한다.
   *
   * 매 틱 새로 계산하지 않고 공격 사이에만 유지하는 이유: 매 틱 "가장 가까운 사람"을
   * 다시 고르면 두 명이 경계 부근에 걸쳐 있을 때 타겟이 왔다 갔다 하며 이동 방향이
   * 떨린다. 반대로 영원히 붙잡고 있으면 여럿이 둘러싼 상황에서 한 명만 계속 노려
   * "가장 가까운 사람을 친다"는 규칙이 무너진다. 한 번 때릴 때까지만 유지하는 것이
   * 두 문제를 동시에 피한다(§clearAggroAfterAttack).
   *
   * 추격 중에는 아그로 반경의 `AGGRO_LEASH_MULTIPLIER`배까지 따라붙는다 — 사거리
   * 직전에서 반경을 살짝 벗어났다고 놓아주면 영원히 못 잡는다.
   */
  private resolveAggroTarget(monster: MonsterEntity, aggroRadius: number): PlayerEntity | undefined {
    const current = monster.targetPlayerId ? this.players.get(monster.targetPlayerId) : undefined;
    if (current && current.hp > 0) {
      const distance = Math.hypot(current.x - monster.x, current.y - monster.y);
      if (distance <= aggroRadius * AGGRO_LEASH_MULTIPLIER) return current;
    }

    const next = this.findNearestPlayer(monster, aggroRadius);
    monster.targetPlayerId = next?.id;
    return next;
  }

  /**
   * 공격을 한 번 넣은 뒤 타겟을 놓는다. 다음 틱에 다시 "시야 안 가장 가까운 사람"을
   * 고르므로, 여럿이 둘러싸면 실제로 번갈아 맞게 된다.
   */
  private clearAggroAfterAttack(monster: MonsterEntity): void {
    monster.targetPlayerId = undefined;
  }

  /** 근처 몬스터가 겹치지 않도록 밀어내는 벡터(군집 분리, 기술명세 §5.3)를 계산한다. */
  /**
   * monsterGrid를 `this.monsters`의 현재 좌표로 통째로 다시 채운다. 몬스터 수만큼(O(M))
   * 이라 싸다 — moveMonster()를 거치지 않고 좌표가 바뀔 수 있는 지점(틱 시작 시점,
   * fireWeapon 진입 시점) 앞에서 호출해 그리드가 항상 최신 상태에서 출발하게 한다.
   */
  private rebuildMonsterGrid(): void {
    this.monsterGrid.clear();
    for (const monster of this.monsters.values()) {
      this.monsterGrid.insert(monster.id, monster.x, monster.y);
    }
  }

  private computeSeparation(monster: MonsterEntity): { x: number; y: number } {
    let x = 0;
    let y = 0;

    // 전체 몬스터를 다 보는 대신, SEPARATION_RADIUS가 걸치는 격자 칸의 후보만 본다
    // (docs/backend/45) — 판정 자체(거리 < SEPARATION_RADIUS)는 그대로라 결과는 같다.
    const candidateIds = this.monsterGrid.queryRadius(monster.x, monster.y, SEPARATION_RADIUS);
    for (const otherId of candidateIds) {
      if (otherId === monster.id) continue;
      const other = this.monsters.get(otherId);
      if (!other) continue; // 그리드 갱신과 monsters 삭제 사이 타이밍 상 이론상만 존재하는 방어선
      const dx = monster.x - other.x;
      const dy = monster.y - other.y;
      const distance = Math.hypot(dx, dy);
      if (distance > 0 && distance < SEPARATION_RADIUS) {
        const weight = (SEPARATION_RADIUS - distance) / SEPARATION_RADIUS;
        x += (dx / distance) * weight;
        y += (dy / distance) * weight;
      }
    }

    return { x, y };
  }

  /**
   * 주 이동 방향(단위 벡터일 필요 없음)에 군집 분리를 더하고, 자원 노드/콜로니에
   * 막히면 미끄러뜨려서 이동시킨다.
   *
   * **분리력 계산**: 주 방향과 분리 벡터를 먼저 더한 뒤 그 합을 단위 벡터로
   * 정규화하던 예전 방식은, 몬스터가 코어와 일직선(예: y=0 축)에 있을 때 분리력이
   * 주 방향과 같은 축 위에서만 작용하면 정규화 후 결국 둘 다 똑같은 단위 벡터로
   * 수렴해버려 — 분리력의 세기 차이가 사라지고 두 몬스터가 완전히 같은 거리만큼
   * 이동해 간격이 전혀 벌어지지 않는 버그가 있었다. 주 방향은 그 자체로 단위
   * 벡터로 정규화해 속도를 정하고, 분리 벡터는 별도의 변위로 그 위에 더해야
   * 몬스터마다 실제로 받는 분리력 세기가 이동 결과에 반영된다.
   *
   * **장애물 회피(docs/backend/40)**: 목적지가 자원 노드/콜로니와 겹치면 그
   * 자리에 완전히 멈추던 이전 방식(`findBlockingStaticObstacle`, docs/backend/38~39)은
   * 추격 중이던 몬스터가 경로의 자원 노드 하나에 막혀 영원히 멈춰버리는 버그,
   * 그리고 그렇게 멈춘 몬스터가 시야각도 같이 얼어붙어 근처를 스쳐 지나가는
   * 플레이어를 다시는 인지 못 하는 버그로 이어졌다. `movePlayer`/`isBlockedForPlayer`가
   * 쓰던 축 슬라이딩("전체 이동이 막히면 X축만, 그것도 막히면 Y축만")을 그대로
   * 옮겨 왔지만, 이것만으로는 부족했다 — 그 패턴은 **벽 같은 직선 장애물**
   * 전제라, 목표가 원형 장애물 중심과 거의 같은 x 또는 y 좌표에 있으면 X축
   * 이동도 Y축 이동도 둘 다 그 원 안으로 다시 파고드는 경우가 실제로 있다
   * (대각선 추격 경로가 자원 노드를 스치는 상황을 500틱 이상 추적해서 재현·
   * 확인). 그래서 셋째 폴백으로 **접선(탄젠트) 미끄러짐**을 추가했다: 장애물
   * 중심→몬스터 방향 벡터에 수직인 두 방향 중, 원래 가려던 방향과 더 가까운
   * 쪽으로 미끄러뜨린다 — 원의 표면을 따라 도는 동작이라 X/Y 축 슬라이딩이
   * 실패하는 바로 그 상황(장애물이 목표 방향의 정면을 가로막을 때)에서 특히
   * 잘 통한다.
   */
  private moveMonster(
    monster: MonsterEntity,
    dirX: number,
    dirY: number,
    speed: number,
    dtSeconds: number,
  ): void {
    // 아래 본문 안의 여러 return 지점(자유 이동/축 슬라이딩/접선 미끄러짐/탈출 점프)
    // 중 어느 쪽으로 끝나든 monster.x/y가 바뀔 수 있다 — try/finally로 감싸서
    // "몬스터 위치가 바뀌면 그리드도 같이 바뀐다"를 한 곳에서 보장한다(개별 return마다
    // 그리드 갱신 호출을 넣으면 새 return이 추가될 때 빠뜨리기 쉽다).
    try {
      this.moveMonsterInner(monster, dirX, dirY, speed, dtSeconds);
    } finally {
      this.monsterGrid.updateEntry(monster.id, monster.x, monster.y);
    }
  }

  private moveMonsterInner(
    monster: MonsterEntity,
    dirX: number,
    dirY: number,
    speed: number,
    dtSeconds: number,
  ): void {
    const separation = this.computeSeparation(monster);
    const dirLength = Math.hypot(dirX, dirY);
    const normX = dirLength > 0 ? dirX / dirLength : 0;
    const normY = dirLength > 0 ? dirY / dirLength : 0;

    const dx = (normX * speed + separation.x * speed * SEPARATION_WEIGHT) * dtSeconds;
    const dy = (normY * speed + separation.y * speed * SEPARATION_WEIGHT) * dtSeconds;
    const monsterR = monsterRadius(monster);
    const crushes = monstersData[monster.type]?.crushesObstacles === true;

    const fullX = monster.x + dx;
    const fullY = monster.y + dy;
    if (!this.isBlockedForMonster(fullX, fullY, monsterR, crushes)) {
      monster.x = fullX;
      monster.y = fullY;
      monster.stuckSeconds = 0; // 완전히 자유로운 이동 — 확실히 안 막혔다
      return;
    }

    // 여기부터는 뭔가 막혀서 폴백(축 슬라이딩/접선 미끄러짐)이 필요한 상태다.
    // 폴백 중 하나가 "성공"해도 stuckSeconds를 0으로 리셋하지 않는다 — 장애물
    // 하나의 모서리를 도는 정상적인 우회는 보통 1초 안에 끝나 escape 임계값을
    // 넘기 전에 다시 완전히 자유로운 이동으로 돌아간다(위에서 리셋됨). 반면 여러
    // 장애물이 촘촘히 둘러싼 "주머니"에서는 매 틱 아주 조금씩만 미끄러지며 계속
    // 폴백에 의존하는 상태가 길게 이어질 수 있는데, 여기서 리셋해버리면 "뭔가는
    // 계속 움직이니 안 막힌 것"으로 잘못 판단해 탈출 로직이 영원히 발동하지
    // 않는다(docs/backend/42, 스트레스 테스트로 발견한 버그).
    monster.stuckSeconds += dtSeconds;

    // dx/dy가 정확히 0이면(장애물과 정확히 같은 x축 또는 y축으로 접근하는 흔한
    // 경우) 그 축만의 "이동"은 사실 제자리(현재 좌표 그대로)다 — 아무 데도 안
    // 움직였으면서 막힘 여부만 우연히 통과할 수 있어, 그 축이 실제로 변할 때만
    // (dx/dy != 0) 결과를 인정한다.
    if (dx !== 0 && !this.isBlockedForMonster(fullX, monster.y, monsterR, crushes)) {
      monster.x = fullX;
    } else if (dy !== 0 && !this.isBlockedForMonster(monster.x, fullY, monsterR, crushes)) {
      monster.y = fullY;
    } else {
      // X/Y 축 슬라이딩도 안 됐다 — 목표가 장애물 중심과 거의 같은 x 또는 y라
      // 두 축 다 원 안으로 다시 파고드는 경우다. 장애물 표면을 따라 접선 방향으로
      // 미끄러뜨린다.
      const obstacle = this.findNearestObstacleCenter(monster.x, monster.y, monsterR);
      if (obstacle) {
        const radialX = monster.x - obstacle.x;
        const radialY = monster.y - obstacle.y;
        const radialLength = Math.hypot(radialX, radialY);

        if (radialLength > 0) {
          // 반경 벡터에 수직인 두 접선 후보 중, 원래 가려던 방향(dx,dy)과 내적이
          // 더 큰 쪽(더 그 방향에 가까운 쪽)을 고른다.
          const tangentAX = -radialY / radialLength;
          const tangentAY = radialX / radialLength;
          const tangentBX = radialY / radialLength;
          const tangentBY = -radialX / radialLength;
          const useTangentA = tangentAX * dx + tangentAY * dy >= tangentBX * dx + tangentBY * dy;
          const tangentX = useTangentA ? tangentAX : tangentBX;
          const tangentY = useTangentA ? tangentAY : tangentBY;

          const stepLength = Math.hypot(dx, dy);
          const tangentFullX = monster.x + tangentX * stepLength;
          const tangentFullY = monster.y + tangentY * stepLength;
          if (!this.isBlockedForMonster(tangentFullX, tangentFullY, monsterR, crushes)) {
            monster.x = tangentFullX;
            monster.y = tangentFullY;
          }
        }
      }

      // 넷 다 막혔거나(자원 노드 여러 개에 완전히 둘러싸인 경우) 장애물 자체를
      // 못 찾은 극단적인 경우 — 아무것도 안 하고 아래 탈출 검사로 넘어간다.
    }

    if (monster.stuckSeconds >= STUCK_ESCAPE_SECONDS) {
      this.tryEscapeStuckMonster(monster, normX, normY, monsterR, crushes);
      monster.stuckSeconds = 0; // 성공하든 실패하든 다음 주기에 새 각도로 다시 시도
    }
  }

  /**
   * 완전히 막힌 몬스터를 "원래 가려던 방향"(목표를 향한 정규화 방향, `normX/normY`)
   * 쪽으로 우선 점프시켜 탈출을 시도한다.
   *
   * 처음엔 가장 가까운 장애물 **반대쪽**으로 점프했는데, 실제로 써 보니(스크린샷
   * 제보) 갇힌 지점에서 원래 가려던 목표(코어/플레이어)와 정반대 방향으로 튕겨
   * 나가는 경우가 많았다 — 장애물 하나를 기준으로 "그것만 피하면 된다"고 판단한
   * 것이지 "결국 어디로 가고 싶은지"는 전혀 고려하지 않았기 때문이다. 목표
   * 방향을 정면으로 두고 좌우로 부채꼴을 벌려가며(`STUCK_ESCAPE_ATTEMPTS`회,
   * 22.5도씩 번갈아 좌우로 확대) 처음 안 막힌 후보를 쓴다 — 목표에서 완전히
   * 등지는 방향보다 목표 쪽으로 최대한 붙은 우회를 먼저 시도해야, 탈출 직후에도
   * 계속 목표를 향해 나아갈 가능성이 높다.
   *
   * 매 틱 조금씩 후퇴시키는 대신 한 번에 장애물 키프아웃 반경보다 확실히 큰 거리
   * (`STUCK_ESCAPE_DISTANCE`)를 옮기는 이유: 점진적 이동은 "탈출 중" 상태(타이머/
   * 방향)를 따로 저장해야 해서 더 복잡한데, 실제로 갇히는 경우 대부분(노드 하나의
   * 고리에 막힌 경우)은 한 번의 점프로 충분히 벗어난다 — 드물게(1.5초에 1회)
   * 순간 이동처럼 보이는 것이 "영원히 멈춤" 또는 "목표 반대쪽으로 튕겨나감"보다
   * 훨씬 낫다는 판단이다. 부채꼴 검색 안에서 전부 막히면 이번 틱은 포기한다
   * (무한 재시도 방지 우선, `pickClusterNodePosition` 등 기존 패턴과 동일) —
   * 호출부가 `stuckSeconds`를 리셋하므로 다음 주기에 다시 시도된다.
   */
  private tryEscapeStuckMonster(
    monster: MonsterEntity,
    normX: number,
    normY: number,
    monsterR: number,
    crushes: boolean,
  ): void {
    // 목표 방향을 못 구하면(정지 상태 등) 그냥 원점 반대쪽 아무 방향이나 기준으로
    // 삼는다 — 이런 경우가 실제로는 거의 없지만 각도 자체를 정의 못 하는 사고를 막는다.
    const desiredAngle =
      normX !== 0 || normY !== 0 ? Math.atan2(normY, normX) : Math.atan2(monster.y, monster.x);

    const ANGLE_STEP = Math.PI / 8; // 22.5도
    for (let attempt = 0; attempt < STUCK_ESCAPE_ATTEMPTS; attempt += 1) {
      const side = attempt % 2 === 0 ? 1 : -1;
      const magnitude = Math.ceil(attempt / 2);
      const angle = desiredAngle + side * magnitude * ANGLE_STEP + (this.rng() - 0.5) * 0.1;
      const candidateX = monster.x + Math.cos(angle) * STUCK_ESCAPE_DISTANCE;
      const candidateY = monster.y + Math.sin(angle) * STUCK_ESCAPE_DISTANCE;
      if (!this.isBlockedForMonster(candidateX, candidateY, monsterR, crushes)) {
        monster.x = candidateX;
        monster.y = candidateY;
        return;
      }
    }
  }

  /**
   * 플레이어 좌표에서 투사체 생성 좌표(muzzleOffset만큼 떨어진 총구)까지의 구간에
   * 몬스터가 걸쳐 있었는지 검사한다. 원-원 판정이 아니라 원-선분 판정이 필요한 이유:
   * 몬스터가 정확히 그 구간 "중간"에 있으면 두 끝점(플레이어 좌표/총구 좌표) 중
   * 어느 쪽과도 안 겹칠 수 있다 — 구간에서 몬스터 중심에 가장 가까운 점을 구해서
   * 그 점과 겹치는지를 봐야 새는 경우가 없다. 걸쳐 있었으면 그 몬스터에게 즉시
   * 데미지를 주고 true를 반환한다(투사체는 아예 만들지 않는다 — 총구가 생겨나기도
   * 전에 이미 막고 있었으니 "총구에서 발사되어 날아가는" 연출 자체가 성립하지 않는다).
   */
  private resolveMuzzleGapHit(player: PlayerEntity, projectile: ProjectileEntity): boolean {
    const gapX = projectile.x - player.x;
    const gapY = projectile.y - player.y;
    const gapLength = Math.hypot(gapX, gapY);
    if (gapLength <= 0) return false;

    const dirX = gapX / gapLength;
    const dirY = gapY / gapLength;

    let closestId: string | undefined;
    let closestAlong = Infinity;
    // 전체 몬스터 대신 격자 후보만 본다(docs/backend/45). 세그먼트(플레이어→총구) 위의
    // 어느 점이든 플레이어로부터 gapLength 이내이므로, 플레이어 중심 반경
    // gapLength + 몬스터 최대 히트박스로 질의하면 세그먼트 전체를 안전하게 덮는다.
    // 이 함수는 "가장 가까운" 후보를 직접 비교해서 고르므로(첫 매치 반환이 아님)
    // 후보 순서와 무관하게 결과가 같다.
    const candidateIds = this.monsterGrid.queryRadius(
      player.x,
      player.y,
      gapLength + MAX_MONSTER_HIT_RADIUS,
    );
    for (const id of candidateIds) {
      const monster = this.monsters.get(id);
      if (!monster) continue;
      const hitRadius = monsterRadius(monster);
      const alongRaw = (monster.x - player.x) * dirX + (monster.y - player.y) * dirY;
      const along = Math.max(0, Math.min(gapLength, alongRaw));
      const closestX = player.x + dirX * along;
      const closestY = player.y + dirY * along;
      if (!circlesOverlap(closestX, closestY, monster.x, monster.y, hitRadius)) continue;
      if (along >= closestAlong) continue;
      closestId = id;
      closestAlong = along;
    }

    if (!closestId) return false;
    const monster = this.monsters.get(closestId)!;
    this.damageMonster(closestId, monster.hp - projectile.damage);
    return true;
  }

  private applyMeleeHit(hit: MeleeHit): void {
    // 전체 몬스터 대신 격자 후보만 본다(docs/backend/45) — 부채꼴의 최대 반경(range)에
    // 몬스터 최대 히트박스를 더해 후보를 안전하게 잡는다. 이 함수는 부채꼴 안의
    // 몬스터 전부에게 피해를 주므로(첫 매치에서 멈추지 않음) 후보 순서는 결과에
    // 영향을 주지 않는다.
    const candidateIds = this.monsterGrid.queryRadius(
      hit.originX,
      hit.originY,
      hit.range + MAX_MONSTER_HIT_RADIUS,
    );
    for (const id of candidateIds) {
      const monster = this.monsters.get(id);
      if (!monster) continue;
      if (withinMeleeArc(hit, monster.x, monster.y, monsterRadius(monster))) {
        this.damageMonster(id, monster.hp - hit.damage);
      }
    }
  }

  /**
   * 투사체 충돌 처리. 몬스터 판정을 먼저 하고, 못 맞혔으면 정적 장애물(건축물/자원
   * 노드/콜로니/코어) 판정으로 넘어간다. 건축물은 `blocksProjectile`인 타입(벽)만
   * 막는다(울타리는 통과시킨다, docs/backend/18 §1) — 자원 노드/콜로니/코어는
   * 타입 구분 없이 전부 막는다(docs/backend/38, 사용자가 넷 다 막아달라고 명시).
   * 어느 쪽이든 맞으면 투사체만 사라지고 대상은 피해를 입지 않는다(건축물은 몬스터
   * 공격으로만, 자원/콜로니/코어는 아예 파괴 불가로 설계됐다).
   */
  private resolveProjectileHits(): void {
    for (const [projectileId, projectile] of this.projectiles) {
      if (this.projectileHitsMonster(projectileId, projectile)) continue;
      this.projectileHitsObstacle(projectileId, projectile);
    }
  }

  private projectileHitsMonster(projectileId: string, projectile: ProjectileEntity): boolean {
    // 전체 몬스터 대신 격자 후보만 본다(docs/backend/45) — 후보 반경에 몬스터 최대
    // 히트박스를 더해야, 큰(보스급) 몬스터의 중심이 격자 반경 밖이어도 몸이 걸치는
    // 경우를 놓치지 않는다. 판정이 선분(직전 위치→현재 위치)이므로 이번 틱에 이동한
    // 거리도 반경에 더해야 그 구간에 있던 몬스터가 후보에서 빠지지 않는다.
    const travelled = Math.hypot(projectile.x - projectile.prevX, projectile.y - projectile.prevY);
    const candidateIds = this.monsterGrid.queryRadius(
      projectile.x,
      projectile.y,
      MAX_MONSTER_HIT_RADIUS + travelled,
    );
    let hitAny = false;
    for (const monsterId of candidateIds) {
      const monster = this.monsters.get(monsterId);
      if (!monster) continue;
      // 관통탄이 이미 때린 몬스터는 건너뛴다 — 한 발이 같은 몸을 두 번 뚫지 않는다.
      if (projectile.hitIds?.has(monsterId)) continue;
      if (projectileSweepHits(projectile, monster.x, monster.y, monsterRadius(monster))) {
        this.damageMonster(monsterId, monster.hp - projectile.damage);
        if (!projectile.pierce) {
          this.projectiles.delete(projectileId);
          return true;
        }
        projectile.hitIds?.add(monsterId);
        hitAny = true;
      }
    }
    return hitAny;
  }

  private projectileHitsObstacle(projectileId: string, projectile: ProjectileEntity): void {
    // 몬스터와 같은 이유로 선분 판정을 쓴다 — 빠른 총알이 벽을 뚫고 지나가면 안 된다.
    for (const building of this.buildings.values()) {
      if (!buildingsData[building.type].blocksProjectile) continue;
      if (projectileSweepHits(projectile, building.x, building.y, TILE_SIZE / 2)) {
        this.projectiles.delete(projectileId);
        return;
      }
    }
    for (const node of this.resourceNodes.values()) {
      if (node.hp <= 0) continue; // 고갈된 자리는 투사체도 그냥 통과한다(docs/backend/39)
      if (projectileSweepHits(projectile, node.x, node.y, resourcesData[node.type].hitRadius)) {
        this.projectiles.delete(projectileId);
        return;
      }
    }
    for (const colony of this.colonies.values()) {
      if (projectileSweepHits(projectile, colony.x, colony.y, COLONY_RADIUS)) {
        this.projectiles.delete(projectileId);
        return;
      }
    }
    // 투사체는 점으로 취급한다 — 발자국 안에 들어오면 코어가 막은 것이다.
    if (coreDistance(projectile.x, projectile.y) <= 0) {
      this.projectiles.delete(projectileId);
    }
  }

  /**
   * 처치 보상은 죽은 자리에 떨어지므로 "누가 죽였는지"를 받지 않는다 — 투사체가
   * 날아가는 동안 쏜 사람이 나가도 보상이 사라지지 않는다.
   */
  private damageMonster(id: string, remainingHp: number): void {
    if (remainingHp <= 0) {
      const monster = this.monsters.get(id);
      this.monsters.delete(id);
      this.monsterGrid.remove(id);
      if (monster) {
        // 수호대였다면 소속 콜로니 장부에서 지운다 — 저장분은 복원되지 않는다
        // (죽은 몬스터는 영구히 줄어드는 게 정화로 가는 길이다).
        if (monster.homeColonyId) this.colonies.get(monster.homeColonyId)?.guardIds.delete(id);
        this.grantMonsterDrop(monster);
      }
      return;
    }
    const monster = this.monsters.get(id);
    if (monster) monster.hp = remainingHp;
  }

  /**
   * 처치 보상 지급. 몬스터 타입 데이터에 `energyDrop`이 있으면(보스) 팀 공유분으로
   * 즉시 지급하고 거기서 끝난다. 그 외 몬스터는 `itemDrops` 표를 굴려 죽은 자리에
   * **바닥 드롭**을 남긴다 — 드랍은 부품/희귀부품 두 종류뿐이고, 쓸 데는 상점 판매다.
   *
   * 누가 죽였는지(killerId)는 필요 없다 — 바닥에 떨어뜨리므로 먼저 줍는 사람이 임자다.
   * 막타를 누가 쳤는지로 보상이 갈리지 않는 편이 협동에 맞는다.
   *
   * 잡은 사람 인벤토리에 바로 넣지 않는 이유: 가방이 꽉 차면 보상이 조용히 증발한다.
   * 나무/돌과 똑같이 바닥에 떨어뜨리면 못 주운 몫이 눈에 보이고, 전투 중엔 흘리고
   * 나중에 회수하는 선택도 생긴다.
   */
  private grantMonsterDrop(monster: MonsterEntity): void {
    const data = monstersData[monster.type];

    this.grantXp(data.xpReward);

    // 에너지와 바닥 드랍은 배타가 아니다 — 보스/엘리트는 팀 에너지도 주고 부품도
    // 떨군다(예전엔 에너지가 있으면 드랍을 건너뛰었는데, 보스 레이드를 잡았는데
    // 바닥에 아무것도 안 떨어지는 건 보상 체감이 밋밋했다).
    if (data.energyDrop) {
      this.addEnergy(this.rollDropRange(data.energyDrop));
    }

    // 드랍 테이블은 항목마다 독립 판정이다 — 한 마리가 부품과 희귀부품을 함께 줄 수 있다.
    for (const entry of data.itemDrops ?? []) {
      if (this.rng() >= entry.chance) continue;
      this.dropItem(entry.itemId, this.rollDropRange(entry), monster.x, monster.y);
    }
  }

  /** [min, max] 정수 범위(양끝 포함)에서 하나를 뽑는다. World의 rng를 재사용해 테스트에서 결정론적으로 검증할 수 있게 한다. */
  private rollDropRange(range: DropRange): number {
    if (range.max <= range.min) return range.min;
    return range.min + Math.floor(this.rng() * (range.max - range.min + 1));
  }
}

/** 클라이언트에 그대로 실어 보낼 수 있는 평평한(flat) 예고 정보. Colyseus 스키마는 유니온 타입을 못 다루므로, `BossPatternState`를 여기서 하나의 형태로 눌러 편다. */
export interface BossTelegraph {
  kind: 'charge' | 'slam';
  x: number;
  y: number;
  /** 돌진 방향(단위 벡터). 광역 패턴에서는 안 쓴다(0). */
  dirX: number;
  dirY: number;
  /** 돌진: 경로 폭의 절반. 광역: 범위 반경. */
  radius: number;
  /** 돌진: 예고 종료 시 실제로 도달할 거리(speed * duration). 광역에서는 0. */
  range: number;
  remaining: number;
  total: number;
}

/**
 * 지금 예고 중인 다음 타격을 화면에 그릴 수 있는 모양으로 바꾼다. 예고 중이 아니면 undefined.
 *
 * **전방향(arc 360)은 원, 부채꼴은 방향 띠**로 내보낸다 — 클라이언트가 이미 그 두 모양을
 * 그릴 줄 알아서(예전 돌진/광역 예고에 쓰던 렌더러) 그대로 재사용한다. 옆으로 못 피하는
 * 광역 기술일수록 미리 보여주는 게 중요하다.
 */
export function describeBossTelegraph(
  monster: MonsterEntity,
  data: MonsterData,
): BossTelegraph | undefined {
  const pattern = monster.pattern;
  if (pattern.kind !== 'meleeSwing') return undefined;

  const attack = data.meleeAttacks?.[pattern.index];
  const hit = attack?.hits[pattern.nextHit];
  if (!attack || !hit) return undefined;

  // 진행률은 "직전 타격(없으면 동작 시작)부터 이번 타격까지" 구간으로 잰다 —
  // 2연타에서 두 번째 예고가 이미 꽉 찬 상태로 뜨지 않게.
  const previousAt = pattern.nextHit > 0 ? attack.hits[pattern.nextHit - 1]!.atSeconds : 0;
  const total = Math.max(0.001, hit.atSeconds - previousAt);
  const remaining = Math.max(0, hit.atSeconds - pattern.elapsed);

  // 돌격은 **지나갈 길**을 먼저 보여준다. 마무리 타격(전방향 광역)만 예고하면 화면에는
  // 보스 발밑의 원만 뜨는데, 정작 위험한 건 그 앞으로 밀고 나가는 통로다 — 예고와
  // 판정이 다르면 피할 방법이 없다. 아직 돌진이 시작되기 전(창 이전)에만 띄운다.
  const dash = attack.dash;
  if (dash?.halfWidth !== undefined && pattern.elapsed <= dash.toSeconds) {
    const travel = dash.speed * (dash.toSeconds - dash.fromSeconds);
    return {
      kind: 'charge',
      x: monster.x,
      y: monster.y,
      dirX: pattern.dirX,
      dirY: pattern.dirY,
      radius: dash.halfWidth,
      range: travel,
      remaining: Math.max(0, dash.fromSeconds - pattern.elapsed),
      total: Math.max(0.001, dash.fromSeconds),
    };
  }

  if (hit.arc >= 360) {
    return {
      kind: 'slam',
      x: monster.x,
      y: monster.y,
      dirX: 0,
      dirY: 0,
      radius: hit.range,
      range: 0,
      remaining,
      total,
    };
  }

  const halfArc = (hit.arc * Math.PI) / 360;
  return {
    kind: 'charge',
    x: monster.x,
    y: monster.y,
    dirX: pattern.dirX,
    dirY: pattern.dirY,
    // 부채꼴을 감싸는 띠의 반폭. 사거리 끝에서 부채꼴이 가장 넓어진다.
    radius: hit.range * Math.sin(halfArc),
    range: hit.range,
    remaining,
    total,
  };
}
