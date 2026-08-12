import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { AnneeProvider } from './context/AnneeContext.jsx';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <AnneeProvider>
          <App />
        </AnneeProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
