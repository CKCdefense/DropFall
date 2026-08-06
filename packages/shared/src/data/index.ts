import { z } from 'zod';
import monstersJson from './monsters.json';
import weaponsJson from './weapons.json';
import wavesJson from './waves.json';
import resourcesJson from './resources.json';
import toolsJson from './tools.json';
import buildingsJson from './buildings.json';
import itemsJson from './items.json';
import loadoutJson from './loadout.json';
import coloniesJson from './colonies.json';
import coreUpgradesJson from './coreUpgrades.json';

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
  /** 있으면 이 타입은 돌진 패턴을 쓸 수 있다(보스 전용, 없으면 미사용). */
  chargeAttack: ChargeAttackSchema.optional(),
  /** 있으면 이 타입은 광역 패턴을 쓸 수 있다(보스 전용, 없으면 미사용). */
  slamAttack: SlamAttackSchema.optional(),
  /**
   * 처치 시 잡은 플레이어의 휴대 자원(scrap)에 지급되는 랜덤량. 흔한 몬스터(잡몹/돌진/
   * 탱커)용 — 나무/돌처럼 코어에 입고(E)해야 팀 공유가 된다. `energyDrop`과 같은 타입에
   * 동시에 두지 않는다(둘은 서로 다른 등급의 보상이라 한 타입은 하나만 준다).
   */
  scrapDrop: DropRangeSchema.optional(),
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
  nightDuration: z.number().positive(),
  spawnPoints: z.number().int().positive(),
  spawns: z.record(z.string(), z.number().int().nonnegative()),
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
   * 채집에 필요한 도구의 weaponId(items.json/weapons.json 기준, 예: 'axe').
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
   *
   * 건축 재료(나무/돌)는 여기 없다 — PlayerEntity의 전용 필드로 따로 센다.
   * 퀵슬롯은 "손에 드는 것"만 다룬다.
   */
  kind: z.enum(['weapon', 'consumable']),
  /** weapon 전용: weapons.json의 key. 아이템 id와 달라질 수 있어 따로 둔다. */
  weaponId: z.string().optional(),
  /** consumable 전용: 회복량 */
  healAmount: z.number().positive().optional(),
  /** 한 슬롯에 쌓을 수 있는 최대 개수. 무기처럼 겹치면 안 되는 건 1이다. */
  stackSize: z.number().int().positive(),
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
  /** 게임 시작 시 모든 플레이어에게 주는 아이템. 순서가 곧 퀵슬롯 순서다. */
  starting: z.array(LoadoutEntrySchema),
});

export type LoadoutEntry = z.infer<typeof LoadoutEntrySchema>;

export const loadoutData = loadData(LoadoutDataSchema, loadoutJson);

// --- colonies.json ------------------------------------------------------------

/**
 * 콜로니 난이도 구간. `afterWave` 이하의 값들 중 현재 웨이브(`WaveManager.currentWave`)에
 * 가장 가까운(가장 큰) 항목을 골라 쓴다 — 밤 웨이브(waves.json)가 이미 웨이브 진행도로
 * 난이도 곡선을 그리는 것과 같은 축을 재사용해서, "시간이 지날수록 강해진다"를 게임 내
 * 절대 시간이 아니라 웨이브 진행도로 표현한다.
 */
const ColonyStageSchema = z.object({
  afterWave: z.number().int().nonnegative(),
  spawnIntervalSeconds: z.number().positive(),
  /** 이 구간에서 나올 수 있는 몬스터 타입(monsters.json 키). 스폰마다 하나를 무작위로 고른다. */
  types: z.array(z.string()).min(1),
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
    /** 채널링(콜로니 파괴 작업)에 필요한 시간(초). */
    channelSeconds: z.number().positive(),
    /** 콜로니 파괴 1회당 팀 공유 창고(coreSharedEnergy)에 지급되는 양. */
    essenceReward: z.number().int().positive(),
    stages: z.array(ColonyStageSchema).min(1),
  })
  .refine((data) => data.spawnRadiusMax >= data.spawnRadiusMin, {
    message: 'spawnRadiusMax는 spawnRadiusMin 이상이어야 한다',
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
  /** 업그레이드 전(tier 0) 기본 건설 가능 반경(px, 코어 원점 기준). */
  baseBuildRadius: z.number().positive(),
  tiers: z.array(CoreUpgradeTierSchema).min(1),
});

export type CoreUpgradeTier = z.infer<typeof CoreUpgradeTierSchema>;
export type CoreUpgradesData = z.infer<typeof CoreUpgradesDataSchema>;

export const coreUpgradesData = loadData(CoreUpgradesDataSchema, coreUpgradesJson);
