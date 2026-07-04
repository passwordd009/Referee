"""Reduce facial reflectance in a portrait (feathered oval mask).

Synthetic stress test: same photo, same background, same expression —
only the face/neck region gets darker. Tests detector robustness to
lower facial luminance (darker skin tones, underexposed faces).
"""
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

src, dst, factor = sys.argv[1], sys.argv[2], float(sys.argv[3])
img = Image.open(src).convert('RGB')
arr = np.asarray(img).astype(float)

# Face + neck oval for the 910x1137 Obama portrait (found by inspection).
mask = Image.new('L', img.size, 0)
d = ImageDraw.Draw(mask)
d.ellipse([340, 130, 620, 520], fill=255)   # face
d.ellipse([390, 420, 570, 600], fill=255)   # neck
mask = mask.filter(ImageFilter.GaussianBlur(25))
alpha = np.asarray(mask).astype(float)[..., None] / 255.0

out = arr * (1 - alpha) + arr * factor * alpha
Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(dst, quality=92)
print(f'{dst}: face reflectance x{factor}')
