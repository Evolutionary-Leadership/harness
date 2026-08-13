import express from 'express';

const app = express();
const port = process.env.PORT || 3000;

const branch = process.env.RAILWAY_GIT_BRANCH || 'local';
const sha = (process.env.RAILWAY_GIT_COMMIT_SHA || 'unknown').slice(0, 7);
const envName = process.env.RAILWAY_ENVIRONMENT_NAME || 'local';
const serviceName = process.env.RAILWAY_SERVICE_NAME || 'harness-railway-starter';

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.get('/', (_req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>It works on ${escapeHtml(branch)}</title>
<style>
  :root {
    --c1: #ff006e;
    --c2: #fb5607;
    --c3: #ffbe0b;
    --c4: #8338ec;
    --c5: #3a86ff;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; }
  body {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    background: linear-gradient(135deg, var(--c1), var(--c2), var(--c3), var(--c4), var(--c5));
    background-size: 400% 400%;
    animation: shift 14s ease infinite;
    color: white;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    position: relative;
    padding: 1rem;
  }
  @keyframes shift {
    0%   { background-position: 0% 50%; }
    50%  { background-position: 100% 50%; }
    100% { background-position: 0% 50%; }
  }
  .stage {
    text-align: center;
    z-index: 2;
    max-width: 720px;
  }
  h1 {
    font-size: clamp(3rem, 13vw, 9rem);
    font-weight: 900;
    letter-spacing: -0.04em;
    text-transform: uppercase;
    line-height: 0.9;
    text-shadow:
      0 0 30px rgba(255, 255, 255, 0.55),
      4px 4px 0 rgba(0, 0, 0, 0.35);
    animation: pulse 1.6s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { transform: scale(1) rotate(-1deg); }
    50%      { transform: scale(1.05) rotate(1.5deg); }
  }
  .subtitle {
    margin-top: 1rem;
    font-size: clamp(0.9rem, 2vw, 1.2rem);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.25em;
    opacity: 0.95;
  }
  .badges {
    margin-top: 1.6rem;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.5rem;
  }
  .badge {
    padding: 0.55em 1em;
    background: rgba(0, 0, 0, 0.4);
    border-radius: 999px;
    font-size: 0.85rem;
    font-weight: 700;
    backdrop-filter: blur(6px);
    border: 1px solid rgba(255, 255, 255, 0.22);
    text-transform: lowercase;
  }
  .badge b { color: #ffe066; margin-left: 0.4em; }
  .replace-me {
    margin-top: 2.4rem;
    font-size: 0.95rem;
    opacity: 0.92;
    font-weight: 500;
    line-height: 1.6;
  }
  .replace-me code {
    background: rgba(0, 0, 0, 0.55);
    padding: 0.15em 0.45em;
    border-radius: 4px;
    font-size: 0.9em;
  }
  .blob {
    position: absolute;
    border-radius: 50%;
    filter: blur(70px);
    opacity: 0.55;
    pointer-events: none;
  }
  .blob.b1 { width: 420px; height: 420px; background: var(--c1); top: -12%; left: -12%; animation: drift1 18s ease-in-out infinite; }
  .blob.b2 { width: 380px; height: 380px; background: var(--c5); bottom: -12%; right: -12%; animation: drift2 22s ease-in-out infinite; }
  .blob.b3 { width: 300px; height: 300px; background: var(--c3); top: 40%; left: 60%; animation: drift1 26s ease-in-out infinite reverse; }
  @keyframes drift1 {
    0%, 100% { transform: translate(0, 0); }
    50%      { transform: translate(50vw, 30vh); }
  }
  @keyframes drift2 {
    0%, 100% { transform: translate(0, 0); }
    50%      { transform: translate(-45vw, -25vh); }
  }
</style>
</head>
<body>
  <div class="blob b1"></div>
  <div class="blob b2"></div>
  <div class="blob b3"></div>
  <div class="stage">
    <h1>It works!</h1>
    <p class="subtitle">Harness pipeline is live</p>
    <div class="badges">
      <span class="badge">branch <b>${escapeHtml(branch)}</b></span>
      <span class="badge">env <b>${escapeHtml(envName)}</b></span>
      <span class="badge">sha <b>${escapeHtml(sha)}</b></span>
      <span class="badge">service <b>${escapeHtml(serviceName)}</b></span>
    </div>
    <p class="replace-me">
      You are looking at the harness starter app.<br>
      Edit <code>server.js</code> to build your real app, or<br>
      delete <code>server.js</code>, <code>package.json</code>, and <code>.gitignore</code> if you are not using Node, then update <code>railway.json</code>.
    </p>
  </div>
</body>
</html>`);
});

app.listen(port, () => {
  console.log(`Harness starter listening on :${port} (branch=${branch}, env=${envName})`);
});
