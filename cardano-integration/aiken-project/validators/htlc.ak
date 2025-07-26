use aiken/crypto
use aiken/hash.{Blake2b_224, Hash}
use aiken/interval.{Finite}
use aiken/list
use aiken/transaction.{ScriptContext, Spend}
use aiken/transaction/credential.{VerificationKey}

pub type VerificationKeyHash =
  Hash<Blake2b_224, VerificationKey>

pub type HTLCDatum {
  secret_hash: ByteArray,
  recipient: VerificationKeyHash,
  sender: VerificationKeyHash,
  timeout: Int,
  amount: Int,
  min_partial_amount: Int,
}

pub type HTLCRedeemer {
  ClaimWithSecret { secret: ByteArray, partial_amount: Option<Int> }
  ClaimTimeout
}

validator htlc(datum: HTLCDatum, redeemer: HTLCRedeemer, ctx: ScriptContext) {
  expect Spend(_) = ctx.purpose
  
  let ScriptContext { transaction, .. } = ctx

  when redeemer is {
    ClaimWithSecret { secret, partial_amount } -> {
      // Verify the secret hash
      let secret_valid = crypto.sha2_256(secret) == datum.secret_hash
      
      // Check if recipient signed
      let signed_by_recipient = 
        list.has(transaction.extra_signatories, datum.recipient)
      
      // For partial fills
      when partial_amount is {
        Some(amount) -> {
          let valid_amount = 
            amount >= datum.min_partial_amount && amount <= datum.amount
          secret_valid && signed_by_recipient && valid_amount
        }
        None -> secret_valid && signed_by_recipient
      }
    }
    
    ClaimTimeout -> {
      // Check timeout
      let after_timeout = when transaction.validity_range.upper_bound.bound_type is {
        Finite(upper_time) -> upper_time > datum.timeout
        _ -> False
      }
      
      // Check if sender signed
      let signed_by_sender = 
        list.has(transaction.extra_signatories, datum.sender)
      
      after_timeout && signed_by_sender
    }
  }
}