/**
 * The landing page. Its one job: within seconds, the visitor understands
 * "the world is flooding — I must move my civilization" and wants in.
 */
import React, { useState } from 'react';
import { api } from '../api.js';
import { useStore } from '../store.js';

type Mode = 'register' | 'login';

export function Landing() {
  const signIn = useStore((s) => s.signIn);
  const [mode, setMode] = useState<Mode>('register');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res =
        mode === 'register' ? await api.register(username.trim(), password) : await api.login(username.trim(), password);
      await signIn(res.token, res.playerId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="landing">
      <div className="landing-waves" aria-hidden>
        <div className="wave wave-1" />
        <div className="wave wave-2" />
        <div className="wave wave-3" />
      </div>

      <main className="landing-content">
        <header className="landing-hero">
          <h1 className="landing-title">TIDEHOLD</h1>
          <p className="landing-tagline">
            The world is drowning. Move your civilization — or lose it.
          </p>
        </header>

        <div className="landing-grid">
          <section className="landing-features">
            <div className="card landing-feature">
              <h3>🌊 THE TIDE</h3>
              <p>
                The map itself is your enemy. Level by level, the sea takes the continent — and
                every tile shows you exactly when it dies. The richest land lies lowest.
              </p>
            </div>
            <div className="card landing-feature">
              <h3>⛵ THE ARK</h3>
              <p>
                Your capital is a ship. Enemies can plunder your cargo, capture your commanders,
                force you to flee — but you always sail on. Defeat hurts. It never deletes you.
              </p>
            </div>
            <div className="card landing-feature">
              <h3>📜 THE LEDGER</h3>
              <p>
                Alliances, trade pacts, tributes, ransoms — all inscribed in public record.
                Betrayal is always possible. It is also always remembered.
              </p>
            </div>
          </section>

          <section className="card landing-auth">
            <div className="landing-auth-tabs">
              <button
                className={mode === 'register' ? 'active' : ''}
                onClick={() => {
                  setMode('register');
                  setError(null);
                }}
              >
                Create account
              </button>
              <button
                className={mode === 'login' ? 'active' : ''}
                onClick={() => {
                  setMode('login');
                  setError(null);
                }}
              >
                Sign in
              </button>
            </div>
            <form onSubmit={submit} className="landing-auth-form">
              <label className="field-label" htmlFor="username">
                Name in The Ledger
              </label>
              <input
                id="username"
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="3–20 characters"
                autoComplete="username"
                required
                minLength={3}
                maxLength={20}
              />
              <label className="field-label" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="8+ characters"
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                required
                minLength={8}
              />
              {error && <div className="landing-error">{error}</div>}
              <button className="btn btn-block" disabled={busy} type="submit">
                {busy ? 'Casting off…' : mode === 'register' ? 'Launch your Ark' : 'Return to the sea'}
              </button>
              {mode === 'register' && (
                <p className="faint">
                  Your Ark spawns on the drowning continent immediately. No email. No pay-to-win.
                </p>
              )}
            </form>
          </section>
        </div>

        <footer className="landing-footer">
          A seasonal multiplayer strategy game. Free. In your browser.
        </footer>
      </main>
    </div>
  );
}
