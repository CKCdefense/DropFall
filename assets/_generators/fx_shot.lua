-- 사격 이펙트. 16x16, 배경 투명.
--   muzzle : 총구 화염 4프레임 (오른쪽(+x) 방향 기준 — 렌더러가 조준각만큼 회전시킨다)
--   hit    : 피격 스파크 4프레임 (방향 없음, 사방으로 퍼진다)
--
-- 이펙트는 "밝은 코어 → 따뜻한 색 → 소멸"이 전부라 수식으로 잘 표현된다.
-- 색을 4개로 제한해야 픽셀아트로 읽힌다. 그라데이션을 많이 쓰면 뿌옇게 뭉개진다.

local S = 16
local CX, CY = 3.0, 7.5 -- 총구 화염의 시작점. 왼쪽에 붙여 앞으로 뻗게 한다.

local CORE = Color{ r = 255, g = 252, b = 236 }
local HOT = Color{ r = 255, g = 226, b = 138 }
local WARM = Color{ r = 246, g = 158, b = 66 }
local EDGE = Color{ r = 198, g = 88, b = 48 }

local function newGrid()
  local g = {}
  for y = 0, S - 1 do g[y] = {} end
  return g
end

local function put(g, x, y, color)
  x, y = math.floor(x + 0.5), math.floor(y + 0.5)
  if x < 0 or x >= S or y < 0 or y >= S then return end
  g[y][x] = color
end

local function disc(g, cx, cy, r, color)
  for dy = -r - 1, r + 1 do
    for dx = -r - 1, r + 1 do
      if dx * dx + dy * dy <= r * r then put(g, cx + dx, cy + dy, color) end
    end
  end
end

-- 중심에서 뻗는 직선 조각. r0~r1 구간만 찍어서 가운데가 빈 링도 만들 수 있다.
local function ray(g, cx, cy, angle, r0, r1, color)
  local steps = math.ceil((r1 - r0) * 2)
  for i = 0, steps do
    local r = r0 + (r1 - r0) * (i / steps)
    put(g, cx + math.cos(angle) * r, cy + math.sin(angle) * r, color)
  end
end

-- 앞으로 벌어지는 원뿔(화염 본체)
local function cone(g, cx, cy, length, spread, color)
  for i = 0, length * 2 do
    local t = i / (length * 2)
    local x = cx + length * t
    local halfHeight = spread * math.sin(math.pi * t) -- 가운데가 가장 두껍다
    for dy = -halfHeight, halfHeight do
      put(g, x, cy + dy, color)
    end
  end
end

-- ---------------------------------------------------------------- 총구 화염

local function muzzle(g, frame)
  if frame == 0 then
    cone(g, CX, CY, 5, 2.0, WARM)
    cone(g, CX, CY, 4, 1.2, HOT)
    disc(g, CX, CY, 1, CORE)
  elseif frame == 1 then
    cone(g, CX, CY, 9, 3.2, EDGE)
    cone(g, CX, CY, 8, 2.4, WARM)
    cone(g, CX, CY, 6, 1.4, HOT)
    disc(g, CX + 1, CY, 2, CORE)
    -- 사방으로 튀는 불티
    for _, a in ipairs({ -0.9, -0.35, 0.35, 0.9 }) do
      ray(g, CX, CY, a, 4, 8, HOT)
    end
  elseif frame == 2 then
    cone(g, CX, CY, 6, 2.2, EDGE)
    cone(g, CX, CY, 5, 1.3, WARM)
    disc(g, CX, CY, 1, HOT)
    for _, a in ipairs({ -0.7, 0.7 }) do
      ray(g, CX, CY, a, 5, 7, WARM)
    end
  else
    -- 흩어지는 잔불만 남긴다
    for _, a in ipairs({ -0.8, -0.2, 0.4, 1.0 }) do
      ray(g, CX, CY, a, 5, 6, EDGE)
    end
    put(g, CX + 3, CY, WARM)
  end
end

-- ---------------------------------------------------------------- 피격 스파크

local function hit(g, frame)
  local cx, cy = 7.5, 7.5
  local rays = 8

  if frame == 0 then
    disc(g, cx, cy, 2, CORE)
    for i = 0, rays - 1 do
      ray(g, cx, cy, i * math.pi * 2 / rays, 2, 3, HOT)
    end
  elseif frame == 1 then
    disc(g, cx, cy, 1, CORE)
    for i = 0, rays - 1 do
      ray(g, cx, cy, i * math.pi * 2 / rays, 2, 5, HOT)
    end
    for i = 0, rays - 1 do
      ray(g, cx, cy, (i + 0.5) * math.pi * 2 / rays, 3, 4, WARM)
    end
  elseif frame == 2 then
    -- 가운데를 비워 퍼져나가는 링으로 보이게 한다
    for i = 0, rays - 1 do
      ray(g, cx, cy, i * math.pi * 2 / rays, 4, 6, WARM)
    end
    for i = 0, rays - 1 do
      ray(g, cx, cy, (i + 0.5) * math.pi * 2 / rays, 5, 6, EDGE)
    end
  else
    for i = 0, rays - 1 do
      local a = i * math.pi * 2 / rays
      put(g, cx + math.cos(a) * 6.5, cy + math.sin(a) * 6.5, EDGE)
    end
  end
end

-- ---------------------------------------------------------------- 시트 생성

local sprite = Sprite(S, S, ColorMode.RGB)
local layer = sprite.layers[1]
for _ = 2, 8 do sprite:newEmptyFrame() end

for f = 0, 3 do
  for pass = 1, 2 do
    local g = newGrid()
    if pass == 1 then muzzle(g, f) else hit(g, f) end

    local image = Image(S, S, ColorMode.RGB)
    for y = 0, S - 1 do
      for x = 0, S - 1 do
        if g[y][x] ~= nil then image:drawPixel(x, y, g[y][x]) end
      end
    end
    -- muzzle 4프레임(1~4) 다음에 hit 4프레임(5~8)
    local frameNumber = (pass == 1) and (f + 1) or (5 + f)
    sprite:newCel(layer, frameNumber, image, Point(0, 0))
  end
end

local tag = sprite:newTag(1, 4); tag.name = 'muzzle'
tag = sprite:newTag(5, 8); tag.name = 'hit'

sprite:saveAs(app.params['out'])
print('saved: ' .. app.params['out'])
