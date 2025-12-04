import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ProgramInfo } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultMapPath = path.resolve(__dirname, "./programs.json");

let PROGRAM_MAP: Record<string, ProgramInfo> = {};

function loadProgramMap(mapPath = defaultMapPath) {
  try {
    const raw = fs.readFileSync(mapPath, "utf-8");
    const parsed = JSON.parse(raw);
    PROGRAM_MAP = parsed;
  } catch (err) {
    // fallback to baked-in defaults if file missing
    PROGRAM_MAP = {
      "11111111111111111111111111111111": { name: "System Program", category: "System" },
      "Vote111111111111111111111111111111111111111": { name: "Vote Program", category: "Validator" },
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA": { name: "SPL Token", category: "Token" }
    };
  }
}

loadProgramMap(process.env.PROGRAM_MAP_PATH ?? defaultMapPath);

try {
  fs.watch(process.env.PROGRAM_MAP_PATH ?? defaultMapPath, { persistent: false }, () => {
    loadProgramMap(process.env.PROGRAM_MAP_PATH ?? defaultMapPath);
  });
} catch {
  // no-op if watch fails
}

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
