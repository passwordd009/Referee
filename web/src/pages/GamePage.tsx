import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useGameSocket } from '../hooks/useGameSocket';

const PLAYER_BITS = [
  "I asked my dog what two minus two is. He said nothing.",
  "Why do cows wear bells? Because their horns don't work.",
  "I told my doctor I broke my arm in two places. He told me to stop going to those places.",
  "I used to hate facial hair, but then it grew on me.",
  "I'm on a seafood diet. I see food and I eat it.",
];

function Lives({ count, max }: { count: number; max: number }) {
  return (
    <div className="gp-lives">
      {Array.from({ length: max }).map((_, i) => (
        <span key={i} className={`gp-life ${i < count ? 'gp-life--on' : 'gp-life--off'}`}>♥</span>
      ))}
    </div>
  );
}

export function GamePage() {
  const { code = '' } = useParams<{ code: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const userId   = user!.id;
  const username = (user?.user_metadata?.username as string | undefined) ?? user?.email ?? 'Player';

  const {
    phase, players, myTurn, activeBit,
    revealedPlayer, timeLeft, turnDurationMs,
    result, laughFlash,
    playBit, skipTurn,
  } = useGameSocket(code.toUpperCase(), userId);

  const maxLives = Math.max(...players.map(p => p.livesRemaining), 3);
  const timerPct = turnDurationMs > 0 ? timeLeft / (turnDurationMs / 1000) : 0;

  if (phase === 'loading') {
    return <div className="auth-loading"><span className="auth-loading__spinner" /></div>;
  }

  if (phase === 'finished' && result) {
    const winner = players.find(p => p.userId === result.winnerId);
    const iWon   = result.winnerId === userId;
    return (
      <div className="gp-page gp-page--over">
        <div className="gp-over-card">
          <div className={`gp-over-result ${iWon ? 'result-win' : 'result-loss'}`}>
            {iWon ? 'YOU WIN' : 'GAME OVER'}
          </div>
          <p className="gp-over-sub">
            {winner ? `${winner.username} survived` : 'No survivors'}
          </p>
          <div className="gp-over-stats">
            {(result.stats.funniest as string | null) && (
              <div className="stat">
                <span className="stat-label">Funniest</span>
                <span className="stat-value">
                  {players.find(p => p.userId === result.stats.funniest)?.username ?? '—'}
                </span>
              </div>
            )}
            <div className="stat">
              <span className="stat-label">Laughs total</span>
              <span className="stat-value">{result.stats.totalLaughs as number}</span>
            </div>
          </div>
          <button className="btn btn-primary" style={{ marginTop: 24 }} onClick={() => navigate('/')}>
            Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="gp-page">
      {/* Player tiles */}
      <div className="gp-tiles">
        {players.map(p => (
          <div
            key={p.userId}
            className={[
              'gp-tile',
              p.isEliminated ? 'gp-tile--eliminated' : '',
              laughFlash?.playerId === p.userId ? 'gp-tile--laugh' : '',
              p.userId === userId ? 'gp-tile--self' : '',
            ].join(' ')}
          >
            <div className="gp-tile__screen" />
            <div className="gp-tile__label">
              <span className="gp-tile__name">{p.username}</span>
              <Lives count={p.livesRemaining} max={maxLives} />
            </div>
            {p.isEliminated && <div className="gp-tile__out">OUT</div>}
          </div>
        ))}
      </div>

      {/* Main content */}
      <div className="gp-main">
        {phase === 'turn_active' && (
          <>
            <p className="gp-status">
              {myTurn ? '— YOUR TURN —' : '— Someone is performing… —'}
            </p>

            {activeBit?.textContent && (
              <div className="gp-bit-card">
                <p className="gp-bit-text">"{activeBit.textContent}"</p>
              </div>
            )}

            {myTurn && !activeBit && (
              <div className="gp-choices">
                <p className="gp-choices__label">Pick a bit to perform</p>
                <div className="gp-choices__list">
                  {PLAYER_BITS.map((bit, i) => (
                    <button key={i} className="gp-choice" onClick={() => playBit(bit)}>
                      {bit}
                    </button>
                  ))}
                </div>
                <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={skipTurn}>
                  Skip turn
                </button>
              </div>
            )}
          </>
        )}

        {phase === 'turn_reveal' && revealedPlayer && (
          <div className="gp-reveal">
            <p className="gp-reveal__label">It was…</p>
            <p className="gp-reveal__name">{revealedPlayer.username}</p>
          </div>
        )}
      </div>

      {/* Timer bar */}
      {phase === 'turn_active' && (
        <div className="gp-timer">
          <div className="gp-timer__bar">
            <div
              className="gp-timer__fill"
              style={{ width: `${Math.max(0, timerPct) * 100}%` }}
            />
          </div>
          <span className="gp-timer__label">{timeLeft}s</span>
        </div>
      )}
    </div>
  );
}
