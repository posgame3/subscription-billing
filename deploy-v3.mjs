/**
 * deploy-v3.mjs — Deploy using BPFLoaderUpgradeable (correct Borsh encoding)
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  SYSVAR_RENT_PUBKEY,
  SYSVAR_CLOCK_PUBKEY,
} from "@solana/web3.js";
import { readFileSync } from "fs";
import { homedir } from "os";

const RPC_URL = "https://api.devnet.solana.com";
const SO_PATH = "./target/deploy/subscription_billing.so";
const PROGRAM_KEYPAIR_PATH = "./target/deploy/subscription_billing-keypair.json";
const BPF_UPGRADEABLE_LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const CHUNK_SIZE = 900;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Borsh-encoded instructions for BPFLoaderUpgradeable
function encodeInitializeBuffer(authority) {
  // variant: 0 (u32 LE), no extra fields
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(0, 0);
  return buf;
}

function encodeWrite(offset, data) {
  // bincode encoding: variant(u32) + offset(u32) + bytes.len(u64) + bytes
  const buf = Buffer.alloc(4 + 4 + 8 + data.length);
  buf.writeUInt32LE(1, 0);                        // variant = 1
  buf.writeUInt32LE(offset, 4);                   // offset: u32
  buf.writeBigUInt64LE(BigInt(data.length), 8);   // Vec<u8> len: u64
  data.copy(buf, 16);
  return buf;
}

function encodeDeployWithMaxDataLen(maxDataLen) {
  // variant: 2, max_data_len: u64
  const buf = Buffer.alloc(4 + 8);
  buf.writeUInt32LE(2, 0);
  buf.writeBigUInt64LE(BigInt(maxDataLen), 4);
  return buf;
}

async function sendWithRetry(connection, tx, signers, opts = {}, retries = 5) {
  for (let i = 0; i < retries; i++) {
    try {
      return await sendAndConfirmTransaction(connection, tx, signers, {
        commitment: "confirmed",
        skipPreflight: true,
        ...opts,
      });
    } catch (e) {
      if (i === retries - 1) throw e;
      console.log(`  Retry ${i + 1}/${retries}: ${e.message?.slice(0, 60)}`);
      await sleep(2000);
    }
  }
}

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");

  const payerJson = JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`, "utf8"));
  const payer = Keypair.fromSecretKey(Uint8Array.from(payerJson));
  console.log("Payer:     ", payer.publicKey.toBase58());

  // Use the fixed program keypair (declare_id must match)
  const programKpJson = JSON.parse(readFileSync(PROGRAM_KEYPAIR_PATH, "utf8"));
  const programKeypair = Keypair.fromSecretKey(Uint8Array.from(programKpJson));
  console.log("Program ID:", programKeypair.publicKey.toBase58());

  const balance = await connection.getBalance(payer.publicKey);
  console.log("Balance:   ", balance / LAMPORTS_PER_SOL, "SOL");

  const programData = readFileSync(SO_PATH);
  console.log("Program:   ", programData.length, "bytes");

  // Buffer = programData.length + 48 bytes overhead
  const bufferSize = programData.length + 48;
  const bufferRent = await connection.getMinimumBalanceForRentExemption(bufferSize);
  console.log("Buffer rent:", bufferRent / LAMPORTS_PER_SOL, "SOL");

  // ── Step 1: Create + Initialize Buffer ───────────────────────────────────
  console.log("\n[1/3] Creating buffer...");
  const bufferKeypair = Keypair.generate();
  console.log("Buffer:    ", bufferKeypair.publicKey.toBase58());

  const createBufTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: bufferKeypair.publicKey,
      lamports: bufferRent,
      space: bufferSize,
      programId: BPF_UPGRADEABLE_LOADER,
    }),
    new TransactionInstruction({
      programId: BPF_UPGRADEABLE_LOADER,
      keys: [
        { pubkey: bufferKeypair.publicKey, isSigner: false, isWritable: true },
        { pubkey: payer.publicKey, isSigner: true, isWritable: false },
      ],
      data: encodeInitializeBuffer(),
    })
  );

  await sendWithRetry(connection, createBufTx, [payer, bufferKeypair]);
  console.log("  ✅ Buffer created & initialized");

  // ── Step 2: Write chunks ───────────────────────────────────────────────
  const totalChunks = Math.ceil(programData.length / CHUNK_SIZE);
  console.log(`\n[2/3] Writing ${programData.length} bytes in ${totalChunks} chunks...`);

  let offset = 0;
  let chunk = 0;
  while (offset < programData.length) {
    const slice = programData.slice(offset, offset + CHUNK_SIZE);
    const writeTx = new Transaction().add(
      new TransactionInstruction({
        programId: BPF_UPGRADEABLE_LOADER,
        keys: [
          { pubkey: bufferKeypair.publicKey, isSigner: false, isWritable: true },
          { pubkey: payer.publicKey, isSigner: true, isWritable: false },
        ],
        data: encodeWrite(offset, slice),
      })
    );

    await sendWithRetry(connection, writeTx, [payer]);
    offset += slice.length;
    chunk++;

    if (chunk % 50 === 0 || offset >= programData.length) {
      const pct = Math.round((offset / programData.length) * 100);
      console.log(`  ${pct}% — ${chunk}/${totalChunks} chunks (${offset}/${programData.length} bytes)`);
    }
  }
  console.log("  ✅ All data written");

  // ── Step 3: Deploy ─────────────────────────────────────────────────────
  console.log("\n[3/3] Deploying program...");

  const [programDataPDA] = PublicKey.findProgramAddressSync(
    [programKeypair.publicKey.toBuffer()],
    BPF_UPGRADEABLE_LOADER
  );
  console.log("ProgramData PDA:", programDataPDA.toBase58());

  const programRent = await connection.getMinimumBalanceForRentExemption(36);

  const deployTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: programKeypair.publicKey,
      lamports: programRent,
      space: 36,
      programId: BPF_UPGRADEABLE_LOADER,
    }),
    new TransactionInstruction({
      programId: BPF_UPGRADEABLE_LOADER,
      keys: [
        { pubkey: payer.publicKey,           isSigner: true,  isWritable: true  },
        { pubkey: programDataPDA,            isSigner: false, isWritable: true  },
        { pubkey: programKeypair.publicKey,  isSigner: true,  isWritable: true  },
        { pubkey: bufferKeypair.publicKey,   isSigner: false, isWritable: true  },
        { pubkey: SYSVAR_RENT_PUBKEY,        isSigner: false, isWritable: false },
        { pubkey: SYSVAR_CLOCK_PUBKEY,       isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId,   isSigner: false, isWritable: false },
        { pubkey: payer.publicKey,           isSigner: true,  isWritable: false }, // upgrade authority
      ],
      data: encodeDeployWithMaxDataLen(programData.length + 1024), // +1KB headroom for future upgrades
    })
  );

  const sig = await sendWithRetry(connection, deployTx, [payer, programKeypair]);

  // Verify
  const info = await connection.getAccountInfo(programKeypair.publicKey);
  console.log("\n✅ Program deployed!");
  console.log("   Program ID:  ", programKeypair.publicKey.toBase58());
  console.log("   Executable:  ", info?.executable);
  console.log("   Deploy TX:   ", sig);
  console.log("   Explorer:     https://explorer.solana.com/address/" + programKeypair.publicKey.toBase58() + "?cluster=devnet");
  console.log("   TX Link:      https://explorer.solana.com/tx/" + sig + "?cluster=devnet");
}

main().catch(e => { console.error("FATAL:", e.message || e); process.exit(1); });
