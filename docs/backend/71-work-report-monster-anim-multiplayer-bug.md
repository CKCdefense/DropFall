# 71. 멀티에서만 몬스터 공격 모션이 안 나오던 버그 (작업 보고)

배포 멀티(방 만들기)에서 몬스터 애니메이션이 재생되지 않는다는 제보. **혼자하기에서는
멀쩡했다.**

## 1. 원인 — 네 줄이 `if` 블록 안에 있었다

`GameRoom#syncMonsters`:

```ts
if (!schema) {
  schema = new MonsterSchema();
  schema.type = monster.type;
  schema.maxHp = monster.maxHp;
schema.attacking = monster.attackAnimTimer > 0;   // ← 들여쓰기만 바깥이다
schema.attackAnim = monster.attackAnim;           // ← 실제로는 if 안이다
schema.attackSeq = monster.attackSeq;
schema.facingLeft = monster.facingX < 0;
  this.state.monsters.set(id, schema);
}
```

들여쓰기가 바깥처럼 보이지만 `this.state.monsters.set(...)`이 그 뒤에 오므로 네 줄 전부
**`if (!schema)` 안**이다. 즉 **스폰된 순간의 값이 그대로 굳는다.**

- `attackSeq`가 절대 안 바뀐다 → 클라이언트는 그 번호가 **바뀌는 순간**에 공격 모션을
  트니까(§EntityRenderer.updateMonsterAnim) **공격 애니메이션이 한 번도 안 나온다**
- `facingLeft`가 스폰 방향으로 고정 → 몬스터가 어느 쪽으로 가든 안 뒤집힌다
- `attacking`도 고정

걷기·피격은 멀쩡했다 — 걷기는 좌표 변화로, 피격은 체력 감소로 판단하기 때문이다.
그래서 "전부 안 나온다"가 아니라 "공격 모션이 안 나온다"가 정확한 증상이다.

2026-08-07 `b490280`("몬스터 공격 모션 재생")에서 들어왔고, 그 뒤 `attackAnim`·`attackSeq`가
같은 자리에 추가되면서 같은 버그를 물려받았다.

## 2. 왜 혼자하기에서는 안 보였나

`LocalConnection`은 스냅샷을 만들 때 **월드 엔티티를 직접 읽는다**. 스키마를 거치지
않으니 이 코드가 실행될 일이 없다.

로컬 검증만으로는 절대 안 잡히는 종류의 버그다 — 그래서 회귀 테스트를 서버 쪽에 남겼다.

## 3. 고친 것

생성 시점에 한 번만 정해지는 값(`type`, `maxHp`)만 `if` 안에 남기고, 매 틱 바뀌는 값 넷은
밖으로 뺐다.

## 4. 검증

- 서버 신규 3개(`tests/syncMonsters.test.ts`) — 공격 번호·방향·모션 상태가 두 번째
  동기화에 반영되는지. **수정을 되돌리면 3개 전부 실패한다**(확인함)
- shared 560 + server 34 통과

## 5. 진단하면서 확인한 것들 (전부 이상 없음)

원인을 좁히는 과정에서 의심했던 것들을 기록해 둔다 — 다음에 같은 제보가 오면 여기서
시작하면 된다.

| 의심 | 결과 |
|---|---|
| 배포 몬스터 아틀라스가 낡음 | 배포본 다운로드해 비교 — 프레임 508개·태그 72개 로컬과 완전 일치 |
| 아틀라스 주입 스텝이 건너뛰어짐 | 워크플로 로그상 정상 실행 |
| 클라이언트/서버 배포 커밋 불일치 | 둘 다 같은 커밋(PR #17)에서 배포됨 |
| Colyseus 스키마 불일치 | 배포본은 정상. 로컬에서 본 `definition mismatch`는 낡은 개발 서버 프로세스 탓 |

## 6. 남은 것

- **`facingLeft`가 고정돼 있었다는 건 그동안 멀티에서 몬스터가 한 번도 안 뒤집혔다는
  뜻**이다. 이번 수정으로 같이 풀린다
- 로컬 개발 환경에서 `packages/client/public/assets/atlas/monsters.json`이 0바이트로
  잘리는 일이 반복된다(이번에도 그랬다). 아틀라스 빌드를 백그라운드로 돌리다 중간에
  끊기면 생긴다 — 빌드가 임시 파일에 쓰고 마지막에 옮기도록 바꾸면 막을 수 있다
