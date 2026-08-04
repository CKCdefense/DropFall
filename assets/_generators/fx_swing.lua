-- 근접 무기 휘두르기 이펙트. 64x64, 8프레임, 배경 투명.
--
-- 좌표 규약: **캔버스 중심(32,32)이 플레이어 위치**다. 호(arc)는 +x 방향으로 뻗고,
-- 렌더러가 조준각만큼 통째로 회전시킨다. 즉 이 그림은 "오른쪽을 향해 휘두른 순간"이다.
-- 반경 18~30px 구간에 그리는데, 이건 서버 판정 범위(range 24 + 히트박스 10)와 겹치게
-- 맞춘 값이다 — 이펙트가 닿아 보이는 곳이 실제로 맞는 곳이어야 한다.
--
-- 애니메이션 원리: 칼자국은 "선"이 아니라 **잔상**이다. 선행 날(leading edge)이 각도를
-- 쓸고 지나가고 후행 꼬리(trailing edge)가 뒤늦게 따라붙으면서, 짧은 초승달이 길게
-- 늘어났다가 다시 짧아지며 사라진다. 프레임마다 (시작각, 끝각)만 바꾸면 이 느낌이 난다.
-- 동시에 반경을 조금씩 키워서 바깥으로 퍼지게 한다.

local S = 64
local CX, CY = 32, 32

-- 불(총구 화염)과 달리 금속 베기는 차갑게 간다. 밤 배경에서 주황 계열끼리 뭉치지 않도록.
local CORE = Color{ r = 255, g = 255, b = 255 }
local BRIGHT = Color{ r = 214, g = 236, b = 255 }
local MID = Color{ r = 138, g = 182, b = 228 }
local EDGE = Color{ r = 74, g = 104, b = 156 }

--- 휘두르는 총 각도(라디안). 서버의 부채꼴 판정 각도와 같은 값이어야 한다.
local SPAN = math.rad(100)

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

--- 비율(0~1)을 실제 각도로. 0이 휘두르기 시작, 1이 끝.
local function angleAt(frac)
  return -SPAN / 2 + SPAN * frac
end

--- 초승달 모양 띠. 양 끝으로 갈수록 얇아져서 뿔이 생긴다 — 이게 "베인 자국"의 핵심이다.
--- thinStart를 켜면 시작쪽(꼬리)만 얇아지고 끝쪽(날)은 두껍게 남아 진행 방향이 읽힌다.
local function crescent(g, a0, a1, radius, halfThick, color, thinStart)
  if a1 <= a0 then return end
  local steps = math.max(8, math.ceil((a1 - a0) * radius * 2))

  for i = 0, steps do
    local t = i / steps
    local angle = a0 + (a1 - a0) * t
    -- sin 프로파일은 양끝이 0이라 뿔이 자연스럽다. thinStart는 뒤쪽만 깎는다.
    local taper = thinStart and math.sin(math.pi * t * 0.5) or math.sin(math.pi * t)
    local thickness = halfThick * taper
    if thickness > 0 then
      local dr = -thickness
      while dr <= thickness do
        put(g, CX + math.cos(angle) * (radius + dr), CY + math.sin(angle) * (radius + dr), color)
        dr = dr + 0.5
      end
    end
  end
end

-- 프레임별 파라미터.
--   from/to : 꼬리·날의 각도 비율. 날(to)이 먼저 달려나가고 꼬리(from)가 늦게 따라온다.
--   radius  : 중심에서 띠까지 거리. 갈수록 커져 바깥으로 퍼진다.
--   thick   : 띠 두께(반). 중간 프레임이 가장 굵다.
--   tier    : 1=흐릿함 2=보통 3=가장 밝음. 색 층 개수를 정한다.
local FRAMES = {
  { from = 0.00, to = 0.18, radius = 18, thick = 2.0, tier = 1 },
  { from = 0.00, to = 0.46, radius = 20, thick = 3.5, tier = 2 },
  { from = 0.04, to = 0.72, radius = 22, thick = 5.0, tier = 3 },
  { from = 0.12, to = 0.92, radius = 24, thick = 5.5, tier = 3 },
  { from = 0.28, to = 1.00, radius = 26, thick = 5.0, tier = 3 },
  { from = 0.50, to = 1.00, radius = 28, thick = 3.5, tier = 2 },
  { from = 0.70, to = 1.00, radius = 29, thick = 2.0, tier = 1 },
  { from = 0.86, to = 1.00, radius = 30, thick = 1.2, tier = 1 },
}

local function swing(g, index)
  local f = FRAMES[index]
  local a0, a1 = angleAt(f.from), angleAt(f.to)

  -- 바깥에서 안쪽으로 겹쳐 칠한다. 넓고 어두운 색 위에 좁고 밝은 색이 올라가면서
  -- 별도의 안티에일리어싱 없이 가장자리 그라데이션이 생긴다.
  crescent(g, a0, a1, f.radius, f.thick, EDGE, true)
  crescent(g, a0, a1, f.radius, f.thick * 0.72, MID, true)
  if f.tier >= 2 then
    crescent(g, a0, a1, f.radius, f.thick * 0.42, BRIGHT, true)
  end
  if f.tier >= 3 then
    crescent(g, a0, a1, f.radius, f.thick * 0.18, CORE, true)
  end

  -- 선행 날 끝의 섬광. 진행 방향을 눈에 띄게 해준다.
  if f.tier >= 2 then
    local tipX, tipY = CX + math.cos(a1) * f.radius, CY + math.sin(a1) * f.radius
    if f.tier >= 3 then
      disc(g, tipX, tipY, 3, BRIGHT)
      disc(g, tipX, tipY, 2, CORE)
    else
      disc(g, tipX, tipY, 2, BRIGHT)
    end
  end

  -- 마지막 두 프레임은 띠를 조각내 흩어지게 한다. 통째로 사라지면 뚝 끊긴 느낌이 난다.
  if index >= 7 then
    for i = 0, 4 do
      local a = a0 + (a1 - a0) * (i / 4)
      put(g, CX + math.cos(a) * (f.radius + 2), CY + math.sin(a) * (f.radius + 2), EDGE)
    end
  end
end

-- ---------------------------------------------------------------- 시트 생성

local sprite = Sprite(S, S, ColorMode.RGB)
local layer = sprite.layers[1]
for _ = 2, #FRAMES do sprite:newEmptyFrame() end

for index = 1, #FRAMES do
  local g = newGrid()
  swing(g, index)

  local image = Image(S, S, ColorMode.RGB)
  for y = 0, S - 1 do
    for x = 0, S - 1 do
      if g[y][x] ~= nil then image:drawPixel(x, y, g[y][x]) end
    end
  end
  sprite:newCel(layer, index, image, Point(0, 0))
end

local tag = sprite:newTag(1, #FRAMES)
tag.name = 'arc'

sprite:saveAs(app.params['out'])
print('saved: ' .. app.params['out'])
