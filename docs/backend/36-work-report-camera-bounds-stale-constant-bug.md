# 작업 보고서 — 카메라 bounds가 실제 맵보다 작아서 콜로니에 갈 수 없던 버그 수정

> "콜로니 위치가 완전 렌더링 밖이라 처리하러 갈 수 없다"는 제보를 받고 원인을
> 찾아보니, 맵 크기가 아니라 **카메라 스크롤 범위(camera bounds)를 제한하는
> 클라이언트 상수가 실제 맵보다 훨씬 작게 방치돼 있던 버그**였다. 맵 자체는
> 이미 충분히 컸다 — 맵을 늘리거나 콜로니를 안쪽으로 옮길 필요가 없었다.

---

## 1. 기획 — 무엇을, 왜

backend/35에서 콜로니를 코어 기준 반경 900px, 4방향 고정 위치에 배치했다.
사용자가 실제로 플레이해보니 콜로니가 있는 방향으로 아무리 이동해도 화면에
아예 잡히지 않는다는 제보를 받았다. 제안받은 두 해결 방향은 "맵을 늘린다"와
"콜로니를 좀 더 안쪽으로, 고정이 아니라 최소 거리를 두고 랜덤 배치한다"였는데,
둘 다 적용하기 전에 먼저 진짜 원인이 "맵이 작아서"가 맞는지부터 확인했다.

## 2. 과정 — 어떻게 했나

`packages/shared/src/constants.ts`의 `MAP_SIZE_TILES = 128`(타일), `TILE_SIZE =
16px` — 실제 맵은 2048×2048px(중심 기준 ±1024px)다. `FlowField`, `TerrainLayer`
(지형 타일), 그리고 콜로니 배치(`ColonyRegistry`)까지 전부 이 상수를 그대로
쓴다. 콜로니 반경 900px은 이 맵 안에 여유 있게 들어간다 — 즉 **맵 자체는 문제가
아니었다.**

문제는 클라이언트 렌더링 쪽, `packages/client/src/game/scenes/GameScene.ts`에
따로 있었다:

```ts
/** 임시 맵 크기. Tiled 맵이 들어오면 교체된다. */
const WORLD_WIDTH = TILE_SIZE * 80;   // = 1280px, 절반 640px
const WORLD_HEIGHT = TILE_SIZE * 80;

this.cameras.main.setBounds(-WORLD_WIDTH / 2, -WORLD_HEIGHT / 2, WORLD_WIDTH, WORLD_HEIGHT);
```

이 상수는 shared의 `MAP_SIZE_TILES`와 전혀 무관하게 독립적으로 박혀 있던
**"교체 예정" 플레이스홀더**였다(주석에 그렇게 쓰여 있었다) — Tiled 맵이 아직
없던 초기 단계에 대충 잡아둔 값이 실제 맵 크기가 정해진 뒤에도 갱신되지 않고
남아 있었다. `Phaser.Cameras.Scene2D.Camera.setBounds()`는 카메라가 그 사각형
밖으로 스크롤하는 것 자체를 막는다 — 플레이어가 실제로는(서버 시뮬레이션
좌표로는) 900px 지점까지 걸어갈 수 있어도, **카메라가 640px에서 더 이상 못
따라가서 화면엔 계속 같은 자리가 멈춰 보였을 것**이다. 콜로니가 렌더링 안 되는
게 아니라, 애초에 그 좌표를 보여줄 카메라 위치 자체에 도달할 수 없었다.

`TerrainLayer.ts`는 이미 `MAP_SIZE_TILES`를 올바르게 쓰고 있어서 지형 자체는
맵 전체(2048px)를 덮는다 — 카메라 bounds 하나만 따로 놀고 있었다.

**수정**: `WORLD_WIDTH`/`WORLD_HEIGHT`를 `TILE_SIZE * MAP_SIZE_TILES`로 바꿔서
shared 상수를 그대로 따라가게 했다. 이제 맵 크기를 나타내는 값이 한 곳
(`MAP_SIZE_TILES`)에만 존재하고, 카메라 bounds는 그 값을 그대로 참조한다 —
앞으로 맵 크기가 다시 바뀌어도 클라이언트 쪽에서 별도로 상수를 맞춰줄 일이
없어진다.

## 3. 결과 — 검증

```bash
pnpm typecheck   # client/server 전체 통과
pnpm lint        # 에러 0
pnpm build       # client(vite)/server(tsup) 전체 통과
```

순수 상수 치환이라 로직 변경이 없고, 셰어드 테스트(`shared/tests`)는 이 파일과
무관해 별도 실행하지 않았다.

## 4. 다음 작업

- 없음. 다만 "맵 크기"를 나타내는 상수가 앞으로 또 클라이언트 어딘가에
  독립적으로 생기지 않도록, 새로 카메라/렌더 범위 관련 코드를 추가할 땐 항상
  `MAP_SIZE_TILES`(shared/constants.ts)를 참조할 것 — 이번 버그의 근본 원인이
  바로 "같은 값을 두 곳에 따로 정의해서 하나만 갱신됨"이었다.
