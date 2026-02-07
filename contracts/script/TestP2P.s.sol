// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import {Claw2ClawHook} from "../src/Claw2ClawHook.sol";
import {MockToken} from "../src/MockToken.sol";
import {IPoolManager} from "@v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "@v4-core/types/PoolKey.sol";
import {Currency} from "@v4-core/types/Currency.sol";
import {IHooks} from "@v4-core/interfaces/IHooks.sol";
import {TickMath} from "@v4-core/libraries/TickMath.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";

interface IPoolSwapTest {
    struct TestSettings {
        bool takeClaims;
        bool settleUsingBurn;
    }
    function swap(
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        TestSettings calldata testSettings,
        bytes calldata hookData
    ) external payable returns (int256);
}

contract TestP2P is Script {
    address constant POOL_MANAGER = 0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408;
    address constant POOL_SWAP_TEST = 0x8B5bcC363ddE2614281aD875bad385E0A785D3B9;

    address constant HOOK = 0xB6847fA87256309Bd75C133FB8112BFdaeDf40c0;
    address constant CLAW = 0xca5589B1BAb1CdBed6075F14060b4c02D0B75573;
    address constant ZUG  = 0xe7CaeCaF501D310B9d73B07802625d1759f55BE8;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        uint256 botAKey = vm.envUint("BOT_A_KEY");
        uint256 botBKey = vm.envUint("BOT_B_KEY");

        address deployer = vm.addr(deployerKey);
        address botA = vm.addr(botAKey);
        address botB = vm.addr(botBKey);

        console.log("=== P2P Test ===");
        console.log("Deployer (admin):", deployer);
        console.log("Bot A (maker):", botA);
        console.log("Bot B (taker):", botB);

        // Determine token ordering
        address token0 = CLAW < ZUG ? CLAW : ZUG;
        address token1 = CLAW < ZUG ? ZUG : CLAW;
        console.log("Token0:", token0);
        console.log("Token1:", token1);

        PoolKey memory poolKey = PoolKey({
            currency0: Currency.wrap(token0),
            currency1: Currency.wrap(token1),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(HOOK)
        });

        Claw2ClawHook hook = Claw2ClawHook(HOOK);

        // --- Step 1: Admin whitelists Bot A and Bot B ---
        vm.startBroadcast(deployerKey);
        hook.addBot(botA);
        hook.addBot(botB);
        // Send tokens to bots
        MockToken(token0).transfer(botA, 10_000 ether);
        MockToken(token1).transfer(botA, 10_000 ether);
        MockToken(token0).transfer(botB, 10_000 ether);
        MockToken(token1).transfer(botB, 10_000 ether);
        // Send gas to bots
        (bool s1,) = botA.call{value: 0.005 ether}("");
        (bool s2,) = botB.call{value: 0.005 ether}("");
        require(s1 && s2, "ETH transfer failed");
        vm.stopBroadcast();

        console.log("--- Step 1: Bots whitelisted, funded ---");
        console.log("Bot A token0 balance:", IERC20(token0).balanceOf(botA));
        console.log("Bot A token1 balance:", IERC20(token1).balanceOf(botA));
        console.log("Bot B token0 balance:", IERC20(token0).balanceOf(botB));
        console.log("Bot B token1 balance:", IERC20(token1).balanceOf(botB));

        // --- Step 2: Bot A posts order (sell 1000 token0 for >= 950 token1) ---
        vm.startBroadcast(botAKey);
        IERC20(token0).approve(HOOK, 1000 ether);
        uint256 orderId = hook.postOrder(
            poolKey,
            true,           // sellToken0
            1000 ether,     // amountIn
            950 ether,      // minAmountOut
            3600            // 1 hour
        );
        vm.stopBroadcast();

        console.log("--- Step 2: Bot A posted order ---");
        console.log("Order ID:", orderId);
        console.log("Bot A token0 after post:", IERC20(token0).balanceOf(botA));

        // --- Step 3: Bot B swaps (sells token1 for token0) → should match P2P ---
        vm.startBroadcast(botBKey);
        IERC20(token1).approve(POOL_SWAP_TEST, 1000 ether);
        IERC20(token0).approve(POOL_SWAP_TEST, 1000 ether);

        console.log("Bot B token0 before swap:", IERC20(token0).balanceOf(botB));
        console.log("Bot B token1 before swap:", IERC20(token1).balanceOf(botB));

        IPoolSwapTest(POOL_SWAP_TEST).swap(
            poolKey,
            IPoolManager.SwapParams({
                zeroForOne: false,          // selling token1 for token0
                amountSpecified: -1000 ether, // exact input: 1000 token1
                sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
            }),
            IPoolSwapTest.TestSettings({
                takeClaims: false,
                settleUsingBurn: false
            }),
            bytes("")
        );
        vm.stopBroadcast();

        console.log("--- Step 3: Bot B swapped (P2P match!) ---");
        console.log("Bot A token0 final:", IERC20(token0).balanceOf(botA));
        console.log("Bot A token1 final:", IERC20(token1).balanceOf(botA));
        console.log("Bot B token0 final:", IERC20(token0).balanceOf(botB));
        console.log("Bot B token1 final:", IERC20(token1).balanceOf(botB));

        console.log("=== P2P Test Complete! ===");
    }
}
