import express from "express";
import expressWs from "express-ws";
import dotenv from "dotenv";
import pino from "pino";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { createRpcManager, fetchBlockBySlot, fetchLatestBlock } from "./rpc.js";
import { buildBlockMeta } from "./aggregator.js";
import { classifyProgram } from "./classifier.js";
import { BlockMeta, RollingBundle, StreamMessage } from "./types.js";
import { initStorage, persistBlock, queryTopPrograms, querySlotFullnessPerHour, queryFeeVsCompute } from "./storage.js";

dotenv.config();

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
const app = express();
app.use(express.json());
app.use(cors());
const { app: wsApp, getWss } = expressWs(app);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDir = path.resolve(__dirname, "../../frontend");
app.use(express.static(frontendDir));
const storagePath = initStorage();

const PORT = Number(process.env.PORT ?? 4000);
const HISTORY_LIMIT = 600;
const POLL_INTERVAL_MS = 2000;

let latestBlock: BlockMeta | null = null;
const history: BlockMeta[] = [];

function upsertHistory(meta: BlockMeta) {
  history.unshift(meta);
  if (history.length > HISTORY_LIMIT) {
    history.pop();
  }
  latestBlock = meta;
}

function toStreamMessage(meta: BlockMeta, rolling?: RollingBundle): StreamMessage {
  return {
    type: "block",
    slot: meta.slot,
    timestamp: meta.timestamp,
    tx_count: meta.txCount,
    compute_total: meta.computeTotal,
    program_breakdown: meta.computePerProgram,
    priority_fees: meta.feeTotal,
    avg_priority_fee: meta.avgPriorityFee,
    top_programs: meta.topPrograms,
    load: meta.load,
    fullness: meta.fullness,
    compute_price_ratio: meta.computePriceRatio,
    rolling
  };
}

function broadcast(meta: BlockMeta) {
  const payload = JSON.stringify(toStreamMessage(meta, buildRollingBundle()));
  getWss().clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(payload);
    }
  });
}

wsApp.ws("/stream", (ws) => {
  if (history.length) {
    const snapshot = history.slice(0, 80).map((h) => toStreamMessage(h));
    ws.send(JSON.stringify({ type: "snapshot", history: snapshot }));
  }
  if (latestBlock) {
    ws.send(JSON.stringify(toStreamMessage(latestBlock, buildRollingBundle())));
  }
});

app.get("/api/latest", (_req, res) => {
  if (!latestBlock) {
    res.status(503).json({ error: "no data yet" });
    return;
  }
  const rolling = buildRollingBundle();
  res.json({
    slot: latestBlock.slot,
    compute: latestBlock.computeTotal,
    tx_count: latestBlock.txCount,
    programs: latestBlock.computePerProgram,
    fee: latestBlock.feeTotal,
    load: latestBlock.load,
    fullness: latestBlock.fullness,
    rolling
  });
});

app.get("/api/history", (req, res) => {
  const count = Math.min(Number(req.query.count ?? 100), HISTORY_LIMIT);
  res.json(history.slice(0, count));
});

app.get("/api/aggregates/top-programs", (req, res) => {
  const hours = Math.max(1, Math.min(Number(req.query.hours ?? 24), 720));
  const limit = Math.min(Number(req.query.limit ?? 10), 25);
  const data = queryTopPrograms(hours, limit);
  res.json({ hours, data });
});

app.get("/api/aggregates/fullness-hourly", (req, res) => {
  const hours = Math.max(1, Math.min(Number(req.query.hours ?? 24), 720));
  const data = querySlotFullnessPerHour(hours);
  res.json({ hours, data });
});

app.get("/api/aggregates/fee-vs-compute", (req, res) => {
  const hours = Math.max(1, Math.min(Number(req.query.hours ?? 24), 720));
  const data = queryFeeVsCompute(hours);
  res.json({ hours, data });
});

app.get("/", (_req, res) => {
  res.sendFile(path.join(frontendDir, "index.html"));
});

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api") || req.path.startsWith("/stream") || req.path.startsWith("/health")) {
    return next();
  }
  res.sendFile(path.join(frontendDir, "index.html"));
});

app.get("/health", (_req, res) => {
  const last = latestBlock;
  res.json({
    status: last ? "ok" : "warming",
    slot: last?.slot ?? null,
    history: history.length,
    seconds_since_last: last ? Math.max(0, Math.round(Date.now() / 1000 - last.timestamp)) : null,
    storage: storagePath ? { enabled: true, path: storagePath } : { enabled: false }
  });
});

async function pollLoop() {
  const rpcManager = createRpcManager();
  let backoffMs = 1000;
  let lastSlot = 0;
  let consecutiveCritical = 0;

  // initial hydrate
  try {
    const rpc = rpcManager.current();
    const block = await fetchLatestBlock(rpc);
    const meta = buildBlockMeta({ ...block, slot: await rpc.getSlot() });
    upsertHistory(meta);
    logger.info({ slot: meta.slot }, "hydrated latest block");
  } catch (err) {
    logger.warn({ err }, "failed to hydrate latest block, will continue polling");
  }

  while (true) {
    try {
      const rpc = rpcManager.current();
      const slot = await rpc.getSlot();
      if (slot <= lastSlot) {
        await wait(POLL_INTERVAL_MS);
        continue;
      }

      const block = await fetchBlockBySlot(rpc, slot);
      const meta = buildBlockMeta({ ...block, slot });
      lastSlot = slot;
      upsertHistory(meta);
      persistBlock(meta);
      broadcast(meta);
      if (meta.load === "Critical") {
        consecutiveCritical += 1;
        if (consecutiveCritical >= 3) {
          logger.warn({ slot, load: meta.load, fullness: meta.fullness }, "ALERT: sustained critical congestion");
        }
      } else {
        consecutiveCritical = 0;
      }
      backoffMs = 1000;
      logger.debug({ slot }, "processed block");
    } catch (err) {
      const rateLimited = isRateLimitError(err);
      logger.error({ err, rateLimited }, "polling failed");
      if (rateLimited) {
        rpcManager.advance();
        logger.warn({ endpoint: rpcManager.currentEndpoint }, "switched RPC endpoint due to rate limit");
      }
      if (rateLimited) {
        backoffMs = Math.max(backoffMs * 1.8, 5000);
      } else {
        backoffMs = Math.min(backoffMs * 1.5, 10_000);
      }
      await wait(backoffMs);
      continue;
    }
    await wait(POLL_INTERVAL_MS);
  }
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(err: unknown) {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return /429|Too Many Requests|rate limit/i.test(msg);
}

app.listen(PORT, () => {
  logger.info(`BlockScope backend listening on port ${PORT}`);
  pollLoop().catch((err) => logger.error({ err }, "poll loop crashed"));
});

function buildRollingBundle(): RollingBundle {
  const now = Date.now() / 1000;
  const windows = [60, 300] as const;
  const bundle: Partial<RollingBundle> = {};

  const windowStats = (seconds: number) => {
    const cutoff = now - seconds;
    const items = history.filter((h) => (h.timestamp ?? 0) >= cutoff);
    if (!items.length) return { avgCompute: 0, avgFee: 0, topPrograms: [] };
    const totalCompute = items.reduce((acc, h) => acc + h.computeTotal, 0);
    const avgCompute = totalCompute / items.length;
    const avgFee = items.reduce((acc, h) => acc + h.avgPriorityFee, 0) / items.length;
    const programTotals: Record<string, number> = {};
    items.forEach((h) => {
      for (const [pid, cu] of Object.entries(h.computePerProgram)) {
        programTotals[pid] = (programTotals[pid] ?? 0) + cu;
      }
    });
    const topPrograms = Object.entries(programTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([programId, compute]) => {
        const info = classifyProgram(programId);
        return { programId, compute, name: info.name, category: info.category };
      });
    return { avgCompute, avgFee, topPrograms };
  };

  windows.forEach((w) => {
    bundle[w] = { windowSeconds: w, ...windowStats(w) };
  });

  const items5m = history.filter((h) => (h.timestamp ?? 0) >= now - 300);
  const ratios = items5m.map((h) => h.computePriceRatio || 0).filter((n) => Number.isFinite(n));
  const fullness = items5m.map((h) => h.fullness || 0);

  const fullness_p90 = fullness.length
    ? fullness.sort((a, b) => a - b)[Math.floor(0.9 * (fullness.length - 1))]
    : 0;

  const fee_compute_histogram = (() => {
    if (!ratios.length) return [0, 0, 0, 0, 0];
    const max = Math.max(...ratios);
    const bucketCount = 5;
    const buckets = Array(bucketCount).fill(0);
    ratios.forEach((r) => {
      const idx = Math.min(bucketCount - 1, Math.floor((r / max) * bucketCount));
      buckets[idx] += 1;
    });
    return buckets;
  })();

  const vote_ratio = items5m.reduce(
    (acc, h) => {
      acc.vote += h.voteTxCount;
      acc.nonVote += h.nonVoteTxCount;
      return acc;
    },
    { vote: 0, nonVote: 0 }
  );

  const fee_spike =
    latestBlock && bundle["300"] && bundle["300"]!.avgFee > 0
      ? latestBlock.avgPriorityFee > bundle["300"]!.avgFee * 2
      : false;

  return {
    "60": bundle["60"] ?? { windowSeconds: 60, avgCompute: 0, avgFee: 0, topPrograms: [] },
    "300": bundle["300"] ?? { windowSeconds: 300, avgCompute: 0, avgFee: 0, topPrograms: [] },
    fee_spike,
    fullness_p90,
    fee_compute_histogram,
    vote_ratio
  };
}
