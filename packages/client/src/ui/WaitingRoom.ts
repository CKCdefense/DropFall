import {
  JOBS,
  MAX_CLIENTS_PER_ROOM,
  RoomPhase,
  itemsData,
  jobStats,
  jobStartingItems,
  type JobId,
} from '@dropfall/shared';
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
  /** 직업 아이콘에 마우스를 올려 둔 동안 머리글 옆에 뜨는 이름. */
  private hoveredJob: JobId | null = null;

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

  /**
   * 플레이어 한 칸 — **사원증**처럼 짠다.
   *
   * 위에서부터 [사진] → [이름] → [직업] → [특성·지급품]. 위쪽 절반은 "누구인가",
   * 아래쪽 절반은 "무엇을 들고 내려가는가"다. 직업을 고르기 전에는 아래 절반이 비어
   * 있어서, 카드가 채워지는 것 자체가 "고르라"는 신호가 된다.
   */
  private renderSlot(player: LobbyPlayer | undefined): HTMLElement {
    if (!player) {
      return el('div', { class: 'slot slot-empty' }, [
        el('div', { class: 'slot-photo' }),
        el('div', { class: 'slot-name' }, ['비어 있음']),
        el('div', { class: 'slot-job' }, ['-']),
      ]);
    }

    const job = JOBS.find((item) => item.id === player.job);

    return el(
      'div',
      { class: `slot ${player.isMe ? 'slot-me' : ''} ${player.isReady ? 'slot-ready' : ''}`.trim() },
      [
        el('div', { class: 'slot-photo' }, [
          // 스프라이트가 있으면 아틀라스에서 잘라 보여주고, 없으면 직업 첫 글자로 대체한다.
          (job && characterPortrait(job.id)) ??
            el('span', { class: 'slot-photo-mark' }, [job ? job.name.charAt(0) : '?']),
          player.isHost ? el('span', { class: 'slot-badge slot-host' }, ['방장']) : null,
          player.isReady ? el('span', { class: 'slot-badge slot-ready-mark' }, ['준비']) : null,
        ]),
        el('div', { class: 'slot-name' }, [player.nickname]),
        el('div', { class: 'slot-job' }, [job ? `${job.name} · ${job.summary}` : '선택 중...']),
        job ? this.renderSlotDetail(job.id) : null,
      ],
    );
  }

  /** 카드 아래 절반 — 고유 특성 한 줄과 시작 지급품 목록. */
  private renderSlotDetail(job: JobId): HTMLElement {
    const stats = jobStats(job);
    const items = jobStartingItems(job);

    return el('div', { class: 'slot-detail' }, [
      el('div', { class: 'slot-stats' }, [`체력 ${stats.maxHp} · 기력 ${stats.maxStamina}`]),
      stats.trait ? el('div', { class: 'slot-trait' }, [stats.trait]) : null,
      el(
        'ul',
        { class: 'slot-items' },
        items.map((entry) =>
          el('li', {}, [
            itemsData[entry.itemId]?.name ?? entry.itemId,
            // 인원수만큼 주는 항목(의무병 붕대)은 숫자 대신 그렇다고 적는다 — 대기실에서는
            // 아직 인원이 확정되지 않아 정확한 개수를 말할 수 없다.
            el('span', { class: 'slot-item-count' }, [
              entry.perPlayer ? '×인원' : entry.count > 1 ? `×${entry.count}` : '',
            ]),
          ]),
        ),
      ),
    ]);
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
   * 직업 선택 — 머리글 + 아이콘 네 칸.
   *
   * 예전엔 "병사 · 화력"처럼 글자로 늘어놓았는데, 아이콘이 커지면서 이름을 넣을 자리가
   * 없어졌다. 대신 **머리글 옆에 호버한 직업 이름**을 띄운다 — 이름은 넷 중 하나만
   * 궁금한 정보라, 넷 다 상시로 적어 두는 것보다 가리키는 것 하나만 보여주는 편이 낫다.
   * 고른 뒤에는 카드에 이름·특성·지급품이 전부 나오므로 여기서 더 설명할 필요도 없다.
   */
  private renderJobPicker(me: LobbyPlayer | undefined): HTMLElement {
    const hovered = this.hoveredJob ?? me?.job ?? null;
    const hoveredName = JOBS.find((job) => job.id === hovered);

    const head = el('div', { class: 'job-picker-head' }, [
      el('span', { class: 'job-picker-label' }, ['직업 선택']),
      el('span', { class: 'job-picker-hover' }, [
        hoveredName ? `${hoveredName.name} · ${hoveredName.summary}` : '',
      ]),
    ]);

    return el('div', { class: 'job-picker' }, [
      head,
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
              'aria-label': `${job.name} · ${job.summary}`,
            },
            // 아이콘이 아직 없으면 이름 첫 글자로 대신한다(초상화와 같은 규칙).
            [jobIcon(job.id) ?? el('span', { class: 'job-cell-mark' }, [job.name.charAt(0)])],
          );
          button.addEventListener('click', () => this.selectJob(job.id));
          /*
           * 호버 이름은 **다시 그리지 않고** 글자만 갈아 끼운다. render()를 부르면 그
           * 순간 버튼이 새로 만들어져 마우스가 얹혀 있던 요소가 사라지고, 곧바로
           * mouseleave가 날아와 이름이 깜빡인다.
           */
          button.addEventListener('mouseenter', () => {
            this.hoveredJob = job.id;
            head.querySelector('.job-picker-hover')!.textContent = `${job.name} · ${job.summary}`;
          });
          button.addEventListener('mouseleave', () => {
            this.hoveredJob = null;
            const fallback = JOBS.find((item) => item.id === me?.job);
            head.querySelector('.job-picker-hover')!.textContent = fallback
              ? `${fallback.name} · ${fallback.summary}`
              : '';
          });
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
