# Generates the toolbar/store icons: the "out" button from LinkedIn's top bar,
# blue "out" on a light tile with a blue border.
# Run: python3 scripts/make-icons.py
from PIL import Image, ImageDraw, ImageFont

BLUE = (10, 102, 194, 255)
FONTS = ["/System/Library/Fonts/HelveticaNeue.ttc", "/System/Library/Fonts/Helvetica.ttc"]


def font(size):
    for path in FONTS:
        try:
            return ImageFont.truetype(path, size, index=1)  # bold
        except OSError:
            pass
    return ImageFont.load_default()


def icon(size):
    S = size * 8  # draw big, then scale down for smooth edges
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    border = max(S // 16, 8)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=S // 5, fill=(240, 246, 252, 255), outline=BLUE, width=border)
    f = font(int(S * 0.5))
    box = d.textbbox((0, 0), "out", font=f)
    w, h = box[2] - box[0], box[3] - box[1]
    d.text(((S - w) / 2 - box[0], (S - h) / 2 - box[1]), "out", font=f, fill=BLUE)
    return img.resize((size, size), Image.LANCZOS)


for size in (16, 32, 48, 128):
    icon(size).save(f"extension/icons/icon-{size}.png")
print("icons written")
