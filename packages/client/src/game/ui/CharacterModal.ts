import Phaser from 'phaser';
import { jobName } from '@dropfall/shared';
import type { PlayerView } from '../../net/GameConnection';
import { Modal } from './Modal';
import { GAME_ATLAS, idleFrame, spritePrefix } from '../render/playerSprite';
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
  barColor,
} from './theme';

const PANEL_WIDTH = 560;
const PANEL_HEIGHT = 480;

const SECTION_PAD = 12;
const SECTION_GAP = 10;
/** 왼쪽 위 초상화 칸. 캐릭터 스프라이트를 크게 키워 넣는다. */
const PORTRAIT_WIDTH = 150;
const PORTRAIT_HEIGHT = 178;
/** 스탯 한 줄(막대 + 올리기 버튼)의 높이와 줄 간격. */
const STAT_ROW_HEIGHT = 26;
const STAT_ROW_GAP = 26;
const STAT_BUTTON = 30;
/** 스킬 칸 한 변. 아래 구역에 2 + 4 배치로 들어간다(와이어프레임). */
const SKILL_SLOT = 42;
const SKILL_GAP = 10;
const STAMINA_COLOR = 0x6f9fd0;
const ATTACK_COLOR = 0xd0a05f;

/**
 * 스탯 막대가 가득 찼다고 볼 기준값. 레벨·성장 상한이 아직 없어서 "지금 수치가 대략
 * 어디쯤인가"만 보여주는 눈금이다 — 숫자는 막대 옆에 그대로 적으므로 이 값이 조금
 * 어긋나도 정보가 틀리지는 않는다. 성장 상한이 생기면 그 값으로 바꾼다.
 */
const STAT_FULL = { hp: 200, stamina: 200, attack: 40 } as const;

/**
 * 캐릭터 정보 창 — 초상화·이름·스탯·스킬.
 *
 * **레벨과 스킬은 아직 없다.** 그래도 자리를 먼저 잡아 두는 이유는, 스탯을 어디서 보는지가
 * 정해져야 HUD(하단 직업/스탯 버튼)와 이어지기 때문이다. 아직 동작하지 않는 것들은
 * 흐리게 두고 안내 문구를 달았다 — 눌리는 것처럼 보이는데 아무 일도 안 하는 게 제일 나쁘다.
 */
export class CharacterModal extends Modal {
  /** 스탯 포인트를 하나 쓴다. HudScene이 서버로 보낸다. */
  onSpendPoint: (stat: 'maxHp' | 'attack' | 'stamina') => void = () => {};

  private readonly plusButtons: (Phaser.GameObjects.NineSlice | Phaser.GameObjects.Rectangle)[] = [];

  private readonly portrait: Phaser.GameObjects.Sprite | Phaser.GameObjects.Rectangle;
  private readonly levelText: Phaser.GameObjects.Text;
  private readonly nameText: Phaser.GameObjects.Text;
  private readonly jobText: Phaser.GameObjects.Text;
  private readonly spText: Phaser.GameObjects.Text;
  private readonly statFills: Phaser.GameObjects.Rectangle[] = [];
  private readonly statValues: Phaser.GameObjects.Text[] = [];
  private readonly statBarWidth: number;
  private readonly skillHint: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene) {
    super(scene, { title: '캐릭터', width: PANEL_WIDTH, height: PANEL_HEIGHT });

    const page = this.builder;

    // --- 초상화. 아틀라스가 없으면 빈 칸으로 남는다(다른 UI와 같은 규칙).
    page.addSection(0, 0, PORTRAIT_WIDTH, PORTRAIT_HEIGHT);
    const hasSprite =
      scene.textures.exists(GAME_ATLAS) &&
      scene.textures.get(GAME_ATLAS).has(idleFrame(spritePrefix(''), 'front'));
    this.portrait = hasSprite
      ? scene.add
          .sprite(PORTRAIT_WIDTH / 2, PORTRAIT_HEIGHT / 2, GAME_ATLAS, idleFrame(spritePrefix(''), 'front'))
          .setOrigin(0.5, 0.5)
          .setScale(4)
      : scene.add
          .rectangle(PORTRAIT_WIDTH / 2, PORTRAIT_HEIGHT / 2, 64, 96, PANEL_FILL)
          .setStrokeStyle(1, PANEL_STROKE);
    page.add(this.portrait);

    // --- 이름 줄. 레벨은 자리만 잡아 둔다.
    const rightX = PORTRAIT_WIDTH + SECTION_GAP * 2;
    // 레벨은 아직 없다 — 자리와 눈금만 잡아 두고 값은 '-'로 비워 둔다. 나중에 레벨이
    // 생기면 이 글자만 채우면 되고 배치는 그대로다.
    this.levelText = scene.add.text(rightX, 4, 'Lv -', {
      fontFamily: FONT,
      fontSize: `${SIZE_BODY}px`,
      color: DIM_TEXT,
    });
    page.add(this.levelText);
    this.nameText = scene.add.text(rightX + 44, 0, '-', {
      fontFamily: FONT,
      fontSize: `${SIZE_BODY + 6}px`,
      color: BODY_TEXT,
    });
    this.jobText = scene.add.text(rightX, 26, '', {
      fontFamily: FONT,
      fontSize: `${SIZE_BODY}px`,
      color: ACCENT,
    });
    this.spText = scene.add
      .text(page.width, 26, 'SP 0', {
        fontFamily: FONT,
        fontSize: `${SIZE_BODY}px`,
        color: DIM_TEXT,
      })
      .setOrigin(1, 0);
    page.add(this.nameText);
    page.add(this.jobText);
    page.add(this.spText);

    // --- 스탯 세 줄. 막대 오른쪽 [+]로 스탯 포인트를 하나씩 쓴다.
    const statsTop = 56;
    this.statBarWidth = page.width - rightX - STAT_BUTTON - SECTION_GAP;
    const stats = ['체력 스탯', '스태미나 스탯', '공격력 스탯'];
    const colors = [0x6fd08c, STAMINA_COLOR, ATTACK_COLOR];
    // 화면 순서(체력·스태미나·공격력)와 서버가 받는 이름을 나란히 둔다.
    const statIds: ('maxHp' | 'stamina' | 'attack')[] = ['maxHp', 'stamina', 'attack'];

    stats.forEach((label, index) => {
      const y = statsTop + index * (STAT_ROW_HEIGHT + STAT_ROW_GAP);

      page.add(
        scene.add.text(rightX, y, label, {
          fontFamily: FONT_SMALL,
          fontSize: `${SIZE_SMALL}px`,
          color: DIM_TEXT,
        }),
      );

      const barY = y + 12;
      page.add(
        scene.add.rectangle(rightX, barY, this.statBarWidth, STAT_ROW_HEIGHT, BAR_BACK).setOrigin(0, 0),
      );
      const fill = scene.add
        .rectangle(rightX, barY, 0, STAT_ROW_HEIGHT, colors[index])
        .setOrigin(0, 0);
      page.add(fill);
      this.statFills.push(fill);

      const value = scene.add
        .text(rightX + this.statBarWidth - 8, barY + STAT_ROW_HEIGHT / 2, '0', {
          fontFamily: FONT,
          fontSize: `${SIZE_BODY}px`,
          color: BODY_TEXT,
        })
        .setOrigin(1, 0.5);
      page.add(value);
      this.statValues.push(value);

      /*
       * 올리기 버튼. **포인트가 없으면 흐리게 하고 입력을 끈다** — 눌리는 것처럼
       * 보이는데 아무 일도 안 하는 게 제일 나쁘다(하단 바 작업에서 세운 규칙).
       * 실제 차감은 서버가 하고, 여기서는 보낼 뿐이다.
       */
      const plus = page.addButton(
        page.width - STAT_BUTTON,
        barY - 2,
        STAT_BUTTON,
        STAT_BUTTON,
        '+',
        () => this.onSpendPoint(statIds[index]!),
      );
      this.plusButtons.push(plus);
    });

    // --- 아래: 스킬 목록과 설명.
    const bottomTop = statsTop + stats.length * (STAT_ROW_HEIGHT + STAT_ROW_GAP) + SECTION_GAP;
    const bottomHeight = page.height - bottomTop;
    const skillWidth = Math.round(page.width * 0.62);

    page.addSection(0, bottomTop, skillWidth, bottomHeight);
    page.addSectionTitle(SECTION_PAD, bottomTop + SECTION_PAD, 'Skill');

    // 와이어프레임의 2 + 4 배치 — 왼쪽 둘은 한 줄, 오른쪽 넷은 2×2다.
    const slotsTop = bottomTop + SECTION_PAD + 18;
    const rowMid = slotsTop + SKILL_SLOT / 2 + (SKILL_SLOT + SKILL_GAP) / 2;
    this.addSkillSlot(SECTION_PAD, rowMid - SKILL_SLOT / 2);
    this.addSkillSlot(SECTION_PAD + SKILL_SLOT + SKILL_GAP, rowMid - SKILL_SLOT / 2);
    const gridX = SECTION_PAD + (SKILL_SLOT + SKILL_GAP) * 2 + SKILL_GAP;
    for (let index = 0; index < 4; index += 1) {
      this.addSkillSlot(
        gridX + (index % 2) * (SKILL_SLOT + SKILL_GAP),
        slotsTop + Math.floor(index / 2) * (SKILL_SLOT + SKILL_GAP),
      );
    }

    const infoX = skillWidth + SECTION_GAP;
    page.addSection(infoX, bottomTop, page.width - infoX, bottomHeight);
    this.addSkillSlot(infoX + SECTION_PAD, bottomTop + SECTION_PAD);
    this.skillHint = scene.add.text(
      infoX + SECTION_PAD,
      bottomTop + SECTION_PAD + SKILL_SLOT + 8,
      '스킬은 준비 중이다',
      {
        fontFamily: FONT_SMALL,
        fontSize: `${SIZE_SMALL}px`,
        color: DIM_TEXT,
        wordWrap: { width: page.width - infoX - SECTION_PAD * 2 },
      },
    );
    page.add(this.skillHint);

    const unlock = page.addButton(
      infoX + SECTION_PAD,
      bottomTop + bottomHeight - SECTION_PAD - 28,
      page.width - infoX - SECTION_PAD * 2,
      28,
      'Unlock',
      () => {},
    );
    unlock.setAlpha(0.4);
    unlock.disableInteractive();
  }

  /** 빈 스킬 칸 하나. 아직 담을 스킬이 없어 테두리만 그린다. */
  private addSkillSlot(x: number, y: number): void {
    this.builder.add(
      this.scene.add
        .rectangle(x, y, SKILL_SLOT, SKILL_SLOT, PANEL_FILL, 0.8)
        .setOrigin(0, 0)
        .setStrokeStyle(1, PANEL_STROKE),
    );
  }

  /** 스냅샷마다 호출된다. 창이 닫혀 있어도 값만 갱신하면 되므로 비용이 거의 없다. */
  setPlayer(me: PlayerView | undefined): void {
    if (!me) return;

    this.levelText.setText(`Lv ${me.level}`);
    this.spText.setText(`SP ${me.statPoints}`);
    const canSpend = me.statPoints > 0;
    for (const button of this.plusButtons) {
      button.setAlpha(canSpend ? 1 : 0.4);
      if (canSpend) button.setInteractive({ useHandCursor: true });
      else button.disableInteractive();
    }

    this.nameText.setText(me.nickname || '생존자');
    this.jobText.setText(me.job ? jobName(me.job) : '직업 미선택');

    if (this.portrait instanceof Phaser.GameObjects.Sprite) {
      const frame = idleFrame(spritePrefix(me.job), 'front');
      if (this.portrait.texture.has(frame)) this.portrait.setFrame(frame);
    }

    this.setStat(0, me.maxHp, STAT_FULL.hp, barColor(1));
    this.setStat(1, me.maxStamina, STAT_FULL.stamina, STAMINA_COLOR);
    this.setStat(2, me.attack, STAT_FULL.attack, ATTACK_COLOR);
  }

  private setStat(index: number, value: number, full: number, color: number): void {
    const ratio = Math.min(1, Math.max(0, value / full));
    this.statFills[index]!.width = this.statBarWidth * ratio;
    this.statFills[index]!.fillColor = color;
    this.statValues[index]!.setText(String(Math.round(value)));
  }
}
