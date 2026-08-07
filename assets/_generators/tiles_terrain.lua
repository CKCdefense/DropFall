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
--
-- 그 뒤에 **장식 타일**이 붙는다: 80번부터 지형별 4장씩 16장.
--   장식 번호 = 80 + 지형순번 * 4 + 변형(0..3)
-- 장식은 투명 바탕에 작은 소품 하나다 — 꽃/자갈/뼈/이끼 등. 지형 위에 겹쳐 깐다.
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
    dark = Color{ r = 0x27, g = 0x38, b = 0x22 },
    baseAlt = Color{ r = 0x33, g = 0x49, b = 0x2B },
    base = Color{ r = 0x3B, g = 0x54, b = 0x31 },
    light = Color{ r = 0x4F, g = 0x6E, b = 0x40 },
    speck = Color{ r = 0x63, g = 0x86, b = 0x50 },
  },
  {
    name = 'dirt',
    dark = Color{ r = 0x33, g = 0x26, b = 0x1C },
    baseAlt = Color{ r = 0x45, g = 0x34, b = 0x27 },
    base = Color{ r = 0x50, g = 0x3D, b = 0x2D },
    light = Color{ r = 0x68, g = 0x50, b = 0x3B },
    speck = Color{ r = 0x80, g = 0x64, b = 0x4A },
  },
  {
    -- 사막. 유일하게 밝은 지형이라 넓게 깔면 눈에 띈다 — 노이즈 임계값을 높여
    -- 드문드문 나오게 해둔다(shared/terrain/terrain.ts).
    name = 'sand',
    dark = Color{ r = 0x63, g = 0x54, b = 0x36 },
    baseAlt = Color{ r = 0x7C, g = 0x6D, b = 0x47 },
    base = Color{ r = 0x88, g = 0x78, b = 0x4F },
    light = Color{ r = 0xA4, g = 0x92, b = 0x63 },
    speck = Color{ r = 0xBD, g = 0xAA, b = 0x78 },
  },
  {
    name = 'stone',
    dark = Color{ r = 0x37, g = 0x3B, b = 0x44 },
    baseAlt = Color{ r = 0x49, g = 0x4F, b = 0x59 },
    base = Color{ r = 0x53, g = 0x59, b = 0x64 },
    light = Color{ r = 0x68, g = 0x70, b = 0x7C },
    speck = Color{ r = 0x7E, g = 0x87, b = 0x94 },
  },
}


-- 결과를 재현할 수 있게 고정 시드 LCG를 쓴다. 같은 시드 = 같은 타일.
local seed = 1
local function srand(s) seed = s end
local function rnd()
  seed = (1103515245 * seed + 12345) % 2147483648
  return seed / 2147483648
end

--- 타일 크기로 감기는 격자 노이즈. 4px 간격 격자점에 해시를 두고 픽셀마다 보간한다.
--- 격자 주기(4칸 = 16px)가 타일 크기와 같아 이어 붙여도 끊기지 않는다.
--- 바탕 얼룩(mottle)과 경계 워프가 salt만 다르게 해서 같이 쓴다.
local function latticeHash(salt, gx, gy)
  local h = ((gx % 4 + 1) * 73856093) ~ ((gy % 4 + 1) * 19349663) ~ (salt * 83492791)
  return (h % 1000) / 1000
end

local function latticeNoise(salt, px, py)
  local gx, gy = math.floor(px / 4), math.floor(py / 4)
  local fx, fy = (px % 4) / 4, (py % 4) / 4
  fx = fx * fx * (3 - 2 * fx)
  fy = fy * fy * (3 - 2 * fy)

  local a = latticeHash(salt, gx, gy)
  local b = latticeHash(salt, gx + 1, gy)
  local c = latticeHash(salt, gx, gy + 1)
  local d = latticeHash(salt, gx + 1, gy + 1)

  local top = a + (b - a) * fx
  local bottom = c + (d - c) * fx
  return top + (bottom - top) * fy
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

--- 경계 곡선 워프의 진폭.
--- 이중선형 필드의 등고선은 직선/45° 사각이라 경계가 기계적으로 보인다. 매끄러운
--- 격자 노이즈를 필드에 더해 등고선을 구불구불하게 만든다 — 워프도 필드도 타일 경계에서
--- 연속이므로 이어 붙여도 곡선이 끊기지 않는다. 0.5 미만이어야 꼭짓점의 안/밖 의미가
--- 뒤집히지 않는다(꼭짓점에서 필드는 0 또는 1).
local WARP_AMPLITUDE = 0.19
local WARP_SALT = 7772

local function warpedField(mask, px, py)
  local u = (px + 0.5) / T
  local v = (py + 0.5) / T
  return cornerField(mask, u, v) + (latticeNoise(WARP_SALT, px, py) - 0.5) * 2 * WARP_AMPLITUDE
end

--- 경계를 흩뜨리는 지터 폭. Bayer 디더는 규칙적인 격자 점무늬가 생겨서 해시 지터로
--- 바꿨다 — 폭도 좁게 잡는다. 곡선 자체는 워프가 만들고, 지터는 가장자리 픽셀만 살짝 깬다.
local DITHER_WIDTH = 0.12

local function pixelJitter(px, py)
  local h = ((px % T + 11) * 40503) ~ ((py % T + 5) * 104729)
  return (h % 256) / 256
end

--- 이 픽셀이 지형 안쪽인지.
local function isInside(mask, px, py)
  return warpedField(mask, px, py) > 0.5 + (pixelJitter(px, py) - 0.5) * DITHER_WIDTH
end

--- 경계에서 얼마나 안쪽인지(0에 가까울수록 가장자리). 테두리 음영에 쓴다.
--- isInside와 같은 워프된 필드를 봐야 어두운 테두리가 곡선을 따라간다.
local function edgeness(mask, px, py)
  return warpedField(mask, px, py) - 0.5
end

-- ============================================================================
-- 표면 질감
-- ============================================================================
-- 처음 버전은 1px 점을 색만 바꿔 흩뿌렸는데 TV 노이즈처럼 보였다. 손그림 픽셀아트
-- 타일이 쓰는 세 가지 기법을 넣는다:
--
--  1) 얼룩 바탕: 바탕을 단색이 아니라 4x4 블록 단위의 두 톤 얼룩으로 깐다.
--     점 노이즈(고주파)가 아니라 덩어리(저주파)라 멀리서 봐도 지저분하지 않다.
--  2) 음영 쌍: 모든 무늬가 밝은 픽셀 + 어두운 픽셀 쌍으로 그려진다. 광원이
--     좌상단에 있다고 치고 밝음은 위, 어두움은 아래 — 이게 있어야 입체감이 난다.
--  3) 테두리 림: 경계 타일의 윗변 안쪽에 밝은 한 줄. 어두운 외곽선만 있으면
--     구멍처럼 보이고, 윗변에 빛을 받으면 "살짝 솟은 지형"으로 읽힌다.

--- 타일 경계를 넘어가는 좌표를 반대편으로 감는다. 무늬가 타일 가장자리에서 잘리면
--- 이어 붙였을 때 격자가 드러난다 — 감아주면 무늬가 경계를 넘어 이어진다.
local function wrap(v) return v % T end

--- 안쪽일 때만 찍는다. 마스크 타일에서는 바깥으로 삐져나간 무늬가 저절로 잘린다.
local function putInside(grid, mask, x, y, color)
  x, y = wrap(x), wrap(y)
  if isInside(mask, x, y) then grid[y][x] = color end
end

-- ---------------------------------------------------------------- 무늬(모티프)

--- 풀포기: V자로 벌어진 밝은 잎 두 장 + 아래 뿌리 그림자.
local function motifTuft(grid, mask, x, y, t)
  putInside(grid, mask, x - 1, y - 1, t.light)
  putInside(grid, mask, x + 1, y - 1, t.speck)
  putInside(grid, mask, x, y, t.light)
  putInside(grid, mask, x, y + 1, t.dark)
end

--- 자갈: 밝은 2x2 덩어리의 우하단을 어둡게 — 굴러다니는 돌멩이.
local function motifPebble(grid, mask, x, y, t)
  putInside(grid, mask, x, y, t.speck)
  putInside(grid, mask, x + 1, y, t.light)
  putInside(grid, mask, x, y + 1, t.light)
  putInside(grid, mask, x + 1, y + 1, t.dark)
end

--- 모래결: 물결치는 밝은 선 + 바로 아래 그림자 선. 바람에 쓸린 사구 무늬.
local function motifRipple(grid, mask, x, y, t)
  local len = 4 + math.floor(rnd() * 4)
  local yy = y
  for i = 0, len do
    if i > 0 and rnd() < 0.35 then yy = yy + (rnd() < 0.5 and -1 or 1) end
    putInside(grid, mask, x + i, yy, t.light)
    putInside(grid, mask, x + i, yy + 1, t.dark)
  end
end

--- 암반 균열: 어두운 꺾인 선 + 위쪽 모서리에 밝은 베벨. 갈라진 바위 면.
local function motifCrack(grid, mask, x, y, t)
  local xx, yy = x, y
  local dx = rnd() < 0.5 and 1 or -1
  local len = 3 + math.floor(rnd() * 3)
  for i = 0, len do
    putInside(grid, mask, xx, yy, t.dark)
    putInside(grid, mask, xx, yy - 1, t.light)
    xx = xx + dx
    if rnd() < 0.4 then yy = yy + 1 end
  end
end

--- 지형별 무늬 구성. 큰 무늬 소수 + 잔점 소수 — 개수를 늘리는 것보다 음영이 중요하다.
local MOTIFS = {
  grass = { fn = motifTuft, count = 7 },
  dirt = { fn = motifPebble, count = 6 },
  sand = { fn = motifRipple, count = 4 },
  stone = { fn = motifCrack, count = 5 },
}

-- ---------------------------------------------------------------- 바탕/그리기

--- 두 톤 얼룩 바탕.
--- 4x4 블록을 그대로 칠하면 체스판이 되고, 픽셀 해시는 TV 노이즈가 된다. 그 사이 —
--- 부드럽게 보간된 격자 노이즈(latticeNoise)를 문턱값으로 잘라 유기적 얼룩을 만든다.
local function mottle(variant, px, py)
  return latticeNoise(variant, px, py)
end

local function paintSurface(grid, terrain, mask, variant)
  for py = 0, T - 1 do
    for px = 0, T - 1 do
      if isInside(mask, px, py) then
        grid[py][px] = mottle(variant, px, py) < 0.45 and terrain.baseAlt or terrain.base
      end
    end
  end

  local motif = MOTIFS[terrain.name]
  srand(variant * 7919 + 31)

  for _ = 1, motif.count do
    motif.fn(grid, mask, math.floor(rnd() * T), math.floor(rnd() * T), terrain)
  end

  -- 아주 드문 잔점. 무늬 사이 빈 곳이 너무 밋밋하지 않게만.
  for _ = 1, 4 do
    local x = math.floor(rnd() * T)
    local y = math.floor(rnd() * T)
    putInside(grid, mask, x, y, rnd() < 0.5 and terrain.light or terrain.dark)
  end
end

local function drawTile(image, terrain, mask, variant)
  local grid = {}
  for y = 0, T - 1 do grid[y] = {} end

  paintSurface(grid, terrain, mask, variant)

  if mask ~= 15 then
    -- 1) 가장자리 한 줄은 어둡게 눌러 실루엣을 만든다.
    for py = 0, T - 1 do
      for px = 0, T - 1 do
        if grid[py][px] ~= nil and edgeness(mask, px, py) < 0.08 then
          grid[py][px] = terrain.dark
        end
      end
    end

    -- 2) 윗변 림: 바로 위 픽셀이 바깥이면 빛을 받는 윗면이다 — 밝게 뒤집는다.
    --    이게 있어야 경계 타일이 "구멍"이 아니라 "살짝 솟은 땅"으로 읽힌다.
    for py = 0, T - 1 do
      for px = 0, T - 1 do
        if grid[py][px] ~= nil and not isInside(mask, px, py - 1) then
          grid[py][px] = terrain.light
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

-- ---------------------------------------------------------------- 장식 타일
-- 지형 위에 겹쳐 깔리는 작은 소품. 밝은 면(좌상단) + 그림자(우하단) 규칙은 무늬와 같다.
-- 아래 그림자 한 줄이 "바닥에 놓여 있다"를 만든다 — 없으면 공중에 뜬 스티커처럼 보인다.

local DECO_COLORS = {
  petal = Color{ r = 0xC9, g = 0xCF, b = 0xB9 },
  petalWarm = Color{ r = 0xC7, g = 0x8F, b = 0x6B },
  pollen = Color{ r = 0xC9, g = 0xA2, b = 0x4A },
  bone = Color{ r = 0xC4, g = 0xC0, b = 0xAE },
  boneDark = Color{ r = 0x8F, g = 0x8C, b = 0x7C },
  cactus = Color{ r = 0x4F, g = 0x6E, b = 0x40 },
  cactusDark = Color{ r = 0x33, g = 0x49, b = 0x2B },
  crystal = Color{ r = 0x8F, g = 0xA3, b = 0xC0 },
  crystalLight = Color{ r = 0xC6, g = 0xD2, b = 0xE4 },
}

local function putD(grid, x, y, color)
  if x >= 0 and x < T and y >= 0 and y < T then grid[y][x] = color end
end

--- 소품이 타일 정중앙에만 오면 배치가 격자로 읽힌다. 변형마다 다른 곳에 둔다.
local function decoOrigin()
  return 5 + math.floor(rnd() * 5), 5 + math.floor(rnd() * 5)
end

local DECO_DRAWERS = {
  grass = {
    -- 흰 꽃: 십자 꽃잎 + 노란 꽃술 + 아래 그림자
    function(g, t)
      local x, y = decoOrigin()
      putD(g, x, y - 1, DECO_COLORS.petal)
      putD(g, x - 1, y, DECO_COLORS.petal)
      putD(g, x + 1, y, DECO_COLORS.petal)
      putD(g, x, y + 1, DECO_COLORS.petal)
      putD(g, x, y, DECO_COLORS.pollen)
      putD(g, x, y + 2, t.dark)
    end,
    -- 주황 꽃 두 송이
    function(g, t)
      for _ = 1, 2 do
        local x, y = decoOrigin()
        putD(g, x, y, DECO_COLORS.petalWarm)
        putD(g, x + 1, y, DECO_COLORS.petalWarm)
        putD(g, x, y - 1, DECO_COLORS.petal)
        putD(g, x, y + 1, t.dark)
      end
    end,
    -- 큰 풀숲: 풀포기 세 개 뭉침
    function(g, t)
      local x, y = decoOrigin()
      for i = -2, 2, 2 do
        putD(g, x + i, y - 1, t.speck)
        putD(g, x + i, y, t.light)
        putD(g, x + i, y + 1, t.dark)
      end
    end,
    -- 버섯: 갓 + 대 + 그림자
    function(g, t)
      local x, y = decoOrigin()
      putD(g, x - 1, y, DECO_COLORS.petalWarm)
      putD(g, x, y - 1, DECO_COLORS.petal)
      putD(g, x, y, DECO_COLORS.petalWarm)
      putD(g, x + 1, y, DECO_COLORS.petalWarm)
      putD(g, x, y + 1, DECO_COLORS.bone)
      putD(g, x, y + 2, t.dark)
    end,
  },
  dirt = {
    -- 자갈 무더기
    function(g, t)
      local x, y = decoOrigin()
      for _ = 1, 3 do
        local ox = x + math.floor(rnd() * 5) - 2
        local oy = y + math.floor(rnd() * 4) - 2
        putD(g, ox, oy, t.speck)
        putD(g, ox + 1, oy + 1, t.dark)
      end
    end,
    -- 나뭇가지: 대각선 + 윗면 하이라이트
    function(g, t)
      local x, y = decoOrigin()
      for i = 0, 3 do
        local dy = math.floor(i / 2)
        putD(g, x + i, y + dy, t.dark)
        putD(g, x + i, y + dy - 1, t.light)
      end
    end,
    -- 마른 자국: 어두운 균열 얼룩
    function(g, t)
      local x, y = decoOrigin()
      putD(g, x, y, t.dark)
      putD(g, x + 1, y, t.dark)
      putD(g, x + 2, y + 1, t.dark)
      putD(g, x - 1, y + 1, t.baseAlt)
    end,
    -- 마른 풀 한 포기
    function(g, t)
      local x, y = decoOrigin()
      putD(g, x - 1, y - 1, t.light)
      putD(g, x + 1, y - 1, t.speck)
      putD(g, x, y, t.light)
      putD(g, x, y + 1, t.dark)
    end,
  },
  sand = {
    -- 작은 선인장: 몸통 + 팔, 왼쪽 밝고 오른쪽 어둡다
    function(g, t)
      local x, y = decoOrigin()
      for i = -2, 1 do putD(g, x, y + i, DECO_COLORS.cactus) end
      putD(g, x - 1, y - 1, DECO_COLORS.cactus)
      putD(g, x - 1, y - 2, DECO_COLORS.cactus)
      putD(g, x + 1, y, DECO_COLORS.cactusDark)
      putD(g, x, y + 2, t.dark)
    end,
    -- 뼈: 사막의 클리셰. 가로 뼈대 + 관절 혹
    function(g, t)
      local x, y = decoOrigin()
      for i = 0, 3 do putD(g, x + i, y, DECO_COLORS.bone) end
      putD(g, x - 1, y - 1, DECO_COLORS.bone)
      putD(g, x + 4, y + 1, DECO_COLORS.boneDark)
      putD(g, x + 1, y + 1, t.dark)
    end,
    -- 돌 하나
    function(g, t)
      local x, y = decoOrigin()
      putD(g, x, y - 1, t.speck)
      putD(g, x - 1, y, t.speck)
      putD(g, x, y, t.light)
      putD(g, x + 1, y, t.baseAlt)
      putD(g, x, y + 1, t.dark)
      putD(g, x + 1, y + 1, t.dark)
    end,
    -- 마른 덤불: 가는 가지들
    function(g, t)
      local x, y = decoOrigin()
      putD(g, x, y, t.dark)
      putD(g, x - 1, y - 1, t.baseAlt)
      putD(g, x + 1, y - 1, t.baseAlt)
      putD(g, x - 2, y, t.baseAlt)
      putD(g, x + 2, y - 2, t.baseAlt)
    end,
  },
  stone = {
    -- 바위 조각: 덩어리 하나
    function(g, t)
      local x, y = decoOrigin()
      putD(g, x - 1, y - 1, t.speck)
      putD(g, x, y - 1, t.light)
      putD(g, x - 1, y, t.light)
      putD(g, x, y, t.base)
      putD(g, x + 1, y, t.baseAlt)
      putD(g, x, y + 1, t.dark)
      putD(g, x + 1, y + 1, t.dark)
    end,
    -- 수정: 게임 유일의 차가운 포인트 컬러
    function(g, t)
      local x, y = decoOrigin()
      putD(g, x, y - 2, DECO_COLORS.crystalLight)
      putD(g, x, y - 1, DECO_COLORS.crystal)
      putD(g, x - 1, y, DECO_COLORS.crystal)
      putD(g, x, y, DECO_COLORS.crystal)
      putD(g, x + 1, y - 1, DECO_COLORS.crystalLight)
      putD(g, x, y + 1, t.dark)
    end,
    -- 잔해: 흩어진 파편
    function(g, t)
      for _ = 1, 4 do
        local x, y = decoOrigin()
        putD(g, x, y, rnd() < 0.5 and t.light or t.dark)
      end
    end,
    -- 이끼: 돌 틈의 초록 얼룩
    function(g, t)
      local x, y = decoOrigin()
      putD(g, x, y, DECO_COLORS.cactus)
      putD(g, x + 1, y, DECO_COLORS.cactusDark)
      putD(g, x, y + 1, DECO_COLORS.cactusDark)
      putD(g, x - 1, y, t.baseAlt)
    end,
  },
}

-- ---------------------------------------------------------------- 시트 생성

local frameCount = #TERRAINS * TILES_PER_TERRAIN
local DECO_COUNT = #TERRAINS * 4
-- 코어 건축 구역 포장. 지형과 같은 20장 구성(마스크 16 + 꽉 찬 변형 4)이라
-- 클라이언트가 같은 마스크 로직을 그대로 쓴다. 번호는 96(장식 뒤)부터.
local PAVEMENT_COUNT = TILES_PER_TERRAIN
local sprite = Sprite(T, T, ColorMode.RGB)
local layer = sprite.layers[1]
for _ = 2, frameCount + DECO_COUNT + PAVEMENT_COUNT do sprite:newEmptyFrame() end

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

-- 장식 프레임(지형 순서대로 4장씩). shared/terrain의 DECO 상수와 짝을 맞춘다.
local decoFirst = frame
for _, terrain in ipairs(TERRAINS) do
  local drawers = DECO_DRAWERS[terrain.name]
  for variant = 1, 4 do
    local image = Image(T, T, ColorMode.RGB)
    local grid = {}
    for y = 0, T - 1 do grid[y] = {} end
    srand(frame * 3331 + variant * 17)
    drawers[variant](grid, terrain)
    for py = 0, T - 1 do
      for px = 0, T - 1 do
        if grid[py][px] ~= nil then image:drawPixel(px, py, grid[py][px]) end
      end
    end
    sprite:newCel(layer, frame, image, Point(0, 0))
    frame = frame + 1
  end
end
local decoTag = sprite:newTag(decoFirst, frame - 1)
decoTag.name = 'deco'

-- ============================================================================
-- 포장 타일 (코어 건축 구역)
-- ============================================================================
-- 코어 주변 건축 가능 구역에 까는 "정돈된 바닥"이다. 지형과 같은 코너 마스크 방식을
-- 쓰되 두 가지가 다르다:
--
--  1) **워프 없음.** 자연 지형의 경계는 구불구불해야 어울리지만, 포장은 사람이 깐
--     바닥이라 경계가 매끈한 호(circular arc)를 그려야 "여기까지 정비했다"로 읽힌다.
--  2) **석판 줄눈.** 얼룩·무늬 대신 8x8 석판을 반칸 엇갈리게(running bond) 깔고
--     줄눈을 어둡게 판다. 절대 좌표(px % 16) 기준이라 이어 붙여도 줄눈이 이어진다.
--
-- 색은 코어 받침대의 회색 돌에서 가져와 살짝 밝게 — 지형 stone(0x53595F)보다 파랗고
-- 정돈된 톤이라 "가공한 돌"과 "자연 암반"이 나뉜다.

-- 첫 버전은 base 0x596171로 밝게 잡았더니 반경 250px 광장이 화면을 지배했다 —
-- 포장은 "구역 표시"지 주인공이 아니라서, 지형 stone(0x53595F)과 비슷한 밝기로
-- 낮추고 줄눈·베벨 대비도 줄였다. 푸른 기운만 남겨 자연 암반과 구분한다.
local PAVE = {
  grout = Color{ r = 0x2A, g = 0x2E, b = 0x38 },  -- 줄눈(가장 어둡다)
  dark = Color{ r = 0x3A, g = 0x3F, b = 0x4C },
  base = Color{ r = 0x4B, g = 0x51, b = 0x5F },
  baseAlt = Color{ r = 0x45, g = 0x4B, b = 0x58 },
  light = Color{ r = 0x59, g = 0x60, b = 0x6F },
  accent = Color{ r = 0x46, g = 0x7E, b = 0x7A },  -- 코어 수정의 청록을 아주 옅게
}

--- 포장 경계 필드 — 워프도 지터도 없는 순수 이중선형. 등고선이 매끈한 직선/호가 된다.
local function paveField(mask, px, py)
  return cornerField(mask, (px + 0.5) / T, (py + 0.5) / T)
end

local function paveInside(mask, px, py)
  return paveField(mask, px, py) > 0.5
end

--- 석판 한 장의 톤. 석판 좌표(절대) 해시라 옆 타일과 자연히 이어진다.
local function slabTone(sx, sy)
  local h = ((sx % 64 + 7) * 2654435761) ~ ((sy % 64 + 3) * 40503)
  return (h % 100) / 100
end

local function drawPavement(image, mask, variant)
  for py = 0, T - 1 do
    for px = 0, T - 1 do
      if paveInside(mask, px, py) then
        -- 8x8 석판, 줄마다 반칸(4px) 엇갈림.
        local row = math.floor(py / 8)
        local shifted = px + (row % 2) * 4
        local sx, sy = math.floor(shifted / 8), row

        local color
        if py % 8 == 7 or shifted % 8 == 7 then
          color = PAVE.grout                       -- 줄눈
        elseif py % 8 == 0 or shifted % 8 == 0 then
          color = PAVE.light                       -- 줄눈 반대편 윗면 베벨
        else
          local tone = slabTone(sx + variant * 13, sy)
          color = tone < 0.35 and PAVE.baseAlt or PAVE.base
          -- 아주 드문 청록 상감 — 코어에서 뻗어 나온 설비라는 힌트. 넉 장에 한 번꼴.
          if tone > 0.96 and py % 8 == 3 and shifted % 8 == 3 then color = PAVE.accent end
          -- 모서리 칩: 석판마다 다른 위치가 살짝 패였다.
          if tone < 0.12 and py % 8 == 5 and shifted % 8 == 5 then color = PAVE.dark end
        end
        image:drawPixel(px, py, color)
      end
    end
  end

  -- 경계 처리 — 지형과 같은 규칙(어두운 외곽 + 윗변 림)이라 화면 문법이 일관된다.
  if mask ~= 15 then
    for py = 0, T - 1 do
      for px = 0, T - 1 do
        if paveInside(mask, px, py) then
          if paveField(mask, px, py) < 0.58 then image:drawPixel(px, py, PAVE.grout) end
          if not paveInside(mask, px, py - 1) then image:drawPixel(px, py, PAVE.light) end
        end
      end
    end
  end
end

local paveFirst = frame
for mask = 0, MASK_COUNT - 1 do
  local image = Image(T, T, ColorMode.RGB)
  if mask > 0 then drawPavement(image, mask, 0) end
  sprite:newCel(layer, frame, image, Point(0, 0))
  frame = frame + 1
end
for variant = 1, FULL_VARIANTS do
  local image = Image(T, T, ColorMode.RGB)
  drawPavement(image, 15, variant)
  sprite:newCel(layer, frame, image, Point(0, 0))
  frame = frame + 1
end
local paveTag = sprite:newTag(paveFirst, frame - 1)
paveTag.name = 'pavement'

sprite:saveAs(app.params['out'])
print(string.format('saved: %s (지형 %d타일 + 장식 %d타일)', app.params['out'], frameCount, frame - decoFirst))
