// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IHooks} from "@v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "@v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "@v4-core/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "@v4-core/types/Currency.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@v4-core/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary, toBeforeSwapDelta} from "@v4-core/types/BeforeSwapDelta.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";

/// @title Claw2ClawHook
/// @notice Uniswap v4 hook enabling P2P order matching between whitelisted bots.
/// @dev Uses CustomCurve pattern: take input from PM, settle output to PM.
contract Claw2ClawHook is IHooks {
    using BalanceDeltaLibrary for BalanceDelta;
    using CurrencyLibrary for Currency;

    struct Order {
        address maker;
        bool sellToken0;
        uint128 amountIn;
        uint128 minAmountOut;
        uint256 expiry;
        bool active;
    }

    // Events
    event OrderPosted(uint256 indexed orderId, address indexed maker, bool sellToken0, uint128 amountIn, uint128 minAmountOut, uint256 expiry);
    event OrderCancelled(uint256 indexed orderId, address indexed maker);
    event P2PTrade(uint256 indexed orderId, address indexed maker, address indexed taker, address tokenIn, address tokenOut, uint128 amountIn, uint128 amountOut);
    event BotAdded(address indexed bot);
    event BotRemoved(address indexed bot);

    // Errors
    error NotAdmin();
    error NotWhitelisted();
    error HookNotImplemented();
    error OrderNotFound();
    error OrderNotActive();
    error Unauthorized();
    error ExactInputOnly();
    error AmountOverflow();
    error InvalidAmounts();
    error InvalidDuration();
    error TransferFailed();
    error OnlyPoolManager();

    // State
    address public admin;
    IPoolManager public immutable poolManager;
    mapping(address => bool) public allowedBots;
    uint256 public nextOrderId;
    mapping(uint256 => Order) public orders;
    mapping(bytes32 => uint256[]) public poolOrders;

    constructor(address _admin, IPoolManager _poolManager) {
        admin = _admin;
        poolManager = _poolManager;
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }
    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        _;
    }
    modifier onlyWhitelisted() {
        if (!allowedBots[msg.sender]) revert NotWhitelisted();
        _;
    }

    // Admin
    function addBot(address bot) external onlyAdmin { allowedBots[bot] = true; emit BotAdded(bot); }
    function removeBot(address bot) external onlyAdmin { allowedBots[bot] = false; emit BotRemoved(bot); }
    function setAdmin(address newAdmin) external onlyAdmin { admin = newAdmin; }

    // Order Book
    function postOrder(PoolKey calldata key, bool sellToken0, uint128 amountIn, uint128 minAmountOut, uint256 duration)
        external onlyWhitelisted returns (uint256 orderId)
    {
        if (amountIn == 0 || minAmountOut == 0) revert InvalidAmounts();
        if (duration == 0) revert InvalidDuration();
        orderId = nextOrderId++;
        orders[orderId] = Order(msg.sender, sellToken0, amountIn, minAmountOut, block.timestamp + duration, true);
        Currency tokenIn = sellToken0 ? key.currency0 : key.currency1;
        bool success = IERC20(Currency.unwrap(tokenIn)).transferFrom(msg.sender, address(this), amountIn);
        if (!success) revert TransferFailed();
        bytes32 poolId = keccak256(abi.encode(key));
        poolOrders[poolId].push(orderId);
        emit OrderPosted(orderId, msg.sender, sellToken0, amountIn, minAmountOut, block.timestamp + duration);
    }

    function cancelOrder(uint256 orderId, PoolKey calldata key) external {
        Order storage order = orders[orderId];
        if (order.maker == address(0)) revert OrderNotFound();
        if (msg.sender != order.maker) revert Unauthorized();
        if (!order.active) revert OrderNotActive();
        order.active = false;
        Currency tokenIn = order.sellToken0 ? key.currency0 : key.currency1;
        bool success = IERC20(Currency.unwrap(tokenIn)).transfer(order.maker, order.amountIn);
        if (!success) revert TransferFailed();
        // Clean up: remove from pool order array
        bytes32 poolId = keccak256(abi.encode(key));
        _removeOrder(poolId, orderId);
        emit OrderCancelled(orderId, order.maker);
    }

    function getPoolOrders(PoolKey calldata key) external view returns (uint256[] memory) {
        return poolOrders[keccak256(abi.encode(key))];
    }

    /// @notice beforeSwap — match P2P orders using CustomCurve pattern
    /// @dev If match found: take input from PM → send to maker, settle output to PM from escrow
    function beforeSwap(address sender, PoolKey calldata key, IPoolManager.SwapParams calldata params, bytes calldata)
        external onlyPoolManager returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (!allowedBots[sender]) revert NotWhitelisted();
        // Only exact-input swaps supported (amountSpecified < 0 in Uni v4)
        if (params.amountSpecified >= 0) revert ExactInputOnly();
        // Guard int256.min: negating it overflows (undefined in two's complement)
        if (params.amountSpecified == type(int256).min) revert AmountOverflow();
        // Safe cast: negate and check fits in int128 (for BeforeSwapDelta)
        uint256 absAmount = uint256(-params.amountSpecified);
        if (absAmount > uint256(uint128(type(int128).max))) revert AmountOverflow();
        uint128 takerAmountIn = uint128(absAmount);

        bytes32 poolId = keccak256(abi.encode(key));
        uint256[] storage orderIds = poolOrders[poolId];

        for (uint256 i = 0; i < orderIds.length; i++) {
            uint256 matchedOrderId = orderIds[i];
            Order storage order = orders[matchedOrderId];
            if (!order.active || block.timestamp > order.expiry) continue;
            if (order.sellToken0 == params.zeroForOne) continue;
            if (takerAmountIn < order.minAmountOut) continue;

            // Match found!
            order.active = false;

            (Currency inputCurrency, Currency outputCurrency) = params.zeroForOne
                ? (key.currency0, key.currency1)
                : (key.currency1, key.currency0);

            // 1. Take taker's input FROM PM to maker (PM owes hook, hook sends to maker)
            poolManager.take(inputCurrency, order.maker, takerAmountIn);

            // 2. Settle maker's escrowed output TO PM (hook pays PM)
            poolManager.sync(outputCurrency);
            bool success = IERC20(Currency.unwrap(outputCurrency)).transfer(address(poolManager), order.amountIn);
            if (!success) revert TransferFailed();
            poolManager.settle();

            emit P2PTrade(
                matchedOrderId, order.maker, sender,
                Currency.unwrap(inputCurrency), Currency.unwrap(outputCurrency),
                takerAmountIn, order.amountIn
            );

            // 3. Clean up: remove filled order from pool array (swap-and-pop)
            _removeOrder(poolId, matchedOrderId);

            // Return delta: cancel the swap entirely
            // specifiedDelta = -amountSpecified → amountToSwap becomes 0
            // unspecifiedDelta = +amountSpecified → hook handled the output
            // Safe: we already validated amountSpecified fits in int128 via uint128 check
            int128 specified = int128(-params.amountSpecified);
            int128 unspecified = int128(params.amountSpecified);
            return (
                IHooks.beforeSwap.selector,
                toBeforeSwapDelta(specified, unspecified),
                0
            );
        }

        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    /// @dev Remove an orderId from the pool's order array via swap-and-pop.
    ///      Bounds growth for filled/cancelled orders. Note: expired orders that
    ///      are merely skipped (never matched) may still accumulate over time.
    function _removeOrder(bytes32 poolId, uint256 orderId) internal {
        uint256[] storage ids = poolOrders[poolId];
        for (uint256 i = 0; i < ids.length; i++) {
            if (ids[i] == orderId) {
                ids[i] = ids[ids.length - 1];
                ids.pop();
                return;
            }
        }
    }

    /// @notice afterSwap — no-op
    function afterSwap(address, PoolKey calldata, IPoolManager.SwapParams calldata, BalanceDelta, bytes calldata)
        external onlyPoolManager returns (bytes4, int128)
    {
        return (IHooks.afterSwap.selector, 0);
    }

    // Unused hooks
    function beforeInitialize(address, PoolKey calldata, uint160) external pure returns (bytes4) { revert HookNotImplemented(); }
    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure returns (bytes4) { revert HookNotImplemented(); }
    function beforeAddLiquidity(address, PoolKey calldata, IPoolManager.ModifyLiquidityParams calldata, bytes calldata) external pure returns (bytes4) { revert HookNotImplemented(); }
    function afterAddLiquidity(address, PoolKey calldata, IPoolManager.ModifyLiquidityParams calldata, BalanceDelta, BalanceDelta, bytes calldata) external pure returns (bytes4, BalanceDelta) { revert HookNotImplemented(); }
    function beforeRemoveLiquidity(address, PoolKey calldata, IPoolManager.ModifyLiquidityParams calldata, bytes calldata) external pure returns (bytes4) { revert HookNotImplemented(); }
    function afterRemoveLiquidity(address, PoolKey calldata, IPoolManager.ModifyLiquidityParams calldata, BalanceDelta, BalanceDelta, bytes calldata) external pure returns (bytes4, BalanceDelta) { revert HookNotImplemented(); }
    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) { revert HookNotImplemented(); }
    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) { revert HookNotImplemented(); }
}
