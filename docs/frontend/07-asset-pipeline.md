# 에셋 파이프라인

> 명명 규칙·규격 등 **아트 작업자가 볼 내용은 [assets/README.md](../../assets/README.md)** 에 있다.
> 이 문서는 파이프라인이 왜 이렇게 생겼고 코드에서 어떻게 쓰는지를 다룬다.

## 1. 원본과 산출물을 분리한다

```
assets/                          원본. 여기서만 작업한다
   │  .aseprite  .tmx  .wav  .gpl
   │
   │   pnpm build:atlas   (tools/build-atlas.mjs)
   ▼
packages/client/public/assets/   게임이 읽는 산출물. 커밋한다
   atlas/game.png · game.json
   atlas/tiles.png · tiles.json
   atlas/ui.png · ui.json
   ui/*.png      (9-slice, 로고)
   maps/*.tmj    audio/*.ogg    fonts/*
```

**산출물을 `.gitignore` 하지 않는 이유**: Aseprite CLI가 없는 팀원도 클론 직후 바로
`pnpm dev`로 게임을 돌릴 수 있어야 한다. 대신 **아틀라스 리빌드는 한 명만** 한다
(바이너리는 머지가 안 되므로).

## 2. 아틀라스를 3개로 나눈 이유

| 아틀라스 | 내용 | 분리 근거 |
|---|---|---|
| `game` | 캐릭터·몬스터·아이템·건축물·오브젝트·이펙트 | 인게임에서 항상 같이 쓰인다 → 드로우콜 최소화 |
| `tiles` | 타일셋 | Tiled가 타일셋 이미지를 별도로 참조한다 |
| `ui` | 인게임 HUD, 아이콘 | 로딩 시점과 갱신 주기가 월드와 다르다 |

**2048×2048 상한**을 넘으면 더 쪼갠다. 구형 GPU/모바일에서 4096 텍스처가 안 되는 경우가 있다.

### UI가 아틀라스와 개별 PNG로 갈리는 이유

로비/타이틀은 DOM으로 만들고 9-slice를 CSS `border-image`로 적용한다
([frontend/06](06-ui-asset-slots.md)). **CSS는 아틀라스의 일부 영역을 잘라 쓸 수 없다** —
`border-image-source`는 이미지 파일 하나를 통째로 받는다.

- `assets/ui/dom/`, `assets/ui/logo/` → **개별 PNG로 복사** (아틀라스에 넣지 않음)
- `assets/ui/hud/`, `assets/ui/icons/` → 아틀라스 (Phaser가 그림)

## 3. 프레임 이름 규칙

```
{파일명}_{Aseprite 태그}_{태그 내 프레임번호}
```

`player_soldier.aseprite`에 `walk` 태그(4프레임)가 있으면:

```ts
this.load.atlas('game', 'assets/atlas/game.png', 'assets/atlas/game.json');

this.add.sprite(x, y, 'game', 'player_soldier_idle_0');

this.anims.create({
  key: 'player_soldier_walk',
  frames: this.anims.generateFrameNames('game', {
    prefix: 'player_soldier_walk_', start: 0, end: 3,
  }),
  frameRate: 8,
  repeat: -1,
});
```

**모든 스프라이트는 태그를 최소 1개(`idle`) 가진다.** 태그가 없으면 이름이
`player_soldier__0`처럼 밑줄 두 개가 되고, 나중에 애니메이션을 추가하는 순간 이름이 바뀌어
참조 코드를 전부 고쳐야 한다.

## 4. 빌드 옵션 결정 사항

`tools/build-atlas.mjs`가 Aseprite CLI에 넘기는 옵션 중 판단이 필요했던 것들.

| 옵션 | 값 | 이유 |
|---|---|---|
| `--sheet-type packed` | 사용 | 빈 공간을 최소화해 텍스처 크기를 줄인다 |
| `--filename-format` | `{title}_{tag}_{tagframe}` | 위 프레임 이름 규칙 |
| `--list-tags` | 사용 | JSON에 태그 구간 정보가 들어가 애니메이션 정의에 쓸 수 있다 |
| `--shape-padding 1` | 사용 | 확대 렌더 시 이웃 프레임이 새어드는 것(블리딩) 방지 |
| `--trim` | **사용 안 함** | 아래 참고 |

### `--trim`을 쓰지 않는 이유

투명 여백을 잘라내면 프레임마다 크기가 달라진다. 그러면

- 캐릭터 원점(**발밑 중앙**)을 프레임마다 다시 계산해야 한다 — 탑다운 Y-sort 정렬에 직결된다
- 16/32px 격자에 맞춰 그린 픽셀아트의 정렬이 어긋나기 쉽다

아틀라스가 조금 커지지만 이 규모(수백 프레임)에서는 문제되지 않는다.

> 실제로 테스트 중 `--trim`이 16×16 스프라이트를 1×1로 축소시키는 것을 확인했다.
> 여백 판정이 의도와 다르게 동작할 수 있어 더더욱 쓰지 않는다.

## 5. 캐릭터 스프라이트 시트 붙이기

지금 붙어 있는 `soldier_test.aseprite`가 그대로 예시다.

### 원본 규격

| 항목 | 값 |
|---|---|
| 프레임 크기 | 32 × 32 |
| 방향 | `front` / `left` / `back` **3종** — 오른쪽은 `left`를 좌우 반전해서 쓴다 |
| 프레임 수 | 방향당 4 (걷기 사이클) |
| 태그 | 위 세 이름 그대로. 태그가 곧 애니메이션 키가 된다 |

**오른쪽 시트를 따로 만들지 않는 이유**: 아트 작업량이 25% 줄고, 좌우 대칭인 캐릭터라
반전으로 티가 나지 않는다. 비대칭 요소(어깨에 멘 총 등)가 생기면 그때 시트를 추가한다.

### 붙이는 절차

```bash
# 1. assets/sprites/characters/ 에 .aseprite 저장 (태그 3개 필수)
# 2. 아틀라스 생성
pnpm build:atlas
# 3. 프레임 이름 확인 — {파일명}_{태그}_{번호}
```

코드에서 바꿀 것은 [playerSprite.ts](../../packages/client/src/game/render/playerSprite.ts)의
`PLAYER_SPRITE_PREFIX` **한 줄**이다. 원본 파일명이 곧 접두사다.

### 원점은 발밑

`PLAYER_ORIGIN_Y = 0.94`. 32px 중 그림이 y 2~29에 있어서 발끝이 30/32 지점이다.
원점을 발밑에 두면 **컨테이너 위치(= 서버 좌표)가 바닥에 닿고**, `depth = y` Y-정렬이
그림이 아니라 발 위치 기준으로 맞는다.

새 캐릭터의 그림 범위가 다르면 이 값을 다시 재야 한다.

### 방향은 조준각으로 정한다

이동 방향이 아니라 **조준 방향**을 본다(`directionFromAngle`). 마우스로 조준하는
슈터라 게걸음으로 옆으로 움직여도 몸은 겨누는 쪽을 봐야 자연스럽다.
이동 기준으로 바꾸려면 그 함수에 넘기는 각도만 바꾸면 된다.

걷기 애니메이션은 **실제로 움직일 때만** 재생한다. 스냅샷에 속도가 없어서 직전 프레임
좌표와의 차이로 판단하고, 보간 지터로 애니메이션이 떨리지 않게 `MOVE_EPSILON`을 뒀다.

### 에셋이 없어도 게임은 뜬다

아틀라스 로드에 실패하면 도형 플레이스홀더로 그린다. 에셋이 하나씩 들어오는 단계라
중간 상태에서 화면이 깨지지 않게 해둔 것이다 — UI 이미지 슬롯과 같은 방침이다
([frontend/06](06-ui-asset-slots.md)).

## 6. 사용법

```bash
pnpm build:atlas
```

- 원본이 없는 그룹은 **조용히 건너뛴다** — 에셋이 하나도 없는 지금도 실행된다
- Aseprite 경로는 자동 탐색(Steam 설치 경로 포함)하고, 못 찾으면 안내와 함께 종료한다
- 다른 경로에 설치했으면: `ASEPRITE="D:/Apps/Aseprite/Aseprite.exe" pnpm build:atlas`

### 새 에셋 그룹을 추가할 때

[assets/atlas.config.json](../../assets/atlas.config.json)에 등록한다.

```jsonc
{ "name": "game", "sources": ["sprites/characters", "sprites/monsters", /* 여기 */] }
```

아틀라스가 아니라 개별 파일로 내보내야 하면 `copy` 항목에 넣는다.

## 7. 아직 안 정한 것

- **팔레트** — `assets/palette/dropfall.gpl` 자리만 있고 색이 확정되지 않았다.
  32~48색으로 먼저 고정해야 에셋 통일성이 유지된다
- **폰트** — 한글 픽셀 비트맵 폰트 미정. 라이선스 확인 필수(공모전 제출물)
- **오디오 포맷** — `.ogg` 전제로 써뒀다. 사파리 호환이 필요하면 `.m4a` 병행을 검토
- **Tiled 타일셋 연결** — 맵이 `tiles` 아틀라스를 어떻게 참조할지는 첫 맵 제작 시 확정
