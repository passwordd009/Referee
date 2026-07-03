/**
 * Referee whistle sound effect, synthesized with the Web Audio API.
 *
 * A real pea whistle is a high-pitched tone (~2.6 kHz) with a fast warble
 * caused by the pea spinning inside. We recreate it with two slightly
 * detuned oscillators run through a tremolo (low-frequency gain wobble).
 * No audio file needed — it works offline and loads instantly.
 */

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

/** Blow the referee whistle. Safe to call repeatedly; failures are silent. */
export function playWhistle(): void {
  const audio = getContext();
  if (!audio) return;

  // Browsers suspend audio until the user interacts with the page.
  if (audio.state === 'suspended') void audio.resume();

  const now = audio.currentTime;
  const DURATION = 0.65;

  // Master volume envelope: sharp attack, brief sustain, quick fade.
  const master = audio.createGain();
  master.gain.setValueAtTime(0, now);
  master.gain.linearRampToValueAtTime(0.5, now + 0.015);
  master.gain.setValueAtTime(0.5, now + DURATION - 0.15);
  master.gain.exponentialRampToValueAtTime(0.001, now + DURATION);
  master.connect(audio.destination);

  // Tremolo: the "pea" warble, ~38 wobbles per second.
  const tremolo = audio.createGain();
  tremolo.gain.value = 0.6;
  tremolo.connect(master);

  const lfo = audio.createOscillator();
  lfo.frequency.value = 38;
  const lfoDepth = audio.createGain();
  lfoDepth.gain.value = 0.4;
  lfo.connect(lfoDepth);
  lfoDepth.connect(tremolo.gain);

  // Two detuned tones make the whistle sound full rather than pure.
  for (const freq of [2650, 2795]) {
    const osc = audio.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;

    // Individual tone volume (square waves are loud — keep them tame).
    const oscGain = audio.createGain();
    oscGain.gain.value = 0.18;

    osc.connect(oscGain);
    oscGain.connect(tremolo);
    osc.start(now);
    osc.stop(now + DURATION);
  }

  lfo.start(now);
  lfo.stop(now + DURATION);
}
