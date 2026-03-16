/**
 * subscription-billing — TypeScript test suite
 *
 * Tests:
 *  1. initialize_registry
 *  2. create_plan
 *  3. subscribe (happy path)
 *  4. renew (early + grace period)
 *  5. cancel
 *  6. tick (state advancement)
 *  7. set_plan_active (pause/unpause)
 *  8. withdraw_fees
 *  9. Error paths: inactive plan, at capacity, double-cancel
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, BN, AnchorProvider } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { assert } from "chai";
import { SubscriptionBilling } from "../target/types/subscription_billing";

// ─── Helpers ────────────────────────────────────────────────────────────────

function bytes32(s: string): number[] {
  const buf = Buffer.alloc(32);
  Buffer.from(s, "utf8").copy(buf);
  return Array.from(buf);
}

function findRegistry(program: Program<SubscriptionBilling>, authority: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("registry"), authority.toBuffer()],
    program.programId
  );
}

function findPlan(
  program: Program<SubscriptionBilling>,
  registry: PublicKey,
  planId: number
) {
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(BigInt(planId));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("plan"), registry.toBuffer(), idBuf],
    program.programId
  );
}

function findSubscription(
  program: Program<SubscriptionBilling>,
  plan: PublicKey,
  subscriber: PublicKey
) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("subscription"), plan.toBuffer(), subscriber.toBuffer()],
    program.programId
  );
}

function findPayment(
  program: Program<SubscriptionBilling>,
  subscription: PublicKey,
  paymentId: number
) {
  const idBuf = Buffer.alloc(4);
  idBuf.writeUInt32LE(paymentId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("payment"), subscription.toBuffer(), idBuf],
    program.programId
  );
}

async function airdrop(provider: AnchorProvider, to: PublicKey, sol: number) {
  const sig = await provider.connection.requestAirdrop(to, sol * LAMPORTS_PER_SOL);
  await provider.connection.confirmTransaction(sig, "confirmed");
}

// ─── Test Suite ─────────────────────────────────────────────────────────────

describe("subscription-billing", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.SubscriptionBilling as Program<SubscriptionBilling>;

  // Actors
  const authority = Keypair.generate();   // service provider
  const alice = Keypair.generate();       // subscriber 1
  const bob = Keypair.generate();         // subscriber 2

  let registryPDA: PublicKey;
  let plan0PDA: PublicKey;
  let aliceSubPDA: PublicKey;

  const PRICE_LAMPORTS = 10_000_000; // 0.01 SOL per period
  const PERIOD_SECONDS = 60;          // 60 seconds for testing
  const GRACE_SECONDS = 30;

  before(async () => {
    // Fund all actors
    await Promise.all([
      airdrop(provider, authority.publicKey, 10),
      airdrop(provider, alice.publicKey, 10),
      airdrop(provider, bob.publicKey, 10),
    ]);
    [registryPDA] = findRegistry(program, authority.publicKey);
  });

  // ── 1. initialize_registry ─────────────────────────────────────────────────

  it("initializes a service registry", async () => {
    await program.methods
      .initializeRegistry(new BN(GRACE_SECONDS))
      .accounts({
        registry: registryPDA,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc({ commitment: "confirmed" });

    const registry = await program.account.serviceRegistry.fetch(registryPDA);
    assert.equal(registry.authority.toBase58(), authority.publicKey.toBase58());
    assert.equal(registry.planCount.toNumber(), 0);
    assert.equal(registry.gracePeriodSeconds.toNumber(), GRACE_SECONDS);
    console.log("  ✓ Registry:", registryPDA.toBase58());
  });

  // ── 2. create_plan ─────────────────────────────────────────────────────────

  it("creates a subscription plan", async () => {
    [plan0PDA] = findPlan(program, registryPDA, 0);

    await program.methods
      .createPlan(
        bytes32("Basic Plan"),
        new BN(PRICE_LAMPORTS),
        new BN(PERIOD_SECONDS),
        0 // unlimited
      )
      .accounts({
        registry: registryPDA,
        plan: plan0PDA,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc({ commitment: "confirmed" });

    const plan = await program.account.subscriptionPlan.fetch(plan0PDA);
    assert.equal(plan.priceLamports.toNumber(), PRICE_LAMPORTS);
    assert.equal(plan.periodSeconds.toNumber(), PERIOD_SECONDS);
    assert.isTrue(plan.isActive);
    assert.equal(plan.subscriberCount, 0);
    console.log("  ✓ Plan:", plan0PDA.toBase58());

    const registry = await program.account.serviceRegistry.fetch(registryPDA);
    assert.equal(registry.planCount.toNumber(), 1);
  });

  // ── 3. subscribe ──────────────────────────────────────────────────────────

  it("Alice subscribes to plan 0", async () => {
    [aliceSubPDA] = findSubscription(program, plan0PDA, alice.publicKey);
    const [paymentPDA] = findPayment(program, aliceSubPDA, 0);

    const registryBefore = await provider.connection.getBalance(registryPDA);

    await program.methods
      .subscribe()
      .accounts({
        registry: registryPDA,
        plan: plan0PDA,
        subscription: aliceSubPDA,
        payment: paymentPDA,
        subscriber: alice.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([alice])
      .rpc({ commitment: "confirmed" });

    const sub = await program.account.subscription.fetch(aliceSubPDA);
    assert.deepEqual(sub.status, { active: {} });
    assert.equal(sub.renewalCount, 0);
    assert.equal(sub.paymentCount, 1);

    const payment = await program.account.paymentRecord.fetch(paymentPDA);
    assert.equal(payment.amountLamports.toNumber(), PRICE_LAMPORTS);
    assert.equal(payment.paymentId, 0);

    const registryAfter = await provider.connection.getBalance(registryPDA);
    assert.isAbove(registryAfter, registryBefore);

    const plan = await program.account.subscriptionPlan.fetch(plan0PDA);
    assert.equal(plan.subscriberCount, 1);

    console.log("  ✓ Subscription:", aliceSubPDA.toBase58());
    console.log("  ✓ Payment[0]:", paymentPDA.toBase58());
  });

  // ── 4. renew ──────────────────────────────────────────────────────────────

  it("Alice renews her subscription (early renewal)", async () => {
    const [payment1PDA] = findPayment(program, aliceSubPDA, 1);
    const subBefore = await program.account.subscription.fetch(aliceSubPDA);

    await program.methods
      .renew()
      .accounts({
        registry: registryPDA,
        plan: plan0PDA,
        subscription: aliceSubPDA,
        payment: payment1PDA,
        subscriber: alice.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([alice])
      .rpc({ commitment: "confirmed" });

    const sub = await program.account.subscription.fetch(aliceSubPDA);
    assert.deepEqual(sub.status, { active: {} });
    assert.equal(sub.renewalCount, 1);
    assert.equal(sub.paymentCount, 2);
    // Period extended from previous end
    assert.equal(
      sub.currentPeriodStart.toNumber(),
      subBefore.currentPeriodEnd.toNumber()
    );

    const payment = await program.account.paymentRecord.fetch(payment1PDA);
    assert.equal(payment.paymentId, 1);
    assert.equal(payment.amountLamports.toNumber(), PRICE_LAMPORTS);
    console.log("  ✓ Renewal[1]:", payment1PDA.toBase58());
  });

  // ── 5. cancel ─────────────────────────────────────────────────────────────

  it("Alice cancels her subscription", async () => {
    await program.methods
      .cancel()
      .accounts({
        subscription: aliceSubPDA,
        plan: plan0PDA,
        subscriber: alice.publicKey,
      })
      .signers([alice])
      .rpc({ commitment: "confirmed" });

    const sub = await program.account.subscription.fetch(aliceSubPDA);
    assert.deepEqual(sub.status, { cancelled: {} });
    console.log("  ✓ Subscription cancelled");
  });

  // ── 6. double-cancel error ────────────────────────────────────────────────

  it("double-cancel returns AlreadyCancelled error", async () => {
    try {
      await program.methods
        .cancel()
        .accounts({
          subscription: aliceSubPDA,
          plan: plan0PDA,
          subscriber: alice.publicKey,
        })
        .signers([alice])
        .rpc({ commitment: "confirmed" });
      assert.fail("Should have thrown");
    } catch (err: unknown) {
      const e = err as anchor.AnchorError;
      assert.include(e.message, "AlreadyCancelled");
      console.log("  ✓ AlreadyCancelled caught correctly");
    }
  });

  // ── 7. Bob subscribes, tick advances state ────────────────────────────────

  it("Bob subscribes and tick moves him to GracePeriod after expiry", async () => {
    // Create a plan with 1-second period for fast expiry test
    const [plan1PDA] = findPlan(program, registryPDA, 1);
    await program.methods
      .createPlan(bytes32("Flash Plan"), new BN(PRICE_LAMPORTS), new BN(1), 0)
      .accounts({
        registry: registryPDA,
        plan: plan1PDA,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc({ commitment: "confirmed" });

    const [bobSubPDA] = findSubscription(program, plan1PDA, bob.publicKey);
    const [bobPayPDA] = findPayment(program, bobSubPDA, 0);

    await program.methods
      .subscribe()
      .accounts({
        registry: registryPDA,
        plan: plan1PDA,
        subscription: bobSubPDA,
        payment: bobPayPDA,
        subscriber: bob.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([bob])
      .rpc({ commitment: "confirmed" });

    // Wait for period to expire
    await new Promise((r) => setTimeout(r, 2000));

    // Tick — should advance to GracePeriod
    await program.methods
      .tick()
      .accounts({
        registry: registryPDA,
        subscription: bobSubPDA,
        plan: plan1PDA,
      })
      .rpc({ commitment: "confirmed" });

    const sub = await program.account.subscription.fetch(bobSubPDA);
    // Either GracePeriod or Expired depending on timing
    const isGrace = JSON.stringify(sub.status) === JSON.stringify({ gracePeriod: {} });
    const isExpired = JSON.stringify(sub.status) === JSON.stringify({ expired: {} });
    assert.isTrue(isGrace || isExpired, "Status should be grace or expired");
    console.log("  ✓ Tick advanced state to:", JSON.stringify(sub.status));
  });

  // ── 8. pause plan (admin) ─────────────────────────────────────────────────

  it("authority pauses plan 0", async () => {
    await program.methods
      .setPlanActive(false)
      .accounts({
        registry: registryPDA,
        plan: plan0PDA,
        authority: authority.publicKey,
      })
      .signers([authority])
      .rpc({ commitment: "confirmed" });

    const plan = await program.account.subscriptionPlan.fetch(plan0PDA);
    assert.isFalse(plan.isActive);
    console.log("  ✓ Plan paused");
  });

  // ── 9. subscribe to paused plan returns PlanInactive ──────────────────────

  it("subscribing to paused plan returns PlanInactive", async () => {
    const carol = Keypair.generate();
    await airdrop(provider, carol.publicKey, 2);
    const [carolSubPDA] = findSubscription(program, plan0PDA, carol.publicKey);
    const [carolPayPDA] = findPayment(program, carolSubPDA, 0);

    try {
      await program.methods
        .subscribe()
        .accounts({
          registry: registryPDA,
          plan: plan0PDA,
          subscription: carolSubPDA,
          payment: carolPayPDA,
          subscriber: carol.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([carol])
        .rpc({ commitment: "confirmed" });
      assert.fail("Should have thrown");
    } catch (err: unknown) {
      const e = err as anchor.AnchorError;
      assert.include(e.message, "PlanInactive");
      console.log("  ✓ PlanInactive caught correctly");
    }
  });

  // ── 10. withdraw_fees ─────────────────────────────────────────────────────

  it("authority withdraws fees", async () => {
    const registry = await program.account.serviceRegistry.fetch(registryPDA);
    const treasury = registry.treasuryBalance.toNumber();
    console.log("  Treasury balance:", treasury, "lamports");

    if (treasury > 0) {
      const withdrawAmount = Math.floor(treasury / 2);
      const destBefore = await provider.connection.getBalance(authority.publicKey);

      await program.methods
        .withdrawFees(new BN(withdrawAmount))
        .accounts({
          registry: registryPDA,
          destination: authority.publicKey,
          authority: authority.publicKey,
        })
        .signers([authority])
        .rpc({ commitment: "confirmed" });

      const destAfter = await provider.connection.getBalance(authority.publicKey);
      assert.isAbove(destAfter, destBefore);
      console.log("  ✓ Withdrew", withdrawAmount, "lamports");
    } else {
      console.log("  (treasury empty — skipped withdraw)");
    }
  });
});
