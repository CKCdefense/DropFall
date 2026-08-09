# 75. 작업 보고서 — 게임 사운드 시스템 신설(발소리·전투·몬스터·부활·배경음악)

## 기획

사용자 요청(원문): "지금 sound asset 올라와서 이거 연결하려고하거든?"

`sounds/`(저장소 루트)에 팀원이 미리 커밋해 둔 131개 원본 오디오 파일이 있었다
(`git log --diff-filter=A -- sounds` → `599d259 feat: sound 커밋`, `a7ec365 feat: 음악
추가`). 폴더별로 이미 용도가 나뉘어 있었다:

- `01.플레이어` — 다운/부활/발소리(타일·풀·흙)
- `02.전투` — 근접 무기 휘두르기(몽둥이 전용/도끼 전용/공용)
- `03.원거리` — 총성(권총/기관총/샷건), 빈 탄창, 재장전
- `04.몬스터` — 스폰 신호음 + 몬스터 울음 3종(그 외 `Monster-Sounds-Volume-2`,
  `monster_sfx_pack_2` 두 하위 폴더와 zip은 몬스터1/2/3.wav를 고르기 전의 원본
  다운로드 팩으로 보여 손대지 않았다)
- `boss`/`night`/`peace` — 배경음악 후보 각 3곡
- `steps` — Kenney의 범용 RPG 효과음 팩(문 여닫기, 책장 넘기기, 동전 등) + 라이센스
  파일 + zip. 이 게임 이벤트와 딱 맞아떨어지는 게 없어 이번 범위에서 뺐다(커밋된
  파일은 그대로 두고, 나중에 UI 효과음이 필요하면 다시 본다).

빠진 파일 하나: `01.플레이어/레벨업.aif`. 브라우저 WebAudio(`decodeAudioData`)가
AIFF를 사실상 지원하지 않아서(Chrome 기준 디코드 실패) 이번엔 빼고, 변환(wav/mp3)이
되면 붙이기로 남겨 뒀다 — 이 세션에 ffmpeg가 없어 직접 변환은 못 했다.

배경음악은 낮/밤/보스전 후보가 여러 곡이라 팀 결정이 필요했다. 사용자가 채팅 중
직접 매핑을 줬다(2026-08-09):

| 국면 | 곡 |
|---|---|
| 낮 | `peace/song_2.mp3` |
| 밤(1일차, 보스 없음) | `night/arpmedia-dark-tension-569513.mp3` |
| 2일차 밤(보스: 데몬) | `night/leberch-tension-510483.mp3` |
| 3일차 밤(보스: 기사) | `boss/backgroundmusicmaster-bossroom-battle-431358.mp3` |
| 4일차 밤(보스: 골렘) | `boss/the_mountain-battle-music-179502.mp3` |
| 5일차 밤(보스: 심연의 기사) | `boss/davidjbarrios-epic-boss-battle...515739.mp3` |

`waves.json`의 `waves[]` 배열(인덱스+1 = `WaveManager.currentWave`, 1-based)과
정확히 대응한다 — `waves[0]`엔 `bossType`이 없고(1일차), `waves[1..4]`가 각각
`boss_demon`/`boss_knight`/`boss_golem`/`boss_dark_knight`(2~5일차)라 "Day N"이라는
사용자 표현이 곧 `currentWave === N`이다.

## 과정

### 1. 커스터레이션 — 뭘 어디에 쓸지

원본 131개 중 정말 쓸 23개만 골라 영문 kebab-case로 이름을 바꿔
`packages/client/public/assets/sounds/`에 복사했다(한글·공백 파일명을 URL에 그대로
쓰는 걸 피하려고 — 다른 에셋들도 전부 영문 관례). 원본은 `sounds/`에 그대로 둔다.

무기별 소리는 무기 데이터의 **필드만으로** 갈랐다 — 무기가 늘어도 이 매핑을
따로 안 고쳐도 되게:

- 근접: `bat`이면 몽둥이 전용음, `toolFamily`(또는 `toolFamilies`)에 `'axe'`가
  있으면 도끼음(소방도끼·마체테·토마호크·돌도끼류), 나머지는 공용 휘두르기음.
- 원거리: `pellets`가 있으면 샷건(더블배럴·펌프), `burst`가 있거나
  `fireRate >= 6`이면 기관총류(기관단총·돌격소총·미니건), 나머지는 전부
  권총류(단발 취급 — 석궁·소총·저격총도 여기 들어간다. 전용 라이플 음원이
  없어서 가장 가까운 "단발 총성"으로 묶었다).

### 2. 배경음악 — 왜 미리 안 올리나

효과음 17개(합 ~16MB)는 `GameScene.preload()`에서 한꺼번에 올린다 — 게임을 켜자마자
쓰이는 것들이라 초기 로딩에 얹는 게 맞다. 배경음악 6개(합 ~23MB)는 **다르다** —
낮에 시작한 게임은 3~5일차 보스곡을 당장 쓸 일이 없는데, 그것까지 초기 로딩에
얹으면 첫 화면만 느려진다. `AudioManager`가 그 국면이 실제로 왔을 때 그때
`scene.load.audio()`로 불러오고(첫 전환만 살짝 대기, 이후엔 Phaser 캐시라 즉시),
곡이 바뀔 때는 900ms 트윈으로 볼륨을 오가며 섞는다(뚝 끊기지 않게).

### 3. "무엇을 밟고 있나" — 지형 3종 + 코어 마당

발소리는 지형(`TerrainKind`: grass/dirt/sand/stone)이 아니라 **화면에 실제로
보이는 맨 위 지형**을 따라야 한다(덧칠 순서). 마침 미니맵이 쓰던
`minimapTerrainAt(cx, cy, seed)`가 정확히 그 규칙이라 그대로 재사용했다 —
`TerrainLayer`에 `terrainKindAt(worldX, worldY)` 한 줄을 얹었을 뿐이다.

코어 마당(포장)은 지형이 아니라 **반경으로만 정해지는 별도 레이어**
(`courtyard`, `pavementTileAt`)라 지형 조회로는 안 잡힌다. `GameScene.update()`에서
"코어 원점에서 `coreBuildRadius` 안이면 타일, 아니면 지형 조회" 순서로 판정한다 —
모래·돌바닥 전용 발소리는 없어서 흙 소리로 묶었다(포장이 아닌 맨땅이라는 점에서
같은 갈래로 봤다).

### 4. 언제 뭘 울리나 — 이벤트 훅 두 갈래

- **스냅샷 비교로 잡는 것** (`AudioManager.update()`가 매 프레임 이전 프레임과
  비교): 배경음악(국면·`currentWave`), 부활/쓰러짐(`lifeState` 전이, 전원 대상 —
  동료가 쓰러지는 소리도 들려야 위험을 안다), 몬스터 스폰(새 id 등장)·공격
  (`attackSeq` 변화, 몬스터1/2/3 중 무작위), 재장전 시작(`reloadRemaining` 0→양수).
  스폰·공격 growl은 최소 간격(260ms)을 둬서 — 웨이브 시작처럼 한꺼번에 여럿이
  뜨거나 여럿이 동시에 덤빌 때 마릿수만큼 울리면 소음이 된다.
- **입력에서 바로 잡아야 하는 것**: 공격 SFX(휘두르기/총성)와 빈 탄창 클릭음은
  스냅샷만으로는 "지금 막 시도했다"를 알 수 없다. `InputController`의 기존
  `onAttack` 훅(실제로 나간 공격에만 붙는다 — 예전에 이미 "헛연출 방지"로
  정리된 자리)에 얹었고, 빈 탄창은 새 훅(`onEmptyFire`)을 추가했다. 홀드 연사
  중 매 프레임 걸리면 시끄러우므로 **새로 누른 순간에만**(`freshPress`, 직전
  프레임에 안 누르고 있었을 때) 울리게 가려냈다.

발소리는 루프 파일이 아니라 짧게 반복 재생하는 방식으로 뒀다(340ms 간격, 지형이
바뀌면 다음 걸음부터 즉시 새 소리로). 대상은 **내 캐릭터뿐**이다 — 위치 기반
음량 감쇠가 없는 지금 단계에서 원격 팀원 발소리까지 섞으면 시끄럽기만 하다(추후
확장 여지로 남겨 둠).

### 5. 검증 — Playwright로 실제 재생까지 확인

타입체크·빌드만으로는 "실제로 소리가 나는가"를 못 본다. 이 세션에 이미 캐시된
Playwright Chromium(`~/AppData/Local/ms-playwright`, JS 패키지만 스크래치에 재설치)
로 `?local=1`(혼자하기) 모드를 띄워 확인했다:

- 효과음 17종 전부 `game.cache.audio.exists()` — 프리로드 성공.
- `game.sound.locked === false` — 클릭 한 번으로 WebAudio가 정상 해제.
- 배경음악: 로드 직후 `AudioManager.currentBgmKey === 'day'`이고, 이동 중
  `game.sound.sounds`에 `day` 트랙이 실제로 재생 중으로 잡힘.
- 발소리: 코어 마당(시작 지점) 안에서 이동하니 `footstepTile`이 재생 목록에 등장 —
  포장 반경 판정이 실제로 맞물려 돈다.
- 공격: 시작 암전 연출("DAY 1", `docs/backend/59`)이 입력을 막고 있어 첫 시도엔
  아무 소리도 안 났다 — 스크린샷으로 원인 확인 후 연출이 끝나길 기다려 재시도,
  맨손(무기 미장착) 공격에 `swingGeneric`이 정확히 재생됨을 확인.
- 뮤트(M): `AudioManager.isMuted`/`game.sound.mute` 둘 다 정상 토글.
- 콘솔 에러: 오디오 관련 에러 0건. (뜬 에러는 전부 몬스터 아틀라스 — 라이센스
  에셋이라 저장소에 없는, 이번 작업과 무관한 기존 상태였다.)

## 결과

- `packages/client/public/assets/sounds/`: 신규 23개 파일(효과음 17 + 배경음악 6,
  합 ~39MB) — 원본은 `sounds/`(저장소 루트)에 그대로 유지.
- `packages/client/src/game/audio/AudioManager.ts`(신규): 효과음 프리로드
  (`queueAudio`), 배경음악 지연 로드·교차페이드, 지형별 발소리, 무기 카테고리별
  전투음, 부활/쓰러짐·몬스터 스폰/공격·재장전 이벤트 훅, 음소거.
- `packages/client/src/game/render/TerrainLayer.ts`: `terrainKindAt(worldX, worldY)`
  추가(미니맵과 같은 `minimapTerrainAt` 재사용).
- `packages/client/src/game/input/InputController.ts`: `onEmptyFire` 콜백 신설,
  `isMoving` getter 추가, 빈 탄창 판정을 "새로 누른 순간에만" 가리는 로직.
- `packages/client/src/game/scenes/GameScene.ts`: 오디오 프리로드·`AudioManager`
  생성·`M` 음소거 키·매 프레임 `audio.update()` 배선(발소리용 지형/코어마당 판정
  포함), 씬 종료 시 배경음악 정지.
- 재검증: shared 592/592, server typecheck·test(31), client typecheck·build,
  `pnpm lint` 전부 통과. Playwright 실측으로 배경음악·발소리·공격음·음소거
  동작을 직접 확인(위 §5).

## 남은 일(이번 범위 밖)

- `레벨업.aif` — 형식 변환 필요(AIFF는 브라우저 WebAudio가 사실상 못 읽는다).
- 원격 팀원 발소리, 몬스터 소리의 위치 기반 음량 감쇠 — 지금은 전부 거리 무관
  균일 음량이다.
- 볼륨 조절 UI — 지금은 `M` 키 음소거뿐, 슬라이더 등 설정 화면은 아직 없다.
- `steps/`(Kenney 범용 팩) — 이 게임 이벤트에 맞는 게 마땅치 않아 이번엔 안 썼다.
