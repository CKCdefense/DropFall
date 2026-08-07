-- 근접 무기 휘두르기 이펙트. 64x64, 8프레임, 배경 투명.
--
-- 좌표 규약: **캔버스 중심(32,32)이 플레이어 위치**다. 호(arc)는 +x 방향으로 뻗고,
-- 렌더러가 조준각만큼 통째로 회전시킨다. 즉 이 그림은 "오른쪽을 향해 휘두른 순간"이다.
-- 반경 18~30px 구간에 그리는데, 이건 서버 판정 범위(range + 히트박스)와 겹치게
-- 맞춘 값이다 — 이펙트가 닿아 보이는 곳이 실제로 맞는 곳이어야 한다.
--
-- ============================================================================
-- 디자인 방향 — 미니멀 픽셀 슬래시
-- ============================================================================
-- 첫 버전은 4색 띠를 두껍게(배 11px) 겹쳐 쌓고 날 끝에 원반 섬광을 얹었는데,
-- 픽셀아트라기보다 에어브러시처럼 뭉툭했다. 요즘 픽셀 액션(Dead Cells·Katana Zero
-- 계열)의 베기 문법으로 다시 그린다:
--
--  1) **얇고 또렷하게.** 본체는 배에서 3~4px, 양끝은 1px 바늘로 좁아지는 초승달
--     하나다. 색은 3개(흰 심 + 하늘색 + 어두운 강청)뿐이고 그라데이션 층을 쌓지
--     않는다 — 하드 엣지가 곧 픽셀 감성이다.
--  2) **에코 선.** 본체 안쪽에 1px짜리 짧은 호를 한 줄 따라 붙인다. 잔상 두 겹이
--     "빠르게 지나갔다"를 말해 주는 고전 기법이다.
--  3) **파편 소멸.** 끝날 때 통째로 사라지지 않고 호가 대시(짧은 조각)로 부서졌다가
--     낱알 픽셀로 흩어진다. 마지막에 날 끝 자리에 작은 + 스파클 하나 — 딱 거기까지.
--
-- 애니메이션 원리는 그대로다: 선행 날(to)이 각도를 쓸고 나가고 꼬리(from)가 뒤늦게
-- 따라붙는다. 프레임마다 (시작각, 끝각)만 바꾸면 늘어났다 줄어드는 잔상이 된다.

local S = 64
local CX, CY = 32, 32

-- 금속 베기는 차갑게. 3색 — 층을 더 쌓지 않는다.
local CORE = Color{ r = 0xF4, g = 0xF9, b = 0xFF }  -- 흰 심
local SKY  = Color{ r = 0xA9, g = 0xDC, b = 0xF2 }  -- 하늘색 본체
local DIM  = Color{ r = 0x55, g = 0x74, b = 0x9E }  -- 꺼져가는 강청

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

--- 결정론 해시(0~1). 파편을 흩을 때 쓴다 — 프레임을 다시 뽑아도 같은 그림.
local function hash01(a, b)
  local h = (a * 374761393 + b * 668265263) % 2147483647
  h = (h ~ (h >> 13)) * 1274126177 % 2147483647
  return (h % 1000) / 1000
end

local function angleAt(frac)
  return -SPAN / 2 + SPAN * frac
end

--- 초승달 띠 하나. 양끝이 sin 테이퍼로 1px 바늘까지 좁아진다.
--- 두께 계단을 정수로 끊어(hard step) 픽셀 느낌을 유지한다.
local function crescent(g, a0, a1, radius, maxHalf, color)
  if a1 <= a0 then return end
  local steps = math.max(10, math.ceil((a1 - a0) * radius * 2.2))

  for i = 0, steps do
    local t = i / steps
    local angle = a0 + (a1 - a0) * t
    local half = math.floor(maxHalf * math.sin(math.pi * t) + 0.5)
    for dr = -half, half do
      put(g, CX + math.cos(angle) * (radius + dr), CY + math.sin(angle) * (radius + dr), color)
    end
  end
end

--- 호를 따라 놓이는 짧은 대시 조각들. 소멸 프레임에서 본체를 대신한다.
local function dashes(g, a0, a1, radius, count, seed, color)
  for i = 0, count - 1 do
    local t = (i + 0.5) / count
    local jitter = (hash01(seed, i) - 0.5) * 0.06
    local a = a0 + (a1 - a0) * t + jitter
    local len = 2 + math.floor(hash01(seed + 7, i) * 3) -- 2~4px
    -- 접선 방향으로 짧게 긋는다 — 흐름이 남는다.
    for k = 0, len - 1 do
      local aa = a + (k / radius)
      put(g, CX + math.cos(aa) * radius, CY + math.sin(aa) * radius, color)
    end
  end
end

--- 낱알 픽셀. 호 근처에 흩뿌린다(바깥쪽으로 살짝 밀려나며 사라지는 느낌).
local function specks(g, a0, a1, radius, count, seed, color)
  for i = 0, count - 1 do
    local a = a0 + (a1 - a0) * hash01(seed, i)
    local r = radius + 1 + math.floor(hash01(seed + 3, i) * 3)
    put(g, CX + math.cos(a) * r, CY + math.sin(a) * r, color)
  end
end

--- 3px 십자 스파클. 베기 마무리의 점정 — 하나면 충분하다.
local function sparkle(g, x, y, color)
  put(g, x, y, CORE)
  put(g, x + 1, y, color)
  put(g, x - 1, y, color)
  put(g, x, y + 1, color)
  put(g, x, y - 1, color)
end

-- 프레임별 파라미터.
--   from/to : 꼬리·날의 각도 비율. 날(to)이 먼저 달려나가고 꼬리(from)가 늦게 따라온다.
--   radius  : 중심에서 띠까지 거리. 갈수록 커져 바깥으로 퍼진다.
--   half    : 본체 최대 반두께(정수 계단). 2면 배가 4~5px — 이 이상은 뭉툭해진다.
--   stage   : 'in'(진입) 'hot'(절정) 'cool'(식음) 'break'(파편) 'gone'(잔재)
local FRAMES = {
  { from = 0.00, to = 0.22, radius = 20, half = 1, stage = 'in' },
  { from = 0.00, to = 0.52, radius = 22, half = 2, stage = 'hot' },
  { from = 0.06, to = 0.80, radius = 24, half = 2, stage = 'hot' },
  { from = 0.18, to = 1.00, radius = 25, half = 2, stage = 'hot' },
  { from = 0.40, to = 1.00, radius = 26, half = 1, stage = 'cool' },
  { from = 0.60, to = 1.00, radius = 27, half = 1, stage = 'cool' },
  { from = 0.62, to = 1.00, radius = 28, half = 0, stage = 'break' },
  { from = 0.70, to = 1.00, radius = 29, half = 0, stage = 'gone' },
}

local function swing(g, index)
  local f = FRAMES[index]
  local a0, a1 = angleAt(f.from), angleAt(f.to)

  if f.stage == 'in' then
    -- 진입: 하늘색 슬리버 한 줄. 예고는 조용할수록 타격이 산다.
    crescent(g, a0, a1, f.radius, f.half, SKY)
  elseif f.stage == 'hot' then
    -- 절정: 하늘색 본체 + 안쪽 흰 심. 층은 이 둘뿐이다.
    crescent(g, a0, a1, f.radius, f.half, SKY)
    crescent(g, a0 + (a1 - a0) * 0.18, a1, f.radius, math.max(1, f.half - 1), CORE)
    -- 에코 선: 안쪽 반경에 1px 잔상 호. 본체보다 짧고 반 박자 뒤처진다.
    crescent(g, a0, a0 + (a1 - a0) * 0.55, f.radius - 5, 0, DIM)
  elseif f.stage == 'cool' then
    -- 식음: 흰 심이 빠지고 하늘색 → 끝만 흰 점.
    crescent(g, a0, a1, f.radius, f.half, SKY)
    put(g, CX + math.cos(a1) * f.radius, CY + math.sin(a1) * f.radius, CORE)
    crescent(g, a0, a0 + (a1 - a0) * 0.4, f.radius - 5, 0, DIM)
  elseif f.stage == 'break' then
    -- 파편: 본체가 대시로 부서진다. 스파클 하나로 마무리 예고.
    dashes(g, a0, a1, f.radius, 5, index * 31, SKY)
    specks(g, a0, a1, f.radius, 3, index * 57, DIM)
    sparkle(g, CX + math.cos(a1) * (f.radius + 1), CY + math.sin(a1) * (f.radius + 1), SKY)
  else
    -- 잔재: 낱알 몇 개만. 여운은 짧게.
    dashes(g, a0, a1, f.radius, 3, index * 31, DIM)
    specks(g, a0, a1, f.radius, 3, index * 57, DIM)
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
