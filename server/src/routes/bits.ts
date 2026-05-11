import { Router } from 'express';
import { supabase } from '../lib/supabase.js';

const router = Router();
const BUCKET = 'bits';
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB

// POST /api/bits/upload-url — get a signed upload URL from Supabase Storage
router.post('/upload-url', async (req, res) => {
  const { userId, filename, contentType } = req.body as {
    userId?: string;
    filename?: string;
    contentType?: string;
  };
  if (!userId || !filename || !contentType) {
    return res.status(400).json({ error: 'userId, filename, contentType required' });
  }

  const path = `${userId}/${Date.now()}-${filename}`;
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(path);

  if (error) {
    console.error('[bits] upload-url error:', error);
    return res.status(500).json({ error: error.message });
  }

  res.json({ uploadUrl: data.signedUrl, path });
});

// POST /api/bits — record a bit in the database after upload
router.post('/', async (req, res) => {
  const { creatorId, mediaType, path } = req.body as {
    creatorId?: string;
    mediaType?: string;
    path?: string;
  };
  if (!creatorId || !mediaType || !path) {
    return res.status(400).json({ error: 'creatorId, mediaType, path required' });
  }

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);

  const { data, error } = await supabase
    .from('bits')
    .insert({
      creator_id: creatorId,
      media_type: mediaType,
      media_url:  urlData.publicUrl,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ bit: data });
});

// GET /api/bits?userId=... — list a player's bits
router.get('/', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  const { data, error } = await supabase
    .from('bits')
    .select('*')
    .eq('creator_id', userId)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ bits: data });
});

export default router;
