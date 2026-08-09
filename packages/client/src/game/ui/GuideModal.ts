import Phaser from 'phaser';
import { SLOT_COUNT } from '@dropfall/shared';
import { Modal } from './Modal';
import { HUD_ATLAS } from './hudBar';
import { ACCENT, BODY_TEXT, DIM_TEXT, FONT, FONT_SMALL, SIZE_BODY, SIZE_SMALL } from './theme';

/**
 * 조작법 안내 창. 미니맵 옆 `?` 버튼으로 열고 닫는다.
 *
 * 조작을 **글자로만** 나열하면 "E: 코어" 같은 목록이 되어 읽기 전에는 눈에 안 들어온다.
 * 코어 위에 뜨는 키 안내(`ui_keyprompt`)가 이미 "키캡 그림"이라는 어휘를 만들어 뒀으니,
 * 같은 어휘로 줄을 세우면 어느 줄이 어떤 키인지 그림만 보고도 잡힌다.
 *
 * 키캡은 빈 그림 한 장(`hud_keycap`)을 9-slice로 늘여 쓰고 글자는 폰트로 얹는다 —
 * 키가 늘 때마다 비트맵을 새로 찍을 이유가 없다(assets/_generators/ui_keycap.lua).
 */

/**
 * 두 **열**로 나눈다. 한 열로 세우면 항목 12줄에 설명까지 붙어 세로 500px을 넘는데,
 * 창 높이는 화면에서 하단 바를 뺀 만큼으로 잘리므로(Modal) 작은 창에서는 아래가 잘린다.
 * 조작표는 원래 훑어보는 물건이라 가로로 펼치는 편이 읽기도 낫다.
 */
const PANEL_WIDTH = 620;
const PANEL_HEIGHT = 400;
/** 두 열 사이 간격. */
const COLUMN_GAP = 24;
/** Modal이 내용 컨테이너를 창 안쪽으로 들여놓은 여백. 열 폭 계산에 같은 값을 쓴다. */
const PAD_X = 20;

/** 키캡 원본 크기와 9-slice 보존 폭. ui_keycap.lua가 그린 값과 같아야 한다. */
const CAP_FRAME = 'hud_keycap_base_0';
const CAP_HEIGHT = 20;
const CAP_BORDER = 7;
/** 글자 좌우 여백. 이 값 때문에 'W'는 좁고 'SPACE'는 넓어진다. */
const CAP_TEXT_PAD = 9;
/** 키캡 최소 폭 — 한 글자짜리도 정사각형에 가깝게 보이도록. */
const CAP_MIN_WIDTH = 24;
/** 키캡 사이 간격과 줄 간격. */
const CAP_GAP = 5;
const ROW_GAP = 9;
/** 열 안에서 키캡 묶음이 차지하는 폭. 여기서 설명 글이 시작한다 — 줄마다 어긋나면 표로 안 읽힌다. */
const KEYS_COLUMN = 132;

interface GuideRow {
  /** 이 줄에 그릴 키캡들. 여러 개면 나란히 놓인다(WASD처럼). */
  keys: readonly string[];
  label: string;
  /** 있으면 설명 아래 한 줄 더. 예외나 조건을 적는다. */
  note?: string;
}

interface GuideSection {
  title: string;
  rows: readonly GuideRow[];
}

/**
 * 조작 목록. **InputController의 실제 바인딩과 짝을 맞춰야 한다** — 여기만 고치고
 * 키를 안 바꾸면 안내가 거짓말이 된다.
 */
const SECTIONS: readonly GuideSection[] = [
  {
    title: '이동',
    rows: [
      { keys: ['W', 'A', 'S', 'D'], label: '이동' },
      { keys: ['SHIFT'], label: '달리기', note: '스태미나를 쓴다 — 실제로 움직일 때만 닳는다' },
    ],
  },
  {
    title: '전투 · 채집',
    rows: [
      { keys: ['좌클릭'], label: '공격 · 채집', note: '자원 노드를 때리면 채집이 된다' },
      { keys: ['우클릭'], label: '아이템 사용', note: '붕대 같은 소모품' },
      { keys: ['R'], label: '재장전' },
      { keys: ['X'], label: '점사 전환', note: '돌격소총처럼 점사가 있는 무기만' },
    ],
  },
  {
    title: '아이템',
    rows: [
      { keys: ['SPACE'], label: '줍기' },
      { keys: ['1', `${SLOT_COUNT}`], label: '퀵슬롯 선택', note: '퀵슬롯을 클릭해도 같다' },
      { keys: ['SHIFT', '클릭'], label: '빠른 옮기기', note: '보고 있는 탭으로 보낸다 — 창고 또는 코어 충전' },
    ],
  },
  {
    title: '코어 · 협동',
    rows: [
      { keys: ['E'], label: '코어 창 열기', note: '코어 앞에서만. 멀어지면 저절로 닫힌다' },
      { keys: ['E'], label: '동료 구조', note: '쓰러진 동료 옆에서 누르고 있는다' },
      { keys: ['V'], label: '낮 넘기기 투표', note: '전원이 동의해야 넘어간다' },
    ],
  },
];

export class GuideModal extends Modal {
  constructor(scene: Phaser.Scene) {
    super(scene, { title: '조작법', width: PANEL_WIDTH, height: PANEL_HEIGHT });
    this.build(scene);
  }

  private build(scene: Phaser.Scene): void {
    const textured =
      scene.textures.exists(HUD_ATLAS) && scene.textures.get(HUD_ATLAS).has(CAP_FRAME);

    // 앞 절반은 왼쪽, 뒤 절반은 오른쪽 열에 쌓는다. 열마다 y를 따로 세면 한쪽이
    // 길어져도 다른 쪽이 딸려 내려가지 않는다.
    const half = Math.ceil(SECTIONS.length / 2);
    const columnWidth = (PANEL_WIDTH - PAD_X * 2 - COLUMN_GAP) / 2;

    SECTIONS.forEach((section, index) => {
      const column = index < half ? 0 : 1;
      const left = column * (columnWidth + COLUMN_GAP);
      let y = this.columnY[column];

      const head = scene.add
        .text(left, y, section.title, {
          fontFamily: FONT,
          fontSize: `${SIZE_BODY}px`,
          fontStyle: 'bold',
          color: ACCENT,
        })
        .setOrigin(0, 0);
      this.content.add(head);
      y += SIZE_BODY + 8;

      for (const row of section.rows) {
        y = this.addKeyRow(scene, row, left, y, textured, columnWidth);
      }
      this.columnY[column] = y + ROW_GAP;
    });
  }

  /** 열별로 다음 줄이 들어갈 y. build가 순서대로 쌓는다. */
  private readonly columnY: [number, number] = [0, 0];

  /** 한 줄을 그리고 다음 줄이 시작할 y를 돌려준다. */
  private addKeyRow(
    scene: Phaser.Scene,
    row: GuideRow,
    left: number,
    top: number,
    textured: boolean,
    columnWidth: number,
  ): number {
    let x = left;
    row.keys.forEach((key, index) => {
      // 'W A S D'처럼 이어지는 키는 사이에 이음표를 넣지 않는다 — 키캡이 나란히
      // 붙어 있는 것만으로 "이 넷"이라는 뜻이 선다.
      const label = scene.add
        .text(0, 0, key, {
          fontFamily: key.length > 2 ? FONT_SMALL : FONT,
          fontSize: `${key.length > 2 ? SIZE_SMALL : SIZE_BODY}px`,
          color: '#14161d',
        })
        .setOrigin(0.5, 0.5);
      const width = Math.max(CAP_MIN_WIDTH, Math.ceil(label.width) + CAP_TEXT_PAD * 2);

      if (textured) {
        const cap = scene.add
          .nineslice(x, top, HUD_ATLAS, CAP_FRAME, width, CAP_HEIGHT, CAP_BORDER, CAP_BORDER, 0, 0)
          .setOrigin(0, 0);
        this.content.add(cap);
      }
      // 글자는 키캡 **윗면**의 가운데다. 아래 4px은 옆면(두께)이라 거기까지 세면
      // 글자가 한 픽셀 내려앉아 보인다.
      label.setPosition(x + width / 2, top + (CAP_HEIGHT - 4) / 2);
      this.content.add(label);

      x += width + CAP_GAP;
      // 1~4처럼 "부터 까지"인 묶음은 사이에 물결표를 넣는다.
      if (row.keys.length === 2 && index === 0 && /^\d+$/.test(key)) {
        const tilde = scene.add
          .text(x, top + CAP_HEIGHT / 2, '~', {
            fontFamily: FONT,
            fontSize: `${SIZE_BODY}px`,
            color: DIM_TEXT,
          })
          .setOrigin(0, 0.5);
        this.content.add(tilde);
        x += Math.ceil(tilde.width) + CAP_GAP;
      }
    });

    const label = scene.add
      .text(left + KEYS_COLUMN, top + 2, row.label, {
        fontFamily: FONT,
        fontSize: `${SIZE_BODY}px`,
        color: BODY_TEXT,
      })
      .setOrigin(0, 0);
    this.content.add(label);

    let bottom = top + CAP_HEIGHT;
    if (row.note) {
      const note = scene.add
        .text(left + KEYS_COLUMN, top + SIZE_BODY + 6, row.note, {
          fontFamily: FONT_SMALL,
          fontSize: `${SIZE_SMALL}px`,
          color: DIM_TEXT,
          wordWrap: { width: columnWidth - KEYS_COLUMN },
        })
        .setOrigin(0, 0);
      this.content.add(note);
      bottom = Math.max(bottom, note.y + note.height);
    }
    return bottom + ROW_GAP;
  }
}
