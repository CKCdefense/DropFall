import { JOBS, MAX_CLIENTS_PER_ROOM, RoomPhase, type JobId } from '@dropfall/shared';
import type { GameConnection, LobbyPlayer } from '../net/GameConnection';
import { assetAttr } from './assets';
import { characterPortrait } from './characterPortrait';
import { clear, el } from './dom';

/**
 * 게임 로비(대기실) — 방에 들어온 뒤 게임이 시작되기 전까지의 화면.
 *
 * 와이어프레임 기준: 플레이어 슬롯 4개(초상화 / 이름 / 직업) + 채팅 영역 + Ready/Start.
 * 채팅은 MVP 제외라 자리만 잡아둔다.
 *
 * 방 상태는 서버가 권위를 가진다 — 이 화면은 `connection.getLobbyView()`를 그리기만 하고,
 * 직업/준비/시작은 전부 서버에 요청해서 상태가 돌아오면 다시 그린다.
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
          el('span', { class: 'waiting-room-name' }, [roomName]),
          el('span', { class: 'waiting-room-code' }, [roomCode]),
          el('button', { class: 'btn btn-small waiting-leave', type: 'button' }, ['나가기']),
        ]),

        // 슬롯 4칸. 빈 자리도 자리를 유지해야 인원이 바뀔 때 레이아웃이 흔들리지 않는다.
        el(
          'div',
          { class: 'slots' },
          Array.from({ length: MAX_CLIENTS_PER_ROOM }, (_, index) =>
            this.renderSlot(view.players[index]),
          ),
        ),

        el('div', { class: 'waiting-bottom' }, [
          // 채팅은 MVP 제외 — 자리만 잡아둔다
          el('div', { class: 'chat-box', ...assetAttr('input') }, [
            el('span', { class: 'chat-placeholder' }, ['채팅 (MVP 제외)']),
          ]),
          this.renderActionButton(view.amHost, me),
        ]),

        this.renderJobPicker(me),
        // 티모시는 방을 만들 때 정해져 참가자는 바꿀 수 없다 — 끈 방에서만 알려준다.
        // 켜져 있는 건 기본값이라 굳이 한 줄을 쓰지 않는다.
        view.companionEnabled
          ? null
          : el('p', { class: 'hint waiting-note' }, ['이 방은 티모시 없이 진행한다.']),
        this.errorMessage ? el('p', { class: 'msg msg-error' }, [this.errorMessage]) : null,
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
          player.isReady ? el('span', { class: 'slot-ready-mark' }, ['준비'])  : null,
        ]),
        el('div', { class: 'slot-line' }, [player.nickname]),
        el('div', { class: 'slot-line' }, [job ? job.name : '선택 중...']),
      ],
    );
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

  private renderJobPicker(me: LobbyPlayer | undefined): HTMLElement {
    return el('div', { class: 'job-picker' }, [
      el('span', { class: 'job-picker-label' }, ['직업']),
      ...JOBS.map((job) => {
        const selected = me?.job === job.id;
        const button = el(
          'button',
          { class: `btn btn-small job-chip ${selected ? 'is-selected' : ''}`.trim(), type: 'button' },
          [`${job.name} · ${job.summary}`],
        );
        button.addEventListener('click', () => this.selectJob(job.id));
        return button;
      }),
    ]);
  }

  private selectJob(job: JobId): void {
    this.errorMessage = '';
    this.connection.selectJob(job);
  }
}
