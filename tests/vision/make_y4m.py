"""Convert a JPEG into a y4m video (Chromium fake-webcam format).

Center-crops to 640x480, converts RGB -> YUV420 planar, repeats the
frame N times. y4m is just a text header + FRAME markers + raw planes.

Optional third arg: brightness factor (e.g. 0.25 simulates a dim room).
Optional fourth arg: sensor noise sigma (e.g. 10) — fresh noise per frame,
like a real webcam sensor in low light.
"""
import random
import sys
from PIL import Image

W, H, FRAMES = 640, 480, 40  # 4 seconds at 10 fps

def rgb_to_yuv420(img):
    # ITU-R BT.601 *studio range* (Y 16-235, chroma 16-240) — this is what
    # real cameras produce and what Chromium's y4m decoder assumes. Writing
    # full-range values here would get dark pixels crushed to black.
    rgb = img.load()
    y_plane = bytearray(W * H)
    u_plane = bytearray(W * H // 4)
    v_plane = bytearray(W * H // 4)
    for j in range(H):
        for i in range(W):
            r, g, b = rgb[i, j][:3]
            y = 0.299 * r + 0.587 * g + 0.114 * b
            y_plane[j * W + i] = max(16, min(235, round(16 + y * 219 / 255)))
    for j in range(0, H, 2):
        for i in range(0, W, 2):
            r, g, b = rgb[i, j][:3]
            u = -0.169 * r - 0.331 * g + 0.5 * b
            v = 0.5 * r - 0.419 * g - 0.081 * b
            idx = (j // 2) * (W // 2) + (i // 2)
            u_plane[idx] = max(16, min(240, round(128 + u * 224 / 255)))
            v_plane[idx] = max(16, min(240, round(128 + v * 224 / 255)))
    return bytes(y_plane), bytes(u_plane), bytes(v_plane)

def add_noise(plane, sigma):
    rnd = random.gauss
    return bytes(max(0, min(255, round(v + rnd(0, sigma)))) for v in plane)

def main(src, dst, brightness=1.0, noise=0.0):
    img = Image.open(src).convert('RGB')
    if brightness != 1.0:
        img = img.point(lambda v: max(0, min(255, round(v * brightness))))
    # Scale up so the shorter side covers, then center-crop to 640x480.
    scale = max(W / img.width, H / img.height)
    img = img.resize((round(img.width * scale), round(img.height * scale)))
    left = (img.width - W) // 2
    # Bias the crop toward the top of the photo — that's where faces are.
    top = min((img.height - H) // 2, img.height // 6)
    img = img.crop((left, top, left + W, top + H))

    y, u, v = rgb_to_yuv420(img)
    with open(dst, 'wb') as f:
        f.write(f'YUV4MPEG2 W{W} H{H} F10:1 Ip A1:1 C420\n'.encode())
        for _ in range(FRAMES):
            f.write(b'FRAME\n')
            if noise > 0:
                f.write(add_noise(y, noise))  # fresh luma noise each frame
            else:
                f.write(y)
            f.write(u); f.write(v)
    print(f'{dst}: {FRAMES} frames, {W}x{H}, noise={noise}')

if __name__ == '__main__':
    main(
        sys.argv[1], sys.argv[2],
        float(sys.argv[3]) if len(sys.argv) > 3 else 1.0,
        float(sys.argv[4]) if len(sys.argv) > 4 else 0.0,
    )
