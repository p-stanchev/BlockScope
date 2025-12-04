import express from "express";
import expressWs from "express-ws";
import dotenv from "dotenv";
import pino from "pino";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { createRpc, fetchBlockBySlot, fetchLatestBlock } from "./rpc.js";
import { buildBlockMeta } from "./aggregator.js";
import { BlockMeta, StreamMessage } from "./types.js";

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

const PORT = Number(process.env.PORT ?? 4000);
const HISTORY_LIMIT = 500;
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

function toStreamMessage(meta: BlockMeta): StreamMessage {
  return {
    slot: meta.slot,
    timestamp: meta.timestamp,
    tx_count: meta.txCount,
    compute_total: meta.computeTotal,
    program_breakdown: meta.computePerProgram,
    priority_fees: meta.feeTotal,
    avg_priority_fee: meta.avgPriorityFee,
    top_programs: meta.topPrograms,
    load: meta.load
  };
}

function broadcast(meta: BlockMeta) {
  const payload = JSON.stringify(toStreamMessage(meta));
  getWss().clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(payload);
    }
  });
}

wsApp.ws("/stream", (ws) => {
  if (latestBlock) {
    ws.send(JSON.stringify(toStreamMessage(latestBlock)));
  }
});

app.get("/api/latest", (_req, res) => {
  if (!latestBlock) {
    res.status(503).json({ error: "no data yet" });
    return;
  }
  res.json({
    slot: latestBlock.slot,
    compute: latestBlock.computeTotal,
    tx_count: latestBlock.txCount,
    programs: latestBlock.computePerProgram,
    fee: latestBlock.feeTotal,
    load: latestBlock.load
  });
});

app.get("/api/history", (req, res) => {
  const count = Math.min(Number(req.query.count ?? 100), HISTORY_LIMIT);
  res.json(history.slice(0, count));
});

app.get("/", (_req, res) => {
  res.sendFile(path.join(frontendDir, "index.html"));
});

async function pollLoop() {
  const rpc = createRpc();
  let backoffMs = 1000;
  let lastSlot = 0;

  // initial hydrate
  try {
    const block = await fetchLatestBlock(rpc);
    const meta = buildBlockMeta({ ...block, slot: await rpc.getSlot() });
    upsertHistory(meta);
    logger.info({ slot: meta.slot }, "hydrated latest block");
  } catch (err) {
    logger.warn({ err }, "failed to hydrate latest block, will continue polling");
  }

  while (true) {
    try {
      const slot = await rpc.getSlot();
      if (slot <= lastSlot) {
        await wait(POLL_INTERVAL_MS);
        continue;
      }

      const block = await fetchBlockBySlot(rpc, slot);
      const meta = buildBlockMeta({ ...block, slot });
      lastSlot = slot;
      upsertHistory(meta);
      broadcast(meta);
      backoffMs = 1000;
      logger.debug({ slot }, "processed block");
    } catch (err) {
      const rateLimited = isRateLimitError(err);
      logger.error({ err, rateLimited }, "polling failed");
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
