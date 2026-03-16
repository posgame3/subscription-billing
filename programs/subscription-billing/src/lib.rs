use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("CHiGNDhvm7KCL3216YqajQMf82h2HUJo9hTPgksbGCZB");

pub mod cpi;
pub use cpi::{find_plan_address, find_registry_address, find_subscription_address, is_within_grace_period, require_active_subscription};

// ── Error Codes ─────────────────────────────────────────────────────────────

#[error_code]
pub enum BillingError {
    #[msg("Subscription plan is not active")]
    PlanInactive,
    #[msg("Subscription plan has reached maximum subscriber capacity")]
    PlanAtCapacity,
    #[msg("Subscription is not active")]
    SubscriptionNotActive,
    #[msg("Subscription period has not yet ended")]
    PeriodNotEnded,
    #[msg("Subscription has already been cancelled")]
    AlreadyCancelled,
    #[msg("Subscription has expired; please create a new subscription")]
    SubscriptionExpired,
    #[msg("Unauthorized: caller is not the registry authority")]
    Unauthorized,
    #[msg("Plan name too long (max 32 bytes)")]
    NameTooLong,
    #[msg("Invalid period duration (must be > 0)")]
    InvalidPeriodDuration,
    #[msg("Invalid price (must be > 0)")]
    InvalidPrice,
    #[msg("Grace period has ended; subscription is expired")]
    GracePeriodEnded,
    #[msg("Arithmetic overflow")]
    Overflow,
}

// ── State Accounts ───────────────────────────────────────────────────────────

/// Top-level registry owned by a service provider.
/// PDA: ["registry", authority]
#[account]
#[derive(Default)]
pub struct ServiceRegistry {
    /// The authority who can create/pause plans and withdraw fees
    pub authority: Pubkey,        // 32
    /// Running counter used to generate unique plan PDAs
    pub plan_count: u64,          // 8
    /// Total subscriptions ever created across all plans
    pub total_subscriptions: u64, // 8
    /// Accumulated protocol fees held in this account (lamports)
    pub treasury_balance: u64,    // 8
    /// Grace period after billing cycle ends before marking expired (seconds)
    pub grace_period_seconds: i64, // 8
    pub bump: u8,                 // 1
}

impl ServiceRegistry {
    pub const LEN: usize = 8 + 32 + 8 + 8 + 8 + 8 + 1; // discriminator + fields
}

/// A billing plan: price + interval, owned by a registry.
/// PDA: ["plan", registry, plan_id as u64 LE bytes]
#[account]
pub struct SubscriptionPlan {
    pub registry: Pubkey,          // 32 — back-reference
    pub plan_id: u64,              // 8
    /// Human-readable name (UTF-8, max 32 bytes)
    pub name: [u8; 32],            // 32
    /// Cost per billing period in lamports
    pub price_lamports: u64,       // 8
    /// Length of one billing period in seconds
    pub period_seconds: i64,       // 8
    /// 0 = unlimited
    pub max_subscribers: u32,      // 4
    pub subscriber_count: u32,     // 4
    pub is_active: bool,           // 1
    pub bump: u8,                  // 1
}

impl SubscriptionPlan {
    pub const LEN: usize = 8 + 32 + 8 + 32 + 8 + 8 + 4 + 4 + 1 + 1;
}

/// State machine for a single subscription.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum SubscriptionStatus {
    Active,
    GracePeriod,
    Expired,
    Cancelled,
}

impl Default for SubscriptionStatus {
    fn default() -> Self { SubscriptionStatus::Active }
}

/// One subscriber's subscription to one plan.
/// PDA: ["subscription", plan, subscriber]
#[account]
pub struct Subscription {
    pub plan: Pubkey,                   // 32
    pub subscriber: Pubkey,             // 32
    pub status: SubscriptionStatus,     // 1 (enum tag)
    /// Unix timestamp when the current period started
    pub current_period_start: i64,      // 8
    /// Unix timestamp when the current period ends
    pub current_period_end: i64,        // 8
    /// Total number of successful renewals (including initial)
    pub renewal_count: u32,             // 4
    /// Total number of payment records
    pub payment_count: u32,             // 4
    pub bump: u8,                       // 1
}

impl Subscription {
    pub const LEN: usize = 8 + 32 + 32 + 1 + 8 + 8 + 4 + 4 + 1;
}

/// Immutable ledger entry for each payment.
/// PDA: ["payment", subscription, payment_id as u32 LE bytes]
#[account]
pub struct PaymentRecord {
    pub subscription: Pubkey, // 32
    pub payment_id: u32,      // 4
    pub amount_lamports: u64, // 8
    pub timestamp: i64,       // 8
    pub period_start: i64,    // 8
    pub period_end: i64,      // 8
    pub bump: u8,             // 1
}

impl PaymentRecord {
    pub const LEN: usize = 8 + 32 + 4 + 8 + 8 + 8 + 8 + 1;
}

// ── Events ───────────────────────────────────────────────────────────────────

#[event]
pub struct SubscriptionCreated {
    pub subscriber: Pubkey,
    pub plan: Pubkey,
    pub period_end: i64,
}

#[event]
pub struct SubscriptionRenewed {
    pub subscriber: Pubkey,
    pub plan: Pubkey,
    pub new_period_end: i64,
    pub renewal_count: u32,
}

#[event]
pub struct SubscriptionCancelled {
    pub subscriber: Pubkey,
    pub plan: Pubkey,
}

#[event]
pub struct SubscriptionExpired {
    pub subscriber: Pubkey,
    pub plan: Pubkey,
}

// ── Program ──────────────────────────────────────────────────────────────────

#[program]
pub mod subscription_billing {
    use super::*;

    /// Initialize a new service registry for a provider authority.
    pub fn initialize_registry(
        ctx: Context<InitializeRegistry>,
        grace_period_seconds: i64,
    ) -> Result<()> {
        require!(grace_period_seconds >= 0, BillingError::InvalidPeriodDuration);
        let registry = &mut ctx.accounts.registry;
        registry.authority = ctx.accounts.authority.key();
        registry.plan_count = 0;
        registry.total_subscriptions = 0;
        registry.treasury_balance = 0;
        registry.grace_period_seconds = grace_period_seconds;
        registry.bump = ctx.bumps.registry;
        Ok(())
    }

    /// Create a new subscription plan under the registry.
    pub fn create_plan(
        ctx: Context<CreatePlan>,
        name: [u8; 32],
        price_lamports: u64,
        period_seconds: i64,
        max_subscribers: u32,
    ) -> Result<()> {
        require!(price_lamports > 0, BillingError::InvalidPrice);
        require!(period_seconds > 0, BillingError::InvalidPeriodDuration);

        let registry = &mut ctx.accounts.registry;
        let plan_id = registry.plan_count;

        let plan = &mut ctx.accounts.plan;
        plan.registry = registry.key();
        plan.plan_id = plan_id;
        plan.name = name;
        plan.price_lamports = price_lamports;
        plan.period_seconds = period_seconds;
        plan.max_subscribers = max_subscribers;
        plan.subscriber_count = 0;
        plan.is_active = true;
        plan.bump = ctx.bumps.plan;

        registry.plan_count = registry
            .plan_count
            .checked_add(1)
            .ok_or(BillingError::Overflow)?;

        Ok(())
    }

    /// Subscribe to a plan — transfers first payment immediately.
    pub fn subscribe(ctx: Context<Subscribe>) -> Result<()> {
        let plan = &mut ctx.accounts.plan;
        require!(plan.is_active, BillingError::PlanInactive);
        require!(
            plan.max_subscribers == 0 || plan.subscriber_count < plan.max_subscribers,
            BillingError::PlanAtCapacity
        );

        let clock = Clock::get()?;
        let now = clock.unix_timestamp;

        let period_start = now;
        let period_end = now
            .checked_add(plan.period_seconds)
            .ok_or(BillingError::Overflow)?;

        // Transfer payment: subscriber → registry (via system_program)
        let price = plan.price_lamports;
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.subscriber.to_account_info(),
                    to: ctx.accounts.registry.to_account_info(),
                },
            ),
            price,
        )?;

        // Update registry treasury
        ctx.accounts.registry.treasury_balance = ctx
            .accounts
            .registry
            .treasury_balance
            .checked_add(price)
            .ok_or(BillingError::Overflow)?;

        // Build subscription
        let sub = &mut ctx.accounts.subscription;
        sub.plan = plan.key();
        sub.subscriber = ctx.accounts.subscriber.key();
        sub.status = SubscriptionStatus::Active;
        sub.current_period_start = period_start;
        sub.current_period_end = period_end;
        sub.renewal_count = 0;
        sub.payment_count = 1;
        sub.bump = ctx.bumps.subscription;

        // Record first payment
        let payment = &mut ctx.accounts.payment;
        payment.subscription = sub.key();
        payment.payment_id = 0;
        payment.amount_lamports = price;
        payment.timestamp = now;
        payment.period_start = period_start;
        payment.period_end = period_end;
        payment.bump = ctx.bumps.payment;

        // Update plan counters
        plan.subscriber_count = plan
            .subscriber_count
            .checked_add(1)
            .ok_or(BillingError::Overflow)?;

        // Update registry
        ctx.accounts.registry.total_subscriptions = ctx
            .accounts
            .registry
            .total_subscriptions
            .checked_add(1)
            .ok_or(BillingError::Overflow)?;

        emit!(SubscriptionCreated {
            subscriber: ctx.accounts.subscriber.key(),
            plan: plan.key(),
            period_end,
        });

        Ok(())
    }

    /// Renew an existing subscription — pays for the next period.
    /// Can be called when Active (early renewal) or GracePeriod.
    pub fn renew(ctx: Context<Renew>) -> Result<()> {
        let plan = &ctx.accounts.plan;
        require!(plan.is_active, BillingError::PlanInactive);

        let sub = &mut ctx.accounts.subscription;
        let clock = Clock::get()?;
        let now = clock.unix_timestamp;

        // Cannot renew a cancelled or expired subscription
        require!(
            sub.status != SubscriptionStatus::Cancelled,
            BillingError::AlreadyCancelled
        );
        require!(
            sub.status != SubscriptionStatus::Expired,
            BillingError::SubscriptionExpired
        );

        // Determine new period boundaries
        let new_period_start;
        let new_period_end;

        if sub.status == SubscriptionStatus::Active && now < sub.current_period_end {
            // Early renewal: extend from current period_end
            new_period_start = sub.current_period_end;
        } else {
            // Renewing in grace period or exactly at boundary
            new_period_start = now;
        }
        new_period_end = new_period_start
            .checked_add(plan.period_seconds)
            .ok_or(BillingError::Overflow)?;

        let price = plan.price_lamports;

        // Transfer payment
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.subscriber.to_account_info(),
                    to: ctx.accounts.registry.to_account_info(),
                },
            ),
            price,
        )?;

        ctx.accounts.registry.treasury_balance = ctx
            .accounts
            .registry
            .treasury_balance
            .checked_add(price)
            .ok_or(BillingError::Overflow)?;

        let payment_id = sub.payment_count;
        sub.status = SubscriptionStatus::Active;
        sub.current_period_start = new_period_start;
        sub.current_period_end = new_period_end;
        sub.renewal_count = sub
            .renewal_count
            .checked_add(1)
            .ok_or(BillingError::Overflow)?;
        sub.payment_count = sub
            .payment_count
            .checked_add(1)
            .ok_or(BillingError::Overflow)?;

        // Record payment
        let payment = &mut ctx.accounts.payment;
        payment.subscription = sub.key();
        payment.payment_id = payment_id;
        payment.amount_lamports = price;
        payment.timestamp = now;
        payment.period_start = new_period_start;
        payment.period_end = new_period_end;
        payment.bump = ctx.bumps.payment;

        emit!(SubscriptionRenewed {
            subscriber: ctx.accounts.subscriber.key(),
            plan: ctx.accounts.plan.key(),
            new_period_end,
            renewal_count: sub.renewal_count,
        });

        Ok(())
    }

    /// Cancel a subscription. Status → Cancelled; subscriber keeps access until period_end.
    pub fn cancel(ctx: Context<Cancel>) -> Result<()> {
        let sub = &mut ctx.accounts.subscription;
        require!(
            sub.status != SubscriptionStatus::Cancelled,
            BillingError::AlreadyCancelled
        );
        require!(
            sub.status != SubscriptionStatus::Expired,
            BillingError::SubscriptionExpired
        );
        sub.status = SubscriptionStatus::Cancelled;
        emit!(SubscriptionCancelled {
            subscriber: ctx.accounts.subscriber.key(),
            plan: ctx.accounts.plan.key(),
        });
        Ok(())
    }

    /// Advance subscription to GracePeriod or Expired based on clock.
    /// Anyone can call this — it's a permissionless state transition.
    pub fn tick(ctx: Context<Tick>) -> Result<()> {
        let sub = &mut ctx.accounts.subscription;
        let registry = &ctx.accounts.registry;
        let clock = Clock::get()?;
        let now = clock.unix_timestamp;

        if sub.status == SubscriptionStatus::Active && now > sub.current_period_end {
            let grace_end = sub
                .current_period_end
                .checked_add(registry.grace_period_seconds)
                .ok_or(BillingError::Overflow)?;
            if now > grace_end {
                sub.status = SubscriptionStatus::Expired;
                emit!(SubscriptionExpired {
                    subscriber: sub.subscriber,
                    plan: sub.plan,
                });
            } else {
                sub.status = SubscriptionStatus::GracePeriod;
            }
        } else if sub.status == SubscriptionStatus::GracePeriod {
            let grace_end = sub
                .current_period_end
                .checked_add(registry.grace_period_seconds)
                .ok_or(BillingError::Overflow)?;
            if now > grace_end {
                sub.status = SubscriptionStatus::Expired;
                emit!(SubscriptionExpired {
                    subscriber: sub.subscriber,
                    plan: sub.plan,
                });
            }
        }

        Ok(())
    }

    /// Authority withdraws accumulated fees from the registry.
    pub fn withdraw_fees(ctx: Context<WithdrawFees>, amount: u64) -> Result<()> {
        let registry = &mut ctx.accounts.registry;
        require!(
            ctx.accounts.authority.key() == registry.authority,
            BillingError::Unauthorized
        );
        require!(amount <= registry.treasury_balance, BillingError::Overflow);

        **registry.to_account_info().try_borrow_mut_lamports()? = registry
            .to_account_info()
            .lamports()
            .checked_sub(amount)
            .ok_or(BillingError::Overflow)?;
        **ctx
            .accounts
            .destination
            .to_account_info()
            .try_borrow_mut_lamports()? = ctx
            .accounts
            .destination
            .to_account_info()
            .lamports()
            .checked_add(amount)
            .ok_or(BillingError::Overflow)?;

        registry.treasury_balance = registry
            .treasury_balance
            .checked_sub(amount)
            .ok_or(BillingError::Overflow)?;

        Ok(())
    }

    /// Pause or unpause a plan (authority only).
    pub fn set_plan_active(ctx: Context<SetPlanActive>, is_active: bool) -> Result<()> {
        require!(
            ctx.accounts.authority.key() == ctx.accounts.registry.authority,
            BillingError::Unauthorized
        );
        ctx.accounts.plan.is_active = is_active;
        Ok(())
    }
}

// ── Contexts ─────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitializeRegistry<'info> {
    #[account(
        init,
        payer = authority,
        space = ServiceRegistry::LEN,
        seeds = [b"registry", authority.key().as_ref()],
        bump
    )]
    pub registry: Account<'info, ServiceRegistry>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreatePlan<'info> {
    #[account(
        mut,
        seeds = [b"registry", authority.key().as_ref()],
        bump = registry.bump,
        has_one = authority
    )]
    pub registry: Account<'info, ServiceRegistry>,

    #[account(
        init,
        payer = authority,
        space = SubscriptionPlan::LEN,
        seeds = [b"plan", registry.key().as_ref(), &registry.plan_count.to_le_bytes()],
        bump
    )]
    pub plan: Account<'info, SubscriptionPlan>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Subscribe<'info> {
    #[account(
        mut,
        seeds = [b"registry", registry.authority.as_ref()],
        bump = registry.bump,
    )]
    pub registry: Account<'info, ServiceRegistry>,

    #[account(
        mut,
        seeds = [b"plan", registry.key().as_ref(), &plan.plan_id.to_le_bytes()],
        bump = plan.bump,
        has_one = registry
    )]
    pub plan: Account<'info, SubscriptionPlan>,

    #[account(
        init,
        payer = subscriber,
        space = Subscription::LEN,
        seeds = [b"subscription", plan.key().as_ref(), subscriber.key().as_ref()],
        bump
    )]
    pub subscription: Account<'info, Subscription>,

    /// First payment record (payment_id = 0)
    #[account(
        init,
        payer = subscriber,
        space = PaymentRecord::LEN,
        seeds = [b"payment", subscription.key().as_ref(), &0u32.to_le_bytes()],
        bump
    )]
    pub payment: Account<'info, PaymentRecord>,

    #[account(mut)]
    pub subscriber: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Renew<'info> {
    #[account(
        mut,
        seeds = [b"registry", registry.authority.as_ref()],
        bump = registry.bump,
    )]
    pub registry: Account<'info, ServiceRegistry>,

    #[account(
        seeds = [b"plan", registry.key().as_ref(), &plan.plan_id.to_le_bytes()],
        bump = plan.bump,
        has_one = registry
    )]
    pub plan: Account<'info, SubscriptionPlan>,

    #[account(
        mut,
        seeds = [b"subscription", plan.key().as_ref(), subscriber.key().as_ref()],
        bump = subscription.bump,
        has_one = plan,
        has_one = subscriber
    )]
    pub subscription: Account<'info, Subscription>,

    /// Next payment record — payment_id = subscription.payment_count (before increment)
    #[account(
        init,
        payer = subscriber,
        space = PaymentRecord::LEN,
        seeds = [b"payment", subscription.key().as_ref(), &subscription.payment_count.to_le_bytes()],
        bump
    )]
    pub payment: Account<'info, PaymentRecord>,

    #[account(mut)]
    pub subscriber: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Cancel<'info> {
    #[account(
        mut,
        seeds = [b"subscription", plan.key().as_ref(), subscriber.key().as_ref()],
        bump = subscription.bump,
        has_one = plan,
        has_one = subscriber
    )]
    pub subscription: Account<'info, Subscription>,

    pub plan: Account<'info, SubscriptionPlan>,

    pub subscriber: Signer<'info>,
}

#[derive(Accounts)]
pub struct Tick<'info> {
    #[account(
        seeds = [b"registry", registry.authority.as_ref()],
        bump = registry.bump,
    )]
    pub registry: Account<'info, ServiceRegistry>,

    #[account(
        mut,
        seeds = [b"subscription", plan.key().as_ref(), subscription.subscriber.as_ref()],
        bump = subscription.bump,
        has_one = plan,
    )]
    pub subscription: Account<'info, Subscription>,

    pub plan: Account<'info, SubscriptionPlan>,
}

#[derive(Accounts)]
pub struct WithdrawFees<'info> {
    #[account(
        mut,
        seeds = [b"registry", authority.key().as_ref()],
        bump = registry.bump,
        has_one = authority
    )]
    pub registry: Account<'info, ServiceRegistry>,

    #[account(mut)]
    pub destination: SystemAccount<'info>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetPlanActive<'info> {
    #[account(
        seeds = [b"registry", authority.key().as_ref()],
        bump = registry.bump,
        has_one = authority
    )]
    pub registry: Account<'info, ServiceRegistry>,

    #[account(
        mut,
        seeds = [b"plan", registry.key().as_ref(), &plan.plan_id.to_le_bytes()],
        bump = plan.bump,
        has_one = registry
    )]
    pub plan: Account<'info, SubscriptionPlan>,

    pub authority: Signer<'info>,
}
