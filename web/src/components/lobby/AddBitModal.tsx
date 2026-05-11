import { useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';

type MediaType = 'text' | 'youtube' | 'image';

interface Props {
  userId: string;
  onClose: () => void;
  onAdded: () => void;
}

export function AddBitModal({ userId, onClose, onAdded }: Props) {
  const [title,     setTitle]     = useState('');
  const [mediaType, setMediaType] = useState<MediaType>('text');
  const [content,   setContent]   = useState('');
  const [error,     setError]     = useState('');
  const [saving,    setSaving]    = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!content.trim()) { setError('Content is required'); return; }
    setError('');
    setSaving(true);

    const mediaUrl = mediaType === 'text' ? null : content.trim();
    const textContent = mediaType === 'text' ? content.trim() : null;

    const { error: err } = await supabase.from('bits').insert({
      creator_id:   userId,
      title:        title.trim() || null,
      media_type:   mediaType,
      media_url:    mediaUrl,
      text_content: textContent,
    });

    setSaving(false);
    if (err) { setError(err.message); return; }
    onAdded();
    onClose();
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
            {(['text', 'youtube', 'image'] as MediaType[]).map(t => (
              <button
                key={t}
                type="button"
                className={`bit-type-tab ${mediaType === t ? 'bit-type-tab--active' : ''}`}
                onClick={() => { setMediaType(t); setContent(''); }}
              >
                {t === 'text' ? 'Joke / Text' : t === 'youtube' ? 'YouTube' : 'Image / GIF'}
              </button>
            ))}
          </div>

          <label className="auth-label">
            {mediaType === 'text'    ? 'Your joke or bit'    :
             mediaType === 'youtube' ? 'YouTube URL'         : 'Image or GIF URL'}
            {mediaType === 'text' ? (
              <textarea
                className="auth-input bit-textarea"
                value={content}
                onChange={e => setContent(e.target.value)}
                placeholder="Why don't scientists trust atoms? Because they make up everything."
                rows={4}
                required
              />
            ) : (
              <input
                className="auth-input"
                type="url"
                value={content}
                onChange={e => setContent(e.target.value)}
                placeholder={mediaType === 'youtube' ? 'https://youtube.com/watch?v=...' : 'https://...gif'}
                required
              />
            )}
          </label>

          {error && <p className="auth-error">{error}</p>}

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Add bit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
