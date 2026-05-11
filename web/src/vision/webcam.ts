export type WebcamError =
  | { kind: 'permission-denied' }
  | { kind: 'not-found' }
  | { kind: 'unknown'; message: string };

export async function startWebcam(
  videoEl: HTMLVideoElement
): Promise<{ stream: MediaStream } | { error: WebcamError }> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    videoEl.srcObject = stream;
    await new Promise<void>((resolve, reject) => {
      videoEl.onloadedmetadata = () => {
        videoEl.play().then(resolve).catch(reject);
      };
      videoEl.onerror = () => reject(new Error('Video element error'));
    });
    return { stream };
  } catch (err) {
    if (err instanceof DOMException) {
      if (err.name === 'NotAllowedError') return { error: { kind: 'permission-denied' } };
      if (err.name === 'NotFoundError') return { error: { kind: 'not-found' } };
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
