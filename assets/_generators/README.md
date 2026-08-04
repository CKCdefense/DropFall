# 절차적 스프라이트 생성기

여기 있는 Lua 스크립트는 **Aseprite CLI로 실행해서 `sprites/` 아래 `.aseprite` 원본을 만든다.**
`_reference/`(미사용 스케치)와 달리, 이 파일들이 만들어낸 결과물은 실제 게임에 들어간다.

## 왜 손으로 안 그리고 스크립트로 만드나

이펙트는 "밝은 코어 → 따뜻한 색 → 소멸" 같은 **규칙적인 변화**가 전부라 수식으로 잘 표현된다.
프레임마다 손으로 찍으면 타이밍을 바꿀 때마다 전부 다시 그려야 하지만, 스크립트는
상단의 파라미터 표만 고치면 된다. 캐릭터처럼 형태가 중요한 그림에는 맞지 않는 방식이다.

## 실행

```bash
ASE="C:/Program Files (x86)/Steam/steamapps/common/Aseprite/Aseprite.exe"

"$ASE" -b --script-param out="$(pwd)/assets/sprites/fx/fx_shot.aseprite"   --script assets/_generators/fx_shot.lua
"$ASE" -b --script-param out="$(pwd)/assets/sprites/fx/fx_swing.aseprite"  --script assets/_generators/fx_swing.lua
"$ASE" -b --script-param out="$(pwd)/assets/sprites/fx/fx_bullet.aseprite" --script assets/_generators/fx_bullet.lua

# 그 다음 아틀라스 리빌드
pnpm build:atlas
```

`out` 경로는 **절대경로**여야 한다. Aseprite CLI의 작업 디렉터리가 스크립트 위치와 다르다.

## 확인

`preview.lua`는 프레임을 가로로 이어붙이고 밤 배경색을 깔아 확대 저장한다.
투명 배경 그대로 보면 밝은 이펙트가 흰 바탕에 묻혀서 판단이 안 된다.

```bash
"$ASE" -b \
  --script-param src="$(pwd)/assets/sprites/fx/fx_swing.aseprite" \
  --script-param out="$(pwd)/preview.png" \
  --script-param scale=3 \
  --script assets/_generators/preview.lua
```

## 규약

- **좌표계**: 방향이 있는 이펙트는 전부 **+x가 진행 방향**이다. 렌더러가 조준각만큼 회전시킨다.
- **태그 필수**: 태그가 없으면 아틀라스 프레임 이름이 `{파일명}__0`(밑줄 2개)이 된다.
- **색 수 제한**: 4색 안팎으로 유지한다. 그라데이션을 늘리면 픽셀아트로 안 읽히고 뿌옇게 뭉갠다.
