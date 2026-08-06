import Phaser from 'phaser';
import { Modal } from './Modal';

const PANEL_WIDTH = 220;
const PANEL_HEIGHT = 190;
const ROW_GAP = 18;
const BUTTON_HEIGHT = 26;
const GRID_GAP = 8;

/**
 * "코어 관리" 목적지 — 정보 행 + 현재 티어 표시 + 티어/토지/수리 3개 버튼.
 * 버튼 3개는 2+1로 배치한다(3등분하면 한글 라벨이 좁은 칸에서 답답해 보인다).
 */
export class UpgradeModal extends Modal {
  onTierUp: () => void = () => {};
  onExpandLand: () => void = () => {};
  onRepairCore: () => void = () => {};

  constructor(scene: Phaser.Scene) {
    super(scene, { title: '코어 관리', width: PANEL_WIDTH, height: PANEL_HEIGHT });

    this.addRow(0, '가격', '-');
    this.addRow(ROW_GAP, '자원', '0');
    this.addRow(ROW_GAP * 2, '에너지', '0');
    this.addRow(ROW_GAP * 3, '현재 티어', '1');

    const row1Y = ROW_GAP * 4 + 4;
    const colWidth = (this.contentWidth - GRID_GAP) / 2;
    const col2X = colWidth + GRID_GAP;
    const row2Y = row1Y + BUTTON_HEIGHT + GRID_GAP;

    this.addButton(0, row1Y, colWidth, BUTTON_HEIGHT, '티어 증가', () => this.onTierUp());
    this.addButton(col2X, row1Y, colWidth, BUTTON_HEIGHT, '토지 확장', () => this.onExpandLand());
    this.addButton(0, row2Y, this.contentWidth, BUTTON_HEIGHT, '코어 수리', () => this.onRepairCore());
  }
}
