import Phaser from 'phaser';
import type { InventorySlot } from '@dropfall/shared';
import {
  CORE_INTERACT_RADIUS,
  MAX_CLIENTS_PER_ROOM,
  PICKUP_RADIUS,
  SLOT_COUNT,
  computeCameraZoom,
  coreUpgradesData,
  wavesData,
} from '@dropfall/shared';
import type { GameConnection, PlayerView, WorldSnapshot } from '../../net/GameConnection';
import {
  CONNECTION_KEY,
  CORE_INTERACT_KEY,
  HUD_BLOCK_KEY,
  INPUT_CONTROLLER_KEY,
} from '../createGame';
import type { InputController } from '../input/InputController';
import { CoreModal } from '../ui/CoreModal';
import { WarehouseModal } from '../ui/WarehouseModal';
import { SlotDrag } from '../ui/SlotDrag';
import type { Modal } from '../ui/Modal';
import { CraftModal } from '../ui/CraftModal';
import { DevConsole } from '../ui/DevConsole';
import { DevItemModal } from '../ui/DevItemModal';
import { Minimap } from '../ui/Minimap';
import { PartyPanel } from '../ui/PartyPanel';
import { QuickSlotBar } from '../ui/QuickSlotBar';
import { StoreModal } from '../ui/StoreModal';
import { UpgradeModal } from '../ui/UpgradeModal';
import { WaveDial } from '../ui/WaveDial';
import {
  ACCENT,
  BAR_BACK,
  BODY_TEXT,
  DIM_TEXT,
  FONT,
  FONT_SMALL,
  PANEL_FILL,
  PANEL_STROKE,
  SIZE_BODY,
  SIZE_SMALL,
  applyTextShadow,
  barColor,
} from '../ui/theme';

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
const CORE_BAR_HEIGHT = 8;
/** 자기 체력 바 — 퀵슬롯 바로 위에 붙인다. */
const SELF_BAR_WIDTH = 180;
const SELF_BAR_HEIGHT = 6;

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
  private coreBarBack!: Phaser.GameObjects.Rectangle;
  private coreBar!: Phaser.GameObjects.Rectangle;
  /** 코어에 입고된 팀 공유 자원(건축 비용이 여기서 나간다) — 개인 휴대량과는 다른 값이다. */
  private sharedResourceText!: Phaser.GameObjects.Text;

  private waveDial!: WaveDial;
  private minimap!: Minimap;
  private party!: PartyPanel;
  private quickSlots!: QuickSlotBar;

  private selfBarBack!: Phaser.GameObjects.Rectangle;
  private selfBar!: Phaser.GameObjects.Rectangle;
  private roomText!: Phaser.GameObjects.Text;
  private resourceText!: Phaser.GameObjects.Text;
  private buildModeText!: Phaser.GameObjects.Text;
  private debugText!: Phaser.GameObjects.Text;
  private helpText!: Phaser.GameObjects.Text;
  /** 콜로니 채널링(파괴 작업) 진행률 표시. 채널링 중이 아니면 빈 문자열로 숨긴다. */
  private channelText!: Phaser.GameObjects.Text;
  /** 로컬 모드에서만 존재한다 — connection.debugJumpToWave가 없으면 아예 안 만든다. */
  private debugJumpButton?: Phaser.GameObjects.Text;
  /** 패널 배경 없이 지형 위에 바로 얹히는 글자들. 그림자를 넣어 대비를 준다. */
  private looseTexts: Phaser.GameObjects.Text[] = [];
  /** 바 너비를 다시 계산할 때 필요해서 보관한다. */
  private uiScale = 1;

  // 코어 상호작용 모달 4종(docs/frontend/09) — [F]로 코어 모달을 열고, 거기서
  // 나머지 셋으로 이동한다. 아직 선작업 단계라 실제 데이터/효과는 없다.
  private coreModal!: CoreModal;
  private warehouseModal!: WarehouseModal;
  private slotDrag!: SlotDrag;
  /** 최신 스냅샷의 내 슬롯/창고. 드래그가 "빈 칸인지"를 물어볼 때 쓴다. */
  private latestInventory: (InventorySlot | null)[] = [];
  private latestStorage: (InventorySlot | null)[] = [];
  /** 코어 상호작용 반경 안에 있는지. update가 매 프레임 갱신한다. */
  private nearCore = false;
  /** 주울 수 있는 드롭이 발밑에 있는지. 코어 앞에서 E가 무엇을 할지 가른다. */
  private dropInReach = false;
  private upgradeModal!: UpgradeModal;
  private storeModal!: StoreModal;
  private craftModal!: CraftModal;
  /**
   * 개발 모드 전용. 프로덕션 빌드에서는 아예 만들어지지 않는다 —
   * `isDevBuild()` 참고.
   */
  private devConsole?: DevConsole;
  private devItemModal?: DevItemModal;

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
    this.coreLabel = this.add.text(0, 0, 'CORE', TEXT_STYLE);
    this.sharedResourceText = this.add.text(0, 0, '공유 나무 0 · 돌 0 · 부품 0', SMALL_STYLE);
    this.coreBarBack = this.add.rectangle(0, 0, 10, CORE_BAR_HEIGHT, BAR_BACK).setOrigin(0, 0);
    this.coreBar = this.add.rectangle(0, 0, 10, CORE_BAR_HEIGHT, 0x6fd08c).setOrigin(0, 0);

    // 상단 중앙 원형 — 웨이브 번호 + 남은 시간
    this.waveDial = new WaveDial(this);
    // 우상단 사각형 — 미니맵
    this.minimap = new Minimap(this);
    // 좌측 세로 — 팀원(나를 제외한 인원) 체력
    this.party = new PartyPanel(this, MAX_CLIENTS_PER_ROOM - 1);
    // 하단 중앙 — 퀵슬롯
    this.quickSlots = new QuickSlotBar(this, SLOT_COUNT);

    // 내 체력은 퀵슬롯 바로 위에 붙인다. 팀원 칸과 섞으면 "누구 체력인지" 헷갈린다.
    this.selfBarBack = this.add.rectangle(0, 0, 10, SELF_BAR_HEIGHT, BAR_BACK).setOrigin(0.5, 1);
    this.selfBar = this.add.rectangle(0, 0, 10, SELF_BAR_HEIGHT, 0x6fd08c).setOrigin(0, 1);

    this.resourceText = this.add.text(0, 0, '휴대 나무 0 · 돌 0 · 부품 0', DIM_STYLE);
    this.buildModeText = this.add.text(0, 0, '건축모드: 꺼짐', DIM_STYLE);
    this.debugText = this.add.text(0, 0, '', SMALL_STYLE);
    this.helpText = this.add.text(0, 0, '', DIM_STYLE).setOrigin(0.5, 1);
    this.channelText = this.add
      .text(0, 0, '', { fontFamily: FONT, fontSize: `${SIZE_BODY}px`, color: ACCENT })
      .setOrigin(0.5, 1);

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
    if (isDevBuild()) this.createDevTools();

    // 패널 밖에 떠 있는 글자는 지형 위에 그대로 얹혀서 대비가 필요하다.
    // 패널 안 글자(코어, 퀵슬롯, 팀원)는 어두운 상자가 이미 받쳐주므로 놔둔다.
    this.looseTexts = [
      this.resourceText,
      this.buildModeText,
      this.debugText,
      this.helpText,
      this.channelText,
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
    this.upgradeModal = new UpgradeModal(this);
    this.storeModal = new StoreModal(this);
    this.craftModal = new CraftModal(this);
    this.warehouseModal = new WarehouseModal(this);

    // 창고 격자와 하단 퀵슬롯을 **하나의 드래그 공간**으로 묶는다. 둘은 별개 UI지만
    // 아이템이 그 사이를 오가야 해서, 드래그 로직을 모달이 아니라 공용 컨트롤러에 둔다.
    this.slotDrag = new SlotDrag(this);
    this.slotDrag.onMove = (from, fromIndex, to, toIndex) =>
      this.connection.moveItem(from, fromIndex, to, toIndex);
    this.slotDrag.onQuickMove = (container, index) =>
      this.connection.quickMoveItem(container, index);
    this.slotDrag.getSlot = (container, index) =>
      (container === 'storage' ? this.latestStorage : this.latestInventory)[index] ?? null;

    for (const cell of this.warehouseModal.storageCells) {
      // 창고 칸은 모달이 열려 있을 때만 살아 있다 — 닫힌 모달의 칸이 드래그를 먹으면 안 된다.
      this.slotDrag.register({
        container: 'storage',
        index: cell.index,
        box: cell.box,
        isActive: () => this.warehouseModal.isOpen(),
      });
    }
    this.quickSlots.cells.forEach((box, index) => {
      this.slotDrag.register({ container: 'inventory', index, box, isActive: () => true });
    });

    this.coreModal.onManage = () => {
      this.coreModal.close();
      this.upgradeModal.open();
    };
    this.coreModal.onStore = () => {
      this.coreModal.close();
      this.storeModal.open();
    };
    this.coreModal.onCraft = () => {
      this.coreModal.close();
      // 해금 여부로 창 자체를 막지 않는다 — 레시피마다 요구 티어가 따로 있고(T1 도구는
      // 처음부터 만들 수 있다), 잠긴 것도 회색으로 보여줘야 코어를 왜 올리는지 알 수 있다.
      this.craftModal.open();
    };
    this.upgradeModal.onTierUp = () => this.connection.upgradeCore();
    this.craftModal.onCraft = (recipeId) => this.connection.craft(recipeId);
    this.storeModal.onPurchase = (itemId) => this.connection.shopBuy(itemId);
    this.storeModal.onSell = (itemId, count) => this.connection.shopSell(itemId, count);
    this.coreModal.onWarehouse = () => {
      this.coreModal.close();
      this.warehouseModal.open();
    };

    // 낮/밤 무관하게 언제든 열어볼 수 있다 — 아직 실제 효과가 없는 선작업 UI라
    // 페이즈로 막을 이유가 없다(효과가 생기면 그때 막을지 정하면 된다).
    this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.F).on('down', () => {
      if (this.anyModalOpen()) this.closeAllModals();
      else this.coreModal.open();
    });

    // 게임 입력이 모달을 뚫고 나가지 않게 한다 — 차단막이 없으니 좌표로 직접 판정한다.
    this.registry.set(HUD_BLOCK_KEY, (x: number, y: number) => {
      if (this.slotDrag.isDragging()) return true;
      // 콘솔에 타이핑하는 동안 클릭이 공격으로 새면 안 된다.
      if (this.devConsole?.isOpen()) return true;
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
      if (!this.nearCore) return false;

      this.coreModal.open();
      return true;
    });
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

  private openModals(): Modal[] {
    return [
      this.coreModal,
      this.warehouseModal,
      this.upgradeModal,
      this.storeModal,
      this.craftModal,
      ...(this.devItemModal ? [this.devItemModal] : []),
    ].filter((modal) => modal.isOpen());
  }

  private anyModalOpen(): boolean {
    return this.openModals().length > 0;
  }

  private closeAllModals(): void {
    this.coreModal.close();
    this.warehouseModal.close();
    this.upgradeModal.close();
    this.storeModal.close();
    this.craftModal.close();
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
    this.coreLabel.setFontSize(SIZE_BODY * scale).setPosition(pad + 8 * scale, pad + 17 * scale);
    this.sharedResourceText
      .setFontSize(SIZE_SMALL * scale)
      .setPosition(pad + 8 * scale, pad + 30 * scale);

    const coreBarW = panelW - 16 * scale;
    const coreBarY = pad + panelH - 14 * scale;
    this.coreBarBack
      .setSize(coreBarW, CORE_BAR_HEIGHT * scale)
      .setPosition(pad + 8 * scale, coreBarY);
    this.coreBar.setSize(coreBarW, CORE_BAR_HEIGHT * scale).setPosition(pad + 8 * scale, coreBarY);

    // --- 상단 중앙/우상단
    this.waveDial.layout(width / 2, pad, scale);
    this.minimap.layout(width - pad, pad, scale);

    // --- 좌측 세로: 팀원 체력. 코어 패널 아래에서 시작한다.
    this.party.layout(pad, pad + panelH + 10 * scale, scale);

    // --- 하단 중앙: 퀵슬롯 + 내 체력 바
    const slotsBottom = height - pad - 20 * scale;
    this.quickSlots.layout(width / 2, slotsBottom, scale);

    const selfBarY = slotsBottom - this.quickSlots.height - 6 * scale;
    const selfBarW = SELF_BAR_WIDTH * scale;
    this.selfBarBack
      .setSize(selfBarW, SELF_BAR_HEIGHT * scale)
      .setPosition(width / 2, selfBarY);
    this.selfBar
      .setSize(selfBarW, SELF_BAR_HEIGHT * scale)
      .setPosition(width / 2 - selfBarW / 2, selfBarY);
    this.channelText
      .setFontSize(SIZE_BODY * scale)
      .setPosition(width / 2, selfBarY - 4 * scale);

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
      status.coreSharedEnergy,
      status.coreMoney,
    );
    // tiers는 "다음 티어로 올리는" 목록이라 티어 1이 0번 항목을 산다(startTier 오프셋).
    const nextTier = coreUpgradesData.tiers[status.coreTier - coreUpgradesData.startTier];
    this.upgradeModal.setTierInfo(
      status.coreTier,
      coreUpgradesData.startTier + coreUpgradesData.tiers.length,
      nextTier ? nextTier.cost : null,
    );
    this.waveDial.update(status);
    this.minimap.update(snapshot, this.connection.sessionId);
    this.party.update(
      snapshot.players.filter((player) => player.id !== this.connection.sessionId),
    );
    this.latestInventory = me?.slots ?? [];
    this.latestStorage = status.coreStorage;

    // 제작·상점은 둘 다 "창고에 뭐가 몇 개 있나"만 알면 된다 — 칸 배열을 한 번만
    // 합계로 접어서 두 모달에 같이 넘긴다.
    const stock = summarizeStorage(status.coreStorage);
    this.craftModal.setContext(stock, status.coreTier);
    this.storeModal.setContext(status.shopStock, status.coreMoney, stock);
    this.quickSlots.update(me, this.slotDrag.hoverCellOf('inventory'));
    this.updateSelfBar(me);
    this.updateTexts(snapshot, me);

    // 코어는 항상 원점(0,0). 서버(World.isNearCore)와 같은 반경으로 판정해야
    // "E가 안 먹는다"는 어긋남이 안 생긴다.
    this.nearCore = me ? Math.hypot(me.x, me.y) <= CORE_INTERACT_RADIUS : false;
    this.dropInReach = me
      ? snapshot.droppedItems.some(
          (drop) => Math.hypot(drop.x - me.x, drop.y - me.y) <= PICKUP_RADIUS,
        )
      : false;
    if (this.warehouseModal.isOpen()) this.warehouseModal.setSlots(status.coreStorage);
  }

  private updateCore(
    hp: number,
    maxHp: number,
    sharedWood: number,
    sharedStone: number,
    coreParts: number,
    sharedEnergy: number,
    money: number,
  ): void {
    const ratio = maxHp > 0 ? hp / maxHp : 1;
    this.coreBar.width = Math.max(0, this.coreBarBack.width * ratio);
    // 코어가 위험하면 색으로 먼저 알린다 — 숫자를 읽기 전에 눈에 들어와야 한다.
    this.coreBar.fillColor = barColor(ratio);
    this.coreLabel.setText(`CORE ${Math.ceil(hp)}`);
    // 자금은 상점에서만 쓰지만 여기 같이 띄운다 — 팔러 갈지 말지를 코어 앞이 아니라
    // 사냥 중에 판단하게 된다.
    this.sharedResourceText.setText(
      `공유 나무 ${sharedWood} · 돌 ${sharedStone} · 부품 ${coreParts} · ${money} G`,
    );
    this.coreModal.setEnergy(sharedEnergy);
  }

  private updateSelfBar(me: PlayerView | undefined): void {
    const ratio = me ? Math.max(0, me.hp) / wavesData.playerHp : 0;
    this.selfBar.width = Math.max(0, SELF_BAR_WIDTH * this.uiScale * ratio);
    this.selfBar.fillColor = barColor(ratio);
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

    // 채널링 중일 때만 보인다 — 진행률 0(채널링 아님)이면 빈 문자열로 완전히 숨긴다.
    const channelProgress = me?.channelProgress ?? 0;
    this.channelText.setText(
      channelProgress > 0 ? `콜로니 파괴 중... ${Math.floor(channelProgress * 100)}%` : '',
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
        ? `WASD 이동 · 좌클릭 사용 · [1~${SLOT_COUNT}] 퀵슬롯 · [E] 코어 입고 · [F] 코어 메뉴 · [B] 건축모드 · [R] 콜로니 파괴(엄호 필요)`
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

/**
 * 창고 칸 배열 → 아이템별 총 개수. 같은 아이템이 여러 칸에 나뉘어 있을 수 있어서
 * 그대로는 "재료가 몇 개 있나"를 물을 수 없다(서버의 CoreStorage.countOf와 같은 계산).
 */
function summarizeStorage(slots: readonly (InventorySlot | null)[]): Record<string, number> {
  const total: Record<string, number> = {};
  for (const slot of slots) {
    if (!slot) continue;
    total[slot.itemId] = (total[slot.itemId] ?? 0) + slot.count;
  }
  return total;
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
