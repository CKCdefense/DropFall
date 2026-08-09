import Phaser from 'phaser';
import { SLOT_COUNT } from '@dropfall/shared';
import { Modal } from './Modal';
import { GAME_ATLAS } from '../render/playerSprite';
import { MONSTER_ATLAS, monsterIdleFrame } from '../render/monsterSprite';
import { HUD_ATLAS } from './hudBar';
import { ACCENT, BODY_TEXT, DIM_TEXT, FONT, FONT_SMALL, SIZE_BODY, SIZE_SMALL } from './theme';

/**
 * 가이드 창. 미니맵 옆 `?` 버튼으로 열고 닫는다.
 *
 * 1쪽은 조작법, 2쪽부터는 게임 진행 안내다. 아래 화살표(키캡 버튼)로 넘긴다 —
 * 처음 하는 사람이 "뭘 눌러야 하나"(1쪽)와 "뭘 해야 하나"(2쪽~)를 한 창에서 얻는다.
 *
 * 조작법은 키캡 그림으로 줄을 세운다. 글자로만 나열하면 "E: 코어" 같은 목록이 되어
 * 읽기 전에는 눈에 안 들어오는데, 코어 위의 키 안내(`ui_keyprompt`)가 이미 만들어 둔
 * "키캡" 어휘를 그대로 쓰면 그림만 보고도 잡힌다. 키캡은 빈 그림 한 장(`hud_keycap`)을
 * 9-slice로 늘여 쓰고 글자는 폰트로 얹는다(assets/_generators/ui_keycap.lua).
 *
 * 진행 안내 쪽 그림은 **게임에 실제로 나오는 스프라이트**를 그대로 쓴다 — 가이드에서
 * 본 그 그림이 화면에 그대로 나와야 "아, 이거"가 된다. 몬스터 아틀라스는 라이센스
 * 문제로 없을 수 있으므로(monsters/README.md) 없으면 그림만 조용히 빠진다.
 */

/**
 * 키캡 확대 배수. 그림은 **원본 픽셀 단위**로 크기를 주고 배율을 따로 건다 —
 * 화면 픽셀을 그대로 넣으면 늘어나는 가운데만 커지고 모서리와 옆면 두께는 1px에
 * 머물러서, "픽셀로 만든 키보드"가 아니라 밋밋한 사각형이 된다(HudBar와 같은 규칙).
 */
const KEYCAP_SCALE = 2;
/** 키캡 원본 크기와 9-slice 보존 폭. ui_keycap.lua가 그린 값과 같아야 한다. */
const CAP_FRAME = 'hud_keycap_base_0';
const CAP_HEIGHT = 20;
const CAP_BORDER = 7;
/** 원본 기준 글자 좌우 여백. 이 값 때문에 'W'는 좁고 'SPACE'는 넓어진다. */
const CAP_TEXT_PAD = 7;
/** 원본 기준 키캡 최소 폭 — 한 글자짜리도 정사각형에 가깝게 보이도록. */
const CAP_MIN_WIDTH = 22;
/** 키캡 아래 4px(원본)은 옆면(두께)이라 글자는 윗면 가운데에 놓는다. */
const CAP_SIDE = 4;

/**
 * 글자 크기. 픽셀 폰트는 **설계 크기의 정수배**에서만 선명하다 —
 * Galmuri11은 11/22, Galmuri7은 7/14. 사이 값은 획이 뭉개진다.
 *
 * 창 제목·구역 제목·키캡 글자는 **굵은 자체**(Galmuri11-Bold)를 쓴다. 항목 이름과
 * 각주는 Galmuri7(14px)인데 **7에는 굵은 자체가 없어서** bold를 걸면 브라우저가 획을
 * 억지로 부풀린 가짜 굵기가 나온다 — 이름은 밝은 색, 각주는 흐린 색으로 가른다.
 */
const HEAD_FONT_SIZE = SIZE_BODY * 2;
const KEY_FONT_SIZE = SIZE_BODY * 2;
const LABEL_FONT_SIZE = SIZE_SMALL * 2;
const NOTE_FONT_SIZE = SIZE_SMALL * 2;

/**
 * 조작법은 두 **열**로 나눈다. 한 열로 세우면 항목 12줄이 창 높이를 넘는데,
 * 창 높이는 화면에서 하단 바를 뺀 만큼으로 잘리므로(Modal) 아래가 잘린다.
 * 조작표는 원래 훑어보는 물건이라 가로로 펼치는 편이 읽기도 낫다.
 */
const PANEL_WIDTH = 900;
const PANEL_HEIGHT = 510;
/** Modal이 내용 컨테이너를 창 안쪽으로 들여놓은 여백. 열 폭 계산에 같은 값을 쓴다. */
const PAD_X = 28;
/** 창 제목(22px)이 기본 머리 공간(38px)보다 커서, 내용을 그만큼 더 내린다. */
const INSET_TOP = 14;
/** 두 열 사이 간격. */
const COLUMN_GAP = 28;
/** 열 안에서 키캡 묶음이 차지하는 폭. 여기서 설명 글이 시작한다 — 줄마다 어긋나면 표로 안 읽힌다. */
const KEYS_COLUMN = 190;

const CAP_GAP = 8;
const ROW_GAP = 6;
/** 구역 제목과 첫 줄 사이, 구역과 구역 사이. */
const HEAD_GAP = 8;
const SECTION_GAP = 6;

/** 아래 페이지 넘김 줄이 차지하는 높이. 내용은 이 위에서 끝나야 한다. */
const NAV_HEIGHT = 44;

/** 진행 안내 쪽 그림 칸 폭과 그림을 맞출 상자 크기. */
const GUIDE_IMAGE_COLUMN = 96;
const GUIDE_IMAGE_FIT = 52;

interface GuideRow {
  /** 이 줄에 그릴 키캡들. 여러 개면 나란히 놓인다. */
  keys: readonly string[];
  label: string;
  /** 있으면 설명 아래 한 줄 더. 짧게 — 길면 두 줄로 넘어가 표가 흐트러진다. */
  note?: string;
  /**
   * `wasd`면 키캡을 실제 자판처럼 **ㅗ 모양**(W 위, A·S·D 아래)으로 쌓는다.
   * 한 줄로 늘어놓으면 손가락이 어디 놓이는지가 안 보인다.
   */
  layout?: 'wasd';
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
      { keys: ['W', 'A', 'S', 'D'], label: '이동', layout: 'wasd' },
      { keys: ['SHIFT'], label: '달리기', note: '스태미나 소모' },
    ],
  },
  {
    title: '전투 · 채집',
    rows: [
      { keys: ['좌클릭'], label: '공격 · 채집', note: '자원을 때리면 채집' },
      { keys: ['우클릭'], label: '아이템 사용', note: '붕대 등 소모품' },
      { keys: ['R'], label: '재장전' },
      { keys: ['X'], label: '점사 전환', note: '점사 있는 무기만' },
    ],
  },
  {
    title: '아이템',
    rows: [
      { keys: ['SPACE'], label: '줍기' },
      { keys: ['1', `${SLOT_COUNT}`], label: '퀵슬롯 선택', note: '슬롯 클릭도 같다' },
      { keys: ['SHIFT', '클릭'], label: '빠른 옮기기', note: '보고 있는 탭으로' },
    ],
  },
  {
    title: '코어 · 협동',
    rows: [
      { keys: ['E'], label: '코어 창 열기', note: '코어 앞에서만' },
      { keys: ['E'], label: '동료 구조', note: '누르고 있는다' },
      { keys: ['V'], label: '낮 넘기기 투표', note: '전원 동의 필요' },
    ],
  },
];

/** 진행 안내 한 줄 — 왼쪽 그림 + 제목 + 설명. 그림이 없는 줄은 글만 왼쪽부터 쓴다. */
interface GuideEntry {
  image?: { atlas: string; frame: string };
  /** 몬스터는 아틀라스가 없을 수 있어 타입만 적고 프레임은 열 때 계산한다. */
  monster?: string;
  head: string;
  body: string;
}

interface GuidePage {
  title: string;
  entries: readonly GuideEntry[];
}

/**
 * 진행 안내. 게임 규칙이 바뀌면 여기도 같이 고쳐야 한다 — 특히 숫자(낮 길이,
 * 부활 체력)는 shared 데이터와 어긋나면 안내가 거짓말이 된다.
 */
const GUIDE_PAGES: readonly GuidePage[] = [
  {
    title: '목표 — 코어를 지켜라',
    entries: [
      {
        image: { atlas: GAME_ATLAS, frame: 'core__0' },
        head: '코어',
        body: '정착지의 심장이다. 밤마다 몬스터가 코어로 몰려오고, 부서지면 그 자리에서 패배한다. 코어 앞에서 [E]로 창고·제작·상점을 쓴다.',
      },
      {
        head: '5일 밤을 버텨라',
        body: '낮(2분)에 준비하고, 밤에는 몰려온 적을 전멸시켜야 아침이 온다. 5일째 밤까지 모두 막아내면 방어 성공이다.',
      },
      {
        head: '전원 다운 = 패배',
        body: '쓰러진 동료는 옆에서 [E]를 눌러 구조한다. 아침이 오면 쓰러진 사람도 절반의 체력으로 일어난다 — 살아남은 사람은 회복되지 않는다.',
      },
    ],
  },
  {
    title: '낮 — 모으고 짓는다',
    entries: [
      {
        image: { atlas: GAME_ATLAS, frame: 'tree_full_0' },
        head: '채집',
        body: '나무·바위를 때리면 자원이 나온다. 모은 자원은 코어 앞에서 [E] → 창고에 입고해야 팀 전체가 쓴다.',
      },
      {
        image: { atlas: GAME_ATLAS, frame: 'fence_wood_wall_front_0' },
        head: '건축',
        body: '벽과 울타리로 몬스터의 길을 막는다. 울타리는 싸고 빠르게, 벽은 튼튼하게 — 단, 보스는 벽을 아주 빠르게 부순다.',
      },
      {
        image: { atlas: GAME_ATLAS, frame: 'colony_idle_0' },
        head: '콜로니',
        body: '맵 곳곳의 몬스터 둥지다. 낮에 정화하면 에너지를 얻고, 방치하면 밤에 그만큼 적이 늘어난다(왼쪽 패널의 +숫자).',
      },
      {
        head: '다 준비했다면',
        body: '[V] 또는 왼쪽 투표 판을 눌러 낮을 넘긴다 — 전원이 동의하면 바로 밤이 온다.',
      },
    ],
  },
  {
    title: '밤 — 전멸시켜야 끝난다',
    entries: [
      {
        monster: 'demon',
        head: '웨이브',
        body: '사방에서 몬스터가 몰려온다. 시간이 아니라 마릿수다 — 남은 적(왼쪽 패널·시계 링)을 전부 잡아야 아침이 온다.',
      },
      {
        monster: 'boss_demon',
        head: '보스',
        body: '2일째 밤부터, 잡몹을 전멸시키면 보스가 온다. 등 뒤도 보고, 플레이어보다 조금 빠르다 — 넓게 돌면서 예고 동작을 보고 피해라.',
      },
      {
        image: { atlas: GAME_ATLAS, frame: 'item_consumable_bandage_0' },
        head: '소모품을 아껴 두지 마라',
        body: '아침에 회복은 없다. 붕대·구급킷을 퀵슬롯에 두고 [우클릭]으로 그때그때 쓰는 쪽이 산다.',
      },
    ],
  },
];

export class GuideModal extends Modal {
  /** 쪽 컨테이너들. [0]이 조작법, 나머지가 진행 안내다. */
  private readonly pageContainers: Phaser.GameObjects.Container[] = [];
  private pageIndex = 0;
  private pageLabel!: Phaser.GameObjects.Text;
  private prevArrow!: Phaser.GameObjects.Container;
  private nextArrow!: Phaser.GameObjects.Container;

  /** 조작법 페이지에서 열별로 다음 줄이 들어갈 y. build가 순서대로 쌓는다. */
  private readonly columnY: [number, number] = [INSET_TOP, INSET_TOP];

  constructor(scene: Phaser.Scene) {
    super(scene, { title: '가이드', width: PANEL_WIDTH, height: PANEL_HEIGHT, titleSize: 22 });

    const controls = scene.add.container(0, 0);
    this.content.add(controls);
    this.pageContainers.push(controls);
    this.buildControls(scene, controls);

    for (const page of GUIDE_PAGES) {
      const container = scene.add.container(0, 0);
      this.content.add(container);
      this.pageContainers.push(container);
      this.buildGuidePage(scene, container, page);
    }

    this.buildNav(scene);
    this.showPage(0);
  }

  // ------------------------------------------------------------- 페이지 넘김

  private buildNav(scene: Phaser.Scene): void {
    const textured =
      scene.textures.exists(HUD_ATLAS) && scene.textures.get(HUD_ATLAS).has(CAP_FRAME);
    const centerX = (PANEL_WIDTH - PAD_X * 2) / 2;
    const y = this.contentHeight - NAV_HEIGHT + 4;

    this.pageLabel = scene.add
      .text(centerX, y + (CAP_HEIGHT * KEYCAP_SCALE) / 2, '', {
        fontFamily: FONT_SMALL,
        fontSize: `${NOTE_FONT_SIZE}px`,
        color: DIM_TEXT,
      })
      .setOrigin(0.5, 0.5);
    this.content.add(this.pageLabel);

    // 화살표도 키캡이다 — 조작법 페이지의 그림 어휘를 버튼에도 그대로 쓴다.
    this.prevArrow = this.navArrow(scene, '<', centerX - 96, y, textured, -1);
    this.nextArrow = this.navArrow(scene, '>', centerX + 96, y, textured, 1);
  }

  /** 화살표 키캡 버튼 하나. centerX 기준 가운데 정렬로 만든다. */
  private navArrow(
    scene: Phaser.Scene,
    glyph: string,
    centerX: number,
    y: number,
    textured: boolean,
    step: -1 | 1,
  ): Phaser.GameObjects.Container {
    const container = scene.add.container(0, 0);
    const width = this.addCap(scene, container, glyph, 0, 0, textured);
    container.setPosition(centerX - width / 2, y);

    // 히트 영역은 컨테이너가 아니라 투명 사각형으로 잡는다 — 컨테이너는 크기가 없다.
    const hit = scene.add
      .rectangle(width / 2, (CAP_HEIGHT * KEYCAP_SCALE) / 2, width, CAP_HEIGHT * KEYCAP_SCALE, 0, 0)
      .setInteractive({ useHandCursor: true });
    hit.on('pointerdown', () => this.showPage(this.pageIndex + step));
    container.add(hit);

    this.content.add(container);
    return container;
  }

  /** 쪽을 켠다. 범위 밖이면 무시하고, 끝 쪽에서는 해당 화살표를 흐리게 눌러 둔다. */
  private showPage(index: number): void {
    const clamped = Phaser.Math.Clamp(index, 0, this.pageContainers.length - 1);
    this.pageIndex = clamped;
    this.pageContainers.forEach((page, i) => page.setVisible(i === clamped));
    this.pageLabel.setText(`${clamped + 1} / ${this.pageContainers.length}`);
    this.prevArrow.setAlpha(clamped === 0 ? 0.35 : 1);
    this.nextArrow.setAlpha(clamped === this.pageContainers.length - 1 ? 0.35 : 1);
  }

  // ------------------------------------------------------------- 1쪽: 조작법

  private buildControls(scene: Phaser.Scene, page: Phaser.GameObjects.Container): void {
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
          fontSize: `${HEAD_FONT_SIZE}px`,
          fontStyle: 'bold',
          color: ACCENT,
        })
        .setOrigin(0, 0);
      page.add(head);
      y += HEAD_FONT_SIZE + HEAD_GAP;

      for (const row of section.rows) {
        y =
          row.layout === 'wasd'
            ? this.addWasdRow(scene, page, row, left, y, textured, columnWidth)
            : this.addKeyRow(scene, page, row, left, y, textured, columnWidth);
      }
      this.columnY[column] = y + SECTION_GAP;
    });
  }

  /**
   * 키캡 한 장. 위치는 **왼쪽 위 모서리**(화면 px)로 주고, 폭은 글자에 맞춰 정한다.
   * 그린 폭(화면 px)을 돌려준다 — 호출부가 다음 키캡을 옆에 붙일 때 쓴다.
   */
  private addCap(
    scene: Phaser.Scene,
    page: Phaser.GameObjects.Container,
    key: string,
    x: number,
    y: number,
    textured: boolean,
  ): number {
    const label = scene.add
      .text(0, 0, key, {
        fontFamily: FONT,
        fontSize: `${KEY_FONT_SIZE}px`,
        fontStyle: 'bold',
        color: '#14161d',
      })
      .setOrigin(0.5, 0.5);

    // 9-slice에 넘기는 폭은 **원본 픽셀**이다. 글자는 이미 화면 px이라 배율로 나눠서 잰다.
    const sourceWidth = Math.max(
      CAP_MIN_WIDTH,
      Math.ceil(label.width / KEYCAP_SCALE) + CAP_TEXT_PAD * 2,
    );
    const drawnWidth = sourceWidth * KEYCAP_SCALE;

    if (textured) {
      const cap = scene.add
        .nineslice(
          x,
          y,
          HUD_ATLAS,
          CAP_FRAME,
          sourceWidth,
          CAP_HEIGHT,
          CAP_BORDER,
          CAP_BORDER,
          0,
          0,
        )
        .setOrigin(0, 0)
        .setScale(KEYCAP_SCALE);
      page.add(cap);
    }
    // 글자는 키캡 **윗면**의 가운데다. 아래 옆면까지 세면 한 픽셀 내려앉아 보인다.
    label.setPosition(x + drawnWidth / 2, y + ((CAP_HEIGHT - CAP_SIDE) * KEYCAP_SCALE) / 2);
    page.add(label);

    return drawnWidth;
  }

  /** 항목 이름 + 각주. 키캡 칸 오른쪽에 붙는다. 아랫변을 돌려준다. */
  private addRowText(
    scene: Phaser.Scene,
    page: Phaser.GameObjects.Container,
    row: GuideRow,
    left: number,
    top: number,
    columnWidth: number,
  ): number {
    const label = scene.add
      .text(left + KEYS_COLUMN, top, row.label, {
        fontFamily: FONT_SMALL,
        fontSize: `${LABEL_FONT_SIZE}px`,
        color: BODY_TEXT,
      })
      .setOrigin(0, 0);
    page.add(label);

    if (!row.note) return top + LABEL_FONT_SIZE;

    const note = scene.add
      .text(left + KEYS_COLUMN, top + LABEL_FONT_SIZE + 4, row.note, {
        fontFamily: FONT_SMALL,
        fontSize: `${NOTE_FONT_SIZE}px`,
        color: DIM_TEXT,
        wordWrap: { width: columnWidth - KEYS_COLUMN },
      })
      .setOrigin(0, 0);
    page.add(note);
    return note.y + note.height;
  }

  /** 키캡을 한 줄로 늘어놓는 보통 줄. 다음 줄이 시작할 y를 돌려준다. */
  private addKeyRow(
    scene: Phaser.Scene,
    page: Phaser.GameObjects.Container,
    row: GuideRow,
    left: number,
    top: number,
    textured: boolean,
    columnWidth: number,
  ): number {
    let x = left;
    row.keys.forEach((key, index) => {
      x += this.addCap(scene, page, key, x, top, textured) + CAP_GAP;
      // 1~4처럼 "부터 까지"인 묶음은 사이에 물결표를 넣는다.
      if (row.keys.length === 2 && index === 0 && /^\d+$/.test(key)) {
        const tilde = scene.add
          .text(x, top + (CAP_HEIGHT * KEYCAP_SCALE) / 2, '~', {
            fontFamily: FONT,
            fontSize: `${KEY_FONT_SIZE}px`,
            color: DIM_TEXT,
          })
          .setOrigin(0, 0.5);
        page.add(tilde);
        x += Math.ceil(tilde.width) + CAP_GAP;
      }
    });

    // 글자 덩어리를 키캡 세로 가운데에 맞춘다.
    const textHeight = row.note ? LABEL_FONT_SIZE + 4 + NOTE_FONT_SIZE : LABEL_FONT_SIZE;
    const textTop = top + Math.max(2, (CAP_HEIGHT * KEYCAP_SCALE - textHeight) / 2);
    const textBottom = this.addRowText(scene, page, row, left, textTop, columnWidth);
    return Math.max(top + CAP_HEIGHT * KEYCAP_SCALE, textBottom) + ROW_GAP;
  }

  /** WASD를 실제 자판처럼 ㅗ 모양으로 쌓는 줄. */
  private addWasdRow(
    scene: Phaser.Scene,
    page: Phaser.GameObjects.Container,
    row: GuideRow,
    left: number,
    top: number,
    textured: boolean,
    columnWidth: number,
  ): number {
    const [w, a, s, d] = row.keys;
    const capHeight = CAP_HEIGHT * KEYCAP_SCALE;
    const stackGap = 4;

    // 아랫줄(A S D)을 먼저 깔고, W는 그 가운데(=S 자리) 위에 올린다.
    const bottomTop = top + capHeight + stackGap;
    let x = left;
    const widths = [a, s, d].map((key) => {
      const width = this.addCap(scene, page, key ?? '', x, bottomTop, textured);
      x += width + CAP_GAP;
      return width;
    });
    this.addCap(scene, page, w ?? '', left + widths[0]! + CAP_GAP, top, textured);

    // 글자는 두 줄 덩어리의 **세로 가운데**에 맞춘다 — 윗줄에 붙이면 짝이 안 맞아 보인다.
    const blockBottom = bottomTop + capHeight;
    const textTop = top + (blockBottom - top) / 2 - LABEL_FONT_SIZE / 2;
    const textBottom = this.addRowText(scene, page, row, left, textTop, columnWidth);
    return Math.max(blockBottom, textBottom) + ROW_GAP;
  }

  // ------------------------------------------------------------- 2쪽~: 진행 안내

  private buildGuidePage(
    scene: Phaser.Scene,
    page: Phaser.GameObjects.Container,
    spec: GuidePage,
  ): void {
    const width = PANEL_WIDTH - PAD_X * 2;
    let y = INSET_TOP;

    const title = scene.add
      .text(0, y, spec.title, {
        fontFamily: FONT,
        fontSize: `${HEAD_FONT_SIZE}px`,
        fontStyle: 'bold',
        color: ACCENT,
      })
      .setOrigin(0, 0);
    page.add(title);
    y += HEAD_FONT_SIZE + 14;

    for (const entry of spec.entries) {
      y = this.addGuideEntry(scene, page, entry, y, width);
    }
  }

  /** 진행 안내 한 줄(그림 + 제목 + 설명). 다음 줄이 시작할 y를 돌려준다. */
  private addGuideEntry(
    scene: Phaser.Scene,
    page: Phaser.GameObjects.Container,
    entry: GuideEntry,
    top: number,
    width: number,
  ): number {
    const image = this.guideImage(scene, entry);
    const textLeft = GUIDE_IMAGE_COLUMN;

    const head = scene.add
      .text(textLeft, top, entry.head, {
        fontFamily: FONT_SMALL,
        fontSize: `${LABEL_FONT_SIZE}px`,
        color: BODY_TEXT,
      })
      .setOrigin(0, 0);
    page.add(head);

    const body = scene.add
      .text(textLeft, top + LABEL_FONT_SIZE + 4, entry.body, {
        fontFamily: FONT_SMALL,
        fontSize: `${NOTE_FONT_SIZE}px`,
        color: DIM_TEXT,
        wordWrap: { width: width - textLeft },
        lineSpacing: 4,
      })
      .setOrigin(0, 0);
    page.add(body);

    const textBottom = body.y + body.height;
    const rowHeight = Math.max(GUIDE_IMAGE_FIT, textBottom - top);

    if (image) {
      // 그림은 줄의 세로 가운데. 프레임 크기가 제각각이라 상자에 **맞춰 줄인다** —
      // 픽셀 정수배는 포기한다(안내 그림이라 살짝 보간돼도 정보는 그대로다).
      const frame = image.frame;
      const fit = Math.min(GUIDE_IMAGE_FIT / frame.width, GUIDE_IMAGE_FIT / frame.height, 3);
      image.setScale(fit);
      image.setPosition(GUIDE_IMAGE_COLUMN / 2 - 8, top + rowHeight / 2);
      page.add(image);
    }

    return top + rowHeight + 14;
  }

  /** 줄에 붙일 그림. 아틀라스나 프레임이 없으면(몬스터 에셋 미보유 등) null. */
  private guideImage(scene: Phaser.Scene, entry: GuideEntry): Phaser.GameObjects.Image | null {
    let atlas: string | undefined;
    let frame: string | undefined;
    if (entry.image) ({ atlas, frame } = entry.image);
    else if (entry.monster) {
      atlas = MONSTER_ATLAS;
      frame = monsterIdleFrame(entry.monster);
    }
    if (!atlas || !frame) return null;
    if (!scene.textures.exists(atlas) || !scene.textures.get(atlas).has(frame)) return null;
    return scene.add.image(0, 0, atlas, frame).setOrigin(0.5, 0.5);
  }
}
