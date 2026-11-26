import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import './refresh.css';
import './overview.css';
import './sources.css';
import './login.css';
import './brand.css';
import './compact.css';

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
