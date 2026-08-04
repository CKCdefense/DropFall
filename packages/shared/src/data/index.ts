import { z } from 'zod';
import monstersJson from './monsters.json';
import weaponsJson from './weapons.json';
import wavesJson from './waves.json';
import resourcesJson from './resources.json';
import toolsJson from './tools.json';
import buildingsJson from './buildings.json';
import itemsJson from './items.json';
import loadoutJson from './loadout.json';

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

const MonsterDataSchema = z.object({
  hp: z.number().positive(),
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
});

const MonstersDataSchema = z.record(z.string(), MonsterDataSchema);

export type MonsterType = keyof typeof monstersData;
export type MonsterData = z.infer<typeof MonsterDataSchema>;

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
  /** 채집에 필요한 도구 id(tools.json 참고). 소유권 검사는 아직 없다 — 문서화 목적. */
  requiredTool: z.string(),
  /** 노드 판정 반경(px, 플레이어 기준) */
  harvestRadius: z.number().positive(),
  /** 채집 1회당 최소 간격(초) */
  harvestInterval: z.number().positive(),
  yieldPerHarvest: z.number().int().positive(),
  /** 고갈 전까지 채집 가능한 총 횟수 */
  maxHarvests: z.number().int().positive(),
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
