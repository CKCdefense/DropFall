import Phaser from 'phaser';
import type { WorldStatus } from '../../net/GameConnection';
import {
  ACCENT,
  BODY_TEXT,
  DIM_TEXT,
  DOWN_COLOR,
  FONT,
  PANEL_FILL,
  PANEL_STROKE,
  SIZE_BODY,
} from './theme';

const RADIUS = 26;
/** 웨이브 번호 크기(px). 본문의 2배 — 픽셀 폰트라 정수배여야 선명하다. */
const WAVE_SIZE = SIZE_BODY * 2;
/** 남은 시간 링의 두께(px). */
const RING_WIDTH = 3;
const NIGHT_COLOR = 0x5b8dd9;
const DAY_COLOR = 0x6fd08c;

/**
 * 상단 중앙 원형 — 웨이브 번호와 페이즈 남은 시간(와이어프레임 상단 가운데 원).
 *
 * 남은 시간은 숫자 대신 **테두리 링이 줄어드는 방식**으로 보여준다.
 * 전투 중에 숫자를 읽을 여유는 없지만, 링이 얼마나 남았는지는 곁눈으로도 들어온다.
 */
export class WaveDial {
  private readonly disc: Phaser.GameObjects.Arc;
  private readonly ring: Phaser.GameObjects.Graphics;
  private readonly waveText: Phaser.GameObjects.Text;
  private readonly phaseText: Phaser.GameObjects.Text;
  private centerX = 0;
  private centerY = 0;
  private radius = RADIUS;
  private scale = 1;

  constructor(scene: Phaser.Scene) {
    this.disc = scene.add.circle(0, 0, RADIUS, PANEL_FILL, 0.86).setStrokeStyle(1, PANEL_STROKE);
    this.ring = scene.add.graphics();
    this.waveText = scene.add
      .text(0, 0, '', { fontFamily: FONT, fontSize: `${WAVE_SIZE}px`, color: BODY_TEXT })
      .setOrigin(0.5, 0.5);
    this.phaseText = scene.add
      .text(0, 0, '', { fontFamily: FONT, fontSize: `${SIZE_BODY}px`, color: DIM_TEXT })
      .setOrigin(0.5, 0.5);
  }

  /** centerX 기준 가로 가운데, top이 원의 위쪽 경계다. */
  layout(centerX: number, top: number, scale: number): void {
    this.scale = scale;
    this.radius = RADIUS * scale;
    this.centerX = centerX;
    this.centerY = top + this.radius;

    this.disc.setRadius(this.radius).setPosition(this.centerX, this.centerY);
    this.waveText
      .setFontSize(WAVE_SIZE * scale)
      .setPosition(this.centerX, this.centerY - 7 * scale);
    this.phaseText
      .setFontSize(SIZE_BODY * scale)
      .setPosition(this.centerX, this.centerY + 11 * scale);
  }

  update(status: WorldStatus): void {
    const ended = status.wavePhase === 'victory' || status.wavePhase === 'defeat';
    const isNight = status.wavePhase === 'night';

    // 낮은 "다음 웨이브 준비"라 +1해서 보여준다(HudScene의 기존 규칙과 동일).
    this.waveText.setText(ended ? '—' : `${isNight ? status.currentWave : status.currentWave + 1}`);
    this.phaseText.setText(phaseLabel(status.wavePhase));
    this.phaseText.setColor(ended ? DOWN_COLOR : isNight ? '#8fb4e8' : ACCENT);

    this.drawRing(status, isNight, ended);
  }

  /**
   * 12시 방향에서 시계방향으로 남은 시간만큼 호를 그린다.
   * 총 길이는 페이즈마다 다르다 — 낮은 dayDuration이 상수지만 밤은 웨이브마다 달라서,
   * 서버가 남은 시간만 내려준다. 그래서 "이번 페이즈에서 본 최대값"을 기준으로 잡는다.
   */
  private drawRing(status: WorldStatus, isNight: boolean, ended: boolean): void {
    this.ring.clear();
    if (ended) return;

    const total = this.trackDuration(status);
    if (total <= 0) return;

    const ratio = Phaser.Math.Clamp(status.phaseTimeRemaining / total, 0, 1);
    if (ratio <= 0) return;

    const start = -Math.PI / 2;
    this.ring.lineStyle(RING_WIDTH * this.scale, isNight ? NIGHT_COLOR : DAY_COLOR, 1);
    this.ring.beginPath();
    this.ring.arc(
      this.centerX,
      this.centerY,
      this.radius - RING_WIDTH * this.scale,
      start,
      start + Math.PI * 2 * ratio,
    );
    this.ring.strokePath();
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

function phaseLabel(phase: string): string {
  switch (phase) {
    case 'victory':
      return '방어 성공';
    case 'defeat':
      return '코어 파괴';
    case 'night':
      return '밤';
    default:
      return '낮';
  }
}
