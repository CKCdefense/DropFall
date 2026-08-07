import { ArraySchema, MapSchema, Schema, type } from '@colyseus/schema';
import { EXPLORED_BYTE_COUNT, RoomPhase, SLOT_COUNT, STORAGE_SLOT_COUNT } from '@dropfall/shared';

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
  /** 몬스터가 떨구는 부품(drop_normal) 휴대량. 나무/돌과 동일하게 창고로 옮겨야 팀 몫이 된다. */
  @type('number') parts = 0;
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
  /**
   * 지금 공격 모션 중인가. 클라이언트가 켜지는 순간에 공격 애니메이션을 재생한다.
   * 좌표처럼 매 틱 바뀌는 값이 아니라 공격당 두 번만 뒤집혀서 패치 비용이 거의 없다.
   */
  @type('boolean') attacking = false;
  /**
   * 왼쪽을 보고 있는가(스프라이트 좌우 반전용). 방향 벡터를 그대로 보내면 매 틱
   * 바뀌는 실수 두 개가 몬스터 수만큼 실려 나가는데, 그림에 실제로 쓰는 정보는
   * 부호 하나뿐이다. 제자리 공격 중에도 정확한 방향이 필요해서 서버가 알려준다.
   */
  @type('boolean') facingLeft = false;
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
  /** 성장 단계(1~3). 클라이언트가 크기/색으로 위협도를 보여준다. */
  @type('number') stage = 1;
  /** 아직 콜로니 안에 저장된 몬스터 수. 0이고 purified면 빈 껍데기다. */
  @type('number') stored = 0;
  /** 정화된 빈 껍데기 상태(다음 낮에 재보급). */
  @type('boolean') purified = false;
}

/**
 * AI 동반자("티모시"). 방(팀)당 1마리라 콜로니처럼 맵이 아니라 단일 필드로 둔다
 * (docs/superpowers/specs/2026-08-07-ai-companion-timothy-design.md).
 */
export class CompanionSchema extends Schema {
  @type('number') x = 0;
  @type('number') y = 0;
  /** 렌더러가 걷는 방향(스프라이트 방향)을 정하는 데 쓴다 — 플레이어의 aimAngle과 같은 역할. */
  @type('number') facingX = 0;
  @type('number') facingY = 1;
  /** CompanionState('seeking'|'traveling'|'harvesting'|'returning'|'depositing'|'downed') */
  @type('string') state = 'seeking';
  @type('number') carriedWood = 0;
  @type('number') carriedStone = 0;
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
  @type({ map: ColonySchema }) colonies = new MapSchema<ColonySchema>();
  @type(CompanionSchema) companion = new CompanionSchema();
  @type('number') coreHp = 0;
  @type('number') coreMaxHp = 0;
  /** 팀 공유 자원 창고(코어에 입고된 양). 건축 비용이 여기서 나간다. */
  @type('number') coreSharedWood = 0;
  @type('number') coreSharedStone = 0;
  /** 창고에 쌓인 부품(drop_normal). 상점 판매의 주 수입원이다. */
  @type('number') coreParts = 0;
  /** 콜로니 파괴 또는 보스 처치로만 얻는 희귀 자원. 코어 업그레이드/상점 구입 전용(아직 소비처 미구현). */
  @type('number') coreSharedEnergy = 0;
  /** 팀 공용 자금. 몬스터 드랍을 상점에 팔아 번다. */
  @type('number') coreMoney = 0;
  /** 오늘의 상점 진열(아이템 id). 낮이 될 때마다 통째로 바뀐다. */
  @type(['string']) shopStock = new ArraySchema<string>();
  /**
   * 팀이 밝힌 지역(칸당 1비트, 128×128 = 2KB). Colyseus가 **바뀐 바이트만** 델타로
   * 보내주므로 별도 메시지가 필요 없다 — 새로 합류한 사람은 전체를 한 번 받고,
   * 그 뒤로는 걸어다니며 바뀌는 몇 바이트만 흐른다.
   */
  @type(['uint8']) explored = new ArraySchema<number>(
    ...Array.from({ length: EXPLORED_BYTE_COUNT }, () => 0),
  );
  /** 구매한 코어 업그레이드 단계(0부터, 미구매 상태). */
  @type('number') coreTier = 0;
  /** 코어 원점 기준 건설 가능 반경(px) — 업그레이드로 늘어난다. */
  @type('number') coreBuildRadius = 0;
  /** 제작(CraftModal) 해금 여부. */
  @type('boolean') craftingUnlocked = false;
  /** 플레이어 스텟 증가 시스템 해금 여부(아직 그걸 쓸 UI/구매 로직은 없음 — 플래그만). */
  @type('boolean') statUpgradesUnlocked = false;
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
