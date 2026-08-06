-- 폭탄 폭발 이펙트. 64x64, 10프레임, 배경 투명. 태그 'boom'.
--
-- 좌표 규약: **캔버스 중심이 폭발 지점**이다. 방향이 없어 회전 없이 얹는다.
--
-- 4막 구성이다:
--   1) 섬광     — 흰 점광 + 방사선. 폭발의 "번쩍"을 1프레임에 담는다.
--   2) 화구     — 흰 코어→노랑→주황→빨강 램프의 원이 커진다. 가장자리는
--                 각도별 사인 노이즈로 울퉁불퉁하게 — 매끈한 원은 폭발로 안 읽힌다.
--   3) 도넛화   — 코어가 꺼지며 속이 비고, 불 고리 바깥으로 연기가 붙는다.
--   4) 연기 소산 — 불이 사라지고 연기 고리만 남아 디더링으로 흩어진다.
-- 여기에 프레임 3부터 스파크(파편 불꽃)가 바깥으로 튀며 중력에 끌려 떨어진다.

local S = 64
local CX, CY = 31.5, 31.5

-- 결과를 재현할 수 있게 고정 시드 LCG를 쓴다.
local seed = 1
local function srand(v) seed = v end
local function rnd()
  seed = (1103515245 * seed + 12345) % 2147483648
  return seed / 2147483648
end

local CORE = Color{ r = 0xFF, g = 0xF6, b = 0xE0 }
local YELLOW = Color{ r = 0xFF, g = 0xD2, b = 0x4A }
local ORANGE = Color{ r = 0xF0, g = 0x7F, b = 0x2E }
local RED = Color{ r = 0xB4, g = 0x40, b = 0x2A }
local SMOKE_L = Color{ r = 0x8A, g = 0x84, b = 0x94 }
local SMOKE_D = Color{ r = 0x55, g = 0x50, b = 0x5E }

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

--- 2x2 Bayer 디더. coverage(0~1)가 낮을수록 듬성듬성해진다.
local function dith(x, y, coverage)
  if coverage >= 1 then return true end
  local m = (math.floor(x) % 2) + (math.floor(y) % 2) * 2
  local th = ({ 0.15, 0.65, 0.9, 0.4 })[m + 1]
  return coverage > th
end

--- 각도별로 반지름을 흔든다. 3배/7배 주파수를 섞으면 큰 굴곡 위에 잔 굴곡이
--- 얹혀 폭발 특유의 불규칙한 가장자리가 된다. phase를 프레임마다 조금씩 밀어
--- 가장자리가 일렁이게 한다.
local function noisyR(base, angle, phase)
  return base * (1 + 0.13 * math.sin(angle * 3 + phase) + 0.09 * math.sin(angle * 7 + phase * 1.7))
end

-- ---------------------------------------------------------------- 화구

--- 화구(속이 빌 수 있는 불 원반)를 그린다.
---   R        : 바깥 반지름
---   coreFrac : 흰 코어가 차지하는 비율(0이면 코어 없음)
---   hollow   : 속이 비는 안쪽 반지름(0이면 꽉 찬 원)
---   coverage : 불 전체의 디더링 커버리지(꺼져가는 불)
local function drawFireball(g, R, coreFrac, hollow, coverage, phase)
  local reach = math.ceil(R * 1.25)
  for dy = -reach, reach do
    for dx = -reach, reach do
      local dist = math.sqrt(dx * dx + dy * dy)
      local angle = math.atan(dy, dx)
      local Rn = noisyR(R, angle, phase)
      local Hn = hollow > 0 and noisyR(hollow, angle, phase + 2.1) or 0
      if dist <= Rn and dist >= Hn then
        -- 고리 안에서의 상대 위치(0=안쪽, 1=바깥). 안쪽이 가장 뜨겁다.
        local q = hollow > 0 and (dist - Hn) / math.max(Rn - Hn, 0.001) or dist / Rn
        local color
        if coreFrac > 0 and q < coreFrac then
          color = CORE
        elseif q < 0.6 then
          color = YELLOW
        elseif q < 0.85 then
          color = ORANGE
        else
          color = RED
        end
        local px, py = CX + dx, CY + dy
        if dith(px, py, coverage) then put(g, px, py, color) end
      end
    end
  end
end

-- ---------------------------------------------------------------- 연기

--- 화구 둘레를 따라 연기 뭉치를 배치한다. 완전한 고리 대신 원 뭉치의 나열이라
--- 뭉게뭉게한 느낌이 난다. amount(0~1)가 뭉치 크기, coverage가 소산 정도.
local function drawSmoke(g, ringR, amount, coverage, salt)
  local count = 11
  for i = 1, count do
    srand(salt + i * 449)
    local angle = (i / count) * math.pi * 2 + rnd() * 0.5
    local dist = ringR + (rnd() - 0.5) * 3
    local x = CX + math.cos(angle) * dist
    local y = CY + math.sin(angle) * dist - amount * 1.5 -- 연기는 살짝 떠오른다
    local r = 2.5 + amount * 2.5 + rnd() * 1.2
    local innerR2 = (r * 0.5) ^ 2
    local r2 = r * r
    for dy = -math.ceil(r), math.ceil(r) do
      for dx = -math.ceil(r), math.ceil(r) do
        local d2 = dx * dx + dy * dy
        if d2 <= r2 then
          local px, py = x + dx, y + dy
          if dith(px, py, coverage) then
            -- 안쪽이 밝다 — 불빛을 받는 쪽이 화구 방향(안쪽)이라서다.
            put(g, px, py, d2 <= innerR2 and SMOKE_L or SMOKE_D)
          end
        end
      end
    end
  end
end

-- ---------------------------------------------------------------- 스파크

local function makeSparks()
  local sparks = {}
  for i = 1, 14 do
    srand(9000 + i * 787)
    local angle = rnd() * math.pi * 2
    local speed = 3.2 + rnd() * 3.4
    sparks[#sparks + 1] = {
      vx = math.cos(angle) * speed,
      vy = math.sin(angle) * speed - 1.2, -- 위쪽으로 살짝 치우친다
      g = 1.1,
      delay = rnd() * 0.3,
    }
  end
  return sparks
end

local function drawSparks(g, sparks, t)
  for _, sp in ipairs(sparks) do
    local age = t - sp.delay
    if age > 0 then
      local x = CX + sp.vx * age
      local y = CY + sp.vy * age + sp.g * age * age
      local color
      if age < 0.5 then
        color = CORE
      elseif age < 1.1 then
        color = YELLOW
      elseif age < 1.8 then
        color = ORANGE
      else
        color = RED
      end
      put(g, x, y, color)
      -- 어린 스파크는 진행 방향 반대로 꼬리를 남긴다.
      if age < 0.9 then
        put(g, x - sp.vx * 0.25, y - (sp.vy + 2 * sp.g * age) * 0.25, ORANGE)
      end
    end
  end
end

-- ---------------------------------------------------------------- 섬광

local function drawFlash(g)
  for dy = -2, 2 do
    for dx = -2, 2 do
      if dx * dx + dy * dy <= 5 then put(g, CX + dx, CY + dy, CORE) end
    end
  end
  -- 십자 + 대각 방사선. 길이를 달리해 십자가 더 길게 — 카메라 플레어 느낌.
  for i = 3, 8 do
    put(g, CX + i, CY, i < 6 and CORE or YELLOW)
    put(g, CX - i, CY, i < 6 and CORE or YELLOW)
    put(g, CX, CY + i, i < 6 and CORE or YELLOW)
    put(g, CX, CY - i, i < 6 and CORE or YELLOW)
  end
  for i = 2, 4 do
    put(g, CX + i, CY + i, YELLOW)
    put(g, CX - i, CY - i, YELLOW)
    put(g, CX + i, CY - i, YELLOW)
    put(g, CX - i, CY + i, YELLOW)
  end
end

-- 프레임별 파라미터.
--   flash    : 섬광 프레임
--   R        : 화구 바깥 반지름 / coreFrac : 흰 코어 비율 / hollow : 속 빈 반지름
--   fireCov  : 불의 디더링 커버리지(1=온전)
--   smoke    : 연기 뭉치 크기(0~1) / smokeR : 연기 고리 반지름 / smokeCov : 연기 커버리지
--   sparks   : 스파크 시작 여부
local FRAMES = {
  { flash = true },
  { R = 9, coreFrac = 0.55 },
  { R = 16, coreFrac = 0.42, sparks = true },
  { R = 21, coreFrac = 0.26, sparks = true },
  { R = 23, coreFrac = 0.1, hollow = 6, smoke = 0.35, smokeR = 21, smokeCov = 0.9, sparks = true },
  { R = 25, coreFrac = 0, hollow = 12, smoke = 0.7, smokeR = 23, smokeCov = 1, sparks = true },
  { R = 26, coreFrac = 0, hollow = 19, fireCov = 0.6, smoke = 1, smokeR = 24, smokeCov = 1, sparks = true },
  { smoke = 0.9, smokeR = 24, smokeCov = 0.8, sparks = true },
  { smoke = 0.7, smokeR = 25, smokeCov = 0.5 },
  { smoke = 0.5, smokeR = 26, smokeCov = 0.22 },
}

-- ---------------------------------------------------------------- 시트 생성

local sprite = Sprite(S, S, ColorMode.RGB)
local layer = sprite.layers[1]
for _ = 2, #FRAMES do sprite:newEmptyFrame() end

local sparks = makeSparks()

for index = 1, #FRAMES do
  local f = FRAMES[index]
  local g = newGrid()

  -- 연기 → 불 → 스파크 순서로 그린다. 불이 연기 위에, 스파크가 맨 위에 온다.
  if f.smoke then
    drawSmoke(g, f.smokeR, f.smoke, f.smokeCov, 500 + index * 37)
  end
  if f.R then
    drawFireball(g, f.R, f.coreFrac, f.hollow or 0, f.fireCov or 1, 0.6 + index * 0.35)
  end
  if f.flash then drawFlash(g) end
  if f.sparks then
    drawSparks(g, sparks, (index - 2) * 0.45)
  end

  local image = Image(S, S, ColorMode.RGB)
  for y = 0, S - 1 do
    for x = 0, S - 1 do
      if g[y][x] ~= nil then image:drawPixel(x, y, g[y][x]) end
    end
  end
  sprite:newCel(layer, index, image, Point(0, 0))
end

local tag = sprite:newTag(1, #FRAMES)
tag.name = 'boom'

sprite:saveAs(app.params['out'])
print('saved: ' .. app.params['out'])
