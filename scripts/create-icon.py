"""Render the app's simple geometric logo as Windows icon assets."""
from pathlib import Path
from PIL import Image, ImageDraw

out = Path(__file__).resolve().parent.parent / "assets"
out.mkdir(exist_ok=True)
im = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
d = ImageDraw.Draw(im)
d.rounded_rectangle((12, 12, 1012, 1012), radius=232, fill="#234F42")
# A keyhole above two waves: a private island for your passwords.
d.ellipse((385, 228, 639, 482), fill="#F5F3E8")
d.polygon([(463, 420), (561, 420), (594, 608), (430, 608)], fill="#F5F3E8")
d.arc((212, 557, 516, 765), 12, 164, fill="#BCD2B8", width=45)
d.arc((508, 557, 812, 765), 16, 168, fill="#BCD2B8", width=45)
d.ellipse((748, 226, 800, 278), fill="#D7C79D")
im.resize((256, 256), Image.Resampling.LANCZOS).save(out / "icon.png")
im.save(out / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
