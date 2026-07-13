/**
 * Soundboard — every sound is synthesized with the Web Audio API, no
 * audio files. Used by Match-the-Sound rounds, the Saboteur, and the
 * Sudden Death free-for-all.
 */

export const SOUND_IDS = [
  'honk', 'boing', 'slide_whistle', 'sad_trombone',
  'airhorn', 'kazoo', 'quack', 'drumroll',
] as const;
export type SoundId = typeof SOUND_IDS[number];

export const SOUND_LABELS: Record<SoundId, string> = {
  honk:          '📯 Clown Honk',
  boing:         '🪀 Boing',
  slide_whistle: '🎚️ Slide Whistle',
  sad_trombone:  '🎺 Sad Trombone',
  airhorn:       '📢 Airhorn',
  kazoo:         '🎷 Kazoo Fanfare',
  quack:         '🦆 Angry Duck',
  drumroll:      '🥁 Drumroll',
};

let ctx: AudioContext | null = null;
function audio(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

interface ToneOpts {
  type?: OscillatorType;
  from: number;
  to?: number;
  at?: number;      // start offset (s)
  dur: number;      // duration (s)
  gain?: number;
  vibrato?: number; // Hz depth of a 6Hz wobble
}

function tone(ac: AudioContext, o: ToneOpts): void {
  const t0 = ac.currentTime + (o.at ?? 0);
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.from, t0);
  if (o.to && o.to !== o.from) osc.frequency.exponentialRampToValueAtTime(o.to, t0 + o.dur);

  if (o.vibrato) {
    const lfo = ac.createOscillator();
    const lfoGain = ac.createGain();
    lfo.frequency.value = 6;
    lfoGain.gain.value = o.vibrato;
    lfo.connect(lfoGain).connect(osc.frequency);
    lfo.start(t0); lfo.stop(t0 + o.dur);
  }

  const vol = o.gain ?? 0.25;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.02);
  g.gain.setValueAtTime(vol, t0 + o.dur * 0.7);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + o.dur);

  osc.connect(g).connect(ac.destination);
  osc.start(t0); osc.stop(t0 + o.dur + 0.05);
}

function noise(ac: AudioContext, at: number, dur: number, gain: number, filterHz?: number): void {
  const t0 = ac.currentTime + at;
  const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buf;
  const g = ac.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  let node: AudioNode = src;
  if (filterHz) {
    const f = ac.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = filterHz;
    node.connect(f); node = f;
  }
  node.connect(g).connect(ac.destination);
  src.start(t0);
}

const RECIPES: Record<SoundId, (ac: AudioContext) => void> = {
  honk(ac) {
    tone(ac, { type: 'square', from: 220, to: 185, dur: 0.22, gain: 0.2 });
    tone(ac, { type: 'square', from: 220, to: 185, at: 0.3, dur: 0.3, gain: 0.2 });
  },
  boing(ac) {
    tone(ac, { type: 'triangle', from: 500, to: 70, dur: 0.7, gain: 0.3, vibrato: 30 });
  },
  slide_whistle(ac) {
    tone(ac, { from: 350, to: 1300, dur: 0.45, gain: 0.22 });
    tone(ac, { from: 1300, to: 250, at: 0.5, dur: 0.55, gain: 0.22 });
  },
  sad_trombone(ac) {
    const notes = [233, 220, 208, 196];
    notes.forEach((f, i) => tone(ac, {
      type: 'sawtooth', from: f, dur: i === 3 ? 0.9 : 0.32,
      at: i * 0.36, gain: 0.16, vibrato: i === 3 ? 8 : 0,
    }));
  },
  airhorn(ac) {
    [440, 554, 659].forEach(f =>
      tone(ac, { type: 'sawtooth', from: f, to: f * 1.02, dur: 0.9, gain: 0.1 }));
  },
  kazoo(ac) {
    const melody = [392, 523, 659, 784];
    melody.forEach((f, i) => {
      tone(ac, { type: 'square',   from: f,        dur: 0.18, at: i * 0.16, gain: 0.1 });
      tone(ac, { type: 'sawtooth', from: f * 1.01, dur: 0.18, at: i * 0.16, gain: 0.08 });
    });
  },
  quack(ac) {
    [0, 0.22, 0.44].forEach(at =>
      tone(ac, { type: 'sawtooth', from: 320, to: 190, at, dur: 0.16, gain: 0.25 }));
  },
  drumroll(ac) {
    let at = 0, gap = 0.09;
    for (let i = 0; i < 16; i++) {
      noise(ac, at, 0.05, 0.15);
      at += gap;
      gap = Math.max(0.03, gap * 0.92); // accelerate
    }
    noise(ac, at + 0.05, 1.1, 0.3, 3000); // crash
  },
};

export function playSound(soundId: string): void {
  const recipe = RECIPES[soundId as SoundId];
  if (!recipe) return;
  try { recipe(audio()); } catch { /* audio unavailable */ }
}
