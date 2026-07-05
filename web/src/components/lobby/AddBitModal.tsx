import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';

type MediaType = 'text' | 'image' | 'video';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;  // 8 MB
const MAX_VIDEO_BYTES = 25 * 1024 * 1024; // 25 MB
const MAX_VIDEO_SECS  = 10;

interface Props {
  userId: string;
  onClose: () => void;
  onAdded: () => void;
}

/** Read a video file's duration (seconds) from its metadata. */
function videoDuration(f: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const el = document.createElement('video');
    el.preload = 'metadata';
    const url = URL.createObjectURL(f);
    el.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(el.duration); };
    el.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read the video file')); };
    el.src = url;
  });
}

export function AddBitModal({ userId, onClose, onAdded }: Props) {
  const [title,     setTitle]     = useState('');
  const [mediaType, setMediaType] = useState<MediaType>('text');
  const [content,   setContent]   = useState('');
  const [file,      setFile]      = useState<File | null>(null);
  const [preview,   setPreview]   = useState<string | null>(null);
  const [error,     setError]     = useState('');
  const [saving,    setSaving]    = useState(false);

  // Local preview of the picked file; revoke the URL when it changes.
  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function pickFile(f: File | null) {
    setError('');
    setFile(null);
    if (!f) return;

    if (mediaType === 'image') {
      if (!f.type.startsWith('image/')) { setError('Pick an image or GIF file'); return; }
      if (f.size > MAX_IMAGE_BYTES) { setError('Image is too large (max 8 MB)'); return; }
      setFile(f);
      return;
    }

    // Video: enforce the 10-second cap before uploading anything.
    if (!f.type.startsWith('video/')) { setError('Pick a video file'); return; }
    if (f.size > MAX_VIDEO_BYTES) { setError('Video is too large (max 25 MB)'); return; }
    try {
      const secs = await videoDuration(f);
      if (!Number.isFinite(secs)) throw new Error('Could not read the video length');
      if (secs > MAX_VIDEO_SECS + 0.5) {
        setError(`Video is ${secs.toFixed(1)}s — bits are capped at ${MAX_VIDEO_SECS} seconds`);
        return;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the video file');
      return;
    }
    setFile(f);
  }

  /** Upload the picked file to Supabase Storage, return its public URL. */
  async function uploadMedia(f: File): Promise<string> {
    // The storage policy requires the first folder to be the user's id.
    const safeName = f.name.replace(/[^A-Za-z0-9._-]/g, '_').slice(-80);
    const path = `${userId}/${Date.now()}-${safeName}`;

    const { error: upErr } = await supabase.storage
      .from('bits')
      .upload(path, f, { contentType: f.type, cacheControl: '3600' });
    if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

    const { data } = supabase.storage.from('bits').getPublicUrl(path);
    return data.publicUrl;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (mediaType !== 'text' && !file) {
      setError(`Choose ${mediaType === 'image' ? 'an image' : 'a video'} from your computer`);
      return;
    }
    if (mediaType === 'text' && !content.trim()) { setError('Content is required'); return; }

    setSaving(true);
    try {
      const mediaUrl = mediaType === 'text' ? null : await uploadMedia(file!);

      const { error: err } = await supabase.from('bits').insert({
        creator_id:   userId,
        title:        title.trim() || null,
        media_type:   mediaType,
        media_url:    mediaUrl,
        text_content: mediaType === 'text' ? content.trim() : null,
      });
      if (err) throw new Error(err.message);

      onAdded();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the bit');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2 className="modal-title">Add a Bit</h2>

        <form onSubmit={handleSubmit} className="auth-form">
          <label className="auth-label">
            Title (optional)
            <input className="auth-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="My killer joke" />
          </label>

          <div className="bit-type-tabs">
            {(['text', 'image', 'video'] as MediaType[]).map(t => (
              <button
                key={t}
                type="button"
                className={`bit-type-tab ${mediaType === t ? 'bit-type-tab--active' : ''}`}
                onClick={() => { setMediaType(t); setContent(''); setFile(null); setError(''); }}
              >
                {t === 'text' ? 'Joke / Text' : t === 'image' ? 'Image / GIF' : 'Video'}
              </button>
            ))}
          </div>

          {mediaType === 'text' ? (
            <label className="auth-label">
              Your joke or bit
              <textarea
                className="auth-input bit-textarea"
                value={content}
                onChange={e => setContent(e.target.value)}
                placeholder="Why don't scientists trust atoms? Because they make up everything."
                rows={4}
                required
              />
            </label>
          ) : (
            <div className="auth-label">
              Upload from your computer
              <label className={`bit-drop ${preview ? 'bit-drop--filled' : ''}`}>
                <input
                  type="file"
                  accept={mediaType === 'image' ? 'image/*' : 'video/*'}
                  className="bit-drop__input"
                  onChange={e => void pickFile(e.target.files?.[0] ?? null)}
                />
                {preview ? (
                  <>
                    {mediaType === 'image'
                      ? <img className="bit-drop__preview" src={preview} alt="preview" />
                      : <video className="bit-drop__preview" src={preview} muted autoPlay loop playsInline />}
                    <span className="bit-drop__hint">{file?.name} — click to change</span>
                  </>
                ) : (
                  <>
                    <span className="bit-drop__icon">{mediaType === 'image' ? '🖼' : '🎬'}</span>
                    <span className="bit-drop__hint">
                      {mediaType === 'image'
                        ? 'Click to choose an image or GIF (max 8 MB)'
                        : `Click to choose a video (max ${MAX_VIDEO_SECS}s, 25 MB)`}
                    </span>
                  </>
                )}
              </label>
            </div>
          )}

          {error && <p className="auth-error">{error}</p>}

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? (mediaType === 'text' ? 'Saving…' : 'Uploading…') : 'Add bit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
