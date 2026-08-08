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
import type { GameConnection, PlayerView, WorldSnapshot } from '../../net/GameConnection';
import {
  CHAT_LOG_KEY,
  CONNECTION_KEY,
  CORE_INTERACT_KEY,
  HUD_BLOCK_KEY,
  INPUT_CONTROLLER_KEY,
  LOCAL_POSITION_KEY,
} from '../createGame';
import type { InputController } from '../input/InputController';
import { ChatBox } from '../ui/ChatBox';
import { CoreModal } from '../ui/CoreModal';
import { CharacterModal } from '../ui/CharacterModal';
import { SlotDrag } from '../ui/SlotDrag';
import type { Modal } from '../ui/Modal';
import { DevConsole } from '../ui/DevConsole';
import { DevItemModal } from '../ui/DevItemModal';
import { Minimap } from '../ui/Minimap';
import { PartyPanel } from '../ui/PartyPanel';
import { BOTTOM_BAR_RESERVED, QuickSlotBar } from '../ui/QuickSlotBar';
import { WaveDial } from '../ui/WaveDial';
import {
  BAR_BOSS,
  BAR_SMALL,
  HudBar,
  ICON_CORE,
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
  barColor,
} from '../ui/theme';

/** 코어 피격 시 패널 테두리가 붉게 남아있는 시간(ms). */
const CORE_HIT_PANEL_FLASH_MS = 300;

/** 건축모드 표시용 한글 이름. InputController의 BUILD_MODES 값과 짝을 맞춘다. */
const BUILD_MODE_LABEL: Record<string, string> = {
  off: '꺼짐',
  fence: '울타리',
  wall: '벽',
  demolish: '철거',
};

export const HUD_SCENE_KEY = 'Hud';

/** HUD는 카메라 줌 1(네이티브 해상도)에 그려진다 — 그래서 실제 픽셀 크기를 그대로 쓴다. */
const TEXT_STYLE = { fontFamily: FONT, fontSize: `${SIZE_BODY}px`, color: BODY_TEXT } as const;
const DIM_STYLE = { fontFamily: FONT, fontSize: `${SIZE_BODY}px`, color: DIM_TEXT } as const;
const SMALL_STYLE = { fontFamily: FONT_SMALL, fontSize: `${SIZE_SMALL}px`, color: DIM_TEXT } as const;
const PAD = 12;
const CORE_PANEL_WIDTH = 190;
const CORE_PANEL_HEIGHT = 60;
/** 자기 체력 바 — 퀵슬롯 바로 위에 붙인다. */
/**
 * 보스 HP바(상단 중앙, 웨이브 다이얼 아래) 규격.
 *
 * 보스전은 밤의 마지막 국면이고 이 바가 그 국면의 전부다 — 코어·팀원 게이지와 같은
 * 얇은 띠로 두면 "그냥 또 하나의 몹"으로 읽힌다. 그래서 **화면 중앙 상단의 주역**이
 * 되도록 폭·높이를 키우고 전용 그림(BAR_BOSS: 양끝 강철 캡 + 크림슨 젬)을 쓴다.
 */
const BOSS_BAR_WIDTH = 260;
const BOSS_BAR_HEIGHT = BAR_BOSS.height;
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
  private coreLabel!: Phaser.GameObjects.Text;
  private coreIcon!: Phaser.GameObjects.Image | null;
  private coreBar!: HudBar;
  /** 코어에 입고된 팀 공유 자원(건축 비용이 여기서 나간다) — 개인 휴대량과는 다른 값이다. */
  private sharedResourceText!: Phaser.GameObjects.Text;
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

  private ammoText!: Phaser.GameObjects.Text;

  /** 보스 레이드 표시 — 보스가 살아있는 동안만 보인다. */
  private bossBar!: HudBar;
  private bossIcon!: Phaser.GameObjects.Image | null;
  private bossNameText!: Phaser.GameObjects.Text;
  /** 보스 이름표의 중심/아랫선(화면 좌표). 해골 아이콘을 글자 옆에 붙일 때 쓴다. */
  private bossNameCenter = 0;
  private bossNameBaseline = 0;
  private bossWarnText!: Phaser.GameObjects.Text;
  /** 직전 프레임에 보인 보스 몬스터 id. 새 보스 등장(경고 연출) 감지용. */
  private lastBossId: string | undefined;
  private roomText!: Phaser.GameObjects.Text;
  private resourceText!: Phaser.GameObjects.Text;
  private buildModeText!: Phaser.GameObjects.Text;
  private debugText!: Phaser.GameObjects.Text;
  private helpText!: Phaser.GameObjects.Text;
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

  // 코어 허브 창 — [F]/[E]로 열고, 안에서 탭(코어/제작/상점/창고)으로 오간다.
  private coreModal!: CoreModal;
  private slotDrag!: SlotDrag;
  /** 최신 스냅샷의 내 슬롯/창고. 드래그가 "빈 칸인지"를 물어볼 때 쓴다. */
  private latestInventory: (InventorySlot | null)[] = [];
  private latestStorage: (InventorySlot | null)[] = [];
  private latestCharge: (InventorySlot | null)[] = [];
  private latestCraftOutput: InventorySlot | null = null;
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
    const { roomCode, roomName } = this.connection.roomInfo;

    // 좌상단 — 코어 HP
    this.corePanel = panelBox(this, CORE_PANEL_WIDTH, CORE_PANEL_HEIGHT);
    this.roomText = this.add.text(
      0,
      0,
      `${roomName} [${roomCode}]${this.connection.isLocal ? ' · 오프라인' : ''}`,
      SMALL_STYLE,
    );
    this.coreIcon = hudIcon(this, ICON_CORE);
    this.coreLabel = this.add.text(0, 0, 'CORE', TEXT_STYLE);
    this.sharedResourceText = this.add.text(0, 0, '공유 나무 0 · 돌 0 · 부품 0', SMALL_STYLE);
    this.coreBar = new HudBar(this, BAR_SMALL);

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


    // 탄약은 체력 바 오른쪽 끝에 붙인다 — 쏘는 동안 눈이 화면 아래 중앙을 벗어나지 않게.
    this.ammoText = this.add.text(0, 0, '', DIM_STYLE).setOrigin(1, 1);

    this.resourceText = this.add.text(0, 0, '휴대 나무 0 · 돌 0 · 부품 0', DIM_STYLE);
    this.buildModeText = this.add.text(0, 0, '건축모드: 꺼짐', DIM_STYLE);
    this.debugText = this.add.text(0, 0, '', SMALL_STYLE);
    this.helpText = this.add.text(0, 0, '', DIM_STYLE).setOrigin(0.5, 1);
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
    this.looseTexts = [
      this.resourceText,
      this.buildModeText,
      this.debugText,
      this.helpText,
      this.aiToastText,
    ];

    this.layout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
    });
  }

  /**
   * 코어 상호작용 모달 4종을 만들고 배선한다(docs/frontend/09) — [F]로 허브(코어)
   * 모달을 열고, 거기 있는 4개 버튼 중 3개가 각각 다른 모달로 넘어간다. "창고"는
   * 아직 모달 자체가 없어서(와이어프레임에 잘려 있었다) 우선 로그만 남긴다 —
   * 실제 코어 근접 판정이나 데이터 연결은 다음 작업이다.
   */
  private createCoreModals(): void {
    this.coreModal = new CoreModal(this);
    this.connection.onCoreCommentary((text) => {
      this.coreModal.setCommentary(text);
      this.showAiToast(text);
    });
    this.characterModal = new CharacterModal(this);
    // 하단 바의 직업/스탯 칸이 이 창을 연다 — 스탯을 보는 곳이 한 군데여야 한다.
    this.quickSlots.onProfile = () => {
      if (this.characterModal.isOpen()) this.characterModal.close();
      else this.characterModal.open();
    };

    // 창고 격자와 하단 퀵슬롯을 **하나의 드래그 공간**으로 묶는다. 둘은 별개 UI지만
    // 아이템이 그 사이를 오가야 해서, 드래그 로직을 모달이 아니라 공용 컨트롤러에 둔다.
    this.slotDrag = new SlotDrag(this);
    this.slotDrag.onMove = (from, fromIndex, to, toIndex) =>
      this.connection.moveItem(from, fromIndex, to, toIndex);
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
    this.characterModal.onSpendPoint = (stat) => this.connection.spendStatPoint(stat);
    this.coreModal.onCraft = (recipeId: string) => this.connection.craft(recipeId);
    this.coreModal.onPurchase = (itemId: string) => this.connection.shopBuy(itemId);
    this.coreModal.onDiscard = (index: number) => this.connection.discardStorageItem(index);

    // 낮/밤 무관하게 언제든 열어볼 수 있다 — 아직 실제 효과가 없는 선작업 UI라
    // 페이즈로 막을 이유가 없다(효과가 생기면 그때 막을지 정하면 된다).
    this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.F).on('down', () => {
      if (this.anyModalOpen()) this.closeAllModals();
      else this.coreModal.open();
    });

    // 게임 입력이 모달을 뚫고 나가지 않게 한다 — 차단막이 없으니 좌표로 직접 판정한다.
    this.registry.set(HUD_BLOCK_KEY, (x: number, y: number) => {
      if (this.slotDrag.isDragging()) return true;
      // 콘솔/채팅에 타이핑하는 동안 클릭이 공격으로 새면 안 된다.
      if (this.devConsole?.isOpen()) return true;
      if (this.chatBox.isOpen()) return true;
      return this.openModals().some((modal) => modal.containsPoint(x, y));
    });

    // GameScene의 E 입력이 이 함수를 먼저 부른다. true를 돌려주면 줍기가 취소된다.
    //
    // **줍기가 항상 우선한다.** 코어는 맵 한가운데라 그 근처에서 죽은 몬스터의 드롭을
    // 밟고 있는 일이 흔한데, 예전엔 코어 반경 안이기만 하면 무조건 모달이 떠서 발밑
    // 아이템을 영영 못 주웠다. 창고는 F로도 열 수 있으니, E는 "발밑에 뭔가 있으면 줍고,
    // 없을 때만 코어를 연다"로 정리한다.
    this.registry.set(CORE_INTERACT_KEY, () => {
      if (this.anyModalOpen()) {
        this.closeAllModals();
        return true;
      }
      if (this.dropInReach) return false; // 줍기에 양보한다
      if (!this.nearCore) {
        if (!this.nearCompanion) return false;
        // 코어 근처가 아니고 티모시 옆이면 대사 트리거. 사거리 판정은 서버가 다시 한다.
        this.connection.companionInteract();
        return true;
      }

      this.coreModal.open();
      // 코어 AI 페르소나 트리거. 서버가 쿨다운을 판단하므로 여기선 그냥 알리기만
      // 한다(F키 쪽 단축 접근은 건드리지 않는다 — 그쪽은 선작업용 지름길일 뿐
      // "진짜 상호작용"으로 치지 않아, 중복 트리거를 막는다).
      this.connection.coreInteract();
      return true;
    });
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
  private layout(): void {
    const width = this.scale.width;
    const height = this.scale.height;
    // 월드 줌 2~4 → UI 스케일 1~2. **정수만 쓴다** — 픽셀 폰트는 1.5배로 늘리면
    // 글자가 뭉개져서, 어중간하게 큰 것보다 작고 선명한 쪽이 훨씬 잘 읽힌다.
    const scale = Math.min(2, Math.max(1, Math.floor(computeCameraZoom(width, height) / 2)));
    this.uiScale = scale;

    const pad = PAD * scale;

    // --- 좌상단: 코어 패널
    const panelW = CORE_PANEL_WIDTH * scale;
    const panelH = CORE_PANEL_HEIGHT * scale;
    this.corePanel.setSize(panelW, panelH).setPosition(pad, pad);
    this.roomText.setFontSize(SIZE_SMALL * scale).setPosition(pad + 8 * scale, pad + 5 * scale);
    // 코어 아이콘 → 'CORE' 글자 순으로 한 줄. 아이콘이 없으면(에셋 미로드) 글자가
    // 원래 자리(패널 왼쪽 여백)에서 시작한다.
    const coreLabelX = pad + 8 * scale + (this.coreIcon ? 15 * scale : 0);
    this.coreIcon?.setScale(scale).setPosition(pad + 8 * scale, pad + 23 * scale);
    this.coreLabel.setFontSize(SIZE_BODY * scale).setPosition(coreLabelX, pad + 17 * scale);
    this.sharedResourceText
      .setFontSize(SIZE_SMALL * scale)
      .setPosition(pad + 8 * scale, pad + 30 * scale);

    const coreBarW = panelW - 16 * scale;
    const coreBarY = pad + panelH - 14 * scale;
    this.coreBar.layout(pad + 8 * scale, coreBarY, coreBarW, scale);

    // --- 상단 중앙/우상단
    this.waveDial.layout(width / 2, pad, scale);
    this.minimap.layout(width - pad, pad, scale);

    // 보스 바 — 웨이브 다이얼(지름 52) 바로 아래 중앙. 경고 문구는 화면 중앙 상단 1/3.
    const bossBarY = pad + 64 * scale;
    const bossBarW = BOSS_BAR_WIDTH * scale;
    this.bossNameCenter = width / 2;
    this.bossNameBaseline = bossBarY - 3 * scale;
    this.bossNameText
      .setFontSize(SIZE_BODY * scale)
      .setPosition(this.bossNameCenter, this.bossNameBaseline);
    this.bossBar.layout(width / 2 - bossBarW / 2, bossBarY, bossBarW, scale);
    // 해골은 이름표 왼쪽에 붙는다. 글자 폭이 보스마다 달라서 최종 자리는 이름을 넣은
    // 뒤에 잡는다(placeBossIcon) — 여기서는 배율만 맞춰 둔다.
    this.bossIcon?.setScale(scale);
    this.placeBossIcon();
    this.bossWarnText.setFontSize((SIZE_BODY + 4) * scale).setPosition(width / 2, height / 3);

    // 코어 AI 토스트 — 보스 바 아래. 보스전 중에도 겹치지 않게 바 높이만큼 내려 둔다.
    this.aiToastText
      .setFontSize(SIZE_BODY * scale)
      .setWordWrapWidth(220 * scale)
      .setPosition(width / 2, bossBarY + (BOSS_BAR_HEIGHT + 6) * scale);

    // --- 좌측 세로: 팀원 체력. 코어 패널 아래에서 시작한다.
    this.party.layout(pad, pad + panelH + 10 * scale, scale);

    // --- 하단 중앙: 퀵슬롯 + 내 체력 바
    const slotsBottom = height - pad - 20 * scale;
    this.quickSlots.layout(width / 2, slotsBottom, scale);

    // 탄약은 스태미나 막대 오른쪽 위에 붙인다 — 쏘는 동안 눈이 하단 바를 벗어나지 않게.
    this.ammoText
      .setFontSize(SIZE_BODY * scale)
      .setPosition(this.quickSlots.barsRight, this.quickSlots.barsTop - 4 * scale);

    // 창은 **하단 바를 피해** 그 위 공간의 가운데에 놓는다. 안 그러면 큰 창이 퀵슬롯을
    // 덮어서 창고 → 퀵슬롯 드래그가 아예 불가능해진다.
    const reserved = BOTTOM_BAR_RESERVED * scale;
    for (const modal of this.allModals()) modal.recenter(width, height, reserved);

    // --- 나머지
    this.resourceText.setFontSize(SIZE_BODY * scale).setPosition(pad, height - 40 * scale);
    this.buildModeText.setFontSize(SIZE_BODY * scale).setPosition(pad, height - 24 * scale);
    this.debugText.setFontSize(SIZE_SMALL * scale).setPosition(pad, height - 58 * scale);
    this.helpText.setFontSize(SIZE_BODY * scale).setPosition(width / 2, height - 4 * scale);

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

    this.updateCore(
      status.coreHp,
      status.coreMaxHp,
      status.coreSharedWood,
      status.coreSharedStone,
      status.coreParts,
    );
    this.coreModal.setCoreStatus(status);
    this.coreModal.setChargeSlots(status.coreCharge, status.openChargeSlots);
    this.waveDial.update(status);
    this.updateBossBar(snapshot);
    // GameScene의 예측 좌표(있으면) — 없으면(로컬 모드 초기 프레임 등) 미니맵이
    // 스냅샷의 보간 좌표로 알아서 폴백한다.
    const localPosition = this.registry.get(LOCAL_POSITION_KEY) as { x: number; y: number } | undefined;
    this.minimap.update(snapshot, this.connection.sessionId, localPosition);
    this.party.update(
      snapshot.players.filter((player) => player.id !== this.connection.sessionId),
    );
    this.latestInventory = me?.slots ?? [];
    this.latestStorage = status.coreStorage;
    this.latestCharge = status.coreCharge;

    this.coreModal.setCraftContext({
      coreTier: status.coreTier,
      resource: status.coreResource,
      energy: status.coreEnergy,
      craftingId: me?.craftRecipeId ?? '',
      craftRemaining: me?.craftRemaining ?? 0,
      output: me?.craftOutput ?? null,
    });
    this.latestCraftOutput = me?.craftOutput ?? null;
    this.coreModal.setStoreContext(status.shopStock, status.coreEnergy);
    this.quickSlots.update(me, this.slotDrag.hoverCellOf('inventory'));
    this.characterModal.setPlayer(me);
    this.updateAmmo(me);
    this.updateTexts(snapshot, me);

    // 코어는 항상 원점(0,0). 서버(World.isNearCore)와 같은 함수로 판정해야
    // "E가 안 먹는다"는 어긋남이 안 생긴다 — 코어가 8각 발자국이 되면서 반경
    // 비교로는 같은 결론을 낼 수 없다.
    this.nearCore = me ? isWithinCoreInteract(me.x, me.y) : false;
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

  private updateCore(
    hp: number,
    maxHp: number,
    sharedWood: number,
    sharedStone: number,
    coreParts: number,
  ): void {
    const ratio = maxHp > 0 ? hp / maxHp : 1;
    // 코어가 위험하면 색으로 먼저 알린다 — 숫자를 읽기 전에 눈에 들어와야 한다.
    this.coreBar.setValue(ratio, barColor(ratio), this.uiScale);
    this.coreLabel.setText(`CORE ${Math.ceil(hp)}`);
    // 창고에 쌓인 **충전 재료** 수량이다(게이지가 아니라). 사냥 중에 "얼마나 모았나"를
    // 보고 코어로 돌아갈지 정하게 된다 — 게이지 자체는 코어 탭에서 본다.
    this.sharedResourceText.setText(
      `창고 나무 ${sharedWood} · 돌 ${sharedStone} · 부품 ${coreParts}`,
    );

    // 체력이 줄었다 = 맞았다(플레이어/몬스터 피격과 같은 추론, 스냅샷엔 타격
    // 이벤트가 따로 없다). 처음 받은 값은 기준점으로만 쓴다.
    if (this.lastCoreHp !== null && hp < this.lastCoreHp) this.flashCorePanel();
    this.lastCoreHp = hp;
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
    this.bossBar.setValue(ratio, BOSS_BAR_COLOR, this.uiScale);
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
      left - icon.displayWidth - 4 * this.uiScale,
      this.bossNameBaseline - this.bossNameText.height / 2,
    );
  }

  private updateTexts(snapshot: WorldSnapshot, me: PlayerView | undefined): void {
    const { status } = snapshot;

    this.debugText.setText(
      me
        ? `x:${me.x.toFixed(0)} y:${me.y.toFixed(0)} mob:${snapshot.monsters.length} proj:${snapshot.projectiles.length}`
        : '동기화 대기 중...',
    );
    this.resourceText.setText(
      me
        ? `휴대 나무 ${me.wood} · 돌 ${me.stone} · 부품 ${me.parts}`
        : '휴대 나무 0 · 돌 0 · 파편 0',
    );

    // InputController는 GameScene 소속이라 registry로만 접근한다 — 씬 시작 순서와
    // 무관하게 늦어도 다음 프레임엔 값이 채워져 있다(GameScene.create 참고).
    const inputController = this.registry.get(INPUT_CONTROLLER_KEY) as InputController | undefined;
    const buildMode = inputController?.buildMode ?? 'off';
    this.buildModeText.setText(`건축모드: ${BUILD_MODE_LABEL[buildMode] ?? buildMode}`);
    this.buildModeText.setColor(buildMode === 'off' ? DIM_TEXT : ACCENT);

    // 낮에만 스킵 안내를 띄운다 — 밤에는 쓸 수 없는 조작이라 보여줄 이유가 없다.
    // 철거 모드는 좌클릭이 "설치"가 아니라 "철거"라 힌트 문구도 따로 갈라야 한다.
    const controlsHint =
      buildMode === 'off'
        ? `WASD 이동 · 좌클릭 사용 · [1~${SLOT_COUNT}] 퀵슬롯 · [E] 코어 입고 · [F] 코어 메뉴 · [B] 건축모드`
        : buildMode === 'demolish'
          ? '좌클릭 철거(환급 없음) · 우클릭/[B] 취소 또는 다음 건축물'
          : '좌클릭 설치 · 우클릭/[B] 취소 또는 다음 건축물';
    // 개발 도구가 붙어 있을 때만 그 키를 안내한다 — 없는 키를 알려주면 안 된다.
    const devHint = this.devConsole ? ' · [`] 콘솔 · [F9] 아이템' : '';
    this.helpText.setText(
      status.wavePhase === 'day'
        ? `${controlsHint} · [V] 낮 넘기기 ${status.skipVoteCount}/${snapshot.players.length}${devHint}`
        : `${controlsHint} · ESC 나가기${devHint}`,
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
