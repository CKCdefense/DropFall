import Phaser from 'phaser';
import {
  BARE_HANDS_WEAPON_ID,
  INPUT_SEND_RATE,
  SLOT_COUNT,
  itemOfSlot,
  normalizeMoveVector,
  weaponsData,
  worldToCell,
  type ItemKind,
  type PlayerInputMessage,
} from '@dropfall/shared';
import { ACTION_PLANE_Y } from '../render/plane';
import type { GameConnection, PlayerView } from '../../net/GameConnection';

const SEND_INTERVAL_MS = 1000 / INPUT_SEND_RATE;

interface EquippedItem {
  /** null이면 빈 칸(맨손) */
  kind: ItemKind | null;
  /** kind가 'weapon'일 때만 채워진다 */
  weaponId: string | undefined;
}

/**
 * 스냅샷의 내 플레이어에서 "지금 손에 든 것"을 읽는다.
 *
 * 무기도 소모품도 아니면(빈 칸, 재료) **맨손**으로 친다 — 서버도 같은 판정을 한다
 * (World.fireWeapon의 BARE_HANDS_WEAPON_ID). 손이 비었다고 아무것도 못 하면
 * 도구를 잃었을 때 할 수 있는 게 없어진다.
 */
function readEquipped(self: PlayerView): EquippedItem {
  const item = itemOfSlot(self.slots[self.selectedSlot]);
  if (item?.kind === 'consumable') return { kind: 'consumable', weaponId: undefined };
  if (item?.kind === 'building') return { kind: 'building', weaponId: undefined };
  return { kind: 'weapon', weaponId: item?.weaponId ?? BARE_HANDS_WEAPON_ID };
}

/**
 * 홀드 공격 재전송 간격(ms). **무기의 발사 주기와 정확히 같게** 보낸다.
 *
 * 한때 여기에 0.9를 곱해 서버보다 살짝 빠르게 보냈다. 지터로 거절당하는 걸 줄이려던
 * 건데 정반대 결과가 나왔다 — 매번 쿨다운 전에 도착해서 **요청 두 번당 한 번만** 발사됐고,
 * 총구 화염은 요청마다 재생되니 이펙트가 실제 발사의 두 배로 보였다.
 * (실측: 3초 홀드에 이펙트 10회 / 실제 발사 5회)
 *
 * 지터는 서버 쪽 쿨다운 여유(FIRE_COOLDOWN_GRACE)로 흡수한다. 클라이언트가 서버보다
 * 빨리 쏘려고 하면 안 된다.
 *
 * 무기를 모르면(빈 손, 소모품) 넉넉한 기본값을 쓴다 — 어차피 서버가 공격을 만들지 않는다.
 */
const UNKNOWN_WEAPON_INTERVAL_MS = 200;

function fireIntervalMs(weaponId: string | undefined): number {
  const weapon = weaponId ? weaponsData[weaponId] : undefined;
  return weapon ? 1000 / weapon.fireRate : UNKNOWN_WEAPON_INTERVAL_MS;
}

/**
 * 건축모드에서 순환할 목록(docs/backend/18 §1 "B 건축모드 토글"). 'off'가
 * 항상 첫 자리라 B를 계속 누르면 결국 꺼진 상태로 돌아온다 — 별도 "나가기" 키가
 * 없어도 된다. 'demolish'(철거, docs/backend/43)는 건축물 타입이 아니라 별도
 * 동작이라 좌클릭 처리에서 따로 분기한다(§pointerdown).
 */
const BUILD_MODES = ['off', 'fence', 'wall', 'demolish'] as const;
type BuildMode = (typeof BUILD_MODES)[number];

/**
 * WASD 이동 + 마우스 조준을 서버 입력 메시지로 바꿔 보낸다.
 *
 * 전송 주기를 서버 틱(`INPUT_SEND_RATE = TICK_RATE`)에 맞춘 이유:
 * 서버는 "마지막 입력을 새 입력이 올 때까지 매 틱 반복 적용"하는 모델이라, 렌더 프레임보다
 * 빠르게 보내봐야 중간 입력이 덮어써져 그냥 버려진다. 대역폭만 쓰고 이득이 없다.
 * (docs/frontend/02-lobby-room-protocol.md)
 */
export class InputController {
  private readonly keys: Record<
    'up' | 'down' | 'left' | 'right' | 'sprint',
    Phaser.Input.Keyboard.Key
  >;
  private seq = 0;
  private fireTimer = 0;
  private elapsed = 0;
  private aimAngle = 0;
  private buildModeIndex = 0;
  /**
   * 지금 들고 있는 것. **스냅샷에서 받아온 값**이라 서버가 인정한 상태다 —
   * 클라이언트가 정하지 않는다(update에서 매 프레임 갱신).
   */
  private equipped: EquippedItem = { kind: null, weaponId: undefined };

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly connection: GameConnection,
    /** 공격 순간 호출된다. 총구 화염·휘두르기처럼 즉시 반응해야 하는 연출에 쓴다. */
    private readonly onAttack?: (weaponId: string) => void,
    /**
     * E를 눌렀을 때 먼저 호출된다. true를 돌려주면(예: 코어 모달을 열었다) 줍기를
     * 건너뛴다 — 코어 앞에서 E가 두 가지 일을 동시에 하지 않게 하는 장치다.
     */
    private readonly onInteract?: () => boolean,
    /**
     * 포인터가 HUD(모달 등) 위인지. true면 좌클릭을 게임 입력으로 쓰지 않는다 —
     * 모달에 차단막이 없어서(게임을 계속 보여줘야 한다) 좌표로 판정해야 한다.
     */
    private readonly isPointerOverHud?: (x: number, y: number) => boolean,
  ) {
    const keyboard = scene.input.keyboard;
    if (!keyboard) throw new Error('키보드 입력을 사용할 수 없습니다.');

    this.keys = {
      up: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      // 달리기. 누르고 있는 동안만 유효한 상태라 이벤트가 아니라 매 틱 입력에 실어 보낸다.
      sprint: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT),
    };

    // 낮 넘기기 투표(만장일치). 서버가 중복 투표를 무시하므로 한 번만 보내면 된다.
    keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.V).on('down', () => {
      this.connection.voteSkipDay();
    });

    // 상호작용(E). 무엇을 할지는 서 있는 위치가 정한다 — 코어 옆이면 창고를 열고,
    // 아니면 바닥 드롭을 줍는다. 키를 늘리는 대신 맥락으로 나누는 편이 조작이 단순하다.
    // 채집(자원 노드 타격)은 좌클릭 근접 공격이라 이 키와 무관하다.
    keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E).on('down', () => {
      if (this.onInteract?.()) return;
      this.connection.pickUp();
    });

    // 퀵슬롯 선택(1~4). 슬롯 번호만 보내고 그 칸에 뭐가 들었는지는 서버가 판단한다.
    // 화면 반영도 서버 스냅샷을 통해서만 이뤄진다 — 로컬에서 미리 바꾸면 서버가
    // 거절했을 때 두 상태가 어긋난다.
    for (let index = 0; index < SLOT_COUNT; index += 1) {
      keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ONE + index).on('down', () => {
        this.fireTimer = 0;
        this.connection.selectSlot(index);
      });
    }

    // 건축모드 순환(off → fence → wall → off...). 좌클릭은 건축모드일 때 설치로,
    // 아닐 때는 기존처럼 사격으로 쓴다 — 두 조작이 같은 버튼을 나눠 쓰는 구조다.
    keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.B).on('down', () => {
      this.buildModeIndex = (this.buildModeIndex + 1) % BUILD_MODES.length;
    });

    // 수동 재장전(R). 대상 무기·가득 여부 판정은 서버가 한다.
    keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R).on('down', () => {
      this.connection.reload();
    });

    // 점사 모드 토글(X, 돌격소총 전용). burst 스펙 없는 무기면 서버가 무시한다.
    keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.X).on('down', () => {
      this.connection.toggleFireMode();
    });

    // 우클릭으로 건축모드를 바로 취소할 수 있게, 브라우저 기본 우클릭 메뉴부터 끈다.
    scene.input.mouse?.disableContextMenu();
    scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.buildMode === 'off') return;
      if (this.isPointerOverHud?.(pointer.x, pointer.y)) return;

      if (pointer.rightButtonDown()) {
        this.buildModeIndex = 0;
        return;
      }
      if (pointer.leftButtonDown()) {
        const { cx, cy } = this.cursorCell();
        if (this.buildMode === 'demolish') {
          this.connection.demolishBuilding(cx, cy);
        } else {
          this.connection.placeBuilding(this.buildMode, cx, cy);
        }
      }
    });
  }

  /**
   * 지금 커서가 가리키는 격자 칸.
   *
   * 조준(updateAim)과 달리 **ACTION_PLANE_Y 보정을 하지 않는다** — 건축물은 캐릭터·총알이
   * 올라간 전투 평면이 아니라 바닥에 놓이므로, 커서가 가리키는 바닥 칸이 그대로 정답이다.
   */
  cursorCell(): { cx: number; cy: number } {
    const pointer = this.scene.input.activePointer;
    const world = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    return worldToCell(world.x, world.y);
  }

  /** 지금 손에 든 것의 종류. HUD가 설치 미리보기를 띄울지 정할 때 쓴다. */
  get equippedKind(): ItemKind | null {
    return this.equipped.kind;
  }

  get buildMode(): BuildMode {
    return BUILD_MODES[this.buildModeIndex];
  }

  /**
   * 채팅/개발자 콘솔처럼 텍스트 입력이 뜰 때 부른다. `keyboard.enabled = false`만으로는
   * 부족하다 — Phaser는 그 순간부터 keyup 이벤트도 무시하므로, 입력을 여는 순간 이동키를
   * 누르고 있었다면 `isDown`이 true에 박제돼 서버가 "마지막 입력을 계속 반복 적용"하는
   * 모델(§buildInput 주석) 때문에 캐릭터가 창을 연 채로도 계속 미끄러진다. 여기서
   * 키 상태를 직접 리셋하고, 그 결과(정지)를 즉시 한 번 전송해 서버 쪽 이동도 끊는다.
   */
  haltMovement(): void {
    this.keys.up.reset();
    this.keys.down.reset();
    this.keys.left.reset();
    this.keys.right.reset();
    this.keys.sprint.reset();
    this.fireTimer = 0;
    this.seq += 1;
    this.connection.sendInput(this.buildInput());
  }

  get weaponId(): string | undefined {
    return this.equipped.weaponId;
  }

  /**
   * 좌클릭 동작. **들고 있는 것에 따라 갈린다** — 무기면 공격, 소모품이면 사용이다.
   * 슬롯마다 다른 키를 두지 않고 하나로 합쳐야 조작이 단순하다.
   *
   * 재전송 간격은 무기 fireRate에서 나오고, 실제 쿨다운·소모 판정은 전부 서버가 한다.
   * 건축모드일 땐 좌클릭이 설치로 쓰이므로 통째로 건너뛴다.
   */
  private updateFire(delta: number): void {
    const pointer = this.scene.input.activePointer;
    if (this.isPointerOverHud?.(pointer.x, pointer.y)) {
      this.fireTimer = 0;
      return;
    }
    if (this.buildMode !== 'off' || !pointer.leftButtonDown()) {
      this.fireTimer = 0;
      return;
    }

    this.fireTimer -= delta;
    if (this.fireTimer > 0) return;

    const { kind, weaponId } = this.equipped;
    this.fireTimer = fireIntervalMs(weaponId);

    if (kind === 'consumable') {
      // 소모품은 홀드로 연타되면 순식간에 다 없어진다 — 한 번 쓰고 버튼을 뗄 때까지 막는다.
      this.fireTimer = Infinity;
      this.connection.useSlot();
      return;
    }

    if (kind === 'building') {
      // 건축물도 홀드 연타를 막는다 — 커서를 조금 움직이는 사이에 인벤토리가 비어버린다.
      this.fireTimer = Infinity;
      const cell = this.cursorCell();
      this.connection.placeHeldBuilding(cell.cx, cell.cy);
      return;
    }

    if (kind !== 'weapon' || !weaponId) return;

    this.connection.fire();
    // 연출은 서버 응답을 기다리지 않고 즉시 그린다 — 타격감은 지연되면 안 된다.
    // (서버가 쿨다운으로 실제 공격을 거절하면 연출만 헛나오는데, 연출이라 문제되지 않는다)
    this.onAttack?.(weaponId);
  }

  /** 매 프레임 호출. 실제 전송은 SEND_INTERVAL_MS 마다 한 번. */
  update(delta: number, self: PlayerView): void {
    this.equipped = readEquipped(self);
    this.updateAim(self.x, self.y);
    this.updateFire(delta);

    this.elapsed += delta;
    if (this.elapsed < SEND_INTERVAL_MS) return;
    this.elapsed = 0;

    this.seq += 1;
    this.connection.sendInput(this.buildInput());
  }

  get currentAimAngle(): number {
    return this.aimAngle;
  }

  get currentSeq(): number {
    return this.seq;
  }

  private updateAim(selfX: number, selfY: number): void {
    const pointer = this.scene.input.activePointer;
    // 화면 좌표 → 월드 좌표. 카메라가 따라다니므로 이 변환이 없으면 조준이 어긋난다.
    const world = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);

    /*
     * 커서 높이 보정.
     *
     * getWorldPoint는 "커서가 바닥 평면의 어디를 가리키는가"를 준다. 그런데 총알과 몬스터는
     * 화면에서 ACTION_PLANE_Y만큼 올려 그려진다(plane.ts) — 커서가 실제로 가리키는 것은
     * 바닥이 아니라 그 올라간 평면이다.
     *
     * 보정 없이 발밑에서 커서로 각을 재면, 올려 그려진 총알 궤적이 커서보다 딱 그만큼
     * 위로 지나간다. 커서 지점을 바닥 좌표로 되돌린 뒤 각을 재야 화면상 궤적이 커서를
     * 정확히 통과한다. (ACTION_PLANE_Y가 음수라 빼면 아래로 내려간다)
     */
    const targetY = world.y - ACTION_PLANE_Y;
    this.aimAngle = Math.atan2(targetY - selfY, world.x - selfX);
  }

  private buildInput(): PlayerInputMessage {
    let moveX = 0;
    let moveY = 0;
    if (this.keys.left.isDown) moveX -= 1;
    if (this.keys.right.isDown) moveX += 1;
    if (this.keys.up.isDown) moveY -= 1;
    if (this.keys.down.isDown) moveY += 1;

    // 서버(World#setInput)와 동일한 정규화 함수를 써서 대각선 속도가 어긋나지 않게 한다.
    const normalized = normalizeMoveVector(moveX, moveY);
    return {
      seq: this.seq,
      ...normalized,
      aimAngle: this.aimAngle,
      sprint: this.keys.sprint.isDown,
    };
  }
}
