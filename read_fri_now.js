import { RpcProvider } from "starknet";

const RPC = "https://starknet-mainnet.public.blastapi.io/rpc/v0_8";

const provider = new RpcProvider({ nodeUrl: RPC });
// reading actual FRI value
const main = async () => {
  const block = await provider.getBlock("latest");
  console.log("Block number:", block.block_number);

  const gp = block.l2_gas_price;
  if (!gp) {
    console.log("Questo nodo non espone gas_prices, serve fallback con estimateFee.");
    return;
  }

  console.log("L2 gas price (FRI):", gp);
};

main().catch(console.error);