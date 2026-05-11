export type GameMode = 'Duel' | 'WaterHold';
export type GameStatus = 'idle' | 'modeSelect' | 'countdown' | 'playing' | 'ended';

export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FaceState {
  faceDetected: boolean;
  smileScore: number;
  mouthOpen: boolean;
  timestamp: number;
  box?: FaceBox;
  landmarks?: { x: number; y: number }[];
}

export interface GameState {
  mode: GameMode | null;
  status: GameStatus;
  timer: number;
  violations: number;
  roundWon: boolean | null;
  countdownSeconds: number;
  faceLostMs: number;
}

export interface RefereeEvent {
  type:
    | 'FACE_NOT_DETECTED'
    | 'SMILE_SCORE_UPDATE'
    | 'VIOLATION_DETECTED'
    | 'ROUND_START'
    | 'ROUND_END'
    | 'COUNTDOWN_TICK';
  reason?: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  timestamp: number;
}

export interface VisionEvent {
  type: 'FACE_NOT_DETECTED' | 'SMILE_SCORE_UPDATE' | 'VIOLATION_DETECTED';
  faceState: FaceState;
}

export type GameAction =
  | { type: 'MODE_SELECTED'; mode: GameMode }
  | { type: 'START_GAME' }
  | { type: 'TIMER_TICK'; deltaMs: number }
  | { type: 'VISION_EVENT'; event: VisionEvent }
  | { type: 'RESET' };
