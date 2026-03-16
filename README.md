# On-Chain Subscription Billing System
### Anchor · Solana Devnet · Rust · TypeScript

> **A production-grade SaaS billing engine running entirely on-chain** — no databases, no payment processors, no trust assumptions. Think Stripe, but trustless and composable.

---

## 🔗 Live Devnet Deployment

| | |
|---|---|
| **Program ID** | `CHiGNDhvm7KCL3216YqajQMf82h2HUJo9hTPgksbGCZB` |
| **Network** | Solana Devnet |
| **Deployer** | `CF9qQdfCJRPVkGTK4F2vMG1uFGmdPom9ZrYKAakHQB73` |
| **Deploy TX** | [222zyEjd...](https://explorer.solana.com/tx/222zyEjd7E56BU9KjhT6y12mYqgkSJQHsQf1ExGu7Q5gydzhqrLwvL8bMmj5QfqmJwrcZGs7VW6f8jGsj7W2AL29?cluster=devnet) |
| **Explorer** | [View on Solana Explorer](https://explorer.solana.com/address/CHiGNDhvm7KCL3216YqajQMf82h2HUJo9hTPgksbGCZB?cluster=devnet) |

### 🎬 Live Demo Transactions (verified on devnet)

| Instruction | Transaction |
|---|---|
| `create_plan` | [42we73fb...](https://explorer.solana.com/tx/42we73fbgLWKuzpHPzRG3r66b494FGn32jiANPKJ8BXMaGG72rDTATxjRaHsLWyvh74rA6B15cBiCzBm6vmj7qiq?cluster=devnet) |
| `subscribe` | [2Ypocw2a...](https://explorer.solana.com/tx/2Ypocw2a4CtgwqWvfZuhGFQsv5j5B9eNJ23digWHp28NshgtCBz7sdJ6Z3vFw5shXnJRFCuzYndKb36qQ4kjXbpp?cluster=devnet) |
| `renew` | [3M6ospCZ...](https://explorer.solana.com/tx/3M6ospCZpAopfUNt3YgpBZmQqzFGgVQ9Fz5arf3FKhskMxJdaRzFiQPfz79u5g8hygMtr9taiXbsned34X4c54z5?cluster=devnet) |
| `cancel` | [51DRSwyP...](https://explorer.solana.com/tx/51DRSwyPwe9AG74AyVnpoQq4qD5SPn6pJ22K8mGc5eprE6MYWHKP1TtZU7fc3qwZhosgCUPnZVDYQ4r78GFQfUDb?cluster=devnet) |

---

## 🏗️ Architecture

### The Core Problem
Modern SaaS applications rely on centralized billing infrastructure (Stripe, PayPal, banks) that introduces trust, censorship, and single-point-of-failure risks. An on-chain billing system eliminates intermediaries entirely.

### Account Model (PDA Hierarchy)

```
ServiceRegistry  [PDA: "registry" + authority]
    │
    ├── SubscriptionPlan[0]  [PDA: "plan" + registry + plan_id(u64 LE)]
    │       │
    │       └── Subscription[subscriber]  [PDA: "subscription" + plan + subscriber]
    │               │
    │               ├── PaymentRecord[0]  [PDA: "payment" + subscription + 0u32]
    │               ├── PaymentRecord[1]
    │               └── PaymentRecord[n]  ← immutable audit trail
    │
    └── SubscriptionPlan[1]
            └── ...
```

**Why this layout wins:**
- O(1) PDA lookups for any subscription or payment — no iteration needed
- `plan_id` as `u64 LE bytes` in seeds = natural ordering + infinite plans
- Payment records are **append-only** — tamper-proof billing history
- Zero cross-program state pollution: each PDA is fully self-describing
- **No `zero_copy` needed**: all accounts are small (65–106 bytes), so heap allocation via Anchor's default `AccountLoader` has zero overhead. `zero_copy` would add unsafe complexity with no measurable gain at these sizes.

### Account Sizes

| Account | Space | Discriminator | Fields |
|---------|-------|---------------|--------|
| `ServiceRegistry` | 65 bytes | 8 | authority(32) + counters(3×8) + grace(8) + bump(1) |
| `SubscriptionPlan` | 106 bytes | 8 | registry(32) + id(8) + name(32) + price(8) + period(8) + caps(4+4) + flags(1+1) |
| `Subscription` | 90 bytes | 8 | plan(32) + subscriber(32) + status(1) + periods(8+8) + counters(4+4) + bump(1) |
| `PaymentRecord` | 78 bytes | 8 | subscription(32) + id(4) + amount(8) + timestamp(8) + period(8+8) + bump(1) |

### Subscription State Machine

```
                    subscribe()
         ╔═══════════════════════════╗
         ▼                           ║ (new sub)
    ┌─────────┐   period_end    ┌────────────┐
    │ Active  │ ─────────────▶  │ GracePeriod│
    └─────────┘                 └────────────┘
         │                           │
    cancel()                    grace_end
         │                           │
         ▼                           ▼
    ┌───────────┐             ┌─────────┐
    │ Cancelled │             │ Expired │
    └───────────┘             └─────────┘
         
    renew() works from: Active (early) or GracePeriod
```

**State transitions are permissionless** — `tick()` can be called by anyone (e.g., a cron bot) to advance expired subscriptions.

---

## 🦀 Instructions

| Instruction | Signer(s) | Description |
|-------------|-----------|-------------|
| `initialize_registry` | authority | Create service registry with grace period config |
| `create_plan` | authority | Add billing plan (name, price, interval) |
| `subscribe` | subscriber | Subscribe + pay first period atomically |
| `renew` | subscriber | Pay next period (early or in grace period) |
| `cancel` | subscriber | Mark cancelled (access until period_end) |
| `tick` | anyone | Advance state to GracePeriod / Expired |
| `set_plan_active` | authority | Pause or unpause a plan |
| `withdraw_fees` | authority | Withdraw accumulated payments from registry |

---

## 🌐 Web2 ↔ Solana Analysis

### The Traditional Stack (Stripe + PostgreSQL)

```
User → HTTPS → API Server → Stripe SDK → Stripe
                    └──────→ PostgreSQL (subscriptions, invoices)
                    └──────→ Redis (session cache)
                    └──────→ Webhook handler (payment events)
```

**Cost:** ~$0.30% + $0.30 per transaction, database hosting ($50-200/mo), 
engineering effort to maintain payment security, PCI compliance overhead.

### The On-Chain Stack

```
User → Wallet → Solana RPC → subscription_billing program
                                     ├── ServiceRegistry PDA
                                     ├── SubscriptionPlan PDA
                                     ├── Subscription PDA
                                     └── PaymentRecord PDAs (audit log)
```

**Cost:** ~0.000005 SOL per transaction (~$0.001), zero hosting, zero PCI compliance.

### Tradeoffs

| Dimension | Web2 (Stripe) | On-Chain (This) |
|-----------|--------------|-----------------|
| **Latency** | ~200ms (async) | ~400ms (1 confirmation) |
| **Trust** | Stripe TOS, bank risk | Trustless, code is law |
| **Censorship** | Account can be frozen | Permissionless |
| **Currencies** | Fiat only | SOL, SPL tokens |
| **Refunds** | Stripe handles | Program logic (cancel = no refund by design) |
| **Audit trail** | Stripe dashboard | On-chain PaymentRecord PDAs, forever |
| **Composability** | REST API | Direct CPI from any Solana program |
| **Compliance** | PCI DSS required | N/A |
| **Downtime** | Stripe outages | Solana uptime (99.9%) |
| **Cost at scale** | % of revenue | Fixed per-tx (~$0.001) |

### Why Solana Specifically?

1. **Compute budget**: BPF programs are capped at 200K CUs. Our heaviest instruction (`subscribe`) uses ~15K CUs — well within budget even with multiple nested CPIs.
2. **Account model**: PDAs replace foreign key relationships naturally. A subscription PDA seeded by `(plan, subscriber)` is deterministically findable by any client without querying an index.
3. **Atomic payments**: `subscribe()` transfers SOL and creates the subscription in a single atomic transaction — impossible race conditions.
4. **CPI composability**: Any Solana program can call `check_subscription` to gate access to features — think on-chain paywalls.

---

## 🧪 Tests

10 tests covering full lifecycle:

```
subscription-billing
  ✓ initializes a service registry
  ✓ creates a subscription plan
  ✓ Alice subscribes to plan 0
  ✓ Alice renews her subscription (early renewal)
  ✓ Alice cancels her subscription
  ✓ double-cancel returns AlreadyCancelled error
  ✓ Bob subscribes and tick moves him to GracePeriod after expiry
  ✓ authority pauses plan 0
  ✓ subscribing to paused plan returns PlanInactive
  ✓ authority withdraws fees

  10 passing
```

---

## 🚀 Local Setup

### Prerequisites
- [Anchor CLI](https://www.anchor-lang.com/docs/installation) ≥ 0.32.1
- Rust ≥ 1.79
- Node.js ≥ 18
- Solana CLI ≥ 1.18

### Build & Test

```bash
git clone https://github.com/yourusername/subscription-billing
cd subscription-billing

# Install dependencies
npm install

# Build program
anchor build

# Run tests (against localnet)
anchor test

# Deploy to devnet
anchor deploy --provider.cluster devnet
```

### CLI Client

```bash
# Initialize your service registry (30-day grace period)
npx ts-node cli/client.ts init-registry 86400

# Create a monthly plan (0.01 SOL / 30 days)
npx ts-node cli/client.ts create-plan "Pro Plan" 0.01 2592000

# Subscribe
npx ts-node cli/client.ts subscribe 0

# Check status
npx ts-node cli/client.ts status 0

# Renew before period ends
npx ts-node cli/client.ts renew 0

# Cancel
npx ts-node cli/client.ts cancel 0
```

---

## 📁 Project Structure

```
subscription-billing/
├── programs/
│   └── subscription-billing/
│       ├── Cargo.toml
│       └── src/
│           └── lib.rs         # Full program: accounts, instructions, contexts
├── tests/
│   └── subscription_billing.ts # 10 integration tests
├── cli/
│   └── client.ts              # TypeScript CLI client
├── target/
│   ├── deploy/
│   │   └── subscription_billing.so   # Compiled BPF binary (331KB)
│   └── idl/
│       └── subscription_billing.json # Auto-generated IDL
├── Anchor.toml
└── README.md
```

---

## 🔐 Security Considerations

- All PDAs use deterministic seeds — no authority can forge a subscription
- `has_one` constraints on all account contexts prevent account substitution attacks
- All arithmetic uses `checked_add` / `checked_sub` — zero overflow risk
- `withdraw_fees` requires `has_one = authority` — no unauthorized withdrawals
- Payment records are **write-once PDAs** — cannot be modified after creation
- `tick()` is permissionless but only advances state forward, never backward

---

*Built for Superteam Poland — Rebuild production backend systems as on-chain Rust programs bounty.*
