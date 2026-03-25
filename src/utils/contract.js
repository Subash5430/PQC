import { ethers } from "ethers";
import ABI from "../abi/Identity.json";

const CONTRACT_ADDRESS = "0x75D97905aB9c7b90DA544AD877092EbFb8C211E8";

export async function getContract() {
  const provider = new ethers.BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  return new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);
}
