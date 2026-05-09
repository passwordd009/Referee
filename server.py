#!/usr/bin/env python3
"""
Referee vision server — MediaPipe Tasks FaceLandmarker over WebSocket.
Auto-downloads the model, captures webcam, streams face state at ~30fps.
"""
import asyncio
import json
import os
import urllib.request
import concurrent.futures
import cv2
import mediapipe as mp
import websockets

# ---------------------------------------------------------------------------
# Model bootstrap
# ---------------------------------------------------------------------------
MODEL_PATH = 'face_landmarker.task'
MODEL_URL = (
    'https://storage.googleapis.com/mediapipe-models/'
    'face_landmarker/face_landmarker/float16/1/face_landmarker.task'
)

if not os.path.exists(MODEL_PATH):
    print(f'[vision] downloading {MODEL_PATH} (~29 MB)…')
    urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
    print('[vision] model downloaded ✓')

# ---------------------------------------------------------------------------
# MediaPipe Tasks setup
# ---------------------------------------------------------------------------
BaseOptions        = mp.tasks.BaseOptions
FaceLandmarker     = mp.tasks.vision.FaceLandmarker
FaceLandmarkerOpts = mp.tasks.vision.FaceLandmarkerOptions
VisionRunningMode  = mp.tasks.vision.RunningMode

# Landmark indices for smile detection (MediaPipe 478-point canonical face model)
_IDX = dict(FACE_LEFT=234, FACE_RIGHT=454,
            MOUTH_LEFT=61, MOUTH_RIGHT=291,
            LIP_TOP=13,    LIP_BOTTOM=14)

# ---------------------------------------------------------------------------
# Smile scoring (pure function, same formula as original plan)
# ---------------------------------------------------------------------------
def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _build_state(face_landmarks, w: int, h: int) -> dict:
    lm = face_landmarks
    face_w = abs(lm[_IDX['FACE_RIGHT']].x - lm[_IDX['FACE_LEFT']].x)
    if face_w < 0.01:
        return _no_face()

    mid_lip_y = (lm[_IDX['LIP_TOP']].y + lm[_IDX['LIP_BOTTOM']].y) / 2
    corner_rise = (
        (mid_lip_y - lm[_IDX['MOUTH_LEFT']].y) +
        (mid_lip_y - lm[_IDX['MOUTH_RIGHT']].y)
    ) / 2
    mouth_w     = abs(lm[_IDX['MOUTH_RIGHT']].x - lm[_IDX['MOUTH_LEFT']].x)
    width_ratio = mouth_w / face_w

    corner_score = _clamp(corner_rise / 0.04,         0.0, 1.0)
    width_score  = _clamp((width_ratio - 0.28) / 0.18, 0.0, 1.0)
    smile_score  = round(0.6 * corner_score + 0.4 * width_score, 4)

    vert_gap   = abs(lm[_IDX['LIP_BOTTOM']].y - lm[_IDX['LIP_TOP']].y)
    mouth_open = bool(vert_gap > 0.018)

    pts = [{'x': round(lm[i].x * w, 1), 'y': round(lm[i].y * h, 1)}
           for i in range(len(lm))]
    xs = [p['x'] for p in pts]
    ys = [p['y'] for p in pts]
    bx, by = min(xs), min(ys)

    return {
        'faceDetected': True,
        'smileScore':   smile_score,
        'mouthOpen':    mouth_open,
        'landmarks':    pts,
        'box': {'x': round(bx, 1), 'y': round(by, 1),
                'width': round(max(xs) - bx, 1),
                'height': round(max(ys) - by, 1)},
    }


def _no_face() -> dict:
    return {'faceDetected': False, 'smileScore': 0.0, 'mouthOpen': False}

# ---------------------------------------------------------------------------
# WebSocket registry
# ---------------------------------------------------------------------------
_CONNECTED: set = set()
_executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)


async def _broadcast(msg: str) -> None:
    dead = set()
    for ws in list(_CONNECTED):
        try:
            await ws.send(msg)
        except Exception:
            dead.add(ws)
    _CONNECTED.difference_update(dead)

# ---------------------------------------------------------------------------
# Vision loop — runs on the asyncio thread, capture runs in executor
# ---------------------------------------------------------------------------
def _read(cap):
    return cap.read()


async def vision_loop() -> None:
    cap = cv2.VideoCapture(0)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

    options = FaceLandmarkerOpts(
        base_options=BaseOptions(model_asset_path=MODEL_PATH),
        running_mode=VisionRunningMode.VIDEO,
        num_faces=1,
        min_face_detection_confidence=0.5,
        min_face_presence_confidence=0.5,
        min_tracking_confidence=0.5,
    )

    loop = asyncio.get_event_loop()
    timestamp_ms = 0
    interval_ms  = int(1000 / 30)

    print('[vision] camera open, streaming…')
    with FaceLandmarker.create_from_options(options) as landmarker:
        while True:
            if not _CONNECTED:
                await asyncio.sleep(0.05)
                continue

            ret, frame = await loop.run_in_executor(_executor, _read, cap)
            if not ret:
                await asyncio.sleep(0.05)
                continue

            h, w = frame.shape[:2]
            rgb      = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

            result = landmarker.detect_for_video(mp_image, timestamp_ms)
            timestamp_ms += interval_ms

            if result.face_landmarks:
                state = _build_state(result.face_landmarks[0], w, h)
            else:
                state = _no_face()

            await _broadcast(json.dumps(state))
            await asyncio.sleep(interval_ms / 1000)

    cap.release()

# ---------------------------------------------------------------------------
# WebSocket handler
# ---------------------------------------------------------------------------
async def handler(websocket) -> None:
    _CONNECTED.add(websocket)
    print(f'[vision] client connected ({len(_CONNECTED)} total)')
    try:
        await websocket.wait_closed()
    finally:
        _CONNECTED.discard(websocket)
        print(f'[vision] client disconnected ({len(_CONNECTED)} remaining)')


async def main() -> None:
    print('[vision] starting on ws://localhost:8765')
    async with websockets.serve(handler, 'localhost', 8765):
        await vision_loop()


if __name__ == '__main__':
    asyncio.run(main())
