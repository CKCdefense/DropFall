import Phaser from 'phaser';
import { wavesData } from '@dropfall/shared';
import type { WorldSnapshot } from '../../net/GameConnection';

/**
 * 낮–밤 하늘 연출.
 *
 * **화면 고정 어둠막 + 코어 불빛 구멍** 방식이다. 화면 크기의 RenderTexture를 하늘
 * 색으로 채우고, 코어의 화면 위치에 방사형 그라디언트를 지워(erase) 빛 웅덩이를
 * 만든다 — 라이트 파이프라인(노멀맵 필요)보다 훨씬 싸고, 픽셀아트에는 이 정도의
 * 부드러운 원광이 오히려 잘 어울린다.
 *
 * 시간 진행은 서버 스냅샷(wavePhase/phaseTimeRemaining)에서만 읽는다 — 클라이언트가
 * 자체 시계를 돌리면 재접속·스킵 투표 때 하늘이 서버와 어긋난다. 대신 목표값을 향해
 * 짧게 따라붙는 보간을 둬서(SMOOTH_RATE), 스킵으로 페이즈가 순간 전환돼도 하늘은
 * 뚝 끊기지 않고 1초쯤에 걸쳐 물든다.
 */

/** 하늘 한 시점의 상태. 전부 이 세 값으로 표현된다. */
interface Sky {
  color: number;
  /** 어둠막 불투명도. 0이면 한낮(오버레이 자체를 숨긴다). */
  alpha: number;
  /** 코어 불빛 세기(0~1). 어스름부터 서서히 켜진다. */
  light: number;
}

/** 키프레임. 낮 → 노을 → 저녁 → 밤 순서로 물든다. */
const DAYLIGHT: Sky = { color: 0x000000, alpha: 0, light: 0 };
const SUNSET: Sky = { color: 0xc96a2e, alpha: 0.3, light: 0.25 };
const DUSK: Sky = { color: 0x33224d, alpha: 0.62, light: 0.7 };
const NIGHT: Sky = { color: 0x05081a, alpha: 0.9, light: 1 };

/**
 * 낮이 끝나기 전 전환 구간(초). 남은 시간이 SUNSET_START를 지나면 노을이 들기
 * 시작하고, 0초에 정확히 밤 색이 완성된 채 밤 페이즈로 넘어간다. 낮 길이가 아주
 * 짧은 설정에서도 최소한의 순수 낮이 남도록 낮 길이의 절반을 상한으로 둔다.
 */
const SUNSET_START = Math.min(40, wavesData.dayDuration * 0.5);
const DUSK_START = Math.min(18, wavesData.dayDuration * 0.22);

/** 밤이 끝난 뒤 아침이 밝는 데 걸리는 시간(초). 밤은 몬스터 전멸로 끝나 예고가 없다. */
const DAWN_SECONDS = 8;

/** 목표 하늘로 따라붙는 속도(1/s). 스킵 투표 같은 순간 전환을 ~1초로 눌러 준다. */
const SMOOTH_RATE = 3;

/**
 * 코어 불빛 반경(월드 px). 처음엔 건축 구역(±250)을 다 비추려고 300으로 잡았는데,
 * 줌 2에서 지름 1200px — 화면(≈590 월드px 폭)을 통째로 지워서 밤이 밤 같지 않았다.
 * "코어 주변만" 보이려면 화면의 절반쯤에서 그라디언트가 끝나야 한다.
 */
const CORE_LIGHT_RADIUS = 160;

/** 어둠막은 월드 위·HUD 아래. GameScene 안에서는 무엇보다 위면 된다. */
const OVERLAY_DEPTH = 45000;

const LIGHT_TEXTURE_KEY = 'day-night-core-light';
const LIGHT_TEXTURE_SIZE = 256;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 색·알파·불빛을 통째로 보간한다. 색은 RGB 채널별 선형 보간. */
function mixSky(a: Sky, b: Sky, t: number): Sky {
  const ca = Phaser.Display.Color.IntegerToRGB(a.color);
  const cb = Phaser.Display.Color.IntegerToRGB(b.color);
  return {
    color: Phaser.Display.Color.GetColor(
      Math.round(lerp(ca.r, cb.r, t)),
      Math.round(lerp(ca.g, cb.g, t)),
      Math.round(lerp(ca.b, cb.b, t)),
    ),
    alpha: lerp(a.alpha, b.alpha, t),
    light: lerp(a.light, b.light, t),
  };
}

export class DayNightOverlay {
  private readonly rt: Phaser.GameObjects.RenderTexture;
  private readonly lightBrush: Phaser.GameObjects.Image;
  /** 화면에 실제로 얹힌 현재 하늘. 목표를 향해 SMOOTH_RATE로 따라간다. */
  private current: Sky = { ...DAYLIGHT };
  /** 첫 낮(게임 시작)은 어둠에서 밝아지면 안 된다 — 밤을 한 번 겪은 뒤에만 새벽 연출. */
  private hasSeenNight = false;

  constructor(private readonly scene: Phaser.Scene) {
    ensureLightTexture(scene);

    this.rt = scene.add
      .renderTexture(0, 0, scene.scale.width, scene.scale.height)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(OVERLAY_DEPTH)
      .setVisible(false);

    // 지우개로 쓸 원광. 화면에 직접 그리지 않으므로 표시 목록에 넣지 않는다.
    this.lightBrush = scene.make.image({ key: LIGHT_TEXTURE_KEY, add: false });
  }

  resize(width: number, height: number): void {
    this.rt.resize(width, height);
  }

  update(status: WorldSnapshot['status'], camera: Phaser.Cameras.Scene2D.Camera, deltaMs: number): void {
    if (status.wavePhase === 'night') this.hasSeenNight = true;

    const target = this.targetSky(status);

    // 목표로 지수 감쇠 보간 — 프레임률과 무관하게 같은 속도로 붙는다.
    const t = 1 - Math.exp(-SMOOTH_RATE * (deltaMs / 1000));
    this.current = mixSky(this.current, target, t);

    if (this.current.alpha < 0.005) {
      this.rt.setVisible(false);
      return;
    }
    this.rt.setVisible(true);
    this.rt.clear();
    this.rt.fill(this.current.color, this.current.alpha);

    if (this.current.light > 0.01) {
      // 코어(월드 원점)의 화면 좌표. worldView가 줌을 이미 반영하고 있다.
      const screenX = (0 - camera.worldView.x) * camera.zoom;
      const screenY = (0 - camera.worldView.y) * camera.zoom;
      const diameter = CORE_LIGHT_RADIUS * 2 * camera.zoom;

      this.lightBrush.setAlpha(this.current.light);
      this.lightBrush.setDisplaySize(diameter, diameter);
      this.rt.erase(this.lightBrush, screenX, screenY);
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
  // 중심 60%까지는 거의 온전히 밝게 — 코어 앞 작업 공간은 또렷해야 한다.
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.6, 'rgba(255,255,255,0.9)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, LIGHT_TEXTURE_SIZE, LIGHT_TEXTURE_SIZE);
  canvas.refresh();
}
