# 작업 보고서 — 몬스터 처치 보상(흔한 자원 "파편" + 희귀 자원 "에너지" 통합)

> 몬스터를 잡으면 종류별로 랜덤한 양의 자원이 드롭되는 시스템을 추가했다. 흔한
> 몬스터(잡몹/돌진/탱커)는 개인 휴대 자원 "파편"을, 보스는 콜로니 파괴와 같은
> 팀 공유 자원 "에너지"를 준다. 제작/업그레이드로 뭘 할 수 있는지는 아직 미정
> — 이번 작업은 "번다"까지만 다루고 "쓴다"는 범위 밖이다.

---

## 1. 기획 — 무엇을, 왜

"몬스터를 잡았을 때 종류별로 랜덤한 값으로 드롭되는 자원도 추가해줄래? 콜로니랑
마찬가지로 흔한 몬스터 드랍 자원, 콜로니 or 보스에서만 드랍되는 희귀한 자원"이라는
요청. 코드를 만들기 전에 두 가지를 확정했다(AskUserQuestion):

1. **보스가 드롭하는 희귀 자원 = 콜로니 파괴로 얻는 기존 "에너지"와 통합.**
   자원 종류를 늘리지 않고, 이미 `CoreModal`에 연결돼 있는 에너지 economy를
   그대로 재사용한다 — 콜로니를 부수든 보스를 잡든 같은 팀 공유 창고
   (`coreSharedEnergy`)에 쌓인다.
2. **흔한 자원("파편")은 나무/돌과 같은 흐름.** 잡는 순간 개인 휴대 지갑에
   쌓이고, 코어 근처에서 E(입고)를 눌러야 팀 공유(`coreSharedScrap`)가 된다 —
   "들고 다니다 죽으면 잃는다"는 기존 자원채집 긴장감을 그대로 재사용한다.

## 2. 과정 — 어떻게 했나

### 2.1 데이터 — `monsters.json` + 스키마

각 몬스터 타입에 `scrapDrop`(흔한 몬스터) 또는 `energyDrop`(보스) 중 하나만
넣는다 — 같은 타입에 둘 다 두지 않는다(서로 다른 등급의 보상이라는 설계
의도를 데이터 구조로도 강제). `data/index.ts`에 재사용 가능한
`DropRangeSchema`(`{min, max}`, `min <= max` refine)를 만들어 두 필드가 같은
검증을 쓰게 했다.

```json
"trash":  { "scrapDrop": { "min": 1, "max": 2 } },
"rusher": { "scrapDrop": { "min": 1, "max": 3 } },
"tanker": { "scrapDrop": { "min": 3, "max": 6 } },
"boss":   { "energyDrop": { "min": 3, "max": 6 } }
```

전부 밸런스 임의값이다 — 탱커가 잡몹/돌진보다 좀 더 주는 정도만 반영했다.

### 2.2 "누구를 죽였는가"부터 확보해야 했다

`World.damageMonster(id, remainingHp)`는 몬스터를 죽일 때 **누가 죽였는지 전혀
모르는 채로** 호출되고 있었다 — 죽는 순간 지급할 보상의 수신자를 알 방법이
없었다. 세 군데(근접, 총구 간격 즉시명중, 투사체)에서 각각 다르게 해결했다:

- **투사체**: `ProjectileEntity.ownerId`가 이미 있었다 — 그대로 전달.
- **총구 간격(`resolveMuzzleGapHit`)**: 이미 `player: PlayerEntity`를 인자로
  받고 있어서 `player.id`를 그대로 넘기면 됐다.
- **근접(`MeleeHit`)**: `ownerId` 필드가 아예 없었다. `combat.ts`의
  `resolveFire()`가 `meleeHit`을 만들 때 이미 `request.playerId`를 갖고 있으니
  거기서 채워 넣었다 — 투사체와 같은 위상의 필드로 맞췄다.

`damageMonster`에 `killerId?: string`을 추가하고, 죽는 순간(`remainingHp <= 0`)
`grantMonsterDrop(monster, killerId)`을 부르게 했다:

```ts
private grantMonsterDrop(monster: MonsterEntity, killerId: string | undefined): void {
  const data = monstersData[monster.type];
  if (data.energyDrop) {
    this.core.sharedEnergy += this.rollDropRange(data.energyDrop);
    return;
  }
  if (data.scrapDrop && killerId) {
    const player = this.players.get(killerId);
    if (player) player.scrap += this.rollDropRange(data.scrapDrop);
  }
}
```

`energyDrop`은 `killerId` 없이도 지급된다(팀 공유라 "누가"가 필요 없다) —
`scrapDrop`은 `killerId`가 없거나 이미 퇴장한 플레이어면 조용히 사라진다(크래시
없이). 랜덤값은 `World`가 이미 갖고 있는 `rng`(테스트 결정론용으로 주입 가능)를
재사용했다 — `Math.random()`을 새로 쓰지 않았다.

### 2.3 배관 — wood/stone과 완전히 같은 패턴

`scrap`을 나무/돌과 동일한 위상으로 추가했다: `PlayerEntity.scrap`,
`CoreState.sharedScrap`, `depositAtCore()`가 셋(나무/돌/파편)을 한꺼번에 코어로
옮기도록 확장. 서버(`PlayerSchema.scrap`, `GameRoomState.coreSharedScrap`,
`GameRoom.ts` 동기화)와 클라이언트 net 계층(`GameConnection`/
`ColyseusConnection`/`LocalConnection`/`SnapshotInterpolator`) 전부 기존
wood/stone 배관을 그대로 복제했다 — 새 메시지나 새 패턴이 필요 없었다.
HUD에는 "휴대 나무 · 돌 · 파편", "공유 나무 · 돌 · 파편"으로 한 줄에 이어 붙였다.

## 3. 결과 — 검증

```bash
pnpm --filter @dropfall/shared test   # 16 files, 227 tests 전부 통과(신규 6개)
pnpm typecheck                        # server/client 각각 실행 시 통과
                                       # (동시에 -r로 병렬 실행하면 이 환경에서
                                       #  OOM이 나서 순차 실행으로 확인함 — 코드
                                       #  문제 아님, 메모리 제약)
pnpm lint                             # 에러 0
pnpm build                            # client(vite)/server(tsup) 전체 통과
```

`world-combat.test.ts`에 추가한 테스트: 근접/원거리/총구간격 세 가지 경로 전부
잡은 플레이어에게 scrap 지급, 보스는 scrap이 아니라 팀 에너지로 지급, scrap도
코어 입고로 팀 공유가 됨, 쏜 플레이어가 퇴장해도(투사체가 날아가는 도중) 처치
판정 자체는 크래시 없이 그대로 적용됨.

**테스트를 작성하며 실제로 하나 겪은 문제(구현 버그 아님, 테스트 설계 실수)**:
보스 처치 테스트를 처음엔 "5웨이브로 점프해서 실제로 보스가 자연 스폰될 때까지
기다린다"로 짰는데, 플레이어 1명만 코어 바로 옆에 세워둔 채로 수백 초를 그냥
틱하니 몬스터 무리(웨이브+콜로니가 동시에 계속 스폰)가 코어/플레이어를 먼저
전멸시켜버려서 `defeat` 상태가 되고 그 뒤로는(웨이브 매니저가 종료 상태에서
스폰을 멈춤) 보스가 영영 안 나왔다. `_debug.test.ts` 스크래치 테스트로 원인을
확인한 뒤, 이 파일의 다른 테스트들이 이미 쓰던 패턴(스폰된 몬스터의 `.type`을
직접 바꿔치기)으로 바꿔서 해결했다 — 시뮬레이션과 무관하게 처치 보상 로직만
독립적으로 검증할 수 있어서 훨씬 빠르고 안정적이다.

## 4. 다음 작업

- **소비처 없음.** 파편/에너지로 뭘 만들거나 업그레이드할 수 있는지는 아직
  미정(사용자 확인) — `UpgradeModal`/`StoreModal`/`CraftModal`이 실제 데이터에
  연결되는 후속 작업에서 다뤄야 한다.
- **드롭 값 전부 임의값** — 실제 플레이해보고 밸런스 조정 필요.
- **`CoreModal`의 "자원" 정보 행은 여전히 정적 플레이스홀더.** 나무/돌/파편/
  에너지 네 가지 자원이 다 생긴 지금, 이 행을 뭘 보여줄지(합계? 없앨지?)는
  상점/업그레이드 콘텐츠가 정해질 때 같이 결정하는 게 나을 것 같아 이번엔
  손대지 않았다.
