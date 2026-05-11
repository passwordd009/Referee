import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { AddBitModal } from './AddBitModal';

interface Bit {
  id: string;
  title: string | null;
  media_type: 'text' | 'youtube' | 'image';
  media_url: string | null;
  text_content: string | null;
  created_at: string;
}

const TYPE_ICON: Record<string, string> = {
  text:    '💬',
  youtube: '▶',
  image:   '🖼',
};

interface Props { userId: string }

export function BitsInventory({ userId }: Props) {
  const [bits,       setBits]       = useState<Bit[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [showModal,  setShowModal]  = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchBits = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('bits')
      .select('*')
      .eq('creator_id', userId)
      .order('created_at', { ascending: false });
    setBits(data ?? []);
    setLoading(false);
  }, [userId]);

  useEffect(() => { fetchBits(); }, [fetchBits]);

  async function deleteBit(id: string) {
    setDeletingId(id);
    await supabase.from('bits').delete().eq('id', id);
    setBits(prev => prev.filter(b => b.id !== id));
    setDeletingId(null);
  }

  return (
    <div className="bits-inventory">
      <div className="bits-inventory__header">
        <h2 className="bits-inventory__title">Your Bits</h2>
        <button className="btn btn-primary bits-inventory__add" onClick={() => setShowModal(true)}>
          + Add bit
        </button>
      </div>

      {loading ? (
        <div className="bits-inventory__empty">Loading…</div>
      ) : bits.length === 0 ? (
        <div className="bits-inventory__empty">
          <p>No bits yet.</p>
          <p style={{ opacity: 0.5, fontSize: 13 }}>Add a joke, YouTube video, or image to play during matches.</p>
        </div>
      ) : (
        <ul className="bit-list">
          {bits.map(bit => (
            <li key={bit.id} className="bit-card">
              <span className="bit-card__icon">{TYPE_ICON[bit.media_type]}</span>
              <div className="bit-card__body">
                <span className="bit-card__title">
                  {bit.title ?? (bit.text_content ? bit.text_content.slice(0, 60) + (bit.text_content.length > 60 ? '…' : '') : bit.media_url)}
                </span>
                <span className="bit-card__type">{bit.media_type}</span>
              </div>
              <button
                className="bit-card__delete"
                onClick={() => deleteBit(bit.id)}
                disabled={deletingId === bit.id}
                aria-label="Delete bit"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {showModal && (
        <AddBitModal
          userId={userId}
          onClose={() => setShowModal(false)}
          onAdded={fetchBits}
        />
      )}
    </div>
  );
}
