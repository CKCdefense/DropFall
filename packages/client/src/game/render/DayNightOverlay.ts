import Phaser from 'phaser';
import { wavesData } from '@dropfall/shared';
import type { WorldSnapshot } from '../../net/GameConnection';

/**
 * 낮–밤 하늘 연출.
 *
 * **월드 공간의 곱셈(MULTIPLY) RenderTexture + 수정구 위치의 광원 구멍** 방식이다.
 *
 * - 곱셈 블렌드가 핵심이다. 반투명 검정 덮개는 모든 대비를 덮개 색으로 눌러 화면을
 *   뿌옇게 만들지만, 곱셈은 원본 색에 하늘 색을 곱해 픽셀 경계·대비가 그대로 남은 채
 *   밝기만 내려간다 — 어두워져도 선명하다. erase로 지운 곳은 투명 = 곱셈 항등이라
 *   광원 안은 원래 밝기 그대로다.
 * - 마스크(BitmapMask)를 쓰지 않는 이유: 곱셈 블렌드와 조합하면 이 렌더러에서
 *   마스크가 균일하게 새어 나와 광원이 사라졌다(실측).
 *
 * 광원의 중심은 수정구가 아니라 **월드 원점(=건축 구역 중심)**이다. 원이 정사각형에
 * 내접하려면 중심이 같아야 하고, 코어 앵커를 받침대 중심으로 옮긴 뒤로는 원점이 곧
 * 코어의 시각적 중심이라 수정구와도 몇 십 px밖에 안 떨어져 있다.
 *
 * **어둠막은 화면이 아니라 월드에 붙어 있다.** 화면 고정(scrollFactor 0) 막에 코어의
 * "화면 좌표"를 계산해 구멍을 지우는 방식은 그 좌표가 카메라 상태에 의존한다 —
 * update() 시점의 worldView는 카메라가 렌더 단계에서 확정되기 **한 프레임 전** 값이라,
 * 걷는 동안 광원이 코어에서 미끄러졌다. 막 자체를 월드 좌표(카메라 시야 + 여유분)에
 * 놓고 구멍도 월드 좌표로 지우면, 막의 위치와 구멍 좌표가 같은 기준을 쓰므로 카메라가
 * 언제 어떻게 움직여도 구멍은 **정의상** 수정구 위에 있다. 막의 위치가 한 프레임 늦는
 * 것은 시야보다 큰 여유분(PAD)이 가려 준다.
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
 * 광원 반경은 상수가 아니라 **건축 가능 구역의 한 변의 절반**(coreBuildRadius)이다 —
 * 정사각형 구역에 원이 딱 내접해서 "코어의 힘이 미치는 범위"가 빛으로 표시되고,
 * 티어를 올리면 구역과 함께 빛도 넓어진다. 스냅샷이 아직 안 온 첫 프레임을 위한
 * 하한만 둔다.
 */
const MIN_LIGHT_RADIUS = 80;

/** 어둠막은 월드 위·HUD 아래. GameScene 안에서는 무엇보다 위면 된다. */
const OVERLAY_DEPTH = 45000;

/**
 * 막이 카메라 시야보다 사방으로 이만큼(월드 px) 크다. 막의 위치 갱신이 한 프레임
 * 늦으므로, 프레임당 카메라 이동량(수 px)보다 넉넉해야 화면 가장자리에 밝은 틈이
 * 새지 않는다.
 */
const VIEW_PAD = 48;

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
  private veil: Phaser.GameObjects.RenderTexture;
  private readonly lightBrush: Phaser.GameObjects.Image;
  /** 화면에 실제로 얹힌 현재 하늘. 목표를 향해 SMOOTH_RATE로 따라간다. */
  private current: Sky = { ...DAYLIGHT };
  /** 첫 낮(게임 시작)은 어둠에서 밝아지면 안 된다 — 밤을 한 번 겪은 뒤에만 새벽 연출. */
  private hasSeenNight = false;

  constructor(private readonly scene: Phaser.Scene) {
    ensureLightTexture(scene);

    // 크기는 첫 update에서 카메라 시야에 맞춰 다시 만든다(줌이 아직 정해지기 전일 수 있다).
    this.veil = this.createVeil(4, 4);

    // 지우개로 쓸 원광. 화면에 직접 그리지 않으므로 표시 목록에 넣지 않는다.
    this.lightBrush = scene.make.image({ key: LIGHT_TEXTURE_KEY, add: false });
  }

  private createVeil(width: number, height: number): Phaser.GameObjects.RenderTexture {
    return this.scene.add
      .renderTexture(0, 0, width, height)
      .setOrigin(0, 0)
      .setDepth(OVERLAY_DEPTH)
      .setBlendMode(Phaser.BlendModes.MULTIPLY)
      .setVisible(false);
  }

  /** 창 크기·줌 변화는 update가 시야 크기로 감지한다 — 여기서 할 일이 없다. */
  resize(): void {}

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

    // 막의 텍스처는 **월드 px 단위**다(카메라가 알아서 줌한다). 시야 + 여유분 크기.
    // resize()가 아니라 **재생성**한다 — 리사이즈된 RenderTexture는 이후 erase가
    // 조용히 무시되는 문제가 있었다(구멍이 안 뚫린 채 어둠만 남음). 크기 변화는
    // 창 크기·줌이 바뀔 때뿐이라 재생성 비용은 문제되지 않는다.
    const width = Math.ceil(camera.displayWidth) + VIEW_PAD * 2;
    const height = Math.ceil(camera.displayHeight) + VIEW_PAD * 2;
    if (this.veil.width !== width || this.veil.height !== height) {
      this.veil.destroy();
      this.veil = this.createVeil(width, height);
    }

    this.veil.setVisible(true);
    this.veil.setPosition(camera.worldView.x - VIEW_PAD, camera.worldView.y - VIEW_PAD);
    this.veil.clear();
    this.veil.fill(this.current.tint, 1);

    if (this.current.light > 0.01) {
      // 구멍도 막과 같은 월드 기준이라, 카메라 상태와 무관하게 항상 수정구 위다.
      const radius = Math.max(MIN_LIGHT_RADIUS, status.coreBuildRadius);
      this.lightBrush.setAlpha(this.current.light);
      this.lightBrush.setDisplaySize(radius * 2, radius * 2);
      this.veil.erase(this.lightBrush, 0 - this.veil.x, 0 - this.veil.y);
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
  // 중심 1/3은 온전히 밝고, 나머지 2/3에 걸쳐 길게 사그라진다 — 감쇠 구간이 좁으면
  // 빛 가장자리가 스포트라이트처럼 뚝 끊긴다.
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.95)');
  gradient.addColorStop(0.7, 'rgba(255,255,255,0.45)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, LIGHT_TEXTURE_SIZE, LIGHT_TEXTURE_SIZE);
  canvas.refresh();
}
