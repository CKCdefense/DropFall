-- 바닥 스파이크 3티어. 32x32, 태그 하나당 1프레임, 배경 투명.
--
--   spike_front / stone_spike_front / iron_spike_front
--
-- 좌표 규약: **바닥에 눕는 설치물**이다. 벽처럼 위로 서지 않고 타일 발자국
-- (x 7~23, 바닥선 y 28 — buildings_tiers.lua와 같은 실측값)을 판으로 덮고,
-- 그 위에 짧은 가시들이 돋는다. 가시 끝이 y 20 위로 올라가지 않아 지나가는
-- 캐릭터·몬스터를 가리지 않는다 — 밟는 물건이지 막는 물건이 아니다.
--
-- 재질 팔레트는 기존 에셋에서 그대로 가져온다. 나무는 wood.aseprite의 갈색,
-- 돌·철은 buildings_tiers.lua의 STONE/IRON — 같은 재질이 화면에서 같은 색이어야
-- "이건 철 계열이구나"가 배치만 봐도 읽힌다.

local S = 32
local LEFT, RIGHT = 7, 23
local GROUND = 28
-- 바닥판 윗변. 판 두께 3px — 얇아야 "깔린 것"으로 보인다.
local PLATE_TOP = GROUND - 3

local OUTLINE = Color{ r = 0x14, g = 0x14, b = 0x16 }

local WOOD = {
  base  = Color{ r = 0xB0, g = 0x8A, b = 0x5C },
  light = Color{ r = 0xCC, g = 0xA8, b = 0x74 },
  dark  = Color{ r = 0x82, g = 0x62, b = 0x3E },
  tip   = Color{ r = 0xE4, g = 0xC9, b = 0x9B },
}

local STONE = {
  base  = Color{ r = 0x69, g = 0x6A, b = 0x6A },
  light = Color{ r = 0x8A, g = 0x8C, b = 0x8C },
  dark  = Color{ r = 0x4A, g = 0x4B, b = 0x4C },
  tip   = Color{ r = 0xB2, g = 0xB4, b = 0xB4 },
}

local IRON = {
  base  = Color{ r = 0x74, g = 0x7E, b = 0x8C },
  light = Color{ r = 0xA6, g = 0xB0, b = 0xBE },
  dark  = Color{ r = 0x4C, g = 0x54, b = 0x60 },
  tip   = Color{ r = 0xD3, g = 0xDB, b = 0xE6 },
}

-- 결과를 재현할 수 있게 고정 시드 LCG(다른 생성기와 같은 방식).
local seed = 20260809
local function rnd()
  seed = (1103515245 * seed + 12345) % 2147483648
  return seed / 2147483648
end

local function put(image, x, y, color)
  if x < 0 or x >= S or y < 0 or y >= S then return end
  image:drawPixel(x, y, color)
end

local function fillRect(image, x0, y0, x1, y1, color)
  for y = y0, y1 do
    for x = x0, x1 do put(image, x, y, color) end
  end
end

--- 바깥 테두리(다른 에셋과 같은 문법) — 불투명 픽셀 중 투명과 맞닿은 곳을 어둡게 덮는다.
local function outline(image)
  local edge = {}
  for y = 0, S - 1 do
    for x = 0, S - 1 do
      if image:getPixel(x, y) ~= 0 then
        for _, d in ipairs({ { 1, 0 }, { -1, 0 }, { 0, 1 }, { 0, -1 } }) do
          local nx, ny = x + d[1], y + d[2]
          if nx < 0 or nx >= S or ny < 0 or ny >= S or image:getPixel(nx, ny) == 0 then
            edge[#edge + 1] = { x, y }
            break
          end
        end
      end
    end
  end
  for _, p in ipairs(edge) do put(image, p[1], p[2], OUTLINE) end
end

--- 가시 하나. 밑변 3px(x-1..x+1)에서 height만큼 좁아지며 올라간다.
--- 왼쪽 면은 밝게(빛), 오른쪽 면은 어둡게 — 끝점은 tip 색으로 반짝인다.
local function spikeAt(image, x, height, mat)
  local baseY = PLATE_TOP - 1
  for step = 0, height - 1 do
    local y = baseY - step
    if step < height - 1 then
      put(image, x - 1, y, mat.light)
      put(image, x, y, mat.base)
      put(image, x + 1, y, mat.dark)
    else
      put(image, x, y, mat.tip)
    end
  end
end

--- 바닥판 + 가시 줄. 티어가 오를수록 가시가 조금 높고 촘촘하다.
--- @param heights 가시 높이 후보(랜덤으로 하나씩 고른다).
--- @param gap 가시 사이 간격(px).
local function spikePlate(image, mat, heights, gap)
  -- 판: 위 한 줄 밝게, 아래 한 줄 어둡게 — 두께 3px짜리 널빤지.
  fillRect(image, LEFT, PLATE_TOP, RIGHT, GROUND, mat.base)
  for x = LEFT, RIGHT do
    put(image, x, PLATE_TOP, mat.light)
    put(image, x, GROUND, mat.dark)
  end

  -- 가시: 판 안쪽에서 gap 간격으로. 높이를 흔들어 손으로 박은 느낌을 낸다.
  local x = LEFT + 2
  while x <= RIGHT - 2 do
    local height = heights[1 + math.floor(rnd() * #heights)]
    spikeAt(image, x, height, mat)
    x = x + gap
  end

  outline(image)
end

local FRAMES = {
  { name = 'spike_front',       draw = function(i) spikePlate(i, WOOD,  { 4, 5 },    4) end },
  { name = 'stone_spike_front', draw = function(i) spikePlate(i, STONE, { 4, 5, 6 }, 4) end },
  { name = 'iron_spike_front',  draw = function(i) spikePlate(i, IRON,  { 6, 7 },    4) end },
}

local sprite = Sprite(S, S, ColorMode.RGB)
local layer = sprite.layers[1]
for _ = 2, #FRAMES do sprite:newEmptyFrame() end

for index, frame in ipairs(FRAMES) do
  local image = Image(S, S, ColorMode.RGB)
  frame.draw(image)
  sprite:newCel(layer, index, image, Point(0, 0))
  local tag = sprite:newTag(index, index)
  tag.name = frame.name
end

sprite:saveAs(app.params['out'])
print('saved: ' .. app.params['out'])
