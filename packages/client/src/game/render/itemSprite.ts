import Phaser from 'phaser';
import { WEAPON_VISUALS, type WeaponVisual } from './weaponFx';
import { GAME_ATLAS } from './playerSprite';

/**
 * 아이템 id → 아틀라스 프레임.
 *
 * 바닥에 떨어진 드롭과 UI 아이콘이 **같은 표**를 본다 — 창고에서 본 그림과 바닥에서
 * 주운 그림이 다르면 같은 물건인지 알 수 없다. 무기는 이미 WEAPON_VISUALS가 프레임을
 * 알고 있으니 거기서 끌어다 쓴다(두 곳에 적으면 반드시 어긋난다).
 */
const MATERIAL_FRAME: Record<string, string> = {
  wood: 'item_wood_idle_0',
  stone: 'item_stone_idle_0',
  // 치료·음식은 신규 시트(item_usable)를 쓴다. 태그 이름이 곧 아이템 id지만
  // AID만 대문자 태그로 들어와 있어 id(aid_kit)와 다르다.
  bandage: 'item_usable_bandage_0',
  painkiller: 'item_usable_painkiller_0',
  pills: 'item_usable_pills_0',
  aid_kit: 'item_usable_AID_0',
  adrenaline: 'item_usable_adrenaline_0',
  chocolate: 'item_usable_chocolate_0',
  donut: 'item_usable_donut_0',
  nuggets: 'item_usable_nuggets_0',
  carrot_cake: 'item_usable_carrot_cake_0',
  apple_juice: 'item_usable_apple_juice_0',
  lasagna: 'item_usable_lasagna_0',
  energy_cell: 'item_consumable_energy_cell_0',
  // drop_rare는 아틀라스에 'item_drop_rare_idle_0'로 들어있는데, drop_normal만
  // 'idle' 세그먼트가 빠진 'item_drop_normal__0'로 들어있다(에셋 소스의 이름표
  // 오타로 보임 — 원본 아세프라이트/생성기를 고치는 대신 실제 아틀라스에 있는
  // 이름에 코드를 맞췄다. 나중에 아틀라스를 'item_drop_normal_idle_0'로 다시
  // 뽑으면 이 줄도 같이 바꿔야 한다).
  drop_normal: 'item_drop_normal__0',
  drop_rare: 'item_drop_rare_idle_0',
  // 건축 배치품. 세워 놓은 모습(정면)을 그대로 아이콘으로 쓴다 — 인벤토리에서 본 그림과
  // 바닥에 선 그림이 같아야 무엇을 세우는지 헷갈리지 않는다.
  // 스파이크도 세워 놓은 모습 그대로 — 벽·울타리와 같은 이유다.
  spike: 'spikes_spike_front_0',
  stone_spike: 'spikes_stone_spike_front_0',
  iron_spike: 'spikes_iron_spike_front_0',
  fence: 'wood_fence_front_0',
  wall: 'wood_wall_front_0',
  stone_fence: 'build_tier_stone_fence_front_0',
  stone_wall: 'build_tier_stone_wall_front_0',
  iron_fence: 'build_tier_iron_fence_front_0',
  iron_wall: 'build_tier_iron_wall_front_0',
};

/** 그림이 실제로 차지하는 영역. 무기만 값이 있고, 나머지는 캔버스를 꽉 채워서 없어도 된다. */
function iconArtBounds(itemId: string): WeaponVisual['artBounds'] {
  return WEAPON_VISUALS[itemId]?.artBounds;
}

export function itemFrame(itemId: string): string | undefined {
  return MATERIAL_FRAME[itemId] ?? WEAPON_VISUALS[itemId]?.frame;
}

export function hasItemFrame(scene: Phaser.Scene, frame: string): boolean {
  return scene.textures.exists(GAME_ATLAS) && scene.textures.get(GAME_ATLAS).has(frame);
}

/**
 * 길쭉한 아이콘을 눕히는 각도(라디안)와 그 판단 기준.
 *
 * 무기 시트는 235×62라 가로세로비가 4에 가깝다. 정사각형 칸에 가로를 맞춰 넣으면
 * 세로가 8px밖에 안 남아서 총이 실 한 가닥처럼 보인다 — 실제로 퀵슬롯에서 무엇을 들고
 * 있는지 분간이 안 됐다. 대각선으로 눕히면 칸의 **대각선 길이**를 쓸 수 있어 같은
 * 칸에서 1.4배쯤 커진다. 인벤토리에서 긴 무기를 비스듬히 놓는 건 흔한 관습이기도 하다.
 */
const ICON_TILT = -Math.PI / 6;
const ICON_TILT_ASPECT = 2.2;

interface IconFit {
  scale: number;
  tilt: number;
  /** 칸 중심에서 이만큼 밀어야 그림의 실제 중심이 칸 중심에 온다(원본 px 단위, 회전 전). */
  offsetX: number;
  offsetY: number;
}

/**
 * 칸 크기에 맞춘 배율·기울기·보정 위치.
 *
 * 캔버스가 아니라 **그림이 실제로 차지하는 영역**(iconArtBounds)을 기준으로 맞춘다 —
 * 무기 시트는 모두 235×62 캔버스를 공유해서, 권총처럼 작은 그림은 캔버스에 맞추면
 * 칸 안에서 3분의 1 크기로 쪼그라든다. 그래서 여백을 뺀 크기로 재고, 여백 때문에
 * 어긋난 중심은 offset으로 되돌린다.
 */
function iconFit(frameWidth: number, frameHeight: number, boxSize: number, itemId: string): IconFit {
  const art = iconArtBounds(itemId);
  const width = art?.width ?? frameWidth;
  const height = art?.height ?? frameHeight;
  // 그림 중심이 캔버스 중심에서 얼마나 벗어나 있나.
  const offsetX = art ? frameWidth / 2 - (art.x + art.width / 2) : 0;
  const offsetY = art ? frameHeight / 2 - (art.y + art.height / 2) : 0;

  if (width < height * ICON_TILT_ASPECT) {
    return { scale: boxSize / Math.max(width, height), tilt: 0, offsetX, offsetY };
  }
  const cos = Math.abs(Math.cos(ICON_TILT));
  const sin = Math.abs(Math.sin(ICON_TILT));
  const rotatedWidth = width * cos + height * sin;
  const rotatedHeight = width * sin + height * cos;
  return {
    scale: boxSize / Math.max(rotatedWidth, rotatedHeight),
    tilt: ICON_TILT,
    offsetX,
    offsetY,
  };
}

/**
 * 한 칸(boxSize)에 맞춘 배율·보정. **DOM(대기실)도 같은 계산을 쓴다** — 인벤토리에서
 * 본 크기와 대기실에서 본 크기가 다르면 같은 물건인지 헷갈린다.
 *
 * 프레임 크기는 호출부가 준다. Phaser 쪽은 이미지에서 읽고, DOM 쪽은 아틀라스 JSON에서
 * 읽어서 — 어느 쪽도 상대의 사정을 몰라도 되게 했다.
 */
/**
 * 그림이 실제로 차지하는 영역(프레임 안 좌표). 무기만 값이 있고, 나머지는 캔버스를
 * 꽉 채워서 없다 — DOM(대기실)이 프레임 대신 **그림만** 잘라낼 때 쓴다.
 */
export function itemArtBounds(itemId: string): WeaponVisual['artBounds'] {
  return iconArtBounds(itemId);
}

export function itemIconFit(
  itemId: string,
  frameWidth: number,
  frameHeight: number,
  boxSize: number,
): IconFit {
  return iconFit(frameWidth, frameHeight, boxSize, itemId);
}

/** 회전·배율을 적용하고, 여백 보정만큼 위치를 되돌린다. */
function applyIconFit(
  image: Phaser.GameObjects.Image,
  fit: IconFit,
  centerX: number,
  centerY: number,
): void {
  image.setScale(fit.scale).setRotation(fit.tilt);
  // 보정은 회전 전 좌표계의 값이라, 회전한 만큼 같이 돌려야 그림이 칸 가운데에 온다.
  const cos = Math.cos(fit.tilt);
  const sin = Math.sin(fit.tilt);
  const dx = (fit.offsetX * cos - fit.offsetY * sin) * fit.scale;
  const dy = (fit.offsetX * sin + fit.offsetY * cos) * fit.scale;
  image.setPosition(centerX + dx, centerY + dy);
}

/**
 * 아이템 아이콘을 한 칸(boxSize)에 맞춰 만든다. 원본 크기가 제각각이라(재료 64px,
 * 도구 32px, 무기 235×62) 프레임 크기로 나눠 맞춘다 — 고정 배율을 쓰면 무기만 칸 밖으로 넘친다.
 *
 * 프레임이 없으면 null을 돌려준다. 호출부는 그대로 글자 라벨만 보여주면 된다.
 */
export function createItemIcon(
  scene: Phaser.Scene,
  itemId: string,
  boxSize: number,
): Phaser.GameObjects.Image | null {
  const frame = itemFrame(itemId);
  if (frame === undefined || !hasItemFrame(scene, frame)) return null;

  const icon = scene.add.image(0, 0, GAME_ATLAS, frame).setOrigin(0.5, 0.5);
  applyIconFit(icon, iconFit(icon.width, icon.height, boxSize, itemId), 0, 0);
  return icon;
}

/**
 * 내용이 바뀌는 칸(퀵슬롯·창고)에 얹는 아이콘.
 *
 * createItemIcon과 달리 이미지를 매번 새로 만들지 않는다 — 스냅샷마다 20칸을 지웠다
 * 다시 만들면 GC가 계속 돌고, 드래그 중인 칸이 사라지는 사고도 난다. 하나를 만들어
 * 두고 프레임만 갈아 끼운다.
 *
 * 칸 크기는 UI 배율에 따라 바뀌므로 위치·크기를 `place`로 다시 잡을 수 있게 열어둔다.
 */
export class SlotIcon {
  private readonly image: Phaser.GameObjects.Image | null;
  private boxSize: number;
  private currentItem: string | null = null;
  /** 칸의 중심. 여백 보정으로 실제 위치가 여기서 조금 밀리므로 원본을 따로 기억한다. */
  private centerX = 0;
  private centerY = 0;

  constructor(scene: Phaser.Scene, boxSize: number) {
    this.boxSize = boxSize;
    // 아틀라스 자체가 없으면(빌드 전) 아이콘을 포기하고 글자 라벨에 맡긴다.
    this.image = scene.textures.exists(GAME_ATLAS)
      ? scene.add.image(0, 0, GAME_ATLAS).setOrigin(0.5, 0.5).setVisible(false)
      : null;
  }

  /** 컨테이너에 붙일 실제 오브젝트. 아틀라스가 없으면 null이다. */
  get object(): Phaser.GameObjects.Image | null {
    return this.image;
  }

  /** 칸의 중심과 크기를 다시 잡는다(레이아웃/UI 배율 변경 시). */
  place(centerX: number, centerY: number, boxSize: number): void {
    this.boxSize = boxSize;
    this.centerX = centerX;
    this.centerY = centerY;
    this.applyScale();
  }

  /** 빈 칸이면 null. 같은 아이템이면 아무 일도 하지 않는다. */
  setItem(itemId: string | null): void {
    if (!this.image || itemId === this.currentItem) return;
    this.currentItem = itemId;

    const frame = itemId === null ? undefined : itemFrame(itemId);
    if (frame === undefined || !hasItemFrame(this.image.scene, frame)) {
      this.image.setVisible(false);
      return;
    }
    this.image.setTexture(GAME_ATLAS, frame).setVisible(true);
    this.applyScale();
  }

  /** 아이콘이 실제로 보이는지. 호출부가 "글자 라벨을 대신 띄울까"를 결정할 때 쓴다. */
  get isShowing(): boolean {
    return this.image?.visible ?? false;
  }

  private applyScale(): void {
    if (!this.image || !this.image.visible || this.currentItem === null) return;
    const fit = iconFit(this.image.width, this.image.height, this.boxSize, this.currentItem);
    applyIconFit(this.image, fit, this.centerX, this.centerY);
  }
}
