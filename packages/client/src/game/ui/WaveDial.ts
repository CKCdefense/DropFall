import Phaser from 'phaser';
import { wavesData } from '@dropfall/shared';
import type { WorldStatus } from '../../net/GameConnection';
import { HUD_ATLAS, HUD_BAR_SCALE } from './hudBar';
import { ACCENT, DIM_TEXT, DOWN_COLOR, FONT, PANEL_FILL, PANEL_STROKE, SIZE_BODY } from './theme';

/**
 * 상단 중앙 시계 — 낮/밤을 해와 달로, 남은 시간을 **테두리 링**으로, 며칠째인지를
 * 해·달 한가운데 숫자로 보여준다.
 *
 * 남은 시간을 숫자로 안 쓰는 이유는 예전과 같다 — 전투 중에 숫자를 읽을 여유는 없지만
 * 링이 얼마나 남았는지는 곁눈으로도 들어온다. 여기에 해/달을 얹어서 "지금 낮인가 밤인가"를
 * 글자 없이 알 수 있게 했다(그래서 '낮'/'밤' 글자는 더 이상 띄우지 않는다 — 아래 참고).
 *
 * 그림은 `assets/_generators/ui_clock.lua`가 만든다.
 */

/** 시계 몸통 원본 크기(px). ui_clock.lua의 hud_clock_face와 같아야 한다. */
const FACE_SIZE = 37;
/** 해·달 원본 크기(px). 몸통 가운데에 놓인다. */
const ORB_SIZE = 21;
/**
 * 남은 시간 링이 깔리는 홈의 반지름(원본 px). ui_clock.lua가 판 홈과 **같은 값**이다 —
 * 어긋나면 링이 홈 밖으로 삐져나가거나 홈이 빈 채로 남는다.
 */
const RING_INNER = 11;
const RING_OUTER = 14;

/**
 * 마지막 날. 숫자가 이걸 넘어가면 표시가 깨지므로 위쪽도 조인다.
 * 웨이브를 늘리면 여기도 따라 늘어나도록 데이터에서 가져온다.
 */
const TOTAL_DAYS = wavesData.waves.length;

/** 며칠째인지를 보여주는 숫자 크기(px). 본문의 2배 — 픽셀 폰트라 정수배여야 선명하다. */
const DAY_SIZE = SIZE_BODY * 2;
/** 해·달이 밝은 색이라 숫자는 어두운 잉크로 얹는다. 외곽선 없이도 대비가 확실하다. */
const DAY_INK = '#14161d';

/** 링 색 — 해/달과 짝을 맞춘다. 낮은 햇빛 금색, 밤은 달빛 푸른색. */
const DAY_RING = 0xf5c145;
const NIGHT_RING = 0x8fb4e8;

const FACE_FRAME = 'hud_clock_face_base_0';
const SUN_FRAME = 'hud_clock_sun_base_0';
const MOON_FRAME = 'hud_clock_moon_base_0';

/**
 * 홈 안쪽 픽셀을 12시부터 시계방향으로 늘어놓은 목록(원본 좌표).
 *
 * 링은 0~100%가 연속으로 변해서 그림 한 장으로 못 만든다. 그렇다고 Graphics.arc로
 * 그리면 **매끈한 호**가 나와서 주변 픽셀아트와 따로 논다. 그래서 홈을 이루는 픽셀을
 * 미리 각도순으로 정렬해 두고, 남은 비율만큼 앞에서부터 **픽셀 크기 사각형**으로 칠한다.
 * 모듈 하나당 한 번만 계산하면 되므로 상수처럼 들고 있는다.
 */
const RING_PIXELS = buildRingPixels();

function buildRingPixels(): { x: number; y: number }[] {
  const center = (FACE_SIZE - 1) / 2;
  const pixels: { x: number; y: number; angle: number }[] = [];

  for (let y = 0; y < FACE_SIZE; y += 1) {
    for (let x = 0; x < FACE_SIZE; x += 1) {
      const dx = x - center;
      const dy = y - center;
      const d2 = dx * dx + dy * dy;
      // ui_clock.lua의 disc()와 같은 판정식(r² + r)을 써야 홈과 링의 경계가 맞는다.
      if (d2 > RING_OUTER * RING_OUTER + RING_OUTER) continue;
      if (d2 <= RING_INNER * RING_INNER + RING_INNER) continue;
      // 12시가 0, 시계방향으로 증가. atan2(dx, -dy)가 정확히 그 각이다.
      let angle = Math.atan2(dx, -dy);
      if (angle < 0) angle += Math.PI * 2;
      pixels.push({ x, y, angle });
    }
  }

  pixels.sort((a, b) => a.angle - b.angle);
  return pixels.map(({ x, y }) => ({ x, y }));
}

export class WaveDial {
  /** 아틀라스가 없을 때 쓰는 예전 모양(단색 원). 있으면 face가 대신 그려진다. */
  private readonly disc: Phaser.GameObjects.Arc | null;
  private readonly face: Phaser.GameObjects.Image | null;
  private readonly ring: Phaser.GameObjects.Graphics;
  private readonly sun: Phaser.GameObjects.Image | null;
  private readonly moon: Phaser.GameObjects.Image | null;
  private readonly dayText: Phaser.GameObjects.Text;
  /** 승패가 갈렸을 때만 시계 아래에 뜨는 글자. 평소엔 해/달이 그 역할을 한다. */
  private readonly phaseText: Phaser.GameObjects.Text;

  /** 몸통 왼쪽 위 모서리(화면 좌표)와 배율. 링 픽셀을 화면에 옮길 때 쓴다. */
  private left = 0;
  private top = 0;
  private pixelSize = HUD_BAR_SCALE;

  /** 레이아웃 후 시계가 차지하는 지름(px). 아래에 무언가를 놓을 때 쓴다. */
  height = 0;

  /** 직전에 칠한 링 픽셀 수. 안 바뀌면 다시 그리지 않는다. */
  private lastCount = -1;
  private lastColor = 0;

  constructor(scene: Phaser.Scene) {
    const textured =
      scene.textures.exists(HUD_ATLAS) && scene.textures.get(HUD_ATLAS).has(FACE_FRAME);

    if (textured) {
      this.disc = null;
      this.face = scene.add.image(0, 0, HUD_ATLAS, FACE_FRAME).setOrigin(0, 0);
    } else {
      this.disc = scene.add
        .circle(0, 0, FACE_SIZE / 2, PANEL_FILL, 0.86)
        .setStrokeStyle(1, PANEL_STROKE);
      this.face = null;
    }

    // 링 → 해/달 → 숫자 순으로 만든다. 나중에 만든 쪽이 위에 그려진다.
    this.ring = scene.add.graphics();
    this.sun = textured ? scene.add.image(0, 0, HUD_ATLAS, SUN_FRAME).setOrigin(0, 0) : null;
    this.moon = textured ? scene.add.image(0, 0, HUD_ATLAS, MOON_FRAME).setOrigin(0, 0) : null;

    this.dayText = scene.add
      .text(0, 0, '', { fontFamily: FONT, fontSize: `${DAY_SIZE}px`, color: DAY_INK })
      .setOrigin(0.5, 0.5);
    this.phaseText = scene.add
      .text(0, 0, '', { fontFamily: FONT, fontSize: `${SIZE_BODY}px`, color: DIM_TEXT })
      .setOrigin(0.5, 0)
      .setVisible(false);
  }

  /** centerX 기준 가로 가운데, top이 시계의 위쪽 경계다. */
  layout(centerX: number, top: number, scale: number): void {
    // 다른 게이지와 같은 배율로 확대한다 — 시계만 곱게 나오면 한 화면에서 따로 논다.
    const pixelSize = scale * HUD_BAR_SCALE;
    this.pixelSize = pixelSize;
    this.height = FACE_SIZE * pixelSize;

    // 반 픽셀에 걸치면 픽셀아트가 흐려진다 — 왼쪽 위 모서리를 정수로 맞춘다.
    this.left = Math.round(centerX - this.height / 2);
    this.top = top;

    const centerYPx = this.top + this.height / 2;

    if (this.face) {
      this.face.setScale(pixelSize).setPosition(this.left, this.top);
    }
    this.disc?.setRadius(this.height / 2).setPosition(centerX, centerYPx);

    const orbOffset = ((FACE_SIZE - ORB_SIZE) / 2) * pixelSize;
    for (const orb of [this.sun, this.moon]) {
      orb?.setScale(pixelSize).setPosition(this.left + orbOffset, this.top + orbOffset);
    }

    this.dayText.setFontSize(DAY_SIZE * scale).setPosition(this.left + this.height / 2, centerYPx);
    this.phaseText
      .setFontSize(SIZE_BODY * scale)
      .setPosition(this.left + this.height / 2, this.top + this.height + 2 * scale);

    // 배율이 바뀌었으니 링은 무조건 다시 그린다.
    this.lastCount = -1;
  }

  update(status: WorldStatus): void {
    const ended = status.wavePhase === 'victory' || status.wavePhase === 'defeat';
    const isNight = status.wavePhase === 'night';

    // 낮은 "다음 웨이브 준비"라 +1해서 보여준다 — 낮 N과 밤 N이 같은 날로 읽힌다.
    const day = isNight ? status.currentWave : status.currentWave + 1;
    this.dayText.setText(`${Phaser.Math.Clamp(day, 1, TOTAL_DAYS)}`);

    this.sun?.setVisible(!isNight);
    this.moon?.setVisible(isNight);

    // 평소엔 해/달이 낮·밤을 말해주므로 글자를 띄우지 않는다. 승패는 그림으로 표현할
    // 방법이 없어서 이때만 시계 아래에 적는다.
    this.phaseText.setVisible(ended);
    if (ended) {
      this.phaseText.setText(status.wavePhase === 'victory' ? '방어 성공' : '코어 파괴');
      this.phaseText.setColor(status.wavePhase === 'victory' ? ACCENT : DOWN_COLOR);
    }

    this.drawRing(status, isNight, ended);
  }

  /**
   * 12시 방향에서 시계방향으로 남은 시간만큼 홈을 채운다.
   * 총 길이는 페이즈마다 다르다 — 낮은 dayDuration이 상수지만 밤은 웨이브마다 달라서,
   * 서버가 남은 시간만 내려준다. 그래서 "이번 페이즈에서 본 최대값"을 기준으로 잡는다.
   */
  private drawRing(status: WorldStatus, isNight: boolean, ended: boolean): void {
    const total = this.trackDuration(status);
    const ratio =
      ended || total <= 0 ? 0 : Phaser.Math.Clamp(status.phaseTimeRemaining / total, 0, 1);
    const count = Math.round(RING_PIXELS.length * ratio);
    const color = isNight ? NIGHT_RING : DAY_RING;

    // 매 스냅샷마다 200개 넘는 사각형을 다시 쌓을 이유가 없다 — 칠할 칸 수가
    // 그대로면 화면도 그대로다.
    if (count === this.lastCount && color === this.lastColor) return;
    this.lastCount = count;
    this.lastColor = color;

    this.ring.clear();
    if (count <= 0) return;

    const size = this.pixelSize;
    this.ring.fillStyle(color, 1);
    for (let index = 0; index < count; index += 1) {
      const pixel = RING_PIXELS[index];
      this.ring.fillRect(this.left + pixel.x * size, this.top + pixel.y * size, size, size);
    }
  }

  private lastPhase = '';
  private phaseMaxSeconds = 0;

  private trackDuration(status: WorldStatus): number {
    // 페이즈가 바뀌면 기준을 리셋한다. 안 그러면 긴 밤의 길이가 짧은 낮에 그대로 남는다.
    if (status.wavePhase !== this.lastPhase) {
      this.lastPhase = status.wavePhase;
      this.phaseMaxSeconds = 0;
    }
    this.phaseMaxSeconds = Math.max(this.phaseMaxSeconds, status.phaseTimeRemaining);
    return this.phaseMaxSeconds;
  }
}
