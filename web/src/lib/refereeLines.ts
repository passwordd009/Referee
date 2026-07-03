/**
 * Referee one-liners shown in the whistle banner when a player
 * loses a life. `{name}` is replaced with the player's username.
 */

const LINES = {
  // The AI caught someone laughing.
  laughed: [
    '{name} cracked! That smile cost a life.',
    'Laugh detected! {name} loses a life.',
    "I saw that, {name}. That's a life.",
    '{name} broke! The referee sees everything.',
    "Composure lost — {name}, that's on you.",
  ],
  // A player was correctly identified as the bit's author.
  caught: [
    "{name} got caught! Too obvious.",
    'Busted! Everyone knew it was {name}.',
    '{name} was exposed. Lose a life.',
  ],
  // A player guessed wrong.
  wrong_guess: [
    'Wrong guess, {name}! That costs a life.',
    "{name} pointed the wrong finger. Penalty!",
    'Not even close, {name}. Lose a life.',
  ],
} as const;

export type PenaltyReason = keyof typeof LINES;

const lastIndex = new Map<PenaltyReason, number>();

/** Pick a referee line for the given penalty, avoiding immediate repeats. */
export function refereeLine(reason: PenaltyReason, name: string): string {
  const options = LINES[reason] ?? LINES.laughed;
  let idx = Math.floor(Math.random() * options.length);
  if (options.length > 1 && idx === lastIndex.get(reason)) {
    idx = (idx + 1) % options.length;
  }
  lastIndex.set(reason, idx);
  return options[idx].replace('{name}', name);
}
