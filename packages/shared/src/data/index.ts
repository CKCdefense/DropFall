import { z } from 'zod';
import monstersJson from './monsters.json';
import weaponsJson from './weapons.json';
import wavesJson from './waves.json';
import resourcesJson from './resources.json';
import toolsJson from './tools.json';
import buildingsJson from './buildings.json';
import itemsJson from './items.json';
import loadoutJson from './loadout.json';
import craftingJson from './crafting.json';
import shopJson from './shop.json';
import coloniesJson from './colonies.json';
import coreUpgradesJson from './coreUpgrades.json';
import corePersonaJson from './corePersona.json';
import companionJson from './companion.json';

export function loadData<T>(schema: z.ZodType<T>, json: unknown): T {
  return schema.parse(json);
}

// --- monsters.json ---------------------------------------------------------

/** 돌진 공격: 방향을 예고한 뒤 그 방향으로 빠르게 대시하며 경로 위 플레이어를 때린다. */
const ChargeAttackSchema = z.object({
  /** 돌진 전 예고(텔레그래프) 시간(초) — 이 동안 플레이어가 피할 수 있어야 한다. */
  telegraphSeconds: z.number().positive(),
  /** 돌진 중 이동 속도(px/s). 평상시 speed와 무관하게 별도로 정의한다. */
  speed: z.number().positive(),
  /** 돌진이 지속되는 시간(초). speed * duration이 곧 돌진 거리다. */
  duration: z.number().positive(),
  /** 돌진 경로의 폭(px). 이 폭 안에 있으면 맞는다. */
  width: z.number().positive(),
  damage: z.number().nonnegative(),
  /** 이 패턴을 다시 쓸 수 있게 되기까지의 시간(초, 예고 시작 시점부터 카운트하지 않고 종료 후부터). */
  cooldown: z.number().positive(),
});

/** 광역 공격: 지점을 예고한 뒤 그 자리에 원형 범위로 즉시 피해를 준다. */
const SlamAttackSchema = z.object({
  telegraphSeconds: z.number().positive(),
  radius: z.number().positive(),
  damage: z.number().nonnegative(),
  cooldown: z.number().positive(),
});

/**
 * 검술 한 동작 안의 **타격 한 번**.
 *
 * 동작 하나가 곧 타격 하나는 아니다 — 흑기사의 1번 기술은 내려베고 이어서 찌르는
 * 2연타라, 애니메이션 한 번에 판정이 두 번 들어간다. 그래서 타격을 배열로 두고
 * 각자 시점·사거리·각도·피해를 갖는다.
 */
const MeleeHitSchema = z.object({
  /** 동작 시작 후 이 시점(초)에 판정이 들어간다. 검이 뻗는 프레임에 맞춘 값이다. */
  atSeconds: z.number().nonnegative(),
  /** 판정 사거리(px, 보스 중심 기준). */
  range: z.number().positive(),
  /** 부채꼴 각도(도). 140이면 좌우 ±70도, **360이면 전방향**(착지 광역 등). */
  arc: z.number().positive().max(360),
  damage: z.number().nonnegative(),
});

/**
 * 보스 근접 검술 한 동작.
 *
 * 돌진(charge)/광역(slam)과 달리 **스프라이트에 실제로 그려진 동작**을 그대로 판정으로
 * 옮긴 것이다. 그래서 사거리·각도·타격 시점은 임의값이 아니라 프레임을 실측해서 넣는다 —
 * 무기가 닿아 보이는 곳이 실제로 맞는 곳이어야 한다.
 *
 * 별도의 바닥 예고 표시가 없는 대신 **동작 자체가 예고**다. 무기를 치켜드는 그림이
 * 재생되는 동안 보스는 멈춰 서 있고, 정해진 시점마다 판정이 들어간다.
 */
const MeleeAttackSchema = z.object({
  /** 스프라이트 태그 번호(1=Attack01, 2=Attack02, 3=Attack03). 클라이언트가 어느 동작을 재생할지 고른다. */
  anim: z.number().int().positive(),
  /** 이 동작이 만드는 타격들. 시간순으로 넣는다. */
  hits: z.array(MeleeHitSchema).min(1),
  /**
   * 있으면 이 동작은 **앞으로 돌진하면서** 지나가는 것을 쓸어버린다(화염 골렘 3번).
   *
   * `hits`(특정 순간의 부채꼴 판정)와 성격이 다르다 — 이쪽은 창(window) 동안 계속
   * 이동하며 몸에 닿는 대상을 **한 번씩만** 때린다. 순간 판정으로는 "지나가면서 밀어버린다"를
   * 표현할 수 없고, 매 틱 판정하면 가만히 선 사람이 수십 번 맞는다.
   */
  dash: z
    .object({
      /** 동작 시작 후 돌진이 시작/종료되는 시점(초). 스프라이트가 실제로 나아가는 구간에 맞춘다. */
      fromSeconds: z.number().nonnegative(),
      toSeconds: z.number().positive(),
      /** 돌진 이동 속도(px/s). 평상시 speed와 무관하다. */
      speed: z.number().positive(),
      /** 몸에 닿았다고 보는 반경(px). */
      radius: z.number().positive(),
      damage: z.number().nonnegative(),
    })
    .optional(),
  /** 마지막 타격 후 경직(초). 이 동안은 움직이지도 다음 공격을 하지도 않는다 — 반격할 틈이다. */
  recoverSeconds: z.number().nonnegative(),
  /** 이 기술을 다시 쓸 수 있게 되기까지의 시간(초). 기술마다 따로 돈다. */
  cooldown: z.number().positive(),
});

/**
 * 처치 보상 랜덤 범위(정수, 양끝 포함). `min === max`면 고정값이 된다.
 * `World.grantMonsterDrop()`이 처치 순간 이 범위 안에서 하나를 뽑는다.
 */
const DropRangeSchema = z
  .object({
    min: z.number().int().nonnegative(),
    max: z.number().int().nonnegative(),
  })
  .refine((range) => range.min <= range.max, { message: 'min은 max보다 클 수 없다' });

const MonsterDataSchema = z.object({
  hp: z.number().positive(),
  /**
   * 실제 피격 판정 반경(px) — 근접/투사체 판정이 이 값을 쓴다. 클라이언트 렌더러가
   * 이 값을 그대로 읽어 시각적 박스 크기(반경*2)를 정하므로, 그림과 판정이 항상
   * 일치한다(둘이 따로 놀아서 "히트박스가 네모칸이랑 안 맞는다"는 문제가 생기지 않게).
   */
  hitRadius: z.number().positive(),
  damage: z.number().nonnegative(),
  speed: z.number().nonnegative(),
  attackRange: z.number().nonnegative(),
  attackInterval: z.number().positive(),
  /** 있으면 이 반경 내 플레이어를 코어 대신 직접 추격한다(돌진형/보스). 없으면 항상 코어로 직진. */
  aggroRadius: z.number().nonnegative().optional(),
  /**
   * 처치 시 확률로 떨어지는 아이템 목록. 각 항목이 독립적으로 판정되므로 한 마리가
   * 여러 종류를 떨굴 수 있다(보스가 부품과 희귀부품을 함께 주는 식).
   */
  itemDrops: z
    .array(
      z.object({
        itemId: z.string(),
        /** 0~1. 1이면 확정 드랍이다. */
        chance: z.number().min(0).max(1),
        min: z.number().int().positive(),
        max: z.number().int().positive(),
      }),
    )
    .optional(),
  /** 있으면 이 타입은 돌진 패턴을 쓸 수 있다(보스 전용, 없으면 미사용). */
  chargeAttack: ChargeAttackSchema.optional(),
  /** 있으면 이 타입은 광역 패턴을 쓸 수 있다(보스 전용, 없으면 미사용). */
  slamAttack: SlamAttackSchema.optional(),
  /**
   * 있으면 이 타입은 근접 검술을 쓴다(보스 전용). 여러 개를 두고 **대상까지의 거리로**
   * 쓸 수 있는 것만 골라 무작위로 하나 쓴다 — 거리마다 다른 기술이 나와야 패턴이
   * "다음 공격 외우기"가 되지 않는다.
   */
  meleeAttacks: z.array(MeleeAttackSchema).min(1).optional(),
  /**
   * 자원 노드/콜로니를 밟고 지나간다(거구 전용).
   *
   * 덩치가 커지면 장애물 회피 자체가 성립하지 않는다 — 우회 경로(FlowField)는 16px
   * 격자로 "빈 칸"을 찾는데, 반경 40짜리는 그 칸에 애초에 들어가지 못해서 노드 옆에서
   * 갈리기만 한다(3배 보스로 실측: 700px에서 출발해 코어 458px 앞 나무에 걸려 정지).
   * 게다가 거대한 보스가 나무 한 그루에 막히는 그림 자체가 이상하다.
   */
  crushesObstacles: z.boolean().optional(),
  /**
   * 처치 즉시 팀 공유 창고(coreSharedEnergy)에 지급되는 랜덤량. 콜로니 파괴 보상과
   * 같은 자원이다 — 보스 전용(희귀 등급), 개인 소지 단계 없이 바로 팀 전체 몫이 된다.
   */
  energyDrop: DropRangeSchema.optional(),
});

const MonstersDataSchema = z.record(z.string(), MonsterDataSchema);

export type MonsterType = keyof typeof monstersData;
export type MonsterData = z.infer<typeof MonsterDataSchema>;
export type DropRange = z.infer<typeof DropRangeSchema>;
export type MeleeAttackData = z.infer<typeof MeleeAttackSchema>;
export type MeleeHitData = z.infer<typeof MeleeHitSchema>;

export const monstersData = loadData(MonstersDataSchema, monstersJson);

// --- weapons.json ------------------------------------------------------------

const WeaponDataSchema = z.object({
  name: z.string(),
  type: z.enum(['melee', 'ranged']),
  damage: z.number().nonnegative(),
  /** 초당 발사/타격 횟수 */
  fireRate: z.number().positive(),
  /** melee 전용: 판정 사거리(px) */
  range: z.number().positive().optional(),
  /**
   * 채집 도구 계열(axe/pickax/hammer). 티어가 올라도 계열은 그대로라, 자원 노드의
   * requiredTool은 이 값과 맞춘다 — 티어별 id를 노드 데이터에 나열할 필요가 없다.
   */
  toolFamily: z.string().optional(),
  /**
   * 자원 종류를 가리지 않고 캘 수 있다(맨손). 계열이 하나뿐인 toolFamily로는
   * "무엇이든"을 표현할 수 없어서 따로 뒀다 — 대신 데미지가 매우 낮다.
   */
  harvestsAny: z.boolean().optional(),
  /**
   * melee 전용: 조준 방향 기준 부채꼴 판정 각도(도). 100이면 좌우 ±50도.
   * 없으면 전방향(360도) — 기존 원형 판정과 같아진다.
   */
  arc: z.number().positive().max(360).optional(),
  /** ranged 전용 */
  magazine: z.number().int().positive().optional(),
  reloadTime: z.number().positive().optional(),
  projectileSpeed: z.number().positive().optional(),
  /**
   * ranged 전용: 발사 지점을 플레이어 중심에서 조준 방향으로 밀어내는 거리(px).
   * 총구 위치와 맞춰야 총알이 배에서 튀어나오지 않는다 — 클라이언트 렌더의
   * 총구 좌표(weaponFx.ts의 궤도 반경 + 총구 오프셋)에서 계산한 값이다.
   */
  muzzleOffset: z.number().nonnegative().optional(),
});

const WeaponsDataSchema = z.record(z.string(), WeaponDataSchema);

export type WeaponType = keyof typeof weaponsData;
export type WeaponData = z.infer<typeof WeaponDataSchema>;

export const weaponsData = loadData(WeaponsDataSchema, weaponsJson);

// --- waves.json --------------------------------------------------------------

const WaveEntrySchema = z.object({
  spawnPoints: z.number().int().positive(),
  /**
   * 무리 스폰. 한 번에 전체가 오는 게 아니라 groupSize마리씩 묶여
   * groupIntervalSeconds 간격으로 몰려온다 — 파도가 "밀려온다"는 리듬을 만든다.
   * 밤 길이는 시간이 아니라 토벌로 끝나므로 별도 nightDuration은 없다.
   */
  groupSize: z.number().int().positive(),
  groupIntervalSeconds: z.number().positive(),
  spawns: z.record(z.string(), z.number().int().nonnegative()),
  /**
   * 엘리트 확률 등장(예: 미노타우르스). 밤 시작 시 count번 독립적으로 굴려서
   * 성공한 만큼 스폰 큐에 섞는다 — "나올 수도 있는" 긴장감이 목적이라 확정이 아니다.
   */
  elite: z
    .object({
      type: z.string(),
      chance: z.number().min(0).max(1),
      count: z.number().int().positive(),
    })
    .optional(),
  /**
   * 있으면 이 밤은 보스 레이드로 끝난다 — 잡몹을 전멸시키면 이 타입이 소환되고,
   * 보스를 잡아야 낮이 온다. 없으면(1일차) 잡몹 전멸 즉시 낮.
   */
  bossType: z.string().optional(),
});

const WavesDataSchema = z.object({
  coreHp: z.number().positive(),
  playerHp: z.number().positive(),
  /** 몬스터가 스폰되는, 코어를 중심으로 한 원의 반지름(px) */
  spawnRadius: z.number().positive(),
  /** 낮 페이즈 길이(초). 스킵 투표는 별도 팀 협의 후 추가 예정(docs/backend/11 §4.2) */
  dayDuration: z.number().positive(),
  waves: z.array(WaveEntrySchema).min(1),
});

export type WaveEntry = z.infer<typeof WaveEntrySchema>;

export const wavesData = loadData(WavesDataSchema, wavesJson);

// --- resources.json ------------------------------------------------------------

const ResourceDataSchema = z.object({
  /**
   * 채집에 필요한 도구 계열(weapons.json의 toolFamily, 예: 'axe'). 티어와 무관하게 맞춘다.
   * 실제로 강제된다 — 이 값과 장착 무기가 다르면 근접 공격이 노드에 아무 영향도
   * 주지 않는다(World#applyMeleeHitToResourceNode).
   */
  requiredTool: z.string(),
  /** 노드 자신의 피격 판정 반경(px) — 근접 판정과 렌더링 크기(반경*2) 양쪽에 쓴다. */
  hitRadius: z.number().positive(),
  /** 노드를 고갈시키는 데 필요한 총 체력. 맞는 도구로 때린 데미지만큼 깎인다. */
  hp: z.number().int().positive(),
  /** 고갈되는 순간(hp 0) 마지막 타격을 넣은 플레이어에게 한 번에 지급되는 양. */
  yieldOnDeplete: z.number().int().positive(),
  /** 완전히 부서졌을 때 바닥에 떨구는 아이템(items.json의 key). */
  dropItemId: z.string(),
  /** 고갈 후 재생까지 걸리는 시간(초) */
  respawnSeconds: z.number().positive(),
});

const ResourcesDataSchema = z.record(z.string(), ResourceDataSchema);

export type ResourceType = keyof typeof resourcesData;
export type ResourceData = z.infer<typeof ResourceDataSchema>;

export const resourcesData = loadData(ResourcesDataSchema, resourcesJson);

// --- tools.json ------------------------------------------------------------

const ToolDataSchema = z.object({
  /** 이 도구로 채집할 수 있는 자원(resources.json의 key) */
  harvestsResource: z.string(),
});

const ToolsDataSchema = z.record(z.string(), ToolDataSchema);

export type ToolType = keyof typeof toolsData;
export type ToolData = z.infer<typeof ToolDataSchema>;

export const toolsData = loadData(ToolsDataSchema, toolsJson);

// --- buildings.json ------------------------------------------------------------

const BuildingDataSchema = z.object({
  woodCost: z.number().int().nonnegative(),
  stoneCost: z.number().int().nonnegative(),
  hp: z.number().positive(),
  /** Flow Field 이동 차단 여부(기술명세 §5.2) */
  blocksMovement: z.boolean(),
  /** 투사체 차단 여부(기술명세 §5.2) — 데이터만 있고 충돌 처리는 아직 미구현 */
  blocksProjectile: z.boolean(),
});

const BuildingsDataSchema = z.record(z.string(), BuildingDataSchema);

export type BuildingType = keyof typeof buildingsData;
export type BuildingData = z.infer<typeof BuildingDataSchema>;

export const buildingsData = loadData(BuildingsDataSchema, buildingsJson);

// --- items.json ------------------------------------------------------------

const ItemDataSchema = z.object({
  name: z.string(),
  /**
   * 슬롯이 이 아이템으로 무엇을 할 수 있는지 결정한다.
   *  - weapon:     장착하면 좌클릭 공격에 쓰인다
   *  - consumable: 사용하면 효과를 내고 1개 줄어든다
   *  - material:   들고 다니다 코어 창고에 넣는다. 손에 들어도 아무 일도 안 일어난다
   *
   * 자원 노드를 부수면 나오는 드롭을 주웠을 때 material로 인벤토리에 들어온다 —
   * 예전처럼 PlayerEntity의 전용 필드(wood/stone)로 세지 않는다. 창고 입고가
   * "슬롯을 옮기는 일"이 되어야 도구도 같은 방식으로 보관할 수 있다.
   */
  kind: z.enum(['weapon', 'consumable', 'material']),
  /** weapon 전용: weapons.json의 key. 아이템 id와 달라질 수 있어 따로 둔다. */
  weaponId: z.string().optional(),
  /** consumable 전용: 자기 체력 회복량 */
  healAmount: z.number().positive().optional(),
  /** consumable 전용: 코어 체력 회복량. 최대 체력을 넘겨 회복하지는 않는다. */
  coreHealAmount: z.number().positive().optional(),
  /** consumable 전용: 팀 공유 에너지 지급량(코어 업그레이드 재화). */
  energyAmount: z.number().int().positive().optional(),
  /**
   * 상점 로테이션 등급. 없으면 상점에 뽑히지 않는다 — 제작 전용 도구가 여기 해당한다.
   * 등급별 가중치는 shop.json이 정한다.
   */
  rarity: z.enum(['common', 'rare', 'epic', 'legendary']).optional(),
  /** 한 슬롯에 쌓을 수 있는 최대 개수. 무기처럼 겹치면 안 되는 건 1이다. */
  stackSize: z.number().int().positive(),
  /** 상점에 팔 때 개당 받는 돈. 없으면 팔 수 없다(도구·소모품 등). */
  sellPrice: z.number().int().nonnegative().optional(),
  /** 상점에서 살 때 드는 돈. 없으면 상점에 진열되지 않는다. */
  buyPrice: z.number().int().positive().optional(),
});

const ItemsDataSchema = z.record(z.string(), ItemDataSchema);

export type ItemId = keyof typeof itemsData;
export type ItemData = z.infer<typeof ItemDataSchema>;
export type ItemKind = ItemData['kind'];

export const itemsData = loadData(ItemsDataSchema, itemsJson);

// --- loadout.json ------------------------------------------------------------

const LoadoutEntrySchema = z.object({
  itemId: z.string(),
  count: z.number().int().positive(),
});

const LoadoutDataSchema = z.object({
  /**
   * 참가 시 개인 인벤토리에 들어가는 아이템. 순서가 곧 퀵슬롯 순서다.
   * 지금은 비어 있다 — 도구는 팀 창고에서 꺼내 쓰는 것이 협동 게임의 시작점이라고 봤다.
   */
  playerStarting: z.array(LoadoutEntrySchema),
  /** 게임 시작 시 팀 창고에 한 번 들어가는 아이템. 인원과 무관하게 한 세트다. */
  coreStorage: z.array(LoadoutEntrySchema),
});

export type LoadoutEntry = z.infer<typeof LoadoutEntrySchema>;

export const loadoutData = loadData(LoadoutDataSchema, loadoutJson);

// --- colonies.json ------------------------------------------------------------

/**
 * 콜로니 성장 단계(1~3). 배열 인덱스 + 1이 곧 단계 번호다. 낮 동안 정화하지 않으면
 * 한 단계 오르고(stored가 대략 2배씩), 정화하면 1단계로 초기화된다.
 */
const ColonyStageSchema = z.object({
  /** 이 단계에서 콜로니에 저장되는 몬스터 수. 수호대는 이 저장분에서 나온다. */
  stored: z.number().int().positive(),
  /** 이 단계 수호대로 나올 수 있는 몬스터 타입(monsters.json 키). 소환마다 무작위. */
  types: z.array(z.string()).min(1),
  /** 이 단계에서 정화했을 때 팀 공유 에너지 보상. 키운 걸 잡을수록 크다 — 리스크-리턴. */
  purifyEnergy: z.number().int().positive(),
});

const ColoniesDataSchema = z
  .object({
    /** 콜로니가 코어에서 떨어질 수 있는 최소 거리(px). 사분면 안에서 무작위로 고를
     * 거리의 하한이다(docs/backend/41). */
    spawnRadiusMin: z.number().positive(),
    /** 콜로니가 코어에서 떨어질 수 있는 최대 거리(px). waves.json의 spawnRadius(900)와
     * 비슷한 대역을 유지해서, 밤 웨이브 스폰 지점과 콜로니가 시각적으로 비슷한
     * "가장자리"에 서게 한다. */
    spawnRadiusMax: z.number().positive(),
    /** 콜로니끼리 최소 이 거리(px) 이상 떨어지게 재시도한다 — 사분면이 인접하면
     * 경계 부근에서 서로 거의 붙어버릴 수 있어서 필요하다(docs/backend/41). */
    minSpacing: z.number().positive(),
    /** 살아있는 플레이어가 이 반경(px) 안에 들어오면 수호대 소환이 시작된다. */
    triggerRadius: z.number().positive(),
    /** 수호대가 추격을 포기하고 콜로니로 귀환하는 기준 반경(px, 콜로니 중심 기준).
     * triggerRadius보다 커야 경계에서 소환↔귀환이 진동하지 않는다. */
    leashRadius: z.number().positive(),
    /** 동시에 나와 있을 수 있는 수호대 수. 저장분 전체가 한꺼번에 쏟아지지 않고
     * 이 수를 유지하도록 한 마리씩 보충된다(입구 낚시 방지 겸 압박 유지). */
    guardConcurrent: z.number().int().positive(),
    /** 수호대 보충 소환 간격(초). */
    guardRespawnSeconds: z.number().positive(),
    /** 귀환을 마친 수호대가 저장 상태로 돌아가(사라져) stored를 복원하기까지의 대기(초). */
    returnDespawnSeconds: z.number().positive(),
    /** 밤 웨이브 시작 시 콜로니 저장분의 이 비율(내림)만큼 **복제**되어 그 콜로니
     * 방향에서 침공에 합류한다. 저장분 자체는 줄지 않는다 — 줄면 밤에 정화가
     * 공짜가 된다. */
    waveContributionRatio: z.number().min(0).max(1),
    /** 성장 단계(1~3). 배열 순서가 단계 순서다. */
    stages: z.array(ColonyStageSchema).min(1),
  })
  .refine((data) => data.spawnRadiusMax >= data.spawnRadiusMin, {
    message: 'spawnRadiusMax는 spawnRadiusMin 이상이어야 한다',
  })
  .refine((data) => data.leashRadius > data.triggerRadius, {
    message: 'leashRadius는 triggerRadius보다 커야 한다(경계 진동 방지)',
  });

export type ColonyStage = z.infer<typeof ColonyStageSchema>;
export type ColoniesData = z.infer<typeof ColoniesDataSchema>;

export const coloniesData = loadData(ColoniesDataSchema, coloniesJson);

// --- coreUpgrades.json ------------------------------------------------------------

/**
 * 코어 업그레이드 한 단계. `World.upgradeCore()`가 `core.tier`번째(0-based) 항목의
 * `cost`를 코어 공유 에너지에서 차감하고 나머지 보너스를 한꺼번에 적용한다 — 코어
 * 체력/건설 가능 반경/제작·스텟증가 해금이 전부 "한 번의 업그레이드"로 묶여 있다.
 */
const CoreUpgradeTierSchema = z.object({
  /** coreSharedEnergy에서 차감되는 비용. */
  cost: z.number().int().positive(),
  /** 이 단계를 사면 coreMaxHp와 coreHp에 동시에 더해지는 양(즉시 체감되는 회복 겸 증축). */
  coreHpBonus: z.number().nonnegative(),
  /** 건설 가능 반경(baseBuildRadius 기준 누적)에 더해지는 양. */
  buildRadiusBonus: z.number().nonnegative(),
  /** 이 단계부터 CraftModal을 열 수 있게 되는지. 한 번 true면 그 이후 단계도 계속 true로 본다. */
  unlocksCrafting: z.boolean(),
  /** 이 단계부터 플레이어 스텟 증가 시스템을 쓸 수 있게 되는지(UI/구매 로직은 아직 없음 — 해금 플래그만). */
  unlocksStatUpgrades: z.boolean(),
});

const CoreUpgradesDataSchema = z.object({
  /**
   * 코어가 시작하는 티어. tiers는 "다음 티어로 올리는 비용/효과" 목록이라
   * 최대 티어 = startTier + tiers.length 다.
   */
  startTier: z.number().int().positive(),
  /** 업그레이드 전(tier 0) 기본 건설 가능 반경(px, 코어 원점 기준). */
  baseBuildRadius: z.number().positive(),
  tiers: z.array(CoreUpgradeTierSchema).min(1),
});

export type CoreUpgradeTier = z.infer<typeof CoreUpgradeTierSchema>;
export type CoreUpgradesData = z.infer<typeof CoreUpgradesDataSchema>;

export const coreUpgradesData = loadData(CoreUpgradesDataSchema, coreUpgradesJson);


// --- crafting.json ------------------------------------------------------------

const CraftRecipeSchema = z.object({
  id: z.string(),
  /** 만들어지는 아이템(items.json의 key). */
  itemId: z.string(),
  /** 코어가 이 티어 이상이어야 제작할 수 있다. */
  requiresTier: z.number().int().positive(),
  /** 재료 → 개수. 코어 창고에서 차감된다. */
  cost: z.record(z.string(), z.number().int().positive()),
});

const CraftingDataSchema = z.object({
  recipes: z.array(CraftRecipeSchema),
});

export type CraftRecipe = z.infer<typeof CraftRecipeSchema>;

export const craftingData = loadData(CraftingDataSchema, craftingJson);

// --- shop.json ------------------------------------------------------------

const ShopDataSchema = z.object({
  /** 하루치 진열에 뽑는 개수. 무기와 소모품을 따로 뽑아 한쪽으로 쏠리지 않게 한다. */
  weaponsPerDay: z.number().int().positive(),
  consumablesPerDay: z.number().int().positive(),
  /**
   * 등급별 뽑기 가중치. 비율이 곧 등장 확률이라, 전설을 10%로 하려면
   * 전설 1 : 나머지 합 9가 되게 둔다.
   */
  rarityWeights: z.record(z.enum(['common', 'rare', 'epic', 'legendary']), z.number().positive()),
});

export type ItemRarity = NonNullable<ItemData['rarity']>;

export const shopData = loadData(ShopDataSchema, shopJson);

// --- corePersona.json ------------------------------------------------------------

/** 이벤트 하나가 트레잇 3개에 주는 델타. */
const PersonaTraitDeltaSchema = z.object({
  trust: z.number(),
  efficiency: z.number(),
  recklessness: z.number(),
});

/**
 * 코어 AI 페르소나 설정. 플레이어 행동에서 누적한 트레잇(trust/efficiency/recklessness)으로
 * 코어의 "성격"을 표현하고, LLM 호출이 실패했을 때 대신 내보낼 대사도 여기 있다.
 */
const CorePersonaDataSchema = z.object({
  /** 트레잇 값의 하한/상한. 이벤트가 계속 쌓여도 무한정 커지지 않게 막는다. */
  traitMin: z.number(),
  traitMax: z.number(),
  /** 코어 상호작용(모달 열기) 트리거 사이 최소 간격(초). 연타로 대사가 도배되지 않게 한다. */
  coreInteractionCooldownSeconds: z.number().positive(),
  /** 이벤트 종류별 트레잇 델타. */
  eventWeights: z.object({
    waveEnd: PersonaTraitDeltaSchema,
    colonyDestroyed: PersonaTraitDeltaSchema,
    coreInteract: PersonaTraitDeltaSchema,
  }),
  /** moodBucketFor가 warm/cold를 가르는 기준값(trust - recklessness). */
  moodThreshold: z.number().positive(),
  /** LLM 호출 실패/타임아웃 시 무드 버킷별로 대신 뽑는 대사. */
  fallbackLines: z.object({
    warm: z.array(z.string()).min(1),
    cold: z.array(z.string()).min(1),
    neutral: z.array(z.string()).min(1),
  }),
});

export type PersonaTraitDelta = z.infer<typeof PersonaTraitDeltaSchema>;
export type CorePersonaData = z.infer<typeof CorePersonaDataSchema>;

export const corePersonaData = loadData(CorePersonaDataSchema, corePersonaJson);

// --- companion.json ------------------------------------------------------------

/**
 * AI 동반자("티모시") 설정. 방(팀)당 1마리, 자원 채집/운반만 한다
 * (docs/superpowers/specs/2026-08-07-ai-companion-timothy-design.md).
 */
const CompanionDataSchema = z.object({
  /** UI/로그에 표시할 이름. 나중에 바꿀 수 있게 데이터로 뺐다. */
  name: z.string().min(1),
  moveSpeed: z.number().positive(),
  /**
   * 이 거리 안에 들어오면 이동을 멈추고 채집을 시작한다. **자원 노드의 이동 충돌 반경
   * (HIT_RADIUS + resourcesData[type].hitRadius, 지금 값 기준 24px)보다 확실히 커야
   * 한다** — 티모시는 플레이어와 같은 `isBlockedForPlayer` 판정으로 움직여서 그
   * 반경 안으로는 물리적으로 못 들어간다. harvestRange를 그 값과 같거나 작게 두면
   * "도착 판정 거리"가 "못 들어가는 거리"와 겹쳐 영원히 도착하지 못하고 traveling만
   * 반복하는 버그가 난다(실제로 겪음 — 24로 뒀다가 32로 올려서 고침).
   */
  harvestRange: z.number().positive(),
  /** 채집 한 번(harvestIntervalSeconds마다)에 노드 hp를 깎는 양. */
  harvestDamage: z.number().positive(),
  harvestIntervalSeconds: z.number().positive(),
  /** carriedWood + carriedStone이 이 값 이상이면 코어로 돌아간다. */
  capacity: z.number().int().positive(),
  maxHp: z.number().positive(),
  /** 코어 기준 스폰 위치(px). */
  spawnOffset: z.object({ x: z.number(), y: z.number() }),
  /** 이 거리 안에서 E를 누르면 근접 상호작용(대사 트리거)이 된다. */
  interactRange: z.number().positive(),
  /**
   * 플레이어별로 쌓이는 티모시와의 관계 트레잇 + LLM 대사 설정. corePersona.json과
   * 같은 3축(trust/efficiency/recklessness)을 재사용하지만, 방 전체가 아니라
   * **플레이어 id별로 따로** 누적된다(World가 Map으로 관리).
   */
  persona: z.object({
    traitMin: z.number(),
    traitMax: z.number(),
    moodThreshold: z.number().positive(),
    /** 대사 생성 자체(LLM 호출/브로드캐스트)의 방 전역 최소 간격(초). 트레잇 누적은 이 쿨다운과 무관하게 항상 일어난다. */
    interactionCooldownSeconds: z.number().positive(),
    /**
     * "@티모시 ..." 채팅으로 직접 말 걸었을 때 전용 쿨다운(초). interactionCooldownSeconds와
     * 별개 풀이다 — 명시적으로 건 말은 방 전역 잡담 쿨다운에 걸려 조용히 씹히면 안 되고,
     * 반대로 직접 말 걸기 스팸이 다른 이벤트(코어 납품 등)의 대사까지 막아서도 안 된다.
     */
    playerMessageCooldownSeconds: z.number().positive(),
    /**
     * "@티모시 ..." 대화 기록을 플레이어별로 최근 몇 마디까지 들고 있다가 다음 프롬프트에
     * 이어 붙일지(메시지 개수, user+assistant 합산 — 3왕복이면 6). 너무 크면 매 호출마다
     * 토큰이 계속 불어난다.
     */
    historyMessageLimit: z.number().int().positive(),
    eventWeights: z.object({
      coreDeposit: PersonaTraitDeltaSchema,
      proximityInteract: PersonaTraitDeltaSchema,
      companionDowned: PersonaTraitDeltaSchema,
      companionRevived: PersonaTraitDeltaSchema,
      waveEnd: PersonaTraitDeltaSchema,
      playerMessage: PersonaTraitDeltaSchema,
    }),
    fallbackLines: z.object({
      warm: z.array(z.string()).min(1),
      cold: z.array(z.string()).min(1),
      neutral: z.array(z.string()).min(1),
    }),
  }),
});

export type CompanionData = z.infer<typeof CompanionDataSchema>;

export const companionData = loadData(CompanionDataSchema, companionJson);
