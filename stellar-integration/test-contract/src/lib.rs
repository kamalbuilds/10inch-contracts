#![no_std]
use soroban_sdk::{contract, contractimpl, Env, Symbol};

#[contract]
pub struct TestContract;

#[contractimpl]
impl TestContract {
    pub fn hello(env: Env, name: Symbol) -> Symbol {
        let _ = env;
        name
    }
}