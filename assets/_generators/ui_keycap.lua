-- 조작법 안내(가이드 창)에 쓰는 **빈 키캡**. 글자는 얹지 않는다.
--
--   hud_keycap  24x20  가운데를 늘려 쓰는 9-slice 키캡 (보존 폭 좌우/상하 7px)
--
-- ## 왜 글자를 안 그리나
--
-- 코어 위에 뜨는 `ui_keyprompt`는 'E'를 5x7 비트맵으로 직접 찍는다. 그건 월드에
-- 그려져서 카메라 줌이 곱해지는 바람에 폰트가 픽셀 격자에서 밀리기 때문이다.
-- 가이드 창은 HUD(줌 1)에 그려지고 갈무리는 설계 크기의 정수배에서 선명하므로,
-- 글자는 폰트로 얹는 편이 낫다 — 키가 늘 때마다 비트맵을 새로 찍을 이유가 없다.
--
-- 그래서 이 그림은 **빈 키캡 하나**뿐이고, 'W'든 'SPACE'든 폭만 늘려서 쓴다.
-- 가운데 열이 전부 같아야 늘여도 무늬가 안 깨진다(hudBar의 막대 틀과 같은 규칙).
--
-- 실행 (저장소 루트에서 — outdir는 절대경로):
--   "$ASE" -b --script-param outdir="$(pwd)/assets/ui/hud" --script assets/_generators/ui_keycap.lua
--   pnpm build:atlas

local outdir = app.params['outdir']
assert(outdir, '--script-param outdir=<assets/ui/hud 절대경로> 필요')

-- 키캡은 어두운 판 위에 얹히므로 밝은 회색 계열이다. theme.ts 팔레트와 같은 계열을 쓴다.
local OUTLINE = Color{ r = 0x0B, g = 0x0D, b = 0x12 } -- SHADOW
local FACE    = Color{ r = 0xD6, g = 0xDC, b = 0xE6 } -- 눌리는 윗면
local FACE_HI = Color{ r = 0xF2, g = 0xF5, b = 0xFA } -- 윗면 하이라이트
local SIDE    = Color{ r = 0x8A, g = 0x92, b = 0xA2 } -- 옆면(두께)
local SIDE_LO = Color{ r = 0x5E, g = 0x66, b = 0x76 } -- 옆면 아래

local function rect(img, x0, y0, x1, y1, c)
  for y = y0, y1 do
    for x = x0, x1 do img:drawPixel(x, y, c) end
  end
end

--- 키캡 한 장. 위 3/4는 윗면, 아래 1/4는 옆면 — 두께가 있어야 "눌리는 것"으로 읽힌다.
--- 모서리 1px은 깎아서 둥근 픽셀 코너를 만든다(hudBar의 막대 틀과 같은 규칙).
local function keycap(img, w, h)
  local sideTop = h - 5 -- 옆면이 시작하는 줄

  rect(img, 0, 0, w - 1, h - 1, OUTLINE)
  rect(img, 1, 1, w - 2, h - 2, FACE)
  rect(img, 1, 1, w - 2, 1, FACE_HI)          -- 윗줄 하이라이트
  rect(img, 1, sideTop, w - 2, h - 2, SIDE)   -- 옆면
  rect(img, 1, h - 2, w - 2, h - 2, SIDE_LO)  -- 옆면 바닥
  rect(img, 1, sideTop - 1, w - 2, sideTop - 1, SIDE_LO) -- 윗면과 옆면의 경계선

  -- 둥근 픽셀 코너
  local clear = app.pixelColor.rgba(0, 0, 0, 0)
  for _, p in ipairs({ { 0, 0 }, { w - 1, 0 }, { 0, h - 1 }, { w - 1, h - 1 } }) do
    img:drawPixel(p[1], p[2], clear)
  end
  img:drawPixel(1, 1, OUTLINE)
  img:drawPixel(w - 2, 1, OUTLINE)
  img:drawPixel(1, h - 2, OUTLINE)
  img:drawPixel(w - 2, h - 2, OUTLINE)
end

local W, H = 24, 20
local spr = Sprite(W, H, ColorMode.RGB)
local img = Image(W, H, ColorMode.RGB)
img:clear(app.pixelColor.rgba(0, 0, 0, 0))
keycap(img, W, H)
spr:newCel(spr.layers[1], 1, img, Point(0, 0))
local tag = spr:newTag(1, 1)
tag.name = 'base'
spr:saveAs(outdir .. '/hud_keycap.aseprite')
spr:close()
print('saved: hud_keycap')
