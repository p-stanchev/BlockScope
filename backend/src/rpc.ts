import { Connection } from "@solana/web3.js";

const DEFAULT_COMMITMENT = "confirmed";

function parseRpcUrls(): string[] {
  const envList = process.env.RPC_URLS ?? process.env.RPC_URL;
  if (envList) {
    return envList
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return ["https://api.mainnet-beta.solana.com"];
}

export function createRpcManager() {
  const endpoints = parseRpcUrls();
  const connections = endpoints.map((url) => new Connection(url, DEFAULT_COMMITMENT));
  let index = 0;

  function current() {
    return connections[index];
  }

  function advance() {
    index = (index + 1) % connections.length;
    return current();
  }

  return { current, advance, endpoints, get currentEndpoint() { return endpoints[index]; } };
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
