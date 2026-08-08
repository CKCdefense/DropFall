-- 레벨업 이펙트. 48x48, 10프레임, 배경 투명. 태그 'levelup'.
--
-- 좌표 규약: **캔버스 중심이 대상(캐릭터) 중심**이다. fx_heal/fx_boost와 같은 규약이라
-- 렌더러가 같은 코드로 얹는다. 다만 캔버스가 한 치수 크다 — 레벨업은 판마다 몇 번
-- 없는 사건이라, 소모품 이펙트보다 크고 오래 남아야 "축하"로 읽힌다.
--
-- 음식의 스탯 상승(fx_boost/statup)과 헷갈리면 안 된다. 그쪽은 금빛 화살표 하나가
-- 위로 솟고 끝이지만, 이쪽은 **발밑에서 빛 기둥이 서고 고리가 퍼진다** — 몸 전체가
-- 감싸이는 실루엣이라 멀리서도 다르다.

local S = 48
local CX = 23.5
local GROUND = 40
local FRAMES = 10

local seed = 7
local function srand(v) seed = v end
local function rnd()
  seed = (1103515245 * seed + 12345) % 2147483648
  return seed / 2147483648
end

-- 금빛 4색. 위로 갈수록 밝아지는 기둥이라 밝은 쪽을 넉넉히 둔다.
local WHITE = Color{ r = 0xFF, g = 0xFB, b = 0xE4 }
local LIGHT = Color{ r = 0xFF, g = 0xE2, b = 0x8F }
local MID = Color{ r = 0xF0, g = 0xB0, b = 0x3A }
local DEEP = Color{ r = 0xA8, g = 0x6A, b = 0x1C }

local function put(image, x, y, color)
  x, y = math.floor(x + 0.5), math.floor(y + 0.5)
  if x < 0 or x >= S or y < 0 or y >= S then return end
  image:drawPixel(x, y, color)
end

--- 2x2 Bayer 디더(다른 이펙트와 같은 함수).
local function dith(x, y, coverage)
  if coverage >= 1 then return true end
  if coverage <= 0 then return false end
  local m = (math.floor(x) % 2) + (math.floor(y) % 2) * 2
  local th = ({ 0.15, 0.65, 0.9, 0.4 })[m + 1]
  return coverage > th
end

local function ring(image, cx, cy, rx, ry, coverage, color)
  local steps = math.ceil(math.max(rx, ry) * 5) + 1
  for i = 0, steps do
    local a = (i / steps) * math.pi * 2
    if dith(cx + math.cos(a) * rx, cy + math.sin(a) * ry, coverage) then
      put(image, cx + math.cos(a) * rx, cy + math.sin(a) * ry, color)
    end
  end
end

--- 빛 기둥. 발밑에서 위로 자라며 폭이 좁아지고, 끝에서 흩어진다.
local function pillar(image, phase)
  -- 앞 60%에 다 자란다. 그 뒤로는 위쪽부터 사라진다.
  local grow = math.min(1, phase / 0.6)
  local top = GROUND - grow * 34
  local fade = phase > 0.6 and (1 - phase) / 0.4 or 1

  local y = GROUND
  while y >= top do
    -- 위로 갈수록 좁아진다(아래 7px → 위 2px).
    local t = (GROUND - y) / 34
    local halfWidth = 7 - t * 5
    local coverage = fade * (1 - t * 0.35)
    for dx = -halfWidth, halfWidth do
      local edge = math.abs(dx) / math.max(1, halfWidth)
      local color = edge > 0.75 and DEEP or (edge > 0.45 and MID or (t > 0.5 and WHITE or LIGHT))
      if dith(CX + dx, y, coverage * (1 - edge * 0.4)) then put(image, CX + dx, y, color) end
    end
    y = y - 1
  end
end

--- 발밑 고리 두 겹. 시차를 둬서 파문처럼 이어진다.
local function rings(image, phase)
  for index = 0, 1 do
    local p = phase - index * 0.25
    if p > 0 and p < 1 then
      local r = 4 + p * 18
      ring(image, CX, GROUND, r, r * 0.4, (1 - p) * 0.9, p < 0.5 and LIGHT or MID)
    end
  end
end

--- 기둥을 따라 위로 흐르는 불티. 기둥만 있으면 정지 화면처럼 보인다.
local SPARKS = {}
for i = 1, 10 do
  srand(1500 + i * 271)
  SPARKS[#SPARKS + 1] = {
    x = CX + (rnd() - 0.5) * 20,
    delay = rnd() * 0.45,
    sway = rnd() * math.pi * 2,
  }
end

local function sparks(image, phase)
  for _, sp in ipairs(SPARKS) do
    local p = (phase - sp.delay) / (1 - sp.delay)
    if p > 0 and p < 1 then
      local x = sp.x + math.sin(sp.sway + p * math.pi * 3) * 2
      local y = GROUND - p * 36
      local coverage = p > 0.65 and (1 - p) / 0.35 or 1
      if dith(x, y, coverage) then put(image, x, y, p < 0.5 and WHITE or LIGHT) end
    end
  end
end

--- 마무리 섬광: 다 자란 기둥 꼭대기에서 별 모양으로 터진다.
local function burst(image, phase)
  if phase < 0.5 or phase > 0.95 then return end
  local p = (phase - 0.5) / 0.45
  local y = GROUND - 34
  local arm = 2 + math.floor((1 - math.abs(p - 0.4) * 2) * 5)
  if arm <= 2 then return end
  for i = -arm, arm do
    put(image, CX + i, y, i == 0 and WHITE or LIGHT)
    put(image, CX, y + i, i == 0 and WHITE or LIGHT)
    -- 대각선은 절반 길이 — 별이 십자보다 부드럽게 읽힌다.
    if math.abs(i) <= arm / 2 then
      put(image, CX + i, y + i, MID)
      put(image, CX + i, y - i, MID)
    end
  end
end

local sprite = Sprite(S, S, ColorMode.RGB)
local layer = sprite.layers[1]
for _ = 2, FRAMES do sprite:newEmptyFrame() end

for index = 1, FRAMES do
  local phase = (index - 1) / (FRAMES - 1)
  local image = Image(S, S, ColorMode.RGB)
  rings(image, phase)
  pillar(image, phase)
  sparks(image, phase)
  burst(image, phase)
  sprite:newCel(layer, index, image, Point(0, 0))
end

local tag = sprite:newTag(1, FRAMES)
tag.name = 'levelup'

sprite:saveAs(app.params['out'])
print('saved: ' .. app.params['out'])
