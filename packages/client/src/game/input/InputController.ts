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
  /*
   * 소모품도 **무기 취급**으로 내려온다 — 좌클릭이 곧 맨손 공격이기 때문이다.
   * 사용은 우클릭으로 갈라져 나갔으므로, 좌클릭 경로에서 소모품만 따로 볼 이유가 없다.
   * 서버도 같은 결론을 낸다(무기가 아니면 BARE_HANDS_WEAPON_ID).
   */
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
 * WASD 이동 + 마우스 조준을 서버 입력 메시지로 바꿔 보낸다.
 *
 * 전송 주기를 서버 틱(`INPUT_SEND_RATE = TICK_RATE`)에 맞춘 이유:
 * 서버는 "마지막 입력을 새 입력이 올 때까지 매 틱 반복 적용"하는 모델이라, 렌더 프레임보다
 * 빠르게 보내봐야 중간 입력이 덮어써져 그냥 버려진다. 대역폭만 쓰고 이득이 없다.
 * (docs/frontend/02-lobby-room-protocol.md)
 */
export class InputController {
  /** 지금 고른 퀵슬롯. 스냅샷에서 갱신되고 휠이 다음 칸을 셀 때 기준이 된다. */
  private selectedSlot = 0;

  /**
   * 누적 시간(ms). 무기별 다음 발사 가능 시각을 재는 기준이다 — 버튼을 떼도 계속
   * 흐르므로 연타로 쿨다운을 건너뛸 수 없다.
   */
  private clock = 0;
  /** 무기 id → 다음 발사 가능 시각. 서버 CooldownTracker가 (플레이어, 무기)별인 것과 같다. */
  private readonly nextFireAt = new Map<string, number>();
  /** 이번에 누른 동안 건축물을 이미 놓았는지. 홀드 연타 방지용. */
  private placedThisPress = false;
  /** 직전 프레임에 좌클릭을 누르고 있었는지. "새로 눌렀다"(빈 탄창 클릭음)를 가리는 데 쓴다. */
  private wasHolding = false;

  private readonly keys: Record<
    'up' | 'down' | 'left' | 'right' | 'sprint' | 'interact',
    Phaser.Input.Keyboard.Key
  >;
  private seq = 0;
  private elapsed = 0;
  private aimAngle = 0;
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
     * 탄창이 빈 채로 방아쇠를 당긴 그 순간(첫 클릭에만) 호출된다. 홀드 중 매 프레임
     * 부르면 안 되므로 §updateFire가 "새로 눌렀다"를 따로 가려낸다.
     */
    private readonly onEmptyFire?: (weaponId: string) => void,
    /**
     * E를 눌렀을 때 호출된다(코어 모달 열기·닫기, 쓰러진 동료 구조 등). 줍기는
     * 스페이스로 분리돼 있어(§SPACE 핸들러) 이 콜백의 반환값과는 무관하다.
     */
    private readonly onInteract?: () => boolean,
    /**
     * 포인터가 HUD(모달 등) 위인지. true면 좌클릭을 게임 입력으로 쓰지 않는다 —
     * 모달에 차단막이 없어서(게임을 계속 보여줘야 한다) 좌표로 판정해야 한다.
     */
    private readonly isPointerOverHud?: (x: number, y: number) => boolean,
    /**
     * 서버로 입력을 보낼 때마다(전송 지점 두 곳 모두) 같이 호출된다 — 클라이언트
     * 예측(`PlayerPredictor`)이 이 입력을 즉시 로컬에 반영하는 훅이다. 입력 자체를
     * 여기서 만들지 않고 이미 만든 값을 그대로 넘긴다 — 정규화 규칙이 두 곳에서
     * 갈라지면 예측이 서버와 어긋난다.
     */
    private readonly onInputSent?: (input: PlayerInputMessage) => void,
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
      /*
       * 상호작용. 코어 창을 여는 키와 **같은 키**다 — 쓰러진 동료 옆에서 누르고 있으면
       * 구조가 찬다(5초). 코어 옆에서 누르면 창이 열린다. 둘을 갈라 새 키를 만들지
       * 않은 이유는, 플레이어가 하는 일은 어느 쪽이든 "앞의 것에 손을 대는" 하나라서다.
       *
       * 구조는 **누르고 있는 상태**라 이벤트가 아니라 매 틱 입력에 실어 보낸다(sprint와 같다).
       */
      interact: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E),
    };

    // 낮 넘기기 투표(만장일치). 서버가 중복 투표를 무시하므로 한 번만 보내면 된다.
    keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.V).on('down', () => {
      this.connection.voteSkipDay();
    });

    // 상호작용(E) — 코어 창 열기·닫기, 쓰러진 동료 구조.
    keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E).on('down', () => {
      this.onInteract?.();
    });

    // 줍기(스페이스). 예전엔 E 하나가 "앞의 것에 손을 댄다"를 전부 맡아서, 코어 앞에
    // 떨어진 드롭을 밟고 있으면 줍기와 창 열기가 서로 순서를 양보하느라 둘 다 답답했다.
    // 키를 나누면 "무엇을 할지"를 플레이어가 고르므로 그 다툼 자체가 없어진다(게임
    // 흐름 피드백 — E가 WASD 바로 옆이라 이동하면서 줍기가 어렵다는 지적).
    keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE).on('down', () => {
      this.connection.pickUp();
    });

    // 퀵슬롯 선택(1~4). 슬롯 번호만 보내고 그 칸에 뭐가 들었는지는 서버가 판단한다.
    // 화면 반영도 서버 스냅샷을 통해서만 이뤄진다 — 로컬에서 미리 바꾸면 서버가
    // 거절했을 때 두 상태가 어긋난다.
    for (let index = 0; index < SLOT_COUNT; index += 1) {
      keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ONE + index).on('down', () => {
        this.connection.selectSlot(index);
      });
    }


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
      if (this.isPointerOverHud?.(pointer.x, pointer.y)) return;

      if (pointer.rightButtonDown()) {
        /*
         * **소모품 사용은 우클릭이다.** 좌클릭 하나에 공격과 사용을 겹쳐 놓으면, 붕대를
         * 들고 몬스터를 때리는 것과 붕대를 쓰는 것을 구분할 방법이 없다.
         *
         * 홀드 연타 방지를 따로 두지 않는 이유는 이게 **누른 순간에만** 도는
         * 이벤트라서다 — 예전 좌클릭 경로는 매 프레임 도는 루프라 타이머로 막아야 했다.
         * 쓸 수 없는 것을 들고 눌러도 서버가 조용히 무시한다.
         */
        this.connection.useSlot();
      }
    });

    /*
     * 휠로 퀵슬롯을 넘긴다. 숫자키(1~4)와 나란히 두는 이유는 전투 중에 손가락을 WASD에서
     * 떼지 않고도 바꿀 수 있어서다 — 위로 굴리면 앞 칸, 아래로 굴리면 뒤 칸이고 양끝에서
     * 돌아온다(4에서 아래로 굴리면 1).
     */
    scene.input.on(
      'wheel',
      (pointer: Phaser.Input.Pointer, _objects: unknown, _dx: number, dy: number) => {
        if (this.isPointerOverHud?.(pointer.x, pointer.y)) return;
        if (dy === 0) return;
        const step = dy > 0 ? 1 : -1;
        this.selectedSlot = (this.selectedSlot + step + SLOT_COUNT) % SLOT_COUNT;
        this.connection.selectSlot(this.selectedSlot);
      },
    );
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

  /** 이동키를 하나라도 누르고 있는가. 발소리 SFX가 "지금 걷고 있나"를 물을 때 쓴다. */
  get isMoving(): boolean {
    return this.keys.up.isDown || this.keys.down.isDown || this.keys.left.isDown || this.keys.right.isDown;
  }

  /**
   * 좌클릭을 지금 누르고 있는가(HUD 위는 제외). `updateFire`가 매 프레임 `wasHolding`을
   * 그 프레임의 실제 상태로 갱신하므로 이름과 달리 "지금" 값이다 — 기관총류 SFX가
   * "아직도 쏘는 중인가"를 물을 때 쓴다(§AudioManager.updateAutoFire).
   */
  get isFiring(): boolean {
    return this.wasHolding;
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
    this.keys.interact.reset();
    this.placedThisPress = false;
    this.seq += 1;
    const input = this.buildInput();
    this.connection.sendInput(input);
    this.onInputSent?.(input);
  }

  get weaponId(): string | undefined {
    return this.equipped.weaponId;
  }

  /**
   * 좌클릭은 **언제나 공격이다** — 무기를 들었으면 그 무기로, 아니면 맨손으로.
   * 사용(소모품)은 우클릭으로 갈라져 있다(§pointerdown).
   *
   * **연출은 "실제로 나갈 공격"에만 붙는다.** 예전엔 버튼을 뗄 때마다 발사 타이머를
   * 0으로 되돌려서, 연타하면 쿨다운과 무관하게 매번 휘두르기·총구 화염이 나왔다 —
   * 서버는 하나만 받아들이는데 화면만 대여섯 번 번쩍였다. 이제 타이머를 무기별로
   * 계속 흘려보내고(서버 CooldownTracker와 같은 단위), 재장전 중·빈 탄창·쓰러진
   * 상태도 스냅샷으로 미리 걸러 낸다.
   *
   * 서버 응답을 기다리지 않는 것은 그대로다 — 타격감은 지연되면 안 된다. 대신
   * 클라이언트가 서버보다 **너그럽지 않게** 판단해서 헛연출이 안 나오게 한다.
   */
  private updateFire(delta: number, self: PlayerView): void {
    this.clock += delta;

    const pointer = this.scene.input.activePointer;
    const holding = pointer.leftButtonDown() && !this.isPointerOverHud?.(pointer.x, pointer.y);
    const freshPress = holding && !this.wasHolding;
    this.wasHolding = holding;
    if (!holding) {
      this.placedThisPress = false;
      return;
    }

    const { kind, weaponId } = this.equipped;

    if (kind === 'building') {
      // 건축물은 홀드 연타를 막는다 — 커서를 조금 움직이는 사이에 인벤토리가 비어버린다.
      if (this.placedThisPress) return;
      this.placedThisPress = true;
      const cell = this.cursorCell();
      this.connection.placeHeldBuilding(cell.cx, cell.cy);
      return;
    }

    if (kind !== 'weapon' || !weaponId) return;
    if (!this.canAttack(self, weaponId)) {
      // 막힌 이유가 "탄창이 비어서"일 때만, 그것도 새로 누른 순간에만 빈 탄창 소리를 낸다 —
      // 재장전 중이거나 그냥 쿨다운 중일 때 홀드하고 있으면 매 프레임 걸려서 시끄러워진다.
      if (freshPress && self.hp > 0 && self.reloadRemaining <= 0 && self.ammoMagazine > 0 && self.ammo <= 0) {
        this.onEmptyFire?.(weaponId);
      }
      return;
    }

    this.nextFireAt.set(weaponId, this.clock + fireIntervalMs(weaponId));
    this.connection.fire();
    // 연출은 서버 응답을 기다리지 않고 즉시 그린다 — 위 검사를 통과했으면 서버도
    // 받아들일 공격이다.
    this.onAttack?.(weaponId);
  }

  /**
   * 지금 이 공격이 **실제로 나갈 수 있는가.** 서버 `World.fireWeapon`의 관문을 같은
   * 순서로 다시 본다 — 쓰러짐 → 쿨다운 → 탄약. 서버가 쓰는 여유(FIRE_COOLDOWN_GRACE)는
   * 일부러 안 쓴다. 클라이언트가 더 너그러우면 헛연출이 다시 생긴다.
   */
  private canAttack(self: PlayerView, weaponId: string): boolean {
    if (self.hp <= 0) return false;
    if (self.reloadRemaining > 0) return false;
    // 탄창이 있는 무기(ammoMagazine > 0)만 탄약을 본다 — 근접·맨손은 0이다.
    if (self.ammoMagazine > 0 && self.ammo <= 0) return false;
    return this.clock >= (this.nextFireAt.get(weaponId) ?? 0);
  }

  /** 매 프레임 호출. 실제 전송은 SEND_INTERVAL_MS 마다 한 번. */
  update(delta: number, self: PlayerView): void {
    // 선택 칸은 서버가 정한 값을 그대로 따라간다 — 휠은 여기서 읽은 값을 기준으로
    // 다음 칸을 계산한다(클라가 따로 세어 두면 숫자키와 어긋난다).
    this.selectedSlot = self.selectedSlot;
    this.equipped = readEquipped(self);
    this.updateAim(self.x, self.y);
    this.updateFire(delta, self);

    this.elapsed += delta;
    if (this.elapsed < SEND_INTERVAL_MS) return;
    /*
     * 0으로 리셋하지 않고 나머지를 이월한다. 리셋하면 (프레임 시간 나머지)가 매번
     * 증발해서 전송률이 조용히 떨어진다 — 144Hz 모니터면 6.9ms×3 프레임 = 20.8ms마다
     * 전송하고 4.2ms를 버려 실효 48Hz가 된다. 예측(PlayerPredictor)은 전송 1회당
     * 고정 스텝(1/60초)씩만 전진하므로, 그만큼 서버보다 계속 뒤처져 재조정마다
     * 미세하게 앞으로 당겨졌다(고주사율에서만 보이는 고무줄, docs/frontend/23).
     * 큰 프레임 드랍 뒤에 밀린 횟수만큼 몰아 보내지는 않는다(%=) — 서버는 어차피
     * 마지막 입력을 반복 적용하므로 놓친 주기는 보낼 가치가 없다.
     */
    this.elapsed %= SEND_INTERVAL_MS;

    this.seq += 1;
    const input = this.buildInput();
    this.connection.sendInput(input);
    this.onInputSent?.(input);
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
      interact: this.keys.interact.isDown,
    };
  }
}
