import Phaser from 'phaser';
import type { PlayerView } from '../../net/GameConnection';
import { FONT, SIZE_BODY, applyTextShadow } from './theme';

/**
 * 쓰러졌을 때 하단 바 바로 위에 뜨는 안내.
 *
 * **내 캐릭터가 화면에서 사라진 것처럼 보이는 순간**에 뜬다 — 조작이 안 먹고 몸은
 * 바닥에 누워 있으니, 무슨 일이 일어났고 어떻게 돌아오는지를 글로 말해 줘야 한다.
 * 하단 바 위에 두는 이유는 그 자리가 이미 "내 몸 상태"를 보는 자리라서다.
 *
 * 두 줄이다. 큰 글자는 **지금 무슨 상태인가**(HELP! / 유령), 작은 글자는 **어떻게
 * 돌아오는가**(남은 시간, 또는 방법)다.
 */

/** 큰 글자 크기. 픽셀 폰트는 설계 크기(11px)의 정수배에서만 선명하다. */
const HEAD_SIZE = SIZE_BODY * 3;
const SUB_SIZE = SIZE_BODY;

/** 하단 바 위로 띄우는 간격(px, uiScale 적용 전). */
const BOTTOM_GAP = 12;
/** 두 줄 사이 간격. */
const LINE_GAP = 6;

/**
 * 도움 요청 색. HUD의 어떤 값보다도 붉다 — 이건 정보가 아니라 "지금 나를 봐 달라"는
 * 신호라, 옆의 체력 막대와 같은 톤이면 읽히지 않는다.
 */
const HELP_COLOR = '#ff3b30';
/** 유령은 붉지 않다. 급한 일이 이미 지나갔고, 남은 건 낮에 코어에서 하는 절차다. */
const GHOST_COLOR = '#9fb4ff';
const SUB_COLOR = '#e3e8f2';

/** 도움 요청이 한 번 깜빡이는 주기(ms). */
const BLINK_MS = 420;
const BLINK_DIM_ALPHA = 0.35;

/** 구조 진행 막대의 크기(px, uiScale 적용 전). */
const GAUGE_WIDTH = 132;
const GAUGE_HEIGHT = 6;
const GAUGE_FILL = 0x4bf28c;
const GAUGE_TRACK = 0x232833;

export class ReviveBanner {
  private readonly head: Phaser.GameObjects.Text;
  private readonly sub: Phaser.GameObjects.Text;
  private readonly gaugeTrack: Phaser.GameObjects.Rectangle;
  private readonly gaugeFill: Phaser.GameObjects.Rectangle;

  /** 마지막 레이아웃 값. update()가 게이지 폭을 다시 잡을 때 쓴다. */
  private centerX = 0;
  private bottom = 0;
  private uiScale = 1;

  private blink?: Phaser.Time.TimerEvent;

  constructor(
    private readonly scene: Phaser.Scene,
    depth: number,
  ) {
    this.head = scene.add
      .text(0, 0, '', { fontFamily: FONT, fontSize: `${HEAD_SIZE}px`, fontStyle: 'bold' })
      .setOrigin(0.5, 1)
      .setScrollFactor(0)
      .setDepth(depth)
      .setVisible(false);
    this.sub = scene.add
      .text(0, 0, '', { fontFamily: FONT, fontSize: `${SUB_SIZE}px`, color: SUB_COLOR })
      .setOrigin(0.5, 1)
      .setScrollFactor(0)
      .setDepth(depth)
      .setVisible(false);
    applyTextShadow(this.head);
    applyTextShadow(this.sub);

    this.gaugeTrack = scene.add
      .rectangle(0, 0, GAUGE_WIDTH, GAUGE_HEIGHT, GAUGE_TRACK)
      .setOrigin(0.5, 1)
      .setScrollFactor(0)
      .setDepth(depth)
      .setVisible(false);
    this.gaugeFill = scene.add
      .rectangle(0, 0, GAUGE_WIDTH, GAUGE_HEIGHT, GAUGE_FILL)
      // 왼쪽에서 오른쪽으로 차야 하므로 원점을 왼쪽 아래에 둔다.
      .setOrigin(0, 1)
      .setScrollFactor(0)
      .setDepth(depth)
      .setVisible(false);
  }

  /** @param bottom 하단 바(체력·스태미나)의 윗변 y. 안내는 그 위에 쌓인다. */
  layout(centerX: number, bottom: number, scale: number): void {
    this.centerX = centerX;
    this.bottom = bottom;
    this.uiScale = scale;
    this.place();
  }

  /**
   * @param me 내 캐릭터(없으면 감춘다).
   * @param solo 혼자하기인가. 안내 문구가 갈린다.
   */
  update(me: PlayerView | undefined, solo: boolean): void {
    if (!me || me.lifeState === 'alive') {
      this.hide();
      return;
    }

    if (me.lifeState === 'ghost') {
      this.stopBlink();
      this.head.setText('유령').setColor(GHOST_COLOR).setAlpha(1).setVisible(true);
      this.sub.setText('낮에 코어에서 부활할 수 있다').setVisible(true);
      this.setGauge(0);
      this.place();
      return;
    }

    this.head.setText('HELP!').setColor(HELP_COLOR).setVisible(true);
    this.startBlink();
    /*
     * 남은 시간이 뜻하는 바가 혼자하기와 멀티에서 정반대다 — 혼자면 **돌아오기까지**고,
     * 여럿이면 **손쓸 수 있는 시간이 끝나기까지**다. 숫자만 보여주고 말면 유령이 되는
     * 카운트다운을 부활 카운트다운으로 읽는다.
     */
    const seconds = Math.max(0, Math.ceil(me.downRemaining));
    this.sub
      .setText(solo ? `${seconds}초 뒤 코어에서 부활` : `유령까지 ${seconds}초 — 동료가 [E]로 일으킬 수 있다`)
      .setVisible(true);
    this.setGauge(me.reviveProgress);
    this.place();
  }

  private setGauge(progress: number): void {
    const visible = progress > 0;
    this.gaugeTrack.setVisible(visible);
    this.gaugeFill.setVisible(visible);
    if (!visible) return;
    this.gaugeFill.width = GAUGE_WIDTH * this.uiScale * Math.min(1, Math.max(0, progress));
  }

  /** 위에서부터 [HELP!] → [설명] → [구조 게이지] 순으로 하단 바 위에 쌓는다. */
  private place(): void {
    const gap = LINE_GAP * this.uiScale;
    let y = this.bottom - BOTTOM_GAP * this.uiScale;

    if (this.gaugeTrack.visible) {
      this.gaugeTrack
        .setSize(GAUGE_WIDTH * this.uiScale, GAUGE_HEIGHT * this.uiScale)
        .setPosition(this.centerX, y);
      this.gaugeFill.height = GAUGE_HEIGHT * this.uiScale;
      this.gaugeFill.setPosition(this.centerX - (GAUGE_WIDTH * this.uiScale) / 2, y);
      y -= GAUGE_HEIGHT * this.uiScale + gap;
    }

    this.sub.setFontSize(SUB_SIZE * this.uiScale).setPosition(this.centerX, y);
    y -= this.sub.height + gap;
    this.head.setFontSize(HEAD_SIZE * this.uiScale).setPosition(this.centerX, y);
  }

  private startBlink(): void {
    if (this.blink) return;
    this.blink = this.scene.time.addEvent({
      delay: BLINK_MS,
      loop: true,
      callback: () => this.head.setAlpha(this.head.alpha > 0.5 ? BLINK_DIM_ALPHA : 1),
    });
  }

  private stopBlink(): void {
    this.blink?.remove();
    this.blink = undefined;
    this.head.setAlpha(1);
  }

  private hide(): void {
    this.stopBlink();
    this.head.setVisible(false);
    this.sub.setVisible(false);
    this.gaugeTrack.setVisible(false);
    this.gaugeFill.setVisible(false);
  }
}
