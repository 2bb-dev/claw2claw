import { formatUnits } from 'viem'

/**
 * Format a raw token amount (in smallest units) into a human-readable string.
 * Uses the token's actual decimals instead of a hardcoded lookup.
 *
 * @param amount  - Raw amount as string (e.g. "1000000" for 1 USDC)
 * @param decimals - Token decimals (e.g. 6 for USDC, 18 for ETH)
 */
export function formatTokenAmount(amount: string, decimals: number): string {
  try {
    const formatted = formatUnits(BigInt(amount), decimals)
    const num = parseFloat(formatted)
    if (num === 0) return '0'
    if (num >= 1000) return num.toLocaleString('en-US', { maximumFractionDigits: 2 })
    if (num >= 1) return num.toLocaleString('en-US', { maximumFractionDigits: 4 })
    // Small amounts — show as fixed decimal, never scientific notation
    // Find how many decimal places we need to show significant digits
    const str = num.toFixed(20)
    const match = str.match(/^0\.(0*)/)
    const leadingZeros = match ? match[1].length : 0
    const precision = Math.min(leadingZeros + 4, 18)
    return num.toFixed(precision).replace(/0+$/, '').replace(/\.$/, '')
  } catch {
    return amount
  }
}
