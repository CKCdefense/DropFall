import Phaser from 'phaser';
import { companionData } from '@dropfall/shared';
import type { GameConnection } from '../../net/GameConnection';
import { INPUT_CONTROLLER_KEY } from '../createGame';
import type { InputController } from '../input/InputController';

/**
 * 플레이어 채팅. Enter로 입력을 열고, Enter로 보내고, Esc로 취소한다.
 *
 * DevConsole과 같은 이유로 **DOM 오버레이**다 — 한글 조합/캐럿 같은 텍스트 입력을
 * Phaser로 다시 만들 이유가 없다. 로그 패널은 입력 중이 아니어도 항상 떠 있어서
 * 놓친 대화를 다시 볼 수 있다(말풍선은 몇 초면 사라지므로).
 *
 * 발신은 서버가 검증한 뒤 자기 자신에게도 broadcast로 되돌아온 걸 표시한다 —
 * 여기서 먼저 찍지 않는다(로컬 에코와 서버 반영이 어긋날 일이 없다).
 *
 * `@` 입력 후 Tab을 누르면 "@티모시 "로 자동완성된다(§completeMention) — 티모시가
 * 지금은 유일한 멘션 대상이라 후보를 고를 필요 없이 즉시 완성해도 된다. 매번 이름
 * 전체를 타이핑하는 게 귀찮다는 피드백으로 추가했다.
 */

const MAX_LOG_LINES = 8;

const STYLE = `
.df-chat {
  position: fixed; left: 10px; bottom: 96px; width: 300px; z-index: 20000;
  font-family: 'Galmuri11', ui-monospace, monospace; font-size: 11px; line-height: 1.5;
  display: flex; flex-direction: column; gap: 2px;
}
.df-chat__log {
  display: flex; flex-direction: column; gap: 2px;
  pointer-events: none;
}
.df-chat__line {
  align-self: flex-start; max-width: 100%;
  background: rgba(12, 14, 19, 0.55); color: #f2f5fa;
  padding: 2px 6px; border-radius: 3px; word-break: break-all;
}
.df-chat__nickname { color: #6fd08c; margin-right: 4px; }
.df-chat__line--companion .df-chat__nickname { color: #f2c14e; }
.df-chat__row {
  display: none; align-items: center; gap: 6px;
  background: rgba(12, 14, 19, 0.85); border-radius: 3px; padding: 4px 6px;
}
.df-chat__row[data-open='1'] { display: flex; }
.df-chat__prompt { color: #6fd08c; }
.df-chat__input { flex: 1; background: transparent; border: 0; outline: 0; color: #f2f5fa; font: inherit; }
.df-chat__hint { color: #79828f; font-size: 10px; white-space: nowrap; }
`;

export class ChatBox {
  private readonly root: HTMLDivElement;
  private readonly log: HTMLDivElement;
  private readonly row: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private open = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly connection: GameConnection,
  ) {
    if (!document.getElementById('df-chat-style')) {
      const style = document.createElement('style');
      style.id = 'df-chat-style';
      style.textContent = STYLE;
      document.head.appendChild(style);
    }

    this.root = document.createElement('div');
    this.root.className = 'df-chat';
    this.root.innerHTML = `
      <div class="df-chat__log"></div>
      <div class="df-chat__row">
        <span class="df-chat__prompt">&gt;</span>
        <input class="df-chat__input" spellcheck="false" autocomplete="off" maxlength="200" />
        <span class="df-chat__hint">@+Tab: ${companionData.name}</span>
      </div>`;
    document.body.appendChild(this.root);

    this.log = this.root.querySelector('.df-chat__log') as HTMLDivElement;
    this.row = this.root.querySelector('.df-chat__row') as HTMLDivElement;
    this.input = this.root.querySelector('.df-chat__input') as HTMLInputElement;

    this.input.addEventListener('keydown', (event) => this.onInputKey(event));
    // Enter로 열 때 같은 keydown이 window까지 버블돼 곧바로 다시 닫히는 걸 막는다.
    this.input.addEventListener('keydown', (event) => event.stopPropagation());

    window.addEventListener('keydown', this.onGlobalKey);
    // 씬이 정상적으로 stop/restart될 땐 SHUTDOWN이 온다. 그런데 "나가기"(main.ts의
    // leaveRoom)는 씬을 stop하는 게 아니라 **Phaser.Game 자체를 destroy(true)** 하는데,
    // 이 경로는 SHUTDOWN을 안 거치고 곧장 내부 오브젝트를 정리한다 — SHUTDOWN에만
    // 걸어두면 DOM 오버레이(this.root)가 안 지워져 로비 화면 위에 그대로 겹쳐 남았다.
    // 그래서 게임 레벨 DESTROY(createGame.ts가 리사이즈 리스너 정리에 쓰는 것과 같은
    // 이벤트)에도 같이 걸어 둔다. destroy()는 두 번 불려도 안전하다(멱등).
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
    this.scene.game.events.once(Phaser.Core.Events.DESTROY, () => this.destroy());
  }

  isOpen(): boolean {
    return this.open;
  }

  /**
   * 서버(또는 로컬 폴백)에서 온 채팅 한 줄을 로그에 추가한다. 티모시 대사도 같은 로그를
   * 쓴다(GameScene의 onCompanionCommentary가 여기로도 넘겨준다) — variant로 이름 색만 구분한다.
   */
  appendLine(nickname: string, text: string, variant: 'player' | 'companion' = 'player'): void {
    const line = document.createElement('div');
    line.className = variant === 'companion' ? 'df-chat__line df-chat__line--companion' : 'df-chat__line';
    const name = document.createElement('span');
    name.className = 'df-chat__nickname';
    name.textContent = nickname;
    line.appendChild(name);
    line.appendChild(document.createTextNode(text));
    this.log.appendChild(line);

    while (this.log.childElementCount > MAX_LOG_LINES) this.log.firstElementChild?.remove();
  }

  private readonly onGlobalKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter') return;
    // 다른 입력창(개발자 콘솔 등)에 포커스가 있으면 그쪽 몫이다.
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (this.open) return;

    event.preventDefault();
    this.toggle(true);
  };

  private onInputKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.toggle(false);
      return;
    }

    if (event.key === 'Tab') {
      // 브라우저 기본 동작(다음 요소로 포커스 이동)을 막아야 입력창에 계속 남는다.
      event.preventDefault();
      this.completeMention();
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const text = this.input.value.trim();
      this.input.value = '';
      this.toggle(false);
      if (text) this.connection.sendChat(text);
    }
  }

  /**
   * `@`(뒤에 이름을 몇 글자 쳤어도 상관없음)로 시작한 상태에서 Tab을 누르면 그 첫
   * 단어를 "@티모시"로 완성한다. 멘션 대상이 티모시 하나뿐이라 후보를 고를 필요가
   * 없다 — 그냥 바로 완성해서 커서를 뒤에 두고 나머지 문장을 이어 치게 한다.
   */
  private completeMention(): void {
    const mention = `@${companionData.name}`;
    const value = this.input.value;
    if (value.length > 0 && !value.startsWith('@')) return; // '@' 없이 Tab이면 아무 일도 안 한다

    const spaceIndex = value.indexOf(' ');
    const rest = spaceIndex === -1 ? '' : value.slice(spaceIndex + 1);
    this.input.value = rest ? `${mention} ${rest}` : `${mention} `;
    const caret = this.input.value.length;
    this.input.setSelectionRange(caret, caret);
  }

  private toggle(open: boolean): void {
    this.open = open;
    this.row.dataset.open = this.open ? '1' : '0';

    // 열려 있는 동안 Phaser 키보드를 게임 전역에서 끈다 — DevConsole과 같은 이유
    // (WASD/E 등이 이 씬이 아니라 GameScene 키보드에 붙어 있다).
    if (this.scene.game.input.keyboard) this.scene.game.input.keyboard.enabled = !this.open;

    if (this.open) {
      this.input.focus();
      // 이동 중에 Enter를 눌러도 그 자리에서 바로 멈추게 한다(§InputController.haltMovement).
      (this.scene.registry.get(INPUT_CONTROLLER_KEY) as InputController | undefined)?.haltMovement();
    } else {
      this.input.blur();
    }
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onGlobalKey);
    this.root.remove();
    if (this.scene.game.input.keyboard) this.scene.game.input.keyboard.enabled = true;
  }
}
