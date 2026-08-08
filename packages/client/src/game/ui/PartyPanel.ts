import Phaser from 'phaser';
import { jobsData } from '@dropfall/shared';
import type { PlayerView } from '../../net/GameConnection';
import {
  BAR_BACK,
  BODY_TEXT,
  DOWN_COLOR,
  FONT,
  PANEL_FILL,
  PANEL_STROKE,
  SIZE_BODY,
  barColor,
} from './theme';

const BOX_WIDTH = 92;
const BOX_HEIGHT = 30;
const BOX_GAP = 5;
const BAR_HEIGHT = 4;

/**
 * 화면 좌측 세로 칸 — 팀원 체력(와이어프레임 좌측 3칸).
 *
 * 자기 자신은 여기 나오지 않는다. 내 체력은 퀵슬롯 위에 따로 붙는다 — 협동 게임에서
 * "누가 위험한가"는 남을 보는 정보고, 내 체력은 손이 가는 곳 근처에 있어야 한다.
 * 인원이 모자라면 칸을 통째로 숨긴다.
 */
export class PartyPanel {
  private readonly boxes: Phaser.GameObjects.Rectangle[] = [];
  private readonly nameLabels: Phaser.GameObjects.Text[] = [];
  private readonly barBacks: Phaser.GameObjects.Rectangle[] = [];
  private readonly bars: Phaser.GameObjects.Rectangle[] = [];
  /** 레이아웃 후 실제 높이(px). */
  height = 0;
  private barWidth = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly capacity: number,
  ) {
    for (let index = 0; index < capacity; index += 1) {
      this.boxes.push(
        scene.add
          .rectangle(0, 0, BOX_WIDTH, BOX_HEIGHT, PANEL_FILL, 0.82)
          .setOrigin(0, 0)
          .setStrokeStyle(1, PANEL_STROKE),
      );
      this.nameLabels.push(
        scene.add.text(0, 0, '', { fontFamily: FONT, fontSize: `${SIZE_BODY}px`, color: BODY_TEXT }),
      );
      this.barBacks.push(scene.add.rectangle(0, 0, 10, BAR_HEIGHT, BAR_BACK).setOrigin(0, 0));
      this.bars.push(scene.add.rectangle(0, 0, 10, BAR_HEIGHT, 0x6fd08c).setOrigin(0, 0));
    }
  }

  layout(left: number, top: number, scale: number): void {
    const width = BOX_WIDTH * scale;
    const boxHeight = BOX_HEIGHT * scale;
    const gap = BOX_GAP * scale;
    this.barWidth = width - 10 * scale;
    this.height = this.capacity * boxHeight + (this.capacity - 1) * gap;

    for (let index = 0; index < this.capacity; index += 1) {
      const y = top + index * (boxHeight + gap);
      this.boxes[index].setSize(width, boxHeight).setPosition(left, y);
      this.nameLabels[index].setFontSize(SIZE_BODY * scale).setPosition(left + 5 * scale, y + 4 * scale);
      this.barBacks[index]
        .setSize(this.barWidth, BAR_HEIGHT * scale)
        .setPosition(left + 5 * scale, y + boxHeight - 9 * scale);
      this.bars[index]
        .setSize(this.barWidth, BAR_HEIGHT * scale)
        .setPosition(left + 5 * scale, y + boxHeight - 9 * scale);
    }
  }

  /** 나를 제외한 팀원 목록을 받는다. */
  update(teammates: PlayerView[]): void {
    for (let index = 0; index < this.capacity; index += 1) {
      const player = teammates[index];
      const visible = player !== undefined;

      this.boxes[index].setVisible(visible);
      this.nameLabels[index].setVisible(visible);
      this.barBacks[index].setVisible(visible);
      this.bars[index].setVisible(visible);
      if (!player) continue;

      const down = player.hp <= 0;
      this.nameLabels[index].setText(down ? `${player.nickname} 다운` : player.nickname);
      this.nameLabels[index].setColor(down ? DOWN_COLOR : BODY_TEXT);

      // 개발 커맨드(hp)로 최대치를 넘길 수 있어서 위쪽도 조인다(HudScene와 같은 이유).
      const ratio = Math.min(1, Math.max(0, player.hp) / (player.maxHp || jobsData.base.maxHp));
      this.bars[index].width = Math.max(0, this.barWidth * ratio);
      this.bars[index].fillColor = barColor(ratio);
    }
  }
}
