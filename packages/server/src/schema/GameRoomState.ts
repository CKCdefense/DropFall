import { MapSchema, Schema, type } from '@colyseus/schema';

export class PlayerSchema extends Schema {
  @type('number') x = 0;
  @type('number') y = 0;
  @type('number') aimAngle = 0;
  @type('number') lastProcessedSeq = 0;
}

export class GameRoomState extends Schema {
  @type({ map: PlayerSchema }) players = new MapSchema<PlayerSchema>();
}
