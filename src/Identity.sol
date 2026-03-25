// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Identity {

    struct Document {
        string ipfsHash;
        uint256 timestamp;
    }

    // owner => documents
    mapping(address => Document[]) private documents;

    // owner => verifier => ipfsHash => access
    mapping(address => mapping(address => mapping(string => bool))) private documentAccess;

    /* =====================================================
                            EVENTS
       ===================================================== */

    event DocumentAdded(address indexed owner, string ipfsHash);
    event AccessGranted(address indexed owner, address indexed verifier, string ipfsHash);
    event AccessRevoked(address indexed owner, address indexed verifier, string ipfsHash);

    /* =====================================================
                        DOCUMENT MANAGEMENT
       ===================================================== */

    function addDocument(string memory _hash) external {
        documents[msg.sender].push(
            Document(_hash, block.timestamp)
        );
        emit DocumentAdded(msg.sender, _hash);
    }

    function getMyDocuments() external view returns (Document[] memory) {
        return documents[msg.sender];
    }

    /* =====================================================
                       ACCESS CONTROL
       ===================================================== */

    function grantDocumentAccess(address verifier, string memory documentHash) external {
        require(verifier != address(0), "Invalid verifier");
        documentAccess[msg.sender][verifier][documentHash] = true;
        emit AccessGranted(msg.sender, verifier, documentHash);
    }

    function revokeDocumentAccess(address verifier, string memory documentHash) external {
        documentAccess[msg.sender][verifier][documentHash] = false;
        emit AccessRevoked(msg.sender, verifier, documentHash);
    }

    function hasDocumentAccess(
        address owner,
        address verifier,
        string memory documentHash
    ) external view returns (bool) {
        return documentAccess[owner][verifier][documentHash];
    }

    /* =====================================================
                  VERIFIER DOCUMENT FETCHING
       ===================================================== */

    // 🔑 Called by verifier wallet (msg.sender)
    function getAccessibleDocuments(address owner)
        external
        view
        returns (Document[] memory)
    {
        Document[] memory allDocs = documents[owner];
        uint256 count = 0;

        // Count allowed documents
        for (uint256 i = 0; i < allDocs.length; i++) {
            if (documentAccess[owner][msg.sender][allDocs[i].ipfsHash]) {
                count++;
            }
        }

        // Build exact-sized array (count may be 0 → EMPTY tuple[])
        Document[] memory allowedDocs = new Document[](count);
        uint256 index = 0;

        for (uint256 i = 0; i < allDocs.length; i++) {
            if (documentAccess[owner][msg.sender][allDocs[i].ipfsHash]) {
                allowedDocs[index] = allDocs[i];
                index++;
            }
        }

        return allowedDocs;
    }

    /* =====================================================
              VERIFIED DOCUMENTS (DEBUG / ADMIN)
       ===================================================== */

    // 🔍 Explicit verifier check (useful for Remix / Etherscan)
    function getVerifiedDocuments(
        address owner,
        address verifier
    ) external view returns (Document[] memory) {

        Document[] memory allDocs = documents[owner];
        uint256 count = 0;

        for (uint256 i = 0; i < allDocs.length; i++) {
            if (documentAccess[owner][verifier][allDocs[i].ipfsHash]) {
                count++;
            }
        }

        Document[] memory verifiedDocs = new Document[](count);
        uint256 index = 0;

        for (uint256 i = 0; i < allDocs.length; i++) {
            if (documentAccess[owner][verifier][allDocs[i].ipfsHash]) {
                verifiedDocs[index] = allDocs[i];
                index++;
            }
        }

        return verifiedDocs;
    }
}
