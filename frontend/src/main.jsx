import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { shouldAttachApiCredentials } from './config'

const nativeFetch = window.fetch.bind(window);
window.fetch = (input, init = {}) => {
  if (!shouldAttachApiCredentials(input)) return nativeFetch(input, init);

  return nativeFetch(input, {
    ...init,
    credentials: 'include'
  });
};

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
