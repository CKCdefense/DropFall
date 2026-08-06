-- 코어 이펙트. 태그 2개, 배경 투명.
--   glint   : 48x48 · 12프레임 — 중앙 수정이 주기적으로 반짝인다(반복 재생)
--   upgrade : 96x96 · 14프레임 — 티어를 올렸을 때 한 번 터진다
--
-- 좌표 규약: **캔버스 중심이 수정의 중심**이다. 방향이 없어 회전 없이 그대로 얹는다.
-- 두 이펙트의 캔버스 크기가 다른 이유는 upgrade가 코어 전체를 감싸야 해서다 —
-- 렌더러가 태그별로 다른 배율을 쓰지 않도록, 커버할 범위만큼 캔버스를 키웠다.
--
-- 색은 코어 스프라이트의 청록 수정에서 가져왔다. 이펙트만 다른 색이면 "코어에서
-- 나오는 빛"이 아니라 그 위에 얹힌 별개 물체로 보인다.

local GLINT_SIZE = 48
local GLINT_FRAMES = 12
local UPGRADE_SIZE = 96
local UPGRADE_FRAMES = 14

local CYAN_CORE = Color{ r = 0xF2, g = 0xFF, b = 0xFE }
local CYAN_MID  = Color{ r = 0xA8, g = 0xF0, b = 0xE8 }
local CYAN_EDGE = Color{ r = 0x5A, g = 0xD6, b = 0xC8 }
local CYAN_DEEP = Color{ r = 0x2E, g = 0x8F, b = 0x88 }
local GOLD      = Color{ r = 0xF0, g = 0xC0, b = 0x50 }

--- 알파를 섞은 색. 이펙트는 겹쳐 그려지므로 경계가 딱 끊기면 스티커처럼 보인다.
local function fade(color, alpha)
  local a = math.floor(math.max(0, math.min(1, alpha)) * 255)
  return Color{ r = color.red, g = color.green, b = color.blue, a = a }
end

local function put(image, size, x, y, color)
  x, y = math.floor(x + 0.5), math.floor(y + 0.5)
  if x < 0 or x >= size or y < 0 or y >= size then return end
  image:drawPixel(x, y, color)
end

--- 속이 빈 원. 반지름이 정수가 아니어도 두께가 고르게 나오도록 각도로 돈다.
local function ring(image, size, cx, cy, radius, color)
  local steps = math.max(8, math.floor(radius * 8))
  for i = 0, steps - 1 do
    local angle = (i / steps) * math.pi * 2
    put(image, size, cx + math.cos(angle) * radius, cy + math.sin(angle) * radius, color)
  end
end

--- 꽉 찬 원.
local function disc(image, size, cx, cy, radius, color)
  local r2 = radius * radius
  for y = math.floor(cy - radius), math.ceil(cy + radius) do
    for x = math.floor(cx - radius), math.ceil(cx + radius) do
      local dx, dy = x - cx, y - cy
      if dx * dx + dy * dy <= r2 then put(image, size, x, y, color) end
    end
  end
end

--- 십자 섬광. 반짝임은 원보다 **뾰족한 십자**로 그려야 "빛난다"로 읽힌다.
local function sparkle(image, size, cx, cy, length, color, tipColor)
  for d = 0, length do
    local alpha = 1 - d / (length + 1)
    local c = fade(color, alpha)
    put(image, size, cx + d, cy, c)
    put(image, size, cx - d, cy, c)
    put(image, size, cx, cy + d, c)
    put(image, size, cx, cy - d, c)
  end
  -- 대각선은 절반 길이로 — 네 방향만 뻗으면 십자가 너무 앙상하다.
  for d = 1, math.floor(length / 2) do
    local c = fade(color, 0.7 - d / (length + 1))
    put(image, size, cx + d, cy + d, c)
    put(image, size, cx - d, cy + d, c)
    put(image, size, cx + d, cy - d, c)
    put(image, size, cx - d, cy - d, c)
  end
  put(image, size, cx, cy, tipColor)
end

-- ---------------------------------------------------------------- glint

--- 수정이 한 번 반짝였다 잦아든다.
---
--- t는 0~1. 앞쪽(0~0.35)에서 빠르게 차오르고 뒤쪽에서 길게 사그라진다 — 밝기가
--- 대칭이면 깜빡이는 전구처럼 보이고, 비대칭이어야 "빛이 스쳤다"가 된다.
local function drawGlint(image, t)
  local cx, cy = GLINT_SIZE / 2 - 0.5, GLINT_SIZE / 2 - 0.5

  local rise = math.min(1, t / 0.35)
  local fall = t <= 0.35 and 1 or (1 - (t - 0.35) / 0.65)
  local intensity = rise * fall * fall -- 사그라지는 쪽을 제곱해 꼬리를 길게

  if intensity <= 0.02 then return end

  -- 후광. 수정 자체가 이미 하얗게 밝아서, 여기서 더 밝히면 아무 변화도 안 보인다 —
  -- 대신 수정 **바깥** 어두운 돌 위로 번지게 해야 빛이 샌 것처럼 읽힌다.
  disc(image, GLINT_SIZE, cx, cy, 11 + intensity * 5, fade(CYAN_DEEP, intensity * 0.22))
  disc(image, GLINT_SIZE, cx, cy, 7 + intensity * 3, fade(CYAN_EDGE, intensity * 0.28))

  -- 퍼져나가는 얇은 고리 — 반짝임에 "맥동"을 준다.
  local ringRadius = 8 + t * 14
  ring(image, GLINT_SIZE, cx, cy, ringRadius, fade(CYAN_MID, intensity * 0.7))

  -- 광선은 수정 지름(화면상 21px쯤)보다 길어야 밖으로 삐져나온다. 안에 갇히면
  -- 하얀 구슬 위의 하얀 십자라 아무것도 안 보인다.
  sparkle(image, GLINT_SIZE, cx, cy, math.floor(10 + intensity * 11), CYAN_CORE, CYAN_CORE)
end

-- ---------------------------------------------------------------- upgrade

--- 티어를 올렸을 때. 안에서 빛이 터져 나와 고리 두 개가 퍼지고, 금빛 입자가 위로 오른다.
local function drawUpgrade(image, t)
  local cx, cy = UPGRADE_SIZE / 2 - 0.5, UPGRADE_SIZE / 2 - 0.5

  -- 1) 중심 섬광 — 처음 30%에만. 터지는 순간을 알린다.
  if t < 0.3 then
    local k = 1 - t / 0.3
    disc(image, UPGRADE_SIZE, cx, cy, 6 + k * 10, fade(CYAN_CORE, k * 0.9))
    disc(image, UPGRADE_SIZE, cx, cy, 3 + k * 5, fade(CYAN_CORE, k))
  end

  -- 2) 퍼지는 고리 두 개. 시차를 둬야 한 겹보다 "밀려나오는" 느낌이 산다.
  --
  -- 고리는 **두껍게** 그린다. 1px 두께에 옅은 알파로 그렸더니 어두운 돌바닥 위에서
  -- 거의 안 보였다 — 재생은 되는데 화면에서는 아무 일도 안 일어난 것처럼 됐다.
  for index, delay in ipairs({ 0, 0.2 }) do
    local k = (t - delay) / (1 - delay)
    if k > 0 and k < 1 then
      local radius = 4 + k * (UPGRADE_SIZE / 2 - 8)
      -- 끝에서만 빠르게 사라지도록(1-k)^0.6 — 선형이면 중간부터 이미 흐릿하다.
      local alpha = math.pow(1 - k, 0.6) * (index == 1 and 1 or 0.75)
      ring(image, UPGRADE_SIZE, cx, cy, radius, fade(CYAN_CORE, alpha))
      ring(image, UPGRADE_SIZE, cx, cy, radius - 1, fade(CYAN_MID, alpha * 0.9))
      ring(image, UPGRADE_SIZE, cx, cy, radius - 2, fade(CYAN_EDGE, alpha * 0.55))
    end
  end

  -- 3) 사방으로 흩어지며 위로 오르는 금빛 입자. 코어가 "강해졌다"를 색으로도 말한다
  -- (청록=코어, 금=승급). 원둘레에 고르게 뿌리고 각자 다른 속도를 줘야 한 덩어리로
  -- 뭉쳐 보이지 않는다.
  local PARTICLES = 14
  for i = 0, PARTICLES - 1 do
    local angle = (i / PARTICLES) * math.pi * 2
    -- 입자마다 조금씩 다른 속도/수명 — 전부 같으면 고리가 하나 더 생긴 것처럼 보인다.
    local speed = 22 + (i % 4) * 7
    local life = 0.7 + (i % 3) * 0.12
    local k = math.min(1, t / life)

    local x = cx + math.cos(angle) * speed * k
    -- 위로 갈수록 느려진다(중력 반대로 던진 것처럼). 아래로 가는 입자도 같은 만큼 띄워
    -- 전체가 살짝 떠오르게 한다.
    local y = cy + math.sin(angle) * speed * k * 0.55 - (k * 14 - k * k * 5)

    local alpha = (1 - k) * (1 - k) * 1.1
    if alpha > 0.05 then
      put(image, UPGRADE_SIZE, x, y, fade(GOLD, math.min(1, alpha)))
      -- 꼬리 한 픽셀 — 움직이는 중이라는 신호다.
      if k < 0.7 then put(image, UPGRADE_SIZE, x - math.cos(angle), y + 1, fade(GOLD, alpha * 0.45)) end
    end
  end
end

-- ---------------------------------------------------------------- 시트 생성
--
-- 태그마다 캔버스가 달라서 스프라이트를 하나로 못 만든다 — Aseprite는 한 파일 안에서
-- 프레임마다 크기를 달리할 수 없다. 큰 쪽(upgrade)에 맞추고 glint는 가운데에 그린다.

local S = UPGRADE_SIZE
local sprite = Sprite(S, S, ColorMode.RGB)
local layer = sprite.layers[1]
for _ = 2, GLINT_FRAMES + UPGRADE_FRAMES do sprite:newEmptyFrame() end

local frame = 1

local glintFirst = frame
for f = 0, GLINT_FRAMES - 1 do
  local small = Image(GLINT_SIZE, GLINT_SIZE, ColorMode.RGB)
  drawGlint(small, f / (GLINT_FRAMES - 1))
  local image = Image(S, S, ColorMode.RGB)
  image:drawImage(small, Point((S - GLINT_SIZE) / 2, (S - GLINT_SIZE) / 2))
  sprite:newCel(layer, frame, image, Point(0, 0))
  frame = frame + 1
end
sprite:newTag(glintFirst, frame - 1).name = 'glint'

local upgradeFirst = frame
for f = 0, UPGRADE_FRAMES - 1 do
  local image = Image(S, S, ColorMode.RGB)
  drawUpgrade(image, f / (UPGRADE_FRAMES - 1))
  sprite:newCel(layer, frame, image, Point(0, 0))
  frame = frame + 1
end
sprite:newTag(upgradeFirst, frame - 1).name = 'upgrade'

sprite:saveAs(app.params['out'])
print('saved: ' .. app.params['out'])
