import Phaser from 'phaser';
import { wavesData } from '@dropfall/shared';
import type { WorldSnapshot } from '../../net/GameConnection';
import { CORE_CRYSTAL_WORLD } from './EntityRenderer';

/**
 * 낮–밤 하늘 연출.
 *
 * **곱셈(MULTIPLY) RenderTexture + 수정구 위치의 광원 구멍** 방식이다.
 *
 * - 곱셈 블렌드가 핵심이다. 반투명 검정 덮개는 모든 대비를 덮개 색으로 눌러 화면을
 *   뿌옇게 만들지만, 곱셈은 원본 색에 하늘 색을 곱해 픽셀 경계·대비가 그대로 남은 채
 *   밝기만 내려간다 — 어두워져도 선명하다. erase로 지운 곳은 투명 = 곱셈 항등이라
 *   광원 안은 원래 밝기 그대로다.
 * - 광원은 원점이 아니라 **수정구**(CORE_CRYSTAL_WORLD)에 얹는다.
 * - 마스크(BitmapMask)를 쓰지 않는 이유: 곱셈 블렌드와 조합하면 이 렌더러에서
 *   마스크가 균일하게 새어 나와 광원이 사라졌다(실측). RT+erase는 검증됐다.
 *
 * 예전에 "광원이 캐릭터를 따라 변하는" 느낌이 났던 건 위치 계산이 아니라 **반경**
 * 때문이었다 — 그라디언트가 화면 전체를 덮으면 카메라가 움직일 때마다 월드 각 지점의
 * 밝기가 바뀐다. 반경을 화면보다 훨씬 작게 줄이면 광원 밖은 항상 같은 어둠이라
 * 완전히 고정된 광원으로 보인다.
 */

/** 하늘 한 시점의 상태. */
interface Sky {
  /** 곱셈 색. 0xFFFFFF면 한낮(변화 없음), 어두울수록 밤. */
  tint: number;
  /** 코어 광원 세기(0~1). 마스크 알파로 들어간다. */
  light: number;
}

/** 키프레임. 낮 → 노을 → 저녁 → 밤. 곱셈이라 색 자체가 "밝기 × 색조"다. */
const DAYLIGHT: Sky = { tint: 0xffffff, light: 0 };
const SUNSET: Sky = { tint: 0xe09a5e, light: 0.15 };
const DUSK: Sky = { tint: 0x8078b0, light: 0.65 };
const NIGHT: Sky = { tint: 0x232e4c, light: 1 };

/**
 * 낮이 끝나기 전 전환 구간(초). "너무 빨리 어두워진다"는 피드백으로 노을 시작을
 * 40→55초로 당겼다 — 90초 낮 기준 35초의 순수 낮 뒤 55초에 걸쳐 천천히 물든다.
 */
const SUNSET_START = Math.min(55, wavesData.dayDuration * 0.6);
const DUSK_START = Math.min(25, wavesData.dayDuration * 0.28);

/** 밤이 끝난 뒤 아침이 밝는 데 걸리는 시간(초). 밤은 몬스터 전멸로 끝나 예고가 없다. */
const DAWN_SECONDS = 10;

/** 목표 하늘로 따라붙는 속도(1/s). 스킵 투표 같은 순간 전환도 ~2초에 걸쳐 물든다. */
const SMOOTH_RATE = 1.4;

/**
 * 코어 광원 반경(월드 px). 160은 화면의 절반을 넘게 밝혀서 "코어 주변만"이 아니었다 —
 * 수정구를 중심으로 받침대와 그 앞 몇 걸음이 보이는 정도로 줄였다.
 */
const CORE_LIGHT_RADIUS = 110;

/** 어둠막은 월드 위·HUD 아래. GameScene 안에서는 무엇보다 위면 된다. */
const OVERLAY_DEPTH = 45000;

const LIGHT_TEXTURE_KEY = 'day-night-core-light';
const LIGHT_TEXTURE_SIZE = 256;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 색·광원을 통째로 보간한다. 색은 RGB 채널별 선형 보간. */
function mixSky(a: Sky, b: Sky, t: number): Sky {
  const ca = Phaser.Display.Color.IntegerToRGB(a.tint);
  const cb = Phaser.Display.Color.IntegerToRGB(b.tint);
  return {
    tint: Phaser.Display.Color.GetColor(
      Math.round(lerp(ca.r, cb.r, t)),
      Math.round(lerp(ca.g, cb.g, t)),
      Math.round(lerp(ca.b, cb.b, t)),
    ),
    light: lerp(a.light, b.light, t),
  };
}

export class DayNightOverlay {
  private readonly veil: Phaser.GameObjects.RenderTexture;
  private readonly lightBrush: Phaser.GameObjects.Image;
  /** 화면에 실제로 얹힌 현재 하늘. 목표를 향해 SMOOTH_RATE로 따라간다. */
  private current: Sky = { ...DAYLIGHT };
  /** 첫 낮(게임 시작)은 어둠에서 밝아지면 안 된다 — 밤을 한 번 겪은 뒤에만 새벽 연출. */
  private hasSeenNight = false;

  constructor(scene: Phaser.Scene) {
    ensureLightTexture(scene);

    this.veil = scene.add
      .renderTexture(0, 0, scene.scale.width, scene.scale.height)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(OVERLAY_DEPTH)
      .setBlendMode(Phaser.BlendModes.MULTIPLY)
      .setVisible(false);

    // 지우개로 쓸 원광. 화면에 직접 그리지 않으므로 표시 목록에 넣지 않는다.
    this.lightBrush = scene.make.image({ key: LIGHT_TEXTURE_KEY, add: false });
  }

  resize(width: number, height: number): void {
    this.veil.resize(width, height);
  }

  update(
    status: WorldSnapshot['status'],
    camera: Phaser.Cameras.Scene2D.Camera,
    deltaMs: number,
  ): void {
    if (status.wavePhase === 'night') this.hasSeenNight = true;

    const target = this.targetSky(status);

    // 목표로 지수 감쇠 보간 — 프레임률과 무관하게 같은 속도로 붙는다.
    const t = 1 - Math.exp(-SMOOTH_RATE * (deltaMs / 1000));
    this.current = mixSky(this.current, target, t);

    // 한낮(흰색 곱셈 = 변화 없음)에 근접하면 아예 끈다.
    const rgb = Phaser.Display.Color.IntegerToRGB(this.current.tint);
    if (rgb.r > 251 && rgb.g > 251 && rgb.b > 251) {
      this.veil.setVisible(false);
      return;
    }
    this.veil.setVisible(true);
    this.veil.clear();
    this.veil.fill(this.current.tint, 1);

    if (this.current.light > 0.01) {
      // 광원은 수정구 위. worldView가 줌을 이미 반영하고 있다.
      const screenX = (CORE_CRYSTAL_WORLD.x - camera.worldView.x) * camera.zoom;
      const screenY = (CORE_CRYSTAL_WORLD.y - camera.worldView.y) * camera.zoom;
      const diameter = CORE_LIGHT_RADIUS * 2 * camera.zoom;

      this.lightBrush.setAlpha(this.current.light);
      this.lightBrush.setDisplaySize(diameter, diameter);
      this.veil.erase(this.lightBrush, screenX, screenY);
    }
  }

  /** 지금 이 순간의 목표 하늘. 페이즈와 남은 시간에서만 계산한다(상태 없음). */
  private targetSky(status: WorldSnapshot['status']): Sky {
    if (status.wavePhase === 'night') return NIGHT;
    // 승리/패배 화면은 결과가 잘 보이게 하늘을 걷는다.
    if (status.wavePhase !== 'day') return DAYLIGHT;

    const remaining = status.phaseTimeRemaining;
    const elapsed = wavesData.dayDuration - remaining;

    // 새벽 — 밤을 겪은 다음 낮의 첫 몇 초만. 게임 시작 직후는 한낮에서 출발한다.
    if (this.hasSeenNight && elapsed < DAWN_SECONDS) {
      return mixSky(NIGHT, DAYLIGHT, elapsed / DAWN_SECONDS);
    }
    // 저녁 → 밤: 남은 시간이 0이 되는 순간 정확히 밤 색이 완성된다.
    if (remaining <= DUSK_START) {
      return mixSky(DUSK, NIGHT, 1 - remaining / DUSK_START);
    }
    // 노을 → 저녁.
    if (remaining <= SUNSET_START) {
      return mixSky(SUNSET, DUSK, 1 - (remaining - DUSK_START) / (SUNSET_START - DUSK_START));
    }
    return DAYLIGHT;
  }
}

/**
 * 방사형 원광 텍스처. 중심은 완전히 밝고 가장자리로 부드럽게 사라진다 —
 * 이 알파가 곧 "어둠을 얼마나 걷어내는가"다. 한 번 만들어 캐시한다.
 */
function ensureLightTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(LIGHT_TEXTURE_KEY)) return;

  const canvas = scene.textures.createCanvas(LIGHT_TEXTURE_KEY, LIGHT_TEXTURE_SIZE, LIGHT_TEXTURE_SIZE);
  if (!canvas) return;
  const ctx = canvas.getContext();
  const half = LIGHT_TEXTURE_SIZE / 2;

  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  // 중심 55%까지는 온전히 밝게 — 코어 앞 작업 공간은 또렷해야 한다.
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.55, 'rgba(255,255,255,0.95)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, LIGHT_TEXTURE_SIZE, LIGHT_TEXTURE_SIZE);
  canvas.refresh();
}
