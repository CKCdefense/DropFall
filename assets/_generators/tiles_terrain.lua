-- 바닥 지형 타일셋. 16x16, DropFall 타일 규격(TILE_SIZE = 16).
--
-- ============================================================================
-- 왜 "연결 타일"이 필요한가
-- ============================================================================
-- 지형이 여러 종류면 경계가 생긴다. 풀밭 옆에 사막을 그냥 갖다 붙이면 칼로 자른 듯한
-- 직선이 생겨서 격자가 그대로 드러난다. 경계 모양을 미리 그려둔 타일로 이어야 자연스럽다.
--
-- 이 스크립트는 **코너 기반 오토타일(marching squares)** 방식을 쓴다.
-- 지형의 존재 여부를 타일 중심이 아니라 **꼭짓점**에 정의하고, 각 타일은 자기를 둘러싼
-- 네 꼭짓점을 본다. 네 꼭짓점의 on/off 조합은 2^4 = 16가지 → 타일 16장이면 모든 경계가
-- 표현된다.
--
--   비트: 1=북서(NW)  2=북동(NE)  4=남동(SE)  8=남서(SW)
--
--   mask 0  = 전부 바깥 (완전 투명)
--   mask 15 = 전부 안쪽 (꽉 찬 타일)
--   그 사이 = 모서리/반쪽/대각선 등 경계 모양
--
-- 이웃한 두 타일은 맞닿은 변의 꼭짓점 두 개를 **공유**한다. 경계선을 그 꼭짓점 값만으로
-- 결정하면(아래 bilinear) 변 위에서 값이 정확히 일치하므로, 어떤 조합으로 이어 붙여도
-- 경계가 매끄럽게 연결된다. 이게 이 방식의 핵심이다.
--
-- ============================================================================
-- 레이어 방식
-- ============================================================================
-- 지형 쌍마다 전이 타일을 만들면 (종류 수)^2로 폭발한다. 대신 **바깥쪽을 투명하게**
-- 뚫어놓고 위에 겹쳐 그린다. 아래 지형이 무엇이든 상관없어지므로 지형당 16장이면 끝난다.
--
--   grass(바닥, 항상 꽉 채움) → dirt → sand → stone 순서로 겹쳐 그린다.
--
-- ============================================================================
-- 프레임 배치 — 클라이언트와 반드시 일치해야 한다
-- ============================================================================
-- 지형 하나가 연속된 TILES_PER_TERRAIN(20)장을 차지한다.
--
--   0..15  코너 마스크
--   16..19 꽉 찬 타일의 다른 무늬 (반복돼 보이는 것 방지)
--
--   프레임 번호 = 지형순번 * 20 + 로컬번호
--
-- 지형 순서: grass, dirt, sand, stone
-- 이 배치는 packages/shared/src/terrain/tileset.ts 와 짝을 맞춰야 한다. 한쪽만 바꾸면
-- 엉뚱한 타일이 깔린다.

local T = 16
local TILES_PER_TERRAIN = 20
local MASK_COUNT = 16
local FULL_VARIANTS = 4

-- 밤 배경(#20242E) 위에 올라간다. 캐릭터(살색 #EEC39A)가 묻히지 않도록 전부 어둡고
-- 채도를 낮췄다 — 바닥이 화려하면 정작 봐야 할 몬스터와 아이템이 안 보인다.
local TERRAINS = {
  {
    name = 'grass',
    dark = Color{ r = 0x2C, g = 0x3E, b = 0x26 },
    base = Color{ r = 0x3A, g = 0x52, b = 0x30 },
    light = Color{ r = 0x48, g = 0x66, b = 0x3C },
    speck = Color{ r = 0x56, g = 0x78, b = 0x4A },
  },
  {
    name = 'dirt',
    dark = Color{ r = 0x3A, g = 0x2C, b = 0x21 },
    base = Color{ r = 0x4E, g = 0x3B, b = 0x2C },
    light = Color{ r = 0x62, g = 0x4B, b = 0x38 },
    speck = Color{ r = 0x76, g = 0x5C, b = 0x46 },
  },
  {
    -- 사막. 유일하게 밝은 지형이라 넓게 깔면 눈에 띈다 — 노이즈 임계값을 높여
    -- 드문드문 나오게 해둔다(shared/terrain/terrain.ts).
    name = 'sand',
    dark = Color{ r = 0x6B, g = 0x5C, b = 0x3C },
    base = Color{ r = 0x85, g = 0x76, b = 0x4E },
    light = Color{ r = 0x9E, g = 0x8C, b = 0x60 },
    speck = Color{ r = 0xB5, g = 0xA2, b = 0x73 },
  },
  {
    name = 'stone',
    dark = Color{ r = 0x3E, g = 0x43, b = 0x4C },
    base = Color{ r = 0x4F, g = 0x55, b = 0x60 },
    light = Color{ r = 0x61, g = 0x68, b = 0x74 },
    speck = Color{ r = 0x73, g = 0x7B, b = 0x88 },
  },
}

-- 결과를 재현할 수 있게 고정 시드 LCG를 쓴다. 같은 시드 = 같은 타일.
local seed = 1
local function srand(s) seed = s end
local function rnd()
  seed = (1103515245 * seed + 12345) % 2147483648
  return seed / 2147483648
end

--- 4x4 Bayer 행렬. 경계를 계단식으로 흩어(디더링) 픽셀아트처럼 보이게 한다.
--- 타일 크기 16이 4의 배수라 타일을 이어 붙여도 패턴이 어긋나지 않는다.
local BAYER = {
  { 0, 8, 2, 10 },
  { 12, 4, 14, 6 },
  { 3, 11, 1, 9 },
  { 15, 7, 13, 5 },
}

local function bayer(x, y)
  return BAYER[(y % 4) + 1][(x % 4) + 1] / 16
end

--- 네 꼭짓점 값(0/1)을 픽셀 위치로 이중선형 보간한다.
--- 변 위에서는 그 변을 이루는 두 꼭짓점만 영향을 주므로, 이웃 타일과 값이 정확히 같다.
local function cornerField(mask, u, v)
  local nw = (mask & 1) ~= 0 and 1 or 0
  local ne = (mask & 2) ~= 0 and 1 or 0
  local se = (mask & 4) ~= 0 and 1 or 0
  local sw = (mask & 8) ~= 0 and 1 or 0

  local top = nw * (1 - u) + ne * u
  local bottom = sw * (1 - u) + se * u
  return top * (1 - v) + bottom * v
end

--- 경계를 흩뜨리는 폭. 0이면 칼로 자른 듯한 직선, 크면 지저분해진다.
local DITHER_WIDTH = 0.34

--- 이 픽셀이 지형 안쪽인지. 경계 근처에서만 디더링이 작동한다.
local function isInside(mask, px, py)
  -- 픽셀 중심으로 샘플링해야 좌우가 대칭이 된다.
  local u = (px + 0.5) / T
  local v = (py + 0.5) / T
  local f = cornerField(mask, u, v)
  return f > 0.5 + (bayer(px, py) - 0.5) * DITHER_WIDTH
end

--- 경계에서 얼마나 안쪽인지(0에 가까울수록 가장자리). 테두리 음영에 쓴다.
local function edgeness(mask, px, py)
  local u = (px + 0.5) / T
  local v = (py + 0.5) / T
  return cornerField(mask, u, v) - 0.5
end

--- 지형별 표면 무늬 성격.
--- 색만 다르면 4종이 다 비슷해 보인다. 무늬의 "모양"이 달라야 한눈에 구분된다.
---   grass 세로 풀잎 · dirt 뭉친 흙덩이 · sand 가로 물결 · stone 각진 균열
local TEXTURE = {
  grass = { marks = 26, shape = 'blade' },
  dirt = { marks = 22, shape = 'clump' },
  sand = { marks = 20, shape = 'ripple' },
  stone = { marks = 18, shape = 'crack' },
}

--- 타일 경계를 넘어가는 좌표를 반대편으로 감는다. 무늬가 타일 가장자리에서 잘리면
--- 이어 붙였을 때 격자가 드러난다 — 감아주면 무늬가 경계를 넘어 이어진다.
local function wrap(v) return v % T end

--- 안쪽일 때만 찍는다. 마스크 타일에서는 바깥으로 삐져나간 무늬가 저절로 잘린다.
local function putInside(grid, mask, x, y, color)
  x, y = wrap(x), wrap(y)
  if isInside(mask, x, y) then grid[y][x] = color end
end

local function drawMark(grid, mask, shape, x, y, color)
  if shape == 'blade' then
    -- 세로 2~3px. 풀이 서 있는 느낌.
    for i = 0, 1 + math.floor(rnd() * 2) do putInside(grid, mask, x, y + i, color) end
  elseif shape == 'ripple' then
    -- 가로 2~4px. 바람에 쓸린 모래결.
    for i = 0, 1 + math.floor(rnd() * 3) do putInside(grid, mask, x + i, y, color) end
  elseif shape == 'crack' then
    -- 짧은 대각선. 각진 암반.
    local dx = rnd() < 0.5 and 1 or -1
    for i = 0, 1 + math.floor(rnd() * 2) do putInside(grid, mask, x + i * dx, y + i, color) end
  else
    -- clump: 2x2에서 한 칸 빠진 덩어리. 흙이 뭉친 느낌.
    putInside(grid, mask, x, y, color)
    putInside(grid, mask, x + 1, y, color)
    if rnd() < 0.6 then putInside(grid, mask, x, y + 1, color) end
  end
end

--- 표면을 칠한다. 균일한 바탕 위에 무늬를 흩뿌리는 방식이다.
--- 픽셀마다 무작위로 색을 고르면 TV 노이즈처럼 보여서 바탕이 시끄러워진다.
local function paintSurface(grid, terrain, mask, variant)
  for py = 0, T - 1 do
    for px = 0, T - 1 do
      if isInside(mask, px, py) then grid[py][px] = terrain.base end
    end
  end

  local texture = TEXTURE[terrain.name]
  srand(variant * 7919 + 31)

  for i = 1, texture.marks do
    local x = math.floor(rnd() * T)
    local y = math.floor(rnd() * T)
    local r = rnd()
    local color = terrain.light
    if r < 0.18 then
      color = terrain.speck
    elseif r > 0.68 then
      color = terrain.dark
    end
    drawMark(grid, mask, texture.shape, x, y, color)
  end
end

local function drawTile(image, terrain, mask, variant)
  local grid = {}
  for y = 0, T - 1 do grid[y] = {} end

  paintSurface(grid, terrain, mask, variant)

  -- 가장자리 한 줄은 어둡게 눌러 실루엣을 만든다. 안 그러면 아래 지형과 뭉개져서
  -- 경계가 어디인지 안 보인다. 꽉 찬 타일(15)은 경계가 없으므로 건너뛴다.
  if mask ~= 15 then
    for py = 0, T - 1 do
      for px = 0, T - 1 do
        if grid[py][px] ~= nil and edgeness(mask, px, py) < 0.08 then
          grid[py][px] = terrain.dark
        end
      end
    end
  end

  for py = 0, T - 1 do
    for px = 0, T - 1 do
      if grid[py][px] ~= nil then image:drawPixel(px, py, grid[py][px]) end
    end
  end
end

-- ---------------------------------------------------------------- 시트 생성

local frameCount = #TERRAINS * TILES_PER_TERRAIN
local sprite = Sprite(T, T, ColorMode.RGB)
local layer = sprite.layers[1]
for _ = 2, frameCount do sprite:newEmptyFrame() end

local frame = 1
for _, terrain in ipairs(TERRAINS) do
  local first = frame

  for mask = 0, MASK_COUNT - 1 do
    local image = Image(T, T, ColorMode.RGB)
    -- mask 0은 완전 투명이다. 자리를 비워두면 번호가 밀리므로 빈 프레임으로 남긴다.
    if mask > 0 then drawTile(image, terrain, mask, 0) end
    sprite:newCel(layer, frame, image, Point(0, 0))
    frame = frame + 1
  end

  for variant = 1, FULL_VARIANTS do
    local image = Image(T, T, ColorMode.RGB)
    drawTile(image, terrain, 15, variant)
    sprite:newCel(layer, frame, image, Point(0, 0))
    frame = frame + 1
  end

  local tag = sprite:newTag(first, frame - 1)
  tag.name = terrain.name
end

sprite:saveAs(app.params['out'])
print(string.format('saved: %s (%d타일, 지형 %d종)', app.params['out'], frameCount, #TERRAINS))
