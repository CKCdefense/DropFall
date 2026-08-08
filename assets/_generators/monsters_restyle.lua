-- 몬스터 리스타일 레시피 — 라이센스 팩 원본에 적용하는 색 "연산"만 담는다.
--
-- sprites/monsters/README.md의 규칙: 결과물(.aseprite/atlas)은 커밋 금지, 변환
-- 과정(이 파일)만 커밋한다. 그래서 원본 팔레트를 하드코딩하지 않고 색상환
-- 회전·채도/명도 배율·대비 같은 연산으로만 쓴다.
--
-- 레이어별 처리 (팩 공통 구조: shadow / body / fx):
--   shadow  전 몬스터 공통 — 밝은 회색 타원이 타일 위에 떠 보여서, 거의 검정으로
--           내리고 살짝 반투명하게 만들어 지형에 녹아들게 한다
--   body    몬스터별 프로필(아래 PROFILES)로 미세 조정. 형태·프레임·태그는 그대로
--           두므로 공격 모션 등 액션 타이밍에는 영향이 없다
--   fx      손대지 않는다 — 공격 이펙트 가독성은 원본이 이미 좋다
--
-- 실행 (전 몬스터 일괄, 저장소 루트에서):
--   ASE="C:/Program Files (x86)/Steam/steamapps/common/Aseprite/Aseprite.exe"
--   for f in assets/sprites/monsters/*.aseprite assets/sprites/monsters/boss/*.aseprite; do
--     "$ASE" -b --script-param src="$(pwd)/$f" --script assets/_generators/monsters_restyle.lua
--   done
--   pnpm build:atlas
--
-- src는 절대경로. 결과는 같은 파일에 덮어쓴다 — 반드시 원본을 백업/보존한 뒤 돌릴 것
-- (원본은 dropfall-assets/sources에 있고, 이 스크립트는 원본에서 1회 적용을 전제한다.
--  이미 변환된 파일에 다시 돌리면 조정이 중첩되어 색이 계속 밀린다).

-- ── 몬스터별 색 프로필 ─────────────────────────────────────────────────────────
-- hue      색상환 회전(도). 양수 = 빨강→보라 방향
-- sat/val  채도·명도 배율
-- con      명도 대비 배율 (0.45 피벗) — 타일 위에서 실루엣이 또렷해진다
-- cool     어두운 픽셀(V<0.35)을 한색(≈보라 280°) 쪽으로 섞는 비율.
--          타일 팔레트가 한색 계열이라, 그림자 톤을 식히면 지형에 잘 앉는다
local PROFILES = {
  -- 일반 몹: 각자 색 정체성을 조금씩 벌려서 한 화면에 섞여도 구분되게 한다
  ["Lava Slime"]      = { hue = -6,  sat = 1.12, val = 1.02, con = 1.06, cool = 0.00 }, -- 더 뜨거운 주황 용암
  ["Hellhound"]       = { hue = 0,   sat = 0.92, val = 0.96, con = 1.10, cool = 0.30 }, -- 차갑고 어두운 털
  ["Blood Monster_A"] = { hue = -8,  sat = 1.10, val = 0.97, con = 1.08, cool = 0.00 }, -- 깊은 진홍
  ["Demon_A"]         = { hue = 12,  sat = 1.05, val = 1.00, con = 1.06, cool = 0.15 }, -- 자홍 기운
  ["Eyeball Monster"] = { hue = 18,  sat = 1.08, val = 1.00, con = 1.05, cool = 0.10 }, -- 분홍-보라 안구
  ["Minotaur"]        = { hue = 4,   sat = 0.95, val = 0.98, con = 1.10, cool = 0.20 }, -- 흙빛 유지, 실루엣 강화
  -- 보스: 위압감 위주 — 채도보다 대비를 세게
  ["Black Knight_A"]  = { hue = 0,   sat = 0.85, val = 1.00, con = 1.12, cool = 0.35 }, -- 차가운 강철
  ["Black Knight_C"]  = { hue = 10,  sat = 0.90, val = 1.00, con = 1.12, cool = 0.35 },
  ["Demon_E"]         = { hue = -10, sat = 1.08, val = 0.96, con = 1.10, cool = 0.10 }, -- 더 깊은 지옥빛
  ["Flame Golem"]     = { hue = -5,  sat = 1.15, val = 1.03, con = 1.08, cool = 0.00 }, -- 더 뜨겁게
}

-- 그림자: 색은 12%만 남겨 거의 검정으로, 알파는 82%로 낮춰 타일 무늬가 살짝 비치게
local SHADOW_RGB_MULT = 0.12
local SHADOW_ALPHA_MULT = 0.82

local COOL_HUE = 280        -- cool 혼합의 목표 색상(보라-남색 사이)
local COOL_V_THRESHOLD = 0.35
local CON_PIVOT = 0.45

-- ── RGB↔HSV ──────────────────────────────────────────────────────────────────
local function rgb2hsv(r, g, b)
  r, g, b = r / 255, g / 255, b / 255
  local mx, mn = math.max(r, g, b), math.min(r, g, b)
  local d = mx - mn
  local h = 0
  if d > 0 then
    if mx == r then h = ((g - b) / d) % 6
    elseif mx == g then h = (b - r) / d + 2
    else h = (r - g) / d + 4 end
    h = h * 60
  end
  local s = mx == 0 and 0 or d / mx
  return h, s, mx
end

local function hsv2rgb(h, s, v)
  local c = v * s
  local x = c * (1 - math.abs((h / 60) % 2 - 1))
  local m = v - c
  local r, g, b
  if h < 60 then r, g, b = c, x, 0
  elseif h < 120 then r, g, b = x, c, 0
  elseif h < 180 then r, g, b = 0, c, x
  elseif h < 240 then r, g, b = 0, x, c
  elseif h < 300 then r, g, b = x, 0, c
  else r, g, b = c, 0, x end
  local function q(n) return math.max(0, math.min(255, math.floor((n + m) * 255 + 0.5))) end
  return q(r), q(g), q(b)
end

-- 색상환 최단 경로 보간 (예: 350°→280°는 -70°로 돈다)
local function mixHue(from, to, t)
  local d = (to - from + 180) % 360 - 180
  return (from + d * t) % 360
end

-- ── 픽셀 변환 ─────────────────────────────────────────────────────────────────
local pc = app.pixelColor

local function restyleBodyPixel(v, p)
  local a = pc.rgbaA(v)
  if a == 0 then return v end
  local h, s, val = rgb2hsv(pc.rgbaR(v), pc.rgbaG(v), pc.rgbaB(v))
  h = (h + p.hue) % 360
  -- 한색 그림자: 어두운 픽셀일수록(임계 대비 비율) 보라 쪽으로 식힌다
  if p.cool > 0 and val < COOL_V_THRESHOLD and s > 0.05 then
    local t = p.cool * (1 - val / COOL_V_THRESHOLD)
    h = mixHue(h, COOL_HUE, t)
  end
  s = math.min(1, s * p.sat)
  val = val * p.val
  val = CON_PIVOT + (val - CON_PIVOT) * p.con           -- 대비
  val = math.max(0, math.min(1, val))
  local r, g, b = hsv2rgb(h, s, val)
  return pc.rgba(r, g, b, a)
end

local function darkenShadowPixel(v)
  local a = pc.rgbaA(v)
  if a == 0 then return v end
  local function q(n) return math.floor(n * SHADOW_RGB_MULT + 0.5) end
  return pc.rgba(q(pc.rgbaR(v)), q(pc.rgbaG(v)), q(pc.rgbaB(v)),
    math.floor(a * SHADOW_ALPHA_MULT + 0.5))
end

-- ── 실행부 ────────────────────────────────────────────────────────────────────
local src = app.params["src"]
assert(src, "--script-param src=<절대경로> 필요")

local base = src:match("([^/\\]+)%.aseprite$")
local profile = PROFILES[base]
assert(profile, "프로필 없는 몬스터: " .. tostring(base))

local spr = app.open(src)
assert(spr, "열기 실패: " .. src)

-- 이 팩은 연결된 셀(linked cels)을 써서 같은 이미지가 여러 프레임에 공유된다.
-- 셀을 순서대로 돌며 무심코 변환하면 공유 이미지가 셀 수만큼 중복 변환된다 —
-- 제자리 수정은 물론이고, 복제→할당도 링크된 셀에 할당하면 공유 이미지 자체가
-- 교체되어 다음 셀에서 또 변환된다 (실측: Idle 6프레임 링크 → 그림자 알파가
-- 0.82^6 = 30%까지 내려갔다). 그래서 이미 변환한 이미지를 기억해 두고,
-- 처음 만나는 이미지만 정확히 1회 변환한다. 셀 링크는 그대로 유지된다.
local function transformLayer(layer, fn)
  local doneImages = {}
  for _, cel in ipairs(layer.cels) do
    local seen = false
    for _, d in ipairs(doneImages) do
      if d == cel.image then seen = true break end
    end
    if not seen then
      local img = cel.image:clone()
      for it in img:pixels() do it(fn(it())) end
      cel.image = img
      -- 할당 후 다시 읽어 스프라이트가 실제로 보관하는 객체를 기록한다
      doneImages[#doneImages + 1] = cel.image
    end
  end
end

local touched = { shadow = false, body = false }
local function walk(layers)
  for _, l in ipairs(layers) do
    if l.isGroup then
      walk(l.layers)
    elseif l.name == "shadow" then
      transformLayer(l, darkenShadowPixel)
      touched.shadow = true
    elseif l.name == "body" then
      transformLayer(l, function(v) return restyleBodyPixel(v, profile) end)
      touched.body = true
    end
    -- fx는 통과 — 공격 이펙트는 원본 그대로
  end
end
walk(spr.layers)
assert(touched.shadow and touched.body, "shadow/body 레이어를 못 찾음: " .. src)

spr:saveAs(src)
print("restyled: " .. base .. "  (frames=" .. #spr.frames .. ")")
