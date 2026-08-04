-- 총알(예광탄). 16x8, 2프레임, 배경 투명.
--
-- 좌표 규약: **+x가 진행 방향**이다(총구 화염과 동일). 렌더러가 투사체 각도만큼 회전시킨다.
-- 캔버스 중앙(y=3.5)이 탄 중심이고, 오른쪽 끝이 탄두다.
--
-- "얇고 미니멀하게" — 픽셀아트에서 작은 물체는 색을 늘릴수록 지저분해진다.
-- 세로 두께는 탄두만 2px, 나머지는 1px로 두고, 꼬리는 길이로만 표현한다.
-- 2프레임은 꼬리 길이와 밝기만 살짝 다르다. 빠르게 지나가므로 반짝이는 정도면 충분하다.

local W, H = 16, 8
local CY = 3 -- 탄 중심선(0-index). 2px 두께를 쓰면 CY와 CY+1을 함께 칠한다.
local TIP = 13 -- 탄두 위치. 오른쪽에 여백을 둬야 회전시켜도 잘리지 않는다.

local CORE = Color{ r = 255, g = 252, b = 236 }
local HOT = Color{ r = 255, g = 226, b = 138 }
local WARM = Color{ r = 240, g = 158, b = 72 }
local TAIL = Color{ r = 176, g = 96, b = 48 }

local function newGrid()
  local g = {}
  for y = 0, H - 1 do g[y] = {} end
  return g
end

local function put(g, x, y, color)
  x, y = math.floor(x + 0.5), math.floor(y + 0.5)
  if x < 0 or x >= W or y < 0 or y >= H then return end
  g[y][x] = color
end

--- 진행 방향(+x)으로 뻗는 1px 선분. x0~x1 구간을 칠한다.
local function streak(g, x0, x1, y, color)
  for x = x0, x1 do put(g, x, y, color) end
end

-- 프레임별 파라미터.
--   tailFrom : 꼬리가 시작되는 x. 작을수록 길다.
--   warmFrom : 중간 밝기 구간의 시작 x.
--   thick    : 탄두를 2px로 그릴지 여부.
local FRAMES = {
  { tailFrom = 2, warmFrom = 7, thick = true },
  { tailFrom = 4, warmFrom = 8, thick = false },
}

local function bullet(g, index)
  local f = FRAMES[index]

  -- 뒤에서 앞으로 갈수록 밝아진다. 어두운 꼬리를 먼저 깔고 밝은 색으로 덮어쓴다.
  streak(g, f.tailFrom, TIP, CY, TAIL)
  streak(g, f.warmFrom, TIP, CY, WARM)
  streak(g, TIP - 3, TIP, CY, HOT)

  -- 탄두. 여기만 굵게 해서 "앞이 어디인지"를 한눈에 보이게 한다.
  put(g, TIP, CY, CORE)
  put(g, TIP - 1, CY, CORE)
  if f.thick then
    put(g, TIP, CY + 1, HOT)
    put(g, TIP - 1, CY + 1, HOT)
  end
end

-- ---------------------------------------------------------------- 시트 생성

local sprite = Sprite(W, H, ColorMode.RGB)
local layer = sprite.layers[1]
for _ = 2, #FRAMES do sprite:newEmptyFrame() end

for index = 1, #FRAMES do
  local g = newGrid()
  bullet(g, index)

  local image = Image(W, H, ColorMode.RGB)
  for y = 0, H - 1 do
    for x = 0, W - 1 do
      if g[y][x] ~= nil then image:drawPixel(x, y, g[y][x]) end
    end
  end
  sprite:newCel(layer, index, image, Point(0, 0))
end

local tag = sprite:newTag(1, #FRAMES)
tag.name = 'tracer'

sprite:saveAs(app.params['out'])
print('saved: ' .. app.params['out'])
