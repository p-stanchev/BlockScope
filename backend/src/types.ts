export type LoadLevel = "Low" | "Medium" | "High" | "Critical";

export interface ProgramInfo {
  name: string;
  category: string;
}

export interface BlockMeta {
  slot: number;
  blockhash: string;
  parentSlot: number;
  timestamp: number;
  txCount: number;
  failureCount: number;
  failureRate: number;
  errorCounts: Record<string, number>;
  programFailures: Record<string, number>;
  programTxCount: Record<string, number>;
  voteTxCount: number;
  nonVoteTxCount: number;
  computeTotal: number;
  computePerProgram: Record<string, number>;
  feeTotal: number;
  avgPriorityFee: number;
  computePriceRatio: number;
  fullness: number;
  load: LoadLevel;
  topPrograms: { programId: string; compute: number; name: string; category: string }[];
  unknownPrograms: number;
}

export interface StreamMessage {
  type: "block" | "snapshot";
  slot: number;
  timestamp: number;
  tx_count: number;
  failure_count: number;
  failure_rate: number;
  error_counts: Record<string, number>;
  compute_total: number;
  program_breakdown: Record<string, number>;
  program_failures: Record<string, number>;
  program_tx_count: Record<string, number>;
  priority_fees: number;
  avg_priority_fee: number;
  top_programs: { programId: string; compute: number; name: string; category: string }[];
  load: LoadLevel;
  fullness: number;
  compute_price_ratio?: number;
  rolling?: RollingBundle;
}

export interface RollingBundle {
  "60": RollingMetrics;
  "300": RollingMetrics;
  "3600": RollingMetrics;
  fee_spike: boolean;
  fullness_p90: number;
  fee_compute_histogram: number[];
  vote_ratio: { vote: number; nonVote: number };
  failure: FailureStats;
}

export interface RollingMetrics {
  windowSeconds: number;
  avgCompute: number;
  avgFee: number;
  topPrograms: { programId: string; compute: number; name: string; category: string }[];
  failureRate?: number;
}

export interface FailureStats {
  windowSeconds: number;
  failureRate: number;
  errorCounts: Record<string, number>;
  programFailures: Record<string, number>;
}
