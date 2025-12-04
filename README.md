# BlockScope — Solana Blockspace Visualizer (MVP)

![BlockScope](./logo.svg)

Real-time analytics dashboard showing Solana blockspace usage: compute, fees, congestion, and top programs. The backend streams normalized block data via WebSockets and exposes REST endpoints; the frontend renders a Tailwind-powered live view. The same logo is used as the favicon (`frontend/logo.svg`).

## Project Layout

- `backend/` — Node.js + TypeScript ingestion + API + WebSocket stream.
- `frontend/` — Static HTML/Tailwind dashboard consuming the stream and REST API.

## Prerequisites

- Node.js 18+
- Solana RPC endpoint (public or private)

## Backend

```bash
cd backend
npm install
# configure env (RPC_URL recommended, defaults to mainnet-beta public)
echo "RPC_URL=https://api.mainnet-beta.solana.com" > .env
# choose a free port if 4000 is taken
$env:PORT=4000; npm run dev
```

Environment variables:

- `RPC_URL` — Solana RPC endpoint (with `getBlock` access)
- `RPC_URLS` — Comma-separated RPC endpoints for failover (overrides `RPC_URL`)
- `PORT` — API/WS port (default `4000`)
- `LOG_LEVEL` — pino log level (default `info`)
- `PROGRAM_MAP_PATH` — optional path to a JSON program map (defaults to `backend/src/programs.json`)

Endpoints:

- `GET /api/latest` — latest block summary (includes rolling stats)
- `GET /api/history?count=100` — last N blocks (capped 600)
- `WS /stream` — snapshot replay plus per-block events
- `/health` — simple health indicator
- `/` — serves the frontend when run from backend

Rate limits: public RPCs may return 429; the backend backs off, slows polling (~2s), and rotates through `RPC_URLS` when provided. For stability, use a private RPC URL.

## Frontend

Option A — served by backend (simplest):

- Start backend, then open `http://localhost:PORT` (default 4000).

Option B — serve static files yourself:

```bash
npx serve frontend -l 3000  # or python -m http.server 8000 from /frontend
```

If backend is on another origin/port, set before `app.js` in `frontend/index.html`:

```html
<script>
  window.BLOCKSCOPE_API = "http://localhost:4000";
  window.BLOCKSCOPE_WS = "ws://localhost:4000/stream";
  // adjust ports/host as needed
</script>
```

Open the served URL; the dashboard auto-connects, replays recent blocks, and live-updates with the latest blocks. Use the theme toggle for light/dark monochrome.

## Milestones (MVP)

1. Core ingestion + normalization (compute, programs, fees)
2. Backend services (fee/congestion metrics, REST, WebSocket)
3. Frontend visuals (timeline, fee trend, program breakdown, heatmap)
4. Polish (auto-reconnect, bounded history, docs)
