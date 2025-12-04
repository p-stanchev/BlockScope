import { ProgramInfo } from "./types.js";

const PROGRAM_MAP: Record<string, ProgramInfo> = {
  "11111111111111111111111111111111": { name: "System Program", category: "System" },
  "Vote111111111111111111111111111111111111111": { name: "Vote Program", category: "Validator" },
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA": { name: "SPL Token", category: "Token" },
  "JUP2n6CikCqQX9G8ENcNNQKc4BFq4Su5N3JfYknzVtd": { name: "Jupiter v2", category: "DEX/Aggregator" },
  "orca2pSQq4eoPYCmcdkE6LN3tqmcoYUPhHjD3CVczbg": { name: "Orca", category: "DEX" }
};

export function classifyProgram(programId: string): ProgramInfo {
  return PROGRAM_MAP[programId] ?? { name: "Custom Program", category: "Other" };
}

export function classifyTopPrograms(computePerProgram: Record<string, number>, topN = 5) {
  return Object.entries(computePerProgram)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([programId, compute]) => {
      const info = classifyProgram(programId);
      return { programId, compute, name: info.name, category: info.category };
    });
}
