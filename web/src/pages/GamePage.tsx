import { useEffect } from 'react';
import { useGameEngine } from '../engine/useGameEngine';
import { CameraFeed } from '../components/CameraFeed';
import { ModeSelect } from '../components/ModeSelect';
import { GameView } from '../components/GameView';
import { GameOver } from '../components/GameOver';
import { createRoundStartEvent } from '../referee/refereeEngine';
import { useAuth } from '../auth/AuthContext';

export function GamePage() {
  const { signOut, user } = useAuth();
  const {
    gameState,
    faceState,
    refereeEvents,
    videoRef,
    isVisionReady,
    webcamError,
    dispatch,
  } = useGameEngine();

  const { status, mode } = gameState;

  useEffect(() => {
    if (status === 'playing' && mode) {
      const event = createRoundStartEvent(gameState);
      void event;
    }
  }, [status]);

  function handleModeSelect(selectedMode: Parameters<typeof dispatch>[0] & { type: 'MODE_SELECTED' }) {
    dispatch(selectedMode);
    dispatch({ type: 'START_GAME' });
  }

  return (
    <div className="app">
      {/* Header bar */}
      <header className="game-header">
        <span className="game-header__user">{user?.user_metadata?.username ?? user?.email}</span>
        <button className="btn btn-ghost game-header__signout" onClick={signOut}>
          Sign out
        </button>
      </header>

      {webcamError ? (
        <div className="error-screen">
          <div className="error-container">
            <div className="error-icon">⚠️</div>
            <h2 className="error-title">Camera Error</h2>
            <p className="error-message">{webcamError}</p>
            <button className="btn btn-primary" onClick={() => window.location.reload()}>
              Retry
            </button>
          </div>
        </div>
      ) : (
        <>
          <CameraFeed videoRef={videoRef} faceState={faceState} />

          {(status === 'idle' || status === 'modeSelect') && (
            <ModeSelect
              onSelect={(m) => handleModeSelect({ type: 'MODE_SELECTED', mode: m })}
              isVisionReady={isVisionReady}
            />
          )}

          {(status === 'countdown' || status === 'playing') && (
            <GameView
              gameState={gameState}
              faceState={faceState}
              refereeEvents={refereeEvents}
            />
          )}

          {status === 'ended' && (
            <GameOver
              gameState={gameState}
              refereeEvents={refereeEvents}
              onPlayAgain={() => dispatch({ type: 'START_GAME' })}
              onChangeMode={() => dispatch({ type: 'RESET' })}
            />
          )}
        </>
      )}
    </div>
  );
}
