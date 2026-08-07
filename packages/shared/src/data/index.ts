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
  /** 이 거리 안에 들어오면 이동을 멈추고 채집을 시작한다. */
  harvestRange: z.number().positive(),
  /** 채집 한 번(harvestIntervalSeconds마다)에 노드 hp를 깎는 양. */
  harvestDamage: z.number().positive(),
  harvestIntervalSeconds: z.number().positive(),
  /** carriedWood + carriedStone이 이 값 이상이면 코어로 돌아간다. */
  capacity: z.number().int().positive(),
  maxHp: z.number().positive(),
  /** 코어 기준 스폰 위치(px). */
  spawnOffset: z.object({ x: z.number(), y: z.number() }),
});

export type CompanionData = z.infer<typeof CompanionDataSchema>;

export const companionData = loadData(CompanionDataSchema, companionJson);
