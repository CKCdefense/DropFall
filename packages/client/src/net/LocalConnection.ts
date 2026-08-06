import {
  FixedStepAccumulator,
  RoomPhase,
  TICK_RATE,
  World,
  describeBossTelegraph,
  monstersData,
  type JobId,
  type SlotContainer,
  type PlayerInputMessage,
} from '@dropfall/shared';
import type { GameConnection, LobbyView, RoomInfo, WorldSnapshot } from './GameConnection';
import { SnapshotInterpolator } from './SnapshotInterpolator';

const LOCAL_SESSION_ID = 'local-player';
const SPAWN_X = 40;
const SPAWN_Y = 0;

/**
 * 서버 없이 브라우저 안에서 shared/sim을 그대로 돌리는 연결.
 *
 * 서버 작업이 막혀 있어도 클라이언트 개발이 멈추지 않게 하는 장치다.
 * `?local=1` 로 진입한다. shared/sim이 Phaser/DOM/Node에 의존하지 않기 때문에
 * 같은 코드가 여기서도 그대로 돈다. (docs/02-tech-spec.md §2.1)
 */
export class LocalConnection implements GameConnection {
  readonly isLocal = true;
  readonly sessionId = LOCAL_SESSION_ID;

  private readonly world = new World();
  private devResultCallback?: (result: { ok: boolean; message: string }) => void;
  /** world.tick()도 서버와 동일하게 TICK_RATE라 같은 보간이 필요하다(SnapshotInterpolator 참고). */
  private readonly interpolator = new SnapshotInterpolator();
  private readonly nickname: string;
  private job: JobId | '' = '';
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly stepper = new FixedStepAccumulator(1 / TICK_RATE);

  constructor(nickname: string) {
    this.nickname = nickname;
    // 서버(GameRoom#onJoin)와 마찬가지로 코어와 겹치지 않게 띄워 놓는다.
    this.world.addPlayer(LOCAL_SESSION_ID, SPAWN_X, SPAWN_Y);
    // 로컬 모드는 로비 대기 없이 항상 혼자라 인원이 이미 확정돼 있다 — 서버가
    // startGame() 시점에 하는 걸 여기선 생성자에서 바로 한다(docs/backend/41).
    this.world.startColonies(1);

    // setInterval은 요청한 주기를 지켜주지 않는다. 불린 횟수만큼 틱하면 밀린 시간이
    // 그대로 사라져 게임이 슬로모션이 된다 — 실제 흐른 시간을 재서 그만큼 따라잡는다.
    let previous = performance.now();
    this.timer = setInterval(() => {
      const now = performance.now();
      const elapsedSeconds = (now - previous) / 1000;
      previous = now;

      const steps = this.stepper.consume(elapsedSeconds);
      for (let i = 0; i < steps; i += 1) this.world.tick(this.stepper.step);
      if (steps > 0) this.interpolator.push(this.readRawSnapshot());
    }, 1000 / TICK_RATE);
  }

  get roomInfo(): RoomInfo {
    return { roomCode: 'LOCAL', roomName: '오프라인 테스트', hasPassword: false };
  }

  sendInput(input: PlayerInputMessage): void {
    this.world.setInput(LOCAL_SESSION_ID, input);
  }

  fire(): void {
    this.world.fireWeapon(LOCAL_SESSION_ID);
  }

  selectSlot(index: number): void {
    this.world.selectSlot(LOCAL_SESSION_ID, index);
  }

  useSlot(): void {
    this.world.useSelectedItem(LOCAL_SESSION_ID);
  }

  voteSkipDay(): void {
    this.world.castSkipVote(LOCAL_SESSION_ID);
  }

  pickUp(): void {
    this.world.pickUpNearestDrop(LOCAL_SESSION_ID);
  }

  moveItem(from: SlotContainer, fromIndex: number, to: SlotContainer, toIndex: number): void {
    this.world.moveItem(LOCAL_SESSION_ID, from, fromIndex, to, toIndex);
  }

  quickMoveItem(container: SlotContainer, index: number): void {
    this.world.quickMoveItem(LOCAL_SESSION_ID, container, index);
  }

  craft(recipeId: string): void {
    this.world.craftItem(LOCAL_SESSION_ID, recipeId);
  }

  shopSell(itemId: string, count: number): void {
    this.world.sellToShop(LOCAL_SESSION_ID, itemId, count);
  }

  shopBuy(itemId: string): void {
    this.world.buyFromShop(LOCAL_SESSION_ID, itemId);
  }

  upgradeCore(): void {
    this.world.upgradeCore(LOCAL_SESSION_ID);
  }

  placeBuilding(buildingType: string, cx: number, cy: number): void {
    this.world.placeBuilding(LOCAL_SESSION_ID, buildingType, cx, cy);
  }

  demolishBuilding(cx: number, cy: number): void {
    this.world.demolishBuilding(LOCAL_SESSION_ID, cx, cy);
  }

  /**
   * 로컬 모드는 개발 모드가 늘 켜져 있다 — 혼자 도는 시뮬레이션이라 치트로 망칠
   * 남의 판이 없다.
   */
  sendDevCommand(line: string): void {
    const result = this.world.runDevCommand(LOCAL_SESSION_ID, line);
    this.devResultCallback?.(result);
  }

  onDevResult(callback: (result: { ok: boolean; message: string }) => void): void {
    this.devResultCallback = callback;
  }

  debugJumpToWave(waveNumber: number): void {
    this.world.debugJumpToWave(waveNumber);
  }

  getSnapshot(): WorldSnapshot {
    return this.interpolator.sample();
  }

  private readRawSnapshot(): WorldSnapshot {
    const players: WorldSnapshot['players'] = [];
    for (const [id, player] of this.world.getPlayers()) {
      const inventory = player.inventory.toView();
      players.push({
        id,
        nickname: this.nickname,
        job: this.job,
        x: player.x,
        y: player.y,
        aimAngle: player.aimAngle,
        lastProcessedSeq: player.lastProcessedSeq,
        hp: player.hp,
        wood: player.inventory.countOf('wood'),
        stone: player.inventory.countOf('stone'),
        parts: player.inventory.countOf('drop_normal'),
        slots: inventory.slots,
        selectedSlot: inventory.selectedIndex,
        channelProgress: player.channelProgress,
      });
    }

    const monsters: WorldSnapshot['monsters'] = [];
    for (const [id, monster] of this.world.getMonsters()) {
      const telegraph = describeBossTelegraph(monster, monstersData[monster.type]);
      monsters.push({
        id,
        type: monster.type,
        x: monster.x,
        y: monster.y,
        hp: monster.hp,
        maxHp: monster.maxHp,
        telegraphKind: telegraph?.kind ?? '',
        telegraphX: telegraph?.x ?? 0,
        telegraphY: telegraph?.y ?? 0,
        telegraphDirX: telegraph?.dirX ?? 0,
        telegraphDirY: telegraph?.dirY ?? 0,
        telegraphRadius: telegraph?.radius ?? 0,
        telegraphRange: telegraph?.range ?? 0,
        telegraphRemaining: telegraph?.remaining ?? 0,
        telegraphTotal: telegraph?.total ?? 0,
      });
    }

    const projectiles: WorldSnapshot['projectiles'] = [];
    for (const [id, projectile] of this.world.getProjectiles()) {
      projectiles.push({ id, x: projectile.x, y: projectile.y, angle: projectile.angle });
    }

    const resourceNodes: WorldSnapshot['resourceNodes'] = [];
    for (const [id, node] of this.world.getResourceNodes()) {
      resourceNodes.push({
        id,
        type: node.type,
        x: node.x,
        y: node.y,
        hp: node.hp,
        maxHp: node.maxHp,
      });
    }

    const droppedItems: WorldSnapshot['droppedItems'] = [];
    for (const [id, drop] of this.world.getDroppedItems()) {
      droppedItems.push({ id, itemId: drop.itemId, count: drop.count, x: drop.x, y: drop.y });
    }

    const buildings: WorldSnapshot['buildings'] = [];
    for (const [id, building] of this.world.getBuildings()) {
      buildings.push({
        id,
        type: building.type,
        x: building.x,
        y: building.y,
        hp: building.hp,
        maxHp: building.maxHp,
      });
    }

    const colonies: WorldSnapshot['colonies'] = [];
    for (const [id, colony] of this.world.getColonies()) {
      colonies.push({ id, x: colony.x, y: colony.y, destroyed: colony.destroyed });
    }

    const core = this.world.getCore();

    return {
      players,
      monsters,
      projectiles,
      resourceNodes,
      droppedItems,
      buildings,
      colonies,
      status: {
        coreHp: core.hp,
        coreMaxHp: core.maxHp,
        coreSharedWood: core.storage.countOf('wood'),
        coreSharedStone: core.storage.countOf('stone'),
        coreParts: core.storage.countOf('drop_normal'),
        coreStorage: core.storage.toView().slots,
        coreSharedEnergy: core.sharedEnergy,
        coreMoney: core.money,
        shopStock: [...core.shopStock],
        coreTier: core.tier,
        coreBuildRadius: this.world.getBuildRadius(),
        craftingUnlocked: this.world.isCraftingUnlocked(),
        statUpgradesUnlocked: this.world.isStatUpgradesUnlocked(),
        wavePhase: this.world.getWavePhase(),
        currentWave: this.world.getCurrentWave(),
        phaseTimeRemaining: this.world.getPhaseTimeRemaining(),
        skipVoteCount: this.world.getSkipVoteCount(),
      },
    };
  }

  // ---------------------------------------------------------------- 대기실

  /**
   * 오프라인 모드는 혼자이고 방장이며, 대기실을 거치지 않고 바로 인게임으로 본다.
   * 직업만 로컬로 기억한다 — 서버가 없으니 동기화할 대상도 없다.
   */
  getLobbyView(): LobbyView {
    return {
      phase: RoomPhase.PLAYING,
      players: [
        {
          id: LOCAL_SESSION_ID,
          nickname: this.nickname,
          job: this.job,
          isReady: true,
          isHost: true,
          isMe: true,
        },
      ],
      amHost: true,
    };
  }

  selectJob(job: JobId): void {
    this.job = job;
  }

  setReady(): void {
    // 혼자라 준비 개념이 없다.
  }

  startGame(): void {
    // 이미 PLAYING 상태다.
  }

  onLobbyChange(): void {
    // 바뀔 상태가 없다.
  }

  onLobbyError(): void {
    // 서버가 없으니 거절도 없다.
  }

  onDisconnect(): void {
    // 로컬 모드에는 끊길 연결이 없다.
  }

  async leave(): Promise<void> {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
