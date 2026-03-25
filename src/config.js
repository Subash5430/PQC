// Read backend URL from whichever environment variable is available
// - Vite projects use import.meta.env.VITE_BACKEND_URL
// - Create React App uses process.env.REACT_APP_BACKEND_URL
// Fallback to empty string if neither is defined.
const BACKEND_URL =
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_BACKEND_URL) ||
  process.env.REACT_APP_BACKEND_URL ||
  "";

export default BACKEND_URL;