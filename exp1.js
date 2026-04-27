import { Account, RpcProvider, Contract } from "starknet";
import * as dotenv from "dotenv";
import abiJson from "./abi.json" with { type: "json" };
import fs from "fs";
import path from "path";

dotenv.config();

// ===== ENV =====
const STARKNET_RPC_URL = process.env.STARKNET_RPC_URL;
const accountAddress = process.env.STARKNET_ACCOUNT_ADDRESS;
const privateKey = process.env.PRIVATE_KEY;
const contractAddress = process.env.L2_CONTRACT_ADDRESS;
const contractMsgL1 = process.env.CONTRACTMSG_ADDRESS; // Used only for calldata
const userEvmAddress = process.env.USER_EVM_ADDRESS;

if (!STARKNET_RPC_URL || !accountAddress || !privateKey || !contractAddress || !contractMsgL1 || !userEvmAddress) {
  throw new Error(
    "Missing some .env variables: STARKNET_RPC_URL, STARKNET_ACCOUNT_ADDRESS, PRIVATE_KEY, L2_CONTRACT_ADDRESS, CONTRACTMSG_ADDRESS, USER_EVM_ADDRESS"
  );
}

// ===== CONFIG =====
const BATCH_SIZES = [256];       // Same as L1 for comparison
const CHUNK_SIZE = 64;           // Maximum sub-batch size
const CONCURRENCY = 16;          // Actual parallelism
const SUBMIT_DELAY_MS = 1000;    // Small delay between submissions to avoid overloading the RPC
const TIMEOUT_MS = 180_000;      // Receipt waiting timeout
const REVIEW_TEXT = "!";         // Short review text
const FEE_BUFFER = 1.30;         // +30% over the estimated fee
// ===================

// Helpers
const evmToFelt = (addr) => BigInt(addr);
const asciiToFelts = (str) => [...str].map((c) => BigInt(c.charCodeAt(0)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitWithTimeout(provider, txHash, ms) {
  const t0 = Date.now();

  while (Date.now() - t0 < ms) {
    try {
      const rc = await provider.getTransactionReceipt(txHash);
      if (rc && rc.finality_status) return rc;
    } catch (_) {}

    await sleep(2500);
  }

  return null;
}

(async function main() {
  const provider = new RpcProvider({ nodeUrl: STARKNET_RPC_URL });
  const account = new Account(provider, accountAddress, privateKey);
  const contract = new Contract(abiJson.abi, contractAddress, provider);

  contract.connect(account);

  console.log("[account]", accountAddress);
  console.log("[contract L2]", contractAddress);

  for (const total of BATCH_SIZES) {
    console.log(`\n=== Total batch ${total} (conc=${CONCURRENCY}) ===`);

    const t0 = Date.now();

    // 1) Fixed base nonce for the whole batch.
    const baseNonce = BigInt(await account.getNonce());
    console.log(`[baseNonce] ${baseNonce}`);

    // 2) Estimate the fee only once for the sub-batch.
    // This reduces latency and measurement jitter.
    const sampleCalldata = [
      evmToFelt(userEvmAddress),
      evmToFelt(contractMsgL1),
      5n,
      asciiToFelts(`${REVIEW_TEXT} #sample`),
    ];

    const est = await account.estimateInvokeFee({
      contractAddress,
      entrypoint: "leave_review",
      calldata: sampleCalldata,
    });

    const maxFee = BigInt(Math.ceil(Number(est.overall_fee) * FEE_BUFFER));
    console.log(`[fee] estimated=${est.overall_fee}  maxFeeWithBuffer=${maxFee}`);

    // 3) Logging setup.
    const lines = [];

    lines.push(`Batch size: ${total}`);
    lines.push(`Timestamp: ${new Date().toISOString()}`);
    lines.push(`Account: ${accountAddress}`);
    lines.push(`Concurrency: ${CONCURRENCY}`);
    lines.push(`FeeToken: ETH  (maxFee buffer ${Math.round((FEE_BUFFER - 1) * 100)}%)`);
    lines.push("tx_hash, status, block_number");

    const allResults = [];

    // 4) Sub-batches.
    const chunks = Math.ceil(total / CHUNK_SIZE);

    for (let c = 0; c < chunks; c++) {
      const chunkSize = Math.min(CHUNK_SIZE, total - c * CHUNK_SIZE);

      console.log(`\n--- Sub-batch ${c + 1}/${chunks} (size=${chunkSize}) ---`);

      let next = 0;
      let inFlight = 0;
      const workers = [];

      async function sendOne(idxInChunk) {
        const idxGlobal = c * CHUNK_SIZE + idxInChunk;
        const nonce = baseNonce + BigInt(idxGlobal);

        const calldata = [
          evmToFelt(userEvmAddress),
          evmToFelt(contractMsgL1),
          5n,
          asciiToFelts(`${REVIEW_TEXT} #${idxGlobal}`),
        ];

        try {
          // Submit transaction with no retry and no replacement.
          // This avoids "Invalid transaction nonce" issues.
          const tx = await contract.invoke("leave_review", calldata, {
            nonce,
            maxFee,
            feeToken: "ETH",
          });

          console.log(`  [sent #${idxGlobal}] ${tx.transaction_hash} (nonce=${nonce})`);

          // Wait for the transaction receipt.
          const rc = await waitWithTimeout(provider, tx.transaction_hash, TIMEOUT_MS);

          if (!rc) {
            allResults.push({
              txHash: tx.transaction_hash,
              status: "TIMEOUT",
              block: "",
            });
            return;
          }

          allResults.push({
            txHash: tx.transaction_hash,
            status: rc.finality_status,
            block: rc.block_number ?? "",
          });
        } catch (e) {
          const msg = e?.message ?? String(e);

          // If "Invalid transaction nonce" is received, it means that this nonce
          // was probably already accepted or replaced. Do not resend it.
          if (/Invalid transaction nonce/i.test(msg)) {
            console.warn(
              `  [note #${idxGlobal}] invalid nonce -> probably already accepted or duplicated`
            );

            allResults.push({
              txHash: "",
              status: "INVALID_NONCE",
              block: "",
            });

            return;
          }

          console.warn(`  [error #${idxGlobal}] ${msg}`);

          allResults.push({
            txHash: "",
            status: "ERROR",
            block: "",
          });
        }
      }

      async function runQueue() {
        while (next < chunkSize || inFlight > 0) {
          while (inFlight < CONCURRENCY && next < chunkSize) {
            inFlight++;

            const p = sendOne(next).finally(() => {
              inFlight--;
            });

            workers.push(p);
            next++;

            // Small pacing delay to avoid overloading the RPC.
            await sleep(SUBMIT_DELAY_MS);
          }

          await sleep(150);
        }

        await Promise.allSettled(workers);
      }

      await runQueue();

      console.log(`--- Sub-batch ${c + 1} completed ---`);
    }

    // 5) Block analysis.
    const ok = allResults.filter(
      (r) => r.status === "ACCEPTED_ON_L2" || r.status === "ACCEPTED_ON_L1"
    );

    const blocks = ok.map((r) => Number(r.block)).filter(Number.isFinite);
    const unique = Array.from(new Set(blocks)).sort((a, b) => a - b);
    const span = blocks.length ? Math.max(...blocks) - Math.min(...blocks) + 1 : 0;

    for (const r of allResults) {
      lines.push(`${r.txHash}, ${r.status}, ${r.block ?? ""}`);
    }

    lines.push("");
    lines.push(`Confirmed: ${ok.length}/${total}`);
    lines.push(`Unique L2 blocks: ${unique.length}, Span: ${span}`);

    for (const b of unique) {
      const count = blocks.filter((x) => x === b).length;
      lines.push(`  Block ${b}: ${count} tx`);
    }

    lines.push(`Batch duration (s): ${((Date.now() - t0) / 1000).toFixed(1)}`);

    const filename = path.resolve(`./batch_logs/l2_batch_${total}.txt`);

    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, lines.join("\n"));

    console.log(`-> Log: ${filename}`);
  }
})();