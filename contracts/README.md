# Claw2ClawHook - P2P Order Matching on Uniswap v4

A Uniswap v4 hook that enables peer-to-peer (P2P) order matching between whitelisted bots, bypassing pool liquidity when matching orders are available.

**Trade CLAW 🐾 for ZUG ⚡ — Peer-to-peer, on-chain, on Uniswap v4!**

## Overview

Claw2ClawHook acts as an on-chain order book integrated directly into a Uniswap v4 pool. Whitelisted bots can post orders, and when another bot attempts to swap through the pool, the hook checks for matching orders and executes P2P trades directly between the maker and taker.

### Key Features

- **On-chain Order Book**: Orders stored on-chain with expiry times
- **P2P Matching**: Direct token transfers between maker and taker when orders match
- **Fallback to Pool**: If no matching order exists, swaps fall through to normal pool liquidity
- **Bot Whitelist**: Only authorized bots can post orders and swap
- **BeforeSwapDelta**: Uses custom accounting to bypass pool liquidity for P2P trades

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Claw2ClawHook Flow                       │
└─────────────────────────────────────────────────────────────┘

1. BOT A (Maker)
   │
   ├─> postOrder(sell 100 token0 for ≥95 token1)
   │   └─> Deposits 100 token0 to hook
   │       Order stored on-chain with ID, expiry
   │
2. BOT B (Taker)
   │
   ├─> Initiates swap (sell 100 token1 for token0)
   │   via PoolManager.swap()
   │
3. beforeSwap Hook
   │
   ├─> Check whitelist (Bot B authorized?)
   ├─> Search for matching orders
   │   ├─> Check: opposite direction?
   │   ├─> Check: sufficient amount?
   │   └─> Check: not expired?
   │
   ├─> IF MATCH FOUND (inline settlement):
   │   ├─> poolManager.sync(inputToken)
   │   ├─> inputToken.transfer(maker, amount)  [taker pays maker]
   │   ├─> poolManager.settle()                [account for input]
   │   ├─> poolManager.take(outputToken, taker) [taker receives]
   │   ├─> Emit P2PTrade event
   │   └─> Return BeforeSwapDelta
   │       PoolManager skips pool swap ✓
   │
   └─> IF NO MATCH:
       └─> Return BeforeSwapDelta(0, 0)
           PoolManager executes normal pool swap
```

## How P2P Matching Works

### Order Posting

```solidity
// Bot A wants to sell 100 token0 for at least 95 token1
hook.postOrder(
    poolKey,
    true,           // sellToken0 = true
    100 ether,      // amountIn
    95 ether,       // minAmountOut
    3600            // duration = 1 hour
);
```

- Tokens are transferred from maker to hook
- Order stored with unique ID and expiry timestamp
- Order added to pool's order book array

### Swap Matching

When Bot B swaps through the pool:

```solidity
poolManager.swap(
    poolKey,
    SwapParams({
        zeroForOne: false,      // selling token1 for token0
        amountSpecified: -100,  // exact input: 100 token1
        sqrtPriceLimitX96: 0
    }),
    ...
);
```

The `beforeSwap` hook:

1. **Checks whitelist** - Reverts if Bot B is not authorized
2. **Searches orders** - Iterates through active orders for this pool
3. **Validates match**:
   - Direction: Bot A sells token0, Bot B sells token1 (opposite) ✓
   - Amount: Bot B offers 100 token1 ≥ Bot A's minAmountOut (95) ✓
   - Expiry: Order not expired ✓
4. **Executes P2P**:
   - Bot B → Bot A: 100 token1 (taker input)
   - Hook → Bot B: 100 token0 (maker's deposited tokens)
5. **Returns BeforeSwapDelta**:
   - `specifiedDelta = -100` (hook handled taker's input)
   - `unspecifiedDelta = +100` (hook provided taker's output)
   - PoolManager sees the swap is complete, skips pool liquidity

### BeforeSwapDelta Explained

`BeforeSwapDelta` is a packed int256 with two int128 values:

```
┌────────────────┬────────────────┐
│  Upper 128bits │  Lower 128bits │
│ specifiedDelta │ unspecifiedDelta│
└────────────────┴────────────────┘
```

- **specifiedDelta**: Amount of the "specified" token (the one the user is selling)
  - Negative = hook consumed tokens from user
- **unspecifiedDelta**: Amount of the "unspecified" token (the one the user is receiving)
  - Positive = hook provided tokens to user

When the hook returns non-zero deltas, the PoolManager adjusts the swap accordingly and may skip pool liquidity entirely.

## Deployment

### Prerequisites

```bash
# Install dependencies
forge install

# Set up environment
export PRIVATE_KEY=0x...
export BASESCAN_API_KEY=...
```

### Deploy to Base Sepolia

```bash
source /root/.bashrc
forge script script/DeployClaw2Claw.s.sol:DeployClaw2Claw \
    --rpc-url base_sepolia \
    --broadcast \
    --verify
```

### What Gets Deployed

1. **MockTokens** (CLAW - Claw Token, ZUG - Zug Gold)
2. **CREATE2 Factory** (for address mining)
3. **Claw2ClawHook** (with correct flag bits)
4. **Pool Initialization** (CLAW/ZUG pool)
5. **Liquidity Addition** (initial liquidity for fallback swaps)
6. **Test Swap** (verify everything works)

### Hook Address Requirements

The hook must have specific flag bits set in its address:

```
Flags needed:
  BEFORE_SWAP                = 0x100 (bit 8)
  AFTER_SWAP                 = 0x080 (bit 7)
  BEFORE_SWAP_RETURNS_DELTA  = 0x008 (bit 3)
  Total                      = 0x188
```

The deployment script mines a CREATE2 salt to find an address with the correct flags.

## Testing

```bash
# Run all tests
forge test -vvv

# Run specific test
forge test --match-test test_p2pMatch_success -vvvv

# Run with gas report
forge test --gas-report
```

### Test Coverage

- ✅ Admin functions (add/remove bot, set admin)
- ✅ Order posting and cancellation
- ✅ P2P matching with exact amounts
- ✅ No match scenarios (same direction, insufficient amount)
- ✅ Expired order handling
- ✅ Whitelist enforcement
- ✅ Event emissions
- ✅ Balance transfers

## Contract Addresses

### Base Sepolia (Testnet) — Latest Deployment

| Contract | Address |
|----------|---------|
| PoolManager (v4) | [`0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408`](https://sepolia.basescan.org/address/0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408) |
| PoolSwapTest | [`0x8B5bcC363ddE2614281aD875bad385E0A785D3B9`](https://sepolia.basescan.org/address/0x8B5bcC363ddE2614281aD875bad385E0A785D3B9) |
| PoolModifyLiquidityTest | [`0x37429cD17Cb1454C34E7F50b09725202Fd533039`](https://sepolia.basescan.org/address/0x37429cD17Cb1454C34E7F50b09725202Fd533039) |
| **Claw2ClawHook** | [`0xb763CfE00E3a7E552B49C5ce49199453Ce180188`](https://sepolia.basescan.org/address/0xb763CfE00E3a7E552B49C5ce49199453Ce180188) |
| **ZUG ⚡** (token0) | [`0x6ed19fd21fef1cc526e924a8e084f71bdadc8fe7`](https://sepolia.basescan.org/address/0x6ed19fd21fef1cc526e924a8e084f71bdadc8fe7) |
| **CLAW 🐾** (token1) | [`0x6f8e2f0943f94ca95fa72d8098d215d8b33643fa`](https://sepolia.basescan.org/address/0x6f8e2f0943f94ca95fa72d8098d215d8b33643fa) |

### Verified P2P Trade

| Description | Link |
|-------------|------|
| Successful P2P swap (Bot A ↔ Bot B) | [`0x731dca5d...`](https://sepolia.basescan.org/tx/0x731dca5d057d0da5d897854003cad556f6b3f4ed525b420ecfd2a0f4965a4cf6) |

## Usage Example

### 1. Whitelist Bots

```solidity
// Admin whitelists Bot A and Bot B
hook.addBot(botA);
hook.addBot(botB);
```

### 2. Bot A Posts Order

```solidity
// Approve hook to spend CLAW tokens
claw.approve(address(hook), 100 ether);

// Post order: sell 100 CLAW for at least 95 ZUG, valid for 1 hour
uint256 orderId = hook.postOrder(
    poolKey,
    true,       // selling CLAW (token0)
    100 ether,
    95 ether,
    3600
);
```

### 3. Bot B Swaps (P2P Match)

```solidity
// Approve ZUG tokens for swap
zug.approve(address(poolSwapTest), 100 ether);

// Execute swap - will match Bot A's order
poolSwapTest.swap(
    poolKey,
    IPoolManager.SwapParams({
        zeroForOne: false,      // selling ZUG for CLAW
        amountSpecified: -100 ether,
        sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
    }),
    TestSettings({takeClaims: false, settleUsingBurn: false}),
    ""
);

// Result: Bot A and Bot B traded CLAW<>ZUG directly, pool liquidity not touched ✨
```

### 4. Cancel Order (Optional)

```solidity
// Bot A cancels unfilled order
hook.cancelOrder(orderId, poolKey);
// Tokens returned to Bot A
```

## Security Considerations

- **Whitelist Only**: Only authorized bots can interact
- **Expiry Protection**: Orders automatically expire
- **Maker Authorization**: Only maker can cancel their order
- **Amount Validation**: Ensures maker's minAmountOut is satisfied
- **Direction Validation**: Only matches opposite-direction orders

## Gas Optimization Notes

- Uses `via_ir` compilation for complex functions
- Order array is unbounded (consider cleanup for production)
- P2P transfers avoid pool swap gas costs
- BeforeSwapDelta pattern is gas-efficient (no state changes in PoolManager)

## Future Improvements

- [ ] Partial order fills
- [ ] Order expiry cleanup mechanism
- [ ] Price limit orders (not just minAmountOut)
- [ ] Multi-pool order matching
- [ ] Order priority/FIFO queue
- [ ] Gas rebates for P2P trades

## Development

```bash
# Build
forge build

# Test
forge test

# Format
forge fmt

# Coverage
forge coverage

# Deploy locally
anvil
forge script script/DeployClaw2Claw.s.sol --fork-url http://localhost:8545
```

## License

MIT

## Bot Test Wallets

For Base Sepolia integration testing:

- **Bot A (Maker)**: `0xc59735585d649dF2e9eE7C80a9D36a3589DF167b`
- **Bot B (Taker)**: `0x721A42aa5937A2a6873BeE272f94F2BFB747C6Ba`
- **Deployer**: `0x767Df23E77416299E4328cDFe6Bc68Ed8D17C9a8`

These are used for live P2P order matching tests on Base Sepolia.
