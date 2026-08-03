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
import { hasAsset } from './assets';
import { clear, el } from './dom';

type Screen = 'title' | 'browse' | 'create' | 'connecting';

const NICKNAME_STORAGE_KEY = 'dropfall:nickname';

/**
 * 로비/타이틀 화면.
 *
 * 인게임 HUD와 달리 이 화면들은 캔버스가 아니라 DOM으로 만든다.
 * 텍스트 입력·포커스·IME(한글 조합)·스크롤 목록을 캔버스에서 다시 구현하는 비용이
 * 픽셀아트 일관성으로 얻는 이득보다 훨씬 크기 때문이다.
 * (docs/02-tech-spec.md §7.5, docs/frontend/01-client-architecture.md)
 *
 * 시각 요소는 전부 플레이스홀더다 — 로고는 `.asset` 슬롯, 프레임/버튼/입력은
 * 9-slice가 들어갈 자리를 미리 잡아둔 `border-image` 구조다.
 * 교체 방법은 docs/frontend/06-ui-asset-slots.md 참고.
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

  /**
   * 화면 전체가 곧 레이아웃이다 — 컨테이너 패널을 두지 않는다.
   * (와이어프레임의 바깥 사각형은 화면 경계를 나타낸 구분선이지 UI 요소가 아니다)
   */
  private render(): void {
    clear(this.root);

    const message = this.errorMessage
      ? el('p', { class: 'msg msg-error lobby-message' }, [this.errorMessage])
      : this.statusMessage
        ? el('p', { class: 'msg msg-info lobby-message' }, [this.statusMessage])
        : null;

    this.root.append(el('div', { class: 'lobby' }, [this.renderScreen(), message]));
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
        return el('div', { class: 'screen screen-form' }, [
          el('p', { class: 'loading' }, ['접속 중...']),
        ]);
    }
  }

  /**
   * 와이어프레임 기준: 화면 위에 로고, 가운데 닉네임, 아래 좌우로 벌어진 두 버튼.
   * 세 구역을 화면 높이에 분배해서 창 크기가 달라져도 상대 위치가 유지된다.
   */
  private renderTitle(): HTMLElement {
    const nickname = this.nicknameField();

    return el('div', { class: 'screen landing' }, [
      el('div', { class: 'landing-top' }, [
        this.logo(),
        el('p', { class: 'tagline' }, ['낮에는 짓고, 밤에는 버틴다']),
      ]),
      el('div', { class: 'landing-mid' }, [nickname.wrapper]),
      el('div', { class: 'landing-bottom' }, [
        el('div', { class: 'landing-actions' }, [
          this.button('참가하기', 'primary', () => {
            if (!this.commitNickname(nickname.input)) return;
            this.screen = 'browse';
            this.render();
            void this.refreshRooms();
          }),
          this.button('방 만들기', 'primary', () => {
            if (!this.commitNickname(nickname.input)) return;
            this.screen = 'create';
            this.render();
          }),
        ]),
        // 서버 없이 클라이언트만 확인하는 개발/시연용 진입로
        this.button('오프라인으로 혼자 해보기', 'link', () => {
          if (!this.commitNickname(nickname.input)) return;
          this.startLocal();
        }),
      ]),
    ]);
  }

  private renderBrowse(): HTMLElement {
    const code = this.codeField();
    const password = this.passwordField('비밀번호');

    const list = el('div', { class: 'room-list scroll-y' }, [
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

    return el('div', { class: 'screen screen-form' }, [
      el('div', { class: 'screen-head' }, [
        el('h2', {}, ['방 목록']),
        this.button('새로고침', 'small', () => void this.refreshRooms()),
      ]),
      list,
      el('div', { class: 'divider' }, ['또는 방 코드로 참가']),
      el('div', { class: 'row' }, [
        code.wrapper,
        password.wrapper,
        this.button('참가', 'small', () => {
          const value = normalizeRoomCode(code.input.value);
          if (!isValidRoomCode(value)) {
            this.fail(`방 코드는 ${ROOM_CODE_LENGTH}자리다. 다시 확인해 주세요.`);
            return;
          }
          void this.join(value, password.input.value);
        }),
      ]),
      this.button('뒤로', 'ghost', () => this.goTitle()),
    ]);
  }

  private renderRoomItem(room: RoomListItem): HTMLElement {
    const isFull = room.clients >= room.maxClients;
    const isSelected = this.pendingRoomCode === room.roomCode;
    const password = this.passwordField('비밀번호');

    const enter = () => {
      if (room.hasPassword && !isSelected) {
        // 잠긴 방은 한 번 더 눌러서 비밀번호를 받는다.
        this.pendingRoomCode = room.roomCode;
        this.render();
        return;
      }
      void this.join(room.roomCode, password.input.value);
    };

    return el('li', { class: `room ${isFull || room.locked ? 'room-full' : ''}` }, [
      el('div', { class: 'room-main' }, [
        el('span', { class: 'room-lock' }, [room.hasPassword ? '[잠김]' : '']),
        el('span', { class: 'room-name' }, [room.roomName]),
        el('span', { class: 'room-code' }, [room.roomCode]),
        el('span', { class: 'room-count' }, [`${room.clients}/${room.maxClients}`]),
        this.button(
          isFull || room.locked ? '입장 불가' : isSelected ? '확인' : '참가',
          'small',
          enter,
          isFull || room.locked,
        ),
      ]),
      isSelected ? el('div', { class: 'room-password' }, [password.wrapper]) : null,
    ]);
  }

  private renderCreate(): HTMLElement {
    const name = this.textField(`${this.nickname}의 방`, ROOM_NAME_MAX_LENGTH);
    const password = this.passwordField('비우면 공개 방');

    return el('div', { class: 'screen screen-form' }, [
      el('div', { class: 'screen-head' }, [el('h2', {}, ['방 만들기'])]),
      el('label', { class: 'field-block' }, [el('span', {}, ['방 이름']), name.wrapper]),
      el('label', { class: 'field-block' }, [el('span', {}, ['비밀번호']), password.wrapper]),
      el('p', { class: 'hint' }, ['비밀번호를 비워두면 누구나 들어올 수 있는 공개 방이 된다.']),
      el('div', { class: 'row' }, [
        this.button('만들기', 'primary', () => {
          const roomName = sanitizeRoomName(name.input.value || `${this.nickname}의 방`);
          if (!roomName) {
            this.fail(`방 이름은 1~${ROOM_NAME_MAX_LENGTH}자로 입력해 주세요.`);
            return;
          }
          void this.create(roomName, password.input.value);
        }),
        this.button('뒤로', 'ghost', () => this.goTitle()),
      ]),
    ]);
  }

  // ------------------------------------------------------------- 조각 만들기

  /**
   * 로고 슬롯. 에셋 파일이 있으면 이미지로, 없으면 텍스트 플레이스홀더로 그린다.
   * 판정은 `loadImageAssets()`가 앱 시작 시 한 번 해두고, 여기서는 결과만 읽는다.
   */
  private logo(): HTMLElement {
    const hasLogo = hasAsset('logo');
    return el('div', {
      class: `asset asset-logo${hasLogo ? '' : ' placeholder'}`,
      'data-placeholder': 'DropFall',
      role: 'img',
      'aria-label': 'DropFall',
    });
  }

  /** 9-slice 입력 프레임 + 실제 input. 라벨은 프레임 안쪽에 붙는다(와이어프레임 기준). */
  private inputField(
    label: string,
    attrs: Record<string, string | number>,
    extraClass = '',
  ): { wrapper: HTMLElement; input: HTMLInputElement } {
    const input = el('input', { autocomplete: 'off', ...attrs });
    const wrapper = el('div', { class: `field ${extraClass}`.trim() }, [
      label ? el('span', { class: 'field-label' }, [label]) : null,
      input,
    ]);
    return { wrapper, input };
  }

  private nicknameField(): { wrapper: HTMLElement; input: HTMLInputElement } {
    const field = this.inputField('닉네임:', {
      type: 'text',
      maxlength: NICKNAME_MAX_LENGTH,
      placeholder: '생존자 이름',
    });
    field.input.value = this.nickname;
    return field;
  }

  private textField(
    placeholder: string,
    maxlength: number,
  ): { wrapper: HTMLElement; input: HTMLInputElement } {
    return this.inputField('', { type: 'text', maxlength, placeholder });
  }

  private passwordField(placeholder: string): { wrapper: HTMLElement; input: HTMLInputElement } {
    return this.inputField('', {
      type: 'password',
      maxlength: ROOM_PASSWORD_MAX_LENGTH,
      placeholder,
    });
  }

  private codeField(): { wrapper: HTMLElement; input: HTMLInputElement } {
    return this.inputField(
      '',
      { type: 'text', maxlength: ROOM_CODE_LENGTH, placeholder: 'A3F9' },
      'field-code',
    );
  }

  private button(
    label: string,
    variant: 'primary' | 'ghost' | 'small' | 'link',
    onClick: () => void,
    disabled = false,
  ): HTMLButtonElement {
    const button = el('button', { class: `btn btn-${variant}`, type: 'button', disabled }, [label]);
    if (!disabled) button.addEventListener('click', onClick);
    return button;
  }

  // ------------------------------------------------------------- 상태 전환

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
      this.errorMessage = '서버에 연결하지 못했다. 서버가 켜져 있는지 확인해 주세요. (pnpm dev)';
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
