/**
 * demo.mjs — Live devnet demo of the Subscription Billing System
 * Creates a registry, plan, subscribes, renews, cancels — shows TX links
 */
import * as anchor from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { readFileSync } from "fs";
import { homedir } from "os";

const PROGRAM_ID = new PublicKey("CHiGNDhvm7KCL3216YqajQMf82h2HUJo9hTPgksbGCZB");
const RPC = "https://api.devnet.solana.com";

function explorer(sig) {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}
function bytes32(s) {
  const buf = Buffer.alloc(32);
  Buffer.from(s.substring(0, 32), "utf8").copy(buf);
  return Array.from(buf);
}

async function airdropIfNeeded(conn, payer, pk, minSol = 0.5) {
  const bal = await conn.getBalance(pk);
  if (bal < minSol * LAMPORTS_PER_SOL) {
    // Transfer from payer instead of using faucet (faucet rate-limited)
    const { Transaction, SystemProgram } = await import("@solana/web3.js");
    const tx = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: pk, lamports: 0.5 * LAMPORTS_PER_SOL })
    );
    const sig = await anchor.web3.sendAndConfirmTransaction(conn, tx, [payer], { commitment: "confirmed" });
    console.log("  Funded subscriber:", sig.slice(0, 20) + "...");
  }
}

async function main() {
  const connection = new anchor.web3.Connection(RPC, "confirmed");

  // Load payer
  const payerJson = JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`, "utf8"));
  const authority = Keypair.fromSecretKey(Uint8Array.from(payerJson));
  const subscriber = Keypair.generate();

  console.log("Authority:  ", authority.publicKey.toBase58());
  console.log("Subscriber: ", subscriber.publicKey.toBase58());

  await airdropIfNeeded(connection, authority, subscriber.publicKey, 0.5);

  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(authority),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const idl = JSON.parse(readFileSync("./target/idl/subscription_billing.json", "utf8"));
  const program = new anchor.Program(idl, PROGRAM_ID, provider);

  // ── PDAs ─────────────────────────────────────────────────────────────────
  const [registryPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("registry"), authority.publicKey.toBuffer()],
    PROGRAM_ID
  );
  const planIdBuf = Buffer.alloc(8); planIdBuf.writeBigUInt64LE(0n);
  const [planPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("plan"), registryPDA.toBuffer(), planIdBuf],
    PROGRAM_ID
  );
  const [subPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("subscription"), planPDA.toBuffer(), subscriber.publicKey.toBuffer()],
    PROGRAM_ID
  );
  const [payPDA0] = PublicKey.findProgramAddressSync(
    [Buffer.from("payment"), subPDA.toBuffer(), Buffer.from([0, 0, 0, 0])],
    PROGRAM_ID
  );
  const [payPDA1] = PublicKey.findProgramAddressSync(
    [Buffer.from("payment"), subPDA.toBuffer(), Buffer.from([1, 0, 0, 0])],
    PROGRAM_ID
  );

  console.log("\n📋 PDAs:");
  console.log("  Registry: ", registryPDA.toBase58());
  console.log("  Plan:     ", planPDA.toBase58());
  console.log("  Sub:      ", subPDA.toBase58());

  const txLinks = [];

  // ── 1. Initialize Registry ───────────────────────────────────────────────
  let sig;
  try {
    sig = await program.methods.initializeRegistry(new anchor.BN(3600)) // 1hr grace
      .accounts({ registry: registryPDA, authority: authority.publicKey, systemProgram: SystemProgram.programId })
      .rpc({ commitment: "confirmed" });
    txLinks.push({ action: "initialize_registry", sig });
    console.log("\n✅ 1. initialize_registry →", explorer(sig));
  } catch (e) {
    console.log("  (registry exists, skipping)");
  }

  // ── 2. Create Plan ───────────────────────────────────────────────────────
  try {
    sig = await program.methods.createPlan(bytes32("Pro Plan"), new anchor.BN(10_000_000), new anchor.BN(2592000), 1000)
      .accounts({ registry: registryPDA, plan: planPDA, authority: authority.publicKey, systemProgram: SystemProgram.programId })
      .rpc({ commitment: "confirmed" });
    txLinks.push({ action: "create_plan", sig });
    console.log("✅ 2. create_plan (Pro Plan, 0.01 SOL/month) →", explorer(sig));
  } catch (e) {
    console.log("  (plan exists, skipping)");
  }

  // ── 3. Subscribe ────────────────────────────────────────────────────────
  const subProvider = new anchor.AnchorProvider(connection, new anchor.Wallet(subscriber), { commitment: "confirmed" });
  const subProgram = new anchor.Program(idl, PROGRAM_ID, subProvider);

  sig = await subProgram.methods.subscribe()
    .accounts({ registry: registryPDA, plan: planPDA, subscription: subPDA, payment: payPDA0, subscriber: subscriber.publicKey, systemProgram: SystemProgram.programId })
    .rpc({ commitment: "confirmed" });
  txLinks.push({ action: "subscribe", sig });
  console.log("✅ 3. subscribe →", explorer(sig));

  const subAccount = await program.account.subscription.fetch(subPDA);
  console.log("     Status:", subAccount.status, "| Period end:", new Date(subAccount.currentPeriodEnd.toNumber() * 1000).toISOString());

  // ── 4. Renew ────────────────────────────────────────────────────────────
  sig = await subProgram.methods.renew()
    .accounts({ registry: registryPDA, plan: planPDA, subscription: subPDA, payment: payPDA1, subscriber: subscriber.publicKey, systemProgram: SystemProgram.programId })
    .rpc({ commitment: "confirmed" });
  txLinks.push({ action: "renew", sig });
  console.log("✅ 4. renew →", explorer(sig));

  // ── 5. Cancel ────────────────────────────────────────────────────────────
  sig = await subProgram.methods.cancel()
    .accounts({ plan: planPDA, subscription: subPDA, subscriber: subscriber.publicKey })
    .rpc({ commitment: "confirmed" });
  txLinks.push({ action: "cancel", sig });
  console.log("✅ 5. cancel →", explorer(sig));

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log("\n" + "─".repeat(60));
  console.log("📊 LIVE DEVNET DEMO TRANSACTIONS");
  console.log("─".repeat(60));
  for (const { action, sig } of txLinks) {
    console.log(`| ${action.padEnd(22)} | ${sig.slice(0, 20)}... |`);
    console.log(`  ${explorer(sig)}`);
  }
  console.log("─".repeat(60));
  console.log("\nProgram ID:", PROGRAM_ID.toBase58());
  console.log("Explorer: https://explorer.solana.com/address/" + PROGRAM_ID.toBase58() + "?cluster=devnet");
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
