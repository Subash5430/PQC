// utils/pqc.js
// Post-Quantum Cryptography utilities using Kyber simulation

import CryptoJS from 'crypto-js';

/**
 * Generate Kyber keypair for a user
 * DETERMINISTIC: Same wallet = same keypair
 * Simplified simulation for demo
 */
export function generateKyberKeypair(walletAddress) {
  // Use wallet address as the seed for deterministic keypair
  const seed = CryptoJS.SHA256(walletAddress + 'kyber-v2').toString();
  
  // For simulation: public key and private key are the same derived key
  // In real Kyber, they would be mathematically related but different
  const keyMaterial = seed.substring(0, 64);
  
  return {
    publicKey: 'KYBER_PK_' + keyMaterial,
    privateKey: 'KYBER_SK_' + keyMaterial // Same material for symmetric simulation
  };
}

/**
 * Encapsulate (encrypt) session key with Kyber public key
 * Simplified: Uses the public key material directly for AES encryption
 */
export function kyberEncapsulate(sessionKey, publicKey) {
  // Extract key material from public key
  const keyMaterial = publicKey.replace('KYBER_PK_', '');
  
  // Use the key material directly for encryption
  const encapsulated = CryptoJS.AES.encrypt(sessionKey, keyMaterial).toString();
  
  return 'KYBER_ENC_' + encapsulated;
}

/**
 * Decapsulate (decrypt) session key with Kyber private key
 * Simplified: Uses the private key material directly for AES decryption
 */
export function kyberDecapsulate(encapsulatedKey, privateKey) {
  // Remove prefix
  const ciphertext = encapsulatedKey.replace('KYBER_ENC_', '');
  
  // Extract key material from private key
  const keyMaterial = privateKey.replace('KYBER_SK_', '');
  
  // Decrypt using the key material
  const decrypted = CryptoJS.AES.decrypt(ciphertext, keyMaterial);
  return decrypted.toString(CryptoJS.enc.Utf8);
}

/**
 * Store Kyber keypair in localStorage
 */
export function storeKyberKeypair(walletAddress, keypair) {
  localStorage.setItem(`kyber_keypair_${walletAddress}`, JSON.stringify(keypair));
}

/**
 * Retrieve Kyber keypair from localStorage
 */
export function getKyberKeypair(walletAddress) {
  const stored = localStorage.getItem(`kyber_keypair_${walletAddress}`);
  return stored ? JSON.parse(stored) : null;
}

/**
 * Get or generate Kyber keypair for user
 */
export function getOrCreateKyberKeypair(walletAddress) {
  let keypair = getKyberKeypair(walletAddress);
  
  if (!keypair) {
    keypair = generateKyberKeypair(walletAddress);
    storeKyberKeypair(walletAddress, keypair);
    console.log('🔐 Generated new Kyber keypair for', walletAddress.substring(0, 10) + '...');
  }
  
  return keypair;
}

// Demo note marker
export const PQC_DEMO_NOTE = `
⚠️ SIMPLIFIED SIMULATION:
This is a simplified Kyber simulation for demonstration.
Real Kyber uses lattice-based cryptography with complex mathematical operations.

Current: Symmetric key derivation (same material for pub/priv)
Production: Asymmetric Kyber KEM with liboqs library

Security: This simulation demonstrates the CONCEPT and ARCHITECTURE.
For production, replace with actual liboqs Kyber-768/1024 implementation.
`;
