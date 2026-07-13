/**
 * Content pools for Classic Mode round types. Sounds are synthesized
 * client-side with the Web Audio API (see web/src/lib/soundboard.ts) —
 * the server only picks ids.
 */

export const ROUND_TYPES = ['match_the_sound', 'guess_the_item', 'fill_blank', 'accusation'] as const;
export type RoundType = typeof ROUND_TYPES[number];

export const SOUNDS = [
  { id: 'honk',          label: 'Clown Honk' },
  { id: 'boing',         label: 'Boing' },
  { id: 'slide_whistle', label: 'Slide Whistle' },
  { id: 'sad_trombone',  label: 'Sad Trombone' },
  { id: 'airhorn',       label: 'Airhorn' },
  { id: 'kazoo',         label: 'Kazoo Fanfare' },
  { id: 'quack',         label: 'Angry Duck' },
  { id: 'drumroll',      label: 'Drumroll + Crash' },
] as const;

export const ITEMS: { item: string; hint: string }[] = [
  { item: 'a rubber duck',        hint: 'It squeaks and supervises baths.' },
  { item: 'a traffic cone',       hint: 'Orange, pointy, ruins your commute.' },
  { item: 'a toaster',            hint: 'It launches breakfast.' },
  { item: 'a disco ball',         hint: 'It turns any ceiling into 1977.' },
  { item: 'a garden gnome',       hint: 'Short, bearded, guards vegetables.' },
  { item: 'a whoopee cushion',    hint: 'The classic chair-based betrayal.' },
  { item: 'a plunger',            hint: 'The hero nobody thanks.' },
  { item: 'a fortune cookie',     hint: 'Dessert that gives unsolicited advice.' },
  { item: 'a selfie stick',       hint: 'Extends your arm and your ego.' },
  { item: 'a lava lamp',          hint: 'Slow-motion goo, strangely hypnotic.' },
];

export const SENTENCES: string[] = [
  'I knew I was cooked when ______.',
  'The worst thing to hear from your barber is ______.',
  'My secret talent is ______.',
  "I got kicked out of the library for ______.",
  'The last text I sent my boss said ______.',
  'You should never microwave ______.',
  'My autobiography would be titled ______.',
  'The weirdest thing in my search history is ______.',
];

export const VOICES: string[] = [
  'angry coach',
  'overly calm pilot',
  'medieval knight',
  'conspiracy theorist',
  'golf commentator (whispering)',
  'disappointed grandma',
  'movie trailer announcer',
  'robot running out of battery',
];

export function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
