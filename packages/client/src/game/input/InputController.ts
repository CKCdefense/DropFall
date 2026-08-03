import Phaser from 'phaser';
import { INPUT_SEND_RATE, normalizeMoveVector, type PlayerInputMessage } from '@dropfall/shared';
import type { GameConnection } from '../../net/GameConnection';

const SEND_INTERVAL_MS = 1000 / INPUT_SEND_RATE;

/**
 * WASD 이동 + 마우스 조준을 서버 입력 메시지로 바꿔 보낸다.
 *
 * 전송 주기를 서버 틱(`INPUT_SEND_RATE = TICK_RATE`)에 맞춘 이유:
 * 서버는 "마지막 입력을 새 입력이 올 때까지 매 틱 반복 적용"하는 모델이라, 렌더 프레임보다
 * 빠르게 보내봐야 중간 입력이 덮어써져 그냥 버려진다. 대역폭만 쓰고 이득이 없다.
 * (docs/frontend/02-lobby-room-protocol.md)
 */
export class InputController {
  private readonly keys: Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;
  private seq = 0;
  private elapsed = 0;
  private aimAngle = 0;

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
    };
  }

  /** 매 프레임 호출. 실제 전송은 SEND_INTERVAL_MS 마다 한 번. */
  update(delta: number, selfX: number, selfY: number): void {
    this.updateAim(selfX, selfY);

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
