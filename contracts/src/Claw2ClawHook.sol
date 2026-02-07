// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IHooks} from "@v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "@v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "@v4-core/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "@v4-core/types/Currency.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@v4-core/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary, toBeforeSwapDelta} from "@v4-core/types/BeforeSwapDelta.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {CurrencySettler} from "@v4-core/../test/utils/CurrencySettler.sol";

/// @title Claw2ClawHook
/// @notice Uniswap v4 hook enabling P2P order matching between whitelisted bots.
/// @dev Uses CustomCurve pattern: take input from PM, settle output to PM.
contract Claw2ClawHook is IHooks {
    using BalanceDeltaLibrary for BalanceDelta;
    using CurrencyLibrary for Currency;
    using CurrencySettler for Currency;

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
        require(msg.sender == address(poolManager), "Only PoolManager");
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
        require(amountIn > 0 && minAmountOut > 0, "Invalid amounts");
        require(duration > 0, "Invalid duration");
        orderId = nextOrderId++;
        orders[orderId] = Order(msg.sender, sellToken0, amountIn, minAmountOut, block.timestamp + duration, true);
        Currency tokenIn = sellToken0 ? key.currency0 : key.currency1;
        IERC20(Currency.unwrap(tokenIn)).transferFrom(msg.sender, address(this), amountIn);
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
        IERC20(Currency.unwrap(tokenIn)).transfer(order.maker, order.amountIn);
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

        bytes32 poolId = keccak256(abi.encode(key));
        uint256[] storage orderIds = poolOrders[poolId];
        uint128 takerAmountIn = uint128(params.amountSpecified < 0
            ? uint256(-params.amountSpecified) : uint256(params.amountSpecified));

        for (uint256 i = 0; i < orderIds.length; i++) {
            Order storage order = orders[orderIds[i]];
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
            IERC20(Currency.unwrap(outputCurrency)).transfer(address(poolManager), order.amountIn);
            poolManager.settle();

            emit P2PTrade(
                orderIds[i], order.maker, sender,
                Currency.unwrap(inputCurrency), Currency.unwrap(outputCurrency),
                takerAmountIn, order.amountIn
            );

            // Return delta: cancel the swap entirely
            // specifiedDelta = -amountSpecified → amountToSwap becomes 0
            // unspecifiedDelta = +amountSpecified → hook handled the output
            return (
                IHooks.beforeSwap.selector,
                toBeforeSwapDelta(int128(-params.amountSpecified), int128(params.amountSpecified)),
                0
            );
        }

        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
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
