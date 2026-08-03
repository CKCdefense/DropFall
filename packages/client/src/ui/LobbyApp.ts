import {
  NICKNAME_MAX_LENGTH,
  ROOM_CODE_LENGTH,
  ROOM_NAME_MAX_LENGTH,
  ROOM_PASSWORD_MAX_LENGTH,
  isValidRoomCode,
  normalizeRoomCode,
  sanitizeNickname,
  sanitizeRoomName,
  type RoomListItem,
} from '@dropfall/shared';
import { createRoom, joinRoomByCode } from '../net/ColyseusConnection';
import { LocalConnection } from '../net/LocalConnection';
import { fetchRooms } from '../net/lobbyApi';
import type { GameConnection } from '../net/GameConnection';
import { clear, el } from './dom';

type Screen = 'title' | 'browse' | 'create' | 'connecting';

const NICKNAME_STORAGE_KEY = 'dropfall:nickname';

/**
 * 로비/타이틀 화면.
 *
 * 인게임 HUD와 달리 이 화면들은 캔버스가 아니라 DOM으로 만든다.
 * 텍스트 입력·포커스·IME(한글 조합)·스크롤 목록을 캔버스에서 다시 구현하는 비용이
 * 픽셀아트 일관성으로 얻는 이득보다 훨씬 크기 때문이다. 픽셀 느낌은 CSS로 낸다.
 * (docs/02-tech-spec.md §7.5, docs/frontend/01-client-architecture.md)
 */
export class LobbyApp {
  private screen: Screen = 'title';
  private nickname = localStorage.getItem(NICKNAME_STORAGE_KEY) ?? '';
  private errorMessage = '';
  private statusMessage = '';
  private rooms: RoomListItem[] = [];
  private isLoadingRooms = false;
  /** 잠긴 방 선택 시 인라인으로 비밀번호를 받기 위한 상태 */
  private pendingRoomCode: string | null = null;
  private listAbort: AbortController | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly onEnterGame: (connection: GameConnection) => void,
  ) {}

  start(): void {
    this.render();
  }

  /** 게임에서 로비로 돌아올 때 호출된다. */
  reset(message = ''): void {
    this.screen = 'title';
    this.errorMessage = message;
    this.statusMessage = '';
    this.pendingRoomCode = null;
    this.render();
  }

  // ---------------------------------------------------------------- rendering

  private render(): void {
    clear(this.root);

    const panel = el('div', { class: 'panel' }, [
      el('h1', { class: 'logo' }, ['DropFall']),
      el('p', { class: 'tagline' }, ['낮에는 짓고, 밤에는 버틴다']),
      this.renderScreen(),
      this.errorMessage ? el('p', { class: 'msg msg-error' }, [this.errorMessage]) : null,
      this.statusMessage ? el('p', { class: 'msg msg-info' }, [this.statusMessage]) : null,
    ]);

    this.root.append(el('div', { class: 'lobby' }, [panel]));
  }

  private renderScreen(): HTMLElement {
    switch (this.screen) {
      case 'title':
        return this.renderTitle();
      case 'browse':
        return this.renderBrowse();
      case 'create':
        return this.renderCreate();
      case 'connecting':
        return el('div', { class: 'screen' }, [el('p', { class: 'loading' }, ['접속 중...'])]);
    }
  }

  private renderTitle(): HTMLElement {
    const nicknameInput = this.nicknameField();

    return el('div', { class: 'screen' }, [
      nicknameInput.wrapper,
      el('div', { class: 'row' }, [
        this.button('게임 참여', 'primary', () => {
          if (!this.commitNickname(nicknameInput.input)) return;
          this.screen = 'browse';
          this.render();
          void this.refreshRooms();
        }),
        this.button('방 만들기', 'primary', () => {
          if (!this.commitNickname(nicknameInput.input)) return;
          this.screen = 'create';
          this.render();
        }),
      ]),
      this.button('서버 없이 혼자 테스트 (오프라인)', 'ghost', () => {
        if (!this.commitNickname(nicknameInput.input)) return;
        this.startLocal();
      }),
    ]);
  }

  private renderBrowse(): HTMLElement {
    const codeInput = el('input', {
      class: 'input code-input',
      type: 'text',
      maxlength: ROOM_CODE_LENGTH,
      placeholder: 'A3F9',
      autocomplete: 'off',
    });
    const passwordInput = this.passwordField('비밀번호 (있는 경우)');

    const list = el('div', { class: 'room-list' }, [
      this.isLoadingRooms
        ? el('p', { class: 'loading' }, ['불러오는 중...'])
        : this.rooms.length === 0
          ? el('p', { class: 'empty' }, ['열린 방이 없다. 직접 만들어 보자.'])
          : el(
              'ul',
              { class: 'rooms' },
              this.rooms.map((room) => this.renderRoomItem(room)),
            ),
    ]);

    return el('div', { class: 'screen' }, [
      el('div', { class: 'section-head' }, [
        el('h2', {}, ['방 목록']),
        this.button('새로고침', 'ghost', () => void this.refreshRooms()),
      ]),
      list,
      el('div', { class: 'divider' }, ['또는 방 코드로 참여']),
      el('div', { class: 'row' }, [
        codeInput,
        passwordInput.input,
        this.button('참여', 'primary', () => {
          const code = normalizeRoomCode(codeInput.value);
          if (!isValidRoomCode(code)) {
            this.fail(`방 코드는 ${ROOM_CODE_LENGTH}자리다. 다시 확인해 주세요.`);
            return;
          }
          void this.join(code, passwordInput.input.value);
        }),
      ]),
      this.button('뒤로', 'ghost', () => this.goTitle()),
    ]);
  }

  private renderRoomItem(room: RoomListItem): HTMLElement {
    const isFull = room.clients >= room.maxClients;
    const isSelected = this.pendingRoomCode === room.roomCode;
    const passwordInput = this.passwordField('비밀번호');

    const enter = (password: string) => {
      if (room.hasPassword && !isSelected) {
        // 잠긴 방은 한 번 더 눌러서 비밀번호를 받는다.
        this.pendingRoomCode = room.roomCode;
        this.render();
        return;
      }
      void this.join(room.roomCode, password);
    };

    return el('li', { class: `room ${isFull || room.locked ? 'room-full' : ''}` }, [
      el('div', { class: 'room-main' }, [
        el('span', { class: 'room-lock' }, [room.hasPassword ? '[잠김]' : '']),
        el('span', { class: 'room-name' }, [room.roomName]),
        el('span', { class: 'room-code' }, [room.roomCode]),
        el('span', { class: 'room-count' }, [`${room.clients}/${room.maxClients}`]),
        this.button(
          isFull || room.locked ? '입장 불가' : isSelected ? '확인' : '참여',
          'small',
          () => enter(passwordInput.input.value),
          isFull || room.locked,
        ),
      ]),
      isSelected ? el('div', { class: 'room-password' }, [passwordInput.input]) : null,
    ]);
  }

  private renderCreate(): HTMLElement {
    const nameInput = el('input', {
      class: 'input',
      type: 'text',
      maxlength: ROOM_NAME_MAX_LENGTH,
      placeholder: `${this.nickname}의 방`,
      autocomplete: 'off',
    });
    const passwordInput = this.passwordField('비밀번호 (선택)');

    return el('div', { class: 'screen' }, [
      el('h2', {}, ['방 만들기']),
      el('label', { class: 'field' }, [el('span', {}, ['방 이름']), nameInput]),
      el('label', { class: 'field' }, [el('span', {}, ['비밀번호']), passwordInput.input]),
      el('p', { class: 'hint' }, ['비밀번호를 비워두면 누구나 들어올 수 있는 공개 방이 된다.']),
      el('div', { class: 'row' }, [
        this.button('만들기', 'primary', () => {
          const roomName = sanitizeRoomName(nameInput.value || `${this.nickname}의 방`);
          if (!roomName) {
            this.fail(`방 이름은 1~${ROOM_NAME_MAX_LENGTH}자로 입력해 주세요.`);
            return;
          }
          void this.create(roomName, passwordInput.input.value);
        }),
        this.button('뒤로', 'ghost', () => this.goTitle()),
      ]),
    ]);
  }

  // ------------------------------------------------------------- form helpers

  private nicknameField(): { wrapper: HTMLElement; input: HTMLInputElement } {
    const input = el('input', {
      class: 'input',
      type: 'text',
      maxlength: NICKNAME_MAX_LENGTH,
      placeholder: '생존자 이름',
      autocomplete: 'off',
    });
    input.value = this.nickname;

    const wrapper = el('label', { class: 'field' }, [el('span', {}, ['닉네임']), input]);
    return { wrapper, input };
  }

  private passwordField(placeholder: string): { input: HTMLInputElement } {
    const input = el('input', {
      class: 'input',
      type: 'password',
      maxlength: ROOM_PASSWORD_MAX_LENGTH,
      placeholder,
      autocomplete: 'off',
    });
    return { input };
  }

  private button(
    label: string,
    variant: 'primary' | 'ghost' | 'small',
    onClick: () => void,
    disabled = false,
  ): HTMLButtonElement {
    const button = el('button', { class: `btn btn-${variant}`, type: 'button', disabled }, [label]);
    if (!disabled) button.addEventListener('click', onClick);
    return button;
  }

  private commitNickname(input: HTMLInputElement): boolean {
    const nickname = sanitizeNickname(input.value);
    if (!nickname) {
      this.fail(`닉네임은 1~${NICKNAME_MAX_LENGTH}자로 입력해 주세요.`);
      return false;
    }
    this.nickname = nickname;
    localStorage.setItem(NICKNAME_STORAGE_KEY, nickname);
    this.errorMessage = '';
    return true;
  }

  private goTitle(): void {
    this.screen = 'title';
    this.errorMessage = '';
    this.pendingRoomCode = null;
    this.render();
  }

  private fail(message: string): void {
    this.errorMessage = message;
    this.screen = this.screen === 'connecting' ? 'title' : this.screen;
    this.render();
  }

  // ------------------------------------------------------------- server calls

  private async refreshRooms(): Promise<void> {
    this.listAbort?.abort();
    this.listAbort = new AbortController();

    this.isLoadingRooms = true;
    this.errorMessage = '';
    this.render();

    try {
      this.rooms = await fetchRooms(this.listAbort.signal);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      this.rooms = [];
      this.errorMessage =
        '서버에 연결하지 못했다. 서버가 켜져 있는지 확인해 주세요. (pnpm dev)';
    } finally {
      this.isLoadingRooms = false;
      this.render();
    }
  }

  private async create(roomName: string, password: string): Promise<void> {
    this.screen = 'connecting';
    this.render();

    try {
      const connection = await createRoom({ nickname: this.nickname, roomName, password });
      this.onEnterGame(connection);
    } catch (err) {
      this.screen = 'create';
      this.fail((err as Error).message);
    }
  }

  private async join(roomCode: string, password: string): Promise<void> {
    const previous = this.screen;
    this.screen = 'connecting';
    this.render();

    try {
      const connection = await joinRoomByCode(roomCode, {
        nickname: this.nickname,
        password,
      });
      this.onEnterGame(connection);
    } catch (err) {
      this.screen = previous;
      this.pendingRoomCode = roomCode;
      this.fail((err as Error).message);
    }
  }

  startLocal(): void {
    this.onEnterGame(new LocalConnection(this.nickname || '생존자'));
  }
}
