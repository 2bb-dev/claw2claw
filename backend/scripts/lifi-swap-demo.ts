/**
 * LI.FI Cross-Chain Swap Demo (EIP-7702 Wallet)
 * 
 * End-to-end: Register bot → Fund wallet → Swap cross-chain
 * 
 * EIP-7702 + Pimlico gas sponsorship: No ETH needed for gas — only swap tokens
 * 
 * Prerequisites:
 *   - Backend running: docker compose up --build -d
 *   - MASTER_SECRET + PIMLICO_API_KEY set in .env
 * 
 * Usage:
 *   npx tsx backend/scripts/lifi-swap-demo.ts              # ETH Base → ETH Arbitrum
 *   npx tsx backend/scripts/lifi-swap-demo.ts --usdc        # USDC Base → ETH Arbitrum
 * 
 * Reuse existing bot:
 *   API_KEY=claw_xxx npx tsx backend/scripts/lifi-swap-demo.ts
 */

const API_BASE = process.env.API_BASE || 'http://localhost:3001/api'
const EXISTING_API_KEY = process.env.API_KEY || ''
const USE_USDC = process.argv.includes('--usdc')

// Mainnet chain IDs (LI.FI is mainnet-only)
const FROM_CHAIN = 8453    // Base
const TO_CHAIN = 42161     // Arbitrum

// Token addresses
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const NATIVE_ETH = '0x0000000000000000000000000000000000000000'

// Swap config based on mode
const FROM_TOKEN = USE_USDC ? USDC_BASE : NATIVE_ETH
const TO_TOKEN = NATIVE_ETH
const SWAP_AMOUNT = USE_USDC ? '1000000' : '1000000000000000'  // 1 USDC or 0.001 ETH
const SWAP_LABEL = USE_USDC ? '1 USDC' : '0.001 ETH'
const MODE_LABEL = USE_USDC ? 'USDC (Base) → ETH (Arbitrum)' : 'ETH (Base) → ETH (Arbitrum)'
const GAS_NOTE = '(gas sponsored by Pimlico — no ETH needed for gas!)'

// How long to poll for balance (5 minutes max)
const POLL_TIMEOUT_MS = 5 * 60 * 1000
const POLL_INTERVAL_MS = 10_000

const BASE_RPC = 'https://mainnet.base.org'

// ── Helpers ──

async function api(method: string, path: string, body?: unknown, apiKey?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  const data = await res.json()
  if (!res.ok) {
    throw new Error(`API ${method} ${path} failed (${res.status}): ${JSON.stringify(data)}`)
  }
  return data
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function rpcCall(method: string, params: unknown[]) {
  const resp = await fetch(BASE_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
  })
  const data = await resp.json()
  return data.result
}

async function getEthBalance(address: string): Promise<bigint> {
  const result = await rpcCall('eth_getBalance', [address, 'latest'])
  return BigInt(result || '0x0')
}

async function getUsdcBalance(address: string): Promise<bigint> {
  const selector = '0x70a08231'
  const padded = address.slice(2).toLowerCase().padStart(64, '0')
  const result = await rpcCall('eth_call', [{ to: USDC_BASE, data: `${selector}${padded}` }, 'latest'])
  return BigInt(result || '0x0')
}

// ── Main Flow ──

async function main() {
  console.log('═══════════════════════════════════════════════')
  console.log('  🦀 Claw2Claw — LI.FI Cross-Chain Swap Demo')
  console.log('  EIP-7702 + Pimlico gas sponsorship')
  console.log(`  ${MODE_LABEL} ${GAS_NOTE}`)
  console.log('═══════════════════════════════════════════════\n')

  let apiKey: string
  let walletAddress: string

  if (EXISTING_API_KEY) {
    // ── Reuse existing bot ──
    console.log('📝 Step 1: Reusing existing bot...')
    apiKey = EXISTING_API_KEY
    
    const me = await api('GET', '/bots/me', undefined, apiKey)
    walletAddress = me.bot?.walletAddress || me.walletAddress || me.wallet || 'unknown'
    
    console.log(`   ✅ Using existing bot`)
    console.log(`   API Key:    ${apiKey}`)
    console.log(`   Wallet:     ${walletAddress}`)
  } else {
    // ── Step 1: Register Bot with EIP-7702 wallet ──
    console.log('📝 Step 1: Registering bot with EIP-7702 wallet...')
    const registerResult = await api('POST', '/bots/register', {
      name: `lifi-demo-${Date.now()}`,
      createWallet: true,
    })

    apiKey = registerResult.bot.apiKey
    walletAddress = registerResult.bot.wallet

    if (!walletAddress) {
      console.error('   ❌ Wallet creation failed!')
      console.error('      Check: MASTER_SECRET in .env')
      process.exit(1)
    }

    console.log(`   ✅ Bot registered!`)
    console.log(`   API Key:    ${apiKey}`)
    console.log(`   Wallet:     ${walletAddress}`)
    console.log(`   (EIP-7702: this address is both EOA and smart account)`)
  }

  if (walletAddress === 'unknown') {
    console.error('\n   ❌ Could not resolve wallet address. Check bot registration.')
    process.exit(1)
  }

  // ── Step 2: Get Quote ──
  console.log(`\n📊 Step 2: Getting quote (${MODE_LABEL})...`)

  const quoteResult = await api('POST', '/swap/quote', {
    fromChain: FROM_CHAIN,
    toChain: TO_CHAIN,
    fromToken: FROM_TOKEN,
    toToken: TO_TOKEN,
    fromAmount: SWAP_AMOUNT,
  }, apiKey)

  console.log(`   From: ${SWAP_LABEL} on Base`)
  console.log(`   To:   ETH on Arbitrum`)
  if (quoteResult.quote) {
    console.log(`   Est. receive: ${Number(quoteResult.quote.toAmount) / 1e18} ETH`)
    console.log(`   Est. time: ${quoteResult.quote.estimatedTime}s`)
    console.log(`   Bridge: ${quoteResult.quote.toolsUsed?.join(', ') || 'unknown'}`)
  }

  // ── Step 3: Wait for funding ──
  const fundingNeeded = USE_USDC ? '≥ 1 USDC (gas sponsored by Pimlico)' : '≥ 0.001 ETH for swap (gas sponsored)'
  console.log('\n💰 Step 3: Waiting for swap token on Base...')
  console.log(`   ┌──────────────────────────────────────────────────┐`)
  console.log(`   │  Send to wallet on BASE MAINNET:                │`)
  console.log(`   │  ${walletAddress}  │`)
  console.log(`   │  ${fundingNeeded.padEnd(49)}│`)
  console.log(`   │  ⚡ Gas is sponsored by Pimlico — no ETH needed!  │`)
  console.log(`   └──────────────────────────────────────────────────┘`)
  console.log(`   Polling every ${POLL_INTERVAL_MS / 1000}s... (timeout: ${POLL_TIMEOUT_MS / 1000}s)\n`)

  const startTime = Date.now()
  let funded = false

  while (Date.now() - startTime < POLL_TIMEOUT_MS) {
    try {
      const ethBal = await getEthBalance(walletAddress)
      const ethHuman = Number(ethBal) / 1e18

      if (USE_USDC) {
        const usdcBal = await getUsdcBalance(walletAddress)
        const usdcHuman = Number(usdcBal) / 1e6
        process.stdout.write(`\r   USDC: ${usdcHuman.toFixed(2)}   `)
        if (usdcBal >= BigInt(SWAP_AMOUNT)) {
          console.log(`\n   ✅ Funded! USDC: ${usdcHuman.toFixed(2)} (gas sponsored by Pimlico)`)
          funded = true
          break
        }
      } else {
        const ethBal = await getEthBalance(walletAddress)
        const ethHuman = Number(ethBal) / 1e18
        process.stdout.write(`\r   ETH: ${ethHuman.toFixed(6)}   `)
        if (ethBal >= BigInt(SWAP_AMOUNT)) {
          console.log(`\n   ✅ Funded! ETH: ${ethHuman.toFixed(6)} (gas sponsored by Pimlico)`)
          funded = true
          break
        }
      }
    } catch {
      process.stdout.write(`\r   ⏳ Checking...`)
    }

    await sleep(POLL_INTERVAL_MS)
  }

  if (!funded) {
    console.log(`\n   ❌ Timeout — insufficient funds.`)
    console.log(`   Need: ${fundingNeeded}`)
    console.log(`\n   Rerun with: API_KEY=${apiKey} npx tsx backend/scripts/lifi-swap-demo.ts${USE_USDC ? ' --usdc' : ''}`)
    process.exit(1)
  }

  // ── Step 4: Execute Cross-Chain Swap ──
  console.log(`\n🔄 Step 4: Executing swap (${MODE_LABEL})...`)

  try {
    const swapResult = await api('POST', '/swap/execute', {
      fromChain: FROM_CHAIN,
      toChain: TO_CHAIN,
      fromToken: FROM_TOKEN,
      toToken: TO_TOKEN,
      fromAmount: SWAP_AMOUNT,
      comment: `LI.FI demo: ${MODE_LABEL} (EIP-7702)`,
    }, apiKey)

    console.log(`   ✅ Swap executed!`)
    console.log(`   TX Hash:    ${swapResult.swap.txHash}`)
    console.log(`   Deal Log:   ${swapResult.swap.dealLogId}`)
    console.log(`   Status:     ${swapResult.swap.status}`)

    // ── Step 5: Monitor Bridge Status ──
    console.log('\n📊 Step 5: Monitoring cross-chain bridge status...')

    for (let i = 0; i < 30; i++) {
      await sleep(10_000)

      try {
        const statusResult = await api(
          'GET',
          `/swap/${swapResult.swap.txHash}/status?fromChain=${FROM_CHAIN}&toChain=${TO_CHAIN}`,
          undefined,
          apiKey
        )

        const s = statusResult.status
        console.log(`   [${new Date().toLocaleTimeString()}] ${s.status} ${s.substatus ? `(${s.substatus})` : ''}`)

        if (s.status === 'DONE' || s.status === 'COMPLETED') {
          console.log(`\n   🎉 Cross-chain transfer complete!`)
          console.log(`   BaseScan: https://basescan.org/tx/${swapResult.swap.txHash}`)
          break
        } else if (s.status === 'FAILED') {
          console.log(`\n   ❌ Transfer failed.`)
          break
        }
      } catch {
        console.log(`   [${new Date().toLocaleTimeString()}] Waiting for bridge confirmation...`)
      }
    }
  } catch (error) {
    console.error('\n   ❌ Swap failed:', (error as Error).message)
    console.log(`\n   Rerun with: API_KEY=${apiKey} npx tsx backend/scripts/lifi-swap-demo.ts${USE_USDC ? ' --usdc' : ''}`)
  }

  console.log('\n═══════════════════════════════════════════════')
  console.log('  Demo complete!')
  console.log('═══════════════════════════════════════════════\n')
}

main().catch(console.error)
