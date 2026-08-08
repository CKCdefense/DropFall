import Phaser from 'phaser';
import { DEV_COMMAND_NAMES } from '@dropfall/shared';
import type { GameConnection } from '../../net/GameConnection';

/**
 * 개발자 콘솔. 백틱(`)으로 열고 닫는다.
 *
 * **Phaser 오브젝트가 아니라 DOM 오버레이다.** 텍스트 입력(캐럿·한글 조합·복사
 * 붙여넣기·히스토리)을 Phaser에서 다시 만들 이유가 없다 — `<input>` 하나면 브라우저가
 * 전부 해준다. 대신 열려 있는 동안 Phaser 키보드를 꺼서 명령을 타이핑하다 캐릭터가
 * 걸어다니는 일을 막는다.
 *
 * 명령 해석은 여기서 하지 않는다 — 문자열을 그대로 connection에 넘기고 결과만 찍는다.
 * 규칙이 shared에 있어야 로컬 모드와 멀티플레이가 같은 결과를 낸다.
 */

const MAX_LOG_LINES = 200;
/** 위/아래 화살표로 되돌려 볼 명령 개수. */
const MAX_HISTORY = 50;

const STYLE = `
.df-devconsole {
  position: fixed; left: 0; right: 0; top: 0; z-index: 40000;
  display: none; flex-direction: column;
  font-family: 'Galmuri11', ui-monospace, monospace; font-size: 11px; line-height: 1.55;
  color: #cfd6e4; background: rgba(12, 14, 19, 0.94);
  border-bottom: 1px solid #4a5262;
}
.df-devconsole[data-open='1'] { display: flex; }
.df-devconsole__log {
  max-height: 42vh; overflow-y: auto; padding: 8px 10px;
  white-space: pre-wrap; word-break: break-all;
}
.df-devconsole__line--err { color: #d9756b; }
.df-devconsole__line--echo { color: #79828f; }
.df-devconsole__row { display: flex; align-items: center; gap: 6px; padding: 6px 10px; border-top: 1px solid #2b303c; }
.df-devconsole__prompt { color: #6fd08c; }
.df-devconsole__input {
  flex: 1; background: transparent; border: 0; outline: 0;
  color: #f2f5fa; font: inherit;
}
.df-devconsole__hint { color: #79828f; font-size: 11px; }
`;

export class DevConsole {
  private readonly root: HTMLDivElement;
  private readonly log: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly history: string[] = [];
  private historyCursor = 0;
  private open = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly connection: GameConnection,
  ) {
    if (!document.getElementById('df-devconsole-style')) {
      const style = document.createElement('style');
      style.id = 'df-devconsole-style';
      style.textContent = STYLE;
      document.head.appendChild(style);
    }

    this.root = document.createElement('div');
    this.root.className = 'df-devconsole';
    this.root.innerHTML = `
      <div class="df-devconsole__log"></div>
      <div class="df-devconsole__row">
        <span class="df-devconsole__prompt">&gt;</span>
        <input class="df-devconsole__input" spellcheck="false" autocomplete="off" />
        <span class="df-devconsole__hint">Tab 자동완성 · ↑↓ 기록 · \` 닫기</span>
      </div>`;
    document.body.appendChild(this.root);

    this.log = this.root.querySelector('.df-devconsole__log') as HTMLDivElement;
    this.input = this.root.querySelector('.df-devconsole__input') as HTMLInputElement;

    this.connection.onDevResult((result) => {
      this.print(result.message, result.ok ? 'out' : 'err');
    });

    this.input.addEventListener('keydown', (event) => this.onInputKey(event));

    // 백틱은 입력창 안에서도 콘솔을 닫는 데 써야 해서(문자로 들어가면 안 된다)
    // keydown 단계에서 가로챈다.
    window.addEventListener('keydown', this.onGlobalKey);
    // ChatBox와 같은 이유(§ChatBox 생성자 주석 참고) — "나가기"는 씬을 stop하는 게
    // 아니라 Phaser.Game을 통째로 destroy(true)해서 SHUTDOWN을 안 거친다. 게임 레벨
    // DESTROY에도 같이 걸어 둬야 DOM 오버레이가 확실히 지워진다.
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
    this.scene.game.events.once(Phaser.Core.Events.DESTROY, () => this.destroy());

    this.print('개발자 콘솔. `help`로 명령 목록을 본다.', 'echo');
  }

  isOpen(): boolean {
    return this.open;
  }

  toggle(): void {
    this.open = !this.open;
    this.root.dataset.open = this.open ? '1' : '0';

    // 열려 있는 동안 Phaser 키보드를 **게임 전역**에서 끈다. 씬 하나만 끄면 안 된다 —
    // 이 콘솔은 HudScene 소속이지만 E(코어 모달)·WASD·퀵슬롯은 GameScene 키보드에
    // 붙어 있어서, HUD만 꺼서는 'e'를 치는 순간 모달이 열렸다.
    if (this.scene.game.input.keyboard) this.scene.game.input.keyboard.enabled = !this.open;

    if (this.open) this.input.focus();
    else this.input.blur();
  }

  private readonly onGlobalKey = (event: KeyboardEvent): void => {
    if (event.code !== 'Backquote') return;
    event.preventDefault();
    this.toggle();
  };

  private onInputKey(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      const line = this.input.value.trim();
      this.input.value = '';
      if (!line) return;

      this.print(`> ${line}`, 'echo');
      this.remember(line);
      this.connection.sendDevCommand(line);
      return;
    }

    if (event.key === 'Tab') {
      event.preventDefault();
      this.complete();
      return;
    }

    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      this.recall(event.key === 'ArrowUp' ? -1 : 1);
    }
  }

  /** 첫 낱말만 자동완성한다 — 아이템 id까지 하면 후보가 수십 개라 오히려 방해다. */
  private complete(): void {
    const typed = this.input.value;
    if (typed.includes(' ')) return;

    const matches = DEV_COMMAND_NAMES.filter((name) => name.startsWith(typed.toLowerCase()));
    if (matches.length === 1) this.input.value = `${matches[0]} `;
    else if (matches.length > 1) this.print(matches.join(' '), 'echo');
  }

  private remember(line: string): void {
    this.history.push(line);
    if (this.history.length > MAX_HISTORY) this.history.shift();
    this.historyCursor = this.history.length;
  }

  private recall(direction: number): void {
    if (this.history.length === 0) return;
    this.historyCursor = Math.max(0, Math.min(this.history.length, this.historyCursor + direction));
    this.input.value = this.history[this.historyCursor] ?? '';
  }

  print(text: string, kind: 'out' | 'err' | 'echo' = 'out'): void {
    const line = document.createElement('div');
    line.className = `df-devconsole__line df-devconsole__line--${kind}`;
    line.textContent = text;
    this.log.appendChild(line);

    while (this.log.childElementCount > MAX_LOG_LINES) this.log.firstElementChild?.remove();
    this.log.scrollTop = this.log.scrollHeight;
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onGlobalKey);
    this.root.remove();
    if (this.scene.game.input.keyboard) this.scene.game.input.keyboard.enabled = true;
  }
}
