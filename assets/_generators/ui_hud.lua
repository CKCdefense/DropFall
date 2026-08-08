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
--   hud_bar_back_l  48x24  큰 바 틀(내 체력/스태미나, QuickSlotBar BAR_HEIGHT=24)
--   hud_bar_fill_l   6x20  큰 바 채움 (2px 인셋)
--   hud_bar_back_s  48x8   작은 바 틀(코어/보스 바, CORE·BOSS_BAR_HEIGHT=8)
--   hud_bar_fill_s   6x4   작은 바 채움
--   hud_bar_back_boss 64x18  보스전 전용 대형 바 틀(화면 중앙 상단) — 양끝 강철
--                            캡 + 크림슨 젬, 바닥 안쪽 크림슨 라인으로 위협감
--   hud_bar_fill_boss  6x14  보스 바 채움 (2px 인셋)
--   hud_icon_heart  12x12  체력 라벨
--   hud_icon_bolt   12x12  스태미나 라벨
--   hud_icon_skull  12x12  보스 바 라벨(소형)
--   hud_icon_skull_l 16x16 보스전 대형 바 옆에 붙는 뿔 달린 해골
--   hud_icon_core   12x12  코어 패널 라벨 (core_cell 결정과 같은 청록)
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

--- 보스전 대형 바 틀. 기본 틀 위에 양끝 7px 강철 캡(세로 밴드 + 크림슨 젬)을 얹고,
--- 바닥 안쪽에 크림슨 라인을 깔아 "위험한 바"로 읽히게 한다.
--- 9-slice로 늘일 때 좌우 보존 폭은 **7px**이다 (일반 바의 3px와 다름).
local CRIMSON      = Color{ r = 0xD9, g = 0x75, b = 0x6B } -- DOWN_COLOR
local CRIMSON_DARK = Color{ r = 0x7A, g = 0x2A, b = 0x28 }
local CRIMSON_DEEP = Color{ r = 0x4A, g = 0x12, b = 0x18 }
local STEEL_HI     = Color{ r = 0x6A, g = 0x73, b = 0x82 }
local WHITE_GEM    = Color{ r = 0xF2, g = 0xF5, b = 0xFA }

local function barBackBoss(img, w, h)
  barBack(img, w, h)
  -- 바닥 안쪽 크림슨 라인 — 트랙에 살짝 배어나는 핏빛
  rect(img, 2, h - 3, w - 3, h - 3, CRIMSON_DEEP)
  -- 양끝 강철 캡 (좌우 대칭)
  for _, side in ipairs({ 0, 1 }) do
    local function X(x) return side == 0 and x or (w - 1 - x) end
    for y = 1, h - 2 do
      img:drawPixel(X(1), y, STROKE)
      img:drawPixel(X(2), y, y <= 2 and STEEL_HI or STROKE)   -- 윗부분 하이라이트
      img:drawPixel(X(3), y, y == 1 and STEEL_HI or TRACK_DIM)
      img:drawPixel(X(4), y, OUTLINE)                         -- 캡과 트랙의 경계선
    end
    img:drawPixel(X(1), 1, OUTLINE)
    img:drawPixel(X(1), h - 2, OUTLINE)
    -- 크림슨 젬 (캡 세로 중앙 2x4)
    local gy = math.floor(h / 2) - 2
    for i = 0, 3 do
      local c = (i == 0) and CRIMSON or ((i == 3) and CRIMSON_DARK or CRIMSON)
      img:drawPixel(X(2), gy + i, c)
      img:drawPixel(X(3), gy + i, (i == 0) and WHITE_GEM or CRIMSON_DARK)
    end
  end
end

-- ---------------------------------------------------------------- 아이콘 12x12
-- 슬롯 없이 지형/패널 위에 바로 얹히므로 전부 1px 외곽선을 두른다.
-- 색은 게임 안 기존 기호와 짝: 체력=DOWN_COLOR 계열 빨강, 코어=core_cell 청록.

local function fromMask(img, mask, colors)
  for y, row in ipairs(mask) do
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

local function iconCore(img)
  fromMask(img, {
    '............',
    '.....oo.....',
    '....ohco....',
    '...ohccco...',
    '..ohccccdo..',
    '.ohccccccdo.',
    '.occcccccdo.',
    '..occcccdo..',
    '...occcdo...',
    '....ocdo....',
    '.....oo.....',
    '............',
  }, { o = OUTLINE, c = CYAN, d = CYAN_DARK, h = WHITE })
end

-- ---------------------------------------------------------------- 생성

save('hud_bar_back_l', 48, 24, barBack)
save('hud_bar_back_s', 48, 8, barBack)
save('hud_bar_back_boss', 64, 18, barBackBoss)
save('hud_bar_fill_l', 6, 20, function(img) barFill(img, 6, 20) end)
save('hud_bar_fill_s', 6, 4, function(img) barFill(img, 6, 4) end)
save('hud_bar_fill_boss', 6, 14, function(img) barFill(img, 6, 14) end)
save('hud_icon_heart', 12, 12, function(img) iconHeart(img) end)
save('hud_icon_bolt', 12, 12, function(img) iconBolt(img) end)
save('hud_icon_skull', 12, 12, function(img) iconSkull(img) end)
save('hud_icon_skull_l', 16, 16, function(img) iconSkullL(img) end)
save('hud_icon_core', 12, 12, function(img) iconCore(img) end)
