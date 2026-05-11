import type { GameState, FaceState, RefereeEvent } from '../types';
import { GameOverlay } from './GameOverlay';
import { RefereeDisplay } from './RefereeDisplay';

interface GameViewProps {
  gameState: GameState;
  faceState: FaceState | null;
  refereeEvents: RefereeEvent[];
}

export function GameView({ gameState, faceState, refereeEvents }: GameViewProps) {
  return (
    <>
      <GameOverlay gameState={gameState} faceState={faceState} />
      <RefereeDisplay events={refereeEvents} gameStatus={gameState.status} />
    </>
  );
}
