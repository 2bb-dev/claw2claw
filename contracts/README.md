# Claw2ClawHook — P2P Order Matching on Uniswap v4

A Uniswap v4 hook that enables permissionless peer-to-peer (P2P) order matching between bots, bypassing pool liquidity when matching orders are available.

**Trade CLAW 🐾 for ZUG ⚡ — Peer-to-peer, on-chain, on Uniswap v4!**

## Overview

Claw2ClawHook acts as an on-chain order book integrated directly into a Uniswap v4 pool. Any bot can post orders, and when another bot attempts to swap through the pool, the hook checks for matching orders and executes P2P trades directly between the maker and taker.

### Key Features

- **On-chain Order Book**: Orders stored on-chain with expiry times
- **P2P Matching**: Direct token transfers between maker and taker when orders match
- **Fallback to Pool**: If no matching order exists, swaps fall through to normal pool liquidity
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
   ├─> Check for matching orders
   ├─> Search for matching orders
   │   ├─> Check: opposite direction?
   │   ├─> Check: sufficient amount?
   │   └─> Check: not expired?
   │
   ├─> IF MATCH FOUND (inline settlement):
   │   ├─> poolManager.take(inputToken, maker)   [PM sends taker's input to maker]
   │   ├─> poolManager.sync(outputToken)          [snapshot output balance]
   │   ├─> outputToken.transfer(PM, amount)       [hook sends escrowed tokens to PM]
   │   ├─> poolManager.settle()                   [account for output]
   │   ├─> Emit P2PTrade event
   │   └─> Return BeforeSwapDelta
   │       PoolManager skips pool swap ✓
   │
   └─> IF NO MATCH:
       └─> Return BeforeSwapDelta(0, 0)
           PoolManager executes normal pool swap
```

## Deep Technical Breakdown

### Hook Permission Flags

Our hook address must end in `0x188`, encoding three permission bits:

| Flag | Value | Purpose |
|------|-------|---------|
| `BEFORE_SWAP` | `0x100` (bit 8) | Pool Manager calls us before every swap |
| `AFTER_SWAP` | `0x080` (bit 7) | Called after swap (we use it as a no-op) |
| `BEFORE_SWAP_RETURNS_DELTA` | `0x008` (bit 3) | Lets us return custom token deltas |
| **Total** | **`0x188`** | Combined flag bits |

We mine this address using **CREATE2** — iterate salts until we find one that produces an address with the right suffix.

### The Swap Lifecycle

When Bot B calls `poolManager.swap()`:

1. **Pool Manager enters its unlock context** (a reentrancy-safe callback pattern)
2. It sees our hook has `BEFORE_SWAP` flag → calls `hook.beforeSwap()`
3. We're now executing **inside the PM's unlock context**, which means we can call `sync`, `settle`, and `take` directly

### Order Matching (inside `beforeSwap`)

```
1. Read swap params: direction (zeroForOne), amount
2. Iterate orders[] for this pool
3. For each order, check:
   ├─ Opposite direction? (maker sells token0, taker sells token1)
   ├─ Amount sufficient? (taker offers ≥ maker's minAmountOut)
   └─ Not expired? (block.timestamp <= order.expiry)
4. First valid match wins
```

### Inline Settlement (the key innovation)

When a match is found, **all settlement happens right there in `beforeSwap`**:

```solidity
// 1. Take taker's input FROM PM to maker
poolManager.take(inputCurrency, maker, takerAmountIn);

// 2. Settle maker's escrowed output TO PM
poolManager.sync(outputCurrency);
outputToken.transfer(address(poolManager), amount);
poolManager.settle();
```

### BeforeSwapDelta Return

We return a packed `int256` with two `int128` values:

```
┌────────────────┬─────────────────┐
│  Upper 128bits │  Lower 128bits  │
│ specifiedDelta │ unspecifiedDelta │
└────────────────┴─────────────────┘

specifiedDelta   = +amount  → "we handled the input"
unspecifiedDelta = -amount  → "we provided the output"
```

When PM sees non-zero deltas, it adjusts the swap math. Since we handled the full amount, **the AMM curve is completely skipped** — no tick crossing, no `sqrt(P)` math, no LP interaction.

### No Match → Normal AMM

If no order matches, we return `BeforeSwapDelta(0, 0)` and the swap proceeds through the constant product formula as if our hook wasn't there.

### Order Storage

| Operation | Mechanism |
|-----------|-----------|
| **Storage** | `mapping(uint256 => Order)` for order structs + `mapping(bytes32 => uint256[])` for per-pool order ID arrays |
| **Post** | Maker approves hook → `transferFrom` tokens into hook → push order ID to pool array |
| **Match** | Mark inactive, swap-and-pop remove from array, transfer escrowed tokens to taker via PM |
| **Cancel** | Maker calls to reclaim escrowed tokens, swap-and-pop remove from array |
| **Cleanup** | `purgeExpiredOrders()` — permissionless, removes expired orders and refunds makers |

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

1. **Validates swap params** - Only handles exact-input swaps
2. **Searches orders** - Iterates through active orders for this pool
3. **Validates match**:
   - Direction: Bot A sells token0, Bot B sells token1 (opposite) ✓
   - Amount: Bot B offers 100 token1 ≥ Bot A's minAmountOut (95) ✓
   - Expiry: Order not expired ✓
4. **Executes P2P**:
   - Bot B → Bot A: 100 token1 (taker input)
   - Hook → Bot B: 100 token0 (maker's deposited tokens)
5. **Returns BeforeSwapDelta**:
   - `specifiedDelta = +100` (hook handled taker's input)
   - `unspecifiedDelta = -100` (hook provided taker's output)
   - PoolManager sees the swap is complete, skips pool liquidity

## Deployment

### Prerequisites

```bash
# Install dependencies
forge install

# Set up environment
cp .env.example .env
# Edit .env with your private keys
```

### Deploy to Base Sepolia

```bash
source .env
forge script script/DeployClaw2Claw.s.sol:DeployClaw2Claw \
    --rpc-url base_sepolia \
    --broadcast \
    --verify
```

### What Gets Deployed

1. **MockTokens** (CLAW - Claw Token, ZUG - Zug Gold)
2. **CREATE2 Factory** (for address mining)
3. **Claw2ClawHook** (with correct flag bits `0x188`)
4. **Pool Initialization** (CLAW/ZUG pool)
5. **Liquidity Addition** (initial liquidity for fallback swaps)
6. **Test Swap** (verify everything works)

## Testing

```bash
# Install dependencies first
forge install

# Run all tests (27 tests)
forge test -vvv

# Run specific test
forge test --match-test test_p2pMatch_success -vvvv

# Run with gas report
forge test --gas-report
```

### Test Architecture

Tests use a **MockPoolManager contract** (not an EOA) that:
- Tracks `take()`, `sync()`, and `settle()` calls
- Performs real ERC20 token transfers
- Allows full settlement verification in unit tests

This means our tests verify the **complete P2P settlement flow**:
- ✅ Token balances change correctly (maker receives, escrow drains)
- ✅ PM receives escrowed tokens via `settle()`
- ✅ PM sends input tokens to maker via `take()`
- ✅ BeforeSwapDelta values are correct (specified + unspecified)

### Test Coverage (34 tests)

| Category | Tests | What's Verified |
|----------|-------|-----------------|
| **Admin** | 2 | two-step setAdmin/acceptAdmin |
| **Order Posting** | 5 | Success, escrow transfer, events, zero-amount/duration reverts, max duration |
| **Order Cancellation** | 5 | Success, refund, events, unauthorized, double-cancel, cross-pool theft prevention |
| **P2P Matching** | 6 | Full settlement (both directions), token balances, multi-order, skip-filled |
| **No Match** | 2 | Same direction, insufficient amount |
| **View Functions** | 1 | getPoolOrders |
| **afterSwap** | 1 | No-op verification |
| **Access Control** | 2 | Non-PM caller revert, exact-output fallthrough |
| **Cleanup** | 1 | purgeExpiredOrders |
| **Security** | 1 | Cancel order cross-pool key mismatch |

## Contract Addresses

### Base Mainnet (Production)

| Contract | Address |
|----------|---------|
| Uniswap v4 PoolManager | [`0x498581fF718922c3f8e6A244956aF099B2652b2b`](https://basescan.org/address/0x498581fF718922c3f8e6A244956aF099B2652b2b) |
| **Claw2ClawHook** | [`0x9114Ff08A837d0F8F9db23234Bf99794131FC188`](https://basescan.org/address/0x9114Ff08A837d0F8F9db23234Bf99794131FC188) |
| CREATE2 Factory | [`0x06AfaaB8e1CBCaDd0D921fb1E7F5226052693D69`](https://basescan.org/address/0x06AfaaB8e1CBCaDd0D921fb1E7F5226052693D69) |
| SimpleSwapRouter | [`0xe5b4A4dF8387858852B861B36AB5B512d7838346`](https://basescan.org/address/0xe5b4A4dF8387858852B861B36AB5B512d7838346) |

#### Verified Mainnet P2P Trade (USDC ↔ WETH)

| Step | Transaction |
|------|-------------|
| Hook deployed (CREATE2, salt 1667) | [`0xc64fbdd4...`](https://basescan.org/tx/0xc64fbdd4607b4790b6eb0792ffcf62e57ef2c95cbc6a30cb48e138c90c7ff165) |
| Bot A posted order (sell 21 USDC for ≥0.01 WETH) | [`0x42820e9c...`](https://basescan.org/tx/0x42820e9c061876b73aea3849fc2f12a2ec9ceb7157347843bc3f037318d2ccad) |
| **Bot B P2P swap (21 USDC ↔ 0.01 WETH matched!)** | [`0x997a5226...`](https://basescan.org/tx/0x997a52269597da128a581848372006e09771afb2d0ccbff3ed5197f0a0baeada) |

## Usage Example

### 1. Bot A Posts Order

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

### 2. Bot B Swaps (P2P Match)

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

// Result: Bot A and Bot B traded CLAW<>ZUG directly, pool liquidity not touched
```

### 3. Cancel Order (Optional)

```solidity
// Bot A cancels unfilled order
hook.cancelOrder(orderId, poolKey);
// Tokens returned to Bot A
```

## Security Considerations

- **Permissionless**: Any address can post orders and trade
- **Expiry Protection**: Orders automatically expire
- **Maker Authorization**: Only maker can cancel their order
- **Amount Validation**: Ensures maker's minAmountOut is satisfied
- **Direction Validation**: Only matches opposite-direction orders
- **CEI Pattern**: State changes before external calls (order.active = false before transfers)

## Gas Optimization Notes

- Uses `via_ir` compilation for complex functions
- Order array uses swap-and-pop cleanup for filled/cancelled orders
- Expired orders that are never matched may still remain (consider periodic cleanup for production)
- P2P transfers avoid pool swap gas costs
- BeforeSwapDelta pattern is gas-efficient (no state changes in PoolManager)

## Future Improvements

- [ ] Partial order fills
- [ ] Order expiry cleanup mechanism
- [ ] Best-price order selection (not first-match)
- [ ] Multi-pool order matching
- [ ] Order priority/FIFO queue
- [ ] Gas rebates for P2P trades

## Development

```bash
# Build
forge build

# Test
forge test -vvv

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
