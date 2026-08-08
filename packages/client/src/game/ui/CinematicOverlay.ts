import Phaser from 'phaser';
import { FONT } from './theme';

/**
 * 화면 전체를 덮는 검은 막과 큰 안내 문구. 모달(20001)보다도 위에 둔다 —
 * 연출이 도는 동안은 그 위에 아무것도 없어야 한다.
 */
const DEPTH = 30000;

/**
 * 큰 문구의 글자 크기(px). **Galmuri11의 정수배만 쓴다** — 사이 값을 쓰면 획이 뭉개져서
 * 오히려 기본 폰트보다 못 읽힌다(§theme.FONT). 99 = 11 × 9.
 */
const TITLE_SIZE = 99;

/**
 * 시작 암전: 완전히 검은 상태에서 얼마나 머물고, 얼마에 걸쳐 밝아지는지(ms).
 *
 * 예전엔 맵을 한 번 보여준 뒤 덮었다가 열었는데, 들어서자마자 화면이 어두워지는 게
 * "무슨 일이 생겼나"로 읽혔다. 처음부터 검은 데서 열리는 편이 시작으로 더 자연스럽다.
 */
const OPEN_HOLD_MS = 500;
const OPEN_FADE_IN_MS = 1800;

/** "DAY N": 떠오르고 · 머물고 · 사라지는 시간(ms). */
const DAY_IN_MS = 700;
const DAY_HOLD_MS = 1100;
const DAY_OUT_MS = 700;

/** 경고 문구가 한 번 깜빡이는 주기(ms). */
const WARNING_BLINK_MS = 320;

const WARNING_COLOR = '#ff4a4a';
const DAY_COLOR = '#f2f6ff';
const CLEAR_COLOR = '#6fd08c';

/**
 * 게임 진행에 얹히는 화면 연출 — 시작 암전, 아침의 "DAY N", 보스 예고, 클리어.
 *
 * **상태를 스스로 기억하지 않는다.** 무엇을 띄울지는 스냅샷(페이즈·웨이브·예고 시간)이
 * 정하고, 이 클래스는 "그 장면으로 바꿔라"는 요청만 받는다. HUD가 매 프레임 같은 값을
 * 넘겨도 이미 그 장면이면 아무 일도 하지 않는다 — 안 그러면 연출이 매 프레임 처음부터
 * 다시 시작해 영원히 첫 프레임에 머문다(걷기 애니메이션에서 겪은 것과 같은 함정).
 *
 * 글자는 픽셀 폰트를 키워 쓴다. 별도 아트를 만들지 않은 이유는, "DAY 1"·"WARNING"처럼
 * 짧은 라틴 문자열은 Galmuri를 정수배로 키우면 그 자체로 픽셀아트이고, 문구가 바뀔 때마다
 * 이미지를 다시 만들 필요가 없어서다.
 */
export class CinematicOverlay {
  private readonly veil: Phaser.GameObjects.Rectangle;
  private readonly title: Phaser.GameObjects.Text;

  /** 지금 띄워 둔 문구의 식별자. 같은 값이 다시 오면 무시한다. */
  private currentCue = '';
  private blinkEvent?: Phaser.Time.TimerEvent;

  constructor(private readonly scene: Phaser.Scene) {
    const { width, height } = scene.scale;

    /*
     * 채움 알파는 **1로 두고 오브젝트 알파로 여닫는다.** 생성 인자의 알파(5번째)를 0으로
     * 두면 도형 자체가 안 그려져서, 트윈으로 오브젝트 알파를 아무리 올려도 화면에
     * 아무 일도 일어나지 않는다(실제로 그렇게 만들었다가 암전이 통째로 안 보였다).
     */
    /*
     * **처음부터 덮여 있다.** 나중에 켜면 그 사이 한두 프레임 동안 맵이 번쩍 보인다 —
     * 씬이 만들어지는 순간부터 가려져 있어야 "검은 데서 열린다"가 된다.
     */
    this.veil = scene.add
      .rectangle(0, 0, width, height, 0x000000, 1)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH)
      .setAlpha(1);

    this.title = scene.add
      .text(width / 2, height / 2, '', {
        fontFamily: FONT,
        fontSize: `${TITLE_SIZE}px`,
        color: DAY_COLOR,
      })
      .setOrigin(0.5, 0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH + 1)
      .setAlpha(0);
  }

  /** 화면 크기가 바뀌면 다시 부른다. */
  layout(width: number, height: number): void {
    this.veil.setSize(width, height);
    this.title.setPosition(width / 2, height / 2);
  }

  /** 시작 암전 — 완전히 검은 상태에서 잠깐 머물다가 천천히 밝아진다. */
  playIntro(): void {
    this.veil.setAlpha(1);
    this.scene.time.delayedCall(OPEN_HOLD_MS, () => {
      this.scene.tweens.add({
        targets: this.veil,
        alpha: 0,
        duration: OPEN_FADE_IN_MS,
        ease: 'Sine.easeInOut',
      });
    });
  }

  /**
   * 아침 알림. 떠올랐다가 잠시 머물고 사라진다.
   * @param day 1-based 일차.
   */
  showDay(day: number): void {
    if (!this.setCue(`day:${day}`)) return;

    this.stopBlink();
    this.title.setText(`DAY ${day}`).setColor(DAY_COLOR).setAlpha(0);
    this.scene.tweens.add({
      targets: this.title,
      alpha: 1,
      duration: DAY_IN_MS,
      ease: 'Sine.easeOut',
      onComplete: () => {
        this.scene.time.delayedCall(DAY_HOLD_MS, () => {
          this.scene.tweens.add({
            targets: this.title,
            alpha: 0,
            duration: DAY_OUT_MS,
            ease: 'Sine.easeIn',
            onComplete: () => this.clearCue(`day:${day}`),
          });
        });
      },
    });
  }

  /**
   * 보스 예고. 예고 시간이 끝날 때까지 붉게 깜빡인다.
   *
   * 서버가 내려주는 남은 시간이 0이 되면 HUD가 `hideWarning()`을 부른다 — 여기서
   * 시간을 따로 세지 않는 이유는, 보스가 실제로 나오는 시점은 서버가 정하기 때문이다.
   */
  showWarning(): void {
    if (!this.setCue('warning')) return;

    this.title.setText('WARNING').setColor(WARNING_COLOR).setAlpha(1);
    this.stopBlink();
    this.blinkEvent = this.scene.time.addEvent({
      delay: WARNING_BLINK_MS,
      loop: true,
      callback: () => this.title.setAlpha(this.title.alpha > 0.5 ? 0.15 : 1),
    });
  }

  hideWarning(): void {
    if (this.currentCue !== 'warning') return;
    this.stopBlink();
    this.currentCue = '';
    this.scene.tweens.add({ targets: this.title, alpha: 0, duration: 250 });
  }

  /** 마지막 보스를 잡았을 때. 사라지지 않고 남는다 — 끝났다는 뜻이다. */
  showClear(): void {
    if (!this.setCue('clear')) return;

    this.stopBlink();
    this.title.setText('CLEAR').setColor(CLEAR_COLOR).setAlpha(0);
    this.scene.tweens.add({
      targets: this.title,
      alpha: 1,
      duration: DAY_IN_MS,
      ease: 'Sine.easeOut',
    });
  }

  /** @returns 새 장면이면 true. 이미 같은 장면이면 false(아무것도 하지 않는다). */
  private setCue(cue: string): boolean {
    if (this.currentCue === cue) return false;
    this.currentCue = cue;
    return true;
  }

  /** 그 장면이 아직 걸려 있을 때만 비운다 — 늦게 끝난 트윈이 다음 장면을 지우면 안 된다. */
  private clearCue(cue: string): void {
    if (this.currentCue === cue) this.currentCue = '';
  }

  private stopBlink(): void {
    this.blinkEvent?.remove();
    this.blinkEvent = undefined;
  }
}
