-- 이펙트 확인용. 밤 배경색을 깔고 프레임을 가로로 이어붙여 확대 저장한다.
-- 투명 배경 그대로 보면 밝은 색이 흰 바탕에 묻혀서 판단이 안 된다.
--   aseprite -b --script-param src=... --script-param out=... --script preview.lua

local src = app.open(app.params['src'])
local scale = tonumber(app.params['scale'] or '4')
local count = #src.frames
local w, h = src.width, src.height

local BG = Color{ r = 26, g = 32, b = 46 }

local sheet = Sprite(w * count, h, ColorMode.RGB)
local image = Image(w * count, h, ColorMode.RGB)

for y = 0, h - 1 do
  for x = 0, w * count - 1 do
    -- 프레임 경계에 옅은 세로선을 넣어 몇 번째 프레임인지 셀 수 있게 한다
    local isBorder = (x % w == 0) and x > 0
    image:drawPixel(x, y, isBorder and Color{ r = 60, g = 70, b = 92 } or BG)
  end
end

for index = 1, count do
  local cel = src.cels[index]
  if cel then
    for y = 0, cel.image.height - 1 do
      for x = 0, cel.image.width - 1 do
        local px = cel.image:getPixel(x, y)
        if app.pixelColor.rgbaA(px) > 0 then
          image:drawPixel((index - 1) * w + x + cel.position.x, y + cel.position.y, px)
        end
      end
    end
  end
end

sheet:newCel(sheet.layers[1], 1, image, Point(0, 0))
sheet:resize(w * count * scale, h * scale)
sheet:saveAs(app.params['out'])
print('preview: ' .. app.params['out'])
