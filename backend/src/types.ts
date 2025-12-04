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
  voteTxCount: number;
  nonVoteTxCount: number;
  computeTotal: number;
  computePerProgram: Record<string, number>;
  feeTotal: number;
  avgPriorityFee: number;
  computePriceRatio: number;
  load: LoadLevel;
  topPrograms: { programId: string; compute: number; name: string; category: string }[];
}

export interface StreamMessage {
  slot: number;
  timestamp: number;
  tx_count: number;
  compute_total: number;
  program_breakdown: Record<string, number>;
  priority_fees: number;
  avg_priority_fee: number;
  top_programs: { programId: string; compute: number; name: string; category: string }[];
  load: LoadLevel;
}
