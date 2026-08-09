import Phaser from 'phaser';
import { weaponsData, type TerrainKind } from '@dropfall/shared';
import type { MonsterView, PlayerView, WorldStatus } from '../../net/GameConnection';
import { resolveAssetUrl } from '../../ui/assets';

/**
 * 효과음. 전부 `GameScene.preload()`에서 한꺼번에 올린다 — 다 합쳐도 20MB 안쪽이라
 * 초기 로딩에 크게 얹히지 않는다(배경음악과 달리 게임 시작하자마자 쓰인다).
 */
const SFX_FILES = {
  playerDown: 'assets/sounds/player-down.wav',
  playerRevive: 'assets/sounds/player-revive.wav',
  footstepTile: 'assets/sounds/footstep-tile.ogg',
  footstepGrass: 'assets/sounds/footstep-grass.wav',
  footstepDirt: 'assets/sounds/footstep-dirt.wav',
  swingBat: 'assets/sounds/swing-bat.wav',
  swingAxe: 'assets/sounds/swing-axe.mp3',
  swingGeneric: 'assets/sounds/swing-generic.wav',
  gunPistol: 'assets/sounds/gun-pistol.wav',
  gunAuto: 'assets/sounds/gun-auto.wav',
  gunEmpty: 'assets/sounds/gun-empty.wav',
  gunShotgun: 'assets/sounds/gun-shotgun.wav',
  gunReload: 'assets/sounds/gun-reload.wav',
  monsterSpawn: 'assets/sounds/monster-spawn.wav',
  monster1: 'assets/sounds/monster-1.wav',
  monster2: 'assets/sounds/monster-2.wav',
  monster3: 'assets/sounds/monster-3.wav',
} as const;

type SfxKey = keyof typeof SFX_FILES;

/** 한 번 재생될 때마다 귀가 아프지 않도록 종류별로 기본 볼륨을 따로 잡는다. */
const SFX_VOLUME: Record<SfxKey, number> = {
  playerDown: 0.7,
  playerRevive: 0.7,
  footstepTile: 0.22,
  footstepGrass: 0.22,
  footstepDirt: 0.22,
  swingBat: 0.55,
  swingAxe: 0.55,
  swingGeneric: 0.5,
  gunPistol: 0.5,
  gunAuto: 0.4,
  gunEmpty: 0.45,
  gunShotgun: 0.55,
  gunReload: 0.5,
  monsterSpawn: 0.45,
  monster1: 0.4,
  monster2: 0.4,
  monster3: 0.4,
};

/**
 * 배경음악. SFX와 달리 **미리 올리지 않는다** — 6개 다 합치면 20MB가 넘어서, 게임을
 * 시작하자마자 필요하지도 않은 밤 3~5일차 곡까지 로딩에 얹으면 첫 화면이 느려진다.
 * 대신 그 국면이 실제로 오면 그때 로드한다(첫 전환만 로딩 대기, 이후엔 캐시).
 *
 * Day별 배정은 팀 결정(2026-08-09) — 낮/1일차 밤은 고정곡, 2~5일차 밤(전부 보스전)은
 * 각자 다른 곡:
 *   낮: peace/song_2 · 밤(1일차, 보스 없음): night/arpmedia-dark-tension
 *   2일차 보스: night/leberch-tension · 3일차: boss/backgroundmusicmaster-bossroom-battle
 *   4일차: boss/the_mountain-battle-music · 5일차: boss/davidjbarrios-epic-boss-battle
 */
const BGM_FILES = {
  day: 'assets/sounds/bgm-day.mp3',
  'night-1': 'assets/sounds/bgm-night-1.mp3',
  'night-2': 'assets/sounds/bgm-night-2.mp3',
  'night-3': 'assets/sounds/bgm-night-3.mp3',
  'night-4': 'assets/sounds/bgm-night-4.mp3',
  'night-5': 'assets/sounds/bgm-night-5.mp3',
} as const;

type BgmKey = keyof typeof BGM_FILES;

const BGM_VOLUME = 0.32;
/** 국면이 바뀔 때 배경음악을 서서히 섞는 시간(ms). 뚝 끊기면 전환이 튄다. */
const BGM_FADE_MS = 900;

/** 발소리가 밟는 표면. 지형 4종에 "코어 마당 포장"(지형이 아니라 반경으로만 정해지는
 * 별도 레이어 — TerrainLayer의 courtyard) 하나를 더한다. */
export type FootstepSurface = TerrainKind | 'tile';

/** 지형 4종 + 포장을 소리 3종으로 묶는다 — 포장만 "타일", 나머지는 풀/흙이다. */
const TERRAIN_FOOTSTEP: Record<FootstepSurface, SfxKey> = {
  tile: 'footstepTile',
  grass: 'footstepGrass',
  dirt: 'footstepDirt',
  // 모래·돌바닥 전용 발소리는 없다 — 포장이 아닌 맨땅이라는 점에서 흙과 같은 갈래로 묶었다.
  sand: 'footstepDirt',
  stone: 'footstepDirt',
};

/** 발소리가 실제로 걸음처럼 들리도록 짧게 반복 재생한다(루프 파일이 아니다). */
const FOOTSTEP_INTERVAL_MS = 340;

/** 같은 순간 몬스터 여러 마리가 한꺼번에 스폰/공격해도 귀청이 터지지 않게 두는 최소 간격(ms). */
const MONSTER_SFX_MIN_GAP_MS = 260;

const MONSTER_GROWL_KEYS: SfxKey[] = ['monster1', 'monster2', 'monster3'];

/** 근접 무기 id·계열 → 휘두르기 SFX. 몽둥이만 전용음이 있고, 도끼 계열(toolFamily)은
 * 도끼 전용음을, 나머지는 공용 휘두르기음을 쓴다. */
function meleeSwingKey(weaponId: string): SfxKey {
  if (weaponId === 'bat') return 'swingBat';
  const weapon = weaponsData[weaponId];
  const isAxe = weapon?.toolFamily === 'axe' || weapon?.toolFamilies?.includes('axe');
  return isAxe ? 'swingAxe' : 'swingGeneric';
}

/**
 * 원거리 무기 id → 총성 SFX. 데이터에 있는 필드만으로 가른다(무기 목록이 늘어도
 * 여기 손댈 필요가 없게): 산탄(pellets)이 있으면 샷건, 연사(fireRate 6 이상이거나
 * 점사 burst가 있으면) 기관총, 나머지는 전부 권총류(단발 취급).
 */
function rangedFireKey(weaponId: string): SfxKey {
  const weapon = weaponsData[weaponId];
  if (weapon?.pellets !== undefined) return 'gunShotgun';
  if (weapon?.burst !== undefined || (weapon && weapon.fireRate >= 6)) return 'gunAuto';
  return 'gunPistol';
}

/** 1일차 밤(보스 없음)만 고정곡, 2~5일차는 각자 다른 보스곡 — 5일차보다 뒤는 없다
 * (5개 웨이브가 끝이라 그 이상은 승리 처리). */
function nightBgmKey(currentWave: number): BgmKey {
  const wave = Phaser.Math.Clamp(Math.round(currentWave), 1, 5);
  return `night-${wave}` as BgmKey;
}

/** GameScene.preload()에서 호출. 없어도 게임은 뜨고, 그냥 조용할 뿐이다. */
export function queueAudio(scene: Phaser.Scene): void {
  for (const [key, path] of Object.entries(SFX_FILES)) {
    scene.load.audio(key, resolveAssetUrl(path));
  }
  scene.load.once(Phaser.Loader.Events.FILE_LOAD_ERROR, () => {
    console.info('[DropFall] 효과음 일부를 불러오지 못했습니다 — 그 소리만 조용히 재생을 건너뜁니다.');
  });
}

/**
 * 게임 소리 전체를 관리한다. `GameScene.create()`에서 한 번 만들어 씬이 끝날 때까지
 * 들고 있는다 — Phaser의 사운드 매니저(`scene.sound`) 자체가 씬이 아니라 게임
 * 인스턴스에 붙어 있어서, 배경음악이 씬 재시작에 끊기지 않는다.
 */
export class AudioManager {
  private muted = false;

  private currentBgmKey?: BgmKey;
  private currentBgm?: Phaser.Sound.BaseSound;
  /** 로딩 중인 배경음악 키. filecomplete 콜백이 "아직도 이걸 원하나"를 이걸로 다시 확인한다
   * (로딩 도중 국면이 또 바뀌면, 다 받고 나서도 이제 와서 틀면 안 된다). */
  private pendingBgmKey?: BgmKey;
  /** 지금 실제로 로드 요청을 걸어 둔 키. 같은 키를 중복 요청하지 않으려고 따로 둔다
   * (짧은 시간에 국면이 왔다 갔다 하면 리스너가 여러 번 걸려 같은 곡이 겹쳐 재생된다). */
  private loadingBgmKey?: BgmKey;

  private footstepKind?: SfxKey;
  private footstepNextAt = 0;

  private readonly lastLifeState = new Map<string, PlayerView['lifeState']>();
  private readonly knownMonsterIds = new Set<string>();
  private readonly lastAttackSeq = new Map<string, number>();
  private lastSpawnSfxAt = -Infinity;
  private lastGrowlSfxAt = -Infinity;
  private lastReloadRemaining = 0;

  constructor(private readonly scene: Phaser.Scene) {}

  toggleMute(): void {
    this.muted = !this.muted;
    this.scene.sound.mute = this.muted;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** 씬을 나갈 때(대기실로 복귀 등) 부른다 — 안 그러면 배경음악이 게임 화면을 떠나서도
   * 계속 흐른다(사운드 매니저가 씬이 아니라 게임 인스턴스에 붙어 있어서). */
  stopAll(): void {
    this.currentBgm?.stop();
    this.currentBgm = undefined;
    this.currentBgmKey = undefined;
    this.pendingBgmKey = undefined;
  }

  /** InputController의 onAttack — 실제로 나간 공격에만 붙는다(§InputController.updateFire). */
  notifyAttack(weaponId: string): void {
    const weapon = weaponsData[weaponId];
    if (!weapon) return;
    this.playSfx(weapon.type === 'melee' ? meleeSwingKey(weaponId) : rangedFireKey(weaponId));
  }

  /** InputController의 onEmptyFire — 탄창이 빈 채로 방아쇠를 당겼을 때 한 번만. */
  notifyEmptyFire(): void {
    this.playSfx('gunEmpty');
  }

  /**
   * 매 프레임 호출. 배경음악·몬스터·부활 상태처럼 "스냅샷을 보고 판단하는" 소리는
   * 전부 여기서 처리한다 — 이벤트 훅을 따로 늘리지 않고 이전 프레임과 비교해서 찾는다.
   */
  update(
    status: WorldStatus,
    players: PlayerView[],
    monsters: MonsterView[],
    me: PlayerView | undefined,
    localMoving: boolean,
    localSurface: FootstepSurface | undefined,
  ): void {
    this.updateMusic(status.wavePhase, status.currentWave);
    this.updateLifeStates(players);
    this.updateMonsters(monsters);
    this.updateReload(me);
    this.updateFootsteps(me, localMoving, localSurface);
  }

  // ------------------------------------------------------------------ 배경음악

  private updateMusic(wavePhase: string, currentWave: number): void {
    const key: BgmKey | undefined =
      wavePhase === 'day' ? 'day' : wavePhase === 'night' ? nightBgmKey(currentWave) : undefined;
    if (key === this.currentBgmKey) return;
    this.crossfadeTo(key);
  }

  private crossfadeTo(key: BgmKey | undefined): void {
    const old = this.currentBgm;
    this.currentBgmKey = key;
    this.pendingBgmKey = key;
    if (old) {
      this.scene.tweens.add({
        targets: old,
        volume: 0,
        duration: BGM_FADE_MS,
        onComplete: () => old.stop(),
      });
    }
    this.currentBgm = undefined;
    if (!key) return; // 승리/패배 — 새로 틀 곡이 없다. 페이드아웃만 하고 조용해진다.

    if (this.scene.cache.audio.exists(key)) {
      this.startBgm(key);
      return;
    }
    if (this.loadingBgmKey === key) return; // 이미 이 키로 요청을 걸어 뒀다.

    this.loadingBgmKey = key;
    this.scene.load.audio(key, resolveAssetUrl(BGM_FILES[key]));
    this.scene.load.once(`filecomplete-audio-${key}`, () => {
      this.loadingBgmKey = undefined;
      // 로딩하는 사이 국면이 또 바뀌어 이제 이 곡을 원하지 않으면 틀지 않는다.
      if (this.pendingBgmKey === key) this.startBgm(key);
    });
    if (!this.scene.load.isLoading()) this.scene.load.start();
  }

  private startBgm(key: BgmKey): void {
    const sound = this.scene.sound.add(key, { loop: true, volume: 0 });
    sound.play();
    this.currentBgm = sound;
    this.scene.tweens.add({ targets: sound, volume: BGM_VOLUME, duration: BGM_FADE_MS });
  }

  // ------------------------------------------------------------------ 부활/쓰러짐

  private updateLifeStates(players: PlayerView[]): void {
    for (const player of players) {
      const prev = this.lastLifeState.get(player.id);
      this.lastLifeState.set(player.id, player.lifeState);
      if (prev === undefined || prev === player.lifeState) continue;

      if (player.lifeState === 'downed') this.playSfx('playerDown');
      else if (player.lifeState === 'alive' && (prev === 'downed' || prev === 'ghost')) {
        this.playSfx('playerRevive');
      }
    }
  }

  // ------------------------------------------------------------------ 몬스터

  private updateMonsters(monsters: MonsterView[]): void {
    const now = this.scene.time.now;
    let spawned = false;
    let attacked = false;

    for (const monster of monsters) {
      if (!this.knownMonsterIds.has(monster.id)) {
        this.knownMonsterIds.add(monster.id);
        spawned = true;
      }
      const lastSeq = this.lastAttackSeq.get(monster.id);
      this.lastAttackSeq.set(monster.id, monster.attackSeq);
      if (lastSeq !== undefined && lastSeq !== monster.attackSeq) attacked = true;
    }
    // 사라진 몬스터는 추적을 접는다 — 안 그러면 두 맵이 영원히 자란다.
    if (this.knownMonsterIds.size > monsters.length) {
      const alive = new Set(monsters.map((monster) => monster.id));
      for (const id of this.knownMonsterIds) if (!alive.has(id)) this.knownMonsterIds.delete(id);
      for (const id of this.lastAttackSeq.keys()) if (!alive.has(id)) this.lastAttackSeq.delete(id);
    }

    // 웨이브 시작처럼 한꺼번에 여럿이 뜨는 순간에도 한 번만 운다 — 마릿수만큼 울리면 소음이다.
    if (spawned && now - this.lastSpawnSfxAt >= MONSTER_SFX_MIN_GAP_MS) {
      this.lastSpawnSfxAt = now;
      this.playSfx('monsterSpawn');
    }
    if (attacked && now - this.lastGrowlSfxAt >= MONSTER_SFX_MIN_GAP_MS) {
      this.lastGrowlSfxAt = now;
      const key = MONSTER_GROWL_KEYS[Math.floor(Math.random() * MONSTER_GROWL_KEYS.length)]!;
      this.playSfx(key);
    }
  }

  // ------------------------------------------------------------------ 재장전

  private updateReload(me: PlayerView | undefined): void {
    const remaining = me?.reloadRemaining ?? 0;
    if (remaining > 0 && this.lastReloadRemaining <= 0) this.playSfx('gunReload');
    this.lastReloadRemaining = remaining;
  }

  // ------------------------------------------------------------------ 발소리

  /**
   * 내 캐릭터 발소리만 낸다(원격 팀원은 대상 밖) — 자기 행동에 대한 즉각적인 피드백이
   * 목적이라, 위치 기반 음량 감쇠 없이 그냥 들리는 지금 단계에서는 남의 발소리까지
   * 섞으면 시끄럽기만 하다.
   */
  private updateFootsteps(
    me: PlayerView | undefined,
    moving: boolean,
    surface: FootstepSurface | undefined,
  ): void {
    const alive = !!me && me.hp > 0 && me.lifeState === 'alive';
    if (!alive || !moving || !surface) {
      this.footstepNextAt = 0;
      return;
    }

    const key = TERRAIN_FOOTSTEP[surface];
    const now = this.scene.time.now;
    if (key !== this.footstepKind) {
      // 지형이 바뀌면 다음 걸음부터 바로 새 소리로 — 늦게 갈아타면 눈(화면)과 귀가 어긋난다.
      this.footstepKind = key;
      this.footstepNextAt = now;
    }
    if (now < this.footstepNextAt) return;

    this.footstepNextAt = now + FOOTSTEP_INTERVAL_MS;
    this.playSfx(key);
  }

  // ------------------------------------------------------------------ 공용

  private playSfx(key: SfxKey): void {
    if (this.muted || !this.scene.cache.audio.exists(key)) return;
    this.scene.sound.play(key, { volume: SFX_VOLUME[key] });
  }
}
