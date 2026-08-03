import Phaser from 'phaser';
import { TILE_SIZE } from '@dropfall/shared';
import type { GameConnection } from '../../net/GameConnection';
import { CONNECTION_KEY } from '../createGame';
import { EntityRenderer } from '../render/EntityRenderer';
import { InputController } from '../input/InputController';
import { HUD_SCENE_KEY } from './HudScene';

export const GAME_SCENE_KEY = 'Game';

/** 임시 맵 크기. Tiled 맵이 들어오면 교체된다. */
const WORLD_WIDTH = TILE_SIZE * 80;
const WORLD_HEIGHT = TILE_SIZE * 80;

export class GameScene extends Phaser.Scene {
  private connection!: GameConnection;
  private entityRenderer!: EntityRenderer;
  private input_!: InputController;
  private isFollowing = false;

  constructor() {
    super(GAME_SCENE_KEY);
  }

  init(): void {
    this.connection = this.registry.get(CONNECTION_KEY) as GameConnection;
  }

  create(): void {
    this.scene.launch(HUD_SCENE_KEY);

    this.cameras.main.setBackgroundColor('#20242e');
    this.cameras.main.setBounds(-WORLD_WIDTH / 2, -WORLD_HEIGHT / 2, WORLD_WIDTH, WORLD_HEIGHT);
    this.cameras.main.roundPixels = true;

    this.drawGrid();
    this.drawCore();

    this.entityRenderer = new EntityRenderer(this, this.connection.sessionId);
    this.input_ = new InputController(this, this.connection);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.entityRenderer.destroy());
  }

  update(_time: number, delta: number): void {
    const snapshot = this.connection.getSnapshot();
    this.entityRenderer.sync(snapshot);

    const me = snapshot.players.find((player) => player.id === this.connection.sessionId);
    if (!me) return;

    this.input_.update(delta, me.x, me.y);

    if (!this.isFollowing) {
      const sprite = this.entityRenderer.getSprite(me.id);
      if (sprite) {
        this.cameras.main.startFollow(sprite, true, 0.2, 0.2);
        this.isFollowing = true;
      }
    }
  }

  /** 좌표 감각을 잡기 위한 임시 격자. Tiled 맵으로 교체 예정. */
  private drawGrid(): void {
    const grid = this.add.grid(
      0,
      0,
      WORLD_WIDTH,
      WORLD_HEIGHT,
      TILE_SIZE,
      TILE_SIZE,
      0x20242e,
      1,
      0x2b303c,
      1,
    );
    grid.setDepth(-1000);
  }

  /** 중앙 코어 자리 표시. 실제 코어 로직은 아직 sim에 없다. */
  private drawCore(): void {
    const core = this.add.rectangle(0, 0, TILE_SIZE * 2, TILE_SIZE * 2, 0x3a4658);
    core.setStrokeStyle(1, 0x7f8fa6);
    core.setDepth(-900);
  }
}
