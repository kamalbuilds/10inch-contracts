use near_sdk::test_utils::{accounts, VMContextBuilder};
use near_sdk::{testing_env, NearToken};
use sha2::{Digest, Sha256};

// Test the full-featured HTLC contract
#[cfg(test)]
mod fusion_htlc_tests {
    use super::*;
    use fusion_htlc_near::fusion_htlc::{FusionHTLCContract, HTLC, SafetyDeposit};

    #[test]
    fn test_htlc_with_safety_deposit() {
        let context = VMContextBuilder::new()
            .current_account_id(accounts(0))
            .predecessor_account_id(accounts(1))
            .attached_deposit(NearToken::from_near(1))
            .block_timestamp(1_000_000_000_000_000_000)
            .build();
        testing_env!(context);

        let mut contract = FusionHTLCContract::new();

        // Create secret and hash
        let secret = "test_secret_123";
        let secret_bytes = secret.as_bytes();
        let mut hasher = Sha256::new();
        hasher.update(secret_bytes);
        let hashlock = hex::encode(hasher.finalize());

        // Create HTLC
        let htlc_id = contract.create_htlc(accounts(2), hashlock.clone(), 3600);
        
        // Verify HTLC created
        let htlc = contract.get_htlc(htlc_id.clone()).unwrap();
        assert_eq!(htlc.sender, accounts(1));
        assert_eq!(htlc.receiver, accounts(2));
        assert_eq!(htlc.amount.0, NearToken::from_near(1).as_yoctonear());
        assert!(!htlc.withdrawn);
        assert!(!htlc.refunded);

        // Test safety deposit creation
        testing_env!(VMContextBuilder::new()
            .current_account_id(accounts(0))
            .predecessor_account_id(accounts(3)) // Resolver
            .attached_deposit(NearToken::from_millinear(100))
            .block_timestamp(1_000_000_000_000_000_000)
            .build());

        let deposit_id = contract.create_safety_deposit(htlc_id.clone());
        let deposit = contract.get_safety_deposit(deposit_id.clone()).unwrap();
        assert_eq!(deposit.resolver, accounts(3));
        assert_eq!(deposit.htlc_id, htlc_id);

        // Claim safety deposit back
        contract.claim_safety_deposit(deposit_id);
    }

    #[test]
    fn test_htlc_by_hashlock_lookup() {
        let context = VMContextBuilder::new()
            .current_account_id(accounts(0))
            .predecessor_account_id(accounts(1))
            .attached_deposit(NearToken::from_near(1))
            .block_timestamp(1_000_000_000_000_000_000)
            .build();
        testing_env!(context);

        let mut contract = FusionHTLCContract::new();
        let hashlock = hex::encode([1u8; 32]);

        let htlc_id = contract.create_htlc(accounts(2), hashlock.clone(), 3600);

        // Test lookup by hashlock
        let htlc = contract.get_htlc_by_hashlock(hashlock).unwrap();
        assert_eq!(htlc.id, htlc_id);
    }

    #[test]
    fn test_token_htlc_creation() {
        let context = VMContextBuilder::new()
            .current_account_id(accounts(0))
            .predecessor_account_id(accounts(1))
            .block_timestamp(1_000_000_000_000_000_000)
            .build();
        testing_env!(context);

        let mut contract = FusionHTLCContract::new();
        let token_id = accounts(4); // Mock token contract
        let amount = NearToken::from_near(10).as_yoctonear();
        let hashlock = hex::encode([2u8; 32]);

        let htlc_id = contract.create_token_htlc(
            token_id.clone(),
            near_sdk::json_types::U128(amount),
            accounts(2),
            hashlock,
            7200, // 2 hours
        );

        let htlc = contract.get_htlc(htlc_id).unwrap();
        assert_eq!(htlc.token_id, Some(token_id));
        assert_eq!(htlc.amount.0, amount);
    }
}

// Test the partial fills HTLC contract
#[cfg(test)]
mod fusion_htlc_partial_tests {
    use super::*;
    use fusion_htlc_near::fusion_htlc_partial::{FusionHTLCPartialContract, HTLCPartial, PartialFill};
    use near_sdk::json_types::U128;

    #[test]
    fn test_partial_fill_creation() {
        let context = VMContextBuilder::new()
            .current_account_id(accounts(0))
            .predecessor_account_id(accounts(1))
            .attached_deposit(NearToken::from_near(10))
            .block_timestamp(1_000_000_000_000_000_000)
            .build();
        testing_env!(context);

        let mut contract = FusionHTLCPartialContract::new();
        let hashlock = hex::encode([3u8; 32]);

        // Create HTLC with partial fills enabled
        let htlc_id = contract.create_htlc_partial(
            accounts(2),
            hashlock,
            3600,
            true, // allow partial fills
            U128(NearToken::from_near(1).as_yoctonear()), // min fill amount
        );

        let htlc = contract.get_htlc_partial(htlc_id.clone()).unwrap();
        assert!(htlc.allow_partial_fills);
        assert_eq!(htlc.total_amount.0, NearToken::from_near(10).as_yoctonear());
        assert_eq!(htlc.remaining_amount.0, NearToken::from_near(10).as_yoctonear());

        // Create partial fill
        testing_env!(VMContextBuilder::new()
            .current_account_id(accounts(0))
            .predecessor_account_id(accounts(3)) // Filler
            .attached_deposit(NearToken::from_near(3))
            .block_timestamp(1_000_000_000_000_000_000)
            .build());

        let fill_id = contract.create_partial_fill(
            htlc_id.clone(),
            U128(NearToken::from_near(3).as_yoctonear()),
        );

        // Verify fill created
        let fill = contract.get_partial_fill(fill_id.clone()).unwrap();
        assert_eq!(fill.filler, accounts(3));
        assert_eq!(fill.amount.0, NearToken::from_near(3).as_yoctonear());
        assert!(!fill.claimed);

        // Check HTLC updated
        let htlc = contract.get_htlc_partial(htlc_id.clone()).unwrap();
        assert_eq!(htlc.remaining_amount.0, NearToken::from_near(7).as_yoctonear());
        assert_eq!(htlc.fills.len(), 1);
    }

    #[test]
    fn test_partial_fill_withdrawal() {
        let context = VMContextBuilder::new()
            .current_account_id(accounts(0))
            .predecessor_account_id(accounts(1))
            .attached_deposit(NearToken::from_near(5))
            .block_timestamp(1_000_000_000_000_000_000)
            .build();
        testing_env!(context);

        let mut contract = FusionHTLCPartialContract::new();
        
        let secret = "partial_secret";
        let mut hasher = Sha256::new();
        hasher.update(secret.as_bytes());
        let hashlock = hex::encode(hasher.finalize());

        // Create HTLC with partial fills
        let htlc_id = contract.create_htlc_partial(
            accounts(2),
            hashlock,
            3600,
            true,
            U128(NearToken::from_near(1).as_yoctonear()),
        );

        // Create partial fill
        testing_env!(VMContextBuilder::new()
            .current_account_id(accounts(0))
            .predecessor_account_id(accounts(3))
            .attached_deposit(NearToken::from_near(2))
            .block_timestamp(1_000_000_000_000_000_000)
            .build());

        let fill_id = contract.create_partial_fill(
            htlc_id.clone(),
            U128(NearToken::from_near(2).as_yoctonear()),
        );

        // Withdraw as receiver
        testing_env!(VMContextBuilder::new()
            .current_account_id(accounts(0))
            .predecessor_account_id(accounts(2))
            .block_timestamp(1_000_000_000_000_000_000 + 1800_000_000_000)
            .build());

        contract.withdraw_partial_fill(fill_id.clone(), hex::encode(secret));

        // Verify fill claimed
        let fill = contract.get_partial_fill(fill_id).unwrap();
        assert!(fill.claimed);
        assert_eq!(fill.secret, Some(hex::encode(secret)));
    }

    #[test]
    fn test_partial_fill_refund() {
        let context = VMContextBuilder::new()
            .current_account_id(accounts(0))
            .predecessor_account_id(accounts(1))
            .attached_deposit(NearToken::from_near(5))
            .block_timestamp(1_000_000_000_000_000_000)
            .build();
        testing_env!(context);

        let mut contract = FusionHTLCPartialContract::new();
        let hashlock = hex::encode([4u8; 32]);

        let htlc_id = contract.create_htlc_partial(
            accounts(2),
            hashlock,
            3600,
            true,
            U128(NearToken::from_near(1).as_yoctonear()),
        );

        // Create partial fill
        testing_env!(VMContextBuilder::new()
            .current_account_id(accounts(0))
            .predecessor_account_id(accounts(3))
            .attached_deposit(NearToken::from_near(2))
            .block_timestamp(1_000_000_000_000_000_000)
            .build());

        let fill_id = contract.create_partial_fill(
            htlc_id.clone(),
            U128(NearToken::from_near(2).as_yoctonear()),
        );

        // Fast forward past expiry
        testing_env!(VMContextBuilder::new()
            .current_account_id(accounts(0))
            .predecessor_account_id(accounts(3))
            .block_timestamp(1_000_000_000_000_000_000 + 7200_000_000_000)
            .build());

        // Refund the fill
        contract.refund_partial_fill(fill_id.clone());

        // Verify fill removed and HTLC updated
        assert!(contract.get_partial_fill(fill_id).is_none());
        let htlc = contract.get_htlc_partial(htlc_id).unwrap();
        assert_eq!(htlc.remaining_amount.0, NearToken::from_near(5).as_yoctonear());
    }

    #[test]
    fn test_multiple_partial_fills() {
        let context = VMContextBuilder::new()
            .current_account_id(accounts(0))
            .predecessor_account_id(accounts(1))
            .attached_deposit(NearToken::from_near(10))
            .block_timestamp(1_000_000_000_000_000_000)
            .build();
        testing_env!(context);

        let mut contract = FusionHTLCPartialContract::new();
        let hashlock = hex::encode([5u8; 32]);

        let htlc_id = contract.create_htlc_partial(
            accounts(2),
            hashlock,
            3600,
            true,
            U128(NearToken::from_near(1).as_yoctonear()),
        );

        // Create multiple partial fills from different fillers
        let fill_amounts = vec![2, 3, 1, 4];
        let mut fill_ids = vec![];

        for (i, amount) in fill_amounts.iter().enumerate() {
            testing_env!(VMContextBuilder::new()
                .current_account_id(accounts(0))
                .predecessor_account_id(accounts(3 + i))
                .attached_deposit(NearToken::from_near(*amount))
                .block_timestamp(1_000_000_000_000_000_000)
                .build());

            let fill_id = contract.create_partial_fill(
                htlc_id.clone(),
                U128(NearToken::from_near(*amount).as_yoctonear()),
            );
            fill_ids.push(fill_id);
        }

        // Verify all fills created
        let htlc = contract.get_htlc_partial(htlc_id.clone()).unwrap();
        assert_eq!(htlc.fills.len(), 4);
        assert_eq!(htlc.remaining_amount.0, 0);

        // Check filler fills
        let filler_fills = contract.get_filler_fills(accounts(3));
        assert_eq!(filler_fills.len(), 1);
        assert_eq!(filler_fills[0].amount.0, NearToken::from_near(2).as_yoctonear());
    }
}