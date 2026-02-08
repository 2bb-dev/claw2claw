// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {Claw2ClawHook} from "../src/Claw2ClawHook.sol";
import {MockToken} from "../src/MockToken.sol";
import {MockPoolManager} from "./mocks/MockPoolManager.sol";
import {IPoolManager} from "@v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "@v4-core/types/PoolKey.sol";
import {Currency} from "@v4-core/types/Currency.sol";
import {IHooks} from "@v4-core/interfaces/IHooks.sol";
import {BalanceDelta, toBalanceDelta} from "@v4-core/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@v4-core/types/BeforeSwapDelta.sol";

contract Claw2ClawHookTest is Test {
    Claw2ClawHook hook;
    MockPoolManager mockPM;
    MockToken token0;
    MockToken token1;

    address admin = address(0xAD);
    address botA = 0x9cC66E3EF95F5b24a5c006394a18994380EdEC46;
    address botB = 0xEF464bA95f07e97eaE7a3D717D5F49Dfc5cAC634;
    address notBot = address(0xBAD);

    PoolKey poolKey;

    function setUp() public {
        // Deploy proper mock PM (contract, not EOA)
        mockPM = new MockPoolManager();

        // Deploy hook with mock PM
        hook = new Claw2ClawHook(admin, IPoolManager(address(mockPM)));

        // Deploy tokens (sorted)
        token0 = new MockToken("Token A", "TKA", 18);
        token1 = new MockToken("Token B", "TKB", 18);

        // Ensure token0 < token1
        if (address(token0) > address(token1)) {
            (token0, token1) = (token1, token0);
        }

        poolKey = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });

        // Whitelist bots
        vm.startPrank(admin);
        hook.addBot(botA);
        hook.addBot(botB);
        vm.stopPrank();

        // Mint tokens to bots
        token0.mint(botA, 1000 ether);
        token1.mint(botA, 1000 ether);
        token0.mint(botB, 1000 ether);
        token1.mint(botB, 1000 ether);

        // Mint tokens to MockPM (simulates pool holding liquidity for take() calls)
        token0.mint(address(mockPM), 10_000 ether);
        token1.mint(address(mockPM), 10_000 ether);

        // Approve hook for bot deposits
        vm.prank(botA);
        token0.approve(address(hook), type(uint256).max);
        vm.prank(botA);
        token1.approve(address(hook), type(uint256).max);

        vm.prank(botB);
        token0.approve(address(hook), type(uint256).max);
        vm.prank(botB);
        token1.approve(address(hook), type(uint256).max);
    }

    // ── Admin tests ─────────────────────────────────────────────────

    function test_addBot() public {
        address newBot = address(0x123);
        assertFalse(hook.allowedBots(newBot));

        vm.prank(admin);
        hook.addBot(newBot);

        assertTrue(hook.allowedBots(newBot));
    }

    function test_addBot_emitsEvent() public {
        address newBot = address(0x123);

        vm.expectEmit(true, false, false, false);
        emit Claw2ClawHook.BotAdded(newBot);

        vm.prank(admin);
        hook.addBot(newBot);
    }

    function test_removeBot() public {
        vm.prank(admin);
        hook.removeBot(botA);

        assertFalse(hook.allowedBots(botA));
    }

    function test_removeBot_emitsEvent() public {
        vm.expectEmit(true, false, false, false);
        emit Claw2ClawHook.BotRemoved(botA);

        vm.prank(admin);
        hook.removeBot(botA);
    }

    function test_addBot_revert_notAdmin() public {
        vm.prank(notBot);
        vm.expectRevert(Claw2ClawHook.NotAdmin.selector);
        hook.addBot(address(0x123));
    }

    // M-2: two-step admin transfer
    function test_setAdmin_twoStep() public {
        vm.prank(admin);
        hook.setAdmin(botA);
        // admin should NOT have changed yet
        assertEq(hook.admin(), admin);
        assertEq(hook.pendingAdmin(), botA);

        // botA accepts
        vm.prank(botA);
        hook.acceptAdmin();
        assertEq(hook.admin(), botA);
        assertEq(hook.pendingAdmin(), address(0));
    }

    function test_acceptAdmin_revert_notPending() public {
        vm.prank(admin);
        hook.setAdmin(botA);

        vm.prank(botB);
        vm.expectRevert(Claw2ClawHook.NotPendingAdmin.selector);
        hook.acceptAdmin();
    }

    // ── Order posting tests ─────────────────────────────────────────

    function test_postOrder_success() public {
        uint256 balanceBefore = token0.balanceOf(botA);

        vm.prank(botA);
        uint256 orderId = hook.postOrder(
            poolKey,
            true, // sell token0
            100 ether,
            90 ether,
            3600 // 1 hour
        );

        assertEq(orderId, 0);

        // Check order was stored (now includes poolId)
        (
            address maker,
            bool sellToken0,
            uint128 amountIn,
            uint128 minAmountOut,
            uint256 expiry,
            bool active,
            bytes32 poolId
        ) = hook.orders(orderId);

        assertEq(maker, botA);
        assertTrue(sellToken0);
        assertEq(amountIn, 100 ether);
        assertEq(minAmountOut, 90 ether);
        assertTrue(active);
        assertEq(expiry, block.timestamp + 3600);
        assertEq(poolId, keccak256(abi.encode(poolKey)));

        // Check tokens were transferred to hook (escrow)
        assertEq(token0.balanceOf(botA), balanceBefore - 100 ether);
        assertEq(token0.balanceOf(address(hook)), 100 ether);
    }

    function test_postOrder_emitsEvent() public {
        vm.expectEmit(true, true, false, true);
        emit Claw2ClawHook.OrderPosted(
            0,
            botA,
            true,
            100 ether,
            90 ether,
            block.timestamp + 3600
        );

        vm.prank(botA);
        hook.postOrder(poolKey, true, 100 ether, 90 ether, 3600);
    }

    function test_postOrder_revert_notWhitelisted() public {
        vm.prank(notBot);
        vm.expectRevert(Claw2ClawHook.NotWhitelisted.selector);
        hook.postOrder(poolKey, true, 100 ether, 90 ether, 3600);
    }

    function test_postOrder_revert_zeroAmount() public {
        vm.prank(botA);
        vm.expectRevert(Claw2ClawHook.InvalidAmounts.selector);
        hook.postOrder(poolKey, true, 0, 90 ether, 3600);
    }

    function test_postOrder_revert_zeroDuration() public {
        vm.prank(botA);
        vm.expectRevert(Claw2ClawHook.InvalidDuration.selector);
        hook.postOrder(poolKey, true, 100 ether, 90 ether, 0);
    }

    // L-1: duration cap
    function test_postOrder_revert_durationTooLong() public {
        vm.prank(botA);
        vm.expectRevert(Claw2ClawHook.DurationTooLong.selector);
        hook.postOrder(poolKey, true, 100 ether, 90 ether, 31 days);
    }

    function test_postOrder_multipleOrders() public {
        vm.prank(botA);
        uint256 orderId1 = hook.postOrder(poolKey, true, 100 ether, 90 ether, 3600);

        vm.prank(botB);
        uint256 orderId2 = hook.postOrder(poolKey, false, 50 ether, 45 ether, 3600);

        assertEq(orderId1, 0);
        assertEq(orderId2, 1);
    }

    // ── Cancel order tests ──────────────────────────────────────────

    function test_cancelOrder_success() public {
        vm.prank(botA);
        uint256 orderId = hook.postOrder(poolKey, true, 100 ether, 90 ether, 3600);

        uint256 balanceBefore = token0.balanceOf(botA);

        vm.prank(botA);
        hook.cancelOrder(orderId, poolKey);

        // Check order is inactive
        (,,,,,bool active,) = hook.orders(orderId);
        assertFalse(active);

        // Check tokens returned to maker
        assertEq(token0.balanceOf(botA), balanceBefore + 100 ether);
        assertEq(token0.balanceOf(address(hook)), 0);
    }

    function test_cancelOrder_emitsEvent() public {
        vm.prank(botA);
        uint256 orderId = hook.postOrder(poolKey, true, 100 ether, 90 ether, 3600);

        vm.expectEmit(true, true, false, false);
        emit Claw2ClawHook.OrderCancelled(orderId, botA);

        vm.prank(botA);
        hook.cancelOrder(orderId, poolKey);
    }

    function test_cancelOrder_revert_unauthorized() public {
        vm.prank(botA);
        uint256 orderId = hook.postOrder(poolKey, true, 100 ether, 90 ether, 3600);

        vm.prank(botB);
        vm.expectRevert(Claw2ClawHook.Unauthorized.selector);
        hook.cancelOrder(orderId, poolKey);
    }

    function test_cancelOrder_revert_alreadyCancelled() public {
        vm.prank(botA);
        uint256 orderId = hook.postOrder(poolKey, true, 100 ether, 90 ether, 3600);

        vm.prank(botA);
        hook.cancelOrder(orderId, poolKey);

        vm.prank(botA);
        vm.expectRevert(Claw2ClawHook.OrderNotActive.selector);
        hook.cancelOrder(orderId, poolKey);
    }

    // C-1: cancel with wrong PoolKey now reverts
    function test_cancelOrder_revert_wrongPoolKey() public {
        // Post order on the real poolKey
        vm.prank(botA);
        uint256 orderId = hook.postOrder(poolKey, true, 100 ether, 90 ether, 3600);

        // Build a wrong PoolKey (different fee)
        PoolKey memory wrongKey = PoolKey({
            currency0: poolKey.currency0,
            currency1: poolKey.currency1,
            fee: 500,             // different fee -> different poolId
            tickSpacing: 10,
            hooks: poolKey.hooks
        });

        // Cancel with wrong key should revert with PoolMismatch
        vm.prank(botA);
        vm.expectRevert(Claw2ClawHook.PoolMismatch.selector);
        hook.cancelOrder(orderId, wrongKey);

        // Order should still be active (revert means state unchanged)
        (,,,,,bool active,) = hook.orders(orderId);
        assertTrue(active);
    }

    // ── P2P matching tests (with settlement verification) ───────────

    function test_p2pMatch_success() public {
        // Bot A posts order: sell 100 token0 for at least 95 token1
        vm.prank(botA);
        uint256 orderId = hook.postOrder(poolKey, true, 100 ether, 95 ether, 3600);

        // Record balances before match
        uint256 makerToken1Before = token1.balanceOf(botA);
        uint256 hookToken0Before = token0.balanceOf(address(hook));

        // Bot B swaps: sell 100 token1 for token0 (opposite direction -> should match)
        // M-1 fix: taker now only pays order.minAmountOut (95 ether), not full input
        IPoolManager.SwapParams memory params = IPoolManager.SwapParams({
            zeroForOne: false, // selling token1 for token0
            amountSpecified: -100 ether, // exact input
            sqrtPriceLimitX96: 0
        });

        vm.expectEmit(true, true, true, true);
        emit Claw2ClawHook.P2PTrade(
            orderId,
            botA,
            botB,
            address(token1), // inputCurrency (taker sells token1)
            address(token0), // outputCurrency (taker gets token0)
            95 ether,        // takerPays = order.minAmountOut (M-1 fix)
            100 ether        // makerAmountOut (from escrow)
        );

        vm.prank(address(mockPM));
        (bytes4 selector, BeforeSwapDelta delta, uint24 fee) =
            hook.beforeSwap(botB, poolKey, params, "");

        // -- Return value checks --
        assertEq(selector, IHooks.beforeSwap.selector);
        assertEq(fee, 0);

        // H-1 fix: specifiedDelta = takerPays (95e18), unspecifiedDelta = -order.amountIn (-100e18)
        int128 specifiedDelta = BeforeSwapDeltaLibrary.getSpecifiedDelta(delta);
        int128 unspecifiedDelta = BeforeSwapDeltaLibrary.getUnspecifiedDelta(delta);
        assertEq(specifiedDelta, 95 ether);    // positive: reduces amountToSwap
        assertEq(unspecifiedDelta, -100 ether); // negative: hook provides output

        // -- Order state --
        (,,,,,bool active,) = hook.orders(orderId);
        assertFalse(active, "Order should be inactive after match");

        // -- Settlement verification via MockPM --
        // 1. Hook called take(token1, maker, 95e18) -> PM sent token1 to maker
        assertEq(mockPM.getTakeCallCount(), 1, "Should have 1 take call");
        (Currency takeCurrency, address takeTo, uint256 takeAmount) = mockPM.getTakeCall(0);
        assertEq(Currency.unwrap(takeCurrency), address(token1), "take: wrong currency");
        assertEq(takeTo, botA, "take: should send to maker");
        assertEq(takeAmount, 95 ether, "take: wrong amount (should be minAmountOut)");

        // 2. Hook called settle with token0 (maker's escrowed tokens -> PM)
        assertEq(mockPM.getSettleCallCount(), 1, "Should have 1 settle call");
        (Currency settleCurrency, uint256 settleAmount) = mockPM.getSettleCall(0);
        assertEq(Currency.unwrap(settleCurrency), address(token0), "settle: wrong currency");
        assertEq(settleAmount, 100 ether, "settle: wrong amount");

        // -- Token movement verification --
        // Maker received taker's input (token1) from PM
        assertEq(
            token1.balanceOf(botA),
            makerToken1Before + 95 ether,
            "Maker should receive taker's token1 (minAmountOut)"
        );

        // Hook's escrowed token0 was sent to PM (for taker to receive)
        assertEq(
            token0.balanceOf(address(hook)),
            hookToken0Before - 100 ether,
            "Hook escrow should be drained"
        );
        assertEq(
            token0.balanceOf(address(mockPM)),
            10_000 ether + 100 ether, // initial PM balance + escrowed tokens
            "PM should receive maker's escrowed token0"
        );
    }

    function test_p2pMatch_sellToken1() public {
        // Bot A posts order: sell 200 token1 for at least 180 token0
        vm.prank(botA);
        hook.postOrder(poolKey, false, 200 ether, 180 ether, 3600);

        // Token1 should be escrowed
        assertEq(token1.balanceOf(address(hook)), 200 ether);

        // Bot B swaps: sell 200 token0 for token1 (zeroForOne = true -> opposite of sell token1)
        IPoolManager.SwapParams memory params = IPoolManager.SwapParams({
            zeroForOne: true,
            amountSpecified: -200 ether,
            sqrtPriceLimitX96: 0
        });

        vm.prank(address(mockPM));
        (bytes4 selector, BeforeSwapDelta delta,) =
            hook.beforeSwap(botB, poolKey, params, "");

        assertEq(selector, IHooks.beforeSwap.selector);

        // M-1 fix: specifiedDelta = minAmountOut (180e18), not full input
        int128 specifiedDelta = BeforeSwapDeltaLibrary.getSpecifiedDelta(delta);
        assertEq(specifiedDelta, 180 ether);

        // Verify settlement
        (Currency takeCurrency, address takeTo, uint256 takeAmount) = mockPM.getTakeCall(0);
        assertEq(Currency.unwrap(takeCurrency), address(token0), "take: token0 to maker");
        assertEq(takeTo, botA);
        assertEq(takeAmount, 180 ether, "take: should be minAmountOut");

        (Currency settleCurrency, uint256 settleAmount) = mockPM.getSettleCall(0);
        assertEq(Currency.unwrap(settleCurrency), address(token1), "settle: token1 from escrow");
        assertEq(settleAmount, 200 ether);
    }

    function test_noMatch_fallsThrough() public {
        // Bot A posts order: sell token0 for token1
        vm.prank(botA);
        hook.postOrder(poolKey, true, 100 ether, 95 ether, 3600);

        // Bot B swaps in SAME direction (also selling token0)
        // This should NOT match, return zero delta
        IPoolManager.SwapParams memory params = IPoolManager.SwapParams({
            zeroForOne: true, // same direction as order
            amountSpecified: -100 ether,
            sqrtPriceLimitX96: 0
        });

        vm.prank(address(mockPM));
        (bytes4 selector, BeforeSwapDelta delta, uint24 fee) =
            hook.beforeSwap(botB, poolKey, params, "");

        assertEq(selector, IHooks.beforeSwap.selector);
        assertEq(BeforeSwapDelta.unwrap(delta), 0, "Should return ZERO_DELTA");
        assertEq(fee, 0);

        // No settlement calls
        assertEq(mockPM.getTakeCallCount(), 0, "No take calls for no-match");
        assertEq(mockPM.getSettleCallCount(), 0, "No settle calls for no-match");
    }

    function test_noMatch_insufficientAmount() public {
        // Bot A: sell 100 token0 for at least 95 token1
        vm.prank(botA);
        hook.postOrder(poolKey, true, 100 ether, 95 ether, 3600);

        // Bot B tries to swap only 90 token1 (less than minAmountOut)
        IPoolManager.SwapParams memory params = IPoolManager.SwapParams({
            zeroForOne: false,
            amountSpecified: -90 ether,
            sqrtPriceLimitX96: 0
        });

        vm.prank(address(mockPM));
        (,BeforeSwapDelta delta,) = hook.beforeSwap(botB, poolKey, params, "");

        assertEq(BeforeSwapDelta.unwrap(delta), 0, "Should not match - insufficient amount");
        assertEq(mockPM.getTakeCallCount(), 0);
    }

    function test_expiredOrder_skipped() public {
        // Bot A posts order with 1 second duration
        vm.prank(botA);
        uint256 orderId = hook.postOrder(poolKey, true, 100 ether, 95 ether, 1);

        // Warp past expiry
        vm.warp(block.timestamp + 2);

        // Bot B tries to match -- should skip expired order
        IPoolManager.SwapParams memory params = IPoolManager.SwapParams({
            zeroForOne: false,
            amountSpecified: -100 ether,
            sqrtPriceLimitX96: 0
        });

        vm.prank(address(mockPM));
        (,BeforeSwapDelta delta,) = hook.beforeSwap(botB, poolKey, params, "");

        assertEq(BeforeSwapDelta.unwrap(delta), 0, "Should not match expired order");

        // Order still marked active (just expired by timestamp)
        (,,,,,bool active,) = hook.orders(orderId);
        assertTrue(active);

        // No settlement
        assertEq(mockPM.getTakeCallCount(), 0);
    }

    // I-1: non-whitelisted senders fall through to AMM
    function test_beforeSwap_nonWhitelisted_fallsThrough() public {
        IPoolManager.SwapParams memory params = IPoolManager.SwapParams({
            zeroForOne: true,
            amountSpecified: -100 ether,
            sqrtPriceLimitX96: 0
        });

        vm.prank(address(mockPM));
        (bytes4 selector, BeforeSwapDelta delta, uint24 fee) =
            hook.beforeSwap(notBot, poolKey, params, "");

        assertEq(selector, IHooks.beforeSwap.selector);
        assertEq(BeforeSwapDelta.unwrap(delta), 0, "Non-whitelisted should get ZERO_DELTA");
        assertEq(fee, 0);
    }

    // I-2: exact-output swaps fall through to AMM
    function test_beforeSwap_exactOutput_fallsThrough() public {
        IPoolManager.SwapParams memory params = IPoolManager.SwapParams({
            zeroForOne: true,
            amountSpecified: 100 ether, // positive = exact output
            sqrtPriceLimitX96: 0
        });

        vm.prank(address(mockPM));
        (bytes4 selector, BeforeSwapDelta delta,) =
            hook.beforeSwap(botA, poolKey, params, "");

        assertEq(selector, IHooks.beforeSwap.selector);
        assertEq(BeforeSwapDelta.unwrap(delta), 0, "Exact-output should get ZERO_DELTA");
    }

    function test_beforeSwap_revert_notPoolManager() public {
        IPoolManager.SwapParams memory params = IPoolManager.SwapParams({
            zeroForOne: true,
            amountSpecified: -100 ether,
            sqrtPriceLimitX96: 0
        });

        vm.prank(notBot);
        vm.expectRevert(Claw2ClawHook.OnlyPoolManager.selector);
        hook.beforeSwap(botA, poolKey, params, "");
    }

    // ── afterSwap tests ─────────────────────────────────────────────

    function test_afterSwap_noOp() public {
        BalanceDelta delta = toBalanceDelta(int128(100 ether), int128(-95 ether));

        IPoolManager.SwapParams memory params = IPoolManager.SwapParams({
            zeroForOne: true,
            amountSpecified: -100 ether,
            sqrtPriceLimitX96: 0
        });

        vm.prank(address(mockPM));
        (bytes4 selector, int128 hookDelta) =
            hook.afterSwap(botA, poolKey, params, delta, "");

        assertEq(selector, IHooks.afterSwap.selector);
        assertEq(hookDelta, 0);
    }

    // ── View function tests ─────────────────────────────────────────

    function test_getPoolOrders() public {
        vm.prank(botA);
        hook.postOrder(poolKey, true, 100 ether, 95 ether, 3600);

        vm.prank(botB);
        hook.postOrder(poolKey, false, 50 ether, 45 ether, 3600);

        uint256[] memory orderIds = hook.getPoolOrders(poolKey);

        assertEq(orderIds.length, 2);
        assertEq(orderIds[0], 0);
        assertEq(orderIds[1], 1);
    }

    // ── Multi-order matching tests ──────────────────────────────────

    function test_matchesFirstValidOrder() public {
        // Post two orders from different bots
        vm.prank(botA);
        hook.postOrder(poolKey, true, 100 ether, 90 ether, 3600); // order 0

        vm.prank(botA);
        hook.postOrder(poolKey, true, 200 ether, 180 ether, 3600); // order 1

        // Swap with 100 token1 -- should match order 0 (first valid)
        IPoolManager.SwapParams memory params = IPoolManager.SwapParams({
            zeroForOne: false,
            amountSpecified: -100 ether,
            sqrtPriceLimitX96: 0
        });

        vm.prank(address(mockPM));
        (,BeforeSwapDelta delta,) = hook.beforeSwap(botB, poolKey, params, "");

        // M-1 fix: specifiedDelta = minAmountOut of order 0 (90 ether)
        int128 specifiedDelta = BeforeSwapDeltaLibrary.getSpecifiedDelta(delta);
        assertEq(specifiedDelta, 90 ether, "Should match, paying minAmountOut");

        // Order 0 inactive, order 1 still active
        (,,,,,bool active0,) = hook.orders(0);
        (,,,,,bool active1,) = hook.orders(1);
        assertFalse(active0, "Order 0 should be filled");
        assertTrue(active1, "Order 1 should still be active");
    }

    function test_skipsFilledOrder_matchesNext() public {
        // Post two orders
        vm.prank(botA);
        hook.postOrder(poolKey, true, 100 ether, 95 ether, 3600); // order 0

        vm.prank(botA);
        hook.postOrder(poolKey, true, 50 ether, 45 ether, 3600); // order 1

        // First swap fills order 0
        IPoolManager.SwapParams memory params1 = IPoolManager.SwapParams({
            zeroForOne: false,
            amountSpecified: -100 ether,
            sqrtPriceLimitX96: 0
        });
        vm.prank(address(mockPM));
        hook.beforeSwap(botB, poolKey, params1, "");

        // Second swap should match order 1 (order 0 was removed via swap-and-pop)
        IPoolManager.SwapParams memory params2 = IPoolManager.SwapParams({
            zeroForOne: false,
            amountSpecified: -50 ether,
            sqrtPriceLimitX96: 0
        });
        vm.prank(address(mockPM));
        (,BeforeSwapDelta delta2,) = hook.beforeSwap(botB, poolKey, params2, "");

        // M-1 fix: specifiedDelta = minAmountOut of order 1 (45 ether)
        int128 specifiedDelta = BeforeSwapDeltaLibrary.getSpecifiedDelta(delta2);
        assertEq(specifiedDelta, 45 ether, "Should match order 1, paying minAmountOut");

        (,,,,,bool active1,) = hook.orders(1);
        assertFalse(active1, "Order 1 should be filled");
    }

    // ── H-1: match with different taker/maker amounts ───────────────

    function test_p2pMatch_differentAmounts() public {
        // Bot A posts: sell 50 token0 for at least 40 token1
        vm.prank(botA);
        hook.postOrder(poolKey, true, 50 ether, 40 ether, 3600);

        // Bot B swaps with 200 token1 -- much more than needed
        IPoolManager.SwapParams memory params = IPoolManager.SwapParams({
            zeroForOne: false,
            amountSpecified: -200 ether,
            sqrtPriceLimitX96: 0
        });

        vm.prank(address(mockPM));
        (bytes4 selector, BeforeSwapDelta delta,) =
            hook.beforeSwap(botB, poolKey, params, "");

        assertEq(selector, IHooks.beforeSwap.selector);

        // H-1 fix: specified = minAmountOut (40), unspecified = -amountIn (-50)
        int128 specifiedDelta = BeforeSwapDeltaLibrary.getSpecifiedDelta(delta);
        int128 unspecifiedDelta = BeforeSwapDeltaLibrary.getUnspecifiedDelta(delta);
        assertEq(specifiedDelta, 40 ether, "specified should be minAmountOut");
        assertEq(unspecifiedDelta, -50 ether, "unspecified should be -amountIn");

        // Take call should be for minAmountOut
        (, , uint256 takeAmount) = mockPM.getTakeCall(0);
        assertEq(takeAmount, 40 ether, "taker should only pay minAmountOut");

        // Settle should be for amountIn
        (, uint256 settleAmount) = mockPM.getSettleCall(0);
        assertEq(settleAmount, 50 ether, "settle should be order.amountIn");
    }

    // ── Purge expired orders tests ──────────────────────────────────

    function test_purgeExpiredOrders() public {
        vm.prank(botA);
        hook.postOrder(poolKey, true, 100 ether, 90 ether, 1); // expires in 1s

        vm.warp(block.timestamp + 2);

        // Anyone can purge
        hook.purgeExpiredOrders(poolKey, 10);

        // Order should be inactive
        (,,,,,bool active,) = hook.orders(0);
        assertFalse(active);

        // Pool orders array should be empty
        uint256[] memory orderIds = hook.getPoolOrders(poolKey);
        assertEq(orderIds.length, 0);

        // Tokens should be returned to maker
        assertEq(token0.balanceOf(address(hook)), 0);
    }

    // ── C-1: cross-pool token theft prevented ───────────────────────

    function test_cancelOrder_crossPoolTheft_prevented() public {
        // Deploy additional tokens for a second pool
        MockToken tokenX = new MockToken("Token X", "TKX", 18);
        MockToken tokenY = new MockToken("Token Y", "TKY", 18);
        if (address(tokenX) > address(tokenY)) {
            (tokenX, tokenY) = (tokenY, tokenX);
        }

        // Give botA some tokenX, botB some tokenY, fund the hook with tokenX
        tokenX.mint(botA, 1000 ether);
        tokenY.mint(botB, 1000 ether);

        vm.prank(botA);
        tokenX.approve(address(hook), type(uint256).max);
        vm.prank(botB);
        tokenY.approve(address(hook), type(uint256).max);

        // Pool 2
        PoolKey memory poolKey2 = PoolKey({
            currency0: Currency.wrap(address(tokenX)),
            currency1: Currency.wrap(address(tokenY)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });

        // BotA posts in pool1
        vm.prank(botA);
        uint256 orderId = hook.postOrder(poolKey, true, 100 ether, 90 ether, 3600);

        // BotA tries to cancel using pool2's key -- should revert
        vm.prank(botA);
        vm.expectRevert(Claw2ClawHook.PoolMismatch.selector);
        hook.cancelOrder(orderId, poolKey2);
    }
}
