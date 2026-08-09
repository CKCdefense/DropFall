import { ArraySchema, MapSchema, Schema, type } from '@colyseus/schema';
import {
  EXPLORED_BYTE_COUNT,
  RoomPhase,
  SLOT_COUNT,
  STORAGE_SLOT_COUNT,
  chargingData,
} from '@dropfall/shared';

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
  /** 직업 기초 체력 + 음식 보너스. HP바 비율 계산은 상수가 아니라 이 값을 쓴다. */
  @type('number') maxHp = 0;
  /** 남은 스태미나와 최대치. 달리기 게이지가 이 둘로 그려진다. */
  @type('number') stamina = 0;
  @type('number') maxStamina = 0;
  /** 무기 데미지에 더해지는 고정 공격력(직업 + 음식). HUD에 숫자로 그대로 보여준다. */
  @type('number') attack = 0;
  /**
   * 이동속도 배율(영구 스태미나 × 아드레날린). 클라이언트 예측이 이 값을 같이 곱해야
   * 버프 중에 되감기지 않는다. 1이 기본.
   */
  @type('number') speedMultiplier = 1;
  @type('number') wood = 0;
  @type('number') stone = 0;
  /** 몬스터가 떨구는 부품(drop_normal) 휴대량. 나무/돌과 동일하게 창고로 옮겨야 팀 몫이 된다. */
  @type('number') parts = 0;
  @type([ItemSlotSchema]) slots = new ArraySchema<ItemSlotSchema>(
    ...Array.from({ length: SLOT_COUNT }, () => new ItemSlotSchema()),
  );
  @type('number') selectedSlot = 0;
  /** 장착 무기의 남은 탄약/탄창. 근접·맨손이면 magazine 0. */
  @type('uint16') ammo = 0;
  @type('uint16') ammoMagazine = 0;
  /** 재장전 잔여 시간(초). 0이면 재장전 중이 아니다. */
  @type('number') reloadRemaining = 0;
  /** 점사 모드 토글 상태(돌격소총). */
  @type('boolean') burstMode = false;
  /** 마지막으로 쓴 소모품의 이펙트 종류(USE_FX)와 사용 횟수. 값이 바뀌면 클라가 이펙트를 튼다. */
  @type('uint8') useFxKind = 0;
  @type('uint8') useFxSeq = 0;
  /** 레벨/경험치. xpToNext는 클라가 levels.json으로 직접 구할 수 있어 안 보낸다. */
  @type('uint16') level = 1;
  @type('uint32') xp = 0;
  /** 아직 안 쓴 스탯 포인트와 스탯별로 찍은 횟수. */
  @type('uint16') statPoints = 0;
  @type('uint16') spentHp = 0;
  @type('uint16') spentAttack = 0;
  @type('uint16') spentStamina = 0;
  /** 레벨이 오를 때마다 오르는 번호. 값이 바뀌면 클라가 레벨업 이펙트를 튼다. */
  @type('uint8') levelUpSeq = 0;
  /** 제작 중인 레시피와 남은 시간(초). 빈 문자열이면 제작 중이 아니다. */
  @type('string') craftRecipeId = '';
  @type('number') craftRemaining = 0;
  /** 다 만들어 꺼내 가기를 기다리는 물건. itemId가 비면 없는 것이다. */
  @type(ItemSlotSchema) craftOutput = new ItemSlotSchema();
  /**
   * 살아있음('alive')/쓰러짐('downed')/유령('ghost'). hp가 0이어도 둘로 갈리므로
   * hp만 보고는 화면에 뭘 그릴지 정할 수 없다(§PlayerLifeState).
   */
  @type('string') lifeState = 'alive';
  /** 쓰러진 뒤 남은 시간(초) — 다 되면 부활(혼자) 또는 유령(멀티)이 된다. */
  @type('number') downRemaining = 0;
  /** 동료 구조 진행도(0~1). 초가 아니라 비율로 보내는 이유는 화면이 게이지로만 쓰기 때문이다. */
  @type('number') reviveProgress = 0;
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
   * 재생할 공격 동작 번호(1~3). 검술이 여러 개인 보스는 기술마다 사거리·각도가 달라서,
   * 그림과 판정이 같은 기술을 가리키려면 어느 동작인지도 함께 알려줘야 한다.
   */
  @type('uint8') attackAnim = 0;
  /**
   * 공격을 시작할 때마다 오르는 번호(256에서 한 바퀴). 클라이언트는 이 값이 바뀌는
   * 순간에 공격 애니메이션을 재생한다 — attacking 불리언의 전이만 보면, 모션 길이가
   * 공격 주기와 비슷할 때 꺼지는 구간이 패치 주기보다 짧아 통째로 놓친다.
   */
  @type('uint8') attackSeq = 0;
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
  /** 방을 만들 때 정한 티모시 사용 여부. 대기실이 이걸 보고 "티모시 있음/없음"을 알린다. */
  @type('boolean') companionEnabled = true;
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
  /** 자원 게이지 — 나무·돌을 충전해 채우고 건축·제작·수리가 여기서 나간다. */
  @type('number') coreResource = 0;
  @type('number') coreMaxResource = 0;
  /** 에너지 게이지 — 드랍 충전·콜로니 정화·보스로 채우고 강화·상점이 여기서 나간다. */
  @type('number') coreEnergy = 0;
  @type('number') coreMaxEnergy = 0;
  /** 지금 열려 있는 충전 슬롯 수(= 코어 티어). 뒤쪽 칸은 잠겨 있다. */
  @type('uint8') openChargeSlots = 0;
  /** 코어 충전 슬롯. 창고와 같은 슬롯 구조라 ItemSlotSchema를 재사용한다. */
  @type([ItemSlotSchema]) coreCharge = new ArraySchema<ItemSlotSchema>(
    ...Array.from({ length: chargingData.slotCount }, () => new ItemSlotSchema()),
  );
  /** 다음 강화 단계 비용. 없으면(최고 티어) 둘 다 0이고 upgradeAvailable이 false다. */
  @type('boolean') upgradeAvailable = false;
  @type('number') upgradeResourceCost = 0;
  @type('number') upgradeEnergyCost = 0;
  /** 오늘의 상점 진열(아이템 id). 낮이 될 때마다 통째로 바뀐다. */
  @type(['string']) shopStock = new ArraySchema<string>();
  /** 지금 리롤에 드는 에너지. 돌릴수록 오른다(World.getShopRerollCost). */
  @type('number') shopRerollCost = 0;
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
  /** 보스 등장까지 남은 예고 시간(초). 0보다 크면 화면에 경고가 뜬다. */
  @type('number') bossWarningRemaining = 0;
  /** 현재 페이즈가 끝나기까지 남은 시간(초) */
  @type('number') phaseTimeRemaining = 0;
  /** 이번 밤의 잡몹 총 마릿수와 남은 수(보스 제외). 낮에는 둘 다 0이다. */
  @type('number') waveMonsterTotal = 0;
  @type('number') waveMonsterRemaining = 0;
  /** 콜로니가 보태는 마릿수(정원과 별개). */
  @type('number') waveMonsterBonus = 0;
  /** 낮 스킵 투표 동의 인원. 만장일치 기준이라 필요 인원은 players.size다. */
  @type('number') skipVoteCount = 0;
}
