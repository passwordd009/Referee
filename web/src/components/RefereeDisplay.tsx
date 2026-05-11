import { useEffect, useState } from 'react';
import type { RefereeEvent, GameStatus } from '../types';
import { REFEREE_MESSAGES } from '../referee/refereeMessages';

interface RefereeDisplayProps {
  events: RefereeEvent[];
  gameStatus: GameStatus;
}

export function RefereeDisplay({ events, gameStatus }: RefereeDisplayProps) {
  const [displayed, setDisplayed] = useState<RefereeEvent | null>(null);
  const [key, setKey] = useState(0);

  const latest = events[0] ?? null;

  useEffect(() => {
    if (!latest) return;
    setDisplayed(latest);
    setKey((k) => k + 1);

    const timeout = setTimeout(() => {
      setDisplayed(null);
    }, 3000);

    return () => clearTimeout(timeout);
  }, [latest?.timestamp]);

  const message = displayed?.message ?? (gameStatus === 'playing' ? REFEREE_MESSAGES.WATCHING : '');
  const severity = displayed?.severity ?? 'info';

  if (!message) return null;

  return (
    <div className={`referee-display referee-${severity}`} key={key}>
      <span className="referee-label">REFEREE</span>
      <span className="referee-message">{message}</span>
    </div>
  );
}
