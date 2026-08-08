-- 티어 2·3 건축물 스프라이트. 32x32, 태그 하나당 1프레임, 배경 투명.
--
--   stone_wall_front / stone_wall_side / stone_fence_front / stone_fence_side   (티어 2, 돌)
--   iron_wall_front  / iron_wall_side  / iron_fence_front  / iron_fence_side    (티어 3, 철)
--
-- 좌표 규약: **기존 나무/돌 에셋과 같은 자리에 그린다.** 실측하면 타일이 캔버스 가운데가
-- 아니라 x 7~23, 바닥선 y 28에 놓여 있다(위쪽 여백은 벽 높이용). 이걸 맞춰야 새 건축물이
-- 기존 것과 한 줄에 섰을 때 바닥이 어긋나지 않는다.
--
-- 실루엣도 그대로 따른다 — 벽은 꽉 찬 상자, 울타리는 가운데가 뚫린 틀. 재질만 바뀐다.

local S = 32
local LEFT, RIGHT = 7, 23
local GROUND = 28
local WALL_TOP = 10
local FENCE_TOP = 13

local OUTLINE = Color{ r = 0x14, g = 0x14, b = 0x16 }

-- 돌: 기존 stone.aseprite의 회색(#696A6A)을 기준으로 명암만 넓혔다.
local STONE = {
  base  = Color{ r = 0x69, g = 0x6A, b = 0x6A },
  light = Color{ r = 0x8A, g = 0x8C, b = 0x8C },
  dark  = Color{ r = 0x4A, g = 0x4B, b = 0x4C },
  mortar = Color{ r = 0x39, g = 0x3A, b = 0x3B },
}

-- 철: 돌보다 푸르게 눕혀 금속으로 읽히게 하고, 하이라이트를 세게 준다.
local IRON = {
  base  = Color{ r = 0x74, g = 0x7E, b = 0x8C },
  light = Color{ r = 0xA6, g = 0xB0, b = 0xBE },
  dark  = Color{ r = 0x4C, g = 0x54, b = 0x60 },
  mortar = Color{ r = 0x33, g = 0x39, b = 0x42 },
}

-- 결과를 재현할 수 있게 고정 시드 LCG를 쓴다(다른 생성기와 같은 방식).
local seed = 20260808
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

--- 이웃 없이 홀로 남은 픽셀을 지운다. 울타리 가운데를 도려낼 때 모서리에 한두 점이
--- 떨어져 나오는데, 그대로 두면 외곽선까지 입혀져 화면에 먼지처럼 보인다.
local function despeckle(image)
  local lonely = {}
  for y = 0, S - 1 do
    for x = 0, S - 1 do
      if image:getPixel(x, y) ~= 0 then
        local neighbours = 0
        for _, d in ipairs({ { 1, 0 }, { -1, 0 }, { 0, 1 }, { 0, -1 } }) do
          local nx, ny = x + d[1], y + d[2]
          if nx >= 0 and nx < S and ny >= 0 and ny < S and image:getPixel(nx, ny) ~= 0 then
            neighbours = neighbours + 1
          end
        end
        if neighbours <= 1 then lonely[#lonely + 1] = { x, y } end
      end
    end
  end
  for _, p in ipairs(lonely) do
    image:drawPixel(p[1], p[2], Color{ r = 0, g = 0, b = 0, a = 0 })
  end
end

--- 바깥 테두리. 불투명 픽셀 중 투명과 맞닿은 곳을 어둡게 덮는다(다른 에셋과 같은 문법).
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

--- 돌쌓기 무늬: 줄마다 반 칸씩 어긋난 세로 줄눈. 벽·울타리가 같은 무늬를 쓴다.
local function masonry(image, x0, y0, x1, y1, mat)
  fillRect(image, x0, y0, x1, y1, mat.base)
  local row = 0
  local y = y0
  while y <= y1 do
    -- 가로 줄눈
    if y > y0 then
      for x = x0, x1 do put(image, x, y, mat.mortar) end
    end
    -- 그 아래 한 줄은 살짝 밝게 — 위에서 빛이 든다.
    if y + 1 <= y1 then
      for x = x0, x1 do put(image, x, y + 1, mat.light) end
    end
    -- 세로 줄눈은 한 줄 걸러 반 칸 밀어 벽돌처럼 보이게 한다.
    local offset = (row % 2 == 0) and 0 or 3
    local vx = x0 + offset
    while vx <= x1 do
      for yy = y + 1, math.min(y + 4, y1) do put(image, vx, yy, mat.mortar) end
      -- 벽돌 한 장마다 밝기를 살짝 흔든다. 완전히 규칙적이면 기계로 찍은 무늬처럼
      -- 보여서, 손으로 찍은 나무 에셋 옆에 두면 혼자 붕 뜬다.
      local shade = rnd()
      if shade > 0.72 then
        for yy = y + 2, math.min(y + 4, y1) do
          for xx = vx + 1, math.min(vx + 5, x1) do put(image, xx, yy, mat.dark) end
        end
      elseif shade < 0.24 then
        for xx = vx + 1, math.min(vx + 5, x1) do put(image, xx, y + 2, mat.light) end
      end
      vx = vx + 6
    end
    row = row + 1
    y = y + 5
  end
  -- 바닥 한 줄은 그늘.
  for x = x0, x1 do put(image, x, y1, mat.dark) end
end

--- 금속판 무늬: 세로 이음매 + 리벳. 돌과 확실히 다른 결로 읽혀야 한다.
local function plating(image, x0, y0, x1, y1, mat)
  fillRect(image, x0, y0, x1, y1, mat.base)
  -- 위 두 줄은 밝게(빛), 아래 한 줄은 그늘.
  for x = x0, x1 do
    put(image, x, y0, mat.light)
    put(image, x, y1, mat.dark)
  end
  -- 세로 이음매를 일정 간격으로.
  local vx = x0 + 5
  while vx < x1 do
    for y = y0, y1 do put(image, vx, y, mat.mortar) end
    vx = vx + 6
  end
  -- 리벳: 이음매 사이 가운데에 밝은 점 + 아래 그림자 한 픽셀. 두 픽셀이라야 튀어나온
  -- 못처럼 보인다(한 점만 찍으면 얼룩으로 읽힌다).
  local ry = y0 + 2
  while ry <= y1 - 2 do
    local rx = x0 + 2
    while rx <= x1 do
      put(image, rx, ry, mat.light)
      put(image, rx, ry + 1, mat.dark)
      rx = rx + 6
    end
    ry = ry + 5
  end
end

local function wall(image, mat, texture)
  texture(image, LEFT, WALL_TOP, RIGHT, GROUND, mat)
  despeckle(image)
  outline(image)
end

--- 울타리: 가운데가 뚫린 틀. 기존 나무 울타리와 같은 실루엣이다.
local function fence(image, mat, texture)
  texture(image, LEFT, FENCE_TOP, RIGHT, GROUND, mat)
  -- 가운데를 도려내 "지나갈 수 없지만 너머가 보이는" 울타리로 만든다.
  for y = FENCE_TOP + 4, GROUND - 4 do
    for x = LEFT + 4, RIGHT - 4 do image:drawPixel(x, y, Color{ r = 0, g = 0, b = 0, a = 0 }) end
  end
  despeckle(image)
  outline(image)
end

--- 옆면: 두께만 보이는 좁은 기둥. 기존 에셋과 같은 폭·높이로 맞춘다.
local function sideView(image, mat, texture, top)
  texture(image, LEFT, top, LEFT + 4, GROUND - 2, mat)
  despeckle(image)
  outline(image)
end

local FRAMES = {
  { name = 'stone_wall_front',  draw = function(i) wall(i, STONE, masonry) end },
  { name = 'stone_wall_side',   draw = function(i) sideView(i, STONE, masonry, WALL_TOP) end },
  { name = 'stone_fence_front', draw = function(i) fence(i, STONE, masonry) end },
  { name = 'stone_fence_side',  draw = function(i) sideView(i, STONE, masonry, FENCE_TOP) end },
  { name = 'iron_wall_front',   draw = function(i) wall(i, IRON, plating) end },
  { name = 'iron_wall_side',    draw = function(i) sideView(i, IRON, plating, WALL_TOP) end },
  { name = 'iron_fence_front',  draw = function(i) fence(i, IRON, plating) end },
  { name = 'iron_fence_side',   draw = function(i) sideView(i, IRON, plating, FENCE_TOP) end },
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
