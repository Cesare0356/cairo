// l2_leave_review.js (ESM) — pronto per starknet@7.x
import { Account, RpcProvider, Contract } from "starknet";
import * as dotenv from "dotenv";
import abiJson from "./abi.json" with { type: "json" };
dotenv.config();

const STARKNET_RPC_URL  = process.env.STARKNET_RPC_URL;
const accountAddress    = process.env.STARKNET_ACCOUNT_ADDRESS;   // account Starknet (contratto deployato su Sepolia)
const privateKey        = process.env.PRIVATE_KEY;                // chiave privata dell'account Starknet
const contractAddress   = process.env.L2_CONTRACT_ADDRESS;        // contratto Cairo con leave_review
const contractMsgL1     = process.env.CONTRACTMSG_ADDRESS;        // indirizzo L1 L1RestaurantGateway (EthAddress)
const userEvmAddress    = process.env.USER_EVM_ADDRESS;           // utente autorizzato dall'l1_handler (EthAddress)

if (!STARKNET_RPC_URL || !accountAddress || !privateKey || !contractAddress || !contractMsgL1 || !userEvmAddress) {
  throw new Error("Manca qualche variabile nel .env (serve: STARKNET_RPC_URL, STARKNET_ACCOUNT_ADDRESS, PRIVATE_KEY, L2_CONTRACT_ADDRESS, CONTRACTMSG_ADDRESS, USER_EVM_ADDRESS)");
}

// helpers
const evmToFelt    = (addr) => BigInt(addr);                  // 0x... -> felt
const asciiToFelts = (str)  => [...str].map(c => BigInt(c.charCodeAt(0)));  // "abc" -> [97,98,99]

(async function main() {
  // Provider + Account
  const provider = new RpcProvider({ nodeUrl: STARKNET_RPC_URL });
  const account  = new Account(provider, accountAddress, privateKey);

  // Contratto L2
  const l2 = new Contract(abiJson.abi, contractAddress, provider);
  l2.connect(account);

  // ---- calldata leave_review ----
  const user_address = evmToFelt(userEvmAddress);      // EthAddress (felt)
  const to_address   = evmToFelt(contractMsgL1);       // EthAddress (felt) — contract L1
  const rating       = 5n;                             // 1..5
  const textFelts = asciiToFelts("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  const calldata     = [ user_address, to_address, rating, textFelts ]; // <-- esattamente 4 argomenti

// -------- fee estimate --------
const feeEst = await account.estimateInvokeFee({
    contractAddress,
    entrypoint: "leave_review",
    calldata
  });
  
  console.log("=== STIMA ===");
  console.log("l1_gas_consumed     :", String(feeEst.l1_gas_consumed ?? 0));
  console.log("l1_data_gas_consumed:", String(feeEst.l1_data_gas_consumed ?? 0));
  console.log("l2_gas_consumed     :", String(feeEst.l2_gas_consumed ?? 0));
  const tx = await l2.invoke("leave_review", calldata);
  console.log("tx hash:", tx.transaction_hash);

  const receipt = await provider.waitForTransaction(tx.transaction_hash);

  console.log("leave_review completed");
})().catch((e) => { console.error(e); process.exit(1); });