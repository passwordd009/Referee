import type { GameState, RefereeEvent } from '../types';

interface GameOverProps {
  gameState: GameState;
  refereeEvents: RefereeEvent[];
  onPlayAgain: () => void;
  onChangeMode: () => void;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`;
}

export function GameOver({ gameState, refereeEvents, onPlayAgain, onChangeMode }: GameOverProps) {
  const { roundWon, mode, timer, violations } = gameState;
  const verdict = refereeEvents.find(
    (e) => e.type === 'VIOLATION_DETECTED' || e.type === 'ROUND_END'
  );

  const lastViolation = refereeEvents.find((e) => e.type === 'VIOLATION_DETECTED');

  return (
    <div className="gameover-overlay">
      <div className="gameover-container">
        <div className={`gameover-result ${roundWon ? 'result-win' : 'result-loss'}`}>
          {roundWon ? 'YOU WIN' : 'YOU LOSE'}
        </div>

        <div className="gameover-verdict">
          {roundWon
            ? 'Straight face maintained. Well done.'
            : lastViolation?.message ?? 'Round over.'}
        </div>

        <div className="gameover-stats">
          {mode === 'Duel' && (
            <div className="stat">
              <span className="stat-label">Time held</span>
              <span className="stat-value">{formatTime(timer)}</span>
            </div>
          )}
          {mode === 'WaterHold' && roundWon && (
            <div className="stat">
              <span className="stat-label">Time held</span>
              <span className="stat-value">60s</span>
            </div>
          )}
          {mode === 'WaterHold' && !roundWon && (
            <div className="stat">
              <span className="stat-label">Survived</span>
              <span className="stat-value">{formatTime(60 - timer)}</span>
            </div>
          )}
          {violations > 0 && (
            <div className="stat">
              <span className="stat-label">Violations</span>
              <span className="stat-value">{violations}</span>
            </div>
          )}
        </div>

        <div className="gameover-actions">
          <button className="btn btn-primary" onClick={onPlayAgain}>
            Play Again
          </button>
          <button className="btn btn-secondary" onClick={onChangeMode}>
            Change Mode
          </button>
        </div>
      </div>
    </div>
  );
}
