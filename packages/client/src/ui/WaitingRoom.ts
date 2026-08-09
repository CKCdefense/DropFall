import { JOBS, MAX_CLIENTS_PER_ROOM, RoomPhase, jobStats, type JobId } from '@dropfall/shared';
import type { GameConnection, LobbyPlayer } from '../net/GameConnection';
import { characterPortrait, jobIcon } from './characterPortrait';
import { jobKitRow } from './jobKit';
import { clear, el } from './dom';

/**
 * 게임 로비(대기실) — 방에 들어온 뒤 게임이 시작되기 전까지의 화면.
 *
 * ```
 * 강하 준비          방이름                    [나가기]
 * [슬롯1][슬롯2][슬롯3][슬롯4]      [강하 지점 / 스캐너]
 * [채팅]        직업 선택 ▣▣▣▣      [티모시 / 시스템 로그]  [Ready]
 * ```
 *
 * 왼쪽은 **사람**(누가 왔고 무엇을 들고 가는가), 오른쪽은 **작전**(어디로 내려가고
 * 무슨 지시가 내려왔는가)이다. 두 덩어리가 화면 아래까지 꽉 차야 브리핑실처럼 보인다.
 *
 * 방 상태는 서버가 권위를 가진다 — 이 화면은 `connection.getLobbyView()`를 그리기만 하고,
 * 직업/준비/시작/티모시는 전부 서버에 요청해서 상태가 돌아오면 다시 그린다.
 */

/**
 * 강하 지점 이름. **꾸미기용 더미**다 — 실제 맵은 아직 이름이 없고 시드로만 갈린다.
 * 지역·난이도가 생기면 그때 서버가 내려주는 값으로 갈아 끼운다.
 */
const DROP_SITE = 'KEPLER-442B';

/** 시스템 로그에 남기는 줄 수 상한. 넘치면 오래된 것부터 버린다. */
const SYSTEM_LOG_LIMIT = 8;
/** 채팅 로그도 같은 이유로 상한을 둔다. */
const CHAT_LOG_LIMIT = 40;

/** 아무 일도 없을 때 떠 있는 브리핑. 들어오자마자 빈 판을 보여주지 않으려는 것이다. */
const SYSTEM_INTRO = [
  '> 강하선 도킹 해제 — 자세 제어 정상',
  `> 강하 지점 ${DROP_SITE} 좌표 확인`,
  '> 지표 스캔: 대기 조성 호흡 가능 · 지열 이상 감지',
  '> 코어 투하 예정 좌표 고정 — 반경 900m 방어선 권장',
  '> 궤도 진입 대기 — 전원 보직 배정 요망',
];

export class WaitingRoom {
  private errorMessage = '';
  /** 직업 아이콘에 마우스를 올려 둔 동안 머리글 옆에 뜨는 이름. */
  private hoveredJob: JobId | null = null;

  /**
   * 시스템 로그. 서버가 내려주는 값이 아니라 **이 화면이 스스로 쌓는 연출**이다 —
   * 직업을 고르고 준비를 누르는 행동에 반응이 돌아와야 지시를 받는 느낌이 난다.
   */
  private systemLog: string[] = [...SYSTEM_INTRO];
  private chatLog: { nickname: string; text: string }[] = [];
  /** 다시 그릴 때 입력 중이던 글자가 날아가지 않게 들고 있는다. */
  private chatDraft = '';

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
    this.connection.onChatMessage((message) => {
      this.chatLog.push({ nickname: message.nickname, text: message.text });
      if (this.chatLog.length > CHAT_LOG_LIMIT) this.chatLog.shift();
      // 화면 전체를 다시 그리지 않는다 — 남이 말할 때마다 내 입력창이 날아가면 안 된다.
      this.paintChatLog();
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

  /** 시스템 로그 한 줄. 같은 줄이 연달아 오면 쌓지 않는다(같은 버튼 연타). */
  private log(line: string): void {
    if (this.systemLog[this.systemLog.length - 1] === line) return;
    this.systemLog.push(line);
    if (this.systemLog.length > SYSTEM_LOG_LIMIT) this.systemLog.shift();
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
          // .btn을 쓰지 않는다 — 그 클래스는 9-slice 돌 프레임을 늘 얹는다(§components.css).
          el('button', { class: 'waiting-leave', type: 'button' }, ['나가기']),
        ]),

        /*
         * 본문은 **두 칸짜리 격자**다. 왼쪽 칸이 위아래로 나뉘고(슬롯 / 채팅·직업),
         * 오른쪽 칸은 하나로 이어져 화면 아래까지 내려온다 — 작전 판이 중간에서 끊기면
         * 스캐너와 지시가 따로 노는 것처럼 보인다.
         */
        el('div', { class: 'waiting-body' }, [
          el('div', { class: 'waiting-left' }, [
            el(
              'div',
              { class: 'slots' },
              Array.from({ length: MAX_CLIENTS_PER_ROOM }, (_, index) =>
                this.renderSlot(view.players[index]),
              ),
            ),
            el('div', { class: 'waiting-bottom' }, [this.renderChat(), this.renderJobPicker(me)]),
          ]),
          this.renderRoomPanel(view.amHost, view.companionEnabled, me),
        ]),

        this.errorMessage
          ? el('p', { class: 'msg msg-error waiting-error' }, [this.errorMessage])
          : null,
      ]),
    );

    this.root.querySelector('.waiting-leave')?.addEventListener('click', () => this.onLeave());
    this.paintChatLog();
  }

  /**
   * 플레이어 한 칸 — **사원증**처럼 짠다.
   *
   * 위에서부터 [사진] → [이름] → [직업] → [특성] → [지급품 4칸]. 위쪽은 "누구인가",
   * 아래쪽은 "무엇을 들고 내려가는가"다. 직업을 고르기 전에는 지급품 칸이 비어 있어서,
   * 카드가 채워지는 것 자체가 "고르라"는 신호가 된다.
   */
  private renderSlot(player: LobbyPlayer | undefined): HTMLElement {
    if (!player) {
      return el('div', { class: 'slot slot-empty' }, [
        el('div', { class: 'slot-photo' }),
        el('div', { class: 'slot-name' }, ['비어 있음']),
        el('div', { class: 'slot-job' }, ['-']),
        el('div', { class: 'slot-detail' }),
        jobKitRow(null),
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
        this.renderSlotTrait(job?.id ?? null),
        jobKitRow(job?.id ?? null),
      ],
    );
  }

  /** 체력·기력 한 줄과 고유 특성 한 줄. 직업이 없으면 자리만 남긴다. */
  private renderSlotTrait(job: JobId | null): HTMLElement {
    if (!job) return el('div', { class: 'slot-detail' });

    const stats = jobStats(job);
    return el('div', { class: 'slot-detail' }, [
      el('div', { class: 'slot-stats' }, [`체력 ${stats.maxHp} · 기력 ${stats.maxStamina}`]),
      stats.trait ? el('div', { class: 'slot-trait' }, [stats.trait]) : null,
    ]);
  }

  /**
   * 오른쪽 작전 판 — 강하 지점 머리글 / 스캐너 화면 / 티모시 / 시스템 로그.
   *
   * 사람 슬롯과 같은 줄에서 시작해 **화면 아래까지 내려온다.** 왼쪽이 "누가 가는가"면
   * 오른쪽은 "어디로 가는가"라, 둘이 같은 무게로 서야 브리핑처럼 읽힌다.
   *
   * 강하 개시 버튼이 이 판의 **맨 아래**다. 지시가 내려오는 자리 바로 밑에서 그 지시를
   * 실행하는 것이라, 직업 아이콘 옆에 있을 때보다 무엇을 누르는 것인지가 분명해진다.
   */
  private renderRoomPanel(
    amHost: boolean,
    companionEnabled: boolean,
    me: LobbyPlayer | undefined,
  ): HTMLElement {
    const check = el(
      'button',
      {
        class: `companion-check ${companionEnabled ? 'is-on' : ''}`.trim(),
        type: 'button',
        // 방 설정이라 방장만 바꾼다. 나머지에게는 현재 상태만 보인다.
        disabled: !amHost,
        title: amHost ? '티모시를 데려갈지 정한다' : '방장만 바꿀 수 있다',
        'aria-pressed': companionEnabled ? 'true' : 'false',
      },
      [
        el('span', { class: 'companion-box' }, [companionEnabled ? '■' : '']),
        el('span', { class: 'companion-label' }, ['지원 유닛 TIMOTHY 동행']),
      ],
    );
    if (amHost) {
      check.addEventListener('click', () => {
        this.errorMessage = '';
        this.log(companionEnabled ? '> 지원 유닛 TIMOTHY 해제' : '> 지원 유닛 TIMOTHY 배정');
        this.connection.setCompanion(!companionEnabled);
      });
    }

    return el('div', { class: 'room-panel' }, [
      el('div', { class: 'panel-head' }, [
        el('span', { class: 'panel-head-label' }, ['강하 지점']),
        el('span', { class: 'panel-head-name' }, [DROP_SITE]),
      ]),
      el('div', { class: 'room-panel-art' }),
      check,
      el(
        'div',
        { class: 'system-log scroll-hidden' },
        this.systemLog.map((line) => el('div', { class: 'system-line' }, [line])),
      ),
      this.renderActionButton(amHost, me),
    ]);
  }

  /** 방장은 [시작], 나머지는 [준비] */
  private renderActionButton(amHost: boolean, me: LobbyPlayer | undefined): HTMLElement {
    const hasJob = Boolean(me?.job);

    if (amHost) {
      const button = el(
        'button',
        { class: 'action-button', type: 'button' },
        ['시작'],
      );
      button.addEventListener('click', () => {
        this.errorMessage = '';
        this.log('> 강하 개시 요청 — 전원 상태 확인');
        this.connection.startGame();
      });
      return button;
    }

    const button = el(
      'button',
      {
        class: `action-button ${me?.isReady ? 'is-ready' : ''}`.trim(),
        type: 'button',
        disabled: !hasJob,
      },
      [me?.isReady ? '준비 해제' : '준비'],
    );
    if (hasJob) {
      button.addEventListener('click', () => {
        this.log(me?.isReady ? '> 준비 해제 — 대기 상태로 복귀' : '> 준비 완료 — 강하 대기');
        this.connection.setReady(!me?.isReady);
      });
    }
    return button;
  }

  /**
   * 직업 선택 — 머리글 + 아이콘 네 칸.
   *
   * 이름은 넷 중 하나만 궁금한 정보라, 넷 다 상시로 적어 두는 것보다 **가리키는 것
   * 하나만** 머리글 옆에 보여주는 편이 낫다. 고른 뒤에는 카드에 이름·특성·지급품이
   * 전부 나오므로 여기서 더 설명할 필요도 없다.
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

  /**
   * 채팅. 대기실에서 직업을 나눠 갖는 협의가 실제로 여기서 일어난다.
   *
   * 서버가 검증한 뒤 **자기 자신에게도 broadcast로 되돌아온 것**을 표시한다 — 로컬에서
   * 먼저 찍으면 서버가 거절했을 때(빈 글자 등) 화면에만 남는다. 인게임 채팅(§ChatBox)과
   * 같은 규칙이다.
   */
  private renderChat(): HTMLElement {
    const input = el('input', {
      class: 'chat-input',
      type: 'text',
      maxlength: '120',
      placeholder: '메시지를 입력하고 Enter',
      value: this.chatDraft,
    }) as HTMLInputElement;

    input.addEventListener('input', () => {
      this.chatDraft = input.value;
    });
    input.addEventListener('keydown', (event) => {
      // 대기실은 게임 화면이 아니라 키가 겹치지 않는다 — Enter 하나로 보내고 끝낸다.
      if ((event as KeyboardEvent).key !== 'Enter') return;
      const text = input.value.trim();
      if (!text) return;
      this.connection.sendChat(text);
      input.value = '';
      this.chatDraft = '';
    });

    return el('div', { class: 'chat' }, [
      el('div', { class: 'chat-log scroll-hidden' }),
      input,
    ]);
  }

  /** 채팅 로그만 다시 칠한다(전체 렌더와 분리 — §start의 onChatMessage). */
  private paintChatLog(): void {
    const log = this.root.querySelector<HTMLElement>('.chat-log');
    if (!log) return;

    clear(log);
    for (const line of this.chatLog) {
      log.append(
        el('div', { class: 'chat-line' }, [
          el('span', { class: 'chat-nickname' }, [line.nickname]),
          el('span', { class: 'chat-text' }, [line.text]),
        ]),
      );
    }
    // 새 줄이 아래에 쌓이므로 항상 바닥을 보여준다.
    log.scrollTop = log.scrollHeight;
  }

  private selectJob(job: JobId): void {
    this.errorMessage = '';
    const name = JOBS.find((item) => item.id === job)?.name ?? job;
    this.log(`> 보직 배정: ${name} — 장비 지급 완료`);
    this.connection.selectJob(job);
  }
}
