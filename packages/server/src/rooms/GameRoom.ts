import { Client, Room } from 'colyseus';
import { MAX_CLIENTS_PER_ROOM, TICK_RATE, World, type PlayerInputMessage } from '@dropfall/shared';
import { GameRoomState, PlayerSchema } from '../schema/GameRoomState';

export class GameRoom extends Room {
  maxClients = MAX_CLIENTS_PER_ROOM;
  state = new GameRoomState();

  private world = new World();

  messages = {
    input: (client: Client, payload: PlayerInputMessage) => {
      this.world.setInput(client.sessionId, payload);
    },
  };

  onCreate(): void {
    this.setSimulationInterval(() => this.update(), 1000 / TICK_RATE);
  }

  onJoin(client: Client): void {
    this.world.addPlayer(client.sessionId);
    this.state.players.set(client.sessionId, new PlayerSchema());
  }

  onLeave(client: Client): void {
    this.world.removePlayer(client.sessionId);
    this.state.players.delete(client.sessionId);
  }

  private update(): void {
    this.world.tick(1 / TICK_RATE);

    for (const [id, player] of this.world.getPlayers()) {
      const schema = this.state.players.get(id);
      if (!schema) continue;
      schema.x = player.x;
      schema.y = player.y;
      schema.aimAngle = player.aimAngle;
      schema.lastProcessedSeq = player.lastProcessedSeq;
    }
  }
}
