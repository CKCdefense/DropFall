-- 상단 중앙 시계(WaveDial)의 픽셀아트 부품.
--
-- 구성은 세 겹이다:
--   hud_clock_face  37x37  시계 몸통 — 바깥 베젤 + 남은 시간 게이지가 깔릴 홈(트랙)
--                          + 안쪽 어두운 판. **게이지 자체는 여기 없다** (아래 참고)
--   hud_clock_sun   21x21  낮 — 광선 달린 황금 해
--   hud_clock_moon  21x21  밤 — 크레이터 있는 창백한 달 + 잔별
--
-- 크기는 **원본 픽셀**이다. 게임은 hudBar.HUD_BAR_SCALE(2배)로 확대해 그린다 —
-- 다른 게이지와 픽셀 굵기를 맞춰야 한 화면에서 따로 놀지 않는다(→ 화면 74px).
--
-- ## 게이지를 그림으로 굽지 않는 이유
--
-- 남은 시간 링은 0~100%가 연속으로 변해서 그림 한 장으로 안 된다. 흔한 해법은
-- (a) 단계별 프레임을 미리 구워두기 (b) 실행 중에 호를 그리기 인데,
-- (a)는 프레임 수만큼 아틀라스가 붓고 단계가 뚝뚝 끊긴다.
-- (b)는 보통 안티에일리어싱된 매끈한 호가 나와서 **픽셀아트가 아니게 된다**.
-- 그래서 WaveDial.ts가 (b)를 쓰되 **픽셀 격자에 스냅해서** 그린다 — 홈(트랙) 안의
-- 픽셀 목록을 12시부터 시계방향으로 미리 구해 두고, 비율만큼 앞에서부터 칠한다.
-- 이 파일은 그 홈이 파인 몸통까지만 그린다.
--
-- 실행 (저장소 루트에서 — outdir는 절대경로):
--   "$ASE" -b --script-param outdir="$(pwd)/assets/ui/hud" --script assets/_generators/ui_clock.lua
--   pnpm build:atlas

local outdir = app.params['outdir']
assert(outdir, '--script-param outdir=<assets/ui/hud 절대경로> 필요')

-- theme.ts 팔레트와 같은 계열
local OUTLINE   = Color{ r = 0x0B, g = 0x0D, b = 0x12 }
local STROKE    = Color{ r = 0x4A, g = 0x52, b = 0x62 }
local STEEL_HI  = Color{ r = 0x7C, g = 0x86, b = 0x96 }
local STEEL_LO  = Color{ r = 0x30, g = 0x36, b = 0x42 }
local TRACK     = Color{ r = 0x23, g = 0x28, b = 0x33 }
local TRACK_DIM = Color{ r = 0x18, g = 0x1B, b = 0x24 }
local FACE      = Color{ r = 0x14, g = 0x16, b = 0x1D }
local FACE_EDGE = Color{ r = 0x1E, g = 0x22, b = 0x2C }

local GOLD_HI   = Color{ r = 0xFF, g = 0xE7, b = 0x9A }
local GOLD      = Color{ r = 0xF5, g = 0xC1, b = 0x45 }
local GOLD_DARK = Color{ r = 0xC8, g = 0x7A, b = 0x22 }
local RAY       = Color{ r = 0xFF, g = 0xD1, b = 0x5E }

local MOON_HI   = Color{ r = 0xEE, g = 0xF2, b = 0xFF }
local MOON      = Color{ r = 0xC6, g = 0xD2, b = 0xEC }
local MOON_DARK = Color{ r = 0x8A, g = 0x9A, b = 0xC0 }
local STAR      = Color{ r = 0xDC, g = 0xE6, b = 0xFF }

-- ---------------------------------------------------------------- 공용

local function save(name, size, drawFn)
  local spr = Sprite(size, size, ColorMode.RGB)
  local img = Image(size, size, ColorMode.RGB)
  img:clear(app.pixelColor.rgba(0, 0, 0, 0))
  drawFn(img, size)
  spr:newCel(spr.layers[1], 1, img, Point(0, 0))
  local tag = spr:newTag(1, 1)
  tag.name = 'base'
  spr:saveAs(outdir .. '/' .. name .. '.aseprite')
  spr:close()
  print('saved: ' .. name)
end

local function put(img, x, y, c)
  if x < 0 or y < 0 or x >= img.width or y >= img.height then return end
  img:drawPixel(x, y, c)
end

--- 픽셀 원. r*r + r 로 재는 건 픽셀아트에서 원을 둥글게 보이게 하는 관용 보정이다 —
--- r*r만 쓰면 상하좌우 끝이 뾰족해진다.
local function disc(img, cx, cy, r, c)
  for y = cy - r, cy + r do
    for x = cx - r, cx + r do
      local dx, dy = x - cx, y - cy
      if dx * dx + dy * dy <= r * r + r then put(img, x, y, c) end
    end
  end
end

--- 안쪽 반지름 rIn ~ 바깥 rOut 사이(고리)에만 fn(x, y, dx, dy)를 적용한다.
local function annulus(img, cx, cy, rIn, rOut, fn)
  for y = cy - rOut, cy + rOut do
    for x = cx - rOut, cx + rOut do
      local dx, dy = x - cx, y - cy
      local d2 = dx * dx + dy * dy
      if d2 <= rOut * rOut + rOut and d2 > rIn * rIn + rIn then fn(x, y, dx, dy) end
    end
  end
end

-- ---------------------------------------------------------------- 시계 몸통
--
-- 반지름별 구성 (37x37, 중심 18,18):
--   18      바깥 외곽선
--   16~17   강철 베젤 (위 밝고 아래 어두운 베벨)
--   15      외곽선
--   12~14   남은 시간 게이지가 깔릴 홈 — WaveDial.ts가 이 반지름을 그대로 쓴다
--   11      외곽선
--   ~10     안쪽 판 (해/달 + 날짜 숫자가 올라간다)

local function clockFace(img, size)
  local c = (size - 1) // 2

  disc(img, c, c, 18, OUTLINE)
  disc(img, c, c, 17, STROKE)
  disc(img, c, c, 15, OUTLINE)
  disc(img, c, c, 14, TRACK)
  disc(img, c, c, 11, OUTLINE)
  disc(img, c, c, 10, FACE)

  -- 베젤 베벨: 위쪽은 빛을 받고 아래쪽은 그늘. 금속 테두리로 읽히게 하는 최소 장치다.
  annulus(img, c, c, 15, 17, function(x, y, _dx, dy)
    if dy <= -8 then put(img, x, y, STEEL_HI)
    elseif dy >= 8 then put(img, x, y, STEEL_LO) end
  end)

  -- 홈 안쪽 위를 한 톤 어둡게 — 실제로 파인 것처럼 보인다.
  annulus(img, c, c, 11, 14, function(x, y, _dx, dy)
    if dy <= -6 then put(img, x, y, TRACK_DIM) end
  end)

  -- 안쪽 판의 아래 가장자리만 살짝 밝혀 오목한 렌즈처럼 만든다.
  annulus(img, c, c, 9, 10, function(x, y, _dx, dy)
    if dy >= 5 then put(img, x, y, FACE_EDGE) end
  end)
end

-- ---------------------------------------------------------------- 해 / 달

local function sun(img, size)
  local c = (size - 1) // 2

  -- 광선 여덟 갈래. 가로세로는 길게, 대각선은 짧게 — 전부 같은 길이면 톱니바퀴로 보인다.
  local rays = {
    { 0, -1, 10 }, { 0, 1, 10 }, { -1, 0, 10 }, { 1, 0, 10 },
    { -1, -1, 9 }, { 1, -1, 9 }, { -1, 1, 9 }, { 1, 1, 9 },
  }
  for _, ray in ipairs(rays) do
    local dx, dy, reach = ray[1], ray[2], ray[3]
    for r = 8, reach do
      put(img, c + dx * r, c + dy * r, r == reach and GOLD_DARK or RAY)
    end
  end

  disc(img, c, c, 8, OUTLINE)
  disc(img, c, c, 7, GOLD_DARK)
  disc(img, c, c, 6, GOLD)
  -- 왼쪽 위에서 빛이 온다 — 게임 안 다른 스프라이트와 같은 광원 방향.
  disc(img, c - 2, c - 2, 3, GOLD_HI)
end

local function moon(img, size)
  local c = (size - 1) // 2

  disc(img, c, c, 8, OUTLINE)
  disc(img, c, c, 7, MOON_DARK)
  disc(img, c, c, 6, MOON)
  disc(img, c - 2, c - 3, 3, MOON_HI)

  -- 크레이터는 가장자리에만 둔다 — 가운데는 날짜 숫자가 덮는다.
  disc(img, c - 4, c + 3, 1, MOON_DARK)
  disc(img, c + 4, c - 1, 1, MOON_DARK)
  disc(img, c + 2, c + 4, 0, MOON_DARK)

  -- 잔별 셋. 십자 한 픽셀씩이라 확대해도 별로 읽힌다.
  for _, s in ipairs({ { -9, -6 }, { 9, 4 }, { 6, -9 } }) do
    local sx, sy = c + s[1], c + s[2]
    put(img, sx, sy, STAR)
    put(img, sx - 1, sy, MOON_DARK)
    put(img, sx + 1, sy, MOON_DARK)
    put(img, sx, sy - 1, MOON_DARK)
    put(img, sx, sy + 1, MOON_DARK)
  end
end

-- ---------------------------------------------------------------- 생성

save('hud_clock_face', 37, clockFace)
save('hud_clock_sun', 21, sun)
save('hud_clock_moon', 21, moon)
