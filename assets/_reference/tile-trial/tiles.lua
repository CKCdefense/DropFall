-- 지형 타일셋 생성. 16x16, DropFall 타일 규격.
--
-- 핵심 요구사항은 "이음매 없이 반복되는가"다. 모든 그리기 연산이 좌표를 타일 크기로
-- 나머지 연산(wrap)하기 때문에, 타일을 바둑판처럼 이어붙여도 경계가 보이지 않는다.
-- 손으로 그릴 때 가장 성가신 부분이라 코드가 유리한 지점이다.

local T = 16

-- 랜딩 배경 아트의 행성 표면 톤에 맞춘다 (붉은 흙 + 보라 암반)
local PALETTE = {
  ground = {
    base = Color{ r = 104, g = 56, b = 64 },
    dark = Color{ r = 82, g = 42, b = 52 },
    light = Color{ r = 126, g = 72, b = 78 },
    speck = Color{ r = 148, g = 96, b = 94 },
  },
  rock = {
    base = Color{ r = 84, g = 64, b = 102 },
    dark = Color{ r = 58, g = 42, b = 74 },
    light = Color{ r = 112, g = 90, b = 132 },
    speck = Color{ r = 136, g = 114, b = 156 },
  },
  moss = {
    base = Color{ r = 74, g = 60, b = 96 },
    dark = Color{ r = 54, g = 42, b = 72 },
    light = Color{ r = 122, g = 74, b = 140 },
    speck = Color{ r = 158, g = 100, b = 176 },
  },
}

-- 결과를 재현할 수 있게 고정 시드 LCG를 쓴다. 같은 시드 = 같은 타일.
local seed = 1
local function srand(s) seed = s end
local function rnd()
  seed = (1103515245 * seed + 12345) % 2147483648
  return seed / 2147483648
end
local function rndInt(a, b) return a + math.floor(rnd() * (b - a + 1)) end

local function newTile()
  local g = {}
  for y = 0, T - 1 do
    g[y] = {}
  end
  return g
end

-- 모든 그리기는 이 함수를 통한다. wrap이 여기 한 곳에만 있어야 이음매가 안 생긴다.
local function put(g, x, y, color)
  x = math.floor(x) % T
  y = math.floor(y) % T
  g[y][x] = color
end

local function fill(g, color)
  for y = 0, T - 1 do
    for x = 0, T - 1 do
      g[y][x] = color
    end
  end
end

-- 뭉친 얼룩. 원을 그리되 wrap되므로 경계를 넘어가도 반대편에 이어진다.
local function patch(g, cx, cy, r, color)
  for dy = -r - 1, r + 1 do
    for dx = -r - 1, r + 1 do
      -- 살짝 찌그러뜨려야 원이 아니라 자연스러운 얼룩으로 보인다
      local w = (dx * dx) / (r * r) + (dy * dy) / ((r * 0.8) * (r * 0.8))
      if w <= 1.0 then put(g, cx + dx, cy + dy, color) end
    end
  end
end

local function specks(g, count, color)
  for _ = 1, count do
    put(g, rndInt(0, T - 1), rndInt(0, T - 1), color)
  end
end

-- 금 / 갈라진 틈. 한 방향으로 비틀거리며 나아간다.
local function crack(g, x, y, len, color)
  local dx = (rnd() < 0.5) and 1 or 0
  local dy = 1 - dx
  for i = 1, len do
    put(g, x, y, color)
    if rnd() < 0.35 then
      -- 가끔 옆으로 한 칸 꺾어야 직선처럼 보이지 않는다
      if dx == 1 then y = y + (rnd() < 0.5 and 1 or -1) else x = x + (rnd() < 0.5 and 1 or -1) end
    end
    x = x + dx
    y = y + dy
  end
end

-- ---------------------------------------------------------------- 타일 정의

local function drawGround(g, variant)
  local p = PALETTE.ground
  fill(g, p.base)
  for _ = 1, 3 + variant do
    patch(g, rndInt(0, T - 1), rndInt(0, T - 1), rndInt(2, 4), p.dark)
  end
  for _ = 1, 2 do
    patch(g, rndInt(0, T - 1), rndInt(0, T - 1), rndInt(1, 3), p.light)
  end
  specks(g, 6, p.speck)
  specks(g, 8, p.dark)
end

local function drawRock(g, variant)
  local p = PALETTE.rock
  fill(g, p.base)
  for _ = 1, 3 do
    patch(g, rndInt(0, T - 1), rndInt(0, T - 1), rndInt(3, 5), p.dark)
  end
  patch(g, rndInt(0, T - 1), rndInt(0, T - 1), 3, p.light)
  for _ = 1, 1 + variant do
    crack(g, rndInt(0, T - 1), rndInt(0, T - 1), rndInt(8, 14), p.dark)
  end
  specks(g, 5, p.speck)
end

local function drawMoss(g)
  local p = PALETTE.moss
  fill(g, p.base)
  for _ = 1, 4 do
    patch(g, rndInt(0, T - 1), rndInt(0, T - 1), rndInt(2, 4), p.dark)
  end
  -- 발광하는 이끼 덩어리
  for _ = 1, 5 do
    local cx, cy = rndInt(0, T - 1), rndInt(0, T - 1)
    patch(g, cx, cy, 2, p.light)
    put(g, cx, cy, p.speck)
    put(g, cx + 1, cy - 1, p.speck)
  end
  specks(g, 4, p.speck)
end

-- ---------------------------------------------------------------- 시트 생성

local TILES = {
  { name = 'ground', draw = function(g) drawGround(g, 0) end },
  { name = 'ground', draw = function(g) drawGround(g, 1) end },
  { name = 'ground', draw = function(g) drawGround(g, 2) end },
  { name = 'ground', draw = function(g) drawGround(g, 3) end },
  { name = 'rock', draw = function(g) drawRock(g, 0) end },
  { name = 'rock', draw = function(g) drawRock(g, 1) end },
  { name = 'moss', draw = drawMoss },
  { name = 'moss', draw = drawMoss },
}

local sprite = Sprite(T, T, ColorMode.RGB)
local layer = sprite.layers[1]
for _ = 2, #TILES do sprite:newEmptyFrame() end

srand(20260804)

for i, tile in ipairs(TILES) do
  local g = newTile()
  tile.draw(g)

  local image = Image(T, T, ColorMode.RGB)
  for y = 0, T - 1 do
    for x = 0, T - 1 do
      image:drawPixel(x, y, g[y][x])
    end
  end
  sprite:newCel(layer, i, image, Point(0, 0))
end

-- 같은 재질끼리 태그로 묶는다. 프레임 = 변형(variant)이다.
local tag = sprite:newTag(1, 4); tag.name = 'ground'
tag = sprite:newTag(5, 6); tag.name = 'rock'
tag = sprite:newTag(7, 8); tag.name = 'moss'

sprite:saveAs(app.params['out'])
print('saved: ' .. app.params['out'])
