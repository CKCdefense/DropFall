# DropFall 에셋

> **여기는 원본(source) 보관소다.** 게임이 실제로 읽는 것은
> `packages/client/public/assets/` 의 빌드 산출물이다.
> 파이프라인 상세는 [docs/frontend/07-asset-pipeline.md](../docs/frontend/07-asset-pipeline.md).

```
assets/                    원본 (.aseprite, .tmx, .wav …)  ← 여기서 작업
   │
   │  pnpm build:atlas
   ▼
packages/client/public/assets/   빌드 산출물 (.png, .json)  ← 게임이 읽음 (커밋함)
```

> **예외: 몬스터.** 재업로드 금지 라이센스 에셋이라 원본도 산출물도 커밋하지 않는다.
> 그래서 `monsters` 아틀라스만 따로 뽑는다 — 자세히는
> [sprites/monsters/README.md](sprites/monsters/README.md).

## 디렉터리

| 경로 | 내용 | 최종 형태 |
|---|---|---|
| `sprites/characters/` | 플레이어, 직업별 스프라이트 | `game` 아틀라스 |
| `sprites/monsters/` | 몬스터 — **커밋 금지 라이센스 에셋** (`sprites/monsters/README.md`) | `monsters` 아틀라스 (**커밋 안 함**) |
| `sprites/items/` | 무기, 소모품, 자원 드랍 | `game` 아틀라스 |
| `sprites/buildings/` | 벽, 울타리, 문, 포탑, 코어 | `game` 아틀라스 |
| `sprites/props/` | 나무, 바위 등 필드 오브젝트 | `game` 아틀라스 |
| `sprites/fx/` | 타격, 폭발, 파티클 | `game` 아틀라스 |
| `tiles/` | 타일셋 (Tiled가 참조) | `tiles` 아틀라스 |
| `ui/hud/` | 인게임 HUD 요소 (캔버스에 그림) | `ui` 아틀라스 |
| `ui/icons/` | 아이템/스킬 아이콘 | `ui` 아틀라스 |
| `ui/dom/` | **로비용 9-slice 프레임/버튼** | **개별 PNG** (아래 참고) |
| `ui/logo/` | 로고 등 큰 단일 이미지 | **개별 PNG** |
| `ui/backgrounds/` | 랜딩 배경 등 전체 화면 이미지 | **개별 PNG** |
| `maps/` | Tiled 맵 (`.tmx` 원본 / `.tmj` 익스포트) | `.tmj` 복사 |
| `audio/bgm/`, `audio/sfx/` | 음원 | `.ogg` 변환 |
| `fonts/` | 폰트 원본 + **라이선스 파일 필수** (`fonts/README.md`) | 복사 |
| `palette/` | 공용 팔레트 (`.gpl`) | 빌드 제외 |
| `_generators/` | 이펙트를 만들어내는 Aseprite Lua 스크립트 (`_generators/README.md`) | **빌드 제외** (결과물이 `sprites/fx/`로 들어감) |
| `_reference/` | 참고 자료, 미사용 스케치 | **빌드 제외** |

### 왜 UI가 두 갈래인가

로비/타이틀은 DOM으로 만들고, 9-slice를 CSS `border-image`로 적용한다.
**CSS는 아틀라스의 일부 영역을 잘라 쓸 수 없어서 개별 PNG 파일이 필요하다.**
반면 인게임 HUD는 캔버스(Phaser)에 그리므로 아틀라스가 유리하다.

- `ui/dom/`, `ui/logo/`, `ui/backgrounds/` → 개별 PNG로 그대로 복사
- `ui/hud/`, `ui/icons/` → 아틀라스로 묶음

## 명명 규칙

**영문 소문자 + `snake_case`.** 한글/공백/대문자 금지 — 아틀라스 프레임 이름이 되고,
서버/클라 코드에서 문자열 키로 참조되기 때문이다.

```
파일명       = 프레임 접두사
Aseprite 태그 = 애니메이션 이름
```

예를 들어 `sprites/characters/player_soldier.aseprite` 안에 `idle`, `walk` 태그가 있으면
아틀라스 프레임은 이렇게 생성된다:

```
player_soldier_idle_0   player_soldier_walk_0
player_soldier_idle_1   player_soldier_walk_1  …
```

코드에서는 이렇게 쓴다:

```ts
this.add.sprite(x, y, 'game', 'player_soldier_idle_0');
this.anims.generateFrameNames('game', { prefix: 'player_soldier_walk_', start: 0, end: 3 });
```

### 권장 태그 이름

| 태그 | 용도 |
|---|---|
| `idle` | 대기 |
| `walk` | 이동 |
| `attack` | 공격 |
| `hurt` | 피격 |
| `die` | 사망 |
| `build` | 건설/설치 |

### 태그는 반드시 하나 이상 만든다

애니메이션이 없는 단일 이미지라도 **`idle` 태그를 하나 만들어 둔다.**
태그가 없으면 프레임 이름에 빈 칸이 생겨 밑줄이 두 개가 된다:

```
prop_tree__0     ← 태그를 안 만든 경우 (밑줄 2개)
prop_tree_idle_0 ← 올바른 형태
```

코드에서 참조하는 문자열이 지저분해지고, 나중에 애니메이션을 추가하면 이름이 바뀌어
참조하는 코드를 전부 고쳐야 한다. **아틀라스 JSON에 `__`가 보이면 태그를 빠뜨린 것이다.**

### 접두사 컨벤션

| 분류 | 접두사 | 예 |
|---|---|---|
| 플레이어 | `player_` | `player_medic.aseprite` |
| 몬스터 | `mob_` | `mob_runner.aseprite` |
| 무기 | `weapon_` | `weapon_pistol.aseprite` |
| 소모품 | `item_` | `item_bandage.aseprite` |
| 건축물 | `build_` | `build_wall.aseprite` |
| 자원/오브젝트 | `prop_` | `prop_tree.aseprite` |
| 이펙트 | `fx_` | `fx_hit.aseprite` |
| 타일 | `tile_` | `tile_grass.aseprite` |
| UI | `ui_` | `ui_icon_ammo.aseprite` |

## 규격 (변경 금지)

| 항목 | 값 |
|---|---|
| 타일 | 16 × 16 px |
| 캐릭터 | 32 × 32 px (**원점은 발밑 중앙**) |
| 팔레트 | 32~48색 고정, `palette/dropfall.gpl` 공유 |
| 아틀라스 최대 크기 | 2048 × 2048 (구형 GPU 호환) |

근거는 [기술 명세 §7.1](../docs/02-tech-spec.md).
캐릭터 원점이 발밑인 이유는 탑다운 Y-sort 정렬 때문이다.

## 작업 규칙

- **바이너리는 머지가 안 된다.** 같은 파일을 두 명이 동시에 수정하지 말 것.
  작업 전 팀 채널에 공유한다 ([Git 컨벤션 §5](../docs/03-git-convention.md))
- 아틀라스 산출물(`public/assets/atlas/`)은 **한 명만** 리빌드해서 커밋한다 (기본: 아트 담당)
- 맵 파일도 담당자를 1명 고정한다
- 폰트는 **반드시 라이선스 파일을 같이 넣는다.** 공모전 제출물이라 출처가 불명확한 폰트는 쓸 수 없다
- 미사용/참고 자료는 `_reference/`에 둔다. 빌드에서 제외되고 번들 크기에 영향이 없다

## 빌드

```bash
pnpm build:atlas        # 원본 → public/assets/ 산출물 생성
```

Aseprite CLI가 필요하다. 설치 경로가 다르면 환경변수로 지정한다:

```bash
ASEPRITE="D:/Apps/Aseprite/Aseprite.exe" pnpm build:atlas
```

## 지금 바로 쓰이는 파일명

아래 이름 그대로 넣고 `pnpm build:atlas`를 실행하면 코드 수정 없이 화면에 반영된다.

| 용도 | 경로 |
|---|---|
| 타이틀 로고 | `ui/logo/logo_title.png` |
| 랜딩 배경 | `ui/backgrounds/bg_landing.png` |

배경은 `cover`로 채워지므로 화면 비율이 다르면 가장자리가 잘린다 — 중요한 요소는 중앙에 두고,
16:9 기준으로 그리는 것을 권한다. 자세히: [frontend/06 §4](../docs/frontend/06-ui-asset-slots.md)
