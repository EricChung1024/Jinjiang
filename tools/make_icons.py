#!/usr/bin/env python3
"""用真實鍋貼照片產生 PWA 圖示（鍋貼＋橘金色發光）。

用法：python3 tools/make_icons.py [照片路徑] [cx cy r]
  預設使用 assets/hero-poster.png 裡那顆冒汁的鍋貼（圓心 520,318、半徑 100）。
  之後若有更高解析度的鍋貼照片，把照片放進來重跑即可，不需要改其他檔案。
"""
import sys
from PIL import Image, ImageDraw, ImageFilter, ImageChops

SRC = sys.argv[1] if len(sys.argv) > 1 else 'assets/hero-poster.png'
CX, CY, R = (map(int, sys.argv[2:5]) if len(sys.argv) >= 5 else (520, 318, 100))
OUT = 'assets/icons'
BG = (43, 29, 20)          # 深棕（品牌 wood-900）
GLOW = (255, 150, 50)      # 橘金色發光

photo = Image.open(SRC).convert('RGB').crop((CX - R, CY - R, CX + R, CY + R))

def radial(size, inner, outer, power=1.6):
    """由中心向外漸層的圓形光暈（以 L 灰階遮罩表示強度）。"""
    g = Image.new('L', (size, size), 0)
    px = g.load(); c = size / 2
    for y in range(size):
        for x in range(size):
            d = ((x - c) ** 2 + (y - c) ** 2) ** .5 / c
            v = max(0.0, 1 - d) ** power
            px[x, y] = int(255 * v)
    return g

def make(size, photo_frac, maskable=False):
    S = size * 2                                  # 超取樣，最後縮小較平滑
    img = Image.new('RGB', (S, S), BG)
    # 背景整片暖光（從中間往外變暗）
    halo = Image.new('RGB', (S, S), GLOW)
    img = Image.composite(halo, img, radial(S, 0, 0, 1.25).point(lambda v: int(v * .55)))

    d = int(S * photo_frac)                       # 照片直徑
    ph = photo.resize((d, d), Image.LANCZOS)
    # 邊緣羽化的圓形遮罩
    m = Image.new('L', (d, d), 0)
    ImageDraw.Draw(m).ellipse((0, 0, d - 1, d - 1), fill=255)
    m = m.filter(ImageFilter.GaussianBlur(d * .012))
    # 發光外圈：放大並模糊的橘色圓
    ring = Image.new('L', (S, S), 0)
    off = (S - d) // 2
    ImageDraw.Draw(ring).ellipse((off - d * .05, off - d * .05, off + d * 1.05, off + d * 1.05), fill=255)
    ring = ring.filter(ImageFilter.GaussianBlur(S * .035))
    img = Image.composite(Image.new('RGB', (S, S), (255, 170, 70)), img, ring.point(lambda v: int(v * .9)))
    img.paste(ph, (off, off), m)
    # 照片上方一點點高光，增加「亮亮的」感覺
    spark = Image.new('RGB', (S, S), (255, 214, 140))
    sm = Image.new('L', (S, S), 0)
    ImageDraw.Draw(sm).ellipse((S * .5 - d * .5, S * .5 - d * .5, S * .5 + d * .5, S * .5 + d * .5), outline=255, width=int(S * .006))
    sm = sm.filter(ImageFilter.GaussianBlur(S * .004)).point(lambda v: int(v * .7))
    img = Image.composite(spark, img, sm)
    return img.resize((size, size), Image.LANCZOS)

# any：圓角方形留白較少；maskable：主體在中心 80% 安全區內
make(512, .78).save(f'{OUT}/icon-512.png', optimize=True)
make(192, .78).save(f'{OUT}/icon-192.png', optimize=True)
make(512, .60, True).save(f'{OUT}/icon-maskable-512.png', optimize=True)
make(192, .60, True).save(f'{OUT}/icon-maskable-192.png', optimize=True)
make(180, .66).save(f'{OUT}/apple-touch-icon.png', optimize=True)
make(64, .80).save(f'{OUT}/favicon-64.png', optimize=True)
print('done')
