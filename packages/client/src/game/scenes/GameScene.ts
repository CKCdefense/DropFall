import Phaser from 'phaser';
import { MAP_SIZE_TILES, TILE_SIZE, computeCameraZoom } from '@dropfall/shared';
import type { GameConnection } from '../../net/GameConnection';
import {
  CONNECTION_KEY,
  CORE_INTERACT_KEY,
  HUD_BLOCK_KEY,
  INPUT_CONTROLLER_KEY,
} from '../createGame';
import { EntityRenderer } from '../render/EntityRenderer';
import { queueGameAtlas } from '../render/playerSprite';
import { TerrainLayer, hasTerrainTileset, queueTerrainTileset } from '../render/TerrainLayer';
import { InputController } from '../input/InputController';
import { HUD_SCENE_KEY } from './HudScene';

export const GAME_SCENE_KEY = 'Game';

/**
 * 맵 크기. 반드시 shared의 MAP_SIZE_TILES(FlowField/지형/콜로니가 실제로 쓰는 맵
 * 크기)와 같은 값을 써야 한다 — 예전엔 여기 독립적으로 `TILE_SIZE * 80`(1280px,
 * 절반 640px)이라는 "임시" 값을 박아뒀는데, 실제 맵은 그보다 훨씬 큰
 * `MAP_SIZE_TILES * TILE_SIZE`(2048px, 절반 1024px)였다. 카메라 bounds
 * (setBounds)가 이 상수로 제한되다 보니, 맵 안에 있는(예: 900px 밖 콜로니)
 * 엔티티인데도 카메라가 거기까지 스크롤을 못 해서 "렌더링 밖이라 갈 수 없다"는
 * 버그가 있었다(docs/backend/35 이후 발견). 맵 크기를 새로 정의하지 말고 항상
 * 이 상수를 그대로 쓸 것.
 */
const WORLD_WIDTH = TILE_SIZE * MAP_SIZE_TILES;
const WORLD_HEIGHT = TILE_SIZE * MAP_SIZE_TILES;

export class GameScene extends Phaser.Scene {
  private connection!: GameConnection;
  private entityRenderer!: EntityRenderer;
  private terrain?: TerrainLayer;
  private input_!: InputController;
  private isFollowing = false;
  private collisionDebugVisible = false;

  constructor() {
    super(GAME_SCENE_KEY);
  }

  init(): void {
    this.connection = this.registry.get(CONNECTION_KEY) as GameConnection;
  }

  preload(): void {
    // 아틀라스가 아직 없어도 게임은 떠야 한다 — 실패하면 도형 플레이스홀더로 그린다.
    queueGameAtlas(this);
    queueTerrainTileset(this);
  }

  create(): void {
    this.scene.launch(HUD_SCENE_KEY);

    this.cameras.main.setBackgroundColor('#20242e');
    this.cameras.main.setBounds(-WORLD_WIDTH / 2, -WORLD_HEIGHT / 2, WORLD_WIDTH, WORLD_HEIGHT);
    this.cameras.main.roundPixels = true;

    this.drawGround();
    this.drawCore();

    this.entityRenderer = new EntityRenderer(this, this.connection.sessionId);
    this.input_ = new InputController(
      this,
      this.connection,
      () => this.entityRenderer.playAttack(this.connection.sessionId),
      // HudScene이 등록한다. 씬 시작 순서와 무관하도록 매번 registry에서 꺼내 쓴다.
      () => (this.registry.get(CORE_INTERACT_KEY) as (() => boolean) | undefined)?.() ?? false,
      (x, y) =>
        (this.registry.get(HUD_BLOCK_KEY) as ((x: number, y: number) => boolean) | undefined)?.(
          x,
          y,
        ) ?? false,
    );
    // HudScene은 매 프레임 registry에서 다시 읽으므로(HudScene.update), 씬 시작 순서와
    // 무관하게 늦어도 다음 프레임엔 값이 채워져 있다.
    this.registry.set(INPUT_CONTROLLER_KEY, this.input_);

    this.applyZoom();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.applyZoom, this);

    // C: 플레이어-건축물 충돌 판정 반경 디버그 테두리 토글. 실제 캐릭터 에셋을
    // 씌우면 그림만 봐서는 판정 범위를 가늠하기 어려워서, 확인용으로 추가했다.
    this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.C).on('down', () => {
      this.collisionDebugVisible = !this.collisionDebugVisible;
      this.entityRenderer.setCollisionDebugVisible(this.collisionDebugVisible);
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.applyZoom, this);
      this.entityRenderer.destroy();
      this.terrain?.destroy();
    });
  }

  update(_time: number, delta: number): void {
    const snapshot = this.connection.getSnapshot();
    // 휘두르기는 스냅샷이 아니라 시간으로 진행한다 — sync보다 먼저 갱신해야 이번 프레임에 반영된다.
    this.entityRenderer.advance(delta);
    this.entityRenderer.sync(snapshot);

    const me = snapshot.players.find((player) => player.id === this.connection.sessionId);
    if (!me) return;

    this.input_.update(delta, me);

    if (!this.isFollowing) {
      const sprite = this.entityRenderer.getSprite(me.id);
      if (sprite) {
        this.cameras.main.startFollow(sprite, true, 0.2, 0.2);
        this.isFollowing = true;
      }
    }
  }

  /**
   * 캔버스는 창 크기 그대로 두고 카메라만 정수배로 줌한다.
   * 월드 안의 텍스트(닉네임 등)는 줌 배수만큼 해상도를 올려야 선명하다.
   */
  private applyZoom(): void {
    const zoom = computeCameraZoom(this.scale.width, this.scale.height);
    if (this.cameras.main.zoom === zoom) return;

    this.cameras.main.setZoom(zoom);
    this.entityRenderer?.setZoom(zoom);
  }

  /**
   * 바닥. 타일셋이 있으면 지형을 깔고, 없으면 좌표 감각용 격자로 대체한다.
   *
   * 지형은 방 코드를 시드로 삼아 각자 계산한다 — 서버가 128×128칸을 내려보낼 필요 없이
   * 같은 방 사람들이 똑같은 지형을 본다.
   */
  private drawGround(): void {
    if (hasTerrainTileset(this)) {
      this.terrain = new TerrainLayer(this, this.connection.roomInfo.roomCode);
      return;
    }
    this.drawGrid();
  }

  /** 좌표 감각을 잡기 위한 임시 격자. 타일셋이 없을 때만 쓴다. */
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
