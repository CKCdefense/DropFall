import Phaser from 'phaser';
import {
  INPUT_SEND_RATE,
  normalizeMoveVector,
  worldToCell,
  type PlayerInputMessage,
} from '@dropfall/shared';
import type { GameConnection } from '../../net/GameConnection';

const SEND_INTERVAL_MS = 1000 / INPUT_SEND_RATE;

/** 기본 무기. 무기 교체가 생기면 상태에서 읽어온다. */
const DEFAULT_WEAPON_ID = 'pistol';
/** 홀드 연사 재전송 간격. 실제 발사 속도는 서버(weapons.json)가 정한다. */
const FIRE_INTERVAL_MS = 100;
/** 채집 홀드 재전송 간격. 실제 채집 주기는 서버(resources.json)가 정한다. */
const HARVEST_INTERVAL_MS = 100;

/**
 * 건축모드에서 순환할 건축물 목록(docs/backend/18 §1 "B 건축모드 토글"). 'off'가
 * 항상 첫 자리라 B를 계속 누르면 결국 꺼진 상태로 돌아온다 — 별도 "나가기" 키가
 * 없어도 된다.
 */
const BUILD_MODES = ['off', 'fence', 'wall'] as const;
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
  private readonly keys: Record<'up' | 'down' | 'left' | 'right' | 'harvest', Phaser.Input.Keyboard.Key>;
  private seq = 0;
  private fireTimer = 0;
  private harvestTimer = 0;
  private elapsed = 0;
  private aimAngle = 0;
  private buildModeIndex = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly connection: GameConnection,
  ) {
    const keyboard = scene.input.keyboard;
    if (!keyboard) throw new Error('키보드 입력을 사용할 수 없습니다.');

    this.keys = {
      up: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      // 채집(E, 상호작용 키 — docs/backend/18 §3.1). 홀드하는 동안 반복 전송해서
      // "채널링" 느낌을 낸다 — 서버는 harvestInterval 쿨다운으로 실제 속도를 정한다.
      harvest: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E),
    };

    // 낮 넘기기 투표(만장일치). 서버가 중복 투표를 무시하므로 한 번만 보내면 된다.
    keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.V).on('down', () => {
      this.connection.voteSkipDay();
    });

    // 건축모드 순환(off → fence → wall → off...). 좌클릭은 건축모드일 때 설치로,
    // 아닐 때는 기존처럼 사격으로 쓴다 — 두 조작이 같은 버튼을 나눠 쓰는 구조다.
    keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.B).on('down', () => {
      this.buildModeIndex = (this.buildModeIndex + 1) % BUILD_MODES.length;
    });

    // 우클릭으로 건축모드를 바로 취소할 수 있게, 브라우저 기본 우클릭 메뉴부터 끈다.
    scene.input.mouse?.disableContextMenu();
    scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.buildMode === 'off') return;

      if (pointer.rightButtonDown()) {
        this.buildModeIndex = 0;
        return;
      }
      if (pointer.leftButtonDown()) {
        const world = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const { cx, cy } = worldToCell(world.x, world.y);
        this.connection.placeBuilding(this.buildMode, cx, cy);
      }
    });
  }

  get buildMode(): BuildMode {
    return BUILD_MODES[this.buildModeIndex];
  }

  /**
   * 사격은 입력 주기와 무관하게 누른 즉시 보낸다 — 쿨다운·탄약 판정은 서버가 한다.
   * 홀드 연사는 클라이언트가 FIRE_INTERVAL_MS로 되풀이해서 보내고, 서버가 다시 걸러낸다.
   * 건축모드일 땐 좌클릭이 사격이 아니라 설치로 쓰이므로 사격 자체를 건너뛴다.
   */
  private updateFire(delta: number): void {
    const pointer = this.scene.input.activePointer;
    if (this.buildMode !== 'off' || !pointer.leftButtonDown()) {
      this.fireTimer = 0;
      return;
    }

    this.fireTimer -= delta;
    if (this.fireTimer > 0) return;

    this.fireTimer = FIRE_INTERVAL_MS;
    this.connection.fire(DEFAULT_WEAPON_ID);
  }

  /** 사격과 같은 홀드-재전송 패턴 — 실제 채집 여부/속도는 서버가 판정한다. */
  private updateHarvest(delta: number): void {
    if (!this.keys.harvest.isDown) {
      this.harvestTimer = 0;
      return;
    }

    this.harvestTimer -= delta;
    if (this.harvestTimer > 0) return;

    this.harvestTimer = HARVEST_INTERVAL_MS;
    this.connection.harvest();
  }

  /** 매 프레임 호출. 실제 전송은 SEND_INTERVAL_MS 마다 한 번. */
  update(delta: number, selfX: number, selfY: number): void {
    this.updateAim(selfX, selfY);
    this.updateFire(delta);
    this.updateHarvest(delta);

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
    this.aimAngle = Math.atan2(world.y - selfY, world.x - selfX);
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
    return { seq: this.seq, ...normalized, aimAngle: this.aimAngle };
  }
}
