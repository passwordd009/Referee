import type { GameState, FaceState } from '../types';

interface GameOverlayProps {
  gameState: GameState;
  faceState: FaceState | null;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`;
}

export function GameOverlay({ gameState, faceState }: GameOverlayProps) {
  const { status, countdownSeconds, timer, mode } = gameState;
  const smileScore = faceState?.smileScore ?? 0;
  const faceDetected = faceState?.faceDetected ?? false;

  return (
    <div className="game-overlay">
      {status === 'countdown' && (
        <div className="countdown-display">
          <span className="countdown-digit" key={Math.ceil(countdownSeconds)}>
            {countdownSeconds > 0.1 ? Math.ceil(countdownSeconds) : 'Go!'}
          </span>
        </div>
      )}

      {status === 'playing' && (
        <>
          <div className="timer-display">
            {mode === 'WaterHold' ? formatTime(timer) : formatTime(timer)}
          </div>

          {!faceDetected && (
            <div className="face-warning">FACE NOT IN FRAME</div>
          )}

          <div className="smile-bar-container">
            <div className="smile-bar-label">Smile</div>
            <div className="smile-bar-track">
              <div
                className="smile-bar-fill"
                style={{
                  width: `${smileScore * 100}%`,
                  backgroundColor: smileScore >= 0.5 ? '#ef4444' : smileScore >= 0.3 ? '#eab308' : '#22c55e',
                }}
              />
              <div className="smile-bar-threshold" style={{ left: '50%' }} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
