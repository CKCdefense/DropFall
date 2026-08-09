# 69. 작업 보고서 — 무기별 총알 관통 횟수 구현 + 전 원거리 무기 재장전 절반 단축

## 기획

`docs/backend/68-design-proposal-bullet-pierce.md`(구현 기획서)에서 검토한
대안 C(무기별 차등 관통 배분, 감쇠 없음)를 채택해 그대로 구현한다. 추가로
사용자가 "지금 다 너무 길어"라며 전 원거리 무기 재장전 시간을 절반으로
단축해 달라고 요청했다.

## 과정

### 1. 관통 — boolean → 횟수로 일반화

`sniper_rifle`에만 있던 `pierce: boolean`(무제한 관통)을 `pierceCount: number`로
교체했다:

- `data/index.ts`: `pierce: z.boolean().optional()` →
  `pierceCount: z.number().int().nonnegative().optional()`.
- `sim/combat.ts`: `ProjectileEntity.pierce: boolean` →
  `pierceRemaining: number`(남은 관통 횟수). `resolveFire()`가
  `weapon.pierceCount ?? 0`으로 초기화.
- `sim/world.ts`의 `projectileHitsMonster()`: `if (!projectile.pierce)` →
  `if (projectile.pierceRemaining <= 0)`로 바꾸고, 통과할 때마다
  `pierceRemaining -= 1`. **의미**: `pierceCount`는 "첫 타격 이후 몇 마리를
  더 뚫는지"다(첫 타격 포함 총 `pierceCount+1`마리) — 0/미지정이면 기존과
  동일하게 첫 타격에 소멸한다.

기획서 §4 표대로 `weapons.json`에 배분했다: `slingshot`/`shuriken`/`handgun`/
`assault_rifle` 1, `crossbow`/`revolver` 2, `rifle` 3(가장 느린 발사속도+가장
긴 재장전을 관통으로 보상), `sniper_rifle` 20(기존 "무제한" 체감 유지),
`smg`/샷건 2종/`minigun`은 0(이미 연사·장탄·산탄으로 무리 대응이 되는
무기라 관통까지 얹으면 과함).

### 2. 재장전 절반 단축

`weapons.json`의 원거리 무기 12종 전부 `reloadTime`을 그대로 절반으로
줄였다(예: `rifle` 2.6→1.3, `minigun` 4.5→2.25). 관통과 별개 요청이지만
같은 "몰려오는 몹 앞에서 원거리가 너무 무력하다"는 문제의식이라 같은
패스로 묶었다.

### 3. 테스트

- `combat.test.ts`의 기존 "관통 무기는 pierce 플래그를..." 테스트를 새
  필드명(`pierceRemaining`)으로 갱신하고, `pierceCount`가 없는 무기는
  `pierceRemaining=0`/`hitIds` 없음을 확인하는 테스트를 추가했다.
- `world-weapons.test.ts`에 유한 관통(횟수 제한) 회귀 테스트를 추가 —
  `crossbow`(pierceCount:2)로 4마리를 일렬로 세우고 정확히 3마리(첫
  타격+관통 2)만 죽고 4번째는 살아남는지 검증한다.
  - 이 테스트를 만들면서 발견한 함정: 총구 간격(`muzzleOffset`) 안에
    몬스터를 두면 `resolveMuzzleGapHit()`이 투사체를 아예 만들지 않고
    그 자리에서 직접 처리해버려서(관통과 무관한 별개 경로) 관통 자체를
    검증할 수 없다 — 첫 몬스터를 총구 간격 밖에 세우도록 좌표를 조정했다.
  - 살아남은 몬스터를 좌표로 특정하면 그사이 몬스터 AI가 플레이어 쪽으로
    걸어와(demon speed=45) 좌표가 틀어져 깨진다 — id로 특정하도록 고쳤다.

## 결과

- `packages/shared/src/data/weapons.json`: `pierceCount` 8개 무기에 신규
  부여, 원거리 12종 `reloadTime` 전부 절반.
- `packages/shared/src/data/index.ts`: `pierce` → `pierceCount` 스키마 교체.
- `packages/shared/src/sim/combat.ts`, `sim/world.ts`: 관통 로직을 boolean
  판정에서 카운트다운 방식으로 교체.
- `packages/shared/tests/combat.test.ts`, `world-weapons.test.ts`: 필드명
  갱신 + 유한 관통 회귀 테스트 추가.
- 재검증: shared 전체 563/563 + server typecheck·test(31) + client
  typecheck + lint 전부 통과. 클라이언트는 투사체를 서버 판정 결과로만
  받아 그리는 구조라(관통 관련 참조 없음 확인) 클라이언트 코드 변경은
  없었다.
