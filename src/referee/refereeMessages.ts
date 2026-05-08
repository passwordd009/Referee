export const REFEREE_MESSAGES = {
  VIOLATION_DETECTED: {
    Duel: [
      'Smile detected. Violation.',
      "That's a smile. Round over.",
      'I saw that. You smiled. Loss.',
      'No smiling. You lost.',
      'Caught you. Smile detected.',
    ],
    WaterHold: [
      'You spilled it. Round over.',
      'Smile detected. Water is gone.',
      'Mouth opened. You lost.',
      "Can't hold it. Round over.",
    ],
  },
  FACE_NOT_DETECTED: [
    'Where did you go? Stay in frame.',
    "I can't see your face.",
    'Return to the camera.',
    'Face lost. Get back in frame.',
  ],
  ROUND_START: {
    Duel: [
      'Keep a straight face. Begin.',
      'No smiling. Round starts now.',
      'Straight face only. Go.',
    ],
    WaterHold: [
      "Hold the water. Don't spill it.",
      "Mouth closed. Don't smile.",
      'Hold it in. 60 seconds.',
    ],
  },
  COUNTDOWN: ['3', '2', '1', 'Go.'],
  ROUND_WON: [
    'You held it. Well done.',
    'Straight face maintained. You win.',
    '60 seconds. Impressive.',
  ],
  WATCHING: 'Watching...',
} as const;

const lastPickedIndex: Map<string, number> = new Map();

export function pickRandom(messages: readonly string[], key: string): string {
  if (messages.length === 1) return messages[0];
  const last = lastPickedIndex.get(key) ?? -1;
  let idx: number;
  do {
    idx = Math.floor(Math.random() * messages.length);
  } while (idx === last);
  lastPickedIndex.set(key, idx);
  return messages[idx];
}
