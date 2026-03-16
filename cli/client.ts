import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { SubscriptionBilling } from "../target/types/subscription_billing";
import * as readline from "readline";

/**
 * CLI client for the On-Chain Subscription Billing System
 *
 * Usage:
 *   npx ts-node cli/client.ts <command> [args]
 *
 * Commands:
 *   init-registry [grace_seconds]
 *   create-plan <name> <price_sol> <period_seconds>
 *   subscribe <plan_id>
 *   renew <plan_id>
 *   cancel <plan_id>
 *   status <plan_id> <subscriber_pubkey>
 *   tick <plan_id> <subscriber_pubkey>
 */

const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);
const program = anchor.workspace.SubscriptionBilling as Program<SubscriptionBilling>;

function bytes32(s: string): number[] {
  const buf = Buffer.alloc(32);
  Buffer.from(s.substring(0, 32), "utf8").copy(buf);
  return Array.from(buf);
}

function findRegistry(authority: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("registry"), authority.toBuffer()],
    program.programId
  );
}

function findPlan(registry: PublicKey, planId: number) {
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(BigInt(planId));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("plan"), registry.toBuffer(), idBuf],
    program.programId
  );
}

function findSubscription(plan: PublicKey, subscriber: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("subscription"), plan.toBuffer(), subscriber.toBuffer()],
    program.programId
  );
}

function findPayment(subscription: PublicKey, paymentId: number) {
  const idBuf = Buffer.alloc(4);
  idBuf.writeUInt32LE(paymentId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("payment"), subscription.toBuffer(), idBuf],
    program.programId
  );
}

function statusLabel(s: unknown): string {
  const key = Object.keys(s as Record<string, unknown>)[0];
  const labels: Record<string, string> = {
    active: "🟢 Active",
    gracePeriod: "🟡 Grace Period",
    expired: "🔴 Expired",
    cancelled: "⛔ Cancelled",
  };
  return labels[key] ?? key;
}

async function main() {
  const [, , cmd, ...args] = process.argv;
  const signer = provider.wallet as anchor.Wallet;

  switch (cmd) {
    case "init-registry": {
      const grace = Number(args[0] ?? 86400);
      const [registryPDA] = findRegistry(signer.publicKey);
      const sig = await program.methods
        .initializeRegistry(new anchor.BN(grace))
        .accounts({
          registry: registryPDA,
          authority: signer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log("✅ Registry created:", registryPDA.toBase58());
      console.log("   TX:", sig);
      break;
    }

    case "create-plan": {
      const [name, priceSol, periodSec] = args;
      const priceLamports = Math.round(parseFloat(priceSol) * LAMPORTS_PER_SOL);
      const [registryPDA] = findRegistry(signer.publicKey);
      const registry = await program.account.serviceRegistry.fetch(registryPDA);
      const planId = registry.planCount.toNumber();
      const [planPDA] = findPlan(registryPDA, planId);

      const sig = await program.methods
        .createPlan(bytes32(name), new anchor.BN(priceLamports), new anchor.BN(Number(periodSec)), 0)
        .accounts({
          registry: registryPDA,
          plan: planPDA,
          authority: signer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log(`✅ Plan[${planId}] created:`, planPDA.toBase58());
      console.log("   Name:", name, "| Price:", priceSol, "SOL | Period:", periodSec, "s");
      console.log("   TX:", sig);
      break;
    }

    case "subscribe": {
      const planId = Number(args[0]);
      const [registryPDA] = findRegistry(signer.publicKey);
      const [planPDA] = findPlan(registryPDA, planId);
      const [subPDA] = findSubscription(planPDA, signer.publicKey);
      const [payPDA] = findPayment(subPDA, 0);

      const sig = await program.methods
        .subscribe()
        .accounts({
          registry: registryPDA,
          plan: planPDA,
          subscription: subPDA,
          payment: payPDA,
          subscriber: signer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log("✅ Subscribed! Sub PDA:", subPDA.toBase58());
      console.log("   TX:", sig);
      break;
    }

    case "renew": {
      const planId = Number(args[0]);
      const [registryPDA] = findRegistry(signer.publicKey);
      const [planPDA] = findPlan(registryPDA, planId);
      const [subPDA] = findSubscription(planPDA, signer.publicKey);
      const sub = await program.account.subscription.fetch(subPDA);
      const [payPDA] = findPayment(subPDA, sub.paymentCount);

      const sig = await program.methods
        .renew()
        .accounts({
          registry: registryPDA,
          plan: planPDA,
          subscription: subPDA,
          payment: payPDA,
          subscriber: signer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log("✅ Renewed! Renewal #", sub.renewalCount + 1);
      console.log("   TX:", sig);
      break;
    }

    case "cancel": {
      const planId = Number(args[0]);
      const [registryPDA] = findRegistry(signer.publicKey);
      const [planPDA] = findPlan(registryPDA, planId);
      const [subPDA] = findSubscription(planPDA, signer.publicKey);

      const sig = await program.methods
        .cancel()
        .accounts({
          subscription: subPDA,
          plan: planPDA,
          subscriber: signer.publicKey,
        })
        .rpc();
      console.log("✅ Subscription cancelled. TX:", sig);
      break;
    }

    case "status": {
      const planId = Number(args[0]);
      const subscriberKey = new PublicKey(args[1] ?? signer.publicKey.toBase58());
      const [registryPDA] = findRegistry(signer.publicKey);
      const [planPDA] = findPlan(registryPDA, planId);
      const [subPDA] = findSubscription(planPDA, subscriberKey);

      const sub = await program.account.subscription.fetch(subPDA);
      const plan = await program.account.subscriptionPlan.fetch(planPDA);
      const name = Buffer.from(plan.name).toString("utf8").replace(/\0/g, "");

      console.log("📋 Subscription Status");
      console.log("   Plan:          ", name, `[${planId}]`);
      console.log("   Subscriber:    ", subscriberKey.toBase58());
      console.log("   Status:        ", statusLabel(sub.status));
      console.log("   Period Start:  ", new Date(sub.currentPeriodStart.toNumber() * 1000).toISOString());
      console.log("   Period End:    ", new Date(sub.currentPeriodEnd.toNumber() * 1000).toISOString());
      console.log("   Renewals:      ", sub.renewalCount);
      console.log("   Total Payments:", sub.paymentCount);
      break;
    }

    default:
      console.log(`
On-Chain Subscription Billing — CLI

Commands:
  init-registry [grace_seconds]           Initialize your service registry
  create-plan <name> <price_SOL> <secs>   Add a billing plan
  subscribe <plan_id>                     Subscribe to a plan
  renew <plan_id>                         Renew your subscription
  cancel <plan_id>                        Cancel your subscription
  status <plan_id> [subscriber]           Show subscription status
`);
  }
}

main().catch(console.error);
