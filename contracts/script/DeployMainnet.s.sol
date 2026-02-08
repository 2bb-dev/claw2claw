// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title DeployMainnet
/// @notice Deploys Claw2ClawHook on Base mainnet (no mock tokens)
/// @dev Uses CREATE2 to mine a hook address with correct flag bits (0x0188)

import "forge-std/Script.sol";
import {Claw2ClawHook} from "../src/Claw2ClawHook.sol";
import {IPoolManager} from "@v4-core/interfaces/IPoolManager.sol";

/// @dev Minimal CREATE2 deployer proxy
contract Create2Deployer {
    function deploy(bytes memory code, bytes32 salt) external returns (address addr) {
        assembly {
            addr := create2(0, add(code, 0x20), mload(code), salt)
        }
        require(addr != address(0), "CREATE2 failed");
    }
}

contract DeployMainnet is Script {
    // Base mainnet Uniswap v4 PoolManager
    address constant POOL_MANAGER = 0x498581fF718922c3f8e6A244956aF099B2652b2b;

    uint160 constant FLAG_MASK = 0x3FFF;
    uint160 constant REQUIRED_FLAGS = 0x0188; // BEFORE_SWAP | AFTER_SWAP | BEFORE_SWAP_RETURNS_DELTA

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        console.log("=== Claw2ClawHook Base Mainnet Deployment ===");
        console.log("Deployer:", deployer);
        console.log("PoolManager:", POOL_MANAGER);

        vm.startBroadcast(deployerKey);

        // 1. Deploy CREATE2 factory
        Create2Deployer factory = new Create2Deployer();
        console.log("CREATE2 Factory:", address(factory));

        // 2. Mine salt for correct hook address flag bits
        bytes memory creationCode = abi.encodePacked(
            type(Claw2ClawHook).creationCode,
            abi.encode(deployer, POOL_MANAGER)
        );
        bytes32 initCodeHash = keccak256(creationCode);

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
                console.log("Hook address:", predicted);
                break;
            }
        }
        require(found, "Salt not found in 500k iterations");

        // 3. Deploy hook via CREATE2
        address hookAddr = factory.deploy(creationCode, salt);
        console.log("Claw2ClawHook deployed:", hookAddr);
        require(uint160(hookAddr) & FLAG_MASK == REQUIRED_FLAGS, "Flag mismatch");

        // 4. Whitelist deployer as initial bot
        Claw2ClawHook hook = Claw2ClawHook(hookAddr);
        hook.addBot(deployer);
        console.log("Deployer whitelisted as bot");

        vm.stopBroadcast();

        console.log("");
        console.log("=== Deployment Complete ===");
        console.log("Hook:      ", hookAddr);
        console.log("Admin:     ", deployer);
        console.log("Chain:      Base (8453)");
        console.log("");
        console.log("Next steps:");
        console.log("  1. Verify on BaseScan:");
        console.log("     forge verify-contract <HOOK_ADDR> Claw2ClawHook --chain base");
        console.log("  2. Initialize a pool with real tokens");
        console.log("  3. Whitelist bot wallets via addBot()");
    }
}
