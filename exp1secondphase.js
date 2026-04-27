import * as dotenv from "dotenv";
import { RpcProvider } from "starknet";
import fs from "fs";
import path from "path";

dotenv.config();

const STARKNET_RPC_URL = process.env.STARKNET_RPC_URL;
if (!STARKNET_RPC_URL) throw new Error("Missing STARKNET_RPC_URL in .env");

// Choose which files to process.
const SIZES = [16];

// Expected line format:
// 0x<tx_hash>, ACCEPTED_ON_L2|ACCEPTED_ON_L1, <block_number>
const LINE_RE = /^(0x[0-9a-fA-F]+),\s*(?:ACCEPTED_ON_L2|ACCEPTED_ON_L1),\s*([0-9]+)\s*$/;

function parseBatchFile(txt) {
  const rows = [];

  for (const ln of txt.split(/\r?\n/)) {
    const m = ln.match(LINE_RE);

    if (m) rows.push({ txHash: m[1], l2Block: Number(m[2]) });
  }

  return rows;
}

(async function main() {
  const provider = new RpcProvider({ nodeUrl: STARKNET_RPC_URL });

  for (const size of SIZES) {
    const inFile = path.resolve(`./batch_logs/l2_batch_${size}.txt`);
    const outFile = path.resolve(`./batch_logs/map_${size}.txt`);

    if (!fs.existsSync(inFile)) {
      console.warn(`(skip) missing ${inFile}`);
      continue;
    }

    const raw = fs.readFileSync(inFile, "utf-8");
    const rows = parseBatchFile(raw);

    if (rows.length === 0) continue;

    const out = [];

    out.push(`Batch size: ${size}`);
    out.push(`Timestamp: ${new Date().toISOString()}`);
    out.push(`Source file: l2_batch_${size}.txt`);
    out.push("");
    out.push("tx_hash, l2_block, l1_block, l1_tx_hash");

    for (let i = 0; i < rows.length; i++) {
      const { txHash, l2Block } = rows[i];

      process.stdout.write(`  [${i + 1}/${rows.length}] ${txHash.slice(0, 10)}… → `);

      try {
        const rc = await provider.getL1MessageHash(txHash);

        console.log(rc);

        const l1Block = rc.l1Block;
        const l1TxHash = rc.l1TxHash;

        if (l1Block || l1TxHash) {
          console.log(`L1#${l1Block || "-"}  ${l1TxHash || "-"}`);
        } else {
          console.log("no L1 field exposed by the RPC");
        }

        out.push([txHash, l2Block, l1Block, l1TxHash].join(", "));
      } catch (e) {
        console.log(`ERROR: ${e?.message ?? e}`);

        out.push([txHash, l2Block, "", ""].join(", "));
      }
    }

    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, out.join("\n"));

    console.log(`-> saved: ${outFile}`);
  }
})().catch((e) => {
  console.error("[fatal]", e?.message ?? e);
  process.exit(1);
});