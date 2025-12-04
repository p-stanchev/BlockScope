const origin = window.location && window.location.origin ? window.location.origin : "http://localhost:4000";
const API_BASE = window.BLOCKSCOPE_API || origin;
const API_URL = new URL(API_BASE);
const WS_URL =
  window.BLOCKSCOPE_WS ||
  `${API_URL.protocol === "https:" ? "wss:" : "ws:"}//${API_URL.host}/stream`;

const HISTORY_LIMIT = 300;

const state = {
  history: [],
  pinned: null,
  rolling: null
};

let renderQueued = false;
const analytics = {
  track: (name, props = {}) => {
    if (window.posthog && window.posthog.capture) window.posthog.capture(name, props);
  }
};

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderAll();
  });
}

function normalizeBlock(msg) {
  return {
    slot: msg.slot,
    timestamp: (msg.timestamp || 0) * 1000,
    txCount: msg.tx_count ?? msg.txCount ?? 0,
    failureCount: msg.failure_count ?? 0,
    failureRate: msg.failure_rate ?? 0,
    errorCounts: msg.error_counts || {},
    computeTotal: msg.compute_total ?? msg.computeTotal ?? 0,
    computePerProgram: msg.program_breakdown || msg.computePerProgram || {},
    programFailures: msg.program_failures || {},
    programTxCount: msg.program_tx_count || {},
    feeTotal: msg.priority_fees ?? msg.feeTotal ?? 0,
    avgPriorityFee: msg.avg_priority_fee ?? msg.avgPriorityFee ?? 0,
    load: msg.load || "Low",
    topPrograms: msg.top_programs || msg.topPrograms || [],
    voteTxCount: msg.voteTxCount ?? msg.vote_tx_count ?? 0,
    nonVoteTxCount: msg.nonVoteTxCount ?? msg.non_vote_tx_count ?? 0,
    blockhash: msg.blockhash || "",
    parentSlot: msg.parentSlot || 0,
    computePriceRatio: msg.compute_price_ratio ?? msg.computePriceRatio ?? 0,
    fullness: msg.fullness ?? msg.fullness ?? 0,
    rolling: msg.rolling
  };
}

function pushHistory(meta) {
  if (state.history.length && state.history[0].slot === meta.slot) {
    state.history[0] = meta;
  } else {
    state.history.unshift(meta);
  }
  if (state.history.length > HISTORY_LIMIT) state.history.length = HISTORY_LIMIT;
}

function loadColor(load) {
  switch (load) {
    case "Low":
      return "bg-gray-500";
    case "Medium":
      return "bg-gray-400";
    case "High":
      return "bg-gray-300";
    default:
      return "bg-white";
  }
}

function loadShade(load) {
  switch (load) {
    case "Low":
      return "rgba(156,163,175,0.35)";
    case "Medium":
      return "rgba(209,213,219,0.45)";
    case "High":
      return "rgba(229,231,235,0.6)";
    default:
      return "rgba(255,255,255,0.75)";
  }
}

async function fetchHistory() {
  const res = await fetch(`${API_BASE}/api/history?count=${HISTORY_LIMIT}`);
  const data = await res.json();
  state.history = data.map((b) => ({ ...b, timestamp: (b.timestamp || 0) * 1000 }));
  if (!state.pinned && state.history.length) state.pinned = state.history[0];
  scheduleRender();
}

function connectWs() {
  const ws = new WebSocket(WS_URL);
  ws.onmessage = (evt) => {
    const msg = JSON.parse(evt.data);
    if (msg.type === "snapshot" && Array.isArray(msg.history)) {
      state.history = msg.history.map(normalizeBlock).sort((a, b) => b.slot - a.slot);
      if (!state.pinned && state.history.length) state.pinned = state.history[0];
      scheduleRender();
      return;
    }
    if (msg.type === "block" || msg.slot) {
      const meta = normalizeBlock(msg);
      pushHistory(meta);
      if (msg.rolling) state.rolling = msg.rolling;
      if (!state.pinned) state.pinned = meta;
      analytics.track("block_received", { slot: meta.slot, load: meta.load, txs: meta.txCount });
      scheduleRender();
    }
  };
  ws.onopen = () => analytics.track("ws_connected");
  ws.onclose = () => {
    analytics.track("ws_disconnected");
    setTimeout(connectWs, 1500);
  };
}

function renderAll() {
  const latest = state.history[0];
  if (!latest) return;
  renderHeader(latest);
  renderRolling(latest);
  renderTimeline();
  renderPrograms(latest);
  renderFailures(latest);
  renderHeatmap();
  renderFeeTrend();
  renderRecent();
  renderPinned();
  renderRatioHist();
  renderVoteMix();
}

function renderHeader(latest) {
  const slotEl = document.getElementById("slot");
  const loadEl = document.getElementById("load");
  const computeEl = document.getElementById("compute-total");
  const txEl = document.getElementById("tx-count");
  const avgFeeEl = document.getElementById("avg-fee");
  const failEl = document.getElementById("fail-rate");
  slotEl.textContent = latest.slot.toLocaleString();
  loadEl.textContent = latest.load;
  loadEl.className = "text-2xl font-semibold text-white";
  computeEl.textContent = `${latest.computeTotal.toLocaleString()} CU`;
  txEl.textContent = `${latest.txCount ?? 0} txs`;
  avgFeeEl.textContent = `${(latest.avgPriorityFee ?? 0).toFixed(9)} SOL avg`;
  const rolling = state.rolling ?? deriveLocalRolling();
  const rateNow = rolling.failure?.failureRate ?? latest.failureRate ?? 0;
  if (failEl) failEl.textContent = `${Math.round(rateNow * 1000) / 10}% fail`;
}

function renderRolling(latest) {
  const rolling = state.rolling ?? deriveLocalRolling();
  const setTop = (id, data) => {
    const elCompute = document.getElementById(id + "-compute");
    const elTop = document.getElementById(id + "-top");
    if (!elCompute || !elTop) return;
    elCompute.textContent = `${(data.avgCompute || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} CU`;
    elTop.textContent =
      data.topPrograms && data.topPrograms.length
        ? data.topPrograms.map((p) => p.name || p.programId).join(" · ")
        : "—";
  };
  setTop("roll-60", rolling["60"]);
  setTop("roll-300", rolling["300"]);

  const spike = document.getElementById("fee-spike");
  if (spike) {
    const isSpike = rolling.fee_spike;
    spike.textContent = isSpike ? "spike" : "stable";
    spike.className = `px-2 py-0.5 rounded-full text-[10px] ${
      isSpike ? "bg-white text-black" : "bg-stone text-smoke"
    }`;
  }
  const fullness = document.getElementById("fullness-p90");
  if (fullness) fullness.textContent = `${Math.round((rolling.fullness_p90 || 0) * 100)}%`;
  const voteRatio = document.getElementById("vote-ratio");
  if (voteRatio) {
    const total = (rolling.vote_ratio?.vote ?? 0) + (rolling.vote_ratio?.nonVote ?? 0) || 1;
    const votePct = ((rolling.vote_ratio?.vote ?? 0) / total) * 100;
    voteRatio.textContent = `${votePct.toFixed(1)}% vote · ${(100 - votePct).toFixed(1)}% non-vote`;
  }
  const failWin = document.getElementById("fail-rate-1h");
  if (failWin) {
    const rate = rolling.failure?.failureRate ?? 0;
    failWin.textContent = `1h fail: ${Math.round(rate * 1000) / 10}%`;
  }
}

function renderTimeline() {
  const timeline = document.getElementById("timeline");
  timeline.innerHTML = "";
  const items = state.history.slice(0, 80);
  const maxCompute = Math.max(...items.map((b) => b.computeTotal || 1), 1);
  items.forEach((block) => {
    const height = Math.max((block.computeTotal / maxCompute) * 240, 4);
    const bar = document.createElement("div");
    bar.className = `flex-1 min-w-[6px] rounded-t-md shadow-inner shadow-black/30 cursor-pointer ${loadColor(block.load)}`;
    bar.style.height = `${height}px`;
    bar.title = `Slot ${block.slot}\nCompute ${block.computeTotal.toLocaleString()}\nFee ${block.feeTotal ?? 0} SOL`;
    bar.onclick = () => {
      state.pinned = block;
      analytics.track("block_pinned", { slot: block.slot, load: block.load });
      renderPinned();
    };
    timeline.appendChild(bar);
  });
}

function renderPrograms(latest) {
  const container = document.getElementById("programs");
  container.innerHTML = "";
  const programs =
    latest.topPrograms && latest.topPrograms.length > 0
      ? latest.topPrograms
      : Object.entries(latest.computePerProgram || {})
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([programId, compute]) => ({
            programId,
            compute,
            name: `${programId.slice(0, 4)}…${programId.slice(-4)}`,
            category: "Other"
          }));

  const total = programs.reduce((acc, p) => acc + p.compute, 0) || 1;

  programs.forEach((p) => {
    const row = document.createElement("div");
    row.className = "flex items-center gap-3";
    const pill = document.createElement("div");
    pill.className = "h-10 w-10 rounded-xl bg-ash border border-stone flex items-center justify-center text-xs";
    pill.textContent = p.category[0] ?? "•";
    const body = document.createElement("div");
    body.className = "flex-1";
    const title = document.createElement("div");
    title.className = "flex justify-between text-sm";
    title.innerHTML = `<span>${p.name}</span><span class="text-smoke">${((p.compute / total) * 100).toFixed(
      1
    )}%</span>`;
    const bar = document.createElement("div");
    bar.className = "w-full h-2 bg-stone rounded-full mt-1";
    const inner = document.createElement("div");
    inner.className = "h-full rounded-full bg-white";
    inner.style.width = `${Math.max((p.compute / total) * 100, 2)}%`;
    bar.appendChild(inner);
    body.appendChild(title);
    body.appendChild(bar);
    row.appendChild(pill);
    row.appendChild(body);
    container.appendChild(row);
  });
}

function renderHeatmap() {
  const heatmap = document.getElementById("heatmap");
  heatmap.innerHTML = "";
  const items = state.history.slice(0, 150);
  items.forEach((block) => {
    const cell = document.createElement("div");
    cell.className = "w-full h-5 rounded-sm";
    cell.style.background = loadShade(block.load);
    cell.title = `Slot ${block.slot} • ${block.load}`;
    heatmap.appendChild(cell);
  });
}

function renderFeeTrend() {
  const container = document.getElementById("fee-trend");
  container.innerHTML = "";
  const items = state.history.slice(0, 50);
  const maxFee = Math.max(...items.map((b) => b.avgPriorityFee || 0), 0.000001);
  items.forEach((block) => {
    const bar = document.createElement("div");
    const height = Math.max((block.avgPriorityFee / maxFee) * 240, 2);
    bar.className = "flex-1 min-w-[4px] bg-white/80 rounded-sm shadow-sm shadow-black/30";
    bar.style.height = `${height}px`;
    bar.title = `Avg priority fee: ${block.avgPriorityFee.toFixed(9)} SOL`;
    container.appendChild(bar);
  });
  const latest = items[0];
  const feeLatest = document.getElementById("fee-latest");
  const feeMax = document.getElementById("fee-max");
  feeLatest.textContent = latest ? `${latest.avgPriorityFee.toFixed(9)} SOL avg` : "—";
  feeMax.textContent = `max ${(maxFee || 0).toFixed(9)} SOL`;
}

function renderRecent() {
  const list = document.getElementById("recent-blocks");
  list.innerHTML = "";
  state.history.slice(0, 20).forEach((block) => {
    const row = document.createElement("div");
    row.className = "flex items-center justify-between bg-stone border border-ash rounded-xl px-3 py-2";
    const left = document.createElement("div");
    left.innerHTML = `<div class="text-sm font-medium">Slot ${block.slot}</div><div class="text-xs text-smoke">${new Date(
      block.timestamp || Date.now()
    ).toLocaleTimeString()}</div>`;
    const right = document.createElement("div");
    right.className = "text-right text-sm text-gray-200";
    right.innerHTML = `<div>${block.txCount ?? 0} txs</div><div class="text-xs text-smoke">${block.computeTotal.toLocaleString()} CU</div>`;
    row.onclick = () => {
      state.pinned = block;
      analytics.track("block_pinned", { slot: block.slot, load: block.load });
      renderPinned();
    };
    row.appendChild(left);
    row.appendChild(right);
    list.appendChild(row);
  });
}

function renderPinned() {
  const pin = document.getElementById("pinned");
  if (!pin) return;
  const block = state.pinned;
  if (!block) {
    pin.textContent = "Click a block bar to pin.";
    return;
  }
  const fullnessPct = Math.round((block.fullness || 0) * 1000) / 10;
  pin.innerHTML = `
    <div class="text-lg font-semibold">Slot ${block.slot}</div>
    <div class="text-sm text-smoke">Compute: ${block.computeTotal.toLocaleString()} CU</div>
    <div class="text-sm text-smoke">Fees: ${block.feeTotal?.toFixed ? block.feeTotal.toFixed(9) : block.feeTotal} SOL</div>
    <div class="text-sm text-smoke">Load: ${block.load} · Fullness ${fullnessPct}%</div>
    <div class="text-sm text-smoke">Tx: ${block.txCount ?? 0}</div>
    <div class="text-sm text-smoke">Top program: ${
      block.topPrograms?.[0]?.name ?? "—"
    } (${block.topPrograms?.[0]?.compute?.toLocaleString?.() || "—"} CU)</div>
  `;
}

function renderRatioHist() {
  const container = document.getElementById("ratio-hist");
  if (!container) return;
  container.innerHTML = "";
  const rolling = state.rolling ?? deriveLocalRolling();
  const buckets = rolling.fee_compute_histogram || [];
  const max = Math.max(...buckets, 1);
  buckets.forEach((count, idx) => {
    const bar = document.createElement("div");
    bar.className = "flex-1 bg-white/80 rounded-sm shadow-sm shadow-black/30";
    bar.style.height = `${Math.max((count / max) * 120, 4)}px`;
    bar.title = `Bucket ${idx + 1}: ${count} blocks`;
    container.appendChild(bar);
  });
}

function renderVoteMix() {
  const container = document.getElementById("vote-mix");
  if (!container) return;
  container.innerHTML = "";
  const rolling = state.rolling ?? deriveLocalRolling();
  const vote = rolling.vote_ratio?.vote ?? 0;
  const nonVote = rolling.vote_ratio?.nonVote ?? 0;
  const total = vote + nonVote || 1;
  const votePct = (vote / total) * 100;
  const bar = document.createElement("div");
  bar.className = "flex-1 h-3 rounded-full bg-stone overflow-hidden";
  const innerVote = document.createElement("div");
  innerVote.className = "h-full bg-white";
  innerVote.style.width = `${votePct}%`;
  bar.appendChild(innerVote);
  container.appendChild(bar);
  const label = document.createElement("div");
  label.className = "text-xs text-smoke";
  label.textContent = `${votePct.toFixed(1)}% vote · ${(100 - votePct).toFixed(1)}% non-vote`;
  container.appendChild(label);
}

function deriveLocalRolling() {
  const now = Date.now();
  const windows = [60, 300, 3600];
  const rolling = {
    "60": { windowSeconds: 60, avgCompute: 0, avgFee: 0, topPrograms: [] },
    "300": { windowSeconds: 300, avgCompute: 0, avgFee: 0, topPrograms: [] },
    "3600": { windowSeconds: 3600, avgCompute: 0, avgFee: 0, topPrograms: [], failureRate: 0 },
    fee_spike: false,
    fullness_p90: 0,
    fee_compute_histogram: [0, 0, 0, 0, 0],
    vote_ratio: { vote: 0, nonVote: 0 }
  };
  windows.forEach((w) => {
    const cutoff = now - w * 1000;
    const items = state.history.filter((b) => (b.timestamp || 0) >= cutoff);
    if (!items.length) return;
    const avgCompute = items.reduce((acc, b) => acc + (b.computeTotal || 0), 0) / items.length;
    const avgFee = items.reduce((acc, b) => acc + (b.avgPriorityFee || 0), 0) / items.length;
    const programTotals = {};
    items.forEach((b) => {
      for (const [pid, cu] of Object.entries(b.computePerProgram || {})) {
        programTotals[pid] = (programTotals[pid] || 0) + cu;
      }
    });
    const topPrograms = Object.entries(programTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([pid]) => pid);
    rolling[w] = {
      windowSeconds: w,
      avgCompute,
      avgFee,
      topPrograms: topPrograms.map((pid) => ({ programId: pid, name: `${pid.slice(0, 4)}…`, category: "Other", compute: programTotals[pid] }))
    };
  });
  return rolling;
}

function renderFailures(latest) {
  const container = document.getElementById("failures");
  if (!container) return;
  container.innerHTML = "";
  const rolling = state.rolling ?? deriveLocalRolling();
  const errors = rolling.failure?.errorCounts || latest.errorCounts || {};
  const entries = Object.entries(errors).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (!entries.length) {
    container.textContent = "No failures observed in window.";
    return;
  }
  entries.forEach(([err, count]) => {
    const row = document.createElement("div");
    row.className = "flex justify-between text-sm text-gray-200";
    row.innerHTML = `<span class="text-smoke">${err}</span><span>${count}</span>`;
    container.appendChild(row);
  });
}

fetchHistory().catch((err) => console.error("history load failed", err));
connectWs();
