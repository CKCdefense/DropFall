-- 레벨업 이펙트. 32x48, 6프레임, 배경 투명. 태그 'levelup'.
--
-- 좌표 규약: **캔버스 아래쪽(GROUND)이 대상의 발밑**이다. 렌더러가 원점을 여기에 맞춰
-- 얹는다(fx_heal/fx_boost와 같은 규약).
--
-- 미니멀하게 간다 — 하얀 빛기둥이 한 번 번쩍하고 사라진다. 예전에는 금빛 기둥에 발밑
-- 고리·불티·별 광채까지 얹었는데, 레벨업은 캐릭터에게 일어나는 일이지 화면에 일어나는
-- 일이 아니다. 거창한 연출이 정작 캐릭터를 가렸다.
--
-- 캐릭터가 하얗게 점멸하는 건 그림이 아니라 **렌더러가 스프라이트를 틴트**해서 한다
-- (EntityRenderer.playLevelUpFx) — 어떤 직업이든 같은 실루엣으로 반응한다.

local W, H = 32, 48
local CX = 15.5
local GROUND = 40
local FRAMES = 6

local WHITE = Color{ r = 0xFF, g = 0xFF, b = 0xFF }
local SOFT = Color{ r = 0xDF, g = 0xEA, b = 0xFF }

local function put(image, x, y, color)
  x, y = math.floor(x + 0.5), math.floor(y + 0.5)
  if x < 0 or x >= W or y < 0 or y >= H then return end
  image:drawPixel(x, y, color)
end

--- 빛기둥 한 장.
--- @param rise 0~1. 기둥이 발밑에서 얼마나 자랐는지.
--- @param fade 0~1. 1이면 가장 밝다.
--- @param half 기둥 반폭(px).
local function pillar(image, rise, fade, half)
  local top = GROUND - rise * (GROUND - 2)
  local y = GROUND
  while y >= top do
    for dx = -half, half do
      -- **속을 꽉 채운다.** 디더로 밝기를 표현하면 기둥이 얼룩덜룩해져서 "빛"이 아니라
      -- "무늬"로 보인다. 사라지는 건 렌더러가 알파로 처리하고, 여기서는 폭과 색만 쓴다.
      local color = (math.abs(dx) == half and half > 1) and SOFT or WHITE
      put(image, CX + dx, y, fade > 0.5 and color or SOFT)
    end
    y = y - 1
  end
end

--- 발밑 한 줄. 기둥이 땅에서 솟는다는 걸 한 줄로 못 박는다.
local function base(image, half)
  for dx = -half - 2, half + 2 do
    put(image, CX + dx, GROUND, SOFT)
  end
end

-- 프레임별 (자란 정도, 밝기, 반폭). 두 프레임 만에 확 서고 나머지는 사라진다 —
-- "번쩍"은 오르는 시간보다 꺼지는 시간이 길어야 잔상으로 남는다.
-- 반폭을 캐릭터(약 14px)보다 확실히 좁게 잡는다. 비슷하게 굵으면 하얗게 점멸하는
-- 캐릭터와 한 덩어리로 뭉쳐서 실루엣이 통째로 사라진다.
local SHAPE = {
  { 0.60, 1.00, 2 },
  { 1.00, 1.00, 3 },
  { 1.00, 0.85, 2 },
  { 1.00, 0.55, 1 },
  { 1.00, 0.30, 1 },
  { 1.00, 0.12, 0 },
}

local sprite = Sprite(W, H, ColorMode.RGB)
local layer = sprite.layers[1]
for _ = 2, FRAMES do sprite:newEmptyFrame() end

for index = 1, FRAMES do
  local rise, fade, half = table.unpack(SHAPE[index])
  local image = Image(W, H, ColorMode.RGB)
  pillar(image, rise, fade, half)
  base(image, half)
  sprite:newCel(layer, index, image, Point(0, 0))
end

local tag = sprite:newTag(1, FRAMES)
tag.name = 'levelup'

sprite:saveAs(app.params['out'])
print('saved: ' .. app.params['out'])
