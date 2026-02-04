/**
 * Encryption/Decryption utility for secure key storage
 * Uses AES-256-GCM with random IV for each encryption
 */
import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16

/**
 * Get the master encryption key from environment
 * Throws if MASTER_SECRET is not configured
 */
function getMasterKey(): Buffer {
  const secret = process.env.MASTER_SECRET
  if (!secret) {
    throw new Error('MASTER_SECRET environment variable is not set')
  }
  // If secret is hex string (64 chars = 32 bytes), use directly
  // Otherwise hash it to get a consistent 32-byte key
  if (secret.length === 64 && /^[a-f0-9]+$/i.test(secret)) {
    return Buffer.from(secret, 'hex')
  }
  return crypto.createHash('sha256').update(secret).digest()
}

/**
 * Encrypt a plaintext string using AES-256-GCM
 * Returns format: iv:authTag:ciphertext (all hex)
 */
export function encrypt(plaintext: string): string {
  const key = getMasterKey()
  const iv = crypto.randomBytes(IV_LENGTH)
  
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  
  let encrypted = cipher.update(plaintext, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  
  const authTag = cipher.getAuthTag().toString('hex')
  
  return `${iv.toString('hex')}:${authTag}:${encrypted}`
}

/**
 * Decrypt a ciphertext string encrypted with encrypt()
 * Expects format: iv:authTag:ciphertext (all hex)
 */
export function decrypt(encryptedData: string): string {
  const key = getMasterKey()
  
  const parts = encryptedData.split(':')
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format')
  }
  
  const [ivHex, authTagHex, ciphertext] = parts
  
  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  
  return decrypted
}

/**
 * Generate a new random 256-bit master secret
 * Use this to generate MASTER_SECRET for .env
 */
export function generateMasterSecret(): string {
  return crypto.randomBytes(32).toString('hex')
}
