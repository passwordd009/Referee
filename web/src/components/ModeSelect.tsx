import type { GameMode } from '../types';

interface ModeSelectProps {
  onSelect: (mode: GameMode) => void;
  isVisionReady: boolean;
}

export function ModeSelect({ onSelect, isVisionReady }: ModeSelectProps) {
  return (
    <div className="mode-select-overlay">
      <div className="mode-select-container">
        <h1 className="mode-select-title">REFEREE</h1>
        <p className="mode-select-subtitle">
          {isVisionReady ? 'Choose your challenge' : 'Loading vision model…'}
        </p>

        <div className="mode-cards">
          <button
            className="mode-card"
            onClick={() => onSelect('Duel')}
            disabled={!isVisionReady}
          >
            <div className="mode-card-icon">😐</div>
            <h2 className="mode-card-title">Duel Mode</h2>
            <p className="mode-card-desc">
              Keep a straight face. The first smile ends the round. No mercy.
            </p>
          </button>

          <button
            className="mode-card"
            onClick={() => onSelect('WaterHold')}
            disabled={!isVisionReady}
          >
            <div className="mode-card-icon">💧</div>
            <h2 className="mode-card-title">Water Hold</h2>
            <p className="mode-card-desc">
              Hold imaginary water in your mouth for 60 seconds. Don't smile. Don't open your mouth.
            </p>
          </button>
        </div>

        {!isVisionReady && (
          <div className="loading-indicator">
            <div className="loading-spinner" />
          </div>
        )}
      </div>
    </div>
  );
}
