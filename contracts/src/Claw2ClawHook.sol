// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IHooks} from "@v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "@v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "@v4-core/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "@v4-core/types/Currency.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@v4-core/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary, toBeforeSwapDelta} from "@v4-core/types/BeforeSwapDelta.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Claw2ClawHook
/// @notice Uniswap v4 hook enabling P2P order matching between whitelisted bots.
/// @dev Uses CustomCurve pattern: take input from PM, settle output to PM.
contract Claw2ClawHook is IHooks, ReentrancyGuard {
    using BalanceDeltaLibrary for BalanceDelta;
    using CurrencyLibrary for Currency;
    using SafeERC20 for IERC20;

    struct Order {
        address maker;
        bool sellToken0;
        uint128 amountIn;
        uint128 minAmountOut;
        uint256 expiry;
        bool active;
        bytes32 poolId;
    }

    // Events
    event OrderPosted(uint256 indexed orderId, address indexed maker, bool sellToken0, uint128 amountIn, uint128 minAmountOut, uint256 expiry);
    event OrderCancelled(uint256 indexed orderId, address indexed maker);
    event OrderExpired(uint256 indexed orderId, address indexed maker);
    event P2PTrade(uint256 indexed orderId, address indexed maker, address indexed taker, address tokenIn, address tokenOut, uint128 amountIn, uint128 amountOut);
    event BotAdded(address indexed bot);
    event BotRemoved(address indexed bot);
    event AdminChanged(address indexed oldAdmin, address indexed newAdmin);
    event PendingAdminSet(address indexed pendingAdmin);
    event RefundFailed(uint256 indexed orderId, address indexed maker);

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
    error ZeroAddress();
    error PoolMismatch();
    error DurationTooLong();
    error NotPendingAdmin();

    uint256 public constant MAX_ORDER_DURATION = 30 days;
    uint256 public constant MAX_ITERATIONS = 100;

    // State
    address public admin;
    address public pendingAdmin; // M-2 fix: two-step admin transfer
    IPoolManager public immutable poolManager;
    mapping(address => bool) public allowedBots;
    uint256 public nextOrderId;
    mapping(uint256 => Order) public orders;
    mapping(bytes32 => uint256[]) public poolOrders;

    // H-4 fix: pull-pattern for failed refunds
    mapping(address => mapping(address => uint256)) public unclaimedBalances;

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

    // M-2 fix: two-step admin transfer
    function setAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        pendingAdmin = newAdmin;
        emit PendingAdminSet(newAdmin);
    }

    function acceptAdmin() external {
        if (msg.sender != pendingAdmin) revert NotPendingAdmin();
        emit AdminChanged(admin, msg.sender);
        admin = msg.sender;
        pendingAdmin = address(0);
    }

    // Order Book
    function postOrder(PoolKey calldata key, bool sellToken0, uint128 amountIn, uint128 minAmountOut, uint256 duration)
        external onlyWhitelisted nonReentrant returns (uint256 orderId)
    {
        if (amountIn == 0 || minAmountOut == 0) revert InvalidAmounts();
        if (duration == 0) revert InvalidDuration();
        if (duration > MAX_ORDER_DURATION) revert DurationTooLong();
        bytes32 poolId = keccak256(abi.encode(key));
        orderId = nextOrderId++;
        orders[orderId] = Order({
            maker: msg.sender,
            sellToken0: sellToken0,
            amountIn: amountIn,
            minAmountOut: minAmountOut,
            expiry: block.timestamp + duration,
            active: true,
            poolId: poolId
        });
        Currency tokenIn = sellToken0 ? key.currency0 : key.currency1;
        IERC20(Currency.unwrap(tokenIn)).safeTransferFrom(msg.sender, address(this), amountIn);
        poolOrders[poolId].push(orderId);
        emit OrderPosted(orderId, msg.sender, sellToken0, amountIn, minAmountOut, block.timestamp + duration);
    }

    function cancelOrder(uint256 orderId, PoolKey calldata key) external nonReentrant {
        Order storage order = orders[orderId];
        // L-2 fix: use orderId < nextOrderId for existence check
        if (orderId >= nextOrderId) revert OrderNotFound();
        if (order.maker == address(0)) revert OrderNotFound();
        if (msg.sender != order.maker) revert Unauthorized();
        if (!order.active) revert OrderNotActive();
        bytes32 poolId = keccak256(abi.encode(key));
        if (poolId != order.poolId) revert PoolMismatch();

        order.active = false;
        _removeOrder(poolId, orderId);

        Currency tokenIn = order.sellToken0 ? key.currency0 : key.currency1;
        // H-2 fix: SafeERC20
        IERC20(Currency.unwrap(tokenIn)).safeTransfer(order.maker, order.amountIn);
        emit OrderCancelled(orderId, order.maker);
    }

    function getPoolOrders(PoolKey calldata key) external view returns (uint256[] memory) {
        return poolOrders[keccak256(abi.encode(key))];
    }

    /// @notice beforeSwap -- match P2P orders using CustomCurve pattern
    /// @dev If match found: take input from PM -> send to maker, settle output to PM from escrow
    function beforeSwap(address sender, PoolKey calldata key, IPoolManager.SwapParams calldata params, bytes calldata)
        external onlyPoolManager nonReentrant returns (bytes4, BeforeSwapDelta, uint24)
    {
        // I-1 fix: don't block non-whitelisted senders -- fall through to AMM instead
        if (!allowedBots[sender]) {
            return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }
        // I-2 fix: don't revert on exact-output, just fall through to AMM
        if (params.amountSpecified >= 0) {
            return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }
        // Guard int256.min: negating it overflows (undefined in two's complement)
        if (params.amountSpecified == type(int256).min) revert AmountOverflow();
        // Safe cast: negate and check fits in int128 (for BeforeSwapDelta)
        uint256 absAmount = uint256(-params.amountSpecified);
        if (absAmount > uint256(uint128(type(int128).max))) revert AmountOverflow();
        uint128 takerAmountIn = uint128(absAmount);

        bytes32 poolId = keccak256(abi.encode(key));
        uint256[] storage orderIds = poolOrders[poolId];

        // H-3 fix: bounded iteration
        uint256 maxIter = orderIds.length < MAX_ITERATIONS ? orderIds.length : MAX_ITERATIONS;
        for (uint256 i = 0; i < maxIter; i++) {
            uint256 matchedOrderId = orderIds[i];
            Order storage order = orders[matchedOrderId];
            if (!order.active || block.timestamp > order.expiry) continue;
            if (order.sellToken0 == params.zeroForOne) continue;
            if (takerAmountIn < order.minAmountOut) continue;

            // Match found!
            // M-3 fix: effects before interactions
            order.active = false;
            _removeOrder(poolId, matchedOrderId);

            (Currency inputCurrency, Currency outputCurrency) = params.zeroForOne
                ? (key.currency0, key.currency1)
                : (key.currency1, key.currency0);

            // M-1 fix: only take order.minAmountOut from taker (not full input)
            uint128 takerPays = order.minAmountOut;

            // 1. Take taker's input FROM PM to maker (PM owes hook, hook sends to maker)
            poolManager.take(inputCurrency, order.maker, takerPays);

            // 2. Settle maker's escrowed output TO PM (hook pays PM)
            poolManager.sync(outputCurrency);
            // H-2 fix: SafeERC20
            IERC20(Currency.unwrap(outputCurrency)).safeTransfer(address(poolManager), order.amountIn);
            poolManager.settle();

            emit P2PTrade(
                matchedOrderId, order.maker, sender,
                Currency.unwrap(inputCurrency), Currency.unwrap(outputCurrency),
                takerPays, order.amountIn
            );

            int128 specified = int128(uint128(takerPays));
            int128 unspecified = -int128(uint128(order.amountIn));
            return (
                IHooks.beforeSwap.selector,
                toBeforeSwapDelta(specified, unspecified),
                0
            );
        }

        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    /// @dev Remove an orderId from the pool's order array via swap-and-pop.
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

    /// @notice Permissionless cleanup: remove expired orders, refund escrowed tokens.
    /// @dev Anyone can call this to keep the pool's order array bounded.
    ///      Uses pull-pattern for failed refunds -- they go to unclaimedBalances.
    function purgeExpiredOrders(PoolKey calldata key, uint256 maxPurge) external nonReentrant {
        bytes32 poolId = keccak256(abi.encode(key));
        uint256[] storage ids = poolOrders[poolId];
        uint256 i = 0;
        uint256 purged = 0;
        // H-4 fix: bounded iteration via maxPurge parameter
        while (i < ids.length && purged < maxPurge) {
            Order storage order = orders[ids[i]];
            if (order.active && block.timestamp > order.expiry) {
                uint256 expiredId = ids[i];
                order.active = false;
                // Refund escrowed tokens to maker
                Currency tokenIn = order.sellToken0 ? key.currency0 : key.currency1;
                address token = Currency.unwrap(tokenIn);
                // H-4 fix: catch transfer failures, track unclaimed balances
                try IERC20(token).transfer(order.maker, order.amountIn) returns (bool success) {
                    if (!success) {
                        unclaimedBalances[order.maker][token] += order.amountIn;
                        emit RefundFailed(expiredId, order.maker);
                    }
                } catch {
                    unclaimedBalances[order.maker][token] += order.amountIn;
                    emit RefundFailed(expiredId, order.maker);
                }
                // Swap-and-pop removal
                ids[i] = ids[ids.length - 1];
                ids.pop();
                emit OrderExpired(expiredId, order.maker);
                purged++;
                // Don't increment i -- swapped element needs checking
            } else {
                i++;
            }
        }
    }

    /// @notice Pull-pattern: makers claim their own failed refunds
    function claimRefund(address token) external nonReentrant {
        uint256 amount = unclaimedBalances[msg.sender][token];
        if (amount == 0) revert InvalidAmounts();
        unclaimedBalances[msg.sender][token] = 0;
        IERC20(token).safeTransfer(msg.sender, amount);
    }

    /// @notice afterSwap -- no-op
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
