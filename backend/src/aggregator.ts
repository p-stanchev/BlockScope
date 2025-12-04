import { classifyProgram, classifyTopPrograms } from "./classifier.js";
import { BlockMeta, LoadLevel } from "./types.js";

const STATIC_COMPUTE_CAPACITY = 53_000_000; // fallback estimate
let rollingMaxCompute = STATIC_COMPUTE_CAPACITY;

export function updateCapacityEstimate(computeUsed: number) {
  // simple EMA to adapt to observed peaks
  const alpha = 0.1;
  rollingMaxCompute = Math.max(STATIC_COMPUTE_CAPACITY, rollingMaxCompute * (1 - alpha) + computeUsed * alpha);
}

export function computeLoadLevel(computeUsed: number): LoadLevel {
  const ratio = computeUsed / rollingMaxCompute;
  if (ratio < 0.4) return "Low";
  if (ratio < 0.7) return "Medium";
  if (ratio < 0.9) return "High";
  return "Critical";
}

export function buildBlockMeta(raw: any): BlockMeta {
  const txs = raw?.transactions ?? [];
  let computeTotal = 0;
  let feeTotalLamports = 0;
  let computePriceRatio = 0;
  const computePerProgram: Record<string, number> = {};
  let voteTxCount = 0;
  let nonVoteTxCount = 0;
  let unknownPrograms = 0;

  for (const tx of txs) {
    const cu = tx.meta?.computeUnitsConsumed ?? 0;
    computeTotal += cu;

    const priorityLamports = tx.meta?.fee ?? 0;
    feeTotalLamports += priorityLamports;
    if (cu > 0) {
      computePriceRatio += priorityLamports / cu;
    }

    const isVote = tx.meta?.logMessages?.some((log: string) => log.includes("vote")) ?? false;
    if (isVote) voteTxCount += 1;
    else nonVoteTxCount += 1;

    const message = tx.transaction?.message;
    const accountKeys = message?.accountKeys ?? [];
    const instructions = Array.isArray(message?.instructions) ? message?.instructions : [];
    for (const ix of instructions) {
      let pid: string | undefined;
      if (ix.programId) {
        pid = ix.programId.toString();
      } else if (typeof ix.programIdIndex === "number") {
        const key = accountKeys[ix.programIdIndex];
        if (key) pid = key.toString();
      }
      if (!pid) continue;
      computePerProgram[pid] = (computePerProgram[pid] ?? 0) + cu;
      const info = classifyProgram(pid);
      if (info.name === "Custom Program") unknownPrograms += 1;
    }
  }

  const txCount = txs.length || 1; // avoid zero division
  const avgPriorityFee = feeTotalLamports / txCount / 1_000_000_000; // convert to SOL
  const feeTotalSol = feeTotalLamports / 1_000_000_000;
  updateCapacityEstimate(computeTotal);
  const load = computeLoadLevel(computeTotal);
  const fullness = computeTotal / rollingMaxCompute;

  const topPrograms = classifyTopPrograms(computePerProgram);

  return {
    slot: raw?.slot ?? 0,
    blockhash: raw?.blockhash ?? "",
    parentSlot: raw?.parentSlot ?? 0,
    timestamp: raw?.blockTime ?? Date.now() / 1000,
    txCount,
    voteTxCount,
    nonVoteTxCount,
    computeTotal,
    computePerProgram,
    feeTotal: feeTotalSol,
    avgPriorityFee,
    computePriceRatio: computePriceRatio / txCount,
    fullness,
    load,
    topPrograms,
    unknownPrograms
  };
}
