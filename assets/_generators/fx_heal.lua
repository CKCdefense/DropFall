-- 치료/회복 이펙트. 40x40, 10프레임 루프, 배경 투명. 태그 'heal'.
--
-- 좌표 규약: **캔버스 중심이 대상(캐릭터) 중심**이다. 캐릭터 위에 겹쳐 그린다.
--
-- 다른 이펙트와 달리 **깔끔하게 루프**되도록 만든다 — 회복은 한 번 터지고 끝이
-- 아니라 지속 시간 동안 반복 재생되기 때문이다. 모든 요소가 위상(0~1)으로
-- 움직이고, 프레임 10 다음에 프레임 1이 와도 이음새가 없다:
--   1) 십자가  — 발밑에서 떠올라 머리 위에서 사라진다. 위상을 어긋나게 둬서
--      항상 몇 개는 화면에 있다. 떠오를수록 밝음→진함으로 식고 디더링으로 소멸.
--   2) 물결 고리 — 발밑 타원이 퍼지며 사라지길 반복한다. 회복의 "파동".
--   3) 반짝이  — 몸 주변 고정 위치에서 깜빡이는 점. 성스러운 느낌의 마무리.

local S = 40
local CX = 19.5
local GROUND = 33 -- 발밑 y
local RISE = 26 -- 십자가가 떠오르는 높이
local FRAMES = 10

-- 결과를 재현할 수 있게 고정 시드 LCG를 쓴다.
local seed = 1
local function srand(v) seed = v end
local function rnd()
  seed = (1103515245 * seed + 12345) % 2147483648
  return seed / 2147483648
end

local WHITE = Color{ r = 0xF2, g = 0xFF, b = 0xE9 }
local MINT = Color{ r = 0xB8, g = 0xF5, b = 0xB0 }
local GREEN = Color{ r = 0x62, g = 0xD9, b = 0x6B }
local DEEP = Color{ r = 0x2F, g = 0xA0, b = 0x5A }

local function put(image, x, y, color)
  x, y = math.floor(x + 0.5), math.floor(y + 0.5)
  if x < 0 or x >= S or y < 0 or y >= S then return end
  image:drawPixel(x, y, color)
end

--- 2x2 Bayer 디더. coverage(0~1)가 낮을수록 듬성듬성해진다.
local function dith(x, y, coverage)
  if coverage >= 1 then return true end
  local m = (math.floor(x) % 2) + (math.floor(y) % 2) * 2
  local th = ({ 0.15, 0.65, 0.9, 0.4 })[m + 1]
  return coverage > th
end

-- ---------------------------------------------------------------- 십자가

local function makeCrosses()
  local crosses = {}
  for i = 1, 6 do
    srand(i * 733)
    crosses[#crosses + 1] = {
      x = CX + (rnd() - 0.5) * 22,
      arm = rnd() < 0.35 and 3 or 2, -- 큰 십자(7px)와 작은 십자(5px)를 섞는다
      off = (i - 1) / 6 + rnd() * 0.08, -- 위상을 고르게 어긋낸다
      sway = rnd() * math.pi * 2,
    }
  end
  return crosses
end

local function drawCross(image, c, phase)
  local p = (phase + c.off) % 1
  local x = c.x + math.sin(c.sway + p * math.pi * 2) * 1.5
  local y = GROUND - p * RISE

  -- 갓 나타날 때와 사라질 때 디더링으로 페이드.
  local coverage = 1
  if p < 0.12 then
    coverage = p / 0.12
  elseif p > 0.7 then
    coverage = (1 - p) / 0.3
  end

  -- 떠오를수록 식는다: 민트 → 그린 → 딥그린.
  local armColor
  if p < 0.35 then
    armColor = MINT
  elseif p < 0.7 then
    armColor = GREEN
  else
    armColor = DEEP
  end

  for i = -c.arm, c.arm do
    if dith(x + i, y, coverage) then put(image, x + i, y, armColor) end
    if i ~= 0 and dith(x, y + i, coverage) then put(image, x, y + i, armColor) end
  end
  -- 중심은 한 단계 밝게 — 십자가가 빛나 보이는 포인트.
  if coverage > 0.4 then
    put(image, x, y, p < 0.5 and WHITE or MINT)
  end
end

-- ---------------------------------------------------------------- 물결 고리

--- 발밑에서 퍼지는 타원 고리. phase 0에서 작게 태어나 1에서 다 퍼지며 사라진다.
--- 루프하면 곧바로 다음 물결이 태어나므로 맥박처럼 반복된다.
local function drawRipple(image, phase)
  local rx = 5 + phase * 10
  local ry = rx * 0.42
  local coverage = 1 - phase * 0.85
  local color = phase < 0.4 and MINT or GREEN

  local steps = math.ceil(rx * 5)
  for i = 0, steps do
    local a = (i / steps) * math.pi * 2
    local x = CX + math.cos(a) * rx
    local y = GROUND + math.sin(a) * ry
    if dith(x, y, coverage) then put(image, x, y, color) end
  end
end

-- ---------------------------------------------------------------- 반짝이

local SPARKLES = {}
for i = 1, 7 do
  srand(4000 + i * 517)
  SPARKLES[#SPARKLES + 1] = {
    x = CX + (rnd() - 0.5) * 26,
    y = 10 + rnd() * 20,
    off = rnd(),
  }
end

local function drawSparkles(image, phase)
  for _, sp in ipairs(SPARKLES) do
    -- 한 루프에 두 번 깜빡인다. 문턱을 넘는 동안만 보인다.
    local tw = math.sin((phase * 2 + sp.off) * math.pi * 2)
    if tw > 0.25 then
      put(image, sp.x, sp.y, tw > 0.8 and WHITE or MINT)
      if tw > 0.8 then
        -- 가장 밝은 순간엔 십자 광채가 된다.
        put(image, sp.x + 1, sp.y, GREEN)
        put(image, sp.x - 1, sp.y, GREEN)
        put(image, sp.x, sp.y + 1, GREEN)
        put(image, sp.x, sp.y - 1, GREEN)
      end
    end
  end
end

-- ---------------------------------------------------------------- 시트 생성

local sprite = Sprite(S, S, ColorMode.RGB)
local layer = sprite.layers[1]
for _ = 2, FRAMES do sprite:newEmptyFrame() end

local crosses = makeCrosses()

for index = 1, FRAMES do
  local phase = (index - 1) / FRAMES
  local image = Image(S, S, ColorMode.RGB)

  drawRipple(image, phase)
  for _, c in ipairs(crosses) do drawCross(image, c, phase) end
  drawSparkles(image, phase)

  sprite:newCel(layer, index, image, Point(0, 0))
end

local tag = sprite:newTag(1, FRAMES)
tag.name = 'heal'

sprite:saveAs(app.params['out'])
print('saved: ' .. app.params['out'])
