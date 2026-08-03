# DropFall 기술 명세

## 1. 기술 스택

| 레이어 | 선택 | 비고 |
|---|---|---|
| 언어 | **TypeScript** (strict) | 클라·서버 전역 |
| 렌더링 | **Phaser 3** | 픽셀아트, 타일맵, 입력, 카메라 내장 |
| 멀티플레이 | **Colyseus** (Node + WebSocket) | 룸 관리 + 상태 동기화 |
| 런타임 | Node 20 LTS | |
| 빌드 | **Vite**(클라) / **tsup**(서버) | 서버를 tsc로 빌드하면 확장자 없는 ESM import로 실행이 깨진다 (§9.5) |
| 패키지 | **pnpm workspace** | 모노레포 |
| 맵 에디터 | **Tiled** | `.tmj` (JSON) 익스포트 |
| 스프라이트 | **Aseprite** | `.aseprite` → PNG 아틀라스 + JSON |
| 테스트 | Vitest | `shared/sim` 유닛 테스트 중심 |
| 린트/포맷 | ESLint + Prettier | pre-commit 훅 |
| 배포 | 클라: GitHub Pages + 홈서버 / 서버: 홈서버 | Cloudflare Tunnel로 `wss://` 노출 (§9) |

### 1.1 선정 근거

**Phaser 3 (vs PixiJS, Godot, Unity)**
- Godot 4 웹 익스포트: 에디터는 편하지만 wasm 초기 로딩이 수십 MB. 모바일 브라우저 불안정.
  "브라우저에서 바로 되는 게임"이 공모전 심사에서 유리하다는 판단.
- Unity WebGL: 더 무겁다. 제외.
- PixiJS: 렌더러만 제공 → 입력/씬/타일맵을 직접 구현해야 함. 일정상 손해.
- Phaser 3: 내부 렌더러가 Pixi 계열이라 픽셀아트 성능은 충분(수백 스프라이트 문제없음).
  단, **Phaser의 물리·씬 시스템은 렌더 레이어에서만 사용**한다 (§3 참조).

**Colyseus (vs 자체 WebSocket 구현, geckos.io)**
- 룸 생성/입장/재접속/상태 델타 동기화가 기본 제공 → 직접 짜면 최소 2~3주
- Schema 기반 바이너리 델타라 대역폭 효율이 좋다
- geckos.io(WebRTC/UDP)는 지연이 더 낮지만, 협동 PvE에서 100ms 차이는 중요하지 않고
  셋업 복잡도가 올라간다. 제외.

---

## 2. 프로젝트 구조

```
dropfall/
├─ docs/
├─ packages/
│  ├─ shared/                # 순수 TS. DOM/Phaser/Node 의존 0
│  │  ├─ src/
│  │  │  ├─ sim/             # 게임 시뮬레이션 (서버가 실행, 클라가 예측)
│  │  │  │  ├─ world.ts      #   틱 진행, 엔티티 관리
│  │  │  │  ├─ movement.ts
│  │  │  │  ├─ combat.ts
│  │  │  │  ├─ building.ts
│  │  │  │  ├─ wave.ts
│  │  │  │  └─ ai/flowField.ts
│  │  │  ├─ data/            # 밸런스 데이터 (JSON + 타입)
│  │  │  │  ├─ weapons.json
│  │  │  │  ├─ monsters.json
│  │  │  │  ├─ buildings.json
│  │  │  │  ├─ waves.json
│  │  │  │  └─ index.ts      #   JSON 로드 + 타입 검증
│  │  │  ├─ protocol/        # 클라↔서버 메시지 타입, Colyseus Schema
│  │  │  └─ constants.ts     # TICK_RATE, TILE_SIZE 등
│  │  └─ tests/
│  ├─ server/
│  │  └─ src/
│  │     ├─ index.ts         # Colyseus 서버 부트스트랩
│  │     ├─ rooms/GameRoom.ts
│  │     └─ state/           # Colyseus Schema 정의
│  └─ client/
│     └─ src/
│        ├─ main.ts          # Phaser Game 인스턴스
│        ├─ scenes/          # Boot, Lobby, Game, UI
│        ├─ net/             # Colyseus 클라이언트, 보간, 예측
│        ├─ render/          # 엔티티 → 스프라이트 매핑, Y-sort
│        ├─ ui/              # 픽셀아트 UI 컴포넌트 (9-slice 등)
│        └─ input/
├─ assets/                   # 원본 (.aseprite, .tmx) — 빌드 산출물 아님
├─ tools/                    # 아틀라스 빌드 스크립트 등
├─ pnpm-workspace.yaml
└─ package.json
```

### 2.1 절대 규칙

> **`shared/sim` 은 Phaser, DOM, Node API를 import 하지 않는다.**

이걸 지켜야 같은 코드가 서버(권위)와 클라(예측) 양쪽에서 돌아간다. 어긴 순간 멀티 붙일 때
전부 갈아엎게 된다. ESLint `no-restricted-imports` 로 강제한다.

---

## 3. 아키텍처: 시뮬레이션과 렌더링 분리

```
┌─────────────── server ───────────────┐        ┌─────────────── client ───────────────┐
│  GameRoom                            │        │  Phaser Game                         │
│    └ shared/sim World (권위, 20Hz)    │ ─────▶ │    ├ net: 스냅샷 수신 → 보간           │
│        · 입력 큐 처리                  │ 상태    │    ├ shared/sim (내 캐릭터 예측만)     │
│        · 물리/충돌/전투                │ 델타    │    └ render: 엔티티 → 스프라이트 (60fps)│
│        · 웨이브/AI                    │ ◀───── │       Y-sort, 카메라, 파티클           │
└──────────────────────────────────────┘  입력   └──────────────────────────────────────┘
```

- **Phaser의 Arcade Physics는 게임 판정에 쓰지 않는다.** 충돌·히트 판정은 전부 `shared/sim`.
  Phaser는 스프라이트를 그리고 카메라를 움직이는 역할만 한다.
- 엔티티는 **id 기반 플레인 객체**. 클라는 `entityId → Phaser.Sprite` 맵을 유지하며
  생성/갱신/삭제만 반영한다.

### 3.1 ECS 여부
초기에는 **ECS를 도입하지 않는다.** 엔티티 타입이 5~6종(플레이어, 몬스터, 투사체, 건축물,
아이템 드랍, 자원 노드)이라 태그드 유니온 + 타입별 배열로 충분하다.
엔티티 종류가 15종을 넘어가면 그때 `miniplex` 도입을 검토한다. **선제적 ECS는 과설계다.**

### 3.2 좌표계
- 월드 좌표는 **픽셀 단위 float** (`x`, `y`)
- 그리드(건축/AI)는 `TILE_SIZE = 16` 기준 정수 셀 (`cx = floor(x / 16)`)
- 렌더 시 `Math.round()` + `roundPixels: true` 로 픽셀 스냅

---

## 4. 네트워크 모델

### 4.1 기본 설계
| 항목 | 값 |
|---|---|
| 서버 틱 | **20Hz** (50ms) |
| 클라 렌더 | 60fps |
| 권위 | **서버 100%** |
| 클라 → 서버 | 입력만 (이동벡터, 조준각, 발사/상호작용 플래그, seq 번호) |
| 서버 → 클라 | AOI 내 엔티티 상태 델타 (Colyseus Schema) |
| 최대 인원 | 룸당 4명 |

### 4.2 클라이언트 예측 / 보간

- **자기 캐릭터 이동만 예측**한다. 입력을 즉시 로컬 적용 + 시퀀스 버퍼에 저장 →
  서버 확정 상태 수신 시 불일치하면 해당 시점부터 재시뮬(reconciliation).
- **다른 플레이어 / 몬스터 / 투사체는 예측하지 않는다.** 100ms 지연 버퍼를 두고
  두 스냅샷 사이를 선형 보간한다. 협동 PvE라 이 정도로 충분하다.
- **히트 판정은 서버에서만.** 클라는 즉시 이펙트(머즐 플래시, 사운드)를 그리고,
  실제 데미지는 서버 확정을 기다린다. 랙 보상(lag compensation)은 MVP 범위 밖.

### 4.3 대역폭 절감
- 좌표는 정수 픽셀로 양자화, 각도는 1바이트(0~255)
- AOI: 화면 + 여유 2타일 밖 엔티티는 전송하지 않음
- 건축물은 상태가 거의 안 변하므로 **이벤트 기반**으로만 전송 (설치/파괴/HP변경)

### 4.4 재접속
Colyseus의 `allowReconnection` 사용. 끊긴 플레이어는 30초간 캐릭터가 다운 상태로 남고,
그 안에 돌아오면 복귀. 공모전 시연 중 사고 대비로 **필수 구현**.

---

## 5. 몬스터 AI: Flow Field

수십~수백 마리가 **중앙 코어라는 공통 목표**로 몰려온다. 개체별 A*는 낭비다.

### 5.1 알고리즘
1. 코어 셀에서 그리드 전체로 BFS → **거리맵(cost field)** 생성
2. 각 셀에서 이웃 8방향 중 거리가 가장 낮은 쪽 → **방향 벡터 저장**
3. 몬스터는 자기가 선 셀의 벡터만 읽는다 → **개체당 O(1)**
4. 재계산은 **건축물 설치/파괴 이벤트 시에만**. 매 틱 계산 금지

맵이 128×128이면 필드 하나 재계산이 수 ms. 웨이브 중 건축이 잦아도 문제없다.
(연속 건축 시 재계산은 다음 틱까지 debounce)

### 5.2 그리드 레이어

울타리와 벽의 차이를 표현하기 위해 그리드를 **두 레이어**로 분리한다.

| 레이어 | 용도 | 울타리 | 벽 |
|---|---|---|---|
| `blocksMovement` | Flow Field 통행 비용 | O (차단) | O (차단) |
| `blocksProjectile` | 투사체 / 시야 판정 | **X (통과)** | O (차단) |

이 분리가 "울타리 뒤에서 쏘기" 전투를 성립시킨다.

### 5.3 개체 행동 (필드 위에 얹는 레이어)
- **기본**: 필드 벡터 방향으로 이동
- **막힘 감지**: 다음 셀이 `blocksMovement` 이고 우회 비용이 크면 → 그 건축물 공격
- **어그로 오버라이드**: 반경 N 내 플레이어가 있으면 직접 추격 (돌진형은 반경이 크다)
- **군집 분리**: 같은 셀에 겹치지 않도록 간단한 separation 벡터 가산

> A*는 "특정 플레이어를 끝까지 쫓는 엘리트" 정도에만 예외적으로 쓴다.

---

## 6. 데이터 주도 설계

무기·몬스터·건축물·웨이브는 **전부 `shared/data/*.json`**. 코드 하드코딩 금지.

```jsonc
// weapons.json (예시)
{
  "pistol": {
    "name": "권총",
    "type": "ranged",
    "damage": 12,
    "fireRate": 4,          // 초당 발사
    "magazine": 12,
    "reloadTime": 1.2,
    "spread": 2,            // degree
    "projectileSpeed": 420,
    "ammoType": "bullet",
    "sprite": "weapon_pistol",
    "cost": { "energy": 60 }
  }
}
```

- 로드 시 **zod로 스키마 검증** → 오타·누락을 런타임 초반에 잡는다
- 밸런싱은 JSON만 고치면 되므로 팀원 누구나 참여 가능
- 개발 모드에서 JSON HMR → 재시작 없이 수치 조정

---

## 7. 아트 파이프라인

### 7.1 해상도 (**초반에 확정, 이후 변경 금지**)

| 항목 | 값 |
|---|---|
| 타일 | 16 × 16 px |
| 캐릭터 | 32 × 32 px (발밑 기준 정렬) |
| 기준 시야 | 480 × 270 월드 단위 (`WORLD_VIEW_*`) |
| 캔버스 | **창 크기 = 네이티브 해상도** (`Phaser.Scale.RESIZE`) |
| 월드 카메라 | **정수배 줌 2x~4x** (`computeCameraZoom`) |
| HUD | 카메라 줌 1(네이티브), UI 스케일 1~2배 |

> 에셋 기준(타일 16px / 캐릭터 32px)은 못 박는다. 나중에 바꾸면 전 에셋 재작업이다.

#### 저해상도 캔버스를 통째로 확대하지 않는 이유

초기안은 "480×270 캔버스를 정수배로 확대"였다. 실제로 구현해보고 뒤집었다.

1. **한글은 8px에서 판독이 불가능하다.** 영문 픽셀 폰트는 5×7px로도 읽히지만, 한글은 자소가
   2~3개 조합되는 구조라 최소 11~12px, 편하게 읽으려면 16px이 필요하다. 480×270 캔버스에서
   16px 폰트는 **세로의 6%를 글자 한 줄이 먹는다** — HUD 몇 줄이면 화면이 잠식된다.
   즉 "저해상도 캔버스 + 한글 UI"는 구조적으로 양립하지 않는다.
2. **`Phaser.Scale.FIT`은 소수배 확대를 만든다.** 1195px 창에서 `1195 ÷ 480 = 2.49배`가 되어
   어떤 픽셀은 2칸, 어떤 픽셀은 3칸이 된다. 픽셀아트가 오히려 지저분해진다.

**대신 월드와 UI의 해상도를 분리한다** — 저해상도로 그려야 하는 건 스프라이트지 UI가 아니다.
캔버스는 네이티브 해상도로 두고 **월드 카메라만 정수배로 줌**하면, 픽셀아트 룩은 그대로 두고
UI만 선명하게 만들 수 있다. 상용 픽셀게임들이 쓰는 방식이다.

**시야 공정성**: 창이 크면 월드가 더 많이 보인다. 협동 게임에서 모니터 크기가 정보량 차이가
되지 않도록 줌 상한(4x)을 둔다. 근거와 검증: [frontend/04](frontend/04-work-report-resolution-policy.md)

### 7.2 Phaser 설정
```ts
new Phaser.Game({
  type: Phaser.AUTO,
  pixelArt: true,        // 필수: 텍스처 필터 NEAREST
  roundPixels: true,     // 필수: 서브픽셀 흔들림 방지
  antialias: false,
  // 캔버스가 창 크기를 그대로 따라간다. 캔버스 자체는 확대하지 않는다.
  scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.NO_CENTER },
})

// 월드 씬에서만 정수배 줌
this.cameras.main.setZoom(computeCameraZoom(this.scale.width, this.scale.height));
```

- 캔버스가 창 크기를 따라가므로 **`resize` 이벤트에서 줌과 HUD 레이아웃을 다시 계산**해야 한다
- **월드 안에 그리는 텍스트**(닉네임 등)는 줌 배수만큼 확대되므로 `text.setResolution(zoom)`으로
  래스터화 해상도를 같이 올린다. 안 하면 7px로 그린 글자를 4배 늘리게 되어 한글이 뭉개진다

### 7.3 아틀라스
- Aseprite CLI로 `assets/sprites/*.aseprite` → 단일 아틀라스 PNG + JSON(hash) 자동 생성
- `pnpm run build:atlas` 스크립트로 관리, 산출물은 `.gitignore` 하지 **않는다**
  (아티스트가 Aseprite CLI 없이도 클론 즉시 실행 가능해야 함)
- 팔레트는 32~48색 고정. `assets/palette.gpl` 공유

### 7.4 맵
- Tiled로 제작, `.tmj`(JSON) 익스포트
- 레이어: `ground` / `decoration` / `collision` / `spawn`(오브젝트) / `resource`(오브젝트)
- 서버가 `collision` 레이어를 읽어 Flow Field 초기 그리드를 만든다 → **맵 데이터는 shared**

### 7.5 UI
**인게임 UI는 DOM을 쓰지 않고 캔버스 내부에 픽셀아트로 그린다.** 인벤토리·상점·테크트리가
많으므로 공통 컴포넌트를 먼저 만든다.

> **예외 — 로비/타이틀 화면은 DOM으로 만든다.** 텍스트 입력·포커스·한글 IME 조합·스크롤
> 목록을 캔버스에서 재구현하는 비용이 일관성 이득보다 크다. 픽셀 느낌은 CSS로 낸다.
> 경계는 명확하다: **인게임 화면에 뜨는 것은 전부 캔버스.**
> 근거: [frontend/01-client-architecture.md §2.2](frontend/01-client-architecture.md)

- `NineSlicePanel` — 창/버튼 프레임 (Phaser `NineSlice` 게임오브젝트)
- `PixelButton`, `PixelBar`(HP/진행도), `ItemSlot`, `Tooltip`
- UI는 별도 Scene(`UIScene`)에서 게임 Scene 위에 렌더 → 카메라 줌 영향 분리
- 한글 픽셀 폰트는 비트맵 폰트로 변환해 사용 *(TBD: 폰트 라이선스 확인)*

---

## 8. 성능 목표

| 항목 | 목표 |
|---|---|
| 프레임 | 60fps (몬스터 150마리 + 투사체 100개 동시) |
| 서버 틱 처리 | < 10ms / tick (4인 룸) |
| 초기 로딩 | < 5초 (일반 회선) |
| 번들 크기 | JS < 1.5MB gzip |

### 최적화 지침 (필요해질 때만 적용)
- 투사체·이펙트는 **오브젝트 풀링** (매 프레임 `new` 금지)
- 스프라이트는 단일 아틀라스로 묶어 드로우콜 최소화
- Y-sort는 `depth = y` 로 처리 (매 프레임 정렬 배열 만들지 말 것)
- 조기 최적화 금지. **먼저 프로파일링**한다.

---

## 9. 배포 / 인프라

### 9.1 구성

클라이언트는 **GitHub Pages와 홈서버 양쪽에 배포**하고, 게임 서버는 **홈서버**가 단독으로 맡는다.

```
                    심사위원 브라우저
                          │
       ┌──────────────────┴──────────────────┐
       │                                     │
  [ 클라이언트 ]                        [ 게임 서버 ]
  https://<id>.github.io/DropFall/     wss://game.<도메인>
  https://dropfall.<도메인>              └ Colyseus (홈서버 :2567)
   (둘 다 동일 빌드 산출물)                  Cloudflare Tunnel 경유
```

| 대상 | 위치 | 비고 |
|---|---|---|
| 클라이언트 (주) | **GitHub Pages** | 공모전 제출 링크. `main` 머지 시 Actions 자동 배포 |
| 클라이언트 (부) | **홈서버** (Caddy 정적 서빙) | 자체 도메인 접속용. Pages 장애 시 대체 |
| 게임 서버 | **홈서버** (Colyseus) | Cloudflare Tunnel로 `wss://` 노출 |
| 에셋 | 클라 번들에 포함 | 별도 CDN 불필요 |

> **왜 클라이언트만 이중화하는가**: 정적 파일은 어디에 올려도 같은 산출물이라 이중화 비용이 0이다.
> 반면 게임 서버는 상태를 가지므로 이중화하려면 룸 상태 공유가 필요하다 — MVP 범위 밖.
> 백업 게임 서버는 두지 않는다. 대신 홈서버 자동 재기동을 확실히 해둔다 (§9.5).

**게임 서버를 홈서버로 두는 이유**
- Fly.io/Railway 무료 티어의 cold start, 유휴 종료, 메모리 제한이 없다
- 20Hz 틱 4인 룸은 부하가 매우 낮다 (라즈베리파이급으로도 충분)
- GitHub Pages는 정적 호스팅이라 **Node 상주 프로세스를 올릴 수 없다** → 서버는 어차피 별도 호스트가 필요

### 9.2 필수 제약: HTTPS ↔ WSS

GitHub Pages는 항상 HTTPS로 서빙된다. **HTTPS 페이지에서 `ws://`(비암호화) 연결은 브라우저가 차단한다.**
자체 서명 인증서도 통하지 않는다.

→ 홈서버는 **도메인 + 유효한 TLS 인증서 + `wss://`** 가 반드시 필요하다.

### 9.3 홈서버 노출: Cloudflare Tunnel

포트포워딩 대신 **Cloudflare Tunnel**을 쓴다. 홈서버가 바깥으로 나가는 연결을 유지하는 방식이라
CGNAT·유동 IP·ISP의 80/443 차단·공유기 설정·홈 IP 노출 문제가 전부 사라지고 TLS도 자동이다.

```yaml
# ~/.cloudflared/config.yml
tunnel: dropfall
credentials-file: /home/<user>/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: game.<도메인>          # 게임 서버 (WebSocket + 매치메이킹 HTTP)
    service: http://localhost:2567
  - hostname: dropfall.<도메인>      # 클라이언트 정적 서빙
    service: http://localhost:8080
  - service: http_status:404
```

> **주의**: Cloudflare는 유휴 WebSocket을 약 100초에 끊는다. Colyseus 기본 ping/pong 하트비트로
> 커버되지만, **로비에서 장시간 대기하는 시나리오는 반드시 실측 테스트**한다.

### 9.4 클라이언트 빌드 — 두 경로 동시 지원

GitHub Pages 프로젝트 사이트는 `/DropFall/` 하위 경로, 홈서버는 루트(`/`)다.
경로 차이는 **상대 base**로 흡수한다. 빌드 산출물 하나를 양쪽에 그대로 올릴 수 있다.

```ts
// packages/client/vite.config.ts
export default defineConfig({
  base: './',            // 상대 경로 → Pages 하위 경로 / 홈서버 루트 양쪽 동작
  build: { outDir: 'dist' },
})
```

- 런타임에 동적으로 로드하는 에셋 경로는 반드시 `import.meta.env.BASE_URL` 을 붙인다
- **SPA 라우팅(history API)을 쓰지 않는다.** 씬 전환은 Phaser 내부에서만 처리 →
  상대 base가 깨질 일이 없다

**서버 주소 주입** — 빌드 시 환경변수 + 런타임 쿼리 오버라이드:

```ts
// packages/client/src/net/config.ts
// ?server=ws://localhost:2567 로 시연 중에도 재배포 없이 전환 가능
const params = new URLSearchParams(location.search)
export const SERVER_URL = params.get('server') ?? import.meta.env.VITE_SERVER_URL
```

```
# packages/client/.env.production
VITE_SERVER_URL=wss://game.<도메인>
```

### 9.5 배포 파이프라인

**GitHub Pages** — `main` 푸시 시 Actions 자동 배포
(`.github/workflows/deploy-pages.yml`, `pnpm --filter client build` → `deploy-pages@v4`)

**홈서버** — 동일 산출물을 정적 서빙. 아래 중 택1
- Actions에서 SSH/rsync로 푸시 (셀프호스티드 러너 또는 Tunnel SSH)
- 홈서버에서 주기적으로 `git pull` + 빌드 (cron)
- 수동 배포 (`pnpm --filter client build && rsync dist/ 홈서버:/srv/dropfall/`)

> 3인 팀 규모에서는 **수동 배포로 시작**하고, 잦아지면 자동화한다. 여기에 시간 쓰지 말 것.

> **서버는 tsup으로 번들한다** (`packages/server/tsup.config.ts`). `tsc`는
> `moduleResolution: "bundler"` 하에서 확장자 없는 상대 import를 그대로 출력해
> `node dist/index.js`가 `ERR_MODULE_NOT_FOUND`로 죽고, `@dropfall/shared`(TS 소스 export)도
> 번들에 인라인해야 한다. 산출물이 파일 하나라 홈서버 배포도 단순하다.
>
> 서버 CORS는 `CLIENT_ORIGIN` 환경변수로 지정한다. 프로덕션 기본값은 `*`가 아니라 빈 값이다.

**홈서버 프로세스 관리** — 백업 서버가 없으므로 자동 복구가 유일한 방어선이다.

- Colyseus, `cloudflared`, 정적 서버를 전부 **systemd 서비스**로 등록
- `Restart=always`, `RestartSec=3`, `WantedBy=multi-user.target` (부팅 시 자동 기동)
- 재부팅 테스트를 **실제로 한 번 해본다**. 안 해보면 시연 당일에 안 올라온다

### 9.6 로컬 개발

`pnpm dev` 한 번으로 클라(5173) + 서버(2567) 동시 기동. 로컬은 `ws://localhost:2567` 사용
(HTTP 페이지라 mixed content 제약 없음).

### 9.7 배포 체크리스트 (시연 1주 전 필수)

- [ ] 팀 외부 네트워크(모바일 핫스팟 등)에서 Pages URL 접속 → 홈서버 연결 성공
- [ ] 홈서버 도메인 URL로도 동일하게 동작
- [ ] 3인 동시 접속 20분 이상 유지 (Cloudflare WebSocket 타임아웃 실측)
- [ ] 홈서버 **재부팅 후** Colyseus + cloudflared 자동 기동 확인
- [ ] 로비 장시간 대기 → 연결 유지 확인
- [ ] 브라우저 콘솔에 mixed content / 404 에셋 경고 없음

---

## 10. 개발 환경

```bash
pnpm install
pnpm dev            # 클라 + 서버 동시 실행
pnpm test           # shared/sim 유닛 테스트
pnpm build:atlas    # Aseprite → 아틀라스
pnpm lint
```

권장 VSCode 확장: ESLint, Prettier, Tiled(선택)

---

## 11. 기술 리스크

| 리스크 | 영향 | 대응 |
|---|---|---|
| 멀티 동기화 난이도 과소평가 | 치명적 | **2주차에 최소 동기화 데모부터** 만든다. 뒤로 미루지 않는다 |
| 에셋 제작 병목 | 높음 | 1주차에 플레이스홀더(단색 사각형)로 전 시스템 구현, 아트는 나중에 교체 |
| 해상도/팔레트 번복 | 높음 | 1주차 확정 후 변경 금지 |
| 밸런싱 시간 부족 | 중간 | JSON 데이터 주도로 마지막 주에 집중 조정 |
| **홈서버 단일 장애점** | **높음** | 백업 게임 서버 없음. systemd `Restart=always` + 부팅 자동 기동 + 재부팅 테스트로 방어. 클라이언트는 Pages/홈서버 이중화 |
| HTTPS↔WSS / 경로 문제 | 중간 | Pages는 HTTPS 강제 → `wss://` 필수, `base: './'`. 시연 1주 전 외부망 배포 리허설 |
| Flow Field 재계산 부하 | 낮음 | debounce + 프로파일링. 최악의 경우 재계산을 웨이브 시작 시로 제한 |
