# PixelLab 건축물 에셋 프롬프트 (울타리 · 문 · 벽 × 3티어)

> 생성한 결과물은 `assets/sprites/buildings/`에 넣고 `pnpm build:atlas`를 돌린다.
> 파이프라인은 [07-asset-pipeline.md](07-asset-pipeline.md), 명명 규칙은 [../../assets/README.md](../../assets/README.md).

---

## 0. 먼저 읽을 것 — 이 프로젝트에 맞추기 위한 제약

프롬프트만 붙여넣으면 "예쁜 픽셀아트"는 나오지만 **게임에 넣으면 안 맞는다.** 아래 네 가지가
프로젝트 고유 제약이라 생성 설정에 반드시 반영해야 한다.

### 크기와 접지선

| 값 | 이유 |
|---|---|
| **캔버스 32×32** | 캐릭터와 같다. 프레임 크기를 통일해야 원점 계산이 단순하다 |
| **바닥 발자국 폭 16px** | `TILE_SIZE = 16`. 건축물은 그리드 셀에 스냅된다 |
| **접지선은 아래에서 2px 위** | 캐릭터 원점(`PLAYER_ORIGIN_Y = 0.94` = 30/32)과 같은 규칙 |

즉 **가로 가운데 16px 안에 바닥이 닿고, 높이는 위로 뻗는다.** 벽은 32px를 거의 다 쓰고,
울타리는 아래쪽 절반만 쓴다. 위칸을 침범해도 괜찮다 — y 기준 깊이 정렬이라 앞의 것이 뒤를 자연스럽게 가린다.

### 시점

캐릭터가 **정면을 보고 서 있는 모습**으로 그려진 2.5D 탑다운이다. 완전한 위에서 내려다보는
시점이 아니다. PixelLab의 `high top-down`이 가장 가깝다. `isometric`은 쓰지 않는다 —
격자가 축 정렬이라 아이소메트릭을 섞으면 어긋난다.

### 팔레트

기존 에셋에서 실제로 뽑은 색이다. 프롬프트에 그대로 박아 넣으면 톤이 튀지 않는다.

```
윤곽선   #000000
나무 밝음 #D2AE76   나무 중간 #B7956E   나무 어두움 #8F6A4A   나무 그림자 #663931
돌 밝음   #A8AEB8   돌 중간   #8A8F99   돌 어두움   #6B6F78   돌 그림자   #4A5262
금속 밝음 #BDC8CC   금속 중간 #B1BCBF   금속 어두움 #696A6A   금속 그림자 #2E2E31
녹/경고   #893E36   위험 강조 #D9756B
```

배경은 항상 투명. 밤 배경(`#20242E`) 위에 올라가므로 **너무 어두운 색만으로 채우면 형체가 묻힌다** —
윤곽선 바로 안쪽에 밝은 색 하이라이트를 한 줄 넣는 게 안전하다.

### 스타일 일관성 — 가장 중요

**텍스트 프롬프트만으로 9개를 뽑으면 서로 안 어울린다.** PixelLab에 스타일 참조 이미지를
넣는 생성 방식(Bitforge 계열)이 있으면 그걸 쓰고, 참조로 이미 승인된 에셋을 넣는다:

```
assets/sprites/items/axe.aseprite      ← 나무 + 금속 질감의 기준
assets/sprites/characters/soldier.aseprite  ← 명암 단계와 윤곽선 두께의 기준
```

참조 이미지를 못 쓰는 경우, **1티어 하나를 먼저 뽑아 확정한 뒤 그것을 참조로** 나머지 8개를
뽑는다. 9개를 한 번에 뽑지 않는다.

---

## 1. 공통 생성 설정

PixelLab UI/API의 필드 이름은 버전에 따라 다를 수 있다. 아래는 의미 기준이니 해당하는 항목에 맞춰 넣는다.

| 항목 | 값 |
|---|---|
| Image size | `32 × 32` |
| View | `high top-down` |
| Outline | `single color black outline` |
| Shading | `basic shading` (2~3단계) |
| Detail | `low detail` |
| Isometric | 끔 |
| Transparent / no background | 켬 |
| Text guidance | 중간 (너무 높이면 과장된 형태가 나온다) |

### 공통 네거티브 프롬프트

9개 전부에 붙인다.

```
isometric, 3d render, smooth gradient, anti-aliasing, blurry, drop shadow, ground shadow,
background scenery, grass, terrain, multiple objects, character, text, watermark, signature,
perspective vanishing point, photorealistic, glossy, bloom
```

`ground shadow`를 막는 이유: 바닥 그림자가 스프라이트에 구워져 있으면 다른 타일과 겹칠 때
그림자가 격자무늬로 반복된다. 그림자가 필요하면 나중에 렌더러에서 그린다.

---

## 2. 울타리 (fence) — 이동만 막고 총알은 통과

낮고 **틈이 보이는** 형태여야 한다. 게임 규칙상 총알이 지나가는데 꽉 막힌 그림이면 거짓말이 된다.
높이는 캔버스의 아래 절반(약 14~16px)만 쓴다.

### T1 · 나무 울타리 `fence_wood`

```
A short wooden picket fence segment standing upright, two horizontal rails across three
vertical posts, rough weathered planks with visible gaps between them, warm brown wood
(#D2AE76 highlight, #B7956E mid, #8F6A4A shadow), 1 pixel solid black outline, flat 3-tone
shading, low and see-through, base occupies the bottom center 16 pixels, transparent background,
16-bit game asset, limited palette
```

### T2 · 통나무 방책 `fence_log`

```
A palisade fence segment of sharpened vertical logs lashed together with rope, tops cut to
points, thicker and sturdier than a picket fence, narrow gaps between logs, warm brown wood
(#D2AE76 highlight, #B7956E mid, #663931 shadow) with pale rope bindings, 1 pixel solid black
outline, flat 3-tone shading, base occupies the bottom center 16 pixels, transparent background,
16-bit game asset, limited palette
```

### T3 · 철조망 울타리 `fence_wire`

```
A barbed wire fence segment on two thin metal posts, three taut wire strands with small barbs,
mostly empty space between the wires, cold steel colors (#BDC8CC highlight, #B1BCBF mid,
#696A6A shadow) with a few rust spots (#893E36), 1 pixel solid black outline, flat shading,
thin and sparse silhouette, base occupies the bottom center 16 pixels, transparent background,
16-bit game asset, limited palette
```

> 철조망은 선이 얇아 **1픽셀 격자에서 뭉개지기 쉽다.** 결과가 지저분하면 `detail`을
> 더 낮추고 가닥 수를 2개로 줄여서 다시 뽑는다.

---

## 3. 벽 (wall) — 이동과 총알을 모두 막음

**꽉 막히고 높아야 한다.** 캔버스 높이를 거의 다 쓴다(약 26~30px). 실루엣이 두꺼워야
"총알이 막힌다"가 읽힌다.

### T1 · 나무 벽 `wall_wood`

```
A solid wall segment built from thick vertical wooden planks packed tightly with no gaps,
two horizontal support beams, tall and chunky, warm brown wood (#D2AE76 highlight, #B7956E mid,
#8F6A4A shadow, #663931 deep shadow), visible wood grain as short dark lines, 1 pixel solid
black outline, flat 3-tone shading, fills most of the canvas height, base occupies the bottom
center 16 pixels, transparent background, 16-bit game asset, limited palette
```

### T2 · 석벽 `wall_stone`

```
A solid stone block wall segment, irregular stacked masonry blocks with mortar lines, tall and
heavy, cool gray stone (#A8AEB8 highlight, #8A8F99 mid, #6B6F78 shadow, #4A5262 deep shadow),
a few darker cracks for texture, 1 pixel solid black outline, flat 3-tone shading, fills most
of the canvas height, base occupies the bottom center 16 pixels, transparent background,
16-bit game asset, limited palette
```

### T3 · 강화 금속 벽 `wall_steel`

```
A reinforced steel plated wall segment, riveted metal panels over a frame, vertical seam down
the middle and bolt heads along the edges, industrial and imposing, cold steel (#BDC8CC
highlight, #B1BCBF mid, #696A6A shadow, #2E2E31 deep shadow) with faint rust streaks (#893E36),
1 pixel solid black outline, flat 3-tone shading, fills most of the canvas height, base occupies
the bottom center 16 pixels, transparent background, 16-bit game asset, limited palette
```

---

## 4. 문 (gate) — 열림/닫힘 두 상태가 필요하다

문은 **한 장이 아니다.** 최소한 닫힘/열림 두 장이 있어야 하고, 두 장의 기둥·틀 위치가
픽셀 단위로 같아야 열고 닫을 때 흔들리지 않는다.

**뽑는 순서:**
1. 닫힘 상태를 먼저 생성해 확정한다.
2. 그 이미지를 참조(init image)로 넣고 "열린" 프롬프트로 변형을 뽑는다.
3. 틀이 어긋나면 Aseprite에서 틀만 닫힘 버전에서 복사해 덮는다.

같은 티어의 벽과 **높이와 색이 맞아야** 벽 사이에 끼웠을 때 자연스럽다.

### T1 · 나무 문 `gate_wood`

**닫힘**
```
A closed wooden gate set between two sturdy fence posts, horizontal planks with an X-shaped
cross brace, a small iron latch in the middle, warm brown wood (#D2AE76 highlight, #B7956E mid,
#8F6A4A shadow) with dark iron fittings, 1 pixel solid black outline, flat 3-tone shading,
the two posts sit at the left and right edges, base occupies the bottom center 16 pixels,
transparent background, 16-bit game asset, limited palette
```

**열림**
```
Same wooden gate but open: the two side posts stay exactly in place, the plank door panel is
swung aside and folded flat against the left post, the middle is an empty gap you can walk
through, warm brown wood (#D2AE76 highlight, #B7956E mid, #8F6A4A shadow), 1 pixel solid black
outline, flat 3-tone shading, base occupies the bottom center 16 pixels, transparent background,
16-bit game asset, limited palette
```

### T2 · 철 보강 문 `gate_iron`

**닫힘**
```
A closed heavy gate of thick timber reinforced with dark iron bands and studs, set in a stone
frame, a round iron ring handle, warm brown wood (#B7956E mid, #663931 shadow) with dark iron
(#696A6A, #2E2E31) and gray stone posts (#8A8F99, #6B6F78), 1 pixel solid black outline,
flat 3-tone shading, base occupies the bottom center 16 pixels, transparent background,
16-bit game asset, limited palette
```

**열림**
```
Same iron-banded gate but open: the stone frame posts stay exactly in place, the reinforced
door panel is swung aside against the left post, the middle is an empty walkable gap, same wood
and iron and stone colors, 1 pixel solid black outline, flat 3-tone shading, base occupies the
bottom center 16 pixels, transparent background, 16-bit game asset, limited palette
```

### T3 · 강철 격벽 문 `gate_steel`

**닫힘**
```
A closed industrial steel blast door in a metal frame, two sliding panels meeting at a vertical
seam in the middle, hazard stripe marking near the bottom, rivets along the frame, cold steel
(#BDC8CC highlight, #B1BCBF mid, #696A6A shadow, #2E2E31 deep shadow) with a small warning
accent (#D9756B), 1 pixel solid black outline, flat 3-tone shading, base occupies the bottom
center 16 pixels, transparent background, 16-bit game asset, limited palette
```

**열림**
```
Same steel blast door but open: the metal frame stays exactly in place, both sliding panels are
retracted into the left and right sides leaving a wide empty gap in the middle, thin panel edges
visible at both sides, cold steel colors (#BDC8CC, #B1BCBF, #696A6A, #2E2E31), 1 pixel solid
black outline, flat 3-tone shading, base occupies the bottom center 16 pixels, transparent
background, 16-bit game asset, limited palette
```

---

## 5. 받은 뒤 할 일

### 파일 이름 = 프레임 접두사

```
assets/sprites/buildings/wall_stone.png        →  프레임 wall_stone__0
assets/sprites/buildings/gate_wood.aseprite    →  태그 closed/open → gate_wood_closed_0, gate_wood_open_0
```

문처럼 상태가 둘인 것은 **.aseprite로 만들고 태그를 단다.** 태그가 없으면 프레임 이름에
밑줄이 두 개 붙는다(`gate_wood__0`).

### 데이터 추가

에셋 id가 곧 `buildings.json`의 키가 된다. 티어가 늘면 비용과 HP도 같이 정의해야 한다.
지금은 `fence` / `wall` 두 종뿐이다.

```jsonc
"wall_stone": { "woodCost": 5, "stoneCost": 10, "hp": 200,
                "blocksMovement": true, "blocksProjectile": true }
```

### 렌더러 교체

현재 건축물은 도형 플레이스홀더다(`EntityRenderer`의 `BUILDING_STYLE`). 스프라이트로 바꿀 때
**원점을 (0.5, 0.94)로** 두어야 캐릭터와 같은 접지 규칙이 된다. 지금은 도형을 중앙 정렬로
그리고 있어서 그대로 스프라이트를 넣으면 바닥에 파묻힌다.

---

## 6. 아직 안 푼 문제 — 연결 타일

**울타리와 벽은 이어 붙였을 때 연결돼 보여야 한다.** 지금 프롬프트는 "직선 한 칸"만 만든다.
가로로 이으면 자연스럽지만 **모서리와 T자 교차, 끝단은 어긋난다.**

제대로 하려면 방향 조합마다 변형이 필요하다:

```
직선(가로) 직선(세로) 모서리 4종 T자 4종 십자 1종 끝단 4종  →  종류당 15장
```

3종 × 3티어 × 15장 = 135장이라 지금 단계에서 감당할 규모가 아니다. 현실적인 순서:

1. **지금은 직선 한 칸만** 뽑아서 배치·비용·HP 밸런스를 먼저 잡는다.
2. 형태가 확정되면 모서리·끝단 정도만 추가한다(종류당 3~4장).
3. 전체 15방향 세트는 아트 방향이 완전히 확정된 뒤에 간다.

문은 연결 문제가 없다 — 항상 벽 사이에 한 칸으로 들어간다.

## 7. 나중에 있으면 좋은 것

- **파손 상태**: HP가 깎였을 때 금 간 버전. 지금 HP 바로만 표시하는데 실루엣이 변하면 훨씬 잘 읽힌다.
- **건설 중 상태**: 반투명 뼈대. 건축 모드 프리뷰에 쓸 수 있다.
