-- 인게임 HUD 스프라이트 — 체력/코어/보스 바 + 라벨용 미니 아이콘.
--
-- 바는 코드가 임의 폭으로 늘여 쓰므로 9-slice를 전제로 그린다:
--   모서리 3px는 보존 영역, 가운데 세로줄은 가로로 반복해도 무늬가 안 깨지게
--   **모든 열을 동일하게** 그린다 (좌우 끝 3px 제외).
-- 채움(fill)은 흰색 기반 세로 그라데이션이다 — 코드에서 setTint로 물들인다
-- (theme.ts의 BAR_OK/BAR_DANGER 등). 흰색에 곱셈이라 음영이 그대로 살아있다.
--
-- 픽셀 UI 문법(웹 레퍼런스 공통 규칙):
--   1px 최암색 외곽선 → 안쪽 윗줄은 인너 섀도우(파인 홈), 아랫줄은 밝은 모서리
--   → 트랙은 패널보다 어둡게. 채움은 윗줄 하이라이트 + 아랫줄 셰이드로 볼록하게.
--   모서리 1px은 깎아서(투명) 둥근 픽셀 코너를 만든다.
--
-- 색은 theme.ts의 HUD 팔레트를 그대로 쓴다 — PANEL_FILL/PANEL_STROKE/BAR_BACK/SHADOW.
--
-- 산출물 (ui/hud/ → ui 아틀라스, 태그는 base 하나):
-- 크기는 **원본 픽셀**이다. 게임은 이걸 hudBar.HUD_BAR_SCALE(2배)로 확대해 그린다 —
-- 1배로 그리면 외곽선·홈이 1px이라 월드(줌 2~4배)와 픽셀 굵기가 안 맞는다.
--   hud_bar_back_l  48x16  큰 바 틀(내 체력/스태미나) → 화면 32px
--   hud_bar_fill_l   6x12  큰 바 채움 (2px 인셋)
--   hud_bar_back_s  48x8   작은 바 틀(코어/경험치/팀원) → 화면 16px
--   hud_bar_fill_s   6x4   작은 바 채움
--   hud_bar_back_boss 64x20  보스전 전용 대형 바 틀(화면 중앙 상단) — 양끝 8px 강철
--                            브래킷(리벳 + 크림슨 젬), 바닥 안쪽 크림슨 라인
--   hud_bar_fill_boss  6x16  보스 바 채움 (가로 10px / 세로 2px 인셋)
--   hud_icon_heart  12x12  체력 라벨
--   hud_icon_bolt   12x12  스태미나 라벨
--   hud_icon_skull  12x12  보스 바 라벨(소형)
--   hud_icon_skull_l 16x16 보스전 대형 바 옆에 붙는 뿔 달린 해골
--   hud_icon_orb    12x12  코어 패널 — 코어 표식(돌 받침 위 청록 발광체)
--   hud_icon_resource 12x12 코어 패널 — 자원 표식(주황 광석 덩이)
--   hud_icon_energy 12x12  코어 패널 — 에너지 표식(세로로 긴 보라 전지)
--   hud_icon_check_off/on 12x12  낮 스킵 투표 칸(빈 홈 / 초록 체크)
--
-- 실행 (저장소 루트에서 — outdir는 절대경로):
--   "$ASE" -b --script-param outdir="$(pwd)/assets/ui/hud" --script assets/_generators/ui_hud.lua
--   pnpm build:atlas

local outdir = app.params['outdir']
assert(outdir, '--script-param outdir=<assets/ui/hud 절대경로> 필요')

-- theme.ts HUD 팔레트
local OUTLINE   = Color{ r = 0x0B, g = 0x0D, b = 0x12 } -- SHADOW
local STROKE    = Color{ r = 0x4A, g = 0x52, b = 0x62 } -- PANEL_STROKE
local TRACK     = Color{ r = 0x2B, g = 0x30, b = 0x3C } -- BAR_BACK
local TRACK_DIM = Color{ r = 0x20, g = 0x25, b = 0x2F } -- 트랙 인너 섀도우(윗줄)
local PANEL     = Color{ r = 0x14, g = 0x16, b = 0x1D } -- PANEL_FILL

local function gray(v) return Color{ r = v, g = v, b = v } end

local function rect(img, x0, y0, x1, y1, c)
  for y = y0, y1 do
    for x = x0, x1 do img:drawPixel(x, y, c) end
  end
end

--- 단일 프레임 스프라이트를 저장한다. 파일명이 프레임 접두사가 된다.
local function save(name, w, h, drawFn)
  local spr = Sprite(w, h, ColorMode.RGB)
  local img = Image(w, h, ColorMode.RGB)
  drawFn(img, w, h)
  spr:newCel(spr.layers[1], 1, img, Point(0, 0))
  local tag = spr:newTag(1, 1)
  tag.name = 'base'
  spr:saveAs(outdir .. '/' .. name .. '.aseprite')
  spr:close()
  print('saved: ' .. name)
end

--- 바 틀. 외곽선 → 베벨 → 트랙, 모서리 1px 깎음. 모든 안쪽 열이 동일해서
--- 9-slice(좌우 3px 보존)로 늘여도 무늬가 유지된다.
local function barBack(img, w, h)
  rect(img, 0, 0, w - 1, h - 1, OUTLINE)
  rect(img, 1, 1, w - 2, h - 2, TRACK)
  rect(img, 1, 1, w - 2, 1, TRACK_DIM)          -- 인너 섀도우: 파인 홈 느낌
  rect(img, 1, h - 2, w - 2, h - 2, PANEL)      -- 바닥 안쪽: 한 톤 더 어둡게 가라앉힘
  -- 좌우 안쪽 세로줄은 스트로크 색 — 패널 테두리(PANEL_STROKE)와 이어져 보인다
  rect(img, 1, 2, 1, h - 3, STROKE)
  rect(img, w - 2, 2, w - 2, h - 3, STROKE)
  -- 둥근 픽셀 코너: 꼭짓점을 투명하게 깎고 대각을 외곽선으로 채움
  local a = app.pixelColor.rgba(0, 0, 0, 0)
  for _, p in ipairs({ { 0, 0 }, { w - 1, 0 }, { 0, h - 1 }, { w - 1, h - 1 } }) do
    img:drawPixel(p[1], p[2], a)
  end
  img:drawPixel(1, 1, OUTLINE)
  img:drawPixel(w - 2, 1, OUTLINE)
  img:drawPixel(1, h - 2, OUTLINE)
  img:drawPixel(w - 2, h - 2, OUTLINE)
end

--- 바 채움. 흰색 세로 그라데이션(위 하이라이트 → 아래 셰이드) — setTint용.
--- 열마다 동일해서 가로로 늘이거나 잘라도 무늬가 안 깨진다.
local function barFill(img, w, h)
  for y = 0, h - 1 do
    local t = y / math.max(1, h - 1)
    local v
    if y == 0 then v = 255                       -- 윗줄 하이라이트
    elseif y == h - 1 then v = 132               -- 아랫줄 셰이드
    else v = math.floor(232 - t * 82) end        -- 사이는 완만한 경사
    rect(img, 0, y, w - 1, y, gray(v))
  end
end

--- 보스전 대형 바 틀.
---
--- 화면 폭의 40% 넘게 늘여 쓰는 물건이라 **끝을 확실히 마감해야** 한다 — 예전 4px
--- 캡은 760px로 늘리자 양끝의 점 두 개로만 보였다. 그래서 캡을 8px 강철 브래킷으로
--- 키우고 리벳·젬을 넣어, 멀리서도 "가운데가 늘어난 금속 틀"로 읽히게 했다.
---
--- 가운데(캡 사이)는 **모든 열이 같아야** 한다 — Phaser NineSlice는 가운데를 타일이
--- 아니라 **늘여서** 채우기 때문에, 주기적인 눈금 같은 걸 넣으면 뭉개진다.
--- 9-slice 보존 폭은 좌우 **10px**이다(일반 바의 3px와 다름 — hudBar.BAR_BOSS).
local CRIMSON      = Color{ r = 0xD9, g = 0x75, b = 0x6B } -- DOWN_COLOR
local CRIMSON_DARK = Color{ r = 0x7A, g = 0x2A, b = 0x28 }
local CRIMSON_DEEP = Color{ r = 0x4A, g = 0x12, b = 0x18 }
local STEEL_HI     = Color{ r = 0x7C, g = 0x86, b = 0x96 }
local STEEL_LO     = Color{ r = 0x30, g = 0x36, b = 0x42 }
local WHITE_GEM    = Color{ r = 0xF2, g = 0xF5, b = 0xFA }

-- 캡 몸통 폭(x=1..CAP). x=CAP+1이 트랙과의 경계선이라, 채움은 x=CAP+2부터 시작한다
-- (hudBar.BAR_BOSS.insetX와 반드시 같아야 한다).
local CAP = 8

local function barBackBoss(img, w, h)
  barBack(img, w, h)
  -- 바닥 안쪽 크림슨 라인 — 트랙에 배어나는 핏빛. 체력이 닳은 쪽에서만 드러난다.
  rect(img, 2, h - 3, w - 3, h - 3, CRIMSON_DEEP)

  for _, side in ipairs({ 0, 1 }) do
    local function X(x) return side == 0 and x or (w - 1 - x) end

    -- 강철 브래킷: 위가 밝고 아래로 갈수록 어두운 단순한 3단 명암.
    -- 단이 많으면 3~4배로 확대했을 때 줄무늬로 보인다.
    for y = 1, h - 2 do
      local c = STROKE
      if y <= 2 then c = STEEL_HI
      elseif y >= h - 3 then c = STEEL_LO end
      for x = 1, CAP do img:drawPixel(X(x), y, c) end
      img:drawPixel(X(CAP + 1), y, OUTLINE) -- 캡과 트랙의 경계
    end
    -- 바깥 모서리를 깎아 브래킷도 둥글게 — 틀 전체와 같은 모서리 규칙
    img:drawPixel(X(1), 1, OUTLINE)
    img:drawPixel(X(1), h - 2, OUTLINE)

    -- 리벳 둘(위·아래). 금속판이라는 걸 알려주는 최소한의 장치.
    for _, ry in ipairs({ 3, h - 4 }) do
      img:drawPixel(X(2), ry, STEEL_LO)
      img:drawPixel(X(3), ry, OUTLINE)
    end

    -- 크림슨 젬 — 캡 세로 중앙. 하이라이트 1px로 유리처럼 보이게 한다.
    local gy = math.floor(h / 2) - 3
    for i = 0, 5 do
      local edge = i == 0 or i == 5
      img:drawPixel(X(5), gy + i, edge and CRIMSON_DARK or CRIMSON)
      img:drawPixel(X(6), gy + i, CRIMSON_DARK)
    end
    img:drawPixel(X(5), gy + 1, WHITE_GEM)
  end
end

-- ---------------------------------------------------------------- 아이콘 12x12
-- 슬롯 없이 지형/패널 위에 바로 얹히므로 전부 1px 외곽선을 두른다.
-- 색은 게임 안 기존 기호와 짝: 체력=DOWN_COLOR 계열 빨강, 코어=core_cell 청록.

--- 문자 격자로 아이콘을 찍는다. 줄 길이가 하나라도 어긋나면 그림이 조용히 밀리므로
--- **여기서 바로 잡아 세운다** — 12줄 × 12칸을 눈으로 세는 건 사람이 할 일이 아니다.
local function fromMask(img, mask, colors)
  assert(#mask == img.height, ('mask 줄 수 %d ~= 그림 높이 %d'):format(#mask, img.height))
  for y, row in ipairs(mask) do
    assert(#row == img.width, ('mask %d번째 줄 길이 %d ~= 그림 폭 %d'):format(y, #row, img.width))
    for x = 1, #row do
      local ch = row:sub(x, x)
      local c = colors[ch]
      if c then img:drawPixel(x - 1, y - 1, c) end
    end
  end
end

local RED       = Color{ r = 0xD9, g = 0x75, b = 0x6B } -- DOWN_COLOR
local RED_DARK  = Color{ r = 0xA8, g = 0x4A, b = 0x45 }
local GOLD      = Color{ r = 0xE8, g = 0xC0, b = 0x5A }
local GOLD_DARK = Color{ r = 0xB0, g = 0x83, b = 0x28 }
local BONE      = Color{ r = 0xE6, g = 0xE2, b = 0xD8 }
local BONE_DARK = Color{ r = 0xB5, g = 0xAF, b = 0xA0 }
local CYAN      = Color{ r = 0x5A, g = 0xD6, b = 0xC8 }
local CYAN_DARK = Color{ r = 0x2E, g = 0x8F, b = 0x88 }
local WHITE     = Color{ r = 0xF2, g = 0xF5, b = 0xFA }

local function iconHeart(img)
  fromMask(img, {
    '............',
    '..ooo..ooo..',
    '.ohhrooorro.',
    '.ohrrrrrrro.',
    '.orrrrrrrro.',
    '.orrrrrrrdo.',
    '..orrrrrdo..',
    '...orrrdo...',
    '....ordo....',
    '.....oo.....',
    '............',
    '............',
  }, { o = OUTLINE, r = RED, d = RED_DARK, h = WHITE })
end

local function iconBolt(img)
  fromMask(img, {
    '............',
    '....oooo....',
    '...ohhgo....',
    '...ohgo.....',
    '..oohggooo..',
    '..oggggggo..',
    '...ooooggo..',
    '......oggo..',
    '.....ogdo...',
    '.....ogo....',
    '......o.....',
    '............',
  }, { o = OUTLINE, g = GOLD, d = GOLD_DARK, h = WHITE })
end

local function iconSkull(img)
  fromMask(img, {
    '............',
    '...oooooo...',
    '..obbbbbbo..',
    '.obbbbbbbbo.',
    '.oboobboobo.',
    '.oboobboobo.',
    '.obbbbbbbbo.',
    '..obdbbdbo..',
    '..obbbbbbo..',
    '...odbdbo...',
    '....oooo....',
    '............',
  }, { o = OUTLINE, b = BONE, d = BONE_DARK })
end

--- 보스전 대형 해골 16x16 — 위로 굽은 뿔 + 붉게 빛나는 눈구멍.
--- 소형 skull과 실루엣 계열은 같게(같은 기호로 읽히게), 디테일만 올린다.
local function iconSkullL(img)
  fromMask(img, {
    '.oo..........oo.',
    'obho........ohbo',
    'obbo........obbo',
    '.obboooooooobbo.',
    '.obbbbbbbbbbbbo.',
    '..obbbbbbbbbbo..',
    '..obeebbbbeebo..',
    '..obeebbbbeebo..',
    '..obbbbddbbbbo..',
    '..obbbbbbbbbbo..',
    '...oobbbbbboo...',
    '....odbdbdbo....',
    '....oooooooo....',
    '................',
    '................',
    '................',
  }, { o = OUTLINE, b = BONE, d = BONE_DARK, e = CRIMSON_DARK, h = WHITE })
  -- 눈구멍 안쪽 글로우 — 소켓 바깥쪽 위 픽셀만 한 톤 밝게
  img:drawPixel(4, 6, CRIMSON)
  img:drawPixel(11, 6, CRIMSON)
end

-- 코어 패널의 게이지 세 줄에 붙는 표식. 색이 아니라 **실루엣**으로 먼저 구분되게 그린다
-- (items_consumable.lua와 같은 원칙) — 12px에서는 색보다 형태가 먼저 읽힌다.
--   원 = 코어 / 불규칙한 덩이 = 자원 / 세로 직사각형 = 에너지 — 실루엣이 서로 다르다

-- 코어: 인게임 오브젝트를 그대로 옮긴 색이다 — 돌 받침 위에 얹힌 창백한 청록 발광체.
local ORB_CORE   = Color{ r = 0xEF, g = 0xF9, b = 0xF9 } -- 한가운데 흰 빛
local ORB_RIM    = Color{ r = 0xA9, g = 0xD9, b = 0xD4 } -- 바깥 청록
local BASE       = Color{ r = 0x8A, g = 0x8F, b = 0x98 } -- 돌 받침
local BASE_DARK  = Color{ r = 0x5E, g = 0x63, b = 0x6C }
-- 자원: 주황 광석 덩이
local ORE        = Color{ r = 0xE8, g = 0x8B, b = 0x30 }
local ORE_HI     = Color{ r = 0xFF, g = 0xC0, b = 0x6A }
local ORE_DARK   = Color{ r = 0x9C, g = 0x51, b = 0x16 }
-- 에너지: 보라 전지
local ENERGY     = Color{ r = 0xA4, g = 0x5C, b = 0xE8 }
local ENERGY_HI  = Color{ r = 0xE0, g = 0xC4, b = 0xFF }
local ENERGY_DK  = Color{ r = 0x5E, g = 0x28, b = 0x96 }

--- 코어. 인게임 오브젝트를 그대로 옮겼다 — **돌 받침 위에 얹힌 창백한 청록 발광체**.
--- 가운데로 갈수록 하얘지는 건 스스로 빛나는 물체라는 뜻이고(보통 구체는 광원 반대쪽이
--- 어둡다), 받침이 있어야 "굴러다니는 구슬"이 아니라 세워 둔 장치로 읽힌다.
--- 셋 중 유일하게 **원형**이라 실루엣만으로 첫 줄이 코어라는 게 잡힌다.
local function iconCoreOrb(img)
  fromMask(img, {
    '............',
    '...oooooo...',
    '..occwwcco..',
    '.occwwwwcco.',
    '.ocwwwwwwco.',
    '.ocwwwwwwco.',
    '.occwwwwcco.',
    '..occwwcco..',
    '...oooooo...',
    '..osssssso..',
    '.osssddssso.',
    '.oooooooooo.',
  }, { o = OUTLINE, c = ORB_RIM, w = ORB_CORE, s = BASE, d = BASE_DARK })
end

--- 자원. 주황 광석 덩이 — 좌우 비대칭에 면이 몇 개 꺾여 있어 "캐낸 원석"으로 읽힌다.
--- 궤짝(반듯한 네모)은 코어 패널의 다른 네모난 것들과 섞였고, 무엇보다 이 게이지가
--- 세는 건 상자가 아니라 **재료 자체**다.
local function iconResource(img)
  fromMask(img, {
    '............',
    '......oo....',
    '....oohhoo..',
    '..oohrrrrho.',
    '.ohhrrrrrro.',
    'ohrrrrrrrrdo',
    'ohrrrrrrrrdo',
    '.orrrrrrrdo.',
    '..orrrrrddo.',
    '...oorrddo..',
    '.....oodo...',
    '............',
  }, { o = OUTLINE, r = ORE, h = ORE_HI, d = ORE_DARK })
end

--- 낮 스킵 투표 칸. 눌리지 않은 칸은 **파인 홈**처럼 보이게 한다(위 그림자, 아래 밝은
--- 모서리) — 게이지 트랙과 같은 문법이라 "아직 안 채워진 자리"로 읽힌다.
--- 체크는 게임 안 확인색(theme.ts ACCENT)이라 "동의했다"가 바로 잡힌다.
local BOX_DIM  = Color{ r = 0x12, g = 0x14, b = 0x1B }
local BOX_FILL = Color{ r = 0x20, g = 0x25, b = 0x2F }
local BOX_EDGE = Color{ r = 0x3A, g = 0x40, b = 0x4E }
local CHECK    = Color{ r = 0x6F, g = 0xD0, b = 0x8C } -- ACCENT

local function iconCheckOff(img)
  fromMask(img, {
    '............',
    '.oooooooooo.',
    '.odddddddeo.',
    '.odbbbbbbeo.',
    '.odbbbbbbeo.',
    '.odbbbbbbeo.',
    '.odbbbbbbeo.',
    '.odbbbbbbeo.',
    '.odbbbbbbeo.',
    '.oeeeeeeeeo.',
    '.oooooooooo.',
    '............',
  }, { o = OUTLINE, d = BOX_DIM, b = BOX_FILL, e = BOX_EDGE })
end

local function iconCheckOn(img)
  fromMask(img, {
    '............',
    '.oooooooooo.',
    '.odddddddeo.',
    '.odbbbbbbeo.',
    '.odbbbbbgeo.',
    '.odgbbbggeo.',
    '.odggbggbeo.',
    '.odbgggbbeo.',
    '.odbbbbbbeo.',
    '.oeeeeeeeeo.',
    '.oooooooooo.',
    '............',
  }, { o = OUTLINE, d = BOX_DIM, b = BOX_FILL, e = BOX_EDGE, g = CHECK })
end

--- 에너지. 꼭지 달린 **세로로 긴 보라 전지**. 앞의 마름모 번개는 자원 아이콘이 원석으로
--- 바뀌면서 둘 다 각진 덩어리가 되어 헷갈렸다 — 세로로 긴 직사각형은 원(코어)·불규칙한
--- 덩이(자원)와 겹칠 일이 없다.
local function iconEnergy(img)
  fromMask(img, {
    '....oooo....',
    '....oppo....',
    '..oooooooo..',
    '..ohhppppo..',
    '..ohpppppo..',
    '..oppppppo..',
    '..oppppppo..',
    '..oppppppo..',
    '..oppppppo..',
    '..opdddddo..',
    '..oooooooo..',
    '............',
  }, { o = OUTLINE, p = ENERGY, h = ENERGY_HI, d = ENERGY_DK })
end


-- ---------------------------------------------------------------- 생성

save('hud_bar_back_l', 48, 16, barBack)
save('hud_bar_back_s', 48, 8, barBack)
save('hud_bar_back_boss', 64, 20, barBackBoss)
save('hud_bar_fill_l', 6, 12, function(img) barFill(img, 6, 12) end)
save('hud_bar_fill_s', 6, 4, function(img) barFill(img, 6, 4) end)
save('hud_bar_fill_boss', 6, 16, function(img) barFill(img, 6, 16) end)
save('hud_icon_heart', 12, 12, function(img) iconHeart(img) end)
save('hud_icon_bolt', 12, 12, function(img) iconBolt(img) end)
save('hud_icon_skull', 12, 12, function(img) iconSkull(img) end)
save('hud_icon_skull_l', 16, 16, function(img) iconSkullL(img) end)
save('hud_icon_orb', 12, 12, function(img) iconCoreOrb(img) end)
save('hud_icon_resource', 12, 12, function(img) iconResource(img) end)
save('hud_icon_energy', 12, 12, function(img) iconEnergy(img) end)
save('hud_icon_check_off', 12, 12, function(img) iconCheckOff(img) end)
save('hud_icon_check_on', 12, 12, function(img) iconCheckOn(img) end)
