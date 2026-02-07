// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@v4-core/interfaces/IPoolManager.sol";
import {Currency} from "@v4-core/types/Currency.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";

/// @title MockPoolManager — tracks take/sync/settle calls for unit testing
/// @dev Doesn't implement full PM accounting; just records calls and handles token transfers
///      so beforeSwap can execute without reverting.
contract MockPoolManager {
    struct TakeCall {
        Currency currency;
        address to;
        uint256 amount;
    }

    struct SettleCall {
        Currency currency;
        uint256 amount;
    }

    TakeCall[] public takeCalls;
    SettleCall[] public settleCalls;
    Currency public lastSyncedCurrency;
    uint256 public syncBalanceBefore;

    /// @notice Records take call and transfers tokens to recipient
    function take(Currency currency, address to, uint256 amount) external {
        takeCalls.push(TakeCall(currency, to, amount));
        // Transfer tokens from PM to recipient (PM must hold tokens)
        if (amount > 0) {
            bool success = IERC20(Currency.unwrap(currency)).transfer(to, amount);
            require(success, "MockPoolManager: transfer failed");
        }
    }

    /// @notice Records sync call — snapshot balance before settlement
    function sync(Currency currency) external {
        lastSyncedCurrency = currency;
        syncBalanceBefore = IERC20(Currency.unwrap(currency)).balanceOf(address(this));
    }

    /// @notice Records settle call — calculate how much was transferred since sync
    function settle() external payable returns (uint256 amount) {
        uint256 balanceNow = IERC20(Currency.unwrap(lastSyncedCurrency)).balanceOf(address(this));
        amount = balanceNow - syncBalanceBefore;
        settleCalls.push(SettleCall(lastSyncedCurrency, amount));
    }

    // -- View helpers for assertions --

    function getTakeCallCount() external view returns (uint256) {
        return takeCalls.length;
    }

    function getSettleCallCount() external view returns (uint256) {
        return settleCalls.length;
    }

    function getTakeCall(uint256 i) external view returns (Currency currency, address to, uint256 amount) {
        TakeCall memory c = takeCalls[i];
        return (c.currency, c.to, c.amount);
    }

    function getSettleCall(uint256 i) external view returns (Currency currency, uint256 amount) {
        SettleCall memory c = settleCalls[i];
        return (c.currency, c.amount);
    }
}
