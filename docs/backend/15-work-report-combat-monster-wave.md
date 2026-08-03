# 작업 보고서 — 전투·몬스터·웨이브 MVP 구현

> [backend/11](11-mvp-scope-proposal-combat-wave.md)에서 팀과 합의한 범위를 실제로 구현했다.
> 팀 협의가 아직 안 끝난 두 항목(낮 스킵 투표, 전멸=즉시패배)은 이번 범위에서 제외하고,
> 나머지(데이터·Flow Field·전투·웨이브·서버 동기화)를 전부 구현했다.

---

## 1. 기획 — 무엇을, 왜

로드맵 P0("몬스터 웨이브 서버 스폰 로직, Flow Field 이동 AI, 서버 히트 판정, 코어 HP/승패
판정")가 서버 쪽에서 통째로 비어 있던 마지막 큰 구간이었다. [backend/11](11-mvp-scope-proposal-combat-wave.md)에서
이미 다음을 확정해뒀다.

- 몬스터 4종: 일반몬스터(기본형) · 돌진형 · 탱커형 · 보스(5웨이브 최종)
- 무기 2종: 몽둥이(근접) · 권총(원거리, 투사체 시뮬레이션)
- 코어 HP 1000 / 플레이어 HP 100 / 웨이브 1~5 테이블
- 승패: 코어 HP 0 = 패배, 5웨이브 클리어 = 승리

남아있던 두 질문(낮 스킵 투표 방식, 전멸=즉시패배 유지 여부)은 코드를 실제로 막는 부분이라
이번 구현에서 뺐다 — 낮 페이즈는 90초 고정 카운트다운만 하고, 패배 조건은 "코어 HP 0"만
구현했다. 나머지(몬스터 스탯 수치, 탱커형 벽파괴 보류 등)는 JSON 값이라 구현을 막지
않으므로 제안값 그대로 진행했다.

---

## 2. 과정 — 어떻게 했나

### 2.1 데이터: `shared/data/{monsters,weapons,waves}.json` + zod 스키마

`data/index.ts`에 각각 zod 스키마(`MonsterDataSchema`, `WeaponDataSchema`, `WaveEntrySchema`/`WavesDataSchema`)를
추가하고 JSON을 로드 시점에 검증한다. `monsters.json`의 `aggroRadius`는 optional — 있으면
"반경 내 플레이어를 직접 추격"(돌진형/보스), 없으면 "항상 코어로 직진"(일반몬스터/탱커형)
이라는 의미로 썼다.

### 2.2 `shared/sim/ai/flowField.ts`

기술명세 §5.1 그대로: 코어 셀에서 BFS로 거리맵(`cost`)을 만들고, 8방향 이웃 중 cost가
가장 낮은 쪽을 방향 벡터(`dirX`/`dirY`)로 저장한다. `sampleDirection(x, y)`는 셀 조회 후
저장된 벡터를 반환하는 O(1) 연산. `recompute()`는 건축물 이벤트가 있을 때만 호출하는
설계인데, 아직 건축 시스템이 없어서 지금은 `World` 생성 시 코어 셀 기준으로 딱 한 번만
계산한다.

### 2.3 `shared/sim/combat.ts`

- `resolveFire()` — 근접 무기는 발사 지점 중심의 원형 판정(`MeleeHit`)을, 원거리 무기는
  조준각 방향으로 날아가는 `ProjectileEntity`를 만든다. 존재하지 않는 무기 id는 빈 결과를
  반환 — 클라이언트 입력을 신뢰하지 않는다(팀 규칙, [05-team-notes §3](../05-team-notes.md)).
- `WeaponCooldowns` — 플레이어·무기별 마지막 발사 시각을 기록해 `fireRate`보다 빠른
  재발사를 서버가 거부한다.
- `tickProjectiles()` — 매 틱 위치 갱신, 사거리(`PROJECTILE_MAX_RANGE`=600px) 소진 시 제거.
- `circlesOverlap()` — 두 원형 히트박스 충돌 판정. 투사체/근접 판정 양쪽에서 재사용한다.

### 2.4 `shared/sim/wave.ts`

`WaveManager`가 `day → night → (전멸 시) day → ...` 페이즈를 관리한다. 밤에는 해당 웨이브의
`spawns` 구성을 셔플해서 큐에 넣고, `nightDuration / 마리수` 간격으로 하나씩 스폰 콜백을
호출한다. 스폰 지점은 코어를 중심으로 `spawnPoints` 개수만큼 원형 배치(회전각은 매 웨이브
랜덤). **낮 스킵 투표는 팀 협의 후 추가 예정**이라 지금은 `dayDuration`(90초) 카운트다운만
한다.

### 2.5 `shared/sim/world.ts` 통합

`World`가 `monsters`/`projectiles`/`core` 상태와 `FlowField`/`WaveManager`/`WeaponCooldowns`
인스턴스를 들고 조율한다.

- `fireWeapon(playerId, weaponId)` — `weaponId`가 문자열이 아니면 무시(네트워크 경계 타입
  검증, [10번 문서](10-work-report-nan-input-bug.md)와 동일한 원칙). 쿨다운 통과 시
  `resolveFire()` 결과를 투사체 등록 또는 즉시 근접 판정으로 반영한다.
- `tickMonsters()` — 몬스터 타입에 `aggroRadius`가 있고 반경 내 플레이어가 있으면 그
  플레이어를 직접 추격, 없으면 Flow Field 방향으로 코어를 향해 이동한다. 사거리 안에
  들어오면 이동을 멈추고 `attackInterval`마다 대미지를 준다(플레이어 또는 코어).
- 투사체는 매 틱 이동 후 몬스터와 원형 충돌 검사, 맞으면 데미지 적용 후 소멸.
- 코어 HP가 0이 되면 `waveManager.markDefeat()`.

`PlayerEntity`에 `hp` 필드를 추가했다(초기값 `wavesData.playerHp`) — 기존
`world.test.ts`의 `toEqual` 단언이 깨져서 `hp` 필드를 포함하도록 갱신했다.

### 2.6 프로토콜 + 서버 연동

- `shared/protocol/messages.ts`에 `FireInputMessage { weaponId: string }` 추가. 이동
  입력과 달리 20Hz 주기가 아니라 클릭할 때마다 1번 보내는 이산 이벤트라, 위치/조준각은
  서버가 이미 아는 값을 그대로 쓰고 `weaponId`만 싣는다.
- `GameRoomState.ts`에 `MonsterSchema`/`ProjectileSchema`, `coreHp`/`coreMaxHp`/`wavePhase`/`currentWave`
  추가. `PlayerSchema`에도 `hp` 추가.
- `GameRoom.ts`: `fire` 메시지 핸들러 추가. `update()`에서 몬스터/투사체는 매 틱 등장·소멸
  하므로, world의 현재 목록과 schema map을 대조해서 새로 생기면 추가하고 사라지면 삭제하는
  방식으로 동기화한다(`syncMonsters`/`syncProjectiles`).

### 2.7 테스트

신규: `data.test.ts`, `flowField.test.ts`(5개), `combat.test.ts`(11개), `wave.test.ts`(6개),
`world-combat.test.ts`(9개, 근접/원거리 히트, 쿨다운, 코어 대미지, 패배 판정). 기존
`world.test.ts`의 `PlayerEntity` shape 단언을 `hp` 필드 포함하도록 수정.

**겪은 문제**
- 웨이브 전환 테스트에서 큰 `dt`로 한 번에 tick()하면 "day→night 전환"과 "그날의 첫 스폰"이
  같은 호출 안에서 동시에 일어날 거라 가정했다가 실패했다 — `tick()`이 `day` 분기 끝에서
  바로 `return`하기 때문에 실제로는 전환과 스폰이 별도 호출로 나뉜다. 테스트를 두 번
  tick하도록 고쳤다(구현이 아니라 테스트 쪽 오해였다).
- 투사체-몬스터 충돌 테스트를 `tick(0.3)` 한 번으로 크게 돌렸더니 투사체가 몬스터를
  한 프레임 만에 통과(터널링)해버려 충돌을 놓쳤다. 실제 서버는 60Hz(≈16.7ms)로 촘촘히
  tick()을 호출한다는 걸 반영해 테스트도 `1/60`초 단위로 반복 tick하도록 고쳤다.

---

## 3. 결과 — 검증

```bash
pnpm typecheck   # client/server 전체 통과
pnpm lint        # 에러 0
pnpm --filter @dropfall/shared test   # 65 passed
pnpm build       # client(vite)/server(tsup) 전체 통과
```

전부 통과. 서버 번들 크기가 약 10KB → 561KB로 늘었는데, `@dropfall/shared`가 이제 `zod`를
의존하고 tsup이 이를 인라인하기 때문이다(의도된 변화, [기술명세 §9.5](../02-tech-spec.md)
참고 — 서버는 tsup으로 번들해서 산출물이 파일 하나다).

실제 멀티플레이 환경(브라우저로 join → 사격 → 몬스터 처치)까지는 아직 눈으로 확인 못 했다
— 클라이언트가 `fire` 메시지를 보내는 UI가 아직 없어서, 자동화 스모크 테스트나 Playwright로
검증하려면 그 부분부터 붙여야 한다.

---

## 4. 다음 작업

- **클라이언트 연동**: `InputController`에 좌클릭 → `fire` 메시지 전송 추가, `EntityRenderer`에
  몬스터/투사체/코어 HP 렌더링 추가 (지금은 서버 시뮬레이션만 완성된 상태)
- **팀 협의 남은 두 항목** 결정되면 반영: 낮 스킵 투표, "전원 다운=즉시패배"
- 건축 시스템(B 담당)이 붙으면 `FlowField.recompute()`를 이벤트 기반으로 다시 호출하도록
  연결(`blocksMovement` 레이어 반영)
- 다운/부활(웨이브 종료 시 자동 부활, [backend/11 §2](11-mvp-scope-proposal-combat-wave.md))은
  아직 미구현 — 지금은 플레이어 HP가 0이 돼도 특별한 처리가 없다
- 서버 틱 처리 시간 프로파일링 — 몬스터/투사체가 늘어난 만큼
  [기술명세 §8](../02-tech-spec.md) 목표(< 10ms/tick) 재확인 필요
