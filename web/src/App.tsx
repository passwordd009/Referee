import { useEffect } from 'react';
import { useGameEngine } from './engine/useGameEngine';
import { CameraFeed } from './components/CameraFeed';
import { ModeSelect } from './components/ModeSelect';
import { GameView } from './components/GameView';
import { GameOver } from './components/GameOver';
import { createRoundStartEvent } from './referee/refereeEngine';

export function App() {
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

  // emit round-start referee event when playing begins
  useEffect(() => {
    if (status === 'playing' && mode) {
      const event = createRoundStartEvent(gameState);
      // inject as a synthetic entry — we store it via a separate local state merge
      // In this architecture we just dispatch a no-op to trigger re-render;
      // the round-start message is handled inside RefereeDisplay watching for status change
      void event; // used by RefereeDisplay directly via status prop
    }
  }, [status]);

  function handleModeSelect(selectedMode: Parameters<typeof dispatch>[0] & { type: 'MODE_SELECTED' }) {
    dispatch(selectedMode);
    dispatch({ type: 'START_GAME' });
  }

  function handlePlayAgain() {
    dispatch({ type: 'START_GAME' });
  }

  function handleChangeMode() {
    dispatch({ type: 'RESET' });
  }

  return (
    <div className="app">
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
          {/* Camera feed always mounted — keeps stream alive across state transitions */}
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
              onPlayAgain={handlePlayAgain}
              onChangeMode={handleChangeMode}
            />
          )}
        </>
      )}
    </div>
  );
}
