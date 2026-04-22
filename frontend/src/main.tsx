import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { installFrontendRuntimeLogging } from './runtime-logs'
import { ThemeProvider } from './theme-context'
import './styles.css'
import './sql-workbench.css'

installFrontendRuntimeLogging()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>,
)
