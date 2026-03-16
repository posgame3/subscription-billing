/**
 * deploy-v2.mjs — Deploy using BPF Upgradeable Loader (current Solana standard)
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

// BPF Upgradeable Loader
const BPF_UPGRADEABLE_LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

// Chunk size for writing program data (1232 bytes to stay under transaction limit)
const CHUNK_SIZE = 900;

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");

  // Load payer
  const payerJson = JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`, "utf8"));
  const payer = Keypair.fromSecretKey(Uint8Array.from(payerJson));
  console.log("Payer:", payer.publicKey.toBase58());

  // Load program keypair
  const programKpJson = JSON.parse(readFileSync(PROGRAM_KEYPAIR_PATH, "utf8"));
  const programKeypair = Keypair.fromSecretKey(Uint8Array.from(programKpJson));
  console.log("Program ID:", programKeypair.publicKey.toBase58());

  const balance = await connection.getBalance(payer.publicKey);
  console.log("Balance:", balance / LAMPORTS_PER_SOL, "SOL");

  const programData = readFileSync(SO_PATH);
  console.log("Program size:", programData.length, "bytes");

  // Calculate rent for buffer
  const bufferRent = await connection.getMinimumBalanceForRentExemption(
    programData.length + 48 // 48 bytes overhead for UpgradeableLoaderState::Buffer
  );
  console.log("Buffer rent:", bufferRent / LAMPORTS_PER_SOL, "SOL");

  // Create buffer keypair
  const bufferKeypair = Keypair.generate();
  console.log("Buffer:", bufferKeypair.publicKey.toBase58());

  // === Step 1: Create buffer account ===
  console.log("\n[1/3] Creating buffer account...");
  const initBufferIx = new TransactionInstruction({
    programId: BPF_UPGRADEABLE_LOADER,
    keys: [
      { pubkey: bufferKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      Buffer.from([0, 0, 0, 0]), // InitializeBuffer instruction (0)
      Buffer.alloc(4), // padding
    ]),
  });

  // Use SystemProgram to create the buffer account first
  const createBufferAccountTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: bufferKeypair.publicKey,
      lamports: bufferRent,
      space: programData.length + 48,
      programId: BPF_UPGRADEABLE_LOADER,
    })
  );

  await sendAndConfirmTransaction(connection, createBufferAccountTx, [payer, bufferKeypair], {
    commitment: "confirmed",
    skipPreflight: false,
  });
  console.log("  Buffer account created");

  // Initialize the buffer
  const initData = Buffer.alloc(4 + 32);
  initData.writeUInt32LE(0, 0); // InitializeBuffer = 0
  payer.publicKey.toBuffer().copy(initData, 4);

  const initIx = new TransactionInstruction({
    programId: BPF_UPGRADEABLE_LOADER,
    keys: [
      { pubkey: bufferKeypair.publicKey, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: false },
    ],
    data: initData,
  });

  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(initIx),
    [payer],
    { commitment: "confirmed" }
  );
  console.log("  Buffer initialized");

  // === Step 2: Write program data in chunks ===
  console.log(`\n[2/3] Writing ${programData.length} bytes in ${Math.ceil(programData.length / CHUNK_SIZE)} chunks...`);
  
  let offset = 0;
  let chunkNum = 0;
  while (offset < programData.length) {
    const chunk = programData.slice(offset, offset + CHUNK_SIZE);
    
    // Write instruction: tag(4) + offset(4) + data
    const writeData = Buffer.alloc(4 + 4 + chunk.length);
    writeData.writeUInt32LE(1, 0); // Write = 1
    writeData.writeUInt32LE(offset, 4);
    chunk.copy(writeData, 8);

    const writeIx = new TransactionInstruction({
      programId: BPF_UPGRADEABLE_LOADER,
      keys: [
        { pubkey: bufferKeypair.publicKey, isSigner: false, isWritable: true },
        { pubkey: payer.publicKey, isSigner: true, isWritable: false },
      ],
      data: writeData,
    });

    let retries = 3;
    while (retries > 0) {
      try {
        await sendAndConfirmTransaction(
          connection,
          new Transaction().add(writeIx),
          [payer],
          { commitment: "confirmed", skipPreflight: true }
        );
        break;
      } catch (e) {
        retries--;
        if (retries === 0) throw e;
        await sleep(1000);
      }
    }

    offset += chunk.length;
    chunkNum++;
    if (chunkNum % 50 === 0) {
      const pct = Math.round((offset / programData.length) * 100);
      console.log(`  ${pct}% (${offset}/${programData.length} bytes)`);
    }
  }
  console.log("  All chunks written!");

  // === Step 3: Deploy program from buffer ===
  console.log("\n[3/3] Deploying program...");

  // Check if program account exists
  const programAccount = await connection.getAccountInfo(programKeypair.publicKey);
  
  const programRent = await connection.getMinimumBalanceForRentExemption(
    36 // UpgradeableLoaderState::Program size
  );

  let deployTx;
  if (!programAccount) {
    // Fresh deploy
    const deployData = Buffer.alloc(4 + 8);
    deployData.writeUInt32LE(2, 0); // DeployWithMaxDataLen = 2
    deployData.writeBigUInt64LE(BigInt(programData.length * 2), 4); // max_data_len

    const [programDataPDA] = await PublicKey.findProgramAddress(
      [programKeypair.publicKey.toBuffer()],
      BPF_UPGRADEABLE_LOADER
    );

    const deployIx = new TransactionInstruction({
      programId: BPF_UPGRADEABLE_LOADER,
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: programDataPDA, isSigner: false, isWritable: true },
        { pubkey: programKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: bufferKeypair.publicKey, isSigner: false, isWritable: true },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: deployData,
    });

    deployTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: programKeypair.publicKey,
        lamports: programRent,
        space: 36,
        programId: BPF_UPGRADEABLE_LOADER,
      }),
      deployIx
    );

    const sig = await sendAndConfirmTransaction(
      connection,
      deployTx,
      [payer, programKeypair],
      { commitment: "confirmed" }
    );
    console.log("\n✅ Program deployed successfully!");
    console.log("   Program ID:", programKeypair.publicKey.toBase58());
    console.log("   Deploy TX:", sig);
    console.log("   Explorer: https://explorer.solana.com/address/" + programKeypair.publicKey.toBase58() + "?cluster=devnet");
    console.log("   TX Link:  https://explorer.solana.com/tx/" + sig + "?cluster=devnet");
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
