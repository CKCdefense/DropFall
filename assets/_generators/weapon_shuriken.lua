-- 표창(수리검). 64x64, 태그 1개(idle) × 1프레임, 배경 투명.
--
-- weapons_new 팩에 표창만 없어서 이 스크립트로 채운다 — 4날 별 형태는 완전히
-- 규칙적인 도형이라 생성기 방식이 잘 맞는다(§README "왜 스크립트로 만드나").
--
-- 좌표 규약: 캔버스 중심이 곧 그립(손 위치)이자 투척 기준점이다. 방향 대칭이라
-- 회전해도 어색하지 않다 — 들었을 때는 손끝에, 날아갈 때는 투사체 위치에 그대로 얹는다.

local S = 64
local CX, CY = 31.5, 31.5
local R = 26          -- 날 끝 반경
local HUB = 5         -- 중심 허브 반경
local HOLE = 2.5      -- 중앙 구멍(전통 수리검의 손가락 구멍)

local OUTLINE    = Color{ r = 0x1A, g = 0x1C, b = 0x23 }
local STEEL      = Color{ r = 0x9A, g = 0xA2, b = 0xB0 }
local STEEL_DARK = Color{ r = 0x66, g = 0x6D, b = 0x7A }
local EDGE_LIGHT = Color{ r = 0xE8, g = 0xEC, b = 0xF2 }

-- 4날 별 판정. 날 축(0/90/180/270도)에서의 각도 차가 반경에 따라 좁아지는
-- 쐐기 안이면 날이다 — 끝으로 갈수록 뾰족해지는 표창 실루엣이 수식 하나로 나온다.
local function inStar(x, y)
  local dx, dy = x - CX, y - CY
  local r = math.sqrt(dx * dx + dy * dy)
  if r > R then return false end
  if r <= HUB then return true end
  local a = math.atan(dy, dx)
  -- 90도 주기로 접고, 날 축(45도 오프셋 — 대각 방향 날)과의 차이를 잰다.
  local period = math.pi / 2
  local folded = math.abs(((a + period / 2) % period) - period / 2)
  local halfWidth = 0.42 * (1 - (r - HUB) / (R - HUB)) + 0.05
  return folded <= halfWidth
end

local sprite = Sprite(S, S, ColorMode.RGB)
local image = Image(S, S, ColorMode.RGB)

-- 1차: 본체 채움(음영 포함).
for y = 0, S - 1 do
  for x = 0, S - 1 do
    if inStar(x, y) then
      local dx, dy = x - CX, y - CY
      local r = math.sqrt(dx * dx + dy * dy)
      local color = STEEL
      -- 좌상단에서 빛이 온다 — 왼쪽/위 사분면 날은 밝게, 오른쪽/아래는 어둡게.
      if dx + dy < -4 then
        color = EDGE_LIGHT
      elseif dx + dy > 6 then
        color = STEEL_DARK
      end
      if r <= HUB and r > HOLE then color = STEEL_DARK end
      if r > HOLE then image:drawPixel(x, y, color) end
    end
  end
end

-- 2차: 외곽선 — 본체 픽셀 중 투명 이웃(구멍 가장자리 포함)이 있으면 어두운 테두리.
local outlined = {}
for y = 0, S - 1 do
  for x = 0, S - 1 do
    if image:getPixel(x, y) ~= 0 then
      for _, d in ipairs({ { 1, 0 }, { -1, 0 }, { 0, 1 }, { 0, -1 } }) do
        local nx, ny = x + d[1], y + d[2]
        if nx < 0 or nx >= S or ny < 0 or ny >= S or image:getPixel(nx, ny) == 0 then
          outlined[#outlined + 1] = { x, y }
          break
        end
      end
    end
  end
end
for _, p in ipairs(outlined) do image:drawPixel(p[1], p[2], OUTLINE) end

sprite:newCel(sprite.layers[1], 1, image, Point(0, 0))
local tag = sprite:newTag(1, 1)
tag.name = 'idle'

sprite:saveAs(app.params['out'])
print('saved: ' .. app.params['out'])
