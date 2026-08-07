import Phaser from 'phaser';
import { Modal } from './Modal';
import { ACCENT, FONT_SMALL, SIZE_SMALL } from './theme';

const PANEL_WIDTH = 220;
const PANEL_HEIGHT = 240;
const ROW_GAP = 18;
const BUTTON_HEIGHT = 26;
const GRID_GAP = 8;

/**
 * 코어 앞에서 여는 허브 모달(와이어프레임 루트) — 정보 행 + 주입 버튼 + 2x2 이동 버튼.
 * 실제 데이터/이동 로직은 아직 없다. 콜백은 전부 no-op 기본값이고, 다른 모달로의
 * 이동 배선은 나중에 HudScene 쪽에서 각 on* 콜백을 채워 넣는 방식으로 이뤄진다.
 */
export class CoreModal extends Modal {
  onManage: () => void = () => {};
  onStore: () => void = () => {};
  onCraft: () => void = () => {};
  onWarehouse: () => void = () => {};

  /** "에너지" 행 값 텍스트. 콜로니 파괴로만 얻는 전용 자원(docs/backend/35) —
   * 여기 모달들 중 실제 데이터에 연결된 첫 필드다. */
  private readonly energyValueText: Phaser.GameObjects.Text;
  /** 코어 AI 페르소나 대사. 아직 아무 일도 없었으면 빈 문자열(조용한 게 자연스럽다). */
  private readonly commentaryText: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene) {
    super(scene, { title: '코어', width: PANEL_WIDTH, height: PANEL_HEIGHT });

    this.addRow(0, '가격', '-');
    this.addRow(ROW_GAP, '자원', '0');
    this.energyValueText = this.addRow(ROW_GAP * 2, '에너지', '0');

    const feedY = ROW_GAP * 3;
    this.addButton(0, feedY, this.contentWidth, BUTTON_HEIGHT, '주입', () => {
      // 아직 실제 주입 로직 없음 — 클릭 배선만 확인하는 자리.
      console.log('[CoreModal] 주입');
    });

    const gridY = feedY + BUTTON_HEIGHT + GRID_GAP;
    const colWidth = (this.contentWidth - GRID_GAP) / 2;
    const col2X = colWidth + GRID_GAP;
    const row2Y = gridY + BUTTON_HEIGHT + GRID_GAP;

    this.addButton(0, gridY, colWidth, BUTTON_HEIGHT, '코어 관리', () => this.onManage());
    this.addButton(col2X, gridY, colWidth, BUTTON_HEIGHT, '상점', () => this.onStore());
    this.addButton(0, row2Y, colWidth, BUTTON_HEIGHT, '제작', () => this.onCraft());
    this.addButton(col2X, row2Y, colWidth, BUTTON_HEIGHT, '창고', () => this.onWarehouse());

    const commentaryY = row2Y + BUTTON_HEIGHT + GRID_GAP;
    this.commentaryText = scene.add
      .text(0, commentaryY, '', {
        fontFamily: FONT_SMALL,
        fontSize: `${SIZE_SMALL}px`,
        color: ACCENT,
        wordWrap: { width: this.contentWidth },
      })
      .setOrigin(0, 0);
    this.addContent(this.commentaryText);
  }

  /** 코어 공유 에너지(coreSharedEnergy)를 반영한다. HudScene이 스냅샷마다 호출한다. */
  setEnergy(value: number): void {
    this.energyValueText.setText(String(value));
  }

  /** 코어 AI 페르소나의 새 대사를 반영한다. HudScene이 onCoreCommentary 콜백에서 호출한다. */
  setCommentary(text: string): void {
    this.commentaryText.setText(`"${text}"`);
  }
}
