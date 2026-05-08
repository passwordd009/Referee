#!/usr/bin/env python3
"""
Referee vision server — MediaPipe Face Mesh over WebSocket.
Captures webcam, computes smile score, broadcasts face state at ~30fps.
"""
import asyncio
import json
import concurrent.futures
import cv2
import mediapipe as mp
import websockets

# MediaPipe 468-landmark indices used for smile detection
_IDX = {
    'FACE_LEFT':   234,
    'FACE_RIGHT':  454,
    'MOUTH_LEFT':   61,
    'MOUTH_RIGHT': 291,
    'LIP_TOP':      13,
    'LIP_BOTTOM':   14,
}

_CONNECTED: set = set()
_executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _process_frame(frame, face_mesh):
    h, w = frame.shape[:2]
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    results = face_mesh.process(rgb)

    if not results.multi_face_landmarks:
        return {'faceDetected': False, 'smileScore': 0.0, 'mouthOpen': False}

    lm = results.multi_face_landmarks[0].landmark
    face_w = abs(lm[_IDX['FACE_RIGHT']].x - lm[_IDX['FACE_LEFT']].x)
    if face_w < 0.01:
        return {'faceDetected': False, 'smileScore': 0.0, 'mouthOpen': False}

    mid_lip_y = (lm[_IDX['LIP_TOP']].y + lm[_IDX['LIP_BOTTOM']].y) / 2
    corner_rise = (
        (mid_lip_y - lm[_IDX['MOUTH_LEFT']].y) +
        (mid_lip_y - lm[_IDX['MOUTH_RIGHT']].y)
    ) / 2
    mouth_w = abs(lm[_IDX['MOUTH_RIGHT']].x - lm[_IDX['MOUTH_LEFT']].x)
    width_ratio = mouth_w / face_w

    corner_score = _clamp(corner_rise / 0.04, 0.0, 1.0)
    width_score  = _clamp((width_ratio - 0.28) / 0.18, 0.0, 1.0)
    smile_score  = round(0.6 * corner_score + 0.4 * width_score, 4)

    vert_gap = abs(lm[_IDX['LIP_BOTTOM']].y - lm[_IDX['LIP_TOP']].y)
    mouth_open = bool(vert_gap > 0.018)

    # All 468 landmarks in pixel coords for canvas overlay
    pts = [{'x': round(lm[i].x * w, 1), 'y': round(lm[i].y * h, 1)}
           for i in range(len(lm))]

    # Bounding box from face oval landmarks
    xs = [lm[i].x * w for i in range(len(lm))]
    ys = [lm[i].y * h for i in range(len(lm))]
    bx, by = min(xs), min(ys)

    return {
        'faceDetected': True,
        'smileScore': smile_score,
        'mouthOpen': mouth_open,
        'landmarks': pts,
        'box': {
            'x': round(bx, 1),
            'y': round(by, 1),
            'width': round(max(xs) - bx, 1),
            'height': round(max(ys) - by, 1),
        },
    }


def _read_frame(cap):
    return cap.read()


async def vision_loop():
    cap = cv2.VideoCapture(0)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

    mp_face_mesh = mp.solutions.face_mesh
    face_mesh = mp_face_mesh.FaceMesh(
        max_num_faces=1,
        refine_landmarks=True,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    )

    loop = asyncio.get_event_loop()
    print('[vision] camera open, streaming…')

    try:
        while True:
            if not _CONNECTED:
                await asyncio.sleep(0.05)
                continue

            ret, frame = await loop.run_in_executor(_executor, _read_frame, cap)
            if not ret:
                await asyncio.sleep(0.05)
                continue

            state = _process_frame(frame, face_mesh)
            msg = json.dumps(state)

            dead = set()
            for ws in list(_CONNECTED):
                try:
                    await ws.send(msg)
                except Exception:
                    dead.add(ws)
            _CONNECTED.difference_update(dead)

            await asyncio.sleep(1 / 30)
    finally:
        cap.release()
        face_mesh.close()


async def handler(websocket):
    _CONNECTED.add(websocket)
    print(f'[vision] client connected ({len(_CONNECTED)} total)')
    try:
        await websocket.wait_closed()
    finally:
        _CONNECTED.discard(websocket)
        print(f'[vision] client disconnected ({len(_CONNECTED)} remaining)')


async def main():
    print('[vision] starting on ws://localhost:8765')
    async with websockets.serve(handler, 'localhost', 8765):
        await vision_loop()


if __name__ == '__main__':
    asyncio.run(main())
