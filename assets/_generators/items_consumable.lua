-- 소모품 아이콘. 32x32, 태그 1개당 1프레임, 배경 투명.
--   bandage    : 붕대 — 감긴 천 두루마리
--   medkit     : 구급킷 — 흰 상자에 붉은 십자
--   stimpack   : 응급주사 — 주사기
--   repair_kit : 수리키트 — 렌치와 볼트
--   core_cell  : 코어셀 — 청록 결정이 든 캡슐
--   energy_cell: 에너지셀 — 황금 결정이 든 캡슐
--
-- 좌표 규약: 아이템 아이콘은 방향이 없다. 캔버스 가운데에 그리고 회전시키지 않는다.
-- 슬롯이 32~48px이라 **실루엣이 곧 식별 정보**다 — 색보다 형태를 먼저 다르게 잡는다.

local S = 32
local FRAMES = { 'bandage', 'medkit', 'stimpack', 'repair_kit', 'core_cell', 'energy_cell' }

local OUTLINE = Color{ r = 0x1A, g = 0x1C, b = 0x23 }

local CLOTH      = Color{ r = 0xE4, g = 0xE0, b = 0xD2 }
local CLOTH_DARK = Color{ r = 0xC2, g = 0xBC, b = 0xA8 }
local RED        = Color{ r = 0xD2, g = 0x4B, b = 0x4B }
local RED_DARK   = Color{ r = 0x9E, g = 0x33, b = 0x33 }
local WHITE      = Color{ r = 0xF2, g = 0xF5, b = 0xFA }
local GLASS      = Color{ r = 0xBF, g = 0xD8, b = 0xE4 }
local STEEL      = Color{ r = 0x9A, g = 0xA2, b = 0xB0 }
local STEEL_DARK = Color{ r = 0x66, g = 0x6D, b = 0x7A }
local CYAN       = Color{ r = 0x5A, g = 0xD6, b = 0xC8 }
local CYAN_DARK  = Color{ r = 0x2E, g = 0x8F, b = 0x88 }
local GOLD       = Color{ r = 0xF0, g = 0xC0, b = 0x50 }
local GOLD_DARK  = Color{ r = 0xB0, g = 0x83, b = 0x28 }

local function put(image, x, y, color)
  x, y = math.floor(x), math.floor(y)
  if x < 0 or x >= S or y < 0 or y >= S then return end
  image:drawPixel(x, y, color)
end

local function rect(image, x0, y0, x1, y1, color)
  for y = y0, y1 do
    for x = x0, x1 do put(image, x, y, color) end
  end
end

--- 사각형 테두리. 픽셀아트에서 윤곽선이 없으면 배경에 녹아 슬롯 안에서 안 보인다.
local function outline(image, x0, y0, x1, y1)
  for x = x0, x1 do
    put(image, x, y0 - 1, OUTLINE)
    put(image, x, y1 + 1, OUTLINE)
  end
  for y = y0, y1 do
    put(image, x0 - 1, y, OUTLINE)
    put(image, x1 + 1, y, OUTLINE)
  end
end

--- 굵기 1의 직선(브레젠험). 기울어진 형태에 쓴다.
local function line(image, x0, y0, x1, y1, color)
  local dx, dy = math.abs(x1 - x0), math.abs(y1 - y0)
  local sx = x0 < x1 and 1 or -1
  local sy = y0 < y1 and 1 or -1
  local err = dx - dy
  while true do
    put(image, x0, y0, color)
    if x0 == x1 and y0 == y1 then break end
    local e2 = err * 2
    if e2 > -dy then err = err - dy; x0 = x0 + sx end
    if e2 < dx then err = err + dx; y0 = y0 + sy end
  end
end

--- 굵기 있는 대각선. 1px 선은 32px 아이콘을 슬롯 크기로 줄이면 사라진다.
local function thickLine(image, x0, y0, x1, y1, color, width)
  for offset = 0, width - 1 do
    line(image, x0 + offset, y0, x1 + offset, y1, color)
  end
end

--- 붉은 십자. 회복 계열 아이템의 공통 기호다.
local function cross(image, cx, cy, arm, color)
  rect(image, cx - arm, cy - 1, cx + arm, cy + 1, color)
  rect(image, cx - 1, cy - arm, cx + 1, cy + arm, color)
end

--- 결정이 든 캡슐. 코어셀/에너지셀은 내용물 색만 다르다 — 같은 형태를 공유해서
--- "같은 계열의 다른 등급"으로 읽히게 한다.
local function capsule(image, glow, glowDark)
  rect(image, 11, 7, 20, 24, STEEL_DARK)
  rect(image, 12, 8, 19, 23, GLASS)
  outline(image, 11, 7, 20, 24)
  -- 마개(위/아래)
  rect(image, 10, 5, 21, 7, STEEL)
  rect(image, 10, 24, 21, 26, STEEL)
  outline(image, 10, 5, 21, 7)
  outline(image, 10, 24, 21, 26)
  -- 안쪽 결정 — 위아래로 뾰족한 마름모
  for y = 10, 21 do
    local half = 4 - math.floor(math.abs(y - 15.5) / 1.6)
    if half > 0 then
      rect(image, 16 - half, y, 15 + half, y, glow)
      put(image, 16 - half, y, glowDark)
    end
  end
  -- 유리 하이라이트
  for y = 9, 22 do put(image, 13, y, WHITE) end
end

local function draw(image, kind)
  if kind == 'bandage' then
    -- 두루마리를 옆에서 본 모습 + 늘어진 천 끝
    rect(image, 8, 10, 23, 21, CLOTH)
    outline(image, 8, 10, 23, 21)
    for y = 10, 21, 3 do rect(image, 8, y, 23, y, CLOTH_DARK) end
    -- 늘어진 천 끝. 두루마리에 딱 붙여야 "풀린 붕대"로 읽힌다(띄우면 별개 물건이 된다).
    rect(image, 18, 22, 26, 25, CLOTH)
    outline(image, 18, 22, 26, 25)
    rect(image, 18, 21, 23, 22, CLOTH)
    cross(image, 15, 15, 3, RED)
    put(image, 15, 15, RED_DARK)
  elseif kind == 'medkit' then
    -- 손잡이 달린 상자. 붕대보다 크고 각져서 실루엣이 구분된다.
    rect(image, 13, 5, 18, 7, STEEL_DARK)
    rect(image, 6, 8, 25, 25, WHITE)
    outline(image, 6, 8, 25, 25)
    rect(image, 6, 15, 25, 16, CLOTH_DARK)
    cross(image, 15, 16, 5, RED)
    rect(image, 15, 11, 16, 21, RED_DARK)
  elseif kind == 'stimpack' then
    -- 주사기 — 위아래로 긴 실루엣이라 상자류와 절대 안 헷갈린다.
    rect(image, 12, 3, 19, 5, STEEL)      -- 밀대 손잡이
    outline(image, 12, 3, 19, 5)
    rect(image, 14, 5, 17, 8, STEEL_DARK) -- 밀대 축
    rect(image, 11, 8, 20, 22, GLASS)     -- 몸통
    outline(image, 11, 8, 20, 22)
    rect(image, 12, 13, 19, 21, RED)      -- 약물
    rect(image, 12, 13, 19, 13, RED_DARK)
    for y = 9, 21 do put(image, 13, y, WHITE) end
    rect(image, 13, 22, 18, 24, STEEL)    -- 목
    outline(image, 13, 22, 18, 24)
    rect(image, 15, 24, 16, 29, STEEL_DARK) -- 바늘
    put(image, 15, 29, WHITE)
  elseif kind == 'repair_kit' then
    -- 렌치 + 볼트. 회복(붉은 십자) 계열과 형태·색 양쪽으로 갈린다.
    -- 머리는 세로로 길고 입이 깊게 벌어져야 "렌치"로 읽힌다 — 정사각형에 홈만 파면
    -- 가방처럼 보인다.
    thickLine(image, 6, 27, 18, 15, STEEL, 4)
    thickLine(image, 6, 28, 18, 16, STEEL_DARK, 2)
    rect(image, 16, 4, 24, 17, STEEL)
    outline(image, 16, 4, 24, 17)
    rect(image, 18, 3, 22, 11, OUTLINE)   -- 벌어진 입(위로 트임)
    put(image, 17, 4, STEEL_DARK)
    put(image, 23, 4, STEEL_DARK)
    rect(image, 3, 21, 11, 29, GOLD)      -- 볼트
    outline(image, 3, 21, 11, 29)
    rect(image, 5, 23, 9, 27, GOLD_DARK)
  elseif kind == 'core_cell' then
    capsule(image, CYAN, CYAN_DARK)
  elseif kind == 'energy_cell' then
    capsule(image, GOLD, GOLD_DARK)
  end
end

-- ---------------------------------------------------------------- 시트 생성

local sprite = Sprite(S, S, ColorMode.RGB)
local layer = sprite.layers[1]
for _ = 2, #FRAMES do sprite:newEmptyFrame() end

for index, kind in ipairs(FRAMES) do
  local image = Image(S, S, ColorMode.RGB)
  draw(image, kind)
  sprite:newCel(layer, index, image, Point(0, 0))
  local tag = sprite:newTag(index, index)
  tag.name = kind
end

sprite:saveAs(app.params['out'])
print('saved: ' .. app.params['out'])
