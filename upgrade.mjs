/**
 * upgrade.mjs — Upgrade existing BPFLoaderUpgradeable program in-place
 */
import {
  Connection, Keypair, PublicKey, Transaction, TransactionInstruction,
  SystemProgram, SYSVAR_RENT_PUBKEY, SYSVAR_CLOCK_PUBKEY
} from "@solana/web3.js";
import { readFileSync } from "fs";

const RPC = "https://api.devnet.solana.com";
const PROGRAM_ID   = new PublicKey("CHiGNDhvm7KCL3216YqajQMf82h2HUJo9hTPgksbGCZB");
const BPF_LOADER   = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const CHUNK_SIZE   = 900;
const MAX_RETRIES  = 8;

const payer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync("/home/kali/.config/solana/id.json")))
);

function encodeU32LE(n) {
  const b = Buffer.alloc(4); b.writeUInt32LE(n); return b;
}
function encodeU64LE(n) {
  const b = Buffer.alloc(8); new DataView(b.buffer).setBigUint64(0, BigInt(n), true); return b;
}

// WriteBuffer instruction (tag = 1)
function encodeWrite(offset, bytes) {
  return Buffer.concat([
    encodeU32LE(1), // Write
    encodeU32LE(offset),
    encodeU32LE(bytes.length),
    bytes
  ]);
}
// DeployWithMaxDataLen instruction (tag = 2) — used for Upgrade too as tag 3
// Upgrade instruction (tag = 3)
function encodeUpgrade() {
  return encodeU32LE(3); // Upgrade
}

async function sendWithRetry(conn, tx, signers) {
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;
      tx.feePayer = payer.publicKey;
      tx.sign(...signers);
      const raw = tx.serialize();
      const sig = await conn.sendRawTransaction(raw, { skipPreflight: false });
      await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
      return sig;
    } catch (e) {
      if (i === MAX_RETRIES - 1) throw e;
      const delay = 500 * Math.pow(2, i);
      if (e.message?.includes("429") || e.message?.includes("Too Many")) {
        console.log(`  Server responded with 429 Too Many Requests. Retrying after ${delay}ms delay...`);
      } else {
        console.log(`  Retry ${i+1}/${MAX_RETRIES}: ${e.message?.slice(0,60)}`);
      }
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

async function main() {
  const connection = new Connection(RPC, "confirmed");
  const programData = readFileSync("./target/deploy/subscription_billing.so");

  const balance = await connection.getBalance(payer.publicKey);
  console.log("Payer:     ", payer.publicKey.toBase58());
  console.log("Program:   ", PROGRAM_ID.toBase58());
  console.log("Balance:   ", (balance / 1e9).toFixed(5), "SOL");
  console.log("New SO:    ", programData.length, "bytes");

  // Derive ProgramData PDA
  const [programDataPDA] = PublicKey.findProgramAddressSync([PROGRAM_ID.toBuffer()], BPF_LOADER);

  // Check existing programdata size
  const pdInfo = await connection.getAccountInfo(programDataPDA);
  const existingDataLen = pdInfo ? pdInfo.data.length - 45 : 0;
  console.log("Existing programdata space:", existingDataLen, "bytes");

  // Create buffer
  const bufferKeypair = Keypair.generate();
  const bufferSize = 45 + programData.length; // metadata header + bytecode
  const bufferRent = await connection.getMinimumBalanceForRentExemption(bufferSize);

  console.log("\n[1/3] Creating buffer...");
  const createBufTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: bufferKeypair.publicKey,
      lamports: bufferRent,
      space: bufferSize,
      programId: BPF_LOADER,
    }),
    new TransactionInstruction({
      programId: BPF_LOADER,
      keys: [
        { pubkey: bufferKeypair.publicKey, isSigner: false, isWritable: true },
        { pubkey: payer.publicKey,         isSigner: true,  isWritable: false },
      ],
      data: Buffer.concat([encodeU32LE(0), payer.publicKey.toBuffer()]) // InitializeBuffer
    })
  );
  await sendWithRetry(connection, createBufTx, [payer, bufferKeypair]);
  console.log("  ✅ Buffer:", bufferKeypair.publicKey.toBase58());

  // Write data in chunks
  console.log(`\n[2/3] Writing ${programData.length} bytes...`);
  const chunks = Math.ceil(programData.length / CHUNK_SIZE);
  for (let i = 0; i < chunks; i++) {
    const start = i * CHUNK_SIZE;
    const chunk = programData.slice(start, start + CHUNK_SIZE);
    const writeTx = new Transaction().add(
      new TransactionInstruction({
        programId: BPF_LOADER,
        keys: [
          { pubkey: bufferKeypair.publicKey, isSigner: false, isWritable: true },
          { pubkey: payer.publicKey,          isSigner: true,  isWritable: false },
        ],
        data: encodeWrite(start, chunk),
      })
    );
    await sendWithRetry(connection, writeTx, [payer]);
    if ((i + 1) % 50 === 0 || i === chunks - 1) {
      console.log(`  ${Math.round(((i+1)/chunks)*100)}% — ${i+1}/${chunks}`);
    }
  }
  console.log("  ✅ All data written");

  // Upgrade
  console.log("\n[3/3] Upgrading program...");
  const upgradeTx = new Transaction().add(
    new TransactionInstruction({
      programId: BPF_LOADER,
      keys: [
        { pubkey: programDataPDA,            isSigner: false, isWritable: true  },
        { pubkey: PROGRAM_ID,                isSigner: false, isWritable: true  },
        { pubkey: bufferKeypair.publicKey,   isSigner: false, isWritable: true  },
        { pubkey: payer.publicKey,           isSigner: false, isWritable: true  }, // spill (reclaim buffer rent)
        { pubkey: SYSVAR_RENT_PUBKEY,        isSigner: false, isWritable: false },
        { pubkey: SYSVAR_CLOCK_PUBKEY,       isSigner: false, isWritable: false },
        { pubkey: payer.publicKey,           isSigner: true,  isWritable: false }, // upgrade authority
      ],
      data: encodeUpgrade(),
    })
  );
  const sig = await sendWithRetry(connection, upgradeTx, [payer]);

  console.log("\n✅ Program upgraded!");
  console.log("   TX: https://explorer.solana.com/tx/" + sig + "?cluster=devnet");
}

main().catch(e => { console.error("FATAL:", e.message || e); process.exit(1); });
