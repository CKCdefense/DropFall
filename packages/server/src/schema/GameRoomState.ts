import { ArraySchema, MapSchema, Schema, type } from '@colyseus/schema';
import { RoomPhase, SLOT_COUNT, STORAGE_SLOT_COUNT } from '@dropfall/shared';

/**
 * 퀵슬롯 한 칸. 빈 칸은 배열에서 빼지 않고 itemId를 ''로 둔다 —
 * 길이가 고정이라야 클라이언트의 칸 번호가 흔들리지 않는다.
 */
export class ItemSlotSchema extends Schema {
  @type('string') itemId = '';
  @type('number') count = 0;
}

/** 바닥에 떨어진 아이템 하나. */
export class DroppedItemSchema extends Schema {
  @type('string') itemId = '';
  @type('number') count = 0;
  @type('number') x = 0;
  @type('number') y = 0;
}

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
  /** 콜로니 채널링(파괴 작업) 진행률(0~1). 채널링 중이 아니면 0. */
  @type('number') channelProgress = 0;
  @type([ItemSlotSchema]) slots = new ArraySchema<ItemSlotSchema>(
    ...Array.from({ length: SLOT_COUNT }, () => new ItemSlotSchema()),
  );
  @type('number') selectedSlot = 0;
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
  /** 진행 방향(라디안). 직진만 하므로 발사 직후 한 번만 전송된다. */
  @type('number') angle = 0;
}

export class ResourceNodeSchema extends Schema {
  @type('string') type = '';
  @type('number') x = 0;
  @type('number') y = 0;
  @type('number') hp = 0;
  @type('number') maxHp = 0;
}

export class BuildingSchema extends Schema {
  @type('string') type = '';
  @type('number') x = 0;
  @type('number') y = 0;
  @type('number') hp = 0;
  @type('number') maxHp = 0;
}

export class ColonySchema extends Schema {
  @type('number') x = 0;
  @type('number') y = 0;
  @type('boolean') destroyed = false;
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
  @type({ map: ColonySchema }) colonies = new MapSchema<ColonySchema>();
  @type('number') coreHp = 0;
  @type('number') coreMaxHp = 0;
  /** 팀 공유 자원 창고(코어에 입고된 양). 건축 비용이 여기서 나간다. */
  @type('number') coreSharedWood = 0;
  @type('number') coreSharedStone = 0;
  /** 콜로니 파괴로만 얻는 전용 자원. 코어 업그레이드/상점 구입 전용(아직 소비처 미구현). */
  @type('number') coreSharedEnergy = 0;
  @type({ map: DroppedItemSchema }) droppedItems = new MapSchema<DroppedItemSchema>();
  /**
   * 코어 창고. 인벤토리와 같은 슬롯 구조라 ItemSlotSchema를 재사용한다 —
   * 빈 칸은 itemId ''로 두고 길이를 고정해 클라이언트의 칸 번호가 흔들리지 않게 한다.
   */
  @type([ItemSlotSchema]) coreStorage = new ArraySchema<ItemSlotSchema>(
    ...Array.from({ length: STORAGE_SLOT_COUNT }, () => new ItemSlotSchema()),
  );
  /** 'day' | 'night' | 'victory' | 'defeat' (shared/sim의 GamePhase) */
  @type('string') wavePhase = 'day';
  @type('number') currentWave = 0;
  /** 현재 페이즈가 끝나기까지 남은 시간(초) */
  @type('number') phaseTimeRemaining = 0;
  /** 낮 스킵 투표 동의 인원. 만장일치 기준이라 필요 인원은 players.size다. */
  @type('number') skipVoteCount = 0;
}
