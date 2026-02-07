// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title TestP2PMainnet
/// @notice E2E test: Bot A sells USDC, Bot B buys with WETH, matched P2P via hook

import "forge-std/Script.sol";
import {Claw2ClawHook} from "../src/Claw2ClawHook.sol";
import {IPoolManager} from "@v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "@v4-core/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "@v4-core/types/Currency.sol";
import {IHooks} from "@v4-core/interfaces/IHooks.sol";
import {TickMath} from "@v4-core/libraries/TickMath.sol";
import {TransientStateLibrary} from "@v4-core/libraries/TransientStateLibrary.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";

interface IWETH {
    function deposit() external payable;
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

/// @dev Minimal swap router that handles unlock callback for v4 swaps
contract SimpleSwapRouter {
    using CurrencyLibrary for Currency;
    using TransientStateLibrary for IPoolManager;

    IPoolManager public immutable PM;

    struct SwapContext {
        PoolKey key;
        IPoolManager.SwapParams params;
        address caller;
    }

    constructor(IPoolManager _pm) {
        PM = _pm;
    }

    function swap(PoolKey calldata key, IPoolManager.SwapParams calldata params) external {
        PM.unlock(abi.encode(SwapContext({key: key, params: params, caller: msg.sender})));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(PM), "only PM");

        SwapContext memory ctx = abi.decode(data, (SwapContext));
        PM.swap(ctx.key, ctx.params, bytes(""));

        // After swap (which may have been fully handled by the hook), check
        // what this router actually owes/is owed by looking at the PM's ledger.
        int256 d0 = PM.currencyDelta(address(this), ctx.key.currency0);
        int256 d1 = PM.currencyDelta(address(this), ctx.key.currency1);

        if (d0 < 0) {
            // We owe token0 to PM: sync → transferFrom → settle
            uint256 owed = uint256(-d0);
            PM.sync(ctx.key.currency0);
            IERC20(Currency.unwrap(ctx.key.currency0)).transferFrom(ctx.caller, address(PM), owed);
            PM.settle();
        } else if (d0 > 0) {
            PM.take(ctx.key.currency0, ctx.caller, uint256(d0));
        }

        if (d1 < 0) {
            uint256 owed = uint256(-d1);
            PM.sync(ctx.key.currency1);
            IERC20(Currency.unwrap(ctx.key.currency1)).transferFrom(ctx.caller, address(PM), owed);
            PM.settle();
        } else if (d1 > 0) {
            PM.take(ctx.key.currency1, ctx.caller, uint256(d1));
        }

        return bytes("");
    }
}

contract TestP2PMainnet is Script {
    // --- Base mainnet addresses ---
    address constant HOOK = 0xcCFAf7E2c4C46064aF5Df6dB6a22A377a2d10188;
    address constant POOL_MANAGER = 0x498581fF718922c3f8e6A244956aF099B2652b2b;
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    function run() external {
        uint256 adminKey = vm.envUint("PRIVATE_KEY");
        uint256 botAKey = vm.envUint("BOT_A_KEY");
        uint256 botBKey = vm.envUint("BOT_B_KEY");

        address admin = vm.addr(adminKey);
        address botA = vm.addr(botAKey);
        address botB = vm.addr(botBKey);

        console.log("=== Claw2Claw P2P Trade Test (Base Mainnet) ===");
        console.log("Admin: ", admin);
        console.log("Bot A (maker, sells USDC):", botA);
        console.log("Bot B (taker, buys USDC):", botB);

        // --- Pool key ---
        // WETH < USDC (0x42... < 0x83...) so token0 = WETH, token1 = USDC
        PoolKey memory poolKey = PoolKey({
            currency0: Currency.wrap(WETH),
            currency1: Currency.wrap(USDC),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(HOOK)
        });

        // =============================================
        // PHASE 1: Admin setup
        // =============================================
        console.log("");
        console.log("--- Phase 1: Admin setup ---");

        vm.startBroadcast(adminKey);

        // Deploy our own swap router (PoolSwapTest is NOT on mainnet)
        SimpleSwapRouter router = new SimpleSwapRouter(IPoolManager(POOL_MANAGER));
        console.log("SimpleSwapRouter deployed:", address(router));

        // Whitelist bots + router
        Claw2ClawHook hook = Claw2ClawHook(HOOK);
        hook.addBot(botA);
        hook.addBot(botB);
        hook.addBot(address(router));
        console.log("Bots + router whitelisted");

        // Initialize pool (WETH/USDC with our hook)
        // sqrtPriceX96 for ~$2500 ETH: sqrt(2500 * 10^6 / 10^18) * 2^96
        uint160 sqrtPriceX96 = 3961408125713216879677198;
        IPoolManager(POOL_MANAGER).initialize(poolKey, sqrtPriceX96);
        console.log("Pool initialized (WETH/USDC with Claw2ClawHook)");

        vm.stopBroadcast();

        // =============================================
        // PHASE 2: Bot A posts a sell order (sells 5 USDC for WETH)
        // =============================================
        console.log("");
        console.log("--- Phase 2: Bot A posts order ---");

        vm.startBroadcast(botAKey);

        uint256 usdcBal = IERC20(USDC).balanceOf(botA);
        console.log("Bot A USDC balance:", usdcBal);

        // Approve hook to pull USDC
        IERC20(USDC).approve(HOOK, type(uint256).max);

        // Sell 5 USDC, want at least 0.001 WETH (~$2.50, basically any amount)
        // sellToken0 = false because USDC is token1
        uint256 orderId = hook.postOrder(
            poolKey,
            false,          // selling token1 (USDC)
            5_000_000,      // 5 USDC (6 decimals)
            1_000_000_000_000_000, // min 0.001 WETH (18 decimals) — ~$2.50
            3600            // 1 hour expiry
        );
        console.log("Order posted! ID:", orderId);

        vm.stopBroadcast();

        // =============================================
        // PHASE 3: Bot B swaps WETH for USDC (triggers P2P match)
        // =============================================
        console.log("");
        console.log("--- Phase 3: Bot B swaps (P2P match) ---");

        vm.startBroadcast(botBKey);

        // Wrap some ETH to WETH
        IWETH(WETH).deposit{value: 0.005 ether}();
        console.log("Bot B wrapped 0.005 ETH to WETH");

        // Approve router to pull WETH
        IERC20(WETH).approve(address(router), type(uint256).max);

        // Swap: WETH → USDC (zeroForOne = true)
        // amountSpecified = -0.002 ether (exact input, negative = exact input in v4)
        // This should match Bot A's order (Bot A wants min 0.001 WETH, we're offering 0.002)
        router.swap(
            poolKey,
            IPoolManager.SwapParams({
                zeroForOne: true,
                amountSpecified: -0.002 ether,
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            })
        );
        console.log("Swap executed! P2P trade should have matched.");

        vm.stopBroadcast();

        // =============================================
        // PHASE 4: Verify results
        // =============================================
        console.log("");
        console.log("=== Results ===");
        console.log("Bot A USDC after:", IERC20(USDC).balanceOf(botA));
        console.log("Bot A WETH after:", IERC20(WETH).balanceOf(botA));
        console.log("Bot B USDC after:", IERC20(USDC).balanceOf(botB));
        console.log("Bot B WETH after:", IERC20(WETH).balanceOf(botB));
    }
}
