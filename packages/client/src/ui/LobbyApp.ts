import {
  MAX_CLIENTS_PER_ROOM,
  NICKNAME_MAX_LENGTH,
  ROOM_CODE_LENGTH,
  ROOM_NAME_MAX_LENGTH,
  ROOM_PASSWORD_MAX_LENGTH,
  isValidRoomCode,
  normalizeRoomCode,
  sanitizeNickname,
  sanitizeRoomName,
  JOBS,
  jobStats,
  type JobId,
  type RoomListItem,
} from '@dropfall/shared';
import { createRoom, joinRoomByCode } from '../net/ColyseusConnection';
import { LocalConnection } from '../net/LocalConnection';
import { jobIcon } from './characterPortrait';
import { jobKitText } from './jobKit';
import { fetchRooms } from '../net/lobbyApi';
import type { GameConnection } from '../net/GameConnection';
import { assetAttr, hasAsset } from './assets';
import { createCodeInput } from './codeInput';
import { clear, el } from './dom';

type Screen = 'title' | 'solo' | 'browse' | 'create' | 'connecting';

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
  /** 방 목록 모달 안에서 목록 / 코드 찾기 전환 */
  private browseMode: 'list' | 'code' = 'list';
  private searchQuery = '';
  /** 혼자하기 모달에서 고른 직업. 고르기 전에는 시작할 수 없다(대기실과 같은 규칙). */
  private soloJob: JobId | null = null;
  /**
   * 티모시를 데려갈지. 혼자하기와 방 만들기가 **같은 값을 공유한다** — 한 번 정한
   * 취향이 다음 판에도 이어지는 게 자연스럽고, 두 화면이 서로 다른 값을 기억하면
   * "분명 껐는데 켜져 있다"가 된다.
   */
  private companionEnabled = true;

  constructor(
    private readonly root: HTMLElement,
    private readonly onEnterGame: (connection: GameConnection) => void,
  ) {}

  start(): void {
    this.render();
  }

  /**
   * 게임에서 로비로 돌아올 때 호출된다.
   *
   * @param screen 돌아갈 화면. 기본은 타이틀이고, `'browse'`면 방 목록을 바로 띄우고
   *   새로 고친다 — 멀티에서 한 판이 끝난 사람은 대개 다음 방을 찾으므로, 타이틀을
   *   한 번 더 거치게 하는 건 걸음만 늘린다.
   */
  reset(message = '', screen: 'title' | 'browse' = 'title'): void {
    this.screen = screen;
    this.errorMessage = message;
    this.statusMessage = '';
    this.pendingRoomCode = null;
    this.browseMode = 'list';
    this.render();
    if (screen === 'browse') void this.refreshRooms();
  }

  // ---------------------------------------------------------------- rendering

  /**
   * 타이틀 화면은 항상 깔려 있고, 방 목록·방 만들기는 그 위에 모달로 뜬다.
   * 화면 전체가 곧 레이아웃이다 — 컨테이너 패널을 두지 않는다.
   */
  private render(): void {
    clear(this.root);

    this.root.append(el('div', { class: 'lobby' }, [this.renderTitle(), this.renderModal()]));
  }

  /** 모달이 필요 없는 화면(title)에서는 null */
  private renderModal(): HTMLElement | null {
    const body =
      this.screen === 'browse'
        ? this.renderBrowse()
        : this.screen === 'create'
          ? this.renderCreate()
          : this.screen === 'solo'
            ? this.renderSolo()
            : this.screen === 'connecting'
              ? el('p', { class: 'modal-loading' }, ['접속 중...'])
              : null;

    if (!body) return null;

    // 방 목록만 가로로 긴 상자를 쓴다(네 열짜리 표). 입력 몇 칸뿐인 화면은 같은 상자에
    // 담으면 좌우가 통째로 비므로 세로로 선 폼 상자로 바꾼다(§.modal-form).
    const isTable = this.screen === 'browse' && this.browseMode === 'list';
    // 혼자하기는 직업 카드 네 장이 한 줄로 들어가야 해서 폼보다 조금 넓다(§.modal-solo).
    const shape = isTable ? '' : this.screen === 'solo' ? 'modal-form modal-solo' : 'modal-form';
    const modal = el('div', {
      class: `modal ${shape}`.trim(),
      ...assetAttr('modal'),
    }, [body]);
    const backdrop = el('div', { class: 'modal-backdrop' }, [modal]);

    // 바깥을 누르면 닫힌다. 접속 중에는 닫지 않는다.
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop && this.screen !== 'connecting') this.goTitle();
    });

    return backdrop;
  }

  /**
   * 로고 바로 아래에 닉네임을 붙이고(로고 이미지의 부제 "SURVIVAL PROTOCOL" 바로 밑),
   * 버튼 세 개는 화면 맨 아래에 로고 폭 안쪽으로 모아 한 줄로 늘어놓는다.
   * 위/아래 두 구역을 화면 높이에 분배해서 창 크기가 달라져도 상대 위치가 유지된다.
   */
  private renderTitle(): HTMLElement {
    const nickname = this.nicknameField();

    return el('div', { class: 'screen landing' }, [
      el('div', { class: 'landing-top' }, [this.logo(), nickname.wrapper]),
      // 안내·오류 줄은 **항상 자리를 차지한다**(비어 있어도 빈 상자를 남긴다).
      // 메시지가 뜰 때만 끼워 넣으면 그만큼 로고와 버튼이 밀려서, 오류를 읽는 순간
      // 누르려던 버튼이 발밑에서 움직인다.
      el('div', { class: 'landing-message' }, [this.landingMessage()]),
      el('div', { class: 'landing-bottom' }, [
        el('div', { class: 'landing-actions' }, [
          // 서버 없이 클라이언트만 확인하는 개발/시연용 진입로
          this.button('혼자하기', 'primary', () => {
            if (!this.commitNickname(nickname.input)) return;
            this.screen = 'solo';
            this.render();
          }),
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
      ]),
    ]);
  }

  /** 닉네임 칸과 버튼 줄 사이에 놓이는 안내/오류 한 줄. 없으면 null(자리는 유지된다). */
  private landingMessage(): HTMLElement | null {
    if (this.errorMessage) return el('p', { class: 'msg msg-error' }, [this.errorMessage]);
    if (this.statusMessage) return el('p', { class: 'msg msg-info' }, [this.statusMessage]);
    return null;
  }

  /** 와이어프레임: 검색 / 헤더 행 / 방 목록 / [방 만들기] [코드 찾기] */
  private renderBrowse(): HTMLElement {
    if (this.browseMode === 'code') return this.renderCodeForm();

    const search = this.inputField('', {
      type: 'text',
      placeholder: '방 이름 검색',
      maxlength: ROOM_NAME_MAX_LENGTH,
    });
    search.input.value = this.searchQuery;
    search.input.addEventListener('input', () => {
      this.searchQuery = search.input.value;
      this.renderRoomRows(rows);
    });
    // 검색 아이콘은 CSS로 그린 임시 도형이다. 아이콘 에셋이 생기면 .asset 슬롯으로 교체한다.
    search.wrapper.prepend(el('span', { class: 'icon-search' }));

    const rows = el('div', { class: 'room-rows scroll-hidden' });
    this.renderRoomRows(rows);

    return el('div', { class: 'room-table' }, [
      el('div', { class: 'modal-head' }, [
        search.wrapper,
        this.button('↻', 'square', () => void this.refreshRooms()),
      ]),
      el('div', { class: 'room-row room-row-head' }, [
        el('span', {}, ['방코드']),
        el('span', { class: 'room-name' }, ['방 이름']),
        el('span', { class: 'room-count' }, [`인원/${MAX_CLIENTS_PER_ROOM}`]),
        el('span', {}, ['참가']),
      ]),
      rows,
      el('div', { class: 'modal-actions' }, [
        this.button('방 만들기', 'primary', () => {
          this.screen = 'create';
          this.render();
        }),
        this.button('코드 찾기', 'primary', () => {
          this.browseMode = 'code';
          this.render();
        }),
      ]),
    ]);
  }

  /** 목록만 다시 그린다 — 검색어를 칠 때마다 전체를 다시 그리면 포커스가 날아간다. */
  private renderRoomRows(container: HTMLElement): void {
    clear(container);

    if (this.isLoadingRooms) {
      container.append(el('p', { class: 'modal-loading' }, ['불러오는 중...']));
      return;
    }

    const query = this.searchQuery.trim().toLowerCase();
    const rooms = query
      ? this.rooms.filter((room) => room.roomName.toLowerCase().includes(query))
      : this.rooms;

    if (rooms.length === 0) {
      container.append(
        el('p', { class: 'modal-empty' }, [
          query ? '검색 결과가 없다.' : '열린 방이 없다. 직접 만들어 보자.',
        ]),
      );
      return;
    }

    for (const room of rooms) container.append(this.renderRoomRow(room));
  }

  private renderRoomRow(room: RoomListItem): HTMLElement {
    const isFull = room.clients >= room.maxClients;
    const blocked = isFull || room.locked;
    const isSelected = this.pendingRoomCode === room.roomCode;
    const password = this.passwordField('비밀번호');

    const enter = () => {
      // 잠긴 방은 한 번 더 눌러서 비밀번호를 받는다.
      if (room.hasPassword && !isSelected) {
        this.pendingRoomCode = room.roomCode;
        this.render();
        return;
      }
      void this.join(room.roomCode, password.input.value);
    };

    const row = el('div', { class: `room-row ${blocked ? 'room-full' : ''}`.trim() }, [
      el('span', { class: 'room-code' }, [room.roomCode]),
      el('span', { class: 'room-name' }, [
        room.roomName,
        room.hasPassword ? el('span', { class: 'room-locked' }, [' 🔒']) : null,
      ]),
      el('span', { class: 'room-count' }, [`${room.clients}/${room.maxClients}`]),
      this.button(blocked ? '불가' : isSelected ? '확인' : '참가', 'small', enter, blocked),
    ]);

    if (!isSelected) return row;

    return el('div', {}, [row, el('div', { class: 'room-password-row' }, [password.wrapper])]);
  }

  /**
   * 방 코드 입력 모달 (와이어프레임: 방 코드 4칸 / 비밀번호 / Join).
   * 목록에서 잠긴 방을 고른 경우에는 코드가 이미 정해져 있어 칸을 채운 채 잠근다.
   */
  private renderCodeForm(): HTMLElement {
    const password = this.passwordField('없으면 비워 둔다');
    const submit = () => {
      const value = normalizeRoomCode(code.getValue());
      if (!isValidRoomCode(value)) {
        this.fail(`방 코드 ${ROOM_CODE_LENGTH}자리를 모두 입력해 주세요.`);
        return;
      }
      void this.join(value, password.input.value);
    };

    const code = createCodeInput(() => password.input.focus());

    // 다음 프레임에 첫 칸으로 포커스 — 지금은 아직 DOM에 붙기 전이다.
    queueMicrotask(() => code.focus());

    // Enter로도 참가되게 (코드 4칸 → 비밀번호 → Enter가 자연스러운 흐름)
    password.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') submit();
    });

    return el('div', { class: 'code-form' }, [
      el('div', { class: 'screen-head' }, [el('h2', {}, ['코드로 참가'])]),
      el('div', { class: 'code-form-label' }, ['방 코드']),
      code.wrapper,
      el('label', { class: 'field-block' }, [el('span', {}, ['비밀번호']), password.wrapper]),
      el('div', { class: 'modal-actions' }, [
        this.button('참가', 'primary', submit),
        this.button('뒤로', 'primary', () => {
          this.browseMode = 'list';
          this.render();
        }),
      ]),
    ]);
  }

  /**
   * 혼자하기 설정 모달 — 직업 고르기 + 티모시 여부.
   *
   * 혼자하기는 대기실을 건너뛰고 곧장 게임으로 들어간다(§main.enterRoom). 그래서
   * 멀티에서 대기실이 하던 일 — 직업 선택 — 을 대신할 자리가 여기밖에 없다.
   * 예전엔 이 단계가 통째로 없어서 혼자 하면 항상 기본 스탯으로만 시작했다.
   */
  private renderSolo(): HTMLElement {
    /*
     * 직업을 안 고르면 **시작 버튼이 아예 안 눌린다.**
     *
     * 예전엔 누를 수는 있고 "직업을 먼저 고르세요"라는 오류를 띄웠다 — 눌러 보고 나서야
     * 안 되는 걸 아는 것보다, 눌리지 않는 편이 먼저 알려 준다.
     */
    const hasJob = this.soloJob !== null;
    const start = () => {
      if (!this.soloJob) return;
      this.startLocal(this.soloJob);
    };

    return el('div', { class: 'code-form' }, [
      el('div', { class: 'screen-head' }, [el('h2', {}, ['혼자하기'])]),
      el('div', { class: 'field-block' }, [
        el('span', {}, ['직업 선택']),
        el(
          'div',
          { class: 'job-cards' },
          JOBS.map((job) => {
            const selected = this.soloJob === job.id;
            const card = el(
              'button',
              {
                class: `job-card ${selected ? 'is-selected' : ''}`.trim(),
                type: 'button',
                'aria-pressed': selected ? 'true' : 'false',
              },
              [
                /*
                 * **초상화가 아니라 직업 아이콘**이다. 서 있는 전신은 세로를 많이 먹는데,
                 * 이 카드는 이름·특성·지급품까지 담아야 한다 — 아이콘은 그 크기에서
                 * 읽히게 그려져 있어 같은 자리에 더 많은 것을 넣을 수 있다.
                 */
                el('span', { class: 'job-card-icon' }, [
                  jobIcon(job.id) ?? el('span', { class: 'job-cell-mark' }, [job.name.charAt(0)]),
                ]),
                el('span', { class: 'job-card-name' }, [job.name]),
                el('span', { class: 'job-card-summary' }, [job.summary]),
                el('span', { class: 'job-card-stats' }, [
                  `체력 ${jobStats(job.id).maxHp} · 기력 ${jobStats(job.id).maxStamina}`,
                ]),
                // 고유 특성 한 줄. 무엇이 다른 직업인지가 여기서 갈린다.
                el('span', { class: 'job-card-trait' }, [jobStats(job.id).trait ?? ' ']),
                /*
                 * 지급품은 **글자로** 적는다. 칸 그림은 인게임 퀵슬롯과 자리를 맞추려는
                 * 것인데, 이 카드는 폭이 좁아 칸이 알아볼 수 없을 만큼 작아진다 —
                 * 그럴 바에는 이름을 읽는 편이 낫다(대기실은 카드가 넓어 칸 그대로 쓴다).
                 */
                el('span', { class: 'job-card-kit' }, [jobKitText(job.id)]),
              ],
            );
            card.addEventListener('click', () => {
              this.soloJob = job.id;
              this.errorMessage = '';
              this.render();
            });
            return card;
          }),
        ),
      ]),
      this.companionToggle(),
      // 시작·뒤로는 **가로로 나란히, 맨 아래**에 둔다(§.modal-actions-row).
      el('div', { class: 'modal-actions modal-actions-row' }, [
        this.button('시작', 'primary', start, !hasJob),
        this.button('뒤로', 'primary', () => this.goTitle()),
      ]),
    ]);
  }

  /**
   * 티모시 on/off 체크박스. 혼자하기와 방 만들기가 같은 조각을 쓴다 — 같은 설정이
   * 화면마다 다르게 생기면 같은 값이라는 걸 알아보기 어렵다.
   */
  private companionToggle(): HTMLElement {
    const box = el('input', {
      type: 'checkbox',
      class: 'checkbox-input',
      ...(this.companionEnabled ? { checked: 'checked' } : {}),
    }) as HTMLInputElement;
    box.addEventListener('change', () => {
      this.companionEnabled = box.checked;
    });

    return el('label', { class: 'checkbox-row' }, [
      box,
      el('span', { class: 'checkbox-box' }),
      el('span', { class: 'checkbox-text' }, [
        el('span', { class: 'checkbox-label' }, ['티모시 데려가기']),
        el('span', { class: 'checkbox-hint' }, ['자원을 대신 모아 주는 AI 동반자']),
      ]),
    ]);
  }

  private renderCreate(): HTMLElement {
    const name = this.textField(`${this.nickname}의 방`, ROOM_NAME_MAX_LENGTH);
    const password = this.passwordField('비우면 공개 방');

    return el('div', { class: 'code-form' }, [
      el('div', { class: 'screen-head' }, [el('h2', {}, ['방 만들기'])]),
      el('label', { class: 'field-block' }, [el('span', {}, ['방 이름']), name.wrapper]),
      el('label', { class: 'field-block' }, [el('span', {}, ['비밀번호']), password.wrapper]),
      el('p', { class: 'hint' }, ['비밀번호를 비워두면 누구나 들어올 수 있는 공개 방이 된다.']),
      // 티모시는 방당 1마리라 참가자가 아니라 **만드는 사람**이 정한다.
      this.companionToggle(),
      el('div', { class: 'modal-actions' }, [
        this.button('만들기', 'primary', () => {
          const roomName = sanitizeRoomName(name.input.value || `${this.nickname}의 방`);
          if (!roomName) {
            this.fail(`방 이름은 1~${ROOM_NAME_MAX_LENGTH}자로 입력해 주세요.`);
            return;
          }
          void this.create(roomName, password.input.value);
        }),
        this.button('뒤로', 'primary', () => this.goTitle()),
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
    const wrapper = el('div', { class: `field ${extraClass}`.trim(), ...assetAttr('input') }, [
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


  private button(
    label: string,
    variant: 'primary' | 'ghost' | 'small' | 'link' | 'square',
    onClick: () => void,
    disabled = false,
  ): HTMLButtonElement {
    // small/ghost/link는 테두리 15px이 들어갈 높이가 안 나온다 — 9-slice를 쓰지 않는다.
    const usesAsset = variant === 'primary' || variant === 'square';
    const button = el(
      'button',
      {
        class: `btn btn-${variant}`,
        type: 'button',
        disabled,
        ...(usesAsset ? assetAttr('button') : {}),
      },
      [label],
    );
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
    this.browseMode = 'list';
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
      const connection = await createRoom({
        nickname: this.nickname,
        roomName,
        password,
        companion: this.companionEnabled,
      });
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

  /**
   * @param job 로비에서 고른 직업. `?local=1` 직행 경로는 로비를 안 거치므로 없을 수 있다.
   */
  startLocal(job?: JobId): void {
    this.onEnterGame(
      new LocalConnection(this.nickname || '생존자', {
        job,
        companion: this.companionEnabled,
      }),
    );
  }
}
