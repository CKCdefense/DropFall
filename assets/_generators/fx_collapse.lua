-- 구조물 붕괴 이펙트. 48x48, 태그 2개 × 9프레임, 배경 투명.
--   wood  : 나무 울타리/벽 — 갈색 먼지와 나무 파편
--   stone : 돌 벽 — 회색 먼지와 돌 파편
--
-- 좌표 규약: **캔버스 하단 근처(GY=38)가 지면**이고 가로 중심이 구조물 위치다.
-- 방향이 없어 회전 없이 구조물 자리에 그대로 얹는다.
--
-- 구성 요소는 넷이다:
--   1) 먼지 둔덕 — 무너진 잔해 위로 낮고 넓게 쌓이는 먼지 더미. 붕괴의 "질량"을
--      담당한다. 윗선을 사인으로 울퉁불퉁하게 깎아 잔해처럼 보이게 한다.
--   2) 먼지 뭉치 — 둔덕 가장자리에서 좌우로 퍼지며 낮게 피어오르는 작은 원들.
--      밝음→중간→어두움으로 식고, 마지막엔 디더링으로 흩어져 사라진다.
--   3) 파편 — 구조물 몸통에서 튀어나와 포물선으로 떨어지고, 지면에서 한 번
--      튕긴 뒤 잠깐 놓였다가 먼지에 묻혀 사라진다.
--   4) 붕괴 순간의 임팩트 — 첫 프레임의 지면 분출선. 무너지는 "쿵"을 만든다.

local S = 48
local CX = 23.5
local GY = 38 -- 지면 y. 구조물 바닥과 맞춘다.
local FRAMES = 9

-- 결과를 재현할 수 있게 고정 시드 LCG를 쓴다.
local seed = 1
local function srand(v) seed = v end
local function rnd()
  seed = (1103515245 * seed + 12345) % 2147483648
  return seed / 2147483648
end

-- light/mid/dark는 먼지 램프, d1/d2는 파편 색.
local PALETTES = {
  wood = {
    light = Color{ r = 0xD8, g = 0xC2, b = 0x9A },
    mid = Color{ r = 0xB0, g = 0x97, b = 0x70 },
    dark = Color{ r = 0x80, g = 0x6C, b = 0x50 },
    d1 = Color{ r = 0x8A, g = 0x62, b = 0x3C },
    d2 = Color{ r = 0x6B, g = 0x4A, b = 0x2E },
  },
  stone = {
    light = Color{ r = 0xC2, g = 0xC6, b = 0xCE },
    mid = Color{ r = 0x9A, g = 0x9F, b = 0xA8 },
    dark = Color{ r = 0x71, g = 0x75, b = 0x7E },
    d1 = Color{ r = 0x8A, g = 0x8F, b = 0x99 },
    d2 = Color{ r = 0x60, g = 0x64, b = 0x6D },
  },
}

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

--- 2x2 Bayer 디더. coverage(0~1)가 낮을수록 듬성듬성 찍혀 "흩어져 사라지는" 느낌이 난다.
local function dith(x, y, coverage)
  if coverage >= 1 then return true end
  local m = (math.floor(x) % 2) + (math.floor(y) % 2) * 2
  local th = ({ 0.15, 0.65, 0.9, 0.4 })[m + 1]
  return coverage > th
end

-- ---------------------------------------------------------------- 먼지 둔덕

--- 무너진 잔해 위에 낮고 넓게 쌓이는 먼지 더미. 시간이 갈수록 옆으로 퍼져
--- 낮아지다가 디더링으로 사라진다.
local function drawMound(g, pal, t)
  local rx = math.min(18, 7 + t * 4.5)
  local ry = math.min(6, 3.2 + t * 1.1)
  local coverage = t < 2.0 and 1 or math.max(0, 1 - (t - 2.0) / 1.7)
  if coverage <= 0 then return end

  for dx = -math.ceil(rx), math.ceil(rx) do
    local u = dx / rx
    if u * u < 1 then
      -- 윗선을 사인으로 깎아 잔해 더미처럼 울퉁불퉁하게 만든다.
      local h = ry * math.sqrt(1 - u * u) * (0.75 + 0.25 * math.sin(dx * 1.3 + t * 0.8))
      for dy = 0, math.floor(h) do
        local px, py = CX + dx, GY - dy
        if dith(px, py, coverage) then
          -- 갓 무너졌을 땐 윗면이 밝고, 식으면 전체가 가라앉는다.
          local color
          if t < 1.4 and dy >= h - 1.2 then
            color = pal.light
          elseif t < 2.4 then
            color = dy >= h - 1.5 and pal.mid or pal.dark
          else
            color = pal.dark
          end
          put(g, px, py, color)
        end
      end
    end
  end
end

-- ---------------------------------------------------------------- 먼지 뭉치

local PUFF_LIFE = 2.9

local function makePuffs(salt)
  local puffs = {}
  local count = 12
  for i = 1, count do
    srand(salt + i * 613)
    rnd() -- LCG 첫 출력은 시드와 상관이 강해 버린다
    -- 좌우로 고르게 배치하고 지터만 난수로 — 난수만 쓰면 한쪽에 뭉친다.
    local side = ((i - 1) / (count - 1) - 0.5) * 2 -- -1 ~ 1
    puffs[#puffs + 1] = {
      x0 = CX + side * 13 + (rnd() - 0.5) * 4,
      y0 = GY - 1 - rnd() * 2,
      vx = side * (2.6 + rnd() * 2.2), -- 바깥쪽으로 퍼진다
      vy = -(0.4 + rnd() * 1.1), -- 살짝만 떠오른다 — 낮게 깔려야 붕괴로 읽힌다
      born = math.abs(side) * 0.5 + rnd() * 0.3, -- 안쪽부터 터져 바깥으로 번진다
      grow = 1.3 + rnd() * 0.9,
      rmax = 2.6 + rnd() * 2.2,
    }
  end
  return puffs
end

local function drawPuff(g, pal, p, t)
  local age = t - p.born
  if age <= 0 then return end
  local lifeFrac = age / PUFF_LIFE
  if lifeFrac >= 1 then return end

  -- 수평 확산은 점점 느려진다(공기 저항 흉내). 상승은 일정하게 유지.
  local x = p.x0 + p.vx * age * (1 - lifeFrac * 0.45)
  local y = math.min(p.y0 + p.vy * age, GY - 1)
  local r = math.min(p.rmax, 1.0 + p.grow * age)

  -- 수명 앞 55%는 온전하게, 이후는 디더링 커버리지를 줄여 흩어진다.
  local coverage = lifeFrac < 0.55 and 1 or (1 - (lifeFrac - 0.55) / 0.45)

  -- 어릴수록 밝다: 갓 인 먼지는 빛을 받고, 식으면 그늘 색으로 가라앉는다.
  local inner, outer
  if lifeFrac < 0.3 then
    inner, outer = pal.light, pal.mid
  elseif lifeFrac < 0.65 then
    inner, outer = pal.mid, pal.dark
  else
    inner, outer = pal.dark, pal.dark
  end

  local innerR2 = (r * 0.55) ^ 2
  local r2 = r * r
  for dy = -math.ceil(r), math.ceil(r) do
    for dx = -math.ceil(r), math.ceil(r) do
      local d2 = dx * dx + dy * dy
      if d2 <= r2 then
        local px, py = x + dx, y + dy
        if dith(px, py, coverage) then
          put(g, px, py, d2 <= innerR2 and inner or outer)
        end
      end
    end
  end
end

-- ---------------------------------------------------------------- 파편

local function makeDebris(salt)
  local debris = {}
  for i = 1, 9 do
    srand(salt + i * 977)
    rnd() -- LCG 첫 출력은 시드와 상관이 강해 버린다
    local side = (i % 2 == 0 and 1 or -1) * (0.3 + rnd() * 0.7) -- 좌우 번갈아 확실히 벌린다
    debris[#debris + 1] = {
      x0 = CX + side * 8,
      y0 = GY - 6 - rnd() * 12, -- 구조물 몸통 높이에서 떨어져 나온다
      vx = side * (1.6 + rnd() * 3.2),
      vy = -(0.8 + rnd() * 2.6),
      g = 1.5,
      big = rnd() < 0.55, -- 큰 조각은 2x2, 작은 조각은 1px
      dark = rnd() < 0.4,
    }
  end
  return debris
end

--- dt 적분으로 위치를 구한다. 지면에서 한 번 튕기는 걸 해석적으로 풀기 번거로워서다.
--- 반환: x, y, settledTime(착지 후 경과 시간 — 페이드아웃에 쓴다)
local function debrisPos(d, t)
  local x, y, vx, vy = d.x0, d.y0, d.vx, d.vy
  local settled = 0
  local dt = 0.08
  local steps = math.floor(t / dt)
  for _ = 1, steps do
    vy = vy + d.g * dt
    x = x + vx * dt
    y = y + vy * dt
    if y >= GY then
      y = GY
      if vy > 1.6 then
        vy = -vy * 0.35 -- 세게 떨어지면 한 번 튕긴다
        vx = vx * 0.6
      else
        vy, vx = 0, 0
        settled = settled + dt
      end
    end
  end
  return x, y, settled
end

local function drawDebris(g, pal, debris, t)
  for _, d in ipairs(debris) do
    local x, y, settled = debrisPos(d, t)
    -- 착지 후 1.1초에 걸쳐 디더링으로 사라진다(먼지에 묻히는 느낌).
    local coverage = settled <= 0 and 1 or math.max(0, 1 - settled / 1.1)
    if coverage > 0 then
      local color = d.dark and pal.d2 or pal.d1
      if dith(x, y, coverage) then put(g, x, y, color) end
      if d.big then
        if dith(x + 1, y, coverage) then put(g, x + 1, y, color) end
        if dith(x, y - 1, coverage) then put(g, x, y - 1, color) end
        if dith(x + 1, y - 1, coverage) then put(g, x + 1, y - 1, pal.d2) end
      end
    end
  end
end

-- ---------------------------------------------------------------- 임팩트

--- 붕괴 순간 지면을 따라 좌우로 뿜어지는 분출선. 첫 두 프레임에만.
local function drawImpact(g, pal, t)
  if t >= 1.0 then return end
  local reach = 6 + t * 14
  for _, dir in ipairs({ -1, 1 }) do
    for i = 2, reach do
      local fade = i / reach
      local color = fade < 0.5 and pal.light or pal.mid
      if dith(CX + dir * i, GY, 1 - fade * 0.5) then
        put(g, CX + dir * i, GY - (i % 3 == 0 and 1 or 0), color)
      end
    end
  end
end

-- ---------------------------------------------------------------- 시트 생성

local sprite = Sprite(S, S, ColorMode.RGB)
local layer = sprite.layers[1]
for _ = 2, FRAMES * 2 do sprite:newEmptyFrame() end

local frame = 1
for _, kind in ipairs({ 'wood', 'stone' }) do
  local first = frame
  local pal = PALETTES[kind]
  local salt = kind == 'wood' and 31 or 131
  local puffs = makePuffs(salt)
  local debris = makeDebris(salt + 7)

  for f = 0, FRAMES - 1 do
    local t = 0.25 + f * 0.42
    local g = newGrid()

    -- 둔덕이 바닥, 그 위에 먼지 뭉치. 파편은 초반(막 튀어나온 순간)엔 맨 위,
    -- 후반엔 피어오른 먼지에 묻힌다.
    drawMound(g, pal, t)
    if t < 1.3 then
      for _, p in ipairs(puffs) do drawPuff(g, pal, p, t) end
      drawDebris(g, pal, debris, t)
    else
      drawDebris(g, pal, debris, t)
      for _, p in ipairs(puffs) do drawPuff(g, pal, p, t) end
    end
    drawImpact(g, pal, t)

    local image = Image(S, S, ColorMode.RGB)
    for y = 0, S - 1 do
      for x = 0, S - 1 do
        if g[y][x] ~= nil then image:drawPixel(x, y, g[y][x]) end
      end
    end
    sprite:newCel(layer, frame, image, Point(0, 0))
    frame = frame + 1
  end

  local tag = sprite:newTag(first, frame - 1)
  tag.name = kind
end

sprite:saveAs(app.params['out'])
print('saved: ' .. app.params['out'])
