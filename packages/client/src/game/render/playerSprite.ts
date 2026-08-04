import Phaser from 'phaser';
import { JOB_IDS, type JobId } from '@dropfall/shared';
import { resolveAssetUrl } from '../../ui/assets';

/** 인게임 월드 스프라이트 아틀라스 (assets/atlas.config.json의 "game") */
export const GAME_ATLAS = 'game';

/**
 * 직업 id가 곧 스프라이트 원본 파일명이라 프레임 접두사로 그대로 쓴다.
 * `assets/sprites/characters/soldier.aseprite` → `soldier_front_0` …
 */
export const DEFAULT_JOB: JobId = 'soldier';

/** 직업을 아직 안 골랐거나 알 수 없는 값이면 기본 직업으로 그린다. */
export function spritePrefix(job: string): JobId {
  return (JOB_IDS as readonly string[]).includes(job) ? (job as JobId) : DEFAULT_JOB;
}

/**
 * 시트에 있는 방향 3종. 오른쪽은 `left`를 좌우 반전해서 쓴다.
 * (아트 작업량을 줄이려고 오른쪽 시트를 따로 만들지 않았다)
 */
export const DIRECTIONS = ['front', 'left', 'back'] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const FRAMES_PER_DIRECTION = 4;
/** 걷기 사이클 재생 속도(fps). 4프레임이라 이 값이 낮을수록 한 걸음이 느긋해진다. */
const WALK_FRAME_RATE = 5;

/** 캐릭터 32×32에서 실제 그림은 y 2~29에 있다. 원점을 발밑에 두면 탑다운 Y-정렬이 맞는다. */
export const PLAYER_ORIGIN_Y = 0.94;

export function walkAnimKey(job: JobId, direction: Direction): string {
  return `${job}_${direction}`;
}

export function idleFrame(job: JobId, direction: Direction): string {
  return `${job}_${direction}_0`;
}

/**
 * 아틀라스 로드를 예약한다. 파일이 아직 없으면 로더가 실패하는데, 이건 오류가 아니라
 * "에셋이 아직 없는 상태"다 — 조용히 넘어가고 도형 플레이스홀더로 그린다.
 */
export function queueGameAtlas(scene: Phaser.Scene): void {
  scene.load.atlas(
    GAME_ATLAS,
    resolveAssetUrl('assets/atlas/game.png'),
    resolveAssetUrl('assets/atlas/game.json'),
  );
  scene.load.once(Phaser.Loader.Events.FILE_LOAD_ERROR, () => {
    console.info('[DropFall] game 아틀라스가 없어 도형 플레이스홀더로 그립니다.');
  });
}

/** 아틀라스가 올라왔고 기본 직업 프레임이 들어 있는지 */
export function hasPlayerSprite(scene: Phaser.Scene): boolean {
  return (
    scene.textures.exists(GAME_ATLAS) &&
    scene.textures.get(GAME_ATLAS).has(idleFrame(DEFAULT_JOB, 'front'))
  );
}

/** 해당 직업 스프라이트가 아틀라스에 실제로 들어 있는지 (일부 직업만 그려진 상태 대비) */
export function hasJobSprite(scene: Phaser.Scene, job: JobId): boolean {
  return scene.textures.get(GAME_ATLAS).has(idleFrame(job, 'front'));
}

/**
 * 직업 × 방향 걷기 애니메이션을 등록한다.
 * 아틀라스에 없는 직업은 건너뛴다 — 없는 프레임으로 애니메이션을 만들면 렌더 시 깨진다.
 */
export function registerPlayerAnimations(scene: Phaser.Scene): void {
  for (const job of JOB_IDS) {
    if (!hasJobSprite(scene, job)) continue;

    for (const direction of DIRECTIONS) {
      const key = walkAnimKey(job, direction);
      if (scene.anims.exists(key)) continue;

      scene.anims.create({
        key,
        frames: scene.anims.generateFrameNames(GAME_ATLAS, {
          prefix: `${job}_${direction}_`,
          start: 0,
          end: FRAMES_PER_DIRECTION - 1,
        }),
        frameRate: WALK_FRAME_RATE,
        repeat: -1,
      });
    }
  }
}

/**
 * 조준각(라디안) → 화면에 보여줄 방향.
 *
 * **이동 방향이 아니라 조준 방향을 기준으로 삼는다.** 마우스로 조준하는 슈터라
 * 게걸음(strafe)으로 옆으로 움직여도 몸은 겨누는 쪽을 봐야 자연스럽다.
 * 이동 기준으로 바꾸고 싶으면 이 함수에 넘기는 각도만 바꾸면 된다.
 *
 * 화면 좌표계라 아래쪽이 +y다: 0=오른쪽, π/2=아래(정면), π=왼쪽, -π/2=위(후면).
 */
export function directionFromAngle(angle: number): { direction: Direction; flipX: boolean } {
  const degrees = ((angle * 180) / Math.PI + 360) % 360;

  if (degrees >= 45 && degrees < 135) return { direction: 'front', flipX: false };
  if (degrees >= 135 && degrees < 225) return { direction: 'left', flipX: false };
  if (degrees >= 225 && degrees < 315) return { direction: 'back', flipX: false };
  // 오른쪽은 왼쪽 시트를 좌우 반전해서 쓴다
  return { direction: 'left', flipX: true };
}
