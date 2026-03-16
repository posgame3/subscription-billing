/**
 * deploy.mjs — Deploy subscription_billing.so to Solana Devnet
 * Uses @solana/web3.js program loader (BPFLoader2)
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { readFileSync } from "fs";
import { homedir } from "os";

const RPC_URL = "https://api.devnet.solana.com";
const SO_PATH = "./target/deploy/subscription_billing.so";
const PROGRAM_KEYPAIR_PATH = "./target/deploy/subscription_billing-keypair.json";

// BPF Loader v2 program ID
const BPF_LOADER_2 = new PublicKey("BPFLoader2111111111111111111111111111111111");

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");

  // Load or create payer keypair
  let payer;
  try {
    const payerJson = JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`, "utf8"));
    payer = Keypair.fromSecretKey(Uint8Array.from(payerJson));
  } catch {
    payer = Keypair.generate();
    console.log("Generated payer:", payer.publicKey.toBase58());
    // Save keypair
    const { writeFileSync, mkdirSync } = await import("fs");
    mkdirSync(`${homedir()}/.config/solana`, { recursive: true });
    writeFileSync(
      `${homedir()}/.config/solana/id.json`,
      JSON.stringify(Array.from(payer.secretKey))
    );
  }

  console.log("Payer:", payer.publicKey.toBase58());

  // Load program keypair
  const programKpJson = JSON.parse(readFileSync(PROGRAM_KEYPAIR_PATH, "utf8"));
  const programKeypair = Keypair.fromSecretKey(Uint8Array.from(programKpJson));
  console.log("Program ID:", programKeypair.publicKey.toBase58());

  // Check balance & airdrop if needed
  let balance = await connection.getBalance(payer.publicKey);
  console.log("Balance:", balance / LAMPORTS_PER_SOL, "SOL");

  if (balance < 3 * LAMPORTS_PER_SOL) {
    console.log("Requesting airdrop...");
    const sig = await connection.requestAirdrop(payer.publicKey, 3 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, "confirmed");
    balance = await connection.getBalance(payer.publicKey);
    console.log("After airdrop:", balance / LAMPORTS_PER_SOL, "SOL");
  }

  // Load the .so binary
  const programData = readFileSync(SO_PATH);
  console.log("Program size:", programData.length, "bytes");

  // Use the high-level BpfLoader.load API
  const { BpfLoader, BPF_LOADER_PROGRAM_ID } = await import("@solana/web3.js");

  console.log("Deploying program...");
  const programId = await BpfLoader.load(
    connection,
    payer,
    programKeypair,
    programData,
    BPF_LOADER_PROGRAM_ID
  );

  console.log("\n✅ Program deployed successfully!");
  console.log("   Program ID:", programId.toBase58());
  console.log("   Explorer: https://explorer.solana.com/address/" + programId.toBase58() + "?cluster=devnet");
}

main().catch(console.error);
