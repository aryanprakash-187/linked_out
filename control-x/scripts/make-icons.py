# Generates the toolbar/store icons: a dark tile with a focus ring and dot.
# Run: python3 scripts/make-icons.py
from PIL import Image, ImageDraw

S = 512
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle([0, 0, S - 1, S - 1], radius=112, fill=(22, 22, 26, 255))
c = S // 2
ring_r, ring_w = 150, 44
d.ellipse([c - ring_r, c - ring_r, c + ring_r, c + ring_r], outline=(255, 255, 255, 255), width=ring_w)
dot_r = 56
d.ellipse([c - dot_r, c - dot_r, c + dot_r, c + dot_r], fill=(255, 106, 51, 255))
for size in (16, 32, 48, 128):
    img.resize((size, size), Image.LANCZOS).save(f"extension/icons/icon-{size}.png")
print("icons written")
