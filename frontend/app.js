const API_BASE = window.BLOCKSCOPE_API || "http://localhost:4000";
const WS_URL =
  window.BLOCKSCOPE_WS ||
  (API_BASE.startsWith("http") ? API_BASE.replace(/^http/, "ws") : "ws://localhost:4000") + "/stream";

const state = {
  history: []
};

const limit = 150;

function pushHistory(meta) {
  state.history.unshift(meta);
  if (state.history.length > limit) state.history.pop();
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
  const res = await fetch(`${API_BASE}/api/history?count=${limit}`);
  const data = await res.json();
  state.history = data.map((b) => ({ ...b, timestamp: (b.timestamp || 0) * 1000 }));
  renderAll();
}

function connectWs() {
  const ws = new WebSocket(WS_URL);
  ws.onmessage = (evt) => {
    const msg = JSON.parse(evt.data);
    const meta = {
      slot: msg.slot,
      timestamp: msg.timestamp * 1000,
      txCount: msg.tx_count,
      computeTotal: msg.compute_total,
      computePerProgram: msg.program_breakdown || {},
      feeTotal: msg.priority_fees,
      avgPriorityFee: msg.avg_priority_fee || 0,
      load: msg.load,
      topPrograms: msg.top_programs || [],
      voteTxCount: 0,
      nonVoteTxCount: 0,
      blockhash: "",
      parentSlot: 0,
      computePriceRatio: 0
    };
    pushHistory(meta);
    renderAll();
  };
  ws.onclose = () => {
    setTimeout(connectWs, 1500);
  };
}

function renderAll() {
  const latest = state.history[0];
  if (!latest) return;
  renderHeader(latest);
  renderTimeline();
  renderPrograms(latest);
  renderHeatmap();
  renderFeeTrend();
  renderRecent();
}

function renderHeader(latest) {
  const slotEl = document.getElementById("slot");
  const loadEl = document.getElementById("load");
  const computeEl = document.getElementById("compute-total");
  const txEl = document.getElementById("tx-count");
  const avgFeeEl = document.getElementById("avg-fee");
  slotEl.textContent = latest.slot.toLocaleString();
  loadEl.textContent = latest.load;
  loadEl.className = `text-xl font-semibold ${loadColor(latest.load).replace("bg-", "text-")}`;
  computeEl.textContent = `${latest.computeTotal.toLocaleString()} CU`;
  txEl.textContent = `${latest.txCount ?? 0} txs`;
  avgFeeEl.textContent = `${(latest.avgPriorityFee ?? 0).toFixed(9)} SOL avg`;
}

function renderTimeline() {
  const timeline = document.getElementById("timeline");
  timeline.innerHTML = "";
  const items = state.history.slice(0, 80);
  const maxCompute = Math.max(...items.map((b) => b.computeTotal || 1), 1);
  items.forEach((block) => {
    const height = Math.max((block.computeTotal / maxCompute) * 240, 4);
    const bar = document.createElement("div");
    bar.className = `flex-1 min-w-[6px] rounded-t-md shadow-inner shadow-black/30 ${loadColor(block.load)}`;
    bar.style.height = `${height}px`;
    bar.title = `Slot ${block.slot}\nCompute ${block.computeTotal.toLocaleString()}`;
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
            name: programId.slice(0, 4) + "…" + programId.slice(-4),
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
  state.history.slice(0, 12).forEach((block) => {
    const row = document.createElement("div");
    row.className = "flex items-center justify-between bg-stone border border-ash rounded-xl px-3 py-2";
    const left = document.createElement("div");
    left.innerHTML = `<div class="text-sm font-medium">Slot ${block.slot}</div><div class="text-xs text-smoke">${new Date(
      block.timestamp || Date.now()
    ).toLocaleTimeString()}</div>`;
    const right = document.createElement("div");
    right.className = "text-right text-sm text-gray-200";
    right.innerHTML = `<div>${block.txCount ?? 0} txs</div><div class="text-xs text-smoke">${block.computeTotal.toLocaleString()} CU</div>`;
    row.appendChild(left);
    row.appendChild(right);
    list.appendChild(row);
  });
}

fetchHistory().catch((err) => console.error("history load failed", err));
connectWs();
