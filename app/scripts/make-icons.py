"""Make the app icons and splash logo from one logo picture.

Usage (from the app folder):
    python scripts/make-icons.py <logo.png|jpg> [--bg 2b2b2b] [--out public] [--fuzz 6] [--soft 26] [--glow X,Y]

The logo may sit on a plain background of any colour (taken from the picture's corners) or on a transparent one.
The background is removed with "colour to alpha", so faint AI haze or a slightly different background tone
cannot show as a square frame on the splash screen (the bug of the first icon).

Writes into --out:
  icon-512.png           transparent, logo ~84% wide   (manifest "any" icon + the in-app splash)
  icon-192.png           transparent, same layout       (favicon, manifest)
  icon-180.png           opaque on --bg, same layout    (iPhone home screen; iOS does not allow transparency)
  icon-maskable-512.png  opaque on --bg, logo ~74% wide (Android crops it to a circle / squircle: safe zone)

  splash.webp            transparent, 1024 px, same layout (in-app splash, sharp on big phones)
  splash-glow.webp       only with --glow X,Y: the lit checkmark (X,Y = a pixel inside it in the source picture),
                         same layout; the splash fades it in and out ("loading" pulse)

After running: keep --bg equal to background_color in public/manifest.webmanifest and #splash in index.html,
and bump CACHE in public/sw.js so installed phones fetch the new icons.
Needs Pillow (pip install pillow). Nothing here touches cargo data.
"""
import argparse
from PIL import Image, ImageDraw, ImageFilter


def hex_rgb(s):
    s = s.lstrip('#')
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))


def corner_bg(im):
    w, h = im.size
    px = im.load()
    pts = [px[x, y] for x, y in [(2, 2), (w - 3, 2), (2, h - 3), (w - 3, h - 3)]]
    return tuple(sorted(p[i] for p in pts)[1] for i in range(3))


def to_alpha(im, bg, fuzz, soft):
    """Colour to alpha against bg: distance <= fuzz -> transparent, >= soft -> as is, smooth in between."""
    src = im.convert('RGBA')
    out = Image.new('RGBA', src.size)
    sp, op = src.load(), out.load()
    w, h = src.size
    for y in range(h):
        for x in range(w):
            r, g, b, a0 = sp[x, y]
            if a0 == 0:
                op[x, y] = (0, 0, 0, 0)
                continue
            if a0 < 255:  # half-transparent source pixel (AI haze): judge it as it looks on the background
                f = a0 / 255
                r, g, b = (round(c * f + bc * (1 - f)) for c, bc in zip((r, g, b), bg))
                a0 = 255
            d =max(abs(r - bg[0]), abs(g - bg[1]), abs(b - bg[2]))
            if d <= fuzz:
                op[x, y] = (0, 0, 0, 0)
                continue
            a = 1.0 if d >= soft else (d - fuzz) / (soft - fuzz)
            if a < 1.0:  # un-mix the background so the edge keeps its own colour
                r, g, b = (max(0, min(255, round((c - bc * (1 - a)) / a))) for c, bc in zip((r, g, b), bg))
            op[x, y] = (r, g, b, round(a * a0))
    return out


def place(logo, size, frac, bg=None):
    """Fit the logo's content box into a square, frac of its side, centred."""
    box = logo.getbbox()
    art = logo.crop(box)
    scale = frac * size / max(art.size)
    art = art.resize((max(1, round(art.width * scale)), max(1, round(art.height * scale))), Image.LANCZOS)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(art, ((size - art.width) // 2, (size - art.height) // 2))
    if bg is None:
        return canvas
    flat = Image.new('RGBA', (size, size), bg + (255,))
    flat.alpha_composite(canvas)
    return flat.convert('RGB')


def glow_layer(src_rgb, seed, logo):
    """Lit copy of the dark checkmark around seed: bright cyan fill + soft halo, transparent elsewhere."""
    lum = src_rgb.convert('L')
    dark = lum.point(lambda v: 255 if v < 105 else 0)
    # open the mask: thin drawn lines (container ridges) vanish, the thick checkmark stays
    solid = dark.filter(ImageFilter.MinFilter(9)).filter(ImageFilter.MaxFilter(9))
    ImageDraw.floodfill(solid, seed, 128)
    mask = solid.point(lambda v: 255 if v == 128 else 0)
    if not mask.getbbox():
        raise SystemExit('--glow point is not inside a dark shape')
    mask = mask.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(1.5))
    w, h = src_rgb.size
    halo = mask.filter(ImageFilter.MaxFilter(15)).filter(ImageFilter.GaussianBlur(45)).point(lambda v: min(255, v * 2))
    out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    out.alpha_composite(Image.merge('RGBA', (*Image.new('RGB', (w, h), (63, 214, 224)).split(), halo.point(lambda v: v * 0.8))))
    out.alpha_composite(Image.merge('RGBA', (*Image.new('RGB', (w, h), (170, 250, 250)).split(), mask)))
    # cut with the logo's content box, so it lands on the checkmark after placing
    return out, logo.getbbox()


def place_box(layer, box, size, frac):
    """Like place(), but with a given content box (an overlay that must line up with the logo)."""
    art = layer.crop(box)
    scale = frac * size / max(art.size)
    art = art.resize((max(1, round(art.width * scale)), max(1, round(art.height * scale))), Image.LANCZOS)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(art, ((size - art.width) // 2, (size - art.height) // 2))
    return canvas


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('logo')
    ap.add_argument('--bg', default='2b2b2b', help='splash / opaque icon background (hex)')
    ap.add_argument('--out', default='public')
    ap.add_argument('--fuzz', type=int, default=6, help='distance from the logo background treated as background')
    ap.add_argument('--soft', type=int, default=26, help='distance from which a pixel is fully opaque')
    ap.add_argument('--frac', type=float, default=0.84)
    ap.add_argument('--mask-frac', type=float, default=0.74)
    ap.add_argument('--glow', help='X,Y of a pixel inside the checkmark (source picture) for splash-glow.webp')
    a = ap.parse_args()

    src = Image.open(a.logo)
    has_alpha = src.mode in ('RGBA', 'LA') or 'transparency' in src.info
    rgba = src.convert('RGBA')
    # background colour of the source: corners of an opaque picture, else the splash colour
    logo_bg = hex_rgb(a.bg) if has_alpha and rgba.getpixel((0, 0))[3] == 0 else corner_bg(rgba.convert('RGB'))
    logo = to_alpha(rgba, logo_bg, a.fuzz, a.soft)
    print('source', src.size, src.mode, 'background', '#%02x%02x%02x' % logo_bg, 'content box', logo.getbbox())

    bg = hex_rgb(a.bg)
    import os
    os.makedirs(a.out, exist_ok=True)
    out = lambda n: os.path.join(a.out, n)
    big = place(logo, 1024, a.frac)  # render once large, then downscale: sharper small icons
    big.resize((512, 512), Image.LANCZOS).save(out('icon-512.png'))
    big.resize((192, 192), Image.LANCZOS).save(out('icon-192.png'))
    place(logo, 1024, a.frac, bg).resize((180, 180), Image.LANCZOS).save(out('icon-180.png'))
    place(logo, 1024, a.mask_frac, bg).resize((512, 512), Image.LANCZOS).save(out('icon-maskable-512.png'))
    big.save(out('splash.webp'), quality=82, method=6)
    if a.glow:
        x, y = (int(v) for v in a.glow.split(','))
        g, box = glow_layer(rgba.convert('RGB'), (x, y), logo)
        place_box(g, box, 1024, a.frac).save(out('splash-glow.webp'), quality=82, method=6)
    print('written to', a.out)


if __name__ == '__main__':
    main()
