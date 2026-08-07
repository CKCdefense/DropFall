import Phaser from 'phaser';
import { WEAPON_VISUALS } from './weaponFx';
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
  bandage: 'item_consumable_bandage_0',
  medkit: 'item_consumable_medkit_0',
  stimpack: 'item_consumable_stimpack_0',
  repair_kit: 'item_consumable_repair_kit_0',
  core_cell: 'item_consumable_core_cell_0',
  energy_cell: 'item_consumable_energy_cell_0',
  // drop_rare는 아틀라스에 'item_drop_rare_idle_0'로 들어있는데, drop_normal만
  // 'idle' 세그먼트가 빠진 'item_drop_normal__0'로 들어있다(에셋 소스의 이름표
  // 오타로 보임 — 원본 아세프라이트/생성기를 고치는 대신 실제 아틀라스에 있는
  // 이름에 코드를 맞췄다. 나중에 아틀라스를 'item_drop_normal_idle_0'로 다시
  // 뽑으면 이 줄도 같이 바꿔야 한다).
  drop_normal: 'item_drop_normal__0',
  drop_rare: 'item_drop_rare_idle_0',
};

export function itemFrame(itemId: string): string | undefined {
  return MATERIAL_FRAME[itemId] ?? WEAPON_VISUALS[itemId]?.frame;
}

export function hasItemFrame(scene: Phaser.Scene, frame: string): boolean {
  return scene.textures.exists(GAME_ATLAS) && scene.textures.get(GAME_ATLAS).has(frame);
}

/**
 * 아이템 아이콘을 한 칸(boxSize)에 맞춰 만든다. 원본 크기가 제각각이라(재료 64px,
 * 도구 32px, 총기 128×64) 프레임 크기로 나눠 맞춘다 — 고정 배율을 쓰면 총기만 칸 밖으로 넘친다.
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
  icon.setScale(boxSize / Math.max(icon.width, icon.height));
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
    this.image?.setPosition(centerX, centerY);
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
    if (!this.image || !this.image.visible) return;
    this.image.setScale(this.boxSize / Math.max(this.image.width, this.image.height));
  }
}
