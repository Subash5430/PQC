//Verification.js
import React, { useState } from "react";
import { ethers } from "ethers";
import CryptoJS from "crypto-js";
import { useNavigate } from 'react-router-dom';
import { getContract } from "./utils/contract";
import { getOrCreateKyberKeypair, kyberDecapsulate } from "./utils/pqc";
import BACKEND_URL from "./config"; // adjust path if needed
function Verification() {
  const navigate = useNavigate();
  const [account, setAccount] = useState(null);
  const [ownerAddress, setOwnerAddress] = useState("");
  const [accessibleDocs, setAccessibleDocs] = useState([]);
  const [previewDocument, setPreviewDocument] = useState(null);
  const [showPreview, setShowPreview] = useState(false);

  // Connect wallet
  async function connectWallet() {
    if (!window.ethereum) return alert("Install MetaMask");
    const provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    const signer = await provider.getSigner();
    const address = await signer.getAddress();
    setAccount(address);
    
    // ✅ Fetch encrypted keys from backend on login
    await fetchKeysFromBackend(address);
  }

  async function fetchKeysFromBackend(address) {
    try {
      const res = await fetch(`${BACKEND_URL}/keys?user=${address}`);
      const data = await res.json();
      
      // Extract keys, mimes, and names
      const keys = {};
      const mimes = {};
      const names = {};
      
      for (const docHash in data) {
        if (typeof data[docHash] === 'object') {
          keys[docHash] = data[docHash].encryptedSessionKey;
          mimes[docHash] = data[docHash].mimeType;
          names[docHash] = data[docHash].fileName;
        } else {
          // Backward compatibility
          keys[docHash] = data[docHash];
        }
      }
      
      // Store in localStorage as cache
      localStorage.setItem(`docKeys_${address}`, JSON.stringify(keys));
      localStorage.setItem(`docMimes_${address}`, JSON.stringify(mimes));
      localStorage.setItem(`docNames_${address}`, JSON.stringify(names));
    } catch (error) {
      console.error('Failed to fetch keys from backend:', error);
    }
  }

  // ✅ Fetch accessible documents from blockchain
  async function fetchAccessibleDocuments() {
    if (!account) return alert("Connect wallet first");
    if (!ownerAddress.trim()) return alert("Enter document owner address");
    
    try {
      const contract = await getContract();
      
      // ✅ Call smart contract to get accessible documents
      const docs = await contract.getAccessibleDocuments(ownerAddress);
      
      if (docs.length === 0) {
        alert("No accessible documents found. Owner hasn't granted you access.");
      }
      
      setAccessibleDocs(docs);
      
      // ✅ Fetch shared keys from backend for this owner's documents
      await fetchSharedKeysFromOwner(ownerAddress, account);
    } catch (error) {
      alert("Failed to fetch documents: " + error.message);
    }
  }

  async function fetchSharedKeysFromOwner(owner, verifier) {
    try {
      const healthCheck = await fetch(`${BACKEND_URL}/health`).catch(() => null);
      if (!healthCheck) {
        return alert('❌ Backend server is not running!\n\nStart it with:\ncd backend\nnode server.js');
      }
      
      const res = await fetch(`${BACKEND_URL}/keys?user=${verifier}`);
      const data = await res.json();
      
      console.log('🔍 Backend response:', data);
      
      const keys = {};
      const mimes = {};
      const names = {};
      
      for (const docHash in data) {
        if (typeof data[docHash] === 'object') {
          keys[docHash] = data[docHash].encryptedSessionKey;
          mimes[docHash] = data[docHash].mimeType;
          names[docHash] = data[docHash].fileName;
        } else {
          keys[docHash] = data[docHash];
        }
      }
      
      localStorage.setItem(`docKeys_${verifier}`, JSON.stringify(keys));
      localStorage.setItem(`docMimes_${verifier}`, JSON.stringify(mimes));
      localStorage.setItem(`docNames_${verifier}`, JSON.stringify(names));
      
      if (Object.keys(keys).length === 0) {
        alert('⚠️ No keys found. Owner must:\n1. Select documents\n2. Enter your address\n3. Click "Grant Access"');
      } else {
        alert(`✅ Loaded ${Object.keys(keys).length} key(s)`);
      }
    } catch (error) {
      console.error('Failed to fetch keys:', error);
      alert('Failed to fetch keys from server.');
    }
  }

  // ✅ Decrypt and verify document (blockchain-gated)
  async function decryptAndVerify(ipfsHash) {
    if (!account) return alert("Connect wallet first");
    
    try {
      const contract = await getContract();
      
      // ✅ Check blockchain permission first
      const hasAccess = await contract.hasDocumentAccess(ownerAddress, account, ipfsHash);
      
      if (!hasAccess) {
        return alert("❌ Access Denied: You don't have blockchain permission for this document.");
      }
      
      // 🔐 PQC: Retrieve PQC-encrypted session key from localStorage
      const storedKeys = JSON.parse(localStorage.getItem(`docKeys_${account}`) || '{}');
      const encapsulatedKey = storedKeys[ipfsHash];
      
      console.log('🔍 DEBUG - Verifier:', account);
      console.log('🔍 DEBUG - Document hash:', ipfsHash);
      console.log('🔍 DEBUG - All stored keys:', Object.keys(storedKeys));
      console.log('🔍 DEBUG - Encapsulated key found:', !!encapsulatedKey);
      
      if (!encapsulatedKey) {
        return alert("❌ Session key not found.\n\nPossible reasons:\n1. Owner hasn't granted you access yet\n2. Owner granted access but didn't share encryption keys\n3. Try clicking 'Fetch My Accessible Documents' again");
      }
      
      let sessionKey;
      
      try {
        // 🔐 PQC: Try Kyber decapsulation
        const keypair = getOrCreateKyberKeypair(account);
        sessionKey = kyberDecapsulate(encapsulatedKey, keypair.privateKey);
      } catch (pqcError) {
        // ⚠️ Fallback: Classical decryption
        console.warn('⚠️ PQC decryption failed, trying classical:', pqcError);
        sessionKey = CryptoJS.AES.decrypt(encapsulatedKey, account).toString(CryptoJS.enc.Utf8);
      }
      
      if (!sessionKey) {
        return alert("Failed to decrypt session key. Invalid keypair.");
      }
      
      // Fetch encrypted file from IPFS
      const response = await fetch(`https://gateway.pinata.cloud/ipfs/${ipfsHash}`);
      if (!response.ok) throw new Error("Failed to fetch from IPFS.");
      
      const encryptedData = await response.text();
      
      // ✅ Decrypt file using AES session key
      const decrypted = CryptoJS.AES.decrypt(encryptedData, sessionKey);
      const decryptedBytes = decrypted.toString(CryptoJS.enc.Base64);
      
      if (!decryptedBytes) {
        throw new Error("Decryption failed - file may be corrupted");
      }
      
      // ✅ Get MIME type from storage
      const storedMimes = JSON.parse(localStorage.getItem(`docMimes_${account}`) || '{}');
      const mimeType = storedMimes[ipfsHash] || 'application/octet-stream';
      
      setPreviewDocument({
        hash: ipfsHash,
        data: `data:${mimeType};base64,${decryptedBytes}`,
        mimeType: mimeType
      });
      setShowPreview(true);
      
    } catch (error) {
      alert("Decryption failed: " + error.message);
    }
  }

  return (
    <div style={page}>
      <style>
        {`@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;600&display=swap');`}
      </style>

      {/* HEADER */}
      <div style={header}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <img
            src="https://upload.wikimedia.org/wikipedia/commons/5/55/Emblem_of_India.svg"
            alt="India"
            style={{ height: "35px" }}
          />
          <h2 style={{ margin: 0, color: "#fff" }}>Access Data</h2>
        </div>
        
        <button style={loginBtn} onClick={connectWallet}>
          {account ? "Wallet Connected" : "Connect Wallet"}
        </button>
      </div>

      {/* HERO */}
      <div style={hero}>
        <div>
          <h1>Fetch Documents</h1>
          <p style={{ maxWidth: "480px", lineHeight: 1.6 }}>
            Connect your wallet to view documents that have been shared with you.
            All access is controlled by blockchain permissions.
          </p>
        </div>
        <img
          src="https://images.unsplash.com/photo-1633265486064-086b219458ec"
          alt="Document Verification"
          style={heroImg}
        />
      </div>

      {/* VERIFICATION DASHBOARD */}
      <div style={dashboard}>
        <h2>Accessible Documents</h2>

        <div style={card}>
          <h3>Fetch Documents</h3>
          
          <div style={{ marginBottom: "15px" }}>
            <label style={label}>Document Owner Address:</label>
            <input
              style={input}
              placeholder="Enter owner's wallet address (0x...)"
              value={ownerAddress}
              onChange={(e) => setOwnerAddress(e.target.value)}
            />
          </div>
          
          <button 
            style={fetchBtn} 
            onClick={fetchAccessibleDocuments}
            disabled={!account || !ownerAddress.trim()}
          >
            🔍 Fetch My Accessible Documents
          </button>
          
          {/* Debug button */}
          <button 
            style={{...fetchBtn, background: "#6b7280", marginTop: "10px"}} 
            onClick={() => {
              const keys = localStorage.getItem(`docKeys_${account}`);
              console.log('🔍 LocalStorage keys:', keys);
              alert('Check console for stored keys');
            }}
            disabled={!account}
          >
            🐛 Debug: Check Stored Keys
          </button>
        </div>

        {accessibleDocs.length > 0 && (
          <div style={card}>
            <h3>Documents Shared With You</h3>
            {accessibleDocs.map((doc, i) => (
              <div key={i} style={docRow}>
                <div>
                  <b>Document #{i + 1}</b>
                  <br />
                  <small style={{ color: "#0ea5e9" }}>Hash: {doc.ipfsHash}</small>
                  <br />
                  <small style={{ color: "#666" }}>
                    Uploaded: {new Date(Number(doc.timestamp) * 1000).toLocaleDateString()}
                  </small>
                </div>
                <button 
                  style={viewBtn}
                  onClick={() => decryptAndVerify(doc.ipfsHash)}
                >
                  🔓 Decrypt & View
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Back to Main App Button */}
        <div style={card}>
          <button 
            style={backBtn}
            onClick={() => navigate('/')}
          >
            ← Back to Document Management
          </button>
        </div>
      </div>

      {/* Document Preview Modal */}
      {showPreview && previewDocument && (
        <div style={modalOverlay} onClick={() => setShowPreview(false)}>
          <div style={modalContent} onClick={(e) => e.stopPropagation()}>
            <div style={modalHeader}>
              <h3>Document Verified Successfully</h3>
              <button 
                style={closeBtn}
                onClick={() => setShowPreview(false)}
              >
                ×
              </button>
            </div>
            <div style={modalBody}>
              <p><strong>IPFS Hash:</strong> {previewDocument.hash}</p>
              <p style={{ color: "#2563eb", fontWeight: "600" }}>Document decrypted and verified successfully!</p>
              <p><strong>Type:</strong> {previewDocument.mimeType}</p>
              <div style={previewContainer}>
                {/* ✅ Images - inline preview */}
                {previewDocument.mimeType.startsWith('image/') && (
                  <img 
                    src={previewDocument.data} 
                    alt="Document Preview" 
                    style={previewImage}
                    onError={() => alert("Failed to display image.")}
                  />
                )}
                
                {/* ✅ PDFs - browser viewer */}
                {previewDocument.mimeType === 'application/pdf' && (
                  <iframe
                    src={previewDocument.data}
                    style={pdfViewer}
                    title="PDF Preview"
                  />
                )}
                
                {/* ✅ Others - download option */}
                {!previewDocument.mimeType.startsWith('image/') && 
                 previewDocument.mimeType !== 'application/pdf' && (
                  <div style={downloadSection}>
                    <p>Preview not available for this file type.</p>
                    <a 
                      href={previewDocument.data} 
                      download="document"
                      style={downloadBtn}
                    >
                      💾 Download File
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Verification;

/* ================= STYLES ================= */

const page = {
  fontFamily: "Poppins, sans-serif",
  background: "linear-gradient(to bottom, #eef2ff, #f8fafc)",
  minHeight: "100vh",
};

const header = {
  background: "#1e3a8a",
  color: "#fff",
  padding: "12px 24px",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
};

const loginBtn = {
  background: "#fff",
  border: "none",
  padding: "8px 16px",
  borderRadius: "20px",
  cursor: "pointer",
};

const hero = {
  display: "flex",
  justifyContent: "space-between",
  padding: "50px",
  alignItems: "center",
};

const heroImg = {
  width: "380px",
  borderRadius: "12px",
};

const dashboard = {
  padding: "40px",
};

const card = {
  background: "#fff",
  padding: "20px",
  marginBottom: "20px",
  borderRadius: "10px",
  boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
};

const input = {
  width: "100%",
  padding: "12px",
  borderRadius: "6px",
  border: "1px solid #ccc",
  fontSize: "14px",
};

const label = {
  display: "block",
  fontWeight: "600",
  color: "#1e3a8a",
  marginBottom: "5px",
};

const fetchBtn = {
  background: "#2563eb",
  color: "#fff",
  padding: "10px 20px",
  border: "none",
  borderRadius: "6px",
  cursor: "pointer",
  fontSize: "14px",
  fontWeight: "600",
  width: "100%",
};

const viewBtn = {
  background: "#10b981",
  color: "#fff",
  border: "none",
  padding: "8px 16px",
  borderRadius: "4px",
  fontSize: "12px",
  cursor: "pointer",
  fontWeight: "600",
};

const docRow = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "15px",
  borderBottom: "1px solid #eee",
  marginBottom: "10px",
};

const backBtn = {
  background: "#2563eb",
  color: "#fff",
  padding: "10px 20px",
  border: "none",
  borderRadius: "6px",
  cursor: "pointer",
  fontSize: "14px",
  fontWeight: "600",
  width: "auto",
  minWidth: "200px",
};

const modalOverlay = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: "rgba(0,0,0,0.7)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};

const modalContent = {
  background: "#fff",
  borderRadius: "10px",
  maxWidth: "80%",
  maxHeight: "80%",
  overflow: "auto",
};

const modalHeader = {
  padding: "20px",
  borderBottom: "1px solid #eee",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
};

const modalBody = {
  padding: "20px",
};

const closeBtn = {
  background: "none",
  border: "none",
  fontSize: "24px",
  cursor: "pointer",
  color: "#666",
};

const previewContainer = {
  textAlign: "center",
  marginTop: "15px",
};

const previewImage = {
  maxWidth: "100%",
  maxHeight: "400px",
  borderRadius: "8px",
  boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
};

const pdfViewer = {
  width: "100%",
  height: "500px",
  border: "none",
  borderRadius: "8px",
};

const downloadSection = {
  textAlign: "center",
  padding: "40px",
};

const downloadBtn = {
  display: "inline-block",
  background: "#2563eb",
  color: "#fff",
  padding: "12px 24px",
  borderRadius: "6px",
  textDecoration: "none",
  fontWeight: "600",
  marginTop: "20px",
};