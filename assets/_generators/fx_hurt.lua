-- 플레이어 피격 이펙트. 24x24, 태그 1개(hit) × 6프레임, 배경 투명.
--
-- 좌표 규약: **캔버스 중심이 피격 지점**(가슴 높이)이다. 방향이 없어 회전 없이 얹는다.
--
-- ============================================================================
-- 디자인 — 미니멀 임팩트 플래시
-- ============================================================================
-- fx_swing과 같은 문법(3색, 하드 엣지, 파편 소멸)을 따른다. 읽는 순서는:
--
--  1) **터짐(1~2f)** — 중심에 흰 십자 섬광 + 붉은 코어. "맞았다"는 한 프레임짜리 신호.
--  2) **퍼짐(3~4f)** — 십자가 걷히고 붉은 조각들이 바깥으로 밀려난다.
--     조각은 프레임마다 다시 그리는 게 아니라 초기 속도로 궤적을 샘플링한다
--     (fx_gather와 같은 방식) — 프레임 수를 바꿔도 움직임이 유지된다.
--  3) **소멸(5~6f)** — 낱알 픽셀만 남고 흩어진다. 여운은 짧게.
--
-- 색은 피해=빨강 관습을 따르되 채도를 눌러 레트로 팔레트에 맞춘다.

local S = 24
local CX, CY = 11.5, 11.5
local FRAMES = 6

local CORE = Color{ r = 0xF6, g = 0xF3, b = 0xEE }  -- 흰 섬광
local RED  = Color{ r = 0xD9, g = 0x5C, b = 0x4A }  -- 본체(눌린 빨강)
local DIM  = Color{ r = 0x8A, g = 0x33, b = 0x2E }  -- 꺼져가는 검붉음

-- 결과를 재현할 수 있게 고정 시드 LCG를 쓴다(fx_gather와 동일).
local seed = 7
local function rnd()
  seed = (1103515245 * seed + 12345) % 2147483648
  return seed / 2147483648
end

local function put(image, x, y, color)
  x, y = math.floor(x + 0.5), math.floor(y + 0.5)
  if x < 0 or x >= S or y < 0 or y >= S then return end
  image:drawPixel(x, y, color)
end

--- 십자 섬광. 반지름 r까지 4방향 + 대각선 절반 길이 — 픽셀 임팩트의 고전 문법.
local function cross(image, r, color)
  for d = 1, r do
    put(image, CX + d, CY, color)
    put(image, CX - d, CY, color)
    put(image, CX, CY + d, color)
    put(image, CX, CY - d, color)
  end
  local half = math.floor(r / 2)
  for d = 1, half do
    put(image, CX + d, CY + d, color)
    put(image, CX - d, CY - d, color)
    put(image, CX + d, CY - d, color)
    put(image, CX - d, CY + d, color)
  end
end

-- 파편: 방향 고정(균등 8방 + 흔들림), 초기 속도만 다르게. 중력은 주지 않는다 —
-- 채집 파편(fx_gather)과 달리 "지점에서 터지는" 느낌이라 사방으로 균등해야 한다.
local shards = {}
for i = 1, 8 do
  local angle = (i / 8) * math.pi * 2 + (rnd() - 0.5) * 0.5
  shards[#shards + 1] = {
    vx = math.cos(angle) * (2.2 + rnd() * 1.4),
    vy = math.sin(angle) * (2.2 + rnd() * 1.4),
  }
end

local function drawFrame(image, index)
  local t = index -- 1..FRAMES

  if t <= 2 then
    -- 터짐: 십자 섬광이 한 프레임 만에 커졌다가 줄어든다.
    cross(image, t == 1 and 4 or 6, t == 1 and CORE or RED)
    if t == 1 then
      put(image, CX, CY, CORE)
    else
      cross(image, 3, CORE)
    end
    return
  end

  -- 퍼짐/소멸: 파편이 바깥으로 밀려나며 색이 식는다. life 1은 파편이 아직 중심에
  -- 몰려 있어서 꼬리·잔심을 겹치면 어두운 덩어리로 뭉친다 — 파편만 깨끗하게 두고,
  -- 꼬리는 충분히 벌어진 life 2부터 붙인다.
  local life = t - 2 -- 1..4
  for _, p in ipairs(shards) do
    local x = CX + p.vx * (life + 0.6)
    local y = CY + p.vy * (life + 0.6)
    local color = life <= 2 and RED or DIM
    put(image, x, y, color)
    if life == 2 then
      -- 진행 방향 꼬리 1px — 움직임이 읽힌다.
      put(image, x - p.vx * 0.4, y - p.vy * 0.4, DIM)
    end
  end
  if life == 1 then put(image, CX, CY, CORE) end
end

-- ---------------------------------------------------------------- 시트 생성

local sprite = Sprite(S, S, ColorMode.RGB)
local layer = sprite.layers[1]
for _ = 2, FRAMES do sprite:newEmptyFrame() end

for index = 1, FRAMES do
  local image = Image(S, S, ColorMode.RGB)
  drawFrame(image, index)
  sprite:newCel(layer, index, image, Point(0, 0))
end

local tag = sprite:newTag(1, FRAMES)
tag.name = 'hit'

sprite:saveAs(app.params['out'])
print('saved: ' .. app.params['out'])
