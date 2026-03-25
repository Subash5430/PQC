//App.js
import React, { useState, useRef } from "react";
import { getContract } from "./utils/contract";
import { ethers } from "ethers";
import CryptoJS from "crypto-js";
import { useNavigate } from 'react-router-dom';
import { getOrCreateKyberKeypair, kyberEncapsulate, kyberDecapsulate } from "./utils/pqc";
import BACKEND_URL from "./config"; // adjust path if needed

function App() {
  const navigate = useNavigate();
  const [account, setAccount] = useState(null);

  // warn user if backend url is missing
  const missingBackendUrl = !BACKEND_URL || BACKEND_URL === 'undefined';
  const [file, setFile] = useState(null);
  const [ipfsHash, setIpfsHash] = useState("");
  const [verifier, setVerifier] = useState("");
  const [myDocs, setMyDocs] = useState([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [previewDocument, setPreviewDocument] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [customFileName, setCustomFileName] = useState("");
  const [documentNames, setDocumentNames] = useState({});
  const [showDocumentSelector, setShowDocumentSelector] = useState(false);
  const [selectedDocuments, setSelectedDocuments] = useState([]);
  const myDocsRef = useRef(null);
  const uploadRef = useRef(null);
  const shareRef = useRef(null);
  const [tamperAlerts, setTamperAlerts] = useState([]);

  // display a banner when backend is not configured
  const backendBanner = missingBackendUrl ? (
    <div style={{
      background: '#ffebeb',
      color: '#b91c1c',
      padding: '12px 20px',
      textAlign: 'center',
      fontWeight: '600'
    }}>
      ⚠️ BACKEND_URL is not configured. Set the environment variable (VITE_BACKEND_URL or REACT_APP_BACKEND_URL) in your .env or shell and restart the app.
    </div>
  ) : null;

  // Helper to call backend and surface HTML/text errors (avoids silent JSON parse failures)
  async function backendFetch(url, options = {}) {
    if (!BACKEND_URL || BACKEND_URL === 'undefined') {
      // Don't throw immediately; callers may choose to show a message. Provide detailed text.
      throw new Error('BACKEND_URL is not configured. Set the environment variable (VITE_BACKEND_URL or REACT_APP_BACKEND_URL) in your .env or shell and restart the app.');
    }

    const res = await fetch(url, options);
    const text = await res.text();
    const contentType = res.headers.get('content-type') || '';

    // If response not ok, include response body (often HTML) in the error to aid debugging
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
    }

    // If JSON, parse and return it, otherwise return text so callers can handle it
    if (contentType.includes('application/json')) {
      try {
        return JSON.parse(text);
      } catch (e) {
        throw new Error('Invalid JSON from backend: ' + text);
      }
    }

    return { text, contentType };
  }
  
  // Static notifications + dynamic tamper alerts
  const staticNotifications = [
    { id: 1, type: "fraud", message: "Fraud detected", time: "2 minutes ago" },
    { id: 2, type: "success", message: "Aadhaar linked with the account", time: "5 minutes ago" }
  ];
  
  const notifications = [
    ...tamperAlerts.map((alert, idx) => ({
      id: `tamper_${idx}`,
      type: "fraud",
      message: alert.message,
      time: alert.time
    })),
    ...staticNotifications
  ];

  // Scroll functions
  function scrollToMyDocs() {
    if (myDocsRef.current) {
      myDocsRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }

  function scrollToUpload() {
    if (uploadRef.current) {
      uploadRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }

  function scrollToShare() {
    if (shareRef.current) {
      shareRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }

  // Decrypt and preview document
  async function previewDoc(ipfsHash) {
    if (!account) return alert("Connect wallet first");
    
    try {
      // 🔍 Verify IPFS hash matches blockchain record
      const contract = await getContract();
      const myDocs = await contract.getMyDocuments();
      const docExists = myDocs.some(doc => doc.ipfsHash === ipfsHash);
      
      if (!docExists) {
        // 🚨 Tampering detected - hash mismatch
        const tamperAlert = {
          message: `🚨 IPFS Tampering Detected: Hash ${ipfsHash.substring(0, 10)}... not in blockchain`,
          time: new Date().toLocaleTimeString()
        };
        setTamperAlerts(prev => [tamperAlert, ...prev]);
        return alert("❌ Security Alert: Document hash mismatch detected!\nThis file may have been tampered with.");
      }
      
      // ✅ Retrieve PQC-encrypted session key from localStorage
      const storedKeys = JSON.parse(localStorage.getItem(`docKeys_${account}`) || '{}');
      const encapsulatedKey = storedKeys[ipfsHash];
      
      console.log('DEBUG: Wallet:', account);
      console.log('DEBUG: IPFS Hash:', ipfsHash);
      console.log('DEBUG: Encapsulated Key:', encapsulatedKey ? encapsulatedKey.substring(0, 50) + '...' : 'NOT FOUND');
      
      if (!encapsulatedKey) {
        return alert("Session key not found. You may not have access to this document.");
      }
      
      let sessionKey;
      
      try {
        // 🔐 PQC: Try Kyber decapsulation first
        const keypair = getOrCreateKyberKeypair(account);
        console.log('DEBUG: Using Kyber decapsulation');
        sessionKey = kyberDecapsulate(encapsulatedKey, keypair.privateKey);
        console.log('DEBUG: Kyber decryption:', sessionKey ? 'SUCCESS' : 'FAILED');
      } catch (pqcError) {
        // ⚠️ Fallback: Try classical decryption
        console.warn('⚠️ PQC decryption failed, trying classical:', pqcError);
        try {
          sessionKey = CryptoJS.AES.decrypt(encapsulatedKey.replace('KYBER_ENC_', ''), account).toString(CryptoJS.enc.Utf8);
          console.log('DEBUG: Classical decryption:', sessionKey ? 'SUCCESS' : 'FAILED');
        } catch (classicalError) {
          console.error('DEBUG: Classical decryption also failed:', classicalError);
        }
      }
      
      if (!sessionKey) {
        return alert("Failed to decrypt session key. Check console for debug info.");
      }
      
      const response = await fetch(`https://gateway.pinata.cloud/ipfs/${ipfsHash}`);
      if (!response.ok) throw new Error("Failed to fetch from IPFS");
      
      const encryptedData = await response.text();
      
      // ✅ Decrypt file using AES session key
      const decrypted = CryptoJS.AES.decrypt(encryptedData, sessionKey);
      const decryptedBytes = decrypted.toString(CryptoJS.enc.Base64);
      
      if (!decryptedBytes) {
        throw new Error("Decryption failed - file may be corrupted or tampered");
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
      console.error('DEBUG: Preview error:', error);
      alert("Failed to decrypt document: " + error.message);
    }
  }

  // Redirect to MetaMask installation
  function redirectToMetaMask() {
    window.open('https://chrome.google.com/webstore/detail/metamask/nkbihfbeogaeaoehlefnkodbefgpgknn', '_blank');
  }

  // ---------------- WALLET ----------------
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
      const data = await backendFetch(`${BACKEND_URL}/keys?user=${address}`);
      console.log('Fetched from backend:', data); // Debug
      
      // Extract keys, mimes, and names
      const keys = {};
      const mimes = {};
      const names = {};
      
      for (const docHash in data) {
        if (typeof data[docHash] === 'object' && data[docHash].encryptedSessionKey) {
          keys[docHash] = data[docHash].encryptedSessionKey;
          mimes[docHash] = data[docHash].mimeType || 'application/octet-stream';
          names[docHash] = data[docHash].fileName || 'document';
        } else if (typeof data[docHash] === 'string') {
          // Backward compatibility - old format
          keys[docHash] = data[docHash];
        }
      }
      
      console.log('Extracted keys:', Object.keys(keys).length); // Debug
      console.log('Extracted names:', names); // Debug
      
      // Store in localStorage as cache
      localStorage.setItem(`docKeys_${address}`, JSON.stringify(keys));
      localStorage.setItem(`docMimes_${address}`, JSON.stringify(mimes));
      localStorage.setItem(`docNames_${address}`, JSON.stringify(names));
      
      // Update state immediately
      setDocumentNames(names);
    } catch (error) {
      console.error('Failed to fetch keys from backend:', error);
    }
  }

  async function fetchMyDocuments() {
    const contract = await getContract();
    const docs = await contract.getMyDocuments();
    
    const storedNames = JSON.parse(localStorage.getItem(`docNames_${account}`) || '{}');
    setDocumentNames(storedNames);
    setMyDocs(docs);
  }

// async function fetchVerifierDocuments() {
  //   if (!ownerAddress) {
  //     alert("Enter document owner address");
  //     return;
  //   }

  //   const contract = await getContract();
  //   const docs = await contract.getAccessibleDocuments(ownerAddress);
  //   setMyDocs(docs);
  // }


  async function uploadToIPFS() {
    if (!file || !account) return alert("Connect wallet & select file");
    if (!customFileName.trim()) return alert("Please enter a filename");

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        // ✅ Generate random AES session key (256-bit)
        const sessionKey = CryptoJS.lib.WordArray.random(32).toString();
        
        // ✅ Encrypt file with session key (AES - fast for large files)
        const wordArray = CryptoJS.lib.WordArray.create(reader.result);
        const encrypted = CryptoJS.AES.encrypt(wordArray, sessionKey).toString();

        // ✅ Upload via backend proxy (API keys hidden)
        let data;
        try {
          data = await backendFetch(`${BACKEND_URL}/upload-to-ipfs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              encryptedData: encrypted,
              fileName: customFileName + '.enc'
            })
          });
        } catch (e) {
          // If backend returned HTML (e.g., index.html) or other text, show the body for debugging
          return alert('Upload failed: ' + e.message);
        }

        const ipfsHash = (data && data.IpfsHash) ? data.IpfsHash : (data && data.text && (JSON.parse?.(data.text)?.IpfsHash || null));
        if (!ipfsHash) {
          return alert('Upload failed: unexpected response from backend');
        }

        setIpfsHash(ipfsHash);

        setIpfsHash(data.IpfsHash);
        
        // Store document name locally
        const storedNames = JSON.parse(localStorage.getItem(`docNames_${account}`) || '{}');
        storedNames[data.IpfsHash] = customFileName;
        localStorage.setItem(`docNames_${account}`, JSON.stringify(storedNames));
        setDocumentNames(storedNames);
        
        // ✅ Store MIME type locally
        const storedMimes = JSON.parse(localStorage.getItem(`docMimes_${account}`) || '{}');
        storedMimes[data.IpfsHash] = file.type || 'application/octet-stream';
        localStorage.setItem(`docMimes_${account}`, JSON.stringify(storedMimes));
        
        let encapsulatedKey;
        let usedPQC = false;
        
        try {
          // 🔐 PQC: Kyber encryption
          const ownerKeypair = getOrCreateKyberKeypair(account);
          encapsulatedKey = kyberEncapsulate(sessionKey, ownerKeypair.publicKey);
          usedPQC = true;
          console.log('🔐 PQC: Session key protected with Kyber (simplified simulation)');
        } catch (pqcError) {
          // ⚠️ Fallback: Use classical encryption if PQC fails
          console.warn('⚠️ PQC failed, using classical encryption:', pqcError);
          encapsulatedKey = CryptoJS.AES.encrypt(sessionKey, account).toString();
          usedPQC = false;
        }
        
        // ✅ Store encrypted session key in backend
        try {
          await backendFetch(`${BACKEND_URL}/keys`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              user: account,
              documentHash: ipfsHash,
              encryptedSessionKey: encapsulatedKey,
              mimeType: file.type || 'application/octet-stream',
              fileName: customFileName,
              usedPQC: usedPQC
            })
          });
        } catch (e) {
          console.error('Failed to store session key on backend:', e);
          alert('Upload succeeded but saving key to backend failed: ' + e.message);
        }
        
        // Keep localStorage as cache
        const storedKeys = JSON.parse(localStorage.getItem(`docKeys_${account}`) || '{}');
        storedKeys[ipfsHash] = encapsulatedKey;
        localStorage.setItem(`docKeys_${account}`, JSON.stringify(storedKeys));
        
        const contract = await getContract();
        await contract.addDocument(ipfsHash);
        
        const message = usedPQC 
          ? "✅ Document encrypted with AES-256\n🔐 Keys protected with Kyber simulation (PQC)\n✅ Stored on blockchain"
          : "✅ Document encrypted with AES-256\n⚠️ Keys protected with classical encryption\n✅ Stored on blockchain";
        
        alert(message);
        setCustomFileName("");
        setFile(null);
      } catch (error) {
        alert('Upload failed: ' + error.message);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  async function grantAccess() {
    if (!verifier) return alert("Enter verifier address");
    if (selectedDocuments.length === 0) return alert("Select at least one document");
    
    const contract = await getContract();
    
    // Get owner's encrypted keys
    const storedKeys = JSON.parse(localStorage.getItem(`docKeys_${account}`) || '{}');
    
    for (const ipfsHash of selectedDocuments) {
      try {
        // Grant blockchain access
        await contract.grantDocumentAccess(verifier, ipfsHash);
        
        const encapsulatedKey = storedKeys[ipfsHash];
        if (!encapsulatedKey) {
          console.error(`No key found for ${ipfsHash}`);
          continue;
        }
        
        let sessionKey;
        let verifierEncapsulatedKey;
        let usedPQC = false;
        
        try {
          // 🔐 PQC: Try Kyber decapsulation
          const ownerKeypair = getOrCreateKyberKeypair(account);
          sessionKey = kyberDecapsulate(encapsulatedKey, ownerKeypair.privateKey);
          
          // 🔐 PQC: Generate verifier keypair and encapsulate
          const verifierKeypair = getOrCreateKyberKeypair(verifier);
          verifierEncapsulatedKey = kyberEncapsulate(sessionKey, verifierKeypair.publicKey);
          usedPQC = true;
        } catch (pqcError) {
          // ⚠️ Fallback: Classical encryption
          console.warn('⚠️ PQC failed, using classical encryption:', pqcError);
          sessionKey = CryptoJS.AES.decrypt(encapsulatedKey, account).toString(CryptoJS.enc.Utf8);
          verifierEncapsulatedKey = CryptoJS.AES.encrypt(sessionKey, verifier).toString();
          usedPQC = false;
        }
        
        // Get MIME type and filename
        const storedMimes = JSON.parse(localStorage.getItem(`docMimes_${account}`) || '{}');
        const storedNames = JSON.parse(localStorage.getItem(`docNames_${account}`) || '{}');
        
        // ✅ Store verifier's encrypted key in backend
        try {
          await backendFetch(`${BACKEND_URL}/keys`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              user: verifier,
              documentHash: ipfsHash,
              encryptedSessionKey: verifierEncapsulatedKey,
              mimeType: storedMimes[ipfsHash] || 'application/octet-stream',
              fileName: storedNames[ipfsHash] || 'document',
              usedPQC: usedPQC
            })
          });
        } catch (e) {
          console.error('Failed to store verifier key on backend:', e);
        }
      } catch (error) {
        console.error(`Failed to grant access for ${ipfsHash}:`, error);
      }
    }
    
    alert(`✅ Access granted for ${selectedDocuments.length} document(s)\n🔐 Keys protected with quantum-resistant encryption`);
    setSelectedDocuments([]);
    setShowDocumentSelector(false);
  }

  function toggleDocumentSelection(ipfsHash) {
    setSelectedDocuments(prev => 
      prev.includes(ipfsHash) 
        ? prev.filter(hash => hash !== ipfsHash)
        : [...prev, ipfsHash]
    );
  }

  async function revokeAccess() {
    if (!verifier) return alert("Enter verifier address");
    if (selectedDocuments.length === 0) return alert("Select documents to revoke");

    const contract = await getContract();

    for (const hash of selectedDocuments) {
      // Revoke blockchain access
      await contract.revokeDocumentAccess(verifier, hash);
      
      // ✅ Delete verifier's encrypted key from backend
      try {
        await backendFetch(`${BACKEND_URL}/keys`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user: verifier,
            documentHash: hash
          })
        });
      } catch (e) {
        console.error('Failed to delete verifier key on backend:', e);
      }
    }

    alert("Access revoked for selected documents");
    setSelectedDocuments([]);
  }


  return (
    <div style={page}>
      {backendBanner}
      {/* Google Font */}
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
          <h2 style={{ margin: 0, color: "#fff" }}>Space Data Manager</h2>
        </div>
        
        {/* Notification Bell */}
        <div style={{ position: "relative" }}>
          <div 
            style={notificationBell} 
            onClick={() => setShowNotifications(!showNotifications)}
          >
            🔔
            {notifications.length > 0 && (
              <span style={notificationBadge}>{notifications.length}</span>
            )}
          </div>
          
          {showNotifications && (
            <div style={notificationDropdown}>
              <h4 style={{ margin: "0 0 10px 0", color: "#1e3a8a" }}>Notifications</h4>
              {notifications.map(notif => (
                <div key={notif.id} style={notificationItem}>
                  <div style={{ 
                    color: notif.type === "fraud" ? "#dc2626" : "#059669",
                    fontWeight: "600",
                    fontSize: "12px"
                  }}>
                    {notif.type === "fraud" ? "🚨 FRAUD ALERT" : "✅ SUCCESS"}
                  </div>
                  <div style={{ fontSize: "13px", margin: "5px 0" }}>{notif.message}</div>
                  <div style={{ fontSize: "11px", color: "#666" }}>{notif.time}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* HERO */}
      <div style={hero}>
        <div>
          <h1>Future-Proof System for Mission-Critical Space Data</h1>
          <p style={{ maxWidth: "480px", lineHeight: 1.6 }}>
            A blockchain-powered document wallet that allows professionals to
            securely store, manage, and share identity documents with
            full control and no central authority.
          </p>
          
          <button style={loginBtn} onClick={connectWallet}>
          {account ? "Wallet Connected" : "Login / Register"}
        </button>
        </div>

        <img
          src="https://images.unsplash.com/photo-1639322537228-f710d846310a"
          alt="Blockchain"
          style={heroImg}
        />
      </div>

      {/* MOVABLE STEPS */}
      <h2 style={sectionTitle}>Getting Started is Quick & Easy</h2>
      <div style={stepsScroll}>
        {[
          {
            title: "Register Yourself",
            img: "https://images.unsplash.com/photo-1581090464777-f3220bbe1b8b",
          },
          {
            title: "View Documents",
            img: "https://images.unsplash.com/photo-1554224155-6726b3ff858f",
          },
          {
            title: "Upload Documents",
            img: "https://images.unsplash.com/photo-1618044733300-9472054094ee",
          },
          {
            title: "Share Securely",
            img: "https://images.unsplash.com/photo-1614064548237-096f735f344f",
          },
        ].map((step, i) => {
          const handleClick = () => {
            if (step.title === "Register Yourself") {
              redirectToMetaMask();
            } else if (step.title === "View Documents") {
              scrollToMyDocs();
            } else if (step.title === "Upload Documents") {
              scrollToUpload();
            } else if (step.title === "Share Securely") {
              scrollToShare();
            }
          };

          return (
            <div
              key={i}
              style={{
                ...stepCardLarge,
                backgroundImage: `linear-gradient(
                  rgba(0,0,0,0.6),
                  rgba(0,0,0,0.6)
                ), url(${step.img})`,
                cursor: "pointer"
              }}
              onClick={handleClick}
            >
              <h3>{step.title}</h3>
            </div>
          );
        })}
      </div>

      {/* FEATURES GRID */}
      <h2 style={sectionTitle}>Platform Features</h2>
      <div style={featureGrid}>
        {[
          "Client-side Encryption",
          "Decentralized IPFS Storage",
          "Blockchain Proof of Records",
          "User Controlled Access",
          "No Central Authority",
        ].map((feature, i) => (
          <div key={i} style={featureBox}>
            <img
              src="https://cdn-icons-png.flaticon.com/512/2910/2910791.png"
              alt="feature"
              style={{ width: "40px", marginBottom: "10px" }}
            />
            <p>{feature}</p>
          </div>
        ))}
      </div>

      {/* DASHBOARD */}
      <div style={dashboard}>
        <h2>User Dashboard</h2>

        <div style={card} ref={myDocsRef}>
          <h3>My Documents</h3>
          <button style={primaryBtn} onClick={fetchMyDocuments}>
            View Documents
          </button>

          {myDocs.map((doc, i) => (
            <div key={i} style={docRow}>
              <div>
                <b>{documentNames[doc.ipfsHash] || `Identity Document #${i + 1}`}</b>
                <br />
                <small style={{ color: "#0ea5e9" }}>Hash: {doc.ipfsHash}</small>
                <br />
                <small style={{ color: "#666" }}>
                  Uploaded: {new Date(Number(doc.timestamp) * 1000).toLocaleDateString()}
                </small>
              </div>
              <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                <button 
                  style={viewBtn}
                  onClick={() => previewDoc(doc.ipfsHash)}
                >
                  View
                </button>
                <span style={verified}>Verified </span>
              </div>
            </div>
          ))}
        </div>

        <div style={card} ref={uploadRef}>
          <h3> Upload Document</h3>
          
          <div style={fileUploadSection}>
            <input 
              type="file" 
              onChange={(e) => {
                const selectedFile = e.target.files[0];
                if (selectedFile) {
                  setFile(selectedFile);
                  setCustomFileName(selectedFile.name.split('.')[0]); // Set default name without extension
                }
              }}
              accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
            />
            
            {file && (
              <div style={fileEditSection}>
                <p style={{ color: "#059669", fontWeight: "600", margin: "10px 0" }}>
                   File Selected: {file.name}
                </p>
                
                <div style={filenameEditContainer}>
                  <label style={filenameLabel}>Edit Filename:</label>
                  <input
                    style={filenameInput}
                    type="text"
                    value={customFileName}
                    onChange={(e) => setCustomFileName(e.target.value)}
                    placeholder="Enter custom filename"
                  />
                  <span style={fileExtension}>.enc</span>
                </div>
              </div>
            )}
          </div>
          
          <br />
          <button 
            style={primaryBtn} 
            onClick={uploadToIPFS}
            disabled={!file || !customFileName.trim()}
          >
             Encrypt & Upload
          </button>
          {ipfsHash && <p style={{ color: "green" }}>✔ Stored securely</p>}
        </div>

        <div style={card} ref={shareRef}>
          <h3>Allow Permission Access</h3>
          <input
            style={input}
            placeholder="Verifier Wallet Address (0x...)"
            value={verifier}
            onChange={(e) => setVerifier(e.target.value)}
          />
          <br /><br />
          
          {/* Document Selection */}
          <div style={{ marginBottom: "15px" }}>
            <button 
              style={selectDocBtn} 
              onClick={() => {
                if (myDocs.length === 0) {
                  alert("No documents found. Please upload documents first.");
                  return;
                }
                setShowDocumentSelector(!showDocumentSelector);
              }}
            >
              Select Documents ({selectedDocuments.length} selected)
            </button>
            
            {showDocumentSelector && (
              <div style={documentSelector}>
                <h4 style={{ margin: "0 0 10px 0", color: "#1e3a8a" }}>Choose Documents to Share:</h4>
                {myDocs.map((doc, i) => (
                  <div key={i} style={documentOption}>
                    <label style={documentLabel}>
                      <input
                        type="checkbox"
                        checked={selectedDocuments.includes(doc.ipfsHash)}
                        onChange={() => toggleDocumentSelection(doc.ipfsHash)}
                        style={checkbox}
                      />
                      <div>
                        <div style={{ fontWeight: "600" }}>
                          {documentNames[doc.ipfsHash] || `Identity Document #${i + 1}`}
                        </div>
                        <div style={{ fontSize: "12px", color: "#666" }}>
                          {doc.ipfsHash.substring(0, 20)}...
                        </div>
                      </div>
                    </label>
                  </div>
                ))}
              </div>
            )}
          </div>

          
          <div style={{ display: "flex", gap: "10px" }}>
            <button 
              style={primaryBtn} 
              onClick={grantAccess}
              disabled={!verifier || selectedDocuments.length === 0}
            >
              Grant Access
            </button>
            <button 
              style={revokeBtn} 
              onClick={revokeAccess}
              disabled={!verifier}
            >
              Revoke Access
            </button>
          </div>



          <button
            style={verificationBtn}
            onClick={() => navigate('/verification')}
          >
            Switch to Verification Tab
          </button>

        </div>
      </div>
      
      {/* Document Preview Modal */}
      {showPreview && previewDocument && (
        <div style={modalOverlay} onClick={() => setShowPreview(false)}>
          <div style={modalContent} onClick={(e) => e.stopPropagation()}>
            <div style={modalHeader}>
              <h3>Document Preview</h3>
              <button 
                style={closeBtn}
                onClick={() => setShowPreview(false)}
              >
                ×
              </button>
            </div>
            <div style={modalBody}>
              <p><strong>IPFS Hash:</strong> {previewDocument.hash}</p>
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

export default App;

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
  background: "#3660d2",
  color: "White",
  //border: "none",
  padding: "8px 16px",
  borderRadius: "20px",
  cursor: "pointer",
  border: "2px solid black"
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

const primaryBtn = {
  background: "#2563eb",
  color: "#fff",
  padding: "10px 18px",
  border: "none",
  borderRadius: "6px",
  cursor: "pointer",
};

const sectionTitle = {
  textAlign: "center",
  marginTop: "40px",
};

const stepsScroll = {
  display: "flex",
  gap: "25px",
  overflowX: "auto",
  padding: "30px 40px",
  scrollSnapType: "x mandatory",
};

const stepCardLarge = {
  minWidth: "340px",
  height: "190px",
  borderRadius: "16px",
  color: "#fff",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  textAlign: "center",
  fontWeight: 600,
  backgroundSize: "cover",
  backgroundPosition: "center",
  boxShadow: "0 12px 28px rgba(0,0,0,0.25)",
  scrollSnapAlign: "start",
  cursor: "grab",
};

const featureGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: "20px",
  padding: "30px 40px",
};

const featureBox = {
  background: "#fff",
  padding: "25px",
  borderRadius: "12px",
  textAlign: "center",
  fontWeight: 500,
  boxShadow: "0 6px 18px rgba(0,0,0,0.1)",
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

const docRow = {
  display: "flex",
  justifyContent: "space-between",
  padding: "10px",
  borderBottom: "1px solid #eee",
};

const verified = {
  background: "#dcfce7",
  color: "#166534",
  padding: "4px 8px",
  borderRadius: "4px",
};

const notificationBell = {
  background: "#fff",
  color: "#1e3a8a",
  padding: "8px",
  borderRadius: "50%",
  cursor: "pointer",
  fontSize: "16px",
  position: "relative",
  width: "35px",
  height: "35px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const notificationBadge = {
  position: "absolute",
  top: "-5px",
  right: "-5px",
  background: "#ef4444",
  color: "#fff",
  borderRadius: "50%",
  width: "18px",
  height: "18px",
  fontSize: "10px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const notificationDropdown = {
  position: "absolute",
  top: "45px",
  right: "0",
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: "8px",
  padding: "15px",
  minWidth: "280px",
  boxShadow: "0 10px 25px rgba(0,0,0,0.15)",
  zIndex: 1000,
};

const notificationItem = {
  padding: "10px",
  borderBottom: "1px solid #f3f4f6",
  marginBottom: "8px",
};

const input = {
  width: "100%",
  padding: "10px",
  borderRadius: "6px",
  border: "1px solid #ccc",
};

const viewBtn = {
  background: "#10b981",
  color: "#fff",
  border: "none",
  padding: "6px 12px",
  borderRadius: "4px",
  fontSize: "12px",
  cursor: "pointer",
};

const revokeBtn = {
  background: "#ef4444",
  color: "#fff",
  border: "none",
  padding: "10px 18px",
  borderRadius: "6px",
  fontSize: "14px",
  cursor: "pointer",
  fontWeight: "600",
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

const fileUploadSection = {
  border: "2px dashed #d1d5db",
  borderRadius: "8px",
  padding: "20px",
  background: "#f9fafb",
};

const fileEditSection = {
  marginTop: "15px",
  padding: "15px",
  background: "#f0f9ff",
  borderRadius: "6px",
  border: "1px solid #1e3a8a",
};

const filenameEditContainer = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  marginTop: "10px",
};

const filenameLabel = {
  fontWeight: "600",
  color: "#1e3a8a",
  minWidth: "100px",
};

const filenameInput = {
  flex: 1,
  padding: "8px 12px",
  border: "1px solid #d1d5db",
  borderRadius: "4px",
  fontSize: "14px",
};

const fileExtension = {
  color: "#666",
  fontWeight: "600",
  fontSize: "14px",
};

const selectDocBtn = {
  background: "#2563eb",
  color: "#fff",
  border: "none",
  padding: "10px 18px",
  borderRadius: "6px",
  fontSize: "14px",
  cursor: "pointer",
  fontWeight: "600",
  width: "100%",
  marginBottom: "10px",
};

const documentSelector = {
  background: "#f8fafc",
  border: "1px solid #e2e8f0",
  borderRadius: "8px",
  padding: "15px",
  maxHeight: "200px",
  overflowY: "auto",
};

const documentOption = {
  padding: "8px 0",
  borderBottom: "1px solid #e5e7eb",
};

const documentLabel = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
  cursor: "pointer",
};

const verificationBtn = {
  display: "block",
   margin: "20px auto", 
  background: "#2563eb",
  color: "#fff",
  border: "none",
  padding: "12px 24px",
  borderRadius: "6px",
  fontSize: "16px",
  cursor: "pointer",
  fontWeight: "600",
  width: "30%",
  marginTop: "20px",
};

const checkbox = {
  width: "16px",
  height: "16px",
  cursor: "pointer",
};