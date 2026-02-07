// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title DeployClaw2Claw
/// @notice Deploys the Claw2ClawHook P2P order matching system on Base Sepolia
/// @dev Uses CREATE2 to mine a hook address with the correct flag bits (0x0188)

import "forge-std/Script.sol";
import {Claw2ClawHook} from "../src/Claw2ClawHook.sol";
import {MockToken} from "../src/MockToken.sol";
import {IPoolManager} from "@v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "@v4-core/types/PoolKey.sol";
import {Currency} from "@v4-core/types/Currency.sol";
import {IHooks} from "@v4-core/interfaces/IHooks.sol";
import {TickMath} from "@v4-core/libraries/TickMath.sol";

/// @dev Minimal CREATE2 deployer proxy - deployed first, then used to deploy the hook
contract Create2Deployer {
    function deploy(bytes memory code, bytes32 salt) external returns (address addr) {
        assembly {
            addr := create2(0, add(code, 0x20), mload(code), salt)
        }
        require(addr != address(0), "CREATE2 failed");
    }
}

interface IPoolModifyLiquidityTest {
    function modifyLiquidity(
        PoolKey calldata key,
        IPoolManager.ModifyLiquidityParams calldata params,
        bytes calldata hookData
    ) external payable returns (int256);
}

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

contract DeployClaw2Claw is Script {
    address constant POOL_MANAGER = 0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408;
    address constant POOL_SWAP_TEST = 0x8B5bcC363ddE2614281aD875bad385E0A785D3B9;
    address constant POOL_MODIFY_LIQUIDITY_TEST = 0x37429cD17Cb1454C34E7F50b09725202Fd533039;

    uint160 constant FLAG_MASK = 0x3FFF;
    uint160 constant REQUIRED_FLAGS = 0x0188; // BEFORE_SWAP (0x100) | AFTER_SWAP (0x80) | BEFORE_SWAP_RETURNS_DELTA (0x08)

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        console.log("Deployer:", deployer);

        vm.startBroadcast(deployerKey);

        // --- 1. Deploy Mock Tokens ---
        MockToken claw = new MockToken("Claw Token", "CLAW", 18);
        console.log("CLAW:", address(claw));

        MockToken zug = new MockToken("Zug Gold", "ZUG", 18);
        console.log("ZUG:", address(zug));

        // Mint tokens (generous amounts for testing)
        claw.mint(deployer, 1_000_000 ether);
        zug.mint(deployer, 1_000_000 ether);

        // --- 2. Deploy CREATE2 factory, then mine salt and deploy hook ---
        Create2Deployer factory = new Create2Deployer();
        console.log("CREATE2 Factory:", address(factory));

        bytes memory creationCode = abi.encodePacked(
            type(Claw2ClawHook).creationCode,
            abi.encode(deployer, POOL_MANAGER)
        );
        bytes32 initCodeHash = keccak256(creationCode);

        // Mine salt off-chain style (in the script's EVM)
        bytes32 salt;
        bool found;
        for (uint256 i = 0; i < 500_000; i++) {
            address predicted = address(uint160(uint256(keccak256(abi.encodePacked(
                bytes1(0xff),
                address(factory),
                bytes32(i),
                initCodeHash
            )))));
            if ((uint160(predicted) & FLAG_MASK) == REQUIRED_FLAGS) {
                salt = bytes32(i);
                found = true;
                console.log("Found salt:", i);
                console.log("Predicted hook address:", predicted);
                break;
            }
        }
        require(found, "Salt not found");

        address hookAddr = factory.deploy(creationCode, salt);
        console.log("Claw2ClawHook:", hookAddr);
        require(uint160(hookAddr) & FLAG_MASK == REQUIRED_FLAGS, "Flag mismatch");

        Claw2ClawHook hook = Claw2ClawHook(hookAddr);

        // --- 3. Whitelist deployer + helpers as bots ---
        hook.addBot(deployer);
        hook.addBot(POOL_SWAP_TEST);
        hook.addBot(POOL_MODIFY_LIQUIDITY_TEST);
        console.log("Bots whitelisted");

        // --- 4. Initialize pool ---
        address token0;
        address token1;
        if (address(claw) < address(zug)) {
            token0 = address(claw);
            token1 = address(zug);
        } else {
            token0 = address(zug);
            token1 = address(claw);
        }

        PoolKey memory poolKey = PoolKey({
            currency0: Currency.wrap(token0),
            currency1: Currency.wrap(token1),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(hookAddr)
        });

        uint160 sqrtPriceX96 = 79228162514264337593543950336; // 1:1
        IPoolManager(POOL_MANAGER).initialize(poolKey, sqrtPriceX96);
        console.log("Pool initialized");

        // --- 5. Add liquidity ---
        MockToken(token0).approve(POOL_MODIFY_LIQUIDITY_TEST, type(uint256).max);
        MockToken(token1).approve(POOL_MODIFY_LIQUIDITY_TEST, type(uint256).max);

        IPoolModifyLiquidityTest(POOL_MODIFY_LIQUIDITY_TEST).modifyLiquidity(
            poolKey,
            IPoolManager.ModifyLiquidityParams({
                tickLower: -600,
                tickUpper: 600,
                liquidityDelta: 100_000e18,
                salt: bytes32(0)
            }),
            bytes("")
        );
        console.log("Liquidity added");

        // --- 6. Test swap ---
        MockToken(token0).approve(POOL_SWAP_TEST, type(uint256).max);
        MockToken(token1).approve(POOL_SWAP_TEST, type(uint256).max);

        IPoolSwapTest(POOL_SWAP_TEST).swap(
            poolKey,
            IPoolManager.SwapParams({
                zeroForOne: true,
                amountSpecified: -1000 ether,
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            IPoolSwapTest.TestSettings({
                takeClaims: false,
                settleUsingBurn: false
            }),
            bytes("")
        );
        console.log("Test swap completed!");

        vm.stopBroadcast();
    }
}
