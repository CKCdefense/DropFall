import Phaser from 'phaser';
import {
  MAX_CLIENTS_PER_ROOM,
  SLOT_COUNT,
  computeCameraZoom,
  coreUpgradesData,
  wavesData,
} from '@dropfall/shared';
import type { GameConnection, PlayerView, WorldSnapshot } from '../../net/GameConnection';
import { CONNECTION_KEY, INPUT_CONTROLLER_KEY } from '../createGame';
import type { InputController } from '../input/InputController';
import { CoreModal } from '../ui/CoreModal';
import { CraftModal } from '../ui/CraftModal';
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
  private upgradeModal!: UpgradeModal;
  private storeModal!: StoreModal;
  private craftModal!: CraftModal;
  /** update()가 매 프레임 최신 값으로 갱신한다 — onCraft 클릭 시점에 읽어서 게이팅한다. */
  private craftingUnlocked = false;

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
    this.sharedResourceText = this.add.text(0, 0, '공유 나무 0 · 돌 0 · 파편 0', SMALL_STYLE);
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

    this.resourceText = this.add.text(0, 0, '휴대 나무 0 · 돌 0 · 파편 0', DIM_STYLE);
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
      // 코어 업그레이드로 해금되기 전엔 열지 않는다(docs/backend/38) — 아직 열
      // 콘텐츠가 없어서 그냥 무시한다. this.craftingUnlocked는 update()가 매
      // 프레임 최신 상태로 갱신해 둔다.
      if (this.craftingUnlocked) this.craftModal.open();
    };
    this.upgradeModal.onTierUp = () => this.connection.upgradeCore();
    this.coreModal.onWarehouse = () => {
      console.log('[HudScene] 창고 모달은 아직 없다');
    };

    // 낮/밤 무관하게 언제든 열어볼 수 있다 — 아직 실제 효과가 없는 선작업 UI라
    // 페이즈로 막을 이유가 없다(효과가 생기면 그때 막을지 정하면 된다).
    this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.F).on('down', () => {
      if (this.coreModal.isOpen()) this.coreModal.close();
      else this.coreModal.open();
    });
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
      status.coreSharedScrap,
      status.coreSharedEnergy,
    );
    this.craftingUnlocked = status.craftingUnlocked;
    const nextTier = coreUpgradesData.tiers[status.coreTier];
    this.upgradeModal.setTierInfo(
      status.coreTier,
      coreUpgradesData.tiers.length,
      nextTier ? nextTier.cost : null,
    );
    this.waveDial.update(status);
    this.minimap.update(snapshot, this.connection.sessionId);
    this.party.update(
      snapshot.players.filter((player) => player.id !== this.connection.sessionId),
    );
    this.quickSlots.update(me);
    this.updateSelfBar(me);
    this.updateTexts(snapshot, me);
  }

  private updateCore(
    hp: number,
    maxHp: number,
    sharedWood: number,
    sharedStone: number,
    sharedScrap: number,
    sharedEnergy: number,
  ): void {
    const ratio = maxHp > 0 ? hp / maxHp : 1;
    this.coreBar.width = Math.max(0, this.coreBarBack.width * ratio);
    // 코어가 위험하면 색으로 먼저 알린다 — 숫자를 읽기 전에 눈에 들어와야 한다.
    this.coreBar.fillColor = barColor(ratio);
    this.coreLabel.setText(`CORE ${Math.ceil(hp)}`);
    this.sharedResourceText.setText(`공유 나무 ${sharedWood} · 돌 ${sharedStone} · 파편 ${sharedScrap}`);
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
        ? `휴대 나무 ${me.wood} · 돌 ${me.stone} · 파편 ${me.scrap}`
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
    const controlsHint =
      buildMode === 'off'
        ? `WASD 이동 · 좌클릭 사용 · [1~${SLOT_COUNT}] 퀵슬롯 · [E] 코어 입고 · [F] 코어 메뉴 · [B] 건축모드 · [R] 콜로니 파괴(엄호 필요)`
        : '좌클릭 설치 · 우클릭/[B] 취소 또는 다음 건축물';
    this.helpText.setText(
      status.wavePhase === 'day'
        ? `${controlsHint} · [V] 낮 넘기기 ${status.skipVoteCount}/${snapshot.players.length}`
        : `${controlsHint} · ESC 나가기`,
    );
  }
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
