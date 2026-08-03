import { z } from 'zod';
import monstersJson from './monsters.json';
import weaponsJson from './weapons.json';
import wavesJson from './waves.json';

export function loadData<T>(schema: z.ZodType<T>, json: unknown): T {
  return schema.parse(json);
}

// --- monsters.json ---------------------------------------------------------

const MonsterDataSchema = z.object({
  hp: z.number().positive(),
  damage: z.number().nonnegative(),
  speed: z.number().nonnegative(),
  attackRange: z.number().nonnegative(),
  attackInterval: z.number().positive(),
  /** 있으면 이 반경 내 플레이어를 코어 대신 직접 추격한다(돌진형/보스). 없으면 항상 코어로 직진. */
  aggroRadius: z.number().nonnegative().optional(),
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
  /** ranged 전용 */
  magazine: z.number().int().positive().optional(),
  reloadTime: z.number().positive().optional(),
  projectileSpeed: z.number().positive().optional(),
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
