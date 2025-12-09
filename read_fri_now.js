import { RpcProvider } from "starknet";

const RPC = "https://starknet-mainnet.public.blastapi.io/rpc/v0_8";

const provider = new RpcProvider({ nodeUrl: RPC });

const main = async () => {
  // Con il nuovo metodo puoi leggere direttamente i prezzi di gas
  const block = await provider.getBlock("latest");
  console.log("Block number:", block.block_number);

  // Molti RPC mainnet v0.8 espongono i gas price in block_header → gas_prices
  const gp = block.l2_gas_price;
  if (!gp) {
    console.log("Questo nodo non espone gas_prices, serve fallback con estimateFee.");
    return;
  }

  console.log("L2 gas price (FRI):", gp);
};

main().catch(console.error);