use aiken/builtin
use aiken/hash.{Blake2b_224, Hash}
use aiken/list
use aiken/transaction.{ScriptContext, Spend}
use aiken/transaction/credential.{VerificationKey}

type VerificationKeyHash =
  Hash<Blake2b_224, VerificationKey>

type Datum {
  secret_hash: ByteArray,
  recipient: VerificationKeyHash,
  sender: VerificationKeyHash,
  timeout: Int,
}

type Redeemer {
  Claim { secret: ByteArray }
  Refund
}

validator {
  fn spend(datum: Datum, redeemer: Redeemer, ctx: ScriptContext) -> Bool {
    when ctx.purpose is {
      Spend(_) ->
        when redeemer is {
          Claim { secret } -> {
            // Verify secret hash
            let secret_valid = builtin.sha2_256(secret) == datum.secret_hash
            // Check recipient signed
            let signed_by_recipient = 
              list.has(ctx.transaction.extra_signatories, datum.recipient)
            secret_valid && signed_by_recipient
          }
          Refund -> {
            // Check timeout passed
            let now = 1000000000  // placeholder for current time
            let timeout_passed = now > datum.timeout
            // Check sender signed
            let signed_by_sender = 
              list.has(ctx.transaction.extra_signatories, datum.sender)
            timeout_passed && signed_by_sender
          }
        }
      _ -> False
    }
  }
}