# Threat Model: Post-Quantum Cryptography for Document Management

## Classical Threats

### Data Breach
Unauthorized access to encrypted documents through compromised servers, stolen credentials, or network interception. Mitigated by AES-256 encryption and zero-trust architecture.

### Insider Threats
Malicious backend operators or database administrators attempting to access sensitive data. Mitigated by storing only encrypted session keys—backend never sees plaintext.

---

## Quantum Threats

### Shor's Algorithm
**Target**: RSA and ECC (Elliptic Curve Cryptography)

**Impact**: A sufficiently powerful quantum computer can factor large numbers and solve discrete logarithm problems in polynomial time, breaking RSA/ECC encryption and digital signatures.

**Risk to This System**: If we used RSA/ECC for key exchange, all encrypted session keys would be vulnerable to future quantum attacks (harvest-now-decrypt-later).

**Status**: RSA/ECC are **NOT future-safe**.

### Grover's Algorithm
**Target**: Symmetric encryption (AES)

**Impact**: Provides quadratic speedup for brute-force attacks. AES-256 security reduced to ~128-bit equivalent against quantum computers.

**Risk to This System**: Minimal. AES-128 equivalent is still considered secure.

**Status**: AES-256 is **safe** against quantum threats.

---

## Our Defense Strategy

| Component | Algorithm | Quantum-Safe? | Justification |
|-----------|-----------|---------------|---------------|
| File Encryption | AES-256 | ✅ Yes | Grover's algorithm only halves security (256→128 bits still secure) |
| Key Exchange | Kyber (PQC) | ✅ Yes | Lattice-based cryptography resistant to Shor's algorithm |
| Blockchain | Ethereum | ⚠️ Partial | Uses ECDSA (vulnerable), but upgradeable to quantum-resistant signatures |

---

## Harvest-Now-Decrypt-Later Attack

**Scenario**: Adversaries intercept and store encrypted data today, waiting for quantum computers to become available in 10-20 years to decrypt it.

**Our Mitigation**: 
- Use Kyber (post-quantum key encapsulation) to protect AES session keys
- Even if quantum computers emerge, stored encrypted keys remain secure
- Documents encrypted with AES-256 remain protected

---

## Legal & Compliance Justification

This system implements post-quantum cryptography to:

1. **Future-proof sensitive identity documents** against quantum computing advances
2. **Comply with emerging standards** (NIST PQC standardization)
3. **Protect long-term confidentiality** for documents with 10+ year sensitivity periods
4. **Demonstrate due diligence** in cryptographic security practices

---

## Conclusion

**AES-256 is quantum-safe** for symmetric encryption.  
**RSA/ECC are NOT quantum-safe** for key exchange.  
**Kyber (PQC) protects our key exchange** against future quantum threats.

This hybrid approach balances performance (AES for files) with future security (Kyber for keys).
