"""Convert a JPEG into a y4m video (Chromium fake-webcam format).

Center-crops to 640x480, converts RGB -> YUV420 planar, repeats the
frame N times. y4m is just a text header + FRAME markers + raw planes.
"""
import sys
from PIL import Image

W, H, FRAMES = 640, 480, 40  # 4 seconds at 10 fps

def rgb_to_yuv420(img):
    # ITU-R BT.601 full-range-ish conversion, good enough for detection.
    rgb = img.load()
    y_plane = bytearray(W * H)
    u_plane = bytearray(W * H // 4)
    v_plane = bytearray(W * H // 4)
    for j in range(H):
        for i in range(W):
            r, g, b = rgb[i, j][:3]
            y = int(0.299 * r + 0.587 * g + 0.114 * b)
            y_plane[j * W + i] = max(0, min(255, y))
    for j in range(0, H, 2):
        for i in range(0, W, 2):
            r, g, b = rgb[i, j][:3]
            u = int(-0.169 * r - 0.331 * g + 0.5 * b + 128)
            v = int(0.5 * r - 0.419 * g - 0.081 * b + 128)
            idx = (j // 2) * (W // 2) + (i // 2)
            u_plane[idx] = max(0, min(255, u))
            v_plane[idx] = max(0, min(255, v))
    return bytes(y_plane), bytes(u_plane), bytes(v_plane)

def main(src, dst):
    img = Image.open(src).convert('RGB')
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
            f.write(y); f.write(u); f.write(v)
    print(f'{dst}: {FRAMES} frames, {W}x{H}')

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
