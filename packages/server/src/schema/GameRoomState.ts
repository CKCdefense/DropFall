import { MapSchema, Schema, type } from '@colyseus/schema';
import { RoomPhase } from '@dropfall/shared';

export class PlayerSchema extends Schema {
  @type('string') nickname = '';
  /** 선택 전에는 빈 문자열. JobId 값 (docs/frontend/08 참고) */
  @type('string') job = '';
  @type('boolean') isReady = false;
  @type('number') x = 0;
  @type('number') y = 0;
  @type('number') aimAngle = 0;
  @type('number') lastProcessedSeq = 0;
  @type('number') hp = 0;
  @type('number') wood = 0;
  @type('number') stone = 0;
}

export class MonsterSchema extends Schema {
  @type('string') type = '';
  @type('number') x = 0;
  @type('number') y = 0;
  @type('number') hp = 0;
  @type('number') maxHp = 0;
  /** 보스 전용 공격 예고(텔레그래프). 진행 중이 아니면 빈 문자열('' | 'charge' | 'slam'). */
  @type('string') telegraphKind = '';
  @type('number') telegraphX = 0;
  @type('number') telegraphY = 0;
  @type('number') telegraphDirX = 0;
  @type('number') telegraphDirY = 0;
  /** 돌진: 경로 폭의 절반. 광역: 범위 반경. */
  @type('number') telegraphRadius = 0;
  /** 돌진: 예고 종료 시 실제로 도달할 거리. 광역: 0. */
  @type('number') telegraphRange = 0;
  @type('number') telegraphRemaining = 0;
  @type('number') telegraphTotal = 0;
}

export class ProjectileSchema extends Schema {
  @type('number') x = 0;
  @type('number') y = 0;
}

export class ResourceNodeSchema extends Schema {
  @type('string') type = '';
  @type('number') x = 0;
  @type('number') y = 0;
  @type('number') remainingHarvests = 0;
}

export class BuildingSchema extends Schema {
  @type('string') type = '';
  @type('number') x = 0;
  @type('number') y = 0;
  @type('number') hp = 0;
  @type('number') maxHp = 0;
}

export class GameRoomState extends Schema {
  /** 방 코드 = roomId. 클라이언트가 HUD에 띄워 친구에게 불러줄 수 있게 상태로도 내려준다. */
  @type('string') roomCode = '';
  @type('string') roomName = '';
  @type('boolean') hasPassword = false;
  /** 'lobby' | 'playing' — RoomPhase */
  @type('string') phase: string = RoomPhase.LOBBY;
  /** 방장. 나가면 다음 사람에게 넘어간다 */
  @type('string') hostSessionId = '';
  @type({ map: PlayerSchema }) players = new MapSchema<PlayerSchema>();
  @type({ map: MonsterSchema }) monsters = new MapSchema<MonsterSchema>();
  @type({ map: ProjectileSchema }) projectiles = new MapSchema<ProjectileSchema>();
  @type({ map: ResourceNodeSchema }) resourceNodes = new MapSchema<ResourceNodeSchema>();
  @type({ map: BuildingSchema }) buildings = new MapSchema<BuildingSchema>();
  @type('number') coreHp = 0;
  @type('number') coreMaxHp = 0;
  /** 'day' | 'night' | 'victory' | 'defeat' (shared/sim의 GamePhase) */
  @type('string') wavePhase = 'day';
  @type('number') currentWave = 0;
  /** 낮 스킵 투표 동의 인원. 만장일치 기준이라 필요 인원은 players.size다. */
  @type('number') skipVoteCount = 0;
}
