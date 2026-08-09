import { JOBS, MAX_CLIENTS_PER_ROOM, RoomPhase, type JobId } from '@dropfall/shared';
import type { GameConnection, LobbyPlayer } from '../net/GameConnection';
import { assetAttr } from './assets';
import { characterPortrait, jobIcon } from './characterPortrait';
import { clear, el } from './dom';

/**
 * 게임 로비(대기실) — 방에 들어온 뒤 게임이 시작되기 전까지의 화면.
 *
 * 와이어프레임 기준 배치:
 *
 * ```
 * 강하 준비          방이름                    [나가기]
 * [슬롯1][슬롯2][슬롯3][슬롯4]      [행성 / 티모시 on·off]
 * [채팅]        직업 선택 ▣▣▣▣           [Ready/Start]
 * ```
 *
 * 위 줄은 **누가 왔는가**, 아래 줄은 **내가 무엇을 할 것인가**다. 슬롯 4칸은 인원이 늘고
 * 줄어도 자리를 유지한다 — 사람이 들어올 때마다 레이아웃이 흔들리면 안 된다.
 *
 * 방 상태는 서버가 권위를 가진다 — 이 화면은 `connection.getLobbyView()`를 그리기만 하고,
 * 직업/준비/시작/티모시는 전부 서버에 요청해서 상태가 돌아오면 다시 그린다.
 */
export class WaitingRoom {
  private errorMessage = '';

  constructor(
    private readonly root: HTMLElement,
    private readonly connection: GameConnection,
    private readonly onStartGame: () => void,
    private readonly onLeave: () => void,
  ) {}

  start(): void {
    this.connection.onLobbyChange(() => this.handleStateChange());
    this.connection.onLobbyError((message) => {
      this.errorMessage = message;
      this.render();
    });
    this.render();
  }

  private handleStateChange(): void {
    // 서버가 게임을 시작하면 대기실을 닫고 인게임으로 넘어간다.
    if (this.connection.getLobbyView().phase === RoomPhase.PLAYING) {
      this.onStartGame();
      return;
    }
    this.render();
  }

  // ---------------------------------------------------------------- rendering

  private render(): void {
    clear(this.root);

    const view = this.connection.getLobbyView();
    const { roomCode, roomName } = this.connection.roomInfo;
    const me = view.players.find((player) => player.isMe);

    this.root.append(
      el('div', { class: 'waiting' }, [
        el('div', { class: 'waiting-head' }, [
          el('span', { class: 'waiting-title' }, ['강하 준비']),
          el('span', { class: 'waiting-room-name' }, [roomName]),
          el('span', { class: 'waiting-room-code' }, [roomCode]),
          el('button', { class: 'btn btn-small waiting-leave', type: 'button' }, ['나가기']),
        ]),

        // 위 줄 — 슬롯 4칸 + 방 설정 판
        el('div', { class: 'waiting-roster' }, [
          el(
            'div',
            { class: 'slots' },
            Array.from({ length: MAX_CLIENTS_PER_ROOM }, (_, index) =>
              this.renderSlot(view.players[index]),
            ),
          ),
          this.renderRoomPanel(view.amHost, view.companionEnabled),
        ]),

        // 아래 줄 — 채팅 / 직업 선택 / 시작 버튼
        el('div', { class: 'waiting-bottom' }, [
          // 채팅은 MVP 제외 — 자리만 잡아둔다
          el('div', { class: 'chat-box', ...assetAttr('input') }, [
            el('span', { class: 'chat-placeholder' }, ['채팅 (MVP 제외)']),
          ]),
          this.renderJobPicker(me),
          this.renderActionButton(view.amHost, me),
        ]),

        this.errorMessage
          ? el('p', { class: 'msg msg-error waiting-error' }, [this.errorMessage])
          : null,
      ]),
    );

    this.root.querySelector('.waiting-leave')?.addEventListener('click', () => this.onLeave());
  }

  private renderSlot(player: LobbyPlayer | undefined): HTMLElement {
    if (!player) {
      return el('div', { class: 'slot slot-empty' }, [
        el('div', { class: 'slot-portrait' }),
        el('div', { class: 'slot-line' }, ['비어 있음']),
        el('div', { class: 'slot-line' }, ['-']),
      ]);
    }

    const job = JOBS.find((item) => item.id === player.job);

    return el(
      'div',
      { class: `slot ${player.isMe ? 'slot-me' : ''} ${player.isReady ? 'slot-ready' : ''}`.trim() },
      [
        el('div', { class: 'slot-portrait' }, [
          // 스프라이트가 있으면 아틀라스에서 잘라 보여주고, 없으면 직업 첫 글자로 대체한다.
          (job && characterPortrait(job.id)) ??
            el('span', { class: 'slot-portrait-mark' }, [job ? job.name.charAt(0) : '?']),
          player.isHost ? el('span', { class: 'slot-host' }, ['방장']) : null,
          player.isReady ? el('span', { class: 'slot-ready-mark' }, ['준비']) : null,
        ]),
        el('div', { class: 'slot-line' }, [player.nickname]),
        el('div', { class: 'slot-line' }, [job ? job.name : '선택 중...']),
      ],
    );
  }

  /**
   * 오른쪽 방 설정 판 — 행성 그림 + 티모시 on/off.
   *
   * 사람 슬롯과 **같은 줄**에 둔다. 티모시는 사실상 다섯 번째 자리라, 이 줄이 곧
   * "이번 판에 누가 내려가는가"가 된다.
   */
  private renderRoomPanel(amHost: boolean, companionEnabled: boolean): HTMLElement {
    const toggle = el(
      'button',
      {
        class: `btn btn-small companion-toggle ${companionEnabled ? 'is-on' : ''}`.trim(),
        type: 'button',
        // 방 설정이라 방장만 바꾼다. 나머지에게는 현재 상태만 보인다.
        disabled: !amHost,
        title: amHost ? '티모시를 데려갈지 정한다' : '방장만 바꿀 수 있다',
      },
      [
        el('span', { class: 'companion-toggle-name' }, ['티모시']),
        el('span', { class: 'companion-toggle-state' }, [companionEnabled ? 'ON' : 'OFF']),
      ],
    );
    if (amHost) {
      toggle.addEventListener('click', () => {
        this.errorMessage = '';
        this.connection.setCompanion(!companionEnabled);
      });
    }

    return el('div', { class: `room-panel ${companionEnabled ? '' : 'is-off'}`.trim() }, [
      el('div', { class: 'room-panel-art' }),
      toggle,
      amHost ? null : el('span', { class: 'room-panel-note' }, ['(방장만 변경)']),
    ]);
  }

  /** 방장은 [시작], 나머지는 [준비] */
  private renderActionButton(amHost: boolean, me: LobbyPlayer | undefined): HTMLElement {
    const hasJob = Boolean(me?.job);

    if (amHost) {
      const button = el(
        'button',
        { class: 'btn btn-primary action-button', type: 'button', ...assetAttr('button') },
        ['시작'],
      );
      button.addEventListener('click', () => {
        this.errorMessage = '';
        this.connection.startGame();
      });
      return button;
    }

    const button = el(
      'button',
      {
        class: `btn btn-primary action-button ${me?.isReady ? 'is-ready' : ''}`.trim(),
        type: 'button',
        disabled: !hasJob,
        ...assetAttr('button'),
      },
      [me?.isReady ? '준비 해제' : '준비'],
    );
    if (hasJob) {
      button.addEventListener('click', () => this.connection.setReady(!me?.isReady));
    }
    return button;
  }

  /**
   * 직업 선택 — 아이콘 네 칸.
   *
   * 예전엔 "병사 · 화력"처럼 글자로 늘어놓았는데, 와이어프레임의 이 자리는 가로가 짧아
   * 글자가 들어가지 않는다. 고른 직업은 슬롯 카드에 이름으로 이미 적히므로 여기서 또 쓸
   * 이유도 없다 — 설명은 툴팁으로 남긴다.
   */
  private renderJobPicker(me: LobbyPlayer | undefined): HTMLElement {
    return el('div', { class: 'job-picker' }, [
      el('span', { class: 'job-picker-label' }, ['직업 선택']),
      el(
        'div',
        { class: 'job-picker-row' },
        JOBS.map((job) => {
          const selected = me?.job === job.id;
          const button = el(
            'button',
            {
              class: `job-cell ${selected ? 'is-selected' : ''}`.trim(),
              type: 'button',
              title: `${job.name} · ${job.summary}`,
            },
            // 아이콘이 아직 없으면 이름 첫 글자로 대신한다(초상화와 같은 규칙).
            [jobIcon(job.id) ?? el('span', { class: 'job-cell-mark' }, [job.name.charAt(0)])],
          );
          button.addEventListener('click', () => this.selectJob(job.id));
          return button;
        }),
      ),
    ]);
  }

  private selectJob(job: JobId): void {
    this.errorMessage = '';
    this.connection.selectJob(job);
  }
}
