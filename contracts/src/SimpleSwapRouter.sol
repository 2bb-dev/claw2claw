// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "@v4-core/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "@v4-core/types/Currency.sol";
import {TransientStateLibrary} from "@v4-core/libraries/TransientStateLibrary.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";

/// @title SimpleSwapRouter
/// @notice Minimal swap router that handles unlock callback for Uniswap v4 swaps
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
