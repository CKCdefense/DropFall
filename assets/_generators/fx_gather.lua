-- 채집 타격 이펙트. 24x24, 태그 2개 × 5프레임, 배경 투명.
--   leaf  : 나무 타격 — 잎이 흩날리며 떨어진다
--   shard : 돌 타격 — 조각이 튀어 오르다 떨어진다
--
-- 좌표 규약: **캔버스 중심이 타격 지점**이다. 방향이 없어 회전 없이 그대로 얹는다.
--
-- 파티클은 프레임마다 다시 그리는 게 아니라 **하나의 궤적을 시간으로 샘플링**한다 —
-- 초기 속도 + 중력으로 위치를 계산하므로 프레임 수를 바꿔도 움직임이 자연스럽게 유지된다.

local S = 24
local CX, CY = 11.5, 11.5
local FRAMES = 5

-- 결과를 재현할 수 있게 고정 시드 LCG를 쓴다.
local seed = 1
local function srand(v) seed = v end
local function rnd()
  seed = (1103515245 * seed + 12345) % 2147483648
  return seed / 2147483648
end

local LEAF = {
  Color{ r = 0x4F, g = 0x6E, b = 0x40 },
  Color{ r = 0x63, g = 0x86, b = 0x50 },
  Color{ r = 0x3B, g = 0x54, b = 0x31 },
}
local SHARD = {
  Color{ r = 0x8A, g = 0x8F, b = 0x99 },
  Color{ r = 0xA8, g = 0xAE, b = 0xB8 },
  Color{ r = 0x6B, g = 0x6F, b = 0x78 },
}
local SPARK = Color{ r = 0xE8, g = 0xEC, b = 0xF2 }

local function put(image, x, y, color)
  x, y = math.floor(x + 0.5), math.floor(y + 0.5)
  if x < 0 or x >= S or y < 0 or y >= S then return end
  image:drawPixel(x, y, color)
end

--- 파티클 집합을 만든다. kind에 따라 초기 속도 분포가 다르다:
---  leaf  — 옆으로 퍼지며 천천히 떨어진다(중력 약함, 좌우 흔들림)
---  shard — 위로 튀었다가 빠르게 떨어진다(중력 강함)
local function makeParticles(kind, count, saltBase)
  local particles = {}
  for i = 1, count do
    srand(saltBase + i * 971)
    local angle = rnd() * math.pi * 2
    local particle = {
      color = i % 3 + 1,
      x = CX + math.cos(angle) * rnd() * 2,
      y = CY + math.sin(angle) * rnd() * 2,
    }
    if kind == 'leaf' then
      particle.vx = (rnd() - 0.5) * 3.2
      particle.vy = -rnd() * 1.2
      particle.g = 0.55
      particle.sway = rnd() * math.pi * 2 -- 잎마다 다른 위상으로 흔들린다
    else
      particle.vx = (rnd() - 0.5) * 4.5
      particle.vy = -1.5 - rnd() * 2.2
      particle.g = 1.4
      particle.sway = 0
    end
    particles[#particles + 1] = particle
  end
  return particles
end

local function drawFrame(image, kind, particles, t)
  local palette = kind == 'leaf' and LEAF or SHARD

  for _, particle in ipairs(particles) do
    local x = particle.x + particle.vx * t
    local y = particle.y + particle.vy * t + particle.g * t * t
    if kind == 'leaf' then
      -- 잎은 떨어지며 좌우로 살랑인다.
      x = x + math.sin(particle.sway + t * 2.4) * 1.4
    end

    local color = palette[particle.color]
    put(image, x, y, color)
    -- 첫 두 프레임은 2px로 크게 — 터지는 순간이 또렷해야 타격감이 난다.
    if t < 1.6 then put(image, x + 1, y, color) end
  end

  -- 타격 순간의 섬광. 첫 프레임에만.
  if t < 0.6 then
    put(image, CX, CY, SPARK)
    put(image, CX + 1, CY, SPARK)
  end
end

-- ---------------------------------------------------------------- 시트 생성

local sprite = Sprite(S, S, ColorMode.RGB)
local layer = sprite.layers[1]
for _ = 2, FRAMES * 2 do sprite:newEmptyFrame() end

local frame = 1
for _, kind in ipairs({ 'leaf', 'shard' }) do
  local first = frame
  local particles = makeParticles(kind, kind == 'leaf' and 7 or 6, kind == 'leaf' and 11 or 77)

  for f = 0, FRAMES - 1 do
    local image = Image(S, S, ColorMode.RGB)
    -- t를 0.4~3.2 구간으로 샘플링 — 마지막 프레임에서 화면 밖으로 흩어진다.
    drawFrame(image, kind, particles, 0.4 + f * 0.7)
    sprite:newCel(layer, frame, image, Point(0, 0))
    frame = frame + 1
  end

  local tag = sprite:newTag(first, frame - 1)
  tag.name = kind
end

sprite:saveAs(app.params['out'])
print('saved: ' .. app.params['out'])
