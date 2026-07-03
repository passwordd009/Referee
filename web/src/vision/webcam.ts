export type WebcamError =
  | { kind: 'permission-denied' }
  | { kind: 'not-found' }
  | { kind: 'in-use' }
  | { kind: 'unknown'; message: string };

/** Resolves once the video element knows its dimensions. */
function waitForMetadata(videoEl: HTMLVideoElement): Promise<void> {
  if (videoEl.readyState >= 1) return Promise.resolve();
  return new Promise((resolve, reject) => {
    videoEl.onloadedmetadata = () => resolve();
    videoEl.onerror = () => reject(new Error('Video element error'));
  });
}

/**
 * Open the user's webcam into the given video element and start playback.
 * Never throws — camera problems come back as a typed error so callers
 * can show a useful message.
 */
export async function startWebcam(
  videoEl: HTMLVideoElement
): Promise<{ stream: MediaStream } | { error: WebcamError }> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });

    // Set as properties, not attributes — setAttribute('muted') does NOT
    // reliably mute an already-created element, and an unmuted video can
    // be blocked from autoplaying.
    videoEl.muted = true;
    videoEl.playsInline = true;
    videoEl.autoplay = true;
    videoEl.srcObject = stream;

    await waitForMetadata(videoEl);
    try {
      await videoEl.play();
    } catch {
      // A pending play() can be aborted by a re-render; one retry settles it.
      await videoEl.play();
    }
    return { stream };
  } catch (err) {
    if (err instanceof DOMException) {
      if (err.name === 'NotAllowedError') return { error: { kind: 'permission-denied' } };
      if (err.name === 'NotFoundError') return { error: { kind: 'not-found' } };
      if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        return { error: { kind: 'in-use' } }; // camera claimed by another app
      }
    }
    return { error: { kind: 'unknown', message: String(err) } };
  }
}

export function stopWebcam(stream: MediaStream): void {
  stream.getTracks().forEach((t) => t.stop());
}

export function isWebcamReady(videoEl: HTMLVideoElement): boolean {
  return videoEl.readyState >= 2;
}
