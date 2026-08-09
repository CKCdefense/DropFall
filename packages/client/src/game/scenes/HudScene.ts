import Phaser from 'phaser';
import type { InventorySlot } from '@dropfall/shared';
import {
  companionData,
  isWithinCoreInteract,
  MAX_CLIENTS_PER_ROOM,
  PICKUP_RADIUS,
  SLOT_COUNT,
  World,
  computeCameraZoom,
} from '@dropfall/shared';
import type {
  GameConnection,
  PlayerView,
  WorldSnapshot,
  WorldStatus,
} from '../../net/GameConnection';
import {
  CHAT_LOG_KEY,
  CONNECTION_KEY,
  CORE_INTERACT_KEY,
  HUD_BLOCK_KEY,
  LOCAL_POSITION_KEY,
} from '../createGame';
import { ChatBox } from '../ui/ChatBox';
import { CinematicOverlay } from '../ui/CinematicOverlay';
import { CoreModal } from '../ui/CoreModal';
import { CharacterModal } from '../ui/CharacterModal';
import { SlotDrag } from '../ui/SlotDrag';
import type { Modal } from '../ui/Modal';
import { DevConsole } from '../ui/DevConsole';
import { DevItemModal } from '../ui/DevItemModal';
import { GuideModal } from '../ui/GuideModal';
import { MINIMAP_SIZE, Minimap } from '../ui/Minimap';
import { PartyPanel } from '../ui/PartyPanel';
import { BOTTOM_BAR_RESERVED, QuickSlotBar } from '../ui/QuickSlotBar';
import { ReviveBanner } from '../ui/ReviveBanner';
import { WaveDial } from '../ui/WaveDial';
import {
  BAR_BOSS,
  BAR_SMALL,
  HUD_BAR_SCALE,
  HudBar,
  ICON_CHECK_OFF,
  ICON_CHECK_ON,
  ICON_ENERGY,
  ICON_RESOURCE,
  ICON_ORB,
  ICON_SKULL,
  ICON_SKULL_LARGE,
  hudIcon,
} from '../ui/hudBar';
import {
  ACCENT,
  BODY_TEXT,
  DIM_TEXT,
  DOWN_COLOR,
  FONT,
  FONT_SMALL,
  PANEL_FILL,
  PANEL_STROKE,
  SIZE_BODY,
  SIZE_SMALL,
  applyTextShadow,
} from '../ui/theme';

/** 코어 피격 시 패널 테두리가 붉게 남아있는 시간(ms). */
const CORE_HIT_PANEL_FLASH_MS = 300;

/**
 * 열린 코어 창이 자동으로 닫히는 거리(px, 코어 발자국 가장자리 기준).
 * 여는 거리(CORE_INTERACT_MARGIN = 32)보다 넉넉해야 경계에서 창이 깜빡이지 않는다.
 */
const CORE_CLOSE_MARGIN = 96;

export const HUD_SCENE_KEY = 'Hud';

/** HUD는 카메라 줌 1(네이티브 해상도)에 그려진다 — 그래서 실제 픽셀 크기를 그대로 쓴다. */
const DIM_STYLE = { fontFamily: FONT, fontSize: `${SIZE_BODY}px`, color: DIM_TEXT } as const;
const SMALL_STYLE = { fontFamily: FONT_SMALL, fontSize: `${SIZE_SMALL}px`, color: DIM_TEXT } as const;
const PAD = 12;
const CORE_PANEL_WIDTH = 220;
/**
 * 패널 제목 줄. Galmuri11에는 굵은 자체(Galmuri11-Bold, weight 700)가 등록돼 있어서
 * fontStyle 'bold'가 실제로 다른 글꼴로 그려진다 — 픽셀 폰트라 획을 인위적으로
 * 두껍게 하면(stroke) 번지므로, 굵은 자체가 있을 때만 쓸 수 있는 방법이다.
 */
const HEAD_STYLE = {
  fontFamily: FONT,
  fontSize: `${SIZE_BODY}px`,
  fontStyle: 'bold',
  color: BODY_TEXT,
} as const;
/**
 * 코어 패널 — 방 이름 한 줄 + 게이지 세 줄(내구도·자원·에너지)이 들어간다.
 *
 * **숫자를 적지 않는다.** 전투 중에 "848 / 1000"을 읽고 판단할 여유는 없다 — 필요한 건
 * "얼마나 남았나"뿐이고 그건 막대 길이가 더 빨리 말해준다. 정확한 수치는 코어 창([E])의
 * 코어 탭에서 본다. 창고에 쌓인 나무·돌·부품 개수도 같은 이유로 여기서 뺐다.
 *
 * 높이는 **오른쪽 미니맵과 맞춘다**(MINIMAP_SIZE). 화면 위쪽 양 끝의 두 판이 같은 선에서
 * 끝나야 HUD가 정돈돼 보이고, 남는 세로 공간만큼 게이지와 표식을 크게 그릴 수 있다.
 */
const CORE_PANEL_HEIGHT = MINIMAP_SIZE;
/**
 * 코어 패널 안 요소들의 확대 배수. 패널이 미니맵 높이(168)만큼 커져서 남는 공간을
 * 픽셀 굵기에 쓴다 — 다른 게이지(2배)보다 한 단계 더 굵다.
 */
const CORE_PANEL_SCALE = 3;
/** 게이지 세 줄의 표식 크기(원본 px)와 줄 간격(화면 px). */
const CORE_ICON_SIZE = 12;
const CORE_ROW_GAP = 14;
/**
 * 게이지 색은 코어 창의 코어 탭(CorePanel)과 **같은 값**을 쓴다 — 같은 값을 두 곳에서
 * 다른 색으로 보여주면 둘이 다른 것으로 읽힌다.
 *
 * 내구도를 체력처럼 barColor(초록↔빨강)로 두지 않는 이유: 세 막대가 세로로 붙어 있어서
 * 자원(초록)과 색이 겹치면 어느 줄인지 헷갈린다. 코어가 맞고 있다는 신호는 색이 아니라
 * **패널 테두리 붉은 펄스**(flashCorePanel)가 이미 더 강하게 준다.
 */
const CORE_HP_COLOR = 0xd9756b;
const CORE_RESOURCE_COLOR = 0x6fd08c;
const CORE_ENERGY_COLOR = 0x5cc6e8;
/**
 * 코어 패널 아래에 붙는 판. **낮과 밤에 다른 것을 보여준다** — 자리는 하나만 쓰고
 * 내용을 갈아 끼운다. 둘 다 "지금 이 페이즈가 언제 끝나는가"에 대한 답이라 같은
 * 자리에 있는 편이 눈이 덜 움직인다.
 *
 * - 밤: 해골 + `남은/전체` 잡몹 수. 코어 게이지와 달리 **숫자를 적는다** — 다음 행동을
 *   가르는 값이라(더 사냥할지 코어로 돌아갈지) 대략이 아니라 정확히 알아야 한다.
 * - 낮: 스킵 투표 칸을 인원수만큼. 판을 누르면 곧 내 표가 들어간다([V]와 같은 동작).
 */
const STATUS_PANEL_HEIGHT = 62;
const STATUS_PANEL_GAP = 8;
/** 투표 칸 사이 간격(화면 px). 칸 자체는 12px 원본 × HUD_BAR_SCALE = 24px다. */
const VOTE_BOX_GAP = 6;
/** 미니맵 왼쪽에 붙는 조작법(?) 버튼 크기와 미니맵과의 간격(화면 px). */
const GUIDE_BUTTON_SIZE = 28;
const GUIDE_BUTTON_GAP = 8;
/** 호버 강조 테두리. ACCENT는 글자용 문자열이라 도형에는 같은 색의 숫자 값을 쓴다. */
const GUIDE_BUTTON_HOVER = 0x6fd08c;
/**
 * 콜로니 증가분(`+N`) 색. 잡몹 숫자보다 **진한 경고색**이다 — 정원과 나란히 붙어 있어
 * 같은 톤이면 한 숫자로 읽히고, 이건 "내가 안 치운 콜로니 때문에 늘어난 몫"이라
 * 눈에 걸려야 하는 값이다.
 */
const MONSTER_BONUS_COLOR = '#ff6b5e';
/** 자기 체력 바 — 퀵슬롯 바로 위에 붙인다. */
/**
 * 보스 HP바(상단 중앙, 웨이브 다이얼 아래) 규격.
 *
 * 보스전은 밤의 마지막 국면이고 이 바가 그 국면의 전부다 — 코어·팀원 게이지와 같은
 * 얇은 띠로 두면 "그냥 또 하나의 몹"으로 읽힌다. 그래서 **화면 중앙 상단의 주역**이
 * 되도록 전용 그림(BAR_BOSS: 양끝 강철 캡 + 크림슨 젬)을 쓰고, 아래 세 값으로
 * 다른 게이지보다 확실히 크게 잡는다.
 *
 * 폭을 고정값이 아니라 **화면 폭 비율**로 잡는 이유: 1920 화면에서 260px는 13%뿐이라
 * 상단에 떠 있는 잡다한 표시 중 하나로 묻혔다. 상한을 같이 두는 건 초광폭 모니터에서
 * 바가 화면을 가로지르지 않게 하기 위해서다.
 */
const BOSS_BAR_WIDTH_RATIO = 0.38;
const BOSS_BAR_MAX_WIDTH = 660;
const BOSS_BAR_HEIGHT = BAR_BOSS.height;
/**
 * 보스 바만 UI 배율에 한 번 더 곱하는 확대 배수.
 *
 * 픽셀아트는 **정수배로만** 키운다 — 1.5배는 픽셀이 뭉개진다. 1배로 두면 강철 브래킷과
 * 크림슨 젬이 1px이라 큰 화면에서 아예 안 보였다. 배수를 올릴수록 픽셀이 굵어져
 * "픽셀아트로 그린 보스 바"라는 게 살아난다(2배 = 1920 화면에서 660×40).
 */
const BOSS_BAR_SCALE = 2;
/** 보스 체력은 색으로 상태를 알리지 않는다 — 처음부터 끝까지 위협적인 크림슨이다. */
const BOSS_BAR_COLOR = 0xd94f4f;
/** 보스 타입(monsters.json 키) → 표시 이름. 아직 데이터에 이름 필드가 없어 클라이언트 표만 둔다. */
const BOSS_NAME: Record<string, string> = {
  boss_demon: '악마 군주',
  boss_knight: '흑기사',
  boss_golem: '화염 골렘',
  boss_dark_knight: '심연의 흑기사',
};

/**
 * HUD. GameScene과 분리된 별도 Scene이다 —
 * GameScene의 카메라는 플레이어를 따라 줌/이동하지만 HUD는 화면에 고정되고
 * 줌의 영향을 받지 않아야 한다. (docs/frontend/01-client-architecture.md §2.3)
 *
 * 배치는 와이어프레임을 따른다:
 *   좌상단 = 코어 HP · 상단 중앙 = 웨이브/시간 다이얼 · 우상단 = 미니맵
 *   좌측 세로 = 팀원 체력 · 하단 중앙 = 퀵슬롯
 *
 * 각 구역은 ui/ 아래 독립 컴포넌트로 뺐다. HudScene은 배치와 데이터 전달만 한다 —
 * 한 파일에 다 넣으면 레이아웃 계산과 그리기 로직이 뒤엉켜 손대기 어려워진다.
 */
export class HudScene extends Phaser.Scene {
  private connection!: GameConnection;

  private corePanel!: Phaser.GameObjects.Rectangle;
  /**
   * 코어 현황 세 줄 — 내구도 / 자원 / 에너지. 표식(아이콘) + 막대만 있고 숫자는 없다.
   * 순서가 곧 급한 순서다: 코어가 부서지면 끝이고, 자원이 없으면 못 짓고, 에너지는
   * 그다음이다.
   */
  private coreRows!: { icon: Phaser.GameObjects.Image | null; bar: HudBar; color: number }[];
  /** 코어 패널 아래 판. 낮에는 스킵 투표 칸, 밤에는 남은 잡몹 수를 보여준다. */
  private statusPanel!: Phaser.GameObjects.Rectangle;
  private monsterIcon!: Phaser.GameObjects.Image | null;
  private monsterText!: Phaser.GameObjects.Text;
  /** 낮 스킵 투표 칸. 방 정원만큼 미리 만들어 두고 인원수에 맞춰 보이고 숨긴다. */
  private voteBoxes!: Phaser.GameObjects.Image[];
  private voteHint!: Phaser.GameObjects.Text;
  /** 상황 판 제목. 낮/밤에 글자만 바뀐다. */
  private statusHeadText!: Phaser.GameObjects.Text;
  /**
   * 콜로니 때문에 늘어난 마릿수(`+N`). 정원 숫자 **오른쪽에 따로 붙는다** —
   * 정원에 더해 버리면 콜로니를 방치한 대가가 얼마인지 안 보인다.
   */
  private monsterBonusText!: Phaser.GameObjects.Text;
  /** 직전 스냅샷의 코어 체력. 줄어든 순간에만 패널 테두리를 붉게 펄스한다 — 코어가
   * 화면 밖(카메라 밖)이거나 몬스터에 가려도 "지금 맞고 있다"가 항상 보이게 하는
   * 용도다(월드 쪽 연출은 EntityRenderer.playCoreHit 참고). */
  private lastCoreHp: number | null = null;
  /** 진행 중인 코어 패널 테두리 복구 타이머 — 연속으로 맞으면 새 타이머가 이전 걸 대체한다. */
  private corePanelFlashTimer?: Phaser.Time.TimerEvent;

  private waveDial!: WaveDial;
  private minimap!: Minimap;
  private party!: PartyPanel;
  private quickSlots!: QuickSlotBar;
  /** 쓰러졌을 때 하단 바 위에 뜨는 안내(HELP! + 남은 시간 + 구조 진행도). */
  private reviveBanner!: ReviveBanner;

  private ammoText!: Phaser.GameObjects.Text;

  /** 보스 레이드 표시 — 보스가 살아있는 동안만 보인다. */
  private bossBar!: HudBar;
  private bossIcon!: Phaser.GameObjects.Image | null;
  private bossNameText!: Phaser.GameObjects.Text;
  /** 보스 이름표의 중심/아랫선(화면 좌표). 해골 아이콘을 글자 옆에 붙일 때 쓴다. */
  private bossNameCenter = 0;
  private bossNameBaseline = 0;
  /**
   * 보스 바에 실제로 적용된 배율(uiScale × BOSS_BAR_SCALE).
   * 채움을 갱신할 때 레이아웃과 **같은 값**을 넘겨야 한다 — uiScale을 넘기면 채움
   * 높이가 틀 높이의 절반이 된다.
   */
  private bossScale = BOSS_BAR_SCALE;
  private bossWarnText!: Phaser.GameObjects.Text;
  /** 직전 프레임에 보인 보스 몬스터 id. 새 보스 등장(경고 연출) 감지용. */
  private lastBossId: string | undefined;
  /** 패널 제목. 굵은 자체로 그려 무슨 판인지 먼저 읽히게 한다. */
  private coreHeadText!: Phaser.GameObjects.Text;

  /**
   * 코어 AI 페르소나 대사 토스트 — 웨이브 다이얼 아래에서 잠깐 떴다 사라진다.
   * CoreModal을 안 열어도 보이게 하려고 추가했다(모달 안 대사는 그대로 유지 —
   * 나중에 다시 열어서 확인할 수 있게).
   */
  private aiToastText!: Phaser.GameObjects.Text;
  /** 로컬 모드에서만 존재한다 — connection.debugJumpToWave가 없으면 아예 안 만든다. */
  private debugJumpButton?: Phaser.GameObjects.Text;
  /** 패널 배경 없이 지형 위에 바로 얹히는 글자들. 그림자를 넣어 대비를 준다. */
  private looseTexts: Phaser.GameObjects.Text[] = [];
  /** 바 너비를 다시 계산할 때 필요해서 보관한다. */
  private uiScale = 1;

  /** 조작법 창과 그걸 여는 미니맵 옆 `?` 버튼. */
  private guideModal!: GuideModal;
  private guideButton!: Phaser.GameObjects.Rectangle;
  private guideButtonLabel!: Phaser.GameObjects.Text;

  // 코어 허브 창 — 코어 앞에서 [E]로 열고, 안에서 탭(코어/제작/상점/창고)으로 오간다.
  private coreModal!: CoreModal;
  private slotDrag!: SlotDrag;
  /** 최신 스냅샷의 내 슬롯/창고. 드래그가 "빈 칸인지"를 물어볼 때 쓴다. */
  private latestInventory: (InventorySlot | null)[] = [];
  private latestStorage: (InventorySlot | null)[] = [];
  private latestCharge: (InventorySlot | null)[] = [];
  private latestCraftOutput: InventorySlot | null = null;

  /** 화면 연출(암전·DAY N·경고·클리어). */
  private cinematic!: CinematicOverlay;
  /** 직전 스냅샷의 페이즈와 웨이브 — 아침이 "언제 왔는지"는 전이로만 알 수 있다. */
  private lastPhase = '';
  private lastWave = -1;
  /** 코어 상호작용 반경 안에 있는지. update가 매 프레임 갱신한다. */
  private nearCore = false;
  /** 주울 수 있는 드롭이 발밑에 있는지. 코어 앞에서 E가 무엇을 할지 가른다. */
  private dropInReach = false;
  /** 티모시 상호작용 반경(companionData.interactRange) 안에 있는지. */
  private nearCompanion = false;
  /** 코어 티어업만 아직 별도 창이다(탭 넷에 들어가지 않는다). */
  /** 캐릭터 정보(직업·스탯·스킬). 하단 바의 직업/스탯 버튼으로 연다. */
  private characterModal!: CharacterModal;
  /**
   * 개발 모드 전용. 프로덕션 빌드에서는 아예 만들어지지 않는다 —
   * `isDevBuild()` 참고.
   */
  private devConsole?: DevConsole;
  private devItemModal?: DevItemModal;
  private chatBox!: ChatBox;

  constructor() {
    super(HUD_SCENE_KEY);
  }

  init(): void {
    this.connection = this.registry.get(CONNECTION_KEY) as GameConnection;
  }

  create(): void {
    // 방 코드는 화면에 안 띄우지만 미니맵이 지형 시드로 쓴다(§this.minimap).
    const { roomCode } = this.connection.roomInfo;

    // 좌상단 — 코어 현황
    //
    // 방 이름·코드·오프라인 표시는 뺐다. 게임 중에는 쓸 일이 없는 접속 정보라
    // 매 순간 봐야 하는 코어 상태와 같은 판에 있으면 눈이 먼저 그쪽으로 간다
    // (방 코드는 대기실에서 확인한다).
    this.corePanel = panelBox(this, CORE_PANEL_WIDTH, CORE_PANEL_HEIGHT);
    this.coreHeadText = this.add.text(0, 0, '코어 상태', HEAD_STYLE);
    // 막대를 먼저, 표식을 나중에 만든다 — 나중에 만든 쪽이 위에 그려진다.
    this.coreRows = [
      { frame: ICON_ORB, color: CORE_HP_COLOR },
      { frame: ICON_RESOURCE, color: CORE_RESOURCE_COLOR },
      { frame: ICON_ENERGY, color: CORE_ENERGY_COLOR },
    ].map(({ frame, color }) => {
      const bar = new HudBar(this, BAR_SMALL);
      return { bar, icon: hudIcon(this, frame), color };
    });

    // 코어 패널 아래 — 낮/밤에 내용이 바뀌는 판
    this.statusPanel = panelBox(this, CORE_PANEL_WIDTH, STATUS_PANEL_HEIGHT).setVisible(false);
    // 판 전체가 투표 버튼이다. 24px짜리 칸 하나하나를 노리게 하면 너무 작다.
    this.statusPanel.setInteractive({ useHandCursor: true });
    this.statusPanel.on('pointerdown', () => this.connection.voteSkipDay());
    this.statusHeadText = this.add.text(0, 0, '', HEAD_STYLE).setVisible(false);
    this.monsterIcon = hudIcon(this, ICON_SKULL)?.setVisible(false) ?? null;
    this.monsterText = this.add
      .text(0, 0, '', { fontFamily: FONT, fontSize: `${SIZE_BODY}px`, color: '#f2b8b8' })
      .setOrigin(0, 0.5)
      .setVisible(false);
    this.voteBoxes = Array.from({ length: MAX_CLIENTS_PER_ROOM }, () => {
      const box = hudIcon(this, ICON_CHECK_OFF);
      box?.setVisible(false);
      return box;
    }).filter((box): box is Phaser.GameObjects.Image => box !== null);
    // 칸 오른쪽 끝에 붙는 단축키 안내. 칸 넷이 다 차면 남는 폭이 60px 남짓이라
    // 긴 문구는 판 밖으로 넘친다 — 무엇을 하는 판인지는 체크 칸이 이미 말해 준다.
    this.monsterBonusText = this.add
      .text(0, 0, '', { fontFamily: FONT, fontSize: `${SIZE_BODY}px`, color: MONSTER_BONUS_COLOR })
      .setOrigin(0, 0.5)
      .setVisible(false);
    this.voteHint = this.add.text(0, 0, '[V]', SMALL_STYLE).setOrigin(1, 0.5).setVisible(false);

    // 상단 중앙 원형 — 웨이브 번호 + 남은 시간
    this.waveDial = new WaveDial(this);

    // 보스 레이드 바 — 잡몹을 전멸시키면 보스가 나오고, 이 바가 남은 밤의 전부다.
    this.bossBar = new HudBar(this, BAR_BOSS);
    this.bossBar.setVisible(false);
    this.bossIcon = hudIcon(this, ICON_SKULL_LARGE)?.setVisible(false) ?? null;
    this.bossNameText = this.add
      .text(0, 0, '', { fontFamily: FONT, fontSize: `${SIZE_BODY}px`, color: '#f2b8b8' })
      .setOrigin(0.5, 1)
      .setVisible(false);
    applyTextShadow(this.bossNameText);
    this.bossWarnText = this.add
      .text(0, 0, '보스 출현!', { fontFamily: FONT, fontSize: `${SIZE_BODY + 4}px`, color: '#ff6b5e' })
      .setOrigin(0.5, 0.5)
      .setAlpha(0);
    applyTextShadow(this.bossWarnText);
    // 우상단 사각형 — 미니맵
    // 지형은 시드에서 결정된다 — 서버가 방 코드로 지형을 정하므로 같은 값을 넘긴다.
    this.minimap = new Minimap(this, roomCode);
    // 좌측 세로 — 팀원(나를 제외한 인원) 체력
    this.party = new PartyPanel(this, MAX_CLIENTS_PER_ROOM - 1);
    // 하단 중앙 — 퀵슬롯
    this.quickSlots = new QuickSlotBar(this, SLOT_COUNT);
    // 창(모달)보다는 아래, 나머지 HUD보다는 위 — 창을 연 채로 쓰러져도 안내가 창을 덮지 않는다.
    this.reviveBanner = new ReviveBanner(this, 5000);


    // 탄약은 체력 바 오른쪽 끝에 붙인다 — 쏘는 동안 눈이 화면 아래 중앙을 벗어나지 않게.
    this.ammoText = this.add.text(0, 0, '', DIM_STYLE).setOrigin(1, 1);

    this.aiToastText = this.add
      .text(0, 0, '', { fontFamily: FONT, fontSize: `${SIZE_BODY}px`, color: ACCENT, align: 'center' })
      .setOrigin(0.5, 0)
      .setAlpha(0);

    // 로컬 모드 전용 테스트 버튼 — 웨이브 5(보스 웨이브)로 바로 점프해서 밸런스를
    // 테스트한다(docs/backend/23). 실제 멀티플레이(ColyseusConnection)에는
    // debugJumpToWave 자체가 없으니, 존재 여부만 확인하면 자연히 로컬 전용이 된다.
    if (this.connection.debugJumpToWave) {
      this.debugJumpButton = this.add
        .text(0, 0, '[TEST] WAVE 5', {
          fontFamily: FONT_SMALL,
          fontSize: `${SIZE_SMALL}px`,
          color: '#1c1f26',
          backgroundColor: ACCENT,
          padding: { x: 6, y: 3 },
        })
        .setOrigin(0, 0)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.connection.debugJumpToWave?.(5));
    }

    this.createCoreModals();
    this.createChat();
    if (isDevBuild()) this.createDevTools();

    // 패널 밖에 떠 있는 글자는 지형 위에 그대로 얹혀서 대비가 필요하다.
    // 패널 안 글자(코어, 퀵슬롯, 팀원)는 어두운 상자가 이미 받쳐주므로 놔둔다.
    this.looseTexts = [this.aiToastText];

    this.layout();
    this.cinematic = new CinematicOverlay(this);
    // 게임에 들어서는 순간 한 번 — 검게 덮었다가 다시 열린다.
    this.cinematic.playIntro();

    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
    });
  }

  /**
   * 코어 상호작용 모달 4종을 만들고 배선한다(docs/frontend/09) — [E]로 허브(코어)
   * 모달을 열고, 거기 있는 4개 버튼 중 3개가 각각 다른 모달로 넘어간다. "창고"는
   * 아직 모달 자체가 없어서(와이어프레임에 잘려 있었다) 우선 로그만 남긴다 —
   * 실제 코어 근접 판정이나 데이터 연결은 다음 작업이다.
   */
  private createCoreModals(): void {
    this.coreModal = new CoreModal(this);
    // 대사는 화면 위 토스트로만 흘린다. 예전엔 코어 창에도 같은 줄을 띄웠는데,
    // "특별한 것 없다" 같은 말이 창을 열 때마다 자리를 차지하고 있었다 —
    // 지나가는 말은 지나가게 두는 편이 맞다.
    this.connection.onCoreCommentary((text) => this.showAiToast(text));
    this.characterModal = new CharacterModal(this);

    // 조작법 창 + 미니맵 왼쪽의 `?` 버튼.
    //
    // 키 안내를 화면 아래 한 줄로만 흘려 두면 글자가 작아 아무도 안 읽고, 그렇다고
    // 늘 띄워 두면 시야를 먹는다. 필요할 때만 여는 창이 맞고, 그 창을 여는 손잡이는
    // "도움말은 물음표"라는 관습을 그대로 쓴다.
    this.guideModal = new GuideModal(this);
    this.guideButton = this.add
      .rectangle(0, 0, GUIDE_BUTTON_SIZE, GUIDE_BUTTON_SIZE, PANEL_FILL, 0.86)
      .setOrigin(0, 0)
      .setStrokeStyle(1, PANEL_STROKE)
      .setInteractive({ useHandCursor: true });
    this.guideButtonLabel = this.add
      .text(0, 0, '?', {
        fontFamily: FONT,
        fontSize: `${SIZE_BODY}px`,
        fontStyle: 'bold',
        color: ACCENT,
      })
      .setOrigin(0.5, 0.5);
    this.guideButton.on('pointerover', () => this.guideButton.setStrokeStyle(2, GUIDE_BUTTON_HOVER));
    this.guideButton.on('pointerout', () => this.guideButton.setStrokeStyle(1, PANEL_STROKE));
    this.guideButton.on('pointerdown', () => {
      if (this.guideModal.isOpen()) this.guideModal.close();
      else this.guideModal.open();
    });
    // 하단 바의 직업/스탯 칸이 이 창을 연다 — 스탯을 보는 곳이 한 군데여야 한다.
    this.quickSlots.onProfile = () => {
      if (this.characterModal.isOpen()) this.characterModal.close();
      else this.characterModal.open();
    };

    // 창고 격자와 하단 퀵슬롯을 **하나의 드래그 공간**으로 묶는다. 둘은 별개 UI지만
    // 아이템이 그 사이를 오가야 해서, 드래그 로직을 모달이 아니라 공용 컨트롤러에 둔다.
    this.slotDrag = new SlotDrag(this);
    // 집은 채 탭 위에 올리면 그 탭으로 넘어간다(Modal.isDragActive) — 창고에서 집은
    // 재료를 코어 충전 칸에 바로 가져갈 수 있다.
    this.coreModal.isDragActive = () => this.slotDrag.isDragging();
    this.slotDrag.onMove = (from, fromIndex, to, toIndex) =>
      this.connection.moveItem(from, fromIndex, to, toIndex);
    /*
     * 퀵슬롯을 옮기지 않고 그냥 좌클릭만 하면 그 칸을 손에 든다 — 숫자키(1~4)와
     * 완전히 같은 동작이라 selectSlot을 그대로 재사용한다. 창고 등 다른 칸은
     * "손에 든다"는 개념이 없어 무시한다.
     */
    this.slotDrag.onClickSelect = (container, index) => {
      if (container !== 'inventory') return;
      this.connection.selectSlot(index);
    };
    /*
     * 쉬프트 클릭의 목적지는 **지금 열려 있는 탭**이 정한다. 코어 탭이면 충전 칸,
     * 그 밖에는 예전대로 창고다 — 눈에 보이는 곳으로 가는 게 가장 덜 놀랍다.
     * 태울 수 없는 물건이면 보내지 않고 그 자리에서 거절을 보여준다.
     */
    this.slotDrag.onQuickMove = (container, index) => {
      if (container === 'inventory' && this.coreModal.isCoreTabVisible()) {
        const itemId = this.latestInventory[index]?.itemId;
        if (itemId && !World.canCharge(itemId)) {
          this.coreModal.rejectCharge(0);
          return;
        }
        // 받을 칸이 없으면 서버가 조용히 무시한다 — 왜 안 들어갔는지 화면에서 보이게
        // 한다. 판정 규칙은 World.quickChargeFromInventory와 같다(같은 재료 우선, 없으면 빈 칸).
        const target = itemId === undefined ? -1 : this.findChargeTarget(itemId);
        if (target < 0) {
          this.coreModal.rejectCharge(0);
          return;
        }
        this.connection.quickMoveItem(container, index, 'charge');
        return;
      }
      this.connection.quickMoveItem(container, index);
    };

    // 충전 칸에 못 넣는 물건을 끌어다 놓으면 그 칸이 붉게 깜빡인다.
    this.slotDrag.isRejected = (to, toIndex, itemId) => {
      if (to !== 'charge') return false;
      if (this.coreModal.isChargeSlotOpen(toIndex) && World.canCharge(itemId)) return false;
      this.coreModal.rejectCharge(toIndex);
      return true;
    };
    this.slotDrag.getSlot = (container, index) =>
      (container === 'storage'
        ? this.latestStorage
        : container === 'charge'
          ? this.latestCharge
          : container === 'craft'
            ? [this.latestCraftOutput]
            : this.latestInventory)[index] ?? null;

    for (const cell of this.coreModal.storageCells) {
      // 창고 칸은 **창고 탭이 보일 때만** 살아 있다. 다른 탭에 가려진 칸은 Phaser의
      // box.visible이 그대로 true라(가려진 건 부모 컨테이너다) 탭까지 봐야 한다 —
      // 안 그러면 제작 탭에서 드래그가 보이지도 않는 창고 칸에 떨어진다.
      this.slotDrag.register({
        container: 'storage',
        index: cell.index,
        box: cell.box,
        isActive: () => this.coreModal.isWarehouseVisible(),
      });
    }
    for (const cell of this.coreModal.chargeCells) {
      // 창고 칸과 같은 규칙 — 코어 탭이 보일 때만 드롭을 받는다.
      this.slotDrag.register({
        container: 'charge',
        index: cell.index,
        box: cell.box,
        isActive: () => this.coreModal.isCoreTabVisible(),
      });
    }
    // 폐기 구역 — 창고 탭 아래 휴지통. 창고 칸과 같은 규칙으로 그 탭이 보일 때만 산다.
    this.slotDrag.register({
      container: 'trash',
      index: 0,
      box: this.coreModal.trashCell,
      isActive: () => this.coreModal.isWarehouseVisible(),
    });
    // 제작 결과 칸 — 여기서 인벤토리로 끌어다 꺼낸다(넣는 쪽은 서버가 거절한다).
    this.slotDrag.register({
      container: 'craft',
      index: 0,
      box: this.coreModal.craftOutputCell,
      isActive: () => this.coreModal.isCraftTabVisible(),
    });

    this.quickSlots.cells.forEach((box, index) => {
      this.slotDrag.register({ container: 'inventory', index, box, isActive: () => true });
    });

    // 강화는 코어 탭 안의 큰 버튼이다 — 예전엔 별도 창(UpgradeModal)이었는데,
    // "얼마 모였나"를 보고 "올릴까"를 정하는 사이에 창을 갈아타야 했다.
    this.coreModal.onUpgrade = () => this.connection.upgradeCore();
    this.coreModal.onRepair = () => this.connection.repairCore();
    this.coreModal.onReviveGhost = (targetId: string) => this.connection.reviveGhost(targetId);
    this.characterModal.onSpendPoint = (stat) => this.connection.spendStatPoint(stat);
    this.coreModal.onCraft = (recipeId: string) => this.connection.craft(recipeId);
    this.coreModal.onPurchase = (itemId: string) => this.connection.shopBuy(itemId);
    this.coreModal.onReroll = () => this.connection.rerollShop();
    this.slotDrag.onDiscard = (container, index) => this.connection.discardItem(container, index);
    this.slotDrag.onTrashHover = (armed) => this.coreModal.setTrashArmed(armed);

    // 코어 창을 여는 길은 **코어 앞에서 E** 하나뿐이다(CORE_INTERACT_KEY).
    // 예전엔 F로 맵 어디서나 열렸는데, 창고·제작·상점이 전부 "코어 앞에서 하는 일"이라
    // 서버가 어차피 근접을 다시 검사한다 — 멀리서 열리는 창은 눌러봐야 거절만 돌아와서
    // 조작이 되는 것처럼 보이는 게 오히려 헷갈렸다.

    // 게임 입력이 모달을 뚫고 나가지 않게 한다 — 차단막이 없으니 좌표로 직접 판정한다.
    this.registry.set(HUD_BLOCK_KEY, (x: number, y: number) => {
      if (this.slotDrag.isDragging()) return true;
      // 콘솔/채팅에 타이핑하는 동안 클릭이 공격으로 새면 안 된다.
      if (this.devConsole?.isOpen()) return true;
      if (this.chatBox.isOpen()) return true;
      // 투표 판을 누른 클릭이 월드로 새서 무기까지 휘두르면 안 된다.
      if (this.statusPanel.visible && this.statusPanel.getBounds().contains(x, y)) return true;
      return this.openModals().some((modal) => modal.containsPoint(x, y));
    });

    // GameScene의 E 입력이 이 함수를 먼저 부른다. true를 돌려주면 줍기가 취소된다.
    //
    // **줍기가 항상 우선한다.** 코어는 맵 한가운데라 그 근처에서 죽은 몬스터의 드롭을
    // 밟고 있는 일이 흔한데, 예전엔 코어 반경 안이기만 하면 무조건 모달이 떠서 발밑
    // 아이템을 영영 못 주웠다. E는 "발밑에 뭔가 있으면 줍고,
    // 없을 때만 코어를 연다"로 정리한다.
    this.registry.set(CORE_INTERACT_KEY, () => {
      if (this.anyModalOpen()) {
        this.closeAllModals();
        return true;
      }
      // 줍기가 스페이스로 갈라져 나갔으므로 E는 더 이상 양보하지 않는다 —
      // 드롭을 밟고 선 채로도 코어 창이 곧바로 열린다.
      if (!this.nearCore) {
        if (!this.nearCompanion) return false;
        // 코어 근처가 아니고 티모시 옆이면 대사 트리거. 사거리 판정은 서버가 다시 한다.
        this.connection.companionInteract();
        return true;
      }

      this.coreModal.open();
      // 코어 AI 페르소나 트리거. 서버가 쿨다운을 판단하므로 여기선 그냥 알리기만
      // 한다.
      this.connection.coreInteract();
      return true;
    });
  }

  /**
   * 쉬프트 클릭한 재료가 들어갈 충전 칸. 없으면 -1.
   * 같은 재료가 타고 있으면 거기에 합치고, 없으면 열려 있는 빈 칸을 쓴다 —
   * 서버(World.quickChargeFromInventory)와 **같은 순서**여야 화면과 결과가 어긋나지 않는다.
   */
  private findChargeTarget(itemId: string): number {
    let empty = -1;
    for (let index = 0; index < this.latestCharge.length; index += 1) {
      if (!this.coreModal.isChargeSlotOpen(index)) continue;
      const slot = this.latestCharge[index];
      if (slot?.itemId === itemId) return index;
      if (empty < 0 && !slot) empty = index;
    }
    return empty;
  }

  /**
   * 코어 AI 대사를 웨이브 다이얼 아래에 잠깐 띄운다 — CoreModal을 안 열어도 보이게
   * 하려는 용도다(모달 쪽 대사는 계속 남아 있어 나중에 다시 열어 확인할 수 있다).
   * 대사가 연달아 오면 진행 중인 페이드를 취소하고 새로 띄운다.
   */
  private showAiToast(text: string): void {
    this.tweens.killTweensOf(this.aiToastText);
    this.aiToastText.setText(`"${text}"`).setAlpha(1);
    this.tweens.add({
      targets: this.aiToastText,
      alpha: 0,
      duration: 600,
      delay: 5000,
    });
  }

  /**
   * 플레이어 채팅(Enter로 입력, 하단 로그 패널은 항상 떠 있음). 말풍선은 GameScene의
   * EntityRenderer가 그리므로, 로그 append 함수만 registry로 열어준다
   * (GameScene이 connection.onChatMessage를 구독해 말풍선과 이 로그 둘 다 채운다).
   */
  private createChat(): void {
    this.chatBox = new ChatBox(this, this.connection);
    this.registry.set(CHAT_LOG_KEY, (nickname: string, text: string, variant?: 'player' | 'companion') =>
      this.chatBox.appendLine(nickname, text, variant),
    );
  }

  /**
   * 개발자 콘솔(`)과 아이템 도감(F9)을 붙인다.
   *
   * 둘 다 결국 같은 개발 커맨드로 내려간다 — 규칙이 shared 한 곳에만 있어야
   * 로컬 모드와 멀티플레이가 같은 결과를 낸다.
   */
  private createDevTools(): void {
    this.devConsole = new DevConsole(this, this.connection);

    this.devItemModal = new DevItemModal(this);
    this.devItemModal.onCommand = (line) => this.connection.sendDevCommand(line);

    this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.F9).on('down', () => {
      if (this.devItemModal?.isOpen()) this.devItemModal.close();
      else this.devItemModal?.open();
    });
  }

  /** 화면에 존재하는 창 전부(열려 있는지와 무관). 위치 재계산처럼 전부에 걸 때 쓴다. */
  private allModals(): Modal[] {
    return [
      this.coreModal,
      this.characterModal,
      this.guideModal,
      ...(this.devItemModal ? [this.devItemModal] : []),
    ];
  }

  private openModals(): Modal[] {
    return this.allModals().filter((modal) => modal.isOpen());
  }

  private anyModalOpen(): boolean {
    return this.openModals().length > 0;
  }

  private closeAllModals(): void {
    this.coreModal.close();
    this.characterModal.close();
    this.devItemModal?.close();
  }

  /**
   * 캔버스가 창 크기를 따라가므로 좌표를 매번 다시 계산한다.
   * 월드가 정수배로 확대되는 만큼 UI도 같이 키워야 화면이 따로 놀지 않는다.
   */
  /**
   * 페이즈 전이에 맞춰 큰 문구를 띄운다.
   *
   * **전이로만 판단한다.** 매 프레임 "지금 낮이다"로 띄우면 낮 내내 계속 다시 시작한다 —
   * 아침이 온 그 순간(밤→낮, 또는 게임 시작)에만 한 번이다. 웨이브 번호까지 같이 보는
   * 이유는 낮이 이어지는 동안에도 번호가 바뀔 수 있어서다(개발 커맨드 `wave`).
   */
  private updateCinematic(status: WorldSnapshot['status']): void {
    const phase = status.wavePhase;
    const day = Math.max(1, status.currentWave + (phase === 'day' ? 1 : 0));

    if (phase === 'victory') {
      this.cinematic.showClear();
    } else if (status.bossWarningRemaining > 0) {
      this.cinematic.showWarning();
    } else {
      this.cinematic.hideWarning();
      const morning = phase === 'day' && (this.lastPhase !== 'day' || this.lastWave !== day);
      if (morning) this.cinematic.showDay(day);
    }

    this.lastPhase = phase;
    if (phase === 'day') this.lastWave = day;
  }

  private layout(): void {
    const width = this.scale.width;
    const height = this.scale.height;
    this.cinematic?.layout(width, height);
    // 월드 줌 2~4 → UI 스케일 1~2. **정수만 쓴다** — 픽셀 폰트는 1.5배로 늘리면
    // 글자가 뭉개져서, 어중간하게 큰 것보다 작고 선명한 쪽이 훨씬 잘 읽힌다.
    const scale = Math.min(2, Math.max(1, Math.floor(computeCameraZoom(width, height) / 2)));
    this.uiScale = scale;

    const pad = PAD * scale;

    // --- 좌상단: 코어 패널
    const panelW = CORE_PANEL_WIDTH * scale;
    const panelH = CORE_PANEL_HEIGHT * scale;
    this.corePanel.setSize(panelW, panelH).setPosition(pad, pad);
    this.coreHeadText.setFontSize(SIZE_BODY * scale).setPosition(pad + 10 * scale, pad + 6 * scale);

    // 게이지 세 줄. 각 줄은 [표식][막대]이고, 표식은 막대보다 커서 세로 가운데에 맞춘다
    // (막대 24px, 표식 36px — 원본 8px·12px에 같은 배율이 곱해진 값이다).
    const coreScale = scale * CORE_PANEL_SCALE;
    const rowHeight = BAR_SMALL.height * coreScale;
    const iconSize = CORE_ICON_SIZE * coreScale;
    const rowLeft = pad + 10 * scale;
    const barLeft = rowLeft + iconSize + 8 * scale;
    const barWidth = pad + panelW - 10 * scale - barLeft;
    // 세 줄을 방 이름 아래 남은 공간의 가운데에 몰아 둔다 — 패널이 미니맵 높이라
    // 위에 붙이면 아래가 휑하게 빈다.
    const rowsHeight = rowHeight * 3 + CORE_ROW_GAP * scale * 2;
    const rowsTop = pad + 22 * scale + (panelH - 22 * scale - rowsHeight) / 2;

    this.coreRows.forEach((row, index) => {
      const rowTop = rowsTop + index * (rowHeight + CORE_ROW_GAP * scale);
      row.bar.layout(barLeft, rowTop, barWidth, coreScale);
      row.icon?.setScale(coreScale).setPosition(rowLeft, rowTop + rowHeight / 2);
    });

    // --- 상단 중앙/우상단
    this.waveDial.layout(width / 2, pad, scale);
    this.minimap.layout(width - pad, pad, scale);
    // `?`는 미니맵 **왼쪽**에 붙인다. 오른쪽·위는 화면 끝이고, 아래는 미니맵이 쓴다.
    const guideSize = GUIDE_BUTTON_SIZE * scale;
    const guideX = width - pad - MINIMAP_SIZE * scale - GUIDE_BUTTON_GAP * scale - guideSize;
    this.guideButton.setSize(guideSize, guideSize).setPosition(guideX, pad);
    this.guideButton.input?.hitArea?.setSize(guideSize, guideSize);
    this.guideButtonLabel
      .setFontSize(SIZE_BODY * scale)
      .setPosition(guideX + guideSize / 2, pad + guideSize / 2);

    // 보스 바 — 화면 중앙 상단의 주역. 위에 붙는 이름표도 같은 배율로 커지므로,
    // 다이얼 바닥(pad + 52)에 그 글자 높이(≈ SIZE_BODY × bossScale × 1.4)만큼
    // 더 띄운 자리에 바를 놓는다. 경고 문구는 그대로 화면 중앙 상단 1/3.
    this.bossScale = scale * BOSS_BAR_SCALE;
    const bossScale = this.bossScale;
    const bossBarY = pad + 112 * scale;
    const bossBarW = Math.min(width * BOSS_BAR_WIDTH_RATIO, BOSS_BAR_MAX_WIDTH * scale);
    this.bossNameCenter = width / 2;
    this.bossNameBaseline = bossBarY - 4 * scale;
    // 이름도 바와 같은 배율로 키운다 — 바만 커지면 글자가 붙어 있는 라벨처럼 작아 보인다.
    this.bossNameText
      .setFontSize(SIZE_BODY * bossScale)
      .setPosition(this.bossNameCenter, this.bossNameBaseline);
    this.bossBar.layout(width / 2 - bossBarW / 2, bossBarY, bossBarW, bossScale);
    // 해골은 이름표 왼쪽에 붙는다. 글자 폭이 보스마다 달라서 최종 자리는 이름을 넣은
    // 뒤에 잡는다(placeBossIcon) — 여기서는 배율만 맞춰 둔다.
    this.bossIcon?.setScale(bossScale);
    this.placeBossIcon();
    this.bossWarnText.setFontSize((SIZE_BODY + 4) * scale).setPosition(width / 2, height / 3);

    // 코어 AI 토스트 — 보스 바 아래. 보스전 중에도 겹치지 않게 바 높이만큼 내려 둔다.
    this.aiToastText
      .setFontSize(SIZE_BODY * scale)
      .setWordWrapWidth(220 * scale)
      .setPosition(width / 2, bossBarY + BOSS_BAR_HEIGHT * bossScale + 6 * scale);

    // --- 상황 판: 코어 패널 바로 아래. 낮/밤 내용이 같은 자리를 나눠 쓴다.
    const statusTop = pad + panelH + STATUS_PANEL_GAP * scale;
    const statusH = STATUS_PANEL_HEIGHT * scale;
    const statusScale = scale * HUD_BAR_SCALE;
    // 제목 한 줄이 위에 앉고, 내용은 그 아래 남은 공간의 가운데에 온다.
    const statusHeadBottom = statusTop + 6 * scale + SIZE_BODY * scale;
    const statusMidY = statusHeadBottom + (statusTop + statusH - statusHeadBottom) / 2;
    const statusLeft = pad + 12 * scale;
    this.statusPanel.setSize(panelW, statusH).setPosition(pad, statusTop);
    // setSize는 히트 영역을 갱신하지 않는다 — 배율이 바뀌면 클릭 판정이 어긋난다.
    this.statusPanel.input?.hitArea?.setSize(panelW, statusH);
    this.statusHeadText
      .setFontSize(SIZE_BODY * scale)
      .setPosition(pad + 10 * scale, statusTop + 6 * scale);

    // 밤: 해골 + 남은/전체
    this.monsterIcon?.setScale(statusScale).setPosition(statusLeft, statusMidY);
    this.monsterText
      .setFontSize(SIZE_BODY * statusScale)
      .setPosition(statusLeft + CORE_ICON_SIZE * statusScale + 8 * scale, statusMidY);
    // `+N`은 잡몹 수 글자 오른쪽에 붙는다. 글자 폭이 매번 달라서 자리는 값을 넣은
    // 뒤에 잡는다(updateStatusPanel) — 여기서는 크기와 세로 위치만 맞춰 둔다.
    this.monsterBonusText.setFontSize(SIZE_BODY * scale * HUD_BAR_SCALE).setY(statusMidY);

    // 낮: 투표 칸을 왼쪽부터 늘어놓고, 남는 오른쪽에 안내 글자를 둔다.
    const boxSize = CORE_ICON_SIZE * statusScale;
    this.voteBoxes.forEach((box, index) => {
      box.setScale(statusScale).setPosition(statusLeft + index * (boxSize + VOTE_BOX_GAP * scale), statusMidY);
    });
    this.voteHint
      .setFontSize(SIZE_SMALL * scale)
      .setPosition(pad + panelW - 12 * scale, statusMidY);

    // --- 좌측 세로: 팀원 체력. 몬스터 판 아래에서 시작한다(밤에만 뜨는 판이지만
    // 자리를 항상 비워 둔다 — 밤이 될 때마다 팀원 칸이 아래로 밀리면 눈이 어지럽다).
    this.party.layout(pad, statusTop + statusH + 10 * scale, scale);

    // --- 하단 중앙: 퀵슬롯 + 내 체력 바
    const slotsBottom = height - pad - 20 * scale;
    this.quickSlots.layout(width / 2, slotsBottom, scale);
    // 체력·스태미나 막대 **바로 위**에 쌓는다 — 그 자리가 이미 "내 몸 상태"를 보는 자리다.
    this.reviveBanner.layout(width / 2, this.quickSlots.barsTop, scale);

    // 탄약은 스태미나 막대 오른쪽 위에 붙인다 — 쏘는 동안 눈이 하단 바를 벗어나지 않게.
    this.ammoText
      .setFontSize(SIZE_BODY * scale)
      .setPosition(this.quickSlots.barsRight, this.quickSlots.barsTop - 4 * scale);

    // 창은 **하단 바를 피해** 그 위 공간의 가운데에 놓는다. 안 그러면 큰 창이 퀵슬롯을
    // 덮어서 창고 → 퀵슬롯 드래그가 아예 불가능해진다.
    const reserved = BOTTOM_BAR_RESERVED * scale;
    for (const modal of this.allModals()) modal.recenter(width, height, reserved);

    // --- 나머지
    for (const text of this.looseTexts) applyTextShadow(text, scale);

    if (this.debugJumpButton) {
      this.debugJumpButton.setFontSize(SIZE_SMALL * scale);
      this.debugJumpButton.setPosition(pad, pad + panelH + 10 * scale + this.party.height + 8 * scale);
    }
  }

  update(): void {
    const snapshot = this.connection.getSnapshot();
    const { status } = snapshot;
    const me = snapshot.players.find((player) => player.id === this.connection.sessionId);

    this.updateCore(status, snapshot.players.length);
    this.coreModal.setCoreStatus(status);
    this.coreModal.setChargeSlots(status.coreCharge, status.openChargeSlots);
    // 유령 부활 칸 — 나 자신은 목록에서 뺀다(내가 유령이면 이 창을 열 수 있는
    // 처지가 아니지만, 그 경우에도 굳이 목록에 나를 넣어 보여줄 이유가 없다).
    this.coreModal.setGhosts(
      snapshot.players
        .filter((player) => player.id !== this.connection.sessionId && player.lifeState === 'ghost')
        .map((player) => ({ id: player.id, nickname: player.nickname })),
      status.coreResource,
    );
    this.updateCinematic(status);
    this.waveDial.update(status);
    this.updateBossBar(snapshot);
    // GameScene의 예측 좌표(있으면) — 없으면(로컬 모드 초기 프레임 등) 미니맵이
    // 스냅샷의 보간 좌표로 알아서 폴백한다.
    const localPosition = this.registry.get(LOCAL_POSITION_KEY) as { x: number; y: number } | undefined;
    this.minimap.update(snapshot, this.connection.sessionId, localPosition);
    this.party.update(
      snapshot.players.filter((player) => player.id !== this.connection.sessionId),
      snapshot.players,
      this.connection.sessionId,
    );
    this.latestInventory = me?.slots ?? [];
    this.latestStorage = status.coreStorage;
    this.latestCharge = status.coreCharge;

    this.coreModal.setCraftContext({
      coreTier: status.coreTier,
      job: me?.job ?? '',
      resource: status.coreResource,
      energy: status.coreEnergy,
      craftingId: me?.craftRecipeId ?? '',
      craftRemaining: me?.craftRemaining ?? 0,
      output: me?.craftOutput ?? null,
    });
    this.latestCraftOutput = me?.craftOutput ?? null;
    this.coreModal.setStoreContext(status.shopStock, status.coreEnergy, status.shopRerollCost);
    this.quickSlots.update(me, this.slotDrag.hoverCellOf('inventory'));
    this.reviveBanner.update(me, this.connection.solo);
    this.characterModal.setPlayer(me);
    this.updateAmmo(me);

    // 코어는 항상 원점(0,0). 서버(World.isNearCore)와 같은 함수로 판정해야
    // "E가 안 먹는다"는 어긋남이 안 생긴다 — 코어가 8각 발자국이 되면서 반경
    // 비교로는 같은 결론을 낼 수 없다.
    this.nearCore = me ? isWithinCoreInteract(me.x, me.y) : false;
    // 코어 앞을 떠나면 창을 닫는다. 서버가 어차피 근접을 다시 검사하므로, 열린 채
    // 따라다니면 눌러도 안 되는 버튼만 화면을 가린다.
    //
    // 닫는 경계는 여는 경계보다 **넉넉히 잡는다**(CORE_CLOSE_MARGIN). 같은 선을 쓰면
    // 경계에 서서 조금만 움직여도 창이 깜빡이며 열렸다 닫힌다.
    if (this.coreModal.isOpen() && me && !isWithinCoreInteract(me.x, me.y, CORE_CLOSE_MARGIN)) {
      this.coreModal.close();
    }
    this.dropInReach = me
      ? snapshot.droppedItems.some(
          (drop) => Math.hypot(drop.x - me.x, drop.y - me.y) <= PICKUP_RADIUS,
        )
      : false;
    // 티모시가 없는 방에서는 상호작용 안내도 뜨면 안 된다 — 누를 대상이 없다.
    this.nearCompanion =
      me && snapshot.companion.state !== 'absent'
        ? Math.hypot(snapshot.companion.x - me.x, snapshot.companion.y - me.y) <=
          companionData.interactRange
        : false;
    if (this.coreModal.isOpen()) this.coreModal.setStorageSlots(status.coreStorage);
  }

  /**
   * 코어 현황 세 줄을 채운다. 순서는 coreRows를 만든 순서(내구도·자원·에너지)와 같다.
   * 숫자는 적지 않는다 — 정확한 값은 코어 창의 코어 탭에서 본다(CORE_PANEL_HEIGHT 주석).
   */
  private updateCore(status: WorldStatus, playerCount: number): void {
    const coreScale = this.uiScale * CORE_PANEL_SCALE;
    const values: [number, number][] = [
      [status.coreHp, status.coreMaxHp],
      [status.coreResource, status.coreMaxResource],
      [status.coreEnergy, status.coreMaxEnergy],
    ];

    this.coreRows.forEach((row, index) => {
      const [value, max] = values[index];
      // 개발 커맨드로 최대치를 넘길 수 있어서 위쪽도 조인다(팀원 체력과 같은 이유).
      row.bar.setValue(max > 0 ? Math.min(1, Math.max(0, value) / max) : 0, row.color, coreScale);
    });

    // 체력이 줄었다 = 맞았다(플레이어/몬스터 피격과 같은 추론, 스냅샷엔 타격
    // 이벤트가 따로 없다). 처음 받은 값은 기준점으로만 쓴다.
    if (this.lastCoreHp !== null && status.coreHp < this.lastCoreHp) this.flashCorePanel();
    this.lastCoreHp = status.coreHp;

    this.updateStatusPanel(status, playerCount);
  }

  /**
   * 코어 패널 아래 판을 페이즈에 맞춰 채운다. 낮이면 스킵 투표 칸, 밤이면 남은 잡몹 수다.
   * 승패가 갈린 뒤에는 둘 다 의미가 없어서 판째로 숨는다.
   *
   * 잡몹을 다 잡고 보스만 남은 구간에서는 0/N이 되는데, 그때는 화면 중앙의 보스
   * 체력바가 진행도를 맡으므로 이 판은 그대로 0을 보여주면 된다.
   */
  private updateStatusPanel(status: WorldStatus, playerCount: number): void {
    const isDay = status.wavePhase === 'day';
    const isNight = status.wavePhase === 'night';
    this.statusPanel.setVisible(isDay || isNight);
    // 투표는 낮에만 받는다(World.castSkipVote도 낮이 아니면 무시한다) — 밤에 손가락
    // 커서가 뜨면 누를 수 있는 것처럼 보인다.
    if (isDay) this.statusPanel.setInteractive({ useHandCursor: true });
    else this.statusPanel.disableInteractive();

    this.monsterIcon?.setVisible(isNight);
    this.monsterText.setVisible(isNight);
    if (isNight) {
      this.monsterText.setText(`${status.waveMonsterRemaining} / ${status.waveMonsterTotal}`);
    }

    // 칸 수는 **접속 인원**이다 — 스킵은 만장일치라 분모가 곧 인원수다
    // (World.castSkipVote의 `skipVotes.size >= players.size`와 같은 기준).
    this.voteHint.setVisible(isDay);
    this.voteBoxes.forEach((box, index) => {
      const inUse = isDay && index < playerCount;
      box.setVisible(inUse);
      if (inUse) {
        box.setFrame(index < status.skipVoteCount ? ICON_CHECK_ON : ICON_CHECK_OFF);
      }
    });
  }

  /**
   * 코어 패널 테두리를 붉게 펄스한다 — 카메라가 코어에서 멀리 있거나 몬스터에
   * 가려도(§EntityRenderer.updateCoreBlindZone) 이 HUD 패널은 항상 화면에 있어서
   * "지금 코어가 맞고 있다"를 놓칠 수 없게 한다.
   */
  private flashCorePanel(): void {
    // strokeColor는 숫자 하나가 아니라 색상+두께 조합이라 트윈으로 보간할 수 없다 —
    // 즉시 붉게 바꾸고, 잠시 후 타이머로 원래 테두리로 되돌린다.
    this.corePanel.setStrokeStyle(3, 0xff3b3b);
    if (this.corePanelFlashTimer) this.corePanelFlashTimer.remove();
    this.corePanelFlashTimer = this.time.delayedCall(CORE_HIT_PANEL_FLASH_MS, () => {
      this.corePanel.setStrokeStyle(1, PANEL_STROKE);
    });
  }

  /**
   * 탄약 표시. 근접·맨손이면(탄창 0) 아예 감춘다 — 늘 "—"가 떠 있으면 화면만 시끄럽다.
   * 재장전 중에는 남은 시간을 보여준다: 언제 다시 쏠 수 있는지가 그 순간 가장 궁금하다.
   */
  private updateAmmo(me: PlayerView | undefined): void {
    if (!me || me.ammoMagazine <= 0) {
      this.ammoText.setVisible(false);
      return;
    }

    this.ammoText.setVisible(true);
    if (me.reloadRemaining > 0) {
      this.ammoText.setText(`재장전 ${me.reloadRemaining.toFixed(1)}s`);
      this.ammoText.setColor(DOWN_COLOR);
      return;
    }

    const mode = me.burstMode ? ' 점사' : '';
    this.ammoText.setText(`${me.ammo} / ${me.ammoMagazine}${mode}`);
    this.ammoText.setColor(me.ammo === 0 ? DOWN_COLOR : DIM_TEXT);
  }


  /**
   * 보스 레이드 표시. 서버가 따로 알려주지 않아도 스냅샷의 몬스터 타입(boss_ 접두사)만
   * 보면 로컬/원격 어느 모드에서든 같은 로직으로 동작한다 — 별도 동기화 필드가 없다.
   */
  private updateBossBar(snapshot: WorldSnapshot): void {
    const boss = snapshot.monsters.find((monster) => monster.type.startsWith('boss_'));

    const visible = boss !== undefined;
    this.bossBar.setVisible(visible);
    this.bossIcon?.setVisible(visible);
    this.bossNameText.setVisible(visible);

    if (!boss) {
      this.lastBossId = undefined;
      return;
    }

    // 처음 나타난 보스면 경고 연출 — 번쩍 떠올랐다가 서서히 사라진다.
    if (boss.id !== this.lastBossId) {
      this.lastBossId = boss.id;
      this.bossWarnText.setText(`${BOSS_NAME[boss.type] ?? '보스'} 출현!`);
      this.bossWarnText.setAlpha(1);
      this.tweens.add({
        targets: this.bossWarnText,
        alpha: 0,
        delay: 1800,
        duration: 700,
      });
    }

    this.bossNameText.setText(BOSS_NAME[boss.type] ?? '보스');
    this.placeBossIcon();
    const ratio = boss.maxHp > 0 ? Math.max(0, boss.hp / boss.maxHp) : 0;
    this.bossBar.setValue(ratio, BOSS_BAR_COLOR, this.bossScale);
  }

  /**
   * 보스 이름표 왼쪽에 해골을 붙인다. 이름표가 가운데 정렬이라 글자 폭이 바뀌면
   * 왼쪽 끝도 같이 움직인다 — 그래서 이름을 넣은 **뒤에** 부른다.
   */
  private placeBossIcon(): void {
    const icon = this.bossIcon;
    if (!icon) return;
    const left = this.bossNameCenter - this.bossNameText.width / 2;
    // 아이콘은 origin(0, 0.5)라 세로는 이름표 중간에 맞춘다(이름표는 origin y=1).
    icon.setPosition(
      left - icon.displayWidth - 4 * this.bossScale,
      this.bossNameBaseline - this.bossNameText.height / 2,
    );
  }

}

/**
 * 개발 도구를 붙일지. Vite 개발 서버이거나 URL에 `?dev=1`이 있을 때만 켠다 —
 * 배포본에서 실수로 치트가 노출되지 않게 기본은 꺼짐이고, 켜더라도 실제 적용은
 * 서버가 다시 판단한다(GameRoom의 DEV_MODE).
 */
function isDevBuild(): boolean {
  if (import.meta.env.DEV) return true;
  return new URLSearchParams(window.location.search).get('dev') === '1';
}


/** 와이어프레임의 테두리 상자. HUD 전 구역이 같은 모양을 쓴다. */
function panelBox(
  scene: Phaser.Scene,
  width: number,
  height: number,
): Phaser.GameObjects.Rectangle {
  return scene.add
    .rectangle(0, 0, width, height, PANEL_FILL, 0.82)
    .setOrigin(0, 0)
    .setStrokeStyle(1, PANEL_STROKE);
}
