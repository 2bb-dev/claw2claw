import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not set');
}
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

// Generate a fake API key
function generateApiKey(): string {
  return `bot_${randomBytes(24).toString('hex')}`;
}

// Generate a fake wallet address
function generateWalletAddress(): string {
  return `0x${randomBytes(20).toString('hex')}`;
}

// Mock bot names for testing
const BOT_NAMES = [
  'AlphaTrader',
  'BetaArb',
  'GammaScalper',
  'DeltaHedge',
  'EpsilonMM',
  'ZetaBot',
  'EtaSwapper',
  'ThetaGrid',
  'IotaSniper',
  'KappaFlow',
];

// Asset configurations for bots
const ASSET_CONFIGS = [
  { symbol: 'ETH', usdPrice: 2450.0 },
  { symbol: 'USDC', usdPrice: 1.0 },
  { symbol: 'BTC', usdPrice: 45000.0 },
  { symbol: 'SOL', usdPrice: 120.0 },
  { symbol: 'DOGE', usdPrice: 0.12 },
];

async function main() {
  console.log('🌱 Seeding database with mock data...\n');

  // Clear existing data
  console.log('🗑️  Clearing existing data...');
  await prisma.deal.deleteMany();
  await prisma.order.deleteMany();
  await prisma.botAsset.deleteMany();
  await prisma.bot.deleteMany();
  console.log('✓ Cleared existing data\n');

  // Create bots
  console.log('🤖 Creating mock bots...');
  const bots = [];
  for (let i = 0; i < BOT_NAMES.length; i++) {
    const bot = await prisma.bot.create({
      data: {
        name: BOT_NAMES[i],
        apiKey: generateApiKey(),
        humanOwner: `owner-${i + 1}@test.com`,
        walletAddress: generateWalletAddress(),
        ensName: i < 3 ? `${BOT_NAMES[i].toLowerCase()}.eth` : null,
        strategy: {
          type: ['market-maker', 'arbitrage', 'scalper', 'grid'][i % 4],
          riskLevel: ['low', 'medium', 'high'][i % 3],
          maxPositionSize: 1000 + (i * 500),
        },
      },
    });
    bots.push(bot);
    console.log(`  ✓ Created bot: ${bot.name} (${bot.id})`);
  }
  console.log(`✓ Created ${bots.length} bots\n`);

  // Assign assets to bots
  console.log('💰 Assigning assets to bots...');
  for (const bot of bots) {
    // Each bot gets random selection of assets
    const selectedAssets = ASSET_CONFIGS
      .filter(() => Math.random() > 0.3) // ~70% chance for each asset
      .slice(0, 3 + Math.floor(Math.random() * 3)); // 3-5 assets
    
    for (const asset of selectedAssets) {
      const amount = asset.symbol === 'USDC' 
        ? 1000 + Math.random() * 9000  // 1k-10k USDC
        : asset.symbol === 'ETH'
        ? 0.5 + Math.random() * 4.5    // 0.5-5 ETH
        : asset.symbol === 'BTC'
        ? 0.01 + Math.random() * 0.5   // 0.01-0.51 BTC
        : 10 + Math.random() * 100;     // 10-110 for others

      await prisma.botAsset.create({
        data: {
          botId: bot.id,
          symbol: asset.symbol,
          amount: parseFloat(amount.toFixed(6)),
          usdPrice: asset.usdPrice,
        },
      });
    }
  }
  console.log('✓ Assigned assets to bots\n');

  // Create orders
  console.log('📋 Creating mock orders...');
  const orders = [];
  const orderStatuses = ['open', 'filled', 'cancelled'];
  const tokenPairs = ['ETH/USDC', 'BTC/USDC', 'SOL/USDC'];

  for (let i = 0; i < 25; i++) {
    const bot = bots[Math.floor(Math.random() * bots.length)];
    const tokenPair = tokenPairs[Math.floor(Math.random() * tokenPairs.length)];
    const type = Math.random() > 0.5 ? 'buy' : 'sell';
    const status = orderStatuses[Math.floor(Math.random() * orderStatuses.length)];
    
    // Base prices for token pairs
    const basePrices: Record<string, number> = {
      'ETH/USDC': 2450,
      'BTC/USDC': 45000,
      'SOL/USDC': 120,
    };
    
    // Add some variance to price (+/- 5%)
    const basePrice = basePrices[tokenPair];
    const priceVariance = basePrice * (0.95 + Math.random() * 0.1);
    
    const order = await prisma.order.create({
      data: {
        botId: bot.id,
        type,
        tokenPair,
        price: parseFloat(priceVariance.toFixed(2)),
        amount: parseFloat((0.1 + Math.random() * 2).toFixed(4)),
        status,
        reason: status === 'cancelled' ? 'User cancelled' : null,
        createdAt: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000), // Random time within last week
      },
    });
    orders.push(order);
  }
  console.log(`✓ Created ${orders.length} orders\n`);

  // Create deals from filled orders
  console.log('🤝 Creating mock deals...');
  const filledOrders = orders.filter(o => o.status === 'filled');
  let dealCount = 0;
  
  for (const order of filledOrders) {
    // Pick a random taker (different from maker)
    const maker = bots.find(b => b.id === order.botId)!;
    const availableTakers = bots.filter(b => b.id !== order.botId);
    const taker = availableTakers[Math.floor(Math.random() * availableTakers.length)];
    
    const reviews = [
      'Fast execution, great trade!',
      'Smooth transaction',
      'Good counterparty',
      'Would trade again',
      null, // Some deals have no reviews
    ];
    
    await prisma.deal.create({
      data: {
        orderId: order.id,
        makerId: maker.id,
        takerId: taker.id,
        price: order.price,
        amount: order.amount,
        makerReview: reviews[Math.floor(Math.random() * reviews.length)],
        takerReview: reviews[Math.floor(Math.random() * reviews.length)],
        executedAt: new Date(order.createdAt.getTime() + Math.random() * 60 * 60 * 1000), // Up to 1 hour after order
      },
    });
    dealCount++;
  }
  console.log(`✓ Created ${dealCount} deals\n`);

  // Summary
  console.log('━'.repeat(50));
  console.log('📊 Seed Summary:');
  console.log(`   • Bots:   ${bots.length}`);
  console.log(`   • Orders: ${orders.length}`);
  console.log(`   • Deals:  ${dealCount}`);
  console.log('━'.repeat(50));
  
  // Print API keys for testing
  console.log('\n🔑 Bot API Keys for testing:\n');
  for (const bot of bots.slice(0, 5)) {
    console.log(`   ${bot.name}: ${bot.apiKey}`);
  }
  console.log('   ... and more\n');
  
  console.log('✅ Seeding complete!');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
