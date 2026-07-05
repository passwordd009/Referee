/** Helpers for rendering bit media (images, YouTube) across the app. */

/** Extract the video id from any common YouTube URL form. */
export function youtubeId(url: string): string | null {
  const m = url.match(
    /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
  );
  return m ? m[1] : null;
}

/** Privacy-friendly embed URL for playing a YouTube bit. */
export function youtubeEmbedUrl(url: string): string | null {
  const id = youtubeId(url);
  return id ? `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0` : null;
}

/** Small preview image for a bit, or null when there is none (text bits). */
export function bitThumbnail(mediaType: string, mediaUrl: string | null): string | null {
  if (!mediaUrl) return null;
  if (mediaType === 'image') return mediaUrl;
  if (mediaType === 'youtube') {
    const id = youtubeId(mediaUrl);
    return id ? `https://img.youtube.com/vi/${id}/mqdefault.jpg` : null;
  }
  return null;
}
