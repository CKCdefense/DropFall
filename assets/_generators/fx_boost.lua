-- 강화 이펙트 두 가지. 40x40, 배경 투명.
--
--   buff   — 일시 버프(진통제·아드레날린). 8프레임.
--   statup — 영구 스탯 상승(음식). 8프레임.
--
-- 좌표 규약: **캔버스 중심이 대상(캐릭터) 중심**이다. fx_heal과 같은 규격이라
-- 렌더러가 같은 코드로 얹을 수 있다.
--
-- 회복(fx_heal)은 지속 재생이라 매끄럽게 **루프**하지만, 이 둘은 사용하는 순간
-- 한 번 터지고 끝이다. 그래서 루프가 아니라 **시작과 끝이 뚜렷한** 곡선을 쓴다 —
-- 마지막 프레임은 거의 비어 있어야 사라질 때 뚝 끊기지 않는다.
--
-- 둘을 색으로만 구분하지 않는다. 색맹이 아니어도 0.4초짜리 이펙트의 색조는
-- 잘 안 읽힌다. **움직이는 방향**이 다르다:
--   buff   — 바깥에서 몸으로 **모여든다**(힘이 들어온다). 청록.
--   statup — 발밑에서 위로 **솟는다**(수치가 오른다). 금색.

local S = 40
local CX = 19.5
local CY = 19.5
local GROUND = 33
local FRAMES = 8

-- 결과를 재현할 수 있게 고정 시드 LCG를 쓴다(다른 생성기와 같은 방식).
local seed = 1
local function srand(v) seed = v end
local function rnd()
  seed = (1103515245 * seed + 12345) % 2147483648
  return seed / 2147483648
end

-- 버프: 청록 계열. 회복(초록)과 헷갈리지 않게 파랑 쪽으로 충분히 눕혔다.
local B_WHITE = Color{ r = 0xEC, g = 0xFB, b = 0xFF }
local B_LIGHT = Color{ r = 0x9C, g = 0xE8, b = 0xF5 }
local B_MID = Color{ r = 0x45, g = 0xB6, b = 0xE0 }
local B_DEEP = Color{ r = 0x24, g = 0x6E, b = 0xA8 }

-- 스탯: 금색. "영구히 남는 것"이라 가장 값나가는 색을 쓴다.
local G_WHITE = Color{ r = 0xFF, g = 0xF6, b = 0xD8 }
local G_LIGHT = Color{ r = 0xFF, g = 0xD9, b = 0x72 }
local G_MID = Color{ r = 0xE8, g = 0xA5, b = 0x2E }
local G_DEEP = Color{ r = 0xA5, g = 0x66, b = 0x1B }

local function put(image, x, y, color)
  x, y = math.floor(x + 0.5), math.floor(y + 0.5)
  if x < 0 or x >= S or y < 0 or y >= S then return end
  image:drawPixel(x, y, color)
end

--- 2x2 Bayer 디더. coverage(0~1)가 낮을수록 듬성듬성해진다(fx_heal과 같은 함수).
local function dith(x, y, coverage)
  if coverage >= 1 then return true end
  if coverage <= 0 then return false end
  local m = (math.floor(x) % 2) + (math.floor(y) % 2) * 2
  local th = ({ 0.15, 0.65, 0.9, 0.4 })[m + 1]
  return coverage > th
end

--- 타원 고리 한 줄.
local function ring(image, cx, cy, rx, ry, coverage, color)
  local steps = math.ceil(math.max(rx, ry) * 5) + 1
  for i = 0, steps do
    local a = (i / steps) * math.pi * 2
    local x = cx + math.cos(a) * rx
    local y = cy + math.sin(a) * ry
    if dith(x, y, coverage) then put(image, x, y, color) end
  end
end

-- ---------------------------------------------------------------- buff

--- 몸으로 빨려 드는 화살촉. 진행 방향(안쪽)으로 뾰족하게 그린다.
local function drawShard(image, angle, dist, coverage, color, tipColor)
  local ux, uy = math.cos(angle), math.sin(angle)
  local x = CX + ux * dist
  local y = CY + uy * dist * 0.7 -- 세로로 눌러 원근을 준다
  -- 꼬리는 바깥쪽으로 3px. 안쪽 끝이 촉이다.
  for i = 0, 3 do
    local c = i == 0 and tipColor or color
    if dith(x + ux * i, y + uy * i * 0.7, coverage) then
      put(image, x + ux * i, y + uy * i * 0.7, c)
    end
  end
  -- 촉의 양 날개 — 한 픽셀씩이라도 있어야 "화살"로 읽힌다.
  if coverage > 0.5 then
    put(image, x + uy, y - ux, color)
    put(image, x - uy, y + ux, color)
  end
end

local SHARDS = {}
for i = 1, 8 do
  srand(900 + i * 641)
  SHARDS[#SHARDS + 1] = {
    angle = (i - 1) / 8 * math.pi * 2 + rnd() * 0.4,
    delay = rnd() * 0.18, -- 동시에 도착하지 않게 살짝 흩는다
  }
end

local function drawBuff(image, phase)
  -- 1) 모여드는 화살촉: 바깥(18px) → 몸(4px). 늦게 출발한 놈은 아직 바깥에 있다.
  for _, sh in ipairs(SHARDS) do
    local p = (phase - sh.delay) / (1 - sh.delay)
    if p > 0 and p < 1 then
      -- ease-in: 가까워질수록 빨라진다. 빨려 들어가는 느낌이 산다.
      local eased = p * p
      local dist = 18 - eased * 14
      local coverage = p < 0.1 and (p / 0.1) or (p > 0.8 and (1 - p) / 0.2 or 1)
      drawShard(image, sh.angle, dist, coverage, B_MID, B_LIGHT)
    end
  end

  -- 2) 수축하는 고리: 화살촉과 같은 방향으로 조여든다.
  if phase < 0.75 then
    local p = phase / 0.75
    ring(image, CX, CY, 17 - p * 12, (17 - p * 12) * 0.7, 1 - p * 0.7, p < 0.5 and B_DEEP or B_MID)
  end

  -- 3) 도착 섬광: 힘이 다 모인 순간 몸이 번쩍한다. 이게 없으면 화살만 사라진다.
  if phase > 0.45 then
    local p = (phase - 0.45) / 0.55
    local r = 3 + p * 9
    ring(image, CX, CY, r, r * 0.7, 1 - p, p < 0.4 and B_WHITE or B_LIGHT)
    if p < 0.45 then
      for dy = -2, 2 do
        for dx = -2, 2 do
          if math.abs(dx) + math.abs(dy) <= 2 and dith(CX + dx, CY + dy, 1 - p / 0.45) then
            put(image, CX + dx, CY + dy, B_WHITE)
          end
        end
      end
    end
  end

  -- 4) 발밑 여파.
  if phase > 0.5 then
    local p = (phase - 0.5) / 0.5
    ring(image, CX, GROUND, 4 + p * 9, (4 + p * 9) * 0.38, 1 - p, B_MID)
  end
end

-- ---------------------------------------------------------------- statup

--- 위를 향한 화살표(shaft + 촉). 굵게 그려서 "증가"로 대번에 읽히게 한다.
local function drawArrow(image, x, y, coverage, color, tipColor)
  for i = 0, 6 do
    if dith(x, y + i, coverage) then put(image, x, y + i, color) end
    if i > 0 and i < 5 and dith(x + 1, y + i, coverage) then put(image, x + 1, y + i, color) end
  end
  -- 촉: 3단 삼각형.
  for i = 0, 3 do
    for dx = -i, i + 1 do
      if dith(x + dx, y + i, coverage) then
        put(image, x + dx, y + i, i == 0 and tipColor or color)
      end
    end
  end
end

local MOTES = {}
for i = 1, 9 do
  srand(2600 + i * 389)
  MOTES[#MOTES + 1] = {
    x = CX + (rnd() - 0.5) * 24,
    delay = rnd() * 0.38,
    sway = rnd() * math.pi * 2,
  }
end

local function drawStatUp(image, phase)
  -- 1) 발밑 고리가 먼저 퍼진다 — "여기서 무언가 올라온다"는 예고.
  if phase < 0.6 then
    local p = phase / 0.6
    ring(image, CX, GROUND, 6 + p * 10, (6 + p * 10) * 0.4, 1 - p * 0.8, p < 0.5 and G_LIGHT or G_MID)
  end

  -- 2) 큰 화살표가 발밑에서 머리 위로 솟는다. 끝에서 흐려지며 사라진다.
  do
    -- ease-out: 처음에 빠르게 솟고 위에서 멎는다.
    local eased = 1 - (1 - phase) * (1 - phase)
    local y = GROUND - 4 - eased * 24
    local coverage = phase < 0.06 and 0.6 or (phase > 0.62 and (1 - phase) / 0.38 or 1)
    drawArrow(image, CX - 0.5, y, coverage, G_MID, G_WHITE)
  end

  -- 3) 같이 떠오르는 낱알. 화살표 하나만 있으면 심심하고, 이게 무게를 준다.
  for _, m in ipairs(MOTES) do
    local p = (phase - m.delay) / (1 - m.delay)
    if p > 0 and p < 1 then
      local x = m.x + math.sin(m.sway + p * math.pi * 2) * 1.5
      local y = GROUND - p * 22
      local coverage = p > 0.6 and (1 - p) / 0.4 or 1
      if dith(x, y, coverage) then put(image, x, y, p < 0.5 and G_LIGHT or G_DEEP) end
    end
  end

  -- 4) 마무리 반짝임: 화살표가 멎는 자리에서 십자 광채.
  if phase > 0.5 and phase < 0.9 then
    local p = (phase - 0.5) / 0.4
    local y = GROUND - 4 - 24 + 1
    local arm = 1 + math.floor((1 - math.abs(p - 0.5) * 2) * 3)
    for i = -arm, arm do
      put(image, CX - 0.5 + i, y, G_WHITE)
      put(image, CX - 0.5, y + i, G_LIGHT)
    end
  end
end

-- ---------------------------------------------------------------- 시트 생성

local TAGS = {
  { name = 'buff', draw = drawBuff },
  { name = 'statup', draw = drawStatUp },
}

local sprite = Sprite(S, S, ColorMode.RGB)
local layer = sprite.layers[1]
for _ = 2, FRAMES * #TAGS do sprite:newEmptyFrame() end

local index = 0
for _, tagDef in ipairs(TAGS) do
  local from = index + 1
  for f = 1, FRAMES do
    index = index + 1
    local image = Image(S, S, ColorMode.RGB)
    tagDef.draw(image, (f - 1) / (FRAMES - 1))
    sprite:newCel(layer, index, image, Point(0, 0))
  end
  local tag = sprite:newTag(from, index)
  tag.name = tagDef.name
end

sprite:saveAs(app.params['out'])
print('saved: ' .. app.params['out'])
