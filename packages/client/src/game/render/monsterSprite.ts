import Phaser from 'phaser';
import { resolveAssetUrl } from '../../ui/assets';

/**
 * 몬스터 스프라이트(assets/atlas.config.json의 "monsters" 아틀라스).
 *
 * **왜 game 아틀라스와 분리돼 있나** — 여기 쓰는 에셋 팩은 재업로드 금지 라이센스라
 * 저장소에 올릴 수 없어서 아틀라스를 따로 뽑는다(assets/sprites/monsters/README.md).
 * 그래서 이 아틀라스는 **없을 수 있다** — 에셋을 받지 않은 팀원의 클론에서는 파일
 * 자체가 없고, 그때는 렌더러가 기존 도형 플레이스홀더로 그대로 떨어진다.
 */
export const MONSTER_ATLAS = 'monsters';

/**
 * 몬스터 타입(monsters.json 키) → 스프라이트 팩 파일명.
 *
 * 팩의 원본 파일명을 그대로 쓴다(공백·대문자 포함). 파일명을 우리 규칙으로 바꾸지
 * 않는 이유: 에셋을 다시 받으면 원래 이름으로 돌아오는데, 그때마다 손으로 고치면
 * "받는 사람마다 다르게 동작"하는 상태가 된다. 이름 변환을 사람이 아니라 이 표가
 * 담당하면 팩을 그대로 풀어 넣기만 하면 된다.
 *
 * 아틀라스 프레임 이름 규칙은 `{파일명}_{태그}_{태그내번호}`다(assets/README.md).
 */
const SPRITE_FILE: Record<string, string> = {
  demon: 'Demon_A',
  hellhound: 'Hellhound',
  blood: 'Blood Monster_A',
  eyeball: 'Eyeball Monster',
  lava_slime: 'Lava Slime',
  minotaur: 'Minotaur',
  boss_demon: 'Demon_E',
  boss_knight: 'Black Knight_A',
  boss_golem: 'Flame Golem',
  boss_dark_knight: 'Black Knight_C',
};

/**
 * 그림 높이(px). 실측값이다 — 100×100 캔버스에서 Idle/Walk 프레임의 불투명 픽셀
 * 세로 범위를 재서 넣었다. HP 바를 머리 위에 띄우는 데만 쓴다(판정과 무관).
 * 배율을 바꾸면 여기도 같이 바꿔야 한다.
 */
const SPRITE_HEIGHT: Record<string, number> = {
  demon: 22,
  hellhound: 20,
  blood: 19,
  eyeball: 17,
  lava_slime: 19,
  minotaur: 23,
  boss_demon: 25,
  boss_knight: 33,
  boss_golem: 31,
  boss_dark_knight: 31,
};

/** 그림 높이를 모를 때(표에 없는 타입) 쓰는 값. */
const DEFAULT_SPRITE_HEIGHT = 24;

/**
 * 스프라이트 원점의 세로 위치(프레임 높이 대비 비율).
 *
 * 팩의 10종 전부가 100px 캔버스의 **y=60에 발이 닿게** 그려져 있어서(실측) 타입마다
 * 따로 잴 필요가 없다. 발밑을 원점으로 잡아야 탑다운 Y-정렬이 맞는다 — 플레이어
 * 스프라이트(PLAYER_ORIGIN_Y)와 같은 규칙이다.
 */
export const MONSTER_ORIGIN_Y = 0.6;

/**
 * 렌더 배율. 팩 그림이 이미 17~46px라(플레이어 32px와 같은 대역) 확대·축소 없이 쓴다.
 * 히트박스(hitRadius)보다 그림이 1.5~2배 큰데, 이건 플레이어도 같은 비율이라
 * (스프라이트 32px vs 판정 지름 20px) 이 게임에서 일관된 감각이다.
 */
export const MONSTER_SCALE = 1;

/**
 * 팩의 태그 이름(대문자 시작)을 우리가 쓰는 상태 이름에 붙인 것.
 *
 * 공격은 팩마다 Attack01~03이 있는데 첫 번째만 쓴다 — 서버가 구분하는 건 "공격했다"
 * 하나뿐이라, 어느 변형을 쓸지 고를 근거가 없다. 나중에 패턴이 갈리면 그때 늘린다.
 */
const TAG = {
  idle: 'Idle',
  walk: 'Walk',
  attack: 'Attack01',
  hurt: 'Hurt',
  death: 'Death',
} as const;
export type MonsterAnim = keyof typeof TAG;

/** 피격은 빠르게 지나가야 한다 — 4프레임을 18fps로 돌리면 0.22초로, 연사에도 안 밀린다. */
const FRAME_RATE: Record<MonsterAnim, number> = {
  idle: 6,
  walk: 10,
  attack: 14,
  hurt: 18,
  death: 12,
};

/** 한 번만 재생하고 멈추는 상태(반복하면 안 되는 것들). */
const ONE_SHOT: ReadonlySet<MonsterAnim> = new Set<MonsterAnim>(['attack', 'hurt', 'death']);

/** 아틀라스 로드를 예약한다. 파일이 없으면(에셋 미보유) 조용히 넘어간다. */
export function queueMonsterAtlas(scene: Phaser.Scene): void {
  scene.load.atlas(
    MONSTER_ATLAS,
    resolveAssetUrl('assets/atlas/monsters.png'),
    resolveAssetUrl('assets/atlas/monsters.json'),
  );
}

export function hasMonsterAtlas(scene: Phaser.Scene): boolean {
  return scene.textures.exists(MONSTER_ATLAS);
}

/** 이 타입의 그림이 아틀라스에 실제로 들어 있는지(팩 일부만 있는 상태 대비). */
export function hasMonsterSprite(scene: Phaser.Scene, type: string): boolean {
  const file = SPRITE_FILE[type];
  if (!file || !hasMonsterAtlas(scene)) return false;
  return scene.textures.get(MONSTER_ATLAS).has(`${file}_${TAG.idle}_0`);
}

export function monsterAnimKey(type: string, anim: MonsterAnim): string {
  return `mob_${type}_${anim}`;
}

export function monsterIdleFrame(type: string): string {
  return `${SPRITE_FILE[type]}_${TAG.idle}_0`;
}

export function monsterSpriteHeight(type: string): number {
  return SPRITE_HEIGHT[type] ?? DEFAULT_SPRITE_HEIGHT;
}

/**
 * 프레임 이름을 끝의 번호로 정렬해 모은다. `generateFrameNames`로 start/end를 주려면
 * 태그별 프레임 수를 미리 알아야 하는데, 그 숫자는 팩마다 다르고(같은 Walk도 6장/8장)
 * 우리가 만든 게 아니라서 코드에 박아둘 수 없다 — 아틀라스에 실제로 있는 것을 읽는다.
 */
function framesFor(scene: Phaser.Scene, file: string, tag: string): string[] {
  const prefix = `${file}_${tag}_`;
  return scene.textures
    .get(MONSTER_ATLAS)
    .getFrameNames()
    .filter((name) => name.startsWith(prefix))
    .sort((a, b) => Number(a.slice(prefix.length)) - Number(b.slice(prefix.length)));
}

/**
 * 타입 × 상태 애니메이션을 등록한다. 아틀라스에 없는 타입/태그는 건너뛴다 —
 * 없는 프레임으로 애니메이션을 만들면 재생 시 깨진다.
 */
export function registerMonsterAnimations(scene: Phaser.Scene): void {
  if (!hasMonsterAtlas(scene)) return;

  for (const [type, file] of Object.entries(SPRITE_FILE)) {
    for (const anim of Object.keys(TAG) as MonsterAnim[]) {
      const key = monsterAnimKey(type, anim);
      if (scene.anims.exists(key)) continue;

      const frames = framesFor(scene, file, TAG[anim]);
      if (frames.length === 0) continue;

      scene.anims.create({
        key,
        frames: frames.map((frame) => ({ key: MONSTER_ATLAS, frame })),
        frameRate: FRAME_RATE[anim],
        // 공격·피격·죽음은 한 번만 재생한다. 죽음은 마지막 장에서 멈춰 시체가 남고,
        // 나머지는 끝나는 즉시 렌더러가 이동/대기 상태로 되돌린다.
        repeat: ONE_SHOT.has(anim) ? 0 : -1,
      });
    }
  }
}
