import { Connection } from "@solana/web3.js";

const DEFAULT_COMMITMENT = "confirmed";

export function createRpc(url?: string) {
  const endpoint = url ?? process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com";
  return new Connection(endpoint, DEFAULT_COMMITMENT);
}

export async function fetchLatestBlock(connection: Connection) {
  const slot = await connection.getSlot();
  return fetchBlockBySlot(connection, slot);
}

export async function fetchBlockBySlot(connection: Connection, slot: number) {
  const block = await connection.getBlock(slot, {
    maxSupportedTransactionVersion: 0,
    transactionDetails: "full",
    rewards: false
  });
  if (!block) throw new Error(`Block ${slot} not found`);
  return block;
}
