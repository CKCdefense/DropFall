-- 상호작용 키 안내. 16x26, 1프레임, 배경 투명. 태그 'e'.
--
-- 하얀 키캡에 'E'를 얹고, 그 아래 작은 아래 화살표를 붙인다. 화살표가 "이 아래 있는
-- 것"을 가리키므로, 렌더러는 대상(코어) **위**에 이 그림을 띄우기만 하면 된다.
--
-- 좌표 규약: **캔버스 아래 끝이 화살표 끝**이다. 대상 위 어디에 띄우든 화살표 끝이
-- 대상을 가리키게 하려면 이 그림의 원점을 아래쪽(0.5, 1)에 두면 된다.
--
-- 글자를 그림으로 그리는 이유는, 폰트로 찍으면 픽셀 격자에 안 맞아 한 픽셀씩 흐려지기
-- 때문이다. 키캡은 게임 안에서 항상 같은 크기로 뜨므로 5x7 비트맵 하나면 충분하다.

local W, H = 16, 26
local KEY_X0, KEY_X1 = 1, 14
local KEY_Y0, KEY_Y1 = 0, 15

local WHITE = Color{ r = 0xFF, g = 0xFF, b = 0xFF }
local SHADE = Color{ r = 0xC2, g = 0xC7, b = 0xD0 }
local LINE = Color{ r = 0x1A, g = 0x1C, b = 0x22 }

local function put(image, x, y, color)
  if x < 0 or x >= W or y < 0 or y >= H then return end
  image:drawPixel(x, y, color)
end

local function fillRect(image, x0, y0, x1, y1, color)
  for y = y0, y1 do
    for x = x0, x1 do put(image, x, y, color) end
  end
end

--- 키캡: 흰 면 + 아래쪽 두 줄 그림자 + 검은 테두리. 두께가 있어야 '눌리는 것'으로 읽힌다.
local function keycap(image)
  fillRect(image, KEY_X0, KEY_Y0, KEY_X1, KEY_Y1, WHITE)
  -- 아래 두 줄은 옆면(그림자)이다.
  fillRect(image, KEY_X0, KEY_Y1 - 2, KEY_X1, KEY_Y1, SHADE)

  -- 테두리. 모서리 한 픽셀씩은 깎아 둥글게 보이게 한다.
  for x = KEY_X0, KEY_X1 do
    put(image, x, KEY_Y0, LINE)
    put(image, x, KEY_Y1, LINE)
  end
  for y = KEY_Y0, KEY_Y1 do
    put(image, KEY_X0, y, LINE)
    put(image, KEY_X1, y, LINE)
  end
  for _, corner in ipairs({
    { KEY_X0, KEY_Y0 }, { KEY_X1, KEY_Y0 }, { KEY_X0, KEY_Y1 }, { KEY_X1, KEY_Y1 },
  }) do
    image:drawPixel(corner[1], corner[2], Color{ r = 0, g = 0, b = 0, a = 0 })
  end
end

--- 'E' 5x7 비트맵. 키캡 가운데(옆면 두 줄은 빼고)에 놓는다.
local E_GLYPH = {
  '11111',
  '10000',
  '10000',
  '11110',
  '10000',
  '10000',
  '11111',
}

local function glyph(image)
  local x0 = KEY_X0 + 5
  local y0 = KEY_Y0 + 4
  for row = 1, #E_GLYPH do
    local line = E_GLYPH[row]
    for col = 1, #line do
      if line:sub(col, col) == '1' then put(image, x0 + col - 1, y0 + row - 1, LINE) end
    end
  end
end

--- 아래 화살표. 키캡과 한 픽셀 띄워 붙인다 — 붙여 놓으면 키의 일부처럼 보인다.
local function arrow(image)
  local top = KEY_Y1 + 3
  for row = 0, 4 do
    local half = 4 - row
    for x = -half, half do
      -- 가장자리는 어둡게 눌러 흰 배경 위에서도 형태가 산다.
      local color = (x == -half or x == half or row == 4) and LINE or WHITE
      put(image, 7 + x, top + row, color)
    end
  end
end

local sprite = Sprite(W, H, ColorMode.RGB)
local image = Image(W, H, ColorMode.RGB)
keycap(image)
glyph(image)
arrow(image)
sprite:newCel(sprite.layers[1], 1, image, Point(0, 0))

local tag = sprite:newTag(1, 1)
tag.name = 'e'

sprite:saveAs(app.params['out'])
print('saved: ' .. app.params['out'])
