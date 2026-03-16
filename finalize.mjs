/**
 * finalize.mjs — Finalize BPFLoader2 program (mark as executable)
 * One transaction to make B4wwyzi7a7wNrZ3UbisfVJjE436yxuVToB1t5A66ttri executable
 */
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { readFileSync } from "fs";
import { homedir } from "os";

const RPC_URL = "https://api.devnet.solana.com";
const PROGRAM_ID = "B4wwyzi7a7wNrZ3UbisfVJjE436yxuVToB1t5A66ttri";
const BPF_LOADER_2 = new PublicKey("BPFLoader2111111111111111111111111111111111");

// BPFLoader2 FinalizeAccount instruction index = 1
function createFinalizeInstruction(programId, payer) {
  // BPFLoader2 Finalize instruction layout:
  // [0] = instruction index (u32 LE) = 1 (Finalize)
  const data = Buffer.alloc(4);
  data.writeUInt32LE(1, 0); // Finalize = 1

  return new TransactionInstruction({
    keys: [
      { pubkey: programId, isSigner: true, isWritable: true },
      { pubkey: new PublicKey("SysvarRent111111111111111111111111111111111"), isSigner: false, isWritable: false },
    ],
    programId: BPF_LOADER_2,
    data,
  });
}

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");

  // Load payer
  const payerJson = JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`, "utf8"));
  const payer = Keypair.fromSecretKey(Uint8Array.from(payerJson));
  console.log("Payer:", payer.publicKey.toBase58());

  // Load program keypair
  const programKpJson = JSON.parse(readFileSync("./target/deploy/subscription_billing-keypair.json", "utf8"));
  const programKeypair = Keypair.fromSecretKey(Uint8Array.from(programKpJson));
  console.log("Program ID:", programKeypair.publicKey.toBase58());

  // Verify program account state
  const accountInfo = await connection.getAccountInfo(programKeypair.publicKey);
  if (!accountInfo) {
    throw new Error("Program account does not exist!");
  }
  console.log(`Program account: ${accountInfo.lamports / 1e9} SOL, executable: ${accountInfo.executable}, data: ${accountInfo.data.length} bytes`);

  if (accountInfo.executable) {
    console.log("✅ Program is already executable! Program ID:", programKeypair.publicKey.toBase58());
    return;
  }

  // Check payer balance
  const balance = await connection.getBalance(payer.publicKey);
  console.log(`Payer balance: ${balance / 1e9} SOL`);

  if (balance < 10000) { // ~0.00001 SOL fee
    throw new Error("Insufficient balance for finalize transaction!");
  }

  console.log("Sending Finalize instruction...");
  
  const ix = createFinalizeInstruction(programKeypair.publicKey, payer.publicKey);
  const tx = new Transaction().add(ix);
  
  const sig = await sendAndConfirmTransaction(connection, tx, [payer, programKeypair], {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });

  console.log("\n✅ Program finalized successfully!");
  console.log("   Signature:", sig);
  console.log("   Program ID:", programKeypair.publicKey.toBase58());
  console.log("   Explorer: https://explorer.solana.com/address/" + programKeypair.publicKey.toBase58() + "?cluster=devnet");
  console.log("   Tx: https://explorer.solana.com/tx/" + sig + "?cluster=devnet");

  // Verify
  const finalInfo = await connection.getAccountInfo(programKeypair.publicKey);
  console.log(`   Executable: ${finalInfo?.executable}`);
}

main().catch(console.error);
