-- Clear existing data
DELETE FROM "Deal";
DELETE FROM "Order";
DELETE FROM "BotAsset";
DELETE FROM "Bot";

-- Insert mock bots
INSERT INTO "Bot" (id, name, "apiKey", "humanOwner", "walletAddress", "ensName", strategy, "createdAt", "updatedAt") VALUES
('bot_alpha_001', 'AlphaTrader', 'bot_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4', 'owner-1@test.com', '0x1234567890abcdef1234567890abcdef12345678', 'alphatrader.eth', '{"type": "market-maker", "riskLevel": "low", "maxPositionSize": 1000}', NOW(), NOW()),
('bot_beta_002', 'BetaArb', 'bot_b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5', 'owner-2@test.com', '0x2345678901abcdef2345678901abcdef23456789', 'betaarb.eth', '{"type": "arbitrage", "riskLevel": "medium", "maxPositionSize": 1500}', NOW(), NOW()),
('bot_gamma_003', 'GammaScalper', 'bot_c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6', 'owner-3@test.com', '0x3456789012abcdef3456789012abcdef34567890', 'gammascalper.eth', '{"type": "scalper", "riskLevel": "high", "maxPositionSize": 2000}', NOW(), NOW()),
('bot_delta_004', 'DeltaHedge', 'bot_d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7', 'owner-4@test.com', '0x4567890123abcdef4567890123abcdef45678901', NULL, '{"type": "grid", "riskLevel": "low", "maxPositionSize": 2500}', NOW(), NOW()),
('bot_epsilon_005', 'EpsilonMM', 'bot_e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8', 'owner-5@test.com', '0x5678901234abcdef5678901234abcdef56789012', NULL, '{"type": "market-maker", "riskLevel": "medium", "maxPositionSize": 3000}', NOW(), NOW()),
('bot_zeta_006', 'ZetaBot', 'bot_f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9', 'owner-6@test.com', '0x6789012345abcdef6789012345abcdef67890123', NULL, '{"type": "arbitrage", "riskLevel": "high", "maxPositionSize": 3500}', NOW(), NOW()),
('bot_eta_007', 'EtaSwapper', 'bot_g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0', 'owner-7@test.com', '0x7890123456abcdef7890123456abcdef78901234', NULL, '{"type": "scalper", "riskLevel": "low", "maxPositionSize": 4000}', NOW(), NOW()),
('bot_theta_008', 'ThetaGrid', 'bot_h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1', 'owner-8@test.com', '0x8901234567abcdef8901234567abcdef89012345', NULL, '{"type": "grid", "riskLevel": "medium", "maxPositionSize": 4500}', NOW(), NOW()),
('bot_iota_009', 'IotaSniper', 'bot_i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2', 'owner-9@test.com', '0x9012345678abcdef9012345678abcdef90123456', NULL, '{"type": "market-maker", "riskLevel": "high", "maxPositionSize": 5000}', NOW(), NOW()),
('bot_kappa_010', 'KappaFlow', 'bot_j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2g3', 'owner-10@test.com', '0x0123456789abcdef0123456789abcdef01234567', NULL, '{"type": "arbitrage", "riskLevel": "low", "maxPositionSize": 5500}', NOW(), NOW());

-- Insert bot assets
INSERT INTO "BotAsset" (id, "botId", symbol, amount, "usdPrice", "createdAt", "updatedAt") VALUES
-- AlphaTrader assets
('asset_001', 'bot_alpha_001', 'ETH', 2.5, 2450.0, NOW(), NOW()),
('asset_002', 'bot_alpha_001', 'USDC', 5000.0, 1.0, NOW(), NOW()),
('asset_003', 'bot_alpha_001', 'BTC', 0.15, 45000.0, NOW(), NOW()),
-- BetaArb assets
('asset_004', 'bot_beta_002', 'ETH', 3.2, 2450.0, NOW(), NOW()),
('asset_005', 'bot_beta_002', 'USDC', 8000.0, 1.0, NOW(), NOW()),
('asset_006', 'bot_beta_002', 'SOL', 25.0, 120.0, NOW(), NOW()),
-- GammaScalper assets
('asset_007', 'bot_gamma_003', 'ETH', 1.8, 2450.0, NOW(), NOW()),
('asset_008', 'bot_gamma_003', 'USDC', 3500.0, 1.0, NOW(), NOW()),
-- DeltaHedge assets
('asset_009', 'bot_delta_004', 'BTC', 0.25, 45000.0, NOW(), NOW()),
('asset_010', 'bot_delta_004', 'USDC', 12000.0, 1.0, NOW(), NOW()),
('asset_011', 'bot_delta_004', 'ETH', 4.0, 2450.0, NOW(), NOW()),
-- EpsilonMM assets
('asset_012', 'bot_epsilon_005', 'USDC', 15000.0, 1.0, NOW(), NOW()),
('asset_013', 'bot_epsilon_005', 'ETH', 5.5, 2450.0, NOW(), NOW()),
-- ZetaBot assets
('asset_014', 'bot_zeta_006', 'SOL', 50.0, 120.0, NOW(), NOW()),
('asset_015', 'bot_zeta_006', 'USDC', 6000.0, 1.0, NOW(), NOW()),
-- EtaSwapper assets
('asset_016', 'bot_eta_007', 'ETH', 2.0, 2450.0, NOW(), NOW()),
('asset_017', 'bot_eta_007', 'DOGE', 5000.0, 0.12, NOW(), NOW()),
-- ThetaGrid assets
('asset_018', 'bot_theta_008', 'BTC', 0.3, 45000.0, NOW(), NOW()),
('asset_019', 'bot_theta_008', 'ETH', 3.5, 2450.0, NOW(), NOW()),
-- IotaSniper assets
('asset_020', 'bot_iota_009', 'USDC', 20000.0, 1.0, NOW(), NOW()),
('asset_021', 'bot_iota_009', 'ETH', 6.0, 2450.0, NOW(), NOW()),
-- KappaFlow assets
('asset_022', 'bot_kappa_010', 'SOL', 75.0, 120.0, NOW(), NOW()),
('asset_023', 'bot_kappa_010', 'USDC', 9000.0, 1.0, NOW(), NOW()),
('asset_024', 'bot_kappa_010', 'ETH', 2.8, 2450.0, NOW(), NOW());

-- Insert orders
INSERT INTO "Order" (id, "botId", type, "tokenPair", price, amount, status, reason, "createdAt") VALUES
-- Open orders
('order_001', 'bot_alpha_001', 'sell', 'ETH/USDC', 2475.50, 0.5, 'open', NULL, NOW() - INTERVAL '1 hour'),
('order_002', 'bot_beta_002', 'buy', 'ETH/USDC', 2420.00, 1.0, 'open', NULL, NOW() - INTERVAL '2 hours'),
('order_003', 'bot_gamma_003', 'sell', 'BTC/USDC', 45500.00, 0.1, 'open', NULL, NOW() - INTERVAL '30 minutes'),
('order_004', 'bot_delta_004', 'buy', 'SOL/USDC', 118.50, 5.0, 'open', NULL, NOW() - INTERVAL '3 hours'),
('order_005', 'bot_epsilon_005', 'sell', 'ETH/USDC', 2480.00, 2.0, 'open', NULL, NOW() - INTERVAL '45 minutes'),
-- Filled orders
('order_006', 'bot_zeta_006', 'buy', 'ETH/USDC', 2440.00, 1.5, 'filled', NULL, NOW() - INTERVAL '1 day'),
('order_007', 'bot_eta_007', 'sell', 'SOL/USDC', 122.00, 10.0, 'filled', NULL, NOW() - INTERVAL '2 days'),
('order_008', 'bot_theta_008', 'buy', 'BTC/USDC', 44800.00, 0.05, 'filled', NULL, NOW() - INTERVAL '12 hours'),
('order_009', 'bot_iota_009', 'sell', 'ETH/USDC', 2455.00, 0.75, 'filled', NULL, NOW() - INTERVAL '6 hours'),
('order_010', 'bot_kappa_010', 'buy', 'ETH/USDC', 2435.00, 1.25, 'filled', NULL, NOW() - INTERVAL '4 hours'),
('order_011', 'bot_alpha_001', 'sell', 'BTC/USDC', 45200.00, 0.08, 'filled', NULL, NOW() - INTERVAL '3 days'),
('order_012', 'bot_beta_002', 'buy', 'SOL/USDC', 119.00, 8.0, 'filled', NULL, NOW() - INTERVAL '5 hours'),
-- Cancelled orders
('order_013', 'bot_gamma_003', 'buy', 'ETH/USDC', 2350.00, 2.5, 'cancelled', 'Price moved too fast', NOW() - INTERVAL '4 days'),
('order_014', 'bot_delta_004', 'sell', 'BTC/USDC', 46000.00, 0.15, 'cancelled', 'User cancelled', NOW() - INTERVAL '2 days'),
('order_015', 'bot_epsilon_005', 'buy', 'SOL/USDC', 115.00, 15.0, 'cancelled', 'Insufficient liquidity', NOW() - INTERVAL '1 day'),
-- More open orders
('order_016', 'bot_zeta_006', 'sell', 'ETH/USDC', 2490.00, 0.8, 'open', NULL, NOW() - INTERVAL '15 minutes'),
('order_017', 'bot_eta_007', 'buy', 'BTC/USDC', 44500.00, 0.02, 'open', NULL, NOW() - INTERVAL '20 minutes'),
('order_018', 'bot_theta_008', 'sell', 'SOL/USDC', 123.00, 12.0, 'open', NULL, NOW() - INTERVAL '5 minutes'),
-- More filled orders
('order_019', 'bot_iota_009', 'buy', 'ETH/USDC', 2445.00, 3.0, 'filled', NULL, NOW() - INTERVAL '8 hours'),
('order_020', 'bot_kappa_010', 'sell', 'BTC/USDC', 45100.00, 0.12, 'filled', NULL, NOW() - INTERVAL '10 hours'),
-- Additional variety
('order_021', 'bot_alpha_001', 'buy', 'SOL/USDC', 117.50, 20.0, 'open', NULL, NOW() - INTERVAL '10 minutes'),
('order_022', 'bot_beta_002', 'sell', 'ETH/USDC', 2465.00, 1.2, 'filled', NULL, NOW() - INTERVAL '7 hours'),
('order_023', 'bot_gamma_003', 'buy', 'BTC/USDC', 44700.00, 0.04, 'open', NULL, NOW() - INTERVAL '25 minutes'),
('order_024', 'bot_delta_004', 'sell', 'SOL/USDC', 121.50, 6.0, 'filled', NULL, NOW() - INTERVAL '9 hours'),
('order_025', 'bot_epsilon_005', 'buy', 'ETH/USDC', 2430.00, 0.9, 'open', NULL, NOW() - INTERVAL '35 minutes');

-- Insert deals for filled orders
INSERT INTO "Deal" (id, "orderId", "makerId", "takerId", price, amount, "makerReview", "takerReview", "executedAt") VALUES
('deal_001', 'order_006', 'bot_zeta_006', 'bot_alpha_001', 2440.00, 1.5, 'Fast execution, great trade!', 'Smooth transaction', NOW() - INTERVAL '1 day' + INTERVAL '5 minutes'),
('deal_002', 'order_007', 'bot_eta_007', 'bot_beta_002', 122.00, 10.0, 'Good counterparty', 'Would trade again', NOW() - INTERVAL '2 days' + INTERVAL '10 minutes'),
('deal_003', 'order_008', 'bot_theta_008', 'bot_gamma_003', 44800.00, 0.05, 'Reliable trader', NULL, NOW() - INTERVAL '12 hours' + INTERVAL '2 minutes'),
('deal_004', 'order_009', 'bot_iota_009', 'bot_delta_004', 2455.00, 0.75, NULL, 'Quick and easy', NOW() - INTERVAL '6 hours' + INTERVAL '3 minutes'),
('deal_005', 'order_010', 'bot_kappa_010', 'bot_epsilon_005', 2435.00, 1.25, 'Excellent experience', 'Perfect execution', NOW() - INTERVAL '4 hours' + INTERVAL '1 minute'),
('deal_006', 'order_011', 'bot_alpha_001', 'bot_zeta_006', 45200.00, 0.08, 'Smooth BTC trade', 'Fast settlement', NOW() - INTERVAL '3 days' + INTERVAL '8 minutes'),
('deal_007', 'order_012', 'bot_beta_002', 'bot_eta_007', 119.00, 8.0, NULL, NULL, NOW() - INTERVAL '5 hours' + INTERVAL '4 minutes'),
('deal_008', 'order_019', 'bot_iota_009', 'bot_theta_008', 2445.00, 3.0, 'Great liquidity provider', 'Solid execution', NOW() - INTERVAL '8 hours' + INTERVAL '6 minutes'),
('deal_009', 'order_020', 'bot_kappa_010', 'bot_iota_009', 45100.00, 0.12, 'Would trade again', NULL, NOW() - INTERVAL '10 hours' + INTERVAL '7 minutes'),
('deal_010', 'order_022', 'bot_beta_002', 'bot_kappa_010', 2465.00, 1.2, 'Professional trader', 'Reliable counterparty', NOW() - INTERVAL '7 hours' + INTERVAL '5 minutes'),
('deal_011', 'order_024', 'bot_delta_004', 'bot_zeta_006', 121.50, 6.0, NULL, 'Smooth SOL trade', NOW() - INTERVAL '9 hours' + INTERVAL '3 minutes');

-- Summary
SELECT 'Seed completed!' AS message;
SELECT 'Bots: ' || COUNT(*) FROM "Bot";
SELECT 'Assets: ' || COUNT(*) FROM "BotAsset";
SELECT 'Orders: ' || COUNT(*) FROM "Order";
SELECT 'Deals: ' || COUNT(*) FROM "Deal";
