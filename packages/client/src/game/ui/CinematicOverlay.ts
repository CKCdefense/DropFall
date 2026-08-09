import Phaser from 'phaser';
import { FONT } from './theme';

/**
 * 화면 전체를 덮는 검은 막과 큰 안내 문구. 모달(20001)보다도 위에 둔다 —
 * 연출이 도는 동안은 그 위에 아무것도 없어야 한다.
 */
const DEPTH = 30000;

/**
 * 큰 문구의 글자 크기(px). **Galmuri11의 정수배만 쓴다** — 사이 값을 쓰면 획이 뭉개져서
 * 오히려 기본 폰트보다 못 읽힌다(§theme.FONT). 132 = 11 × 12.
 */
const TITLE_SIZE = 132;

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

/**
 * 문구 색. HUD의 차분한 팔레트(§theme)보다 **한 단계 진하고 밝게** 잡는다 — 이건 정보가
 * 아니라 순간을 알리는 신호라, 배경 위에 얹혔을 때 확실히 튀어야 한다.
 */
const WARNING_COLOR = '#ff2b2b';
const DAY_COLOR = '#ffffff';
const CLEAR_COLOR = '#4bf28c';
/** 패배. 경고(WARNING)와 같은 붉은 계열이되 한 단계 가라앉혀 "끝났다"로 읽히게 한다. */
const OVER_COLOR = '#e2413f';

/**
 * 문구 불투명도. 완전 불투명이면 화면에 붙인 스티커처럼 보여서, 살짝 비쳐 아래 장면과
 * 같은 공간에 있는 느낌을 준다.
 */
const TITLE_ALPHA = 0.88;
/** 경고가 깜빡일 때 어두워지는 쪽 알파. */
const WARNING_DIM_ALPHA = 0.15;

/**
 * 패배 화면이 화면을 눌러 덮는 정도와, 그렇게 되기까지 걸리는 시간(ms).
 *
 * 완전 암전은 하지 않는다 — 코어가 무너진 자리와 몰려든 몬스터가 비쳐 보여야
 * "왜 졌는지"가 남는다. 문구는 사라지지 않고 계속 걸려 있다(끝났다는 뜻이다).
 */
const OVER_VEIL_ALPHA = 0.72;
const OVER_FADE_MS = 900;

/** 안내 줄. 큰 문구 아래에 작게 붙는다 — 이 화면에서 할 수 있는 일이 하나뿐이라 한 줄이면 된다. */
const OVER_HINT_SIZE = 22;
const OVER_HINT_GAP = 96;
const OVER_HINT_COLOR = '#cfd6e4';
/**
 * 안내가 뜨기까지의 유예(ms). 문구가 채 뜨기도 전에 "아무 키나 누르세요"가 같이
 * 나오면, 마침 누르고 있던 키 하나에 화면이 통째로 넘어가 버린다.
 *
 * **입력을 받기 시작하는 시점도 이 값이다** — 안내가 보이기 전에 눌린 키가 먹으면
 * 사용자에겐 "화면이 저절로 넘어갔다"가 된다. 그래서 HudScene이 이 상수를 같이 쓴다.
 */
export const GAME_OVER_HINT_DELAY_MS = 1200;

/**
 * 문구의 세로 위치(화면 높이 비율). 정확한 한가운데(0.5)가 아니라 **조금 위**다 —
 * 화면 아래쪽을 HUD가 차지하고 있어서, 기하학적 중앙에 두면 눈에는 아래로 처져 보인다.
 */
const TITLE_Y_RATIO = 0.43;

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
  /** 패배 화면의 안내 줄. 그때만 보인다. */
  private readonly hint: Phaser.GameObjects.Text;

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
      .text(width / 2, height * TITLE_Y_RATIO, '', {
        fontFamily: FONT,
        fontSize: `${TITLE_SIZE}px`,
        // 굵은 자족(Galmuri11-Bold, weight 700)이 이미 등록돼 있다(§ui/fonts.ts).
        // 화면을 가로지르는 큰 글자는 기본 굵기로는 획이 가늘어 배경에 묻힌다.
        fontStyle: 'bold',
        color: DAY_COLOR,
      })
      .setOrigin(0.5, 0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH + 1)
      .setAlpha(0);

    this.hint = scene.add
      .text(width / 2, height * TITLE_Y_RATIO + OVER_HINT_GAP, '', {
        fontFamily: FONT,
        fontSize: `${OVER_HINT_SIZE}px`,
        fontStyle: 'bold',
        color: OVER_HINT_COLOR,
      })
      .setOrigin(0.5, 0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH + 1)
      .setAlpha(0);
  }

  /** 화면 크기가 바뀌면 다시 부른다. */
  layout(width: number, height: number): void {
    this.veil.setSize(width, height);
    this.title.setPosition(width / 2, height * TITLE_Y_RATIO);
    this.hint.setPosition(width / 2, height * TITLE_Y_RATIO + OVER_HINT_GAP);
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
      alpha: TITLE_ALPHA,
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

    this.title.setText('WARNING').setColor(WARNING_COLOR).setAlpha(TITLE_ALPHA);
    this.stopBlink();
    this.blinkEvent = this.scene.time.addEvent({
      delay: WARNING_BLINK_MS,
      loop: true,
      callback: () =>
        this.title.setAlpha(this.title.alpha > 0.5 ? WARNING_DIM_ALPHA : TITLE_ALPHA),
    });
  }

  hideWarning(): void {
    if (this.currentCue !== 'warning') return;
    this.stopBlink();
    this.currentCue = '';
    this.scene.tweens.add({ targets: this.title, alpha: 0, duration: 250 });
  }

  /**
   * 패배. 화면을 반쯤 덮고 GAME OVER를 띄운 뒤, 잠시 뒤 안내 줄을 붙인다.
   *
   * 사라지지 않는다 — 다음 행동(아무 키나 입력)은 화면 바깥(HudScene)이 받는다.
   * 이 클래스는 무엇을 보여줄지만 알고, 그 뒤에 무슨 일이 일어나는지는 모른다.
   *
   * @param hint 안내 줄 문구. 돌아갈 곳이 싱글/멀티에 따라 달라 호출부가 정한다.
   */
  showGameOver(hint: string): void {
    if (!this.setCue('gameover')) return;

    this.stopBlink();
    this.scene.tweens.add({
      targets: this.veil,
      alpha: OVER_VEIL_ALPHA,
      duration: OVER_FADE_MS,
      ease: 'Sine.easeInOut',
    });
    this.title.setText('GAME OVER').setColor(OVER_COLOR).setAlpha(0);
    this.scene.tweens.add({
      targets: this.title,
      alpha: TITLE_ALPHA,
      duration: OVER_FADE_MS,
      ease: 'Sine.easeOut',
    });

    this.hint.setText(hint).setAlpha(0);
    this.scene.time.delayedCall(GAME_OVER_HINT_DELAY_MS, () => {
      this.scene.tweens.add({ targets: this.hint, alpha: 1, duration: 400 });
    });
  }

  /** 마지막 보스를 잡았을 때. 사라지지 않고 남는다 — 끝났다는 뜻이다. */
  showClear(): void {
    if (!this.setCue('clear')) return;

    this.stopBlink();
    this.title.setText('CLEAR').setColor(CLEAR_COLOR).setAlpha(0);
    this.scene.tweens.add({
      targets: this.title,
      alpha: TITLE_ALPHA,
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
