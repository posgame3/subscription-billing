/// CPI (Cross-Program Invocation) helpers for the Subscription Billing program.
///
/// Other Solana programs can use these helpers to gate access to features
/// behind active subscriptions — on-chain paywalls, composable billing checks.
///
/// # Example usage from an external program
///
/// ```rust,ignore
/// use subscription_billing::cpi::accounts::CheckSubscription;
/// use subscription_billing::cpi;
///
/// // Gate a premium feature behind an active subscription
/// pub fn premium_feature(ctx: Context<PremiumFeature>) -> Result<()> {
///     let sub = ctx.accounts.subscription.load()?;  // or fetch
///     require!(
///         sub.status == SubscriptionStatus::Active as u8,
///         MyError::NotSubscribed
///     );
///     // ... feature logic
///     Ok(())
/// }
/// ```

use anchor_lang::prelude::*;
use crate::{Subscription, SubscriptionStatus};

/// Verify that a given subscriber has an active (non-expired, non-cancelled) subscription
/// to the specified plan. Returns `Ok(())` on success or an error if not active.
///
/// Designed for use in `#[access_control]` decorators on external program instructions.
///
/// # Example
///
/// ```rust,ignore
/// #[access_control(require_active_subscription(&ctx.accounts.subscription))]
/// pub fn gated_action(ctx: Context<GatedAction>) -> Result<()> {
///     // Only reachable if subscription is active
///     msg!("Premium feature executed for subscriber: {}", ctx.accounts.user.key());
///     Ok(())
/// }
/// ```
pub fn require_active_subscription(subscription: &Account<Subscription>) -> Result<()> {
    require!(
        subscription.status == SubscriptionStatus::Active,
        crate::BillingError::SubscriptionNotActive
    );
    Ok(())
}

/// Check whether a subscription is within its grace period (still has access).
///
/// Grace period allows subscribers a buffer after payment expiry before losing access.
/// External programs may choose to allow access during grace period.
pub fn is_within_grace_period(subscription: &Account<Subscription>) -> bool {
    subscription.status == SubscriptionStatus::Active
        || subscription.status == SubscriptionStatus::GracePeriod
}

/// Derive the canonical subscription PDA address for a given plan and subscriber.
/// Useful for off-chain clients and CPI callers to compute the address without
/// querying the chain.
///
/// Seeds: `["subscription", plan_pubkey, subscriber_pubkey]`
pub fn find_subscription_address(
    plan: &Pubkey,
    subscriber: &Pubkey,
    program_id: &Pubkey,
) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"subscription", plan.as_ref(), subscriber.as_ref()],
        program_id,
    )
}

/// Derive the canonical plan PDA address.
///
/// Seeds: `["plan", registry_pubkey, plan_id_as_u64_le]`
pub fn find_plan_address(
    registry: &Pubkey,
    plan_id: u64,
    program_id: &Pubkey,
) -> (Pubkey, u8) {
    let plan_id_bytes = plan_id.to_le_bytes();
    Pubkey::find_program_address(
        &[b"plan", registry.as_ref(), &plan_id_bytes],
        program_id,
    )
}

/// Derive the canonical registry PDA address for a given authority.
///
/// Seeds: `["registry", authority_pubkey]`
pub fn find_registry_address(authority: &Pubkey, program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"registry", authority.as_ref()], program_id)
}
