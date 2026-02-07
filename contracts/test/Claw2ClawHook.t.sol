// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {Claw2ClawHook} from "../src/Claw2ClawHook.sol";
import {MockToken} from "../src/MockToken.sol";
import {IPoolManager} from "@v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "@v4-core/types/PoolKey.sol";
import {Currency} from "@v4-core/types/Currency.sol";
import {IHooks} from "@v4-core/interfaces/IHooks.sol";
import {BalanceDelta, toBalanceDelta} from "@v4-core/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary, toBeforeSwapDelta} from "@v4-core/types/BeforeSwapDelta.sol";

contract Claw2ClawHookTest is Test {
    Claw2ClawHook hook;
    MockToken token0;
    MockToken token1;
    
    address admin = address(0xAD);
    address botA = 0x9cC66E3EF95F5b24a5c006394a18994380EdEC46;
    address botB = 0xEF464bA95f07e97eaE7a3D717D5F49Dfc5cAC634;
    address notBot = address(0xBAD);
    address mockPoolManager;

    PoolKey poolKey;

    function setUp() public {
        mockPoolManager = makeAddr("poolManager");

        // Deploy hook
        hook = new Claw2ClawHook(admin, IPoolManager(mockPoolManager));

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

        // Approve hook
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

    function test_addBot_revert_notAdmin() public {
        vm.prank(notBot);
        vm.expectRevert(Claw2ClawHook.NotAdmin.selector);
        hook.addBot(address(0x123));
    }

    function test_setAdmin() public {
        vm.prank(admin);
        hook.setAdmin(botA);
        
        assertEq(hook.admin(), botA);
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
        
        // Check order was stored
        (
            address maker,
            bool sellToken0,
            uint128 amountIn,
            uint128 minAmountOut,
            uint256 expiry,
            bool active
        ) = hook.orders(orderId);
        
        assertEq(maker, botA);
        assertTrue(sellToken0);
        assertEq(amountIn, 100 ether);
        assertEq(minAmountOut, 90 ether);
        assertTrue(active);
        assertEq(expiry, block.timestamp + 3600);
        
        // Check tokens were transferred to hook
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
        (,,,,, bool active) = hook.orders(orderId);
        assertFalse(active);
        
        // Check tokens returned
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

    // ── P2P matching tests ──────────────────────────────────────────

    function test_p2pMatch_success() public {
        // Bot A posts order: sell 100 token0 for at least 95 token1
        vm.prank(botA);
        uint256 orderId = hook.postOrder(poolKey, true, 100 ether, 95 ether, 3600);
        
        uint256 botA_token0_before = token0.balanceOf(botA);
        uint256 botA_token1_before = token1.balanceOf(botA);
        uint256 botB_token0_before = token0.balanceOf(botB);
        uint256 botB_token1_before = token1.balanceOf(botB);
        
        // Bot B swaps: sell 100 token1 for token0
        // This should match Bot A's order
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
            address(token1),
            address(token0),
            100 ether,
            100 ether
        );
        
        vm.prank(mockPoolManager);
        (bytes4 selector, BeforeSwapDelta delta, uint24 fee) =
            hook.beforeSwap(botB, poolKey, params, "");
        
        assertEq(selector, IHooks.beforeSwap.selector);
        assertEq(fee, 0);
        
        // Check BeforeSwapDelta
        int128 specifiedDelta = BeforeSwapDeltaLibrary.getSpecifiedDelta(delta);
        int128 unspecifiedDelta = BeforeSwapDeltaLibrary.getUnspecifiedDelta(delta);
        
        assertEq(specifiedDelta, 100 ether); // positive: reduces amountToSwap to 0
        // Note: test only calls beforeSwap directly. unspecifiedDelta is negative (hook provides output).
        assertEq(unspecifiedDelta, -100 ether); // negative: hook provides output
        
        // Balances are settled in afterSwap via PoolManager, not in beforeSwap directly.
        // In unit tests calling beforeSwap alone, no transfers happen yet.
        // The delta returned tells PoolManager how to settle.
        // Bot A's tokens are still in hook escrow; taker settlement happens in afterSwap.
        
        // Check order is now inactive
        (,,,,, bool active) = hook.orders(orderId);
        assertFalse(active);
    }

    function test_noMatch_fallsThrough() public {
        // Bot A posts order: sell token0 for token1
        vm.prank(botA);
        hook.postOrder(poolKey, true, 100 ether, 95 ether, 3600);
        
        // Bot B swaps in SAME direction (also selling token0)
        // This should NOT match, return zero delta
        IPoolManager.SwapParams memory params = IPoolManager.SwapParams({
            zeroForOne: true, // same direction
            amountSpecified: -100 ether,
            sqrtPriceLimitX96: 0
        });
        
        vm.prank(mockPoolManager);
        (bytes4 selector, BeforeSwapDelta delta, uint24 fee) =
            hook.beforeSwap(botB, poolKey, params, "");
        
        assertEq(selector, IHooks.beforeSwap.selector);
        assertEq(BeforeSwapDelta.unwrap(delta), 0); // ZERO_DELTA
        assertEq(fee, 0);
    }

    function test_noMatch_insufficientAmount() public {
        // Bot A posts order: sell 100 token0 for at least 95 token1
        vm.prank(botA);
        hook.postOrder(poolKey, true, 100 ether, 95 ether, 3600);
        
        // Bot B tries to swap only 90 token1 (less than minAmountOut)
        // Should not match
        IPoolManager.SwapParams memory params = IPoolManager.SwapParams({
            zeroForOne: false,
            amountSpecified: -90 ether, // not enough
            sqrtPriceLimitX96: 0
        });
        
        vm.prank(mockPoolManager);
        (bytes4 selector, BeforeSwapDelta delta, uint24 fee) =
            hook.beforeSwap(botB, poolKey, params, "");
        
        assertEq(BeforeSwapDelta.unwrap(delta), 0); // no match
    }

    function test_expiredOrder_skipped() public {
        // Bot A posts order with 1 second duration
        vm.prank(botA);
        uint256 orderId = hook.postOrder(poolKey, true, 100 ether, 95 ether, 1);
        
        // Wait 2 seconds
        vm.warp(block.timestamp + 2);
        
        // Bot B tries to swap - should not match expired order
        IPoolManager.SwapParams memory params = IPoolManager.SwapParams({
            zeroForOne: false,
            amountSpecified: -100 ether,
            sqrtPriceLimitX96: 0
        });
        
        vm.prank(mockPoolManager);
        (bytes4 selector, BeforeSwapDelta delta, uint24 fee) =
            hook.beforeSwap(botB, poolKey, params, "");
        
        assertEq(BeforeSwapDelta.unwrap(delta), 0); // no match
        
        // Order should still be marked active (just expired)
        (,,,,, bool active) = hook.orders(orderId);
        assertTrue(active);
    }

    function test_beforeSwap_revert_notWhitelisted() public {
        IPoolManager.SwapParams memory params = IPoolManager.SwapParams({
            zeroForOne: true,
            amountSpecified: -100 ether,
            sqrtPriceLimitX96: 0
        });
        
        vm.prank(mockPoolManager);
        vm.expectRevert(Claw2ClawHook.NotWhitelisted.selector);
        hook.beforeSwap(notBot, poolKey, params, "");
    }

    function test_beforeSwap_revert_notPoolManager() public {
        IPoolManager.SwapParams memory params = IPoolManager.SwapParams({
            zeroForOne: true,
            amountSpecified: -100 ether,
            sqrtPriceLimitX96: 0
        });
        
        vm.prank(notBot);
        vm.expectRevert("Only PoolManager");
        hook.beforeSwap(botA, poolKey, params, "");
    }

    // ── afterSwap tests ─────────────────────────────────────────────

    function test_afterSwap_noMatch_noOp() public {
        BalanceDelta delta = toBalanceDelta(int128(100 ether), int128(-95 ether));
        
        IPoolManager.SwapParams memory params = IPoolManager.SwapParams({
            zeroForOne: true,
            amountSpecified: -100 ether,
            sqrtPriceLimitX96: 0
        });
        
        // When no P2P match pending, afterSwap is a no-op
        vm.prank(mockPoolManager);
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
}
