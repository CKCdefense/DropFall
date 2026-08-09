import Phaser from 'phaser';
import { jobName } from '@dropfall/shared';
import type { PlayerView } from '../../net/GameConnection';
import { Modal } from './Modal';
import { GAME_ATLAS, idleFrame, spritePrefix } from '../render/playerSprite';
import {
  BAR_SMALL,
  HUD_ATLAS,
  HUD_BAR_SCALE,
  HudBar,
  ICON_BOLT,
  ICON_HEART,
  ICON_SWORD,
} from './hudBar';
import {
  STAT_ATTACK_COLOR,
  STAT_FULL,
  STAT_HP_COLOR,
  STAT_STAMINA_COLOR,
} from './statDisplay';
import {
  ACCENT,
  BODY_TEXT,
  DIM_TEXT,
  FONT,
  FONT_SMALL,
  PANEL_FILL,
  PANEL_STROKE,
  SIZE_BODY,
  SIZE_SMALL,
} from './theme';

const PANEL_WIDTH = 560;
const PANEL_HEIGHT = 480;

const SECTION_PAD = 12;
const SECTION_GAP = 10;

/** ACCENT('#6fd08c')의 숫자판 — setStrokeStyle은 숫자 색만 받는다. */
const ACCENT_STROKE = 0x6fd08c;
/** 홀로그램 판 바닥 — 상단 탭·다른 창의 버튼과 같은 값(Modal.BOARD_FILL). */
const HOLO_FILL = 0x0f1117;

/** 왼쪽 위 초상화 칸. 오른쪽 스탯 칸과 같은 높이로 선다. */
const PORTRAIT_WIDTH = 150;
const HEADER_HEIGHT = 224;

/** 스탯 한 줄: 제목 줄(아이콘·이름·값) + 픽셀 게이지. 오른쪽에 [+]가 선다. */
const STAT_ROW_PITCH = 50;
const STAT_ICON_SCALE = 2;
const STAT_ICON_SIZE = 12 * STAT_ICON_SCALE;
const STAT_BUTTON = 42;
/** SP 표식 칸(홀로그램 배지). */
const SP_WIDTH = 92;
const SP_HEIGHT = 34;

/** 스킬 칸 한 변. 아래 구역에 2 + 4 배치로 들어간다(와이어프레임). */
const SKILL_SLOT = 42;
const SKILL_GAP = 10;

/**
 * 캐릭터 정보 창 — 초상화·이름·스탯·스킬.
 *
 * 스탯 세 줄은 하단 직업/스탯 칸과 **같은 그림**이다(아이콘·게이지·눈금 전부,
 * §statDisplay) — 칸의 축소판을 보고 눌러서 들어온 사람이 같은 물건의 큰 판을
 * 만나야 한다. 값의 크기는 게이지가, 정확한 수치는 오른쪽 숫자가 말한다.
 *
 * **레벨과 스킬은 아직 없다.** 그래도 자리를 먼저 잡아 두는 이유는, 스탯을 어디서
 * 보는지가 정해져야 HUD(하단 직업/스탯 버튼)와 이어지기 때문이다. 아직 동작하지 않는
 * 것들은 흐리게 두고 안내 문구를 달았다 — 눌리는 것처럼 보이는데 아무 일도 안 하는 게
 * 제일 나쁘다.
 */
export class CharacterModal extends Modal {
  /** 스탯 포인트를 하나 쓴다. HudScene이 서버로 보낸다. */
  onSpendPoint: (stat: 'maxHp' | 'attack' | 'stamina') => void = () => {};

  private readonly plusButtons: { box: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text }[] = [];

  private readonly portrait: Phaser.GameObjects.Sprite | Phaser.GameObjects.Rectangle;
  private readonly levelText: Phaser.GameObjects.Text;
  private readonly nameText: Phaser.GameObjects.Text;
  private readonly jobText: Phaser.GameObjects.Text;
  private readonly spBox: Phaser.GameObjects.Rectangle;
  private readonly spText: Phaser.GameObjects.Text;
  private readonly statBars: HudBar[] = [];
  private readonly statValues: Phaser.GameObjects.Text[] = [];
  private readonly skillHint: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene) {
    // 제목은 가이드 창과 같은 22px 볼드 — 11px 기본값은 창 크기에 비해 문패가 너무 작았다.
    super(scene, { title: '캐릭터', width: PANEL_WIDTH, height: PANEL_HEIGHT, titleSize: SIZE_BODY * 2 });

    const page = this.builder;

    // --- 초상화. 아틀라스가 없으면 빈 칸으로 남는다(다른 UI와 같은 규칙).
    page.addSection(0, 0, PORTRAIT_WIDTH, HEADER_HEIGHT);
    const hasSprite =
      scene.textures.exists(GAME_ATLAS) &&
      scene.textures.get(GAME_ATLAS).has(idleFrame(spritePrefix(''), 'front'));
    this.portrait = hasSprite
      ? scene.add
          .sprite(PORTRAIT_WIDTH / 2, HEADER_HEIGHT / 2, GAME_ATLAS, idleFrame(spritePrefix(''), 'front'))
          .setOrigin(0.5, 0.5)
          .setScale(4)
      : scene.add
          .rectangle(PORTRAIT_WIDTH / 2, HEADER_HEIGHT / 2, 64, 96, PANEL_FILL)
          .setStrokeStyle(1, PANEL_STROKE);
    page.add(this.portrait);

    // --- 오른쪽: 이름 줄 + 스탯 세 줄을 **한 상자**로 묶는다. 예전엔 판 바닥에 바로
    // 떠 있어서 무엇이 한 덩어리인지 경계가 없었다.
    const rightX = PORTRAIT_WIDTH + SECTION_GAP;
    const rightWidth = page.width - rightX;
    page.addSection(rightX, 0, rightWidth, HEADER_HEIGHT);

    const innerX = rightX + SECTION_PAD;
    const innerWidth = rightWidth - SECTION_PAD * 2;

    // 이름은 이 상자의 제목이다 — 코어 창의 "코어 현황"과 같은 22px 굵은 규격.
    this.nameText = scene.add.text(innerX, SECTION_PAD, '-', {
      fontFamily: FONT,
      fontSize: `${SIZE_BODY * 2}px`,
      fontStyle: 'bold',
      color: BODY_TEXT,
    });
    this.jobText = scene.add.text(innerX, SECTION_PAD + 28, '', {
      fontFamily: FONT,
      fontSize: `${SIZE_BODY}px`,
      fontStyle: 'bold',
      color: ACCENT,
    });
    this.levelText = scene.add
      .text(innerX + innerWidth - SP_WIDTH - SECTION_PAD, SECTION_PAD + SP_HEIGHT / 2, 'Lv -', {
        fontFamily: FONT,
        fontSize: `${SIZE_BODY}px`,
        fontStyle: 'bold',
        color: DIM_TEXT,
      })
      .setOrigin(1, 0.5);
    page.add(this.nameText);
    page.add(this.jobText);
    page.add(this.levelText);

    // SP 배지 — 오른쪽 위 홀로그램 판. 포인트가 있으면 초록 테두리 + 초록 글자로
    // "여기 쓸 게 있다"를 말하고, 없으면 회색으로 가라앉는다.
    this.spBox = scene.add
      .rectangle(innerX + innerWidth - SP_WIDTH, SECTION_PAD, SP_WIDTH, SP_HEIGHT, HOLO_FILL, 1)
      .setOrigin(0, 0)
      .setStrokeStyle(1, PANEL_STROKE);
    page.add(this.spBox);
    this.spText = scene.add
      .text(innerX + innerWidth - SP_WIDTH / 2, SECTION_PAD + SP_HEIGHT / 2, 'SP 0', {
        fontFamily: FONT,
        fontSize: `${SIZE_BODY * 2}px`,
        fontStyle: 'bold',
        color: DIM_TEXT,
      })
      .setOrigin(0.5, 0.5);
    page.add(this.spText);

    // --- 스탯 세 줄: [아이콘] 이름 ....... 값 / [게이지] ‖ [+]
    // 하단 직업/스탯 칸과 같은 아이콘·같은 눈금이다(§statDisplay).
    const statsTop = SECTION_PAD + 58;
    const rows: { label: string; icon: string; stat: 'maxHp' | 'stamina' | 'attack' }[] = [
      { label: '체력', icon: ICON_HEART, stat: 'maxHp' },
      { label: '스태미나', icon: ICON_BOLT, stat: 'stamina' },
      { label: '공격력', icon: ICON_SWORD, stat: 'attack' },
    ];
    const barX = innerX + STAT_ICON_SIZE + 8;
    const barWidth = innerX + innerWidth - STAT_BUTTON - SECTION_GAP - barX;

    rows.forEach((row, index) => {
      const y = statsTop + index * STAT_ROW_PITCH;

      // 아이콘은 제목 줄이 아니라 **줄 전체**(제목+게이지)의 세로 중앙에 놓는다.
      if (scene.textures.exists(HUD_ATLAS) && scene.textures.get(HUD_ATLAS).has(row.icon)) {
        const icon = scene.add
          .image(innerX, y + 16, HUD_ATLAS, row.icon)
          .setOrigin(0, 0.5)
          .setScale(STAT_ICON_SCALE);
        page.add(icon);
      }

      page.add(
        scene.add.text(barX, y, row.label, {
          fontFamily: FONT,
          fontSize: `${SIZE_BODY}px`,
          fontStyle: 'bold',
          color: DIM_TEXT,
        }),
      );
      const value = scene.add
        .text(barX + barWidth, y, '0', {
          fontFamily: FONT,
          fontSize: `${SIZE_BODY}px`,
          fontStyle: 'bold',
          color: BODY_TEXT,
        })
        .setOrigin(1, 0);
      page.add(value);
      this.statValues.push(value);

      // 픽셀 게이지 — 코어 창·하단 칸과 같은 규격(BAR_SMALL, 화면 16px).
      const bar = new HudBar(scene, BAR_SMALL);
      bar.attach((object) => page.add(object));
      bar.layout(barX, y + 14, barWidth, HUD_BAR_SCALE);
      this.statBars.push(bar);

      /*
       * 올리기 버튼 — 홀로그램 판(다른 창의 버튼과 같은 재질) + 큰 22px 굵은 [+].
       * **포인트가 없으면 흐리게 하고 입력을 끈다** — 눌리는 것처럼 보이는데 아무 일도
       * 안 하는 게 제일 나쁘다. 실제 차감은 서버가 하고, 여기서는 보낼 뿐이다.
       */
      const plus = page.addHoloButton(
        innerX + innerWidth - STAT_BUTTON,
        y - 6,
        STAT_BUTTON,
        STAT_BUTTON,
        '+',
        () => this.onSpendPoint(row.stat),
        SIZE_BODY * 2,
      );
      this.plusButtons.push(plus);
    });

    // --- 아래: 스킬 목록과 설명.
    const bottomTop = HEADER_HEIGHT + SECTION_GAP;
    const bottomHeight = page.height - bottomTop;
    const skillWidth = Math.round(page.width * 0.62);

    page.addSection(0, bottomTop, skillWidth, bottomHeight);
    // 구역 제목도 굵게 — 흐린 7px 제목은 창 안에서 이 구역만 격이 달라 보였다.
    page.add(
      scene.add.text(SECTION_PAD, bottomTop + SECTION_PAD, '스킬', {
        fontFamily: FONT,
        fontSize: `${SIZE_BODY}px`,
        fontStyle: 'bold',
        color: BODY_TEXT,
      }),
    );

    // 와이어프레임의 2 + 4 배치 — 왼쪽 둘은 한 줄, 오른쪽 넷은 2×2다.
    const slotsTop = bottomTop + SECTION_PAD + 22;
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

    const unlock = page.addHoloButton(
      infoX + SECTION_PAD,
      bottomTop + bottomHeight - SECTION_PAD - 32,
      page.width - infoX - SECTION_PAD * 2,
      32,
      '해금 준비 중',
      () => {},
    );
    unlock.box.setAlpha(0.4);
    unlock.label.setAlpha(0.4);
    unlock.box.disableInteractive();
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
    const canSpend = me.statPoints > 0;
    this.spText.setText(`SP ${me.statPoints}`).setColor(canSpend ? ACCENT : DIM_TEXT);
    this.spBox.setStrokeStyle(1, canSpend ? ACCENT_STROKE : PANEL_STROKE);
    for (const { box, label } of this.plusButtons) {
      box.setAlpha(canSpend ? 1 : 0.4);
      label.setAlpha(canSpend ? 1 : 0.4);
      if (canSpend) box.setInteractive({ useHandCursor: true });
      else box.disableInteractive();
    }

    this.nameText.setText(me.nickname || '생존자');
    this.jobText.setText(me.job ? jobName(me.job) : '직업 미선택');

    if (this.portrait instanceof Phaser.GameObjects.Sprite) {
      const frame = idleFrame(spritePrefix(me.job), 'front');
      if (this.portrait.texture.has(frame)) this.portrait.setFrame(frame);
    }

    this.setStat(0, me.maxHp, STAT_FULL.hp, STAT_HP_COLOR);
    this.setStat(1, me.maxStamina, STAT_FULL.stamina, STAT_STAMINA_COLOR);
    this.setStat(2, me.attack, STAT_FULL.attack, STAT_ATTACK_COLOR);
  }

  private setStat(index: number, value: number, full: number, color: number): void {
    const ratio = Math.min(1, Math.max(0, value / full));
    this.statBars[index]!.setValue(ratio, color, HUD_BAR_SCALE);
    this.statValues[index]!.setText(String(Math.round(value)));
  }
}
