import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { installFrontendRuntimeLogging } from './runtime-logs'
import { ThemeProvider } from './theme-context'
import './styles.css'
import './sql-workbench.css'
// Mirror profile material layer — must load AFTER styles.css so its
// [data-base-profile=mirror] rules cascade-override the base palette.
import './mirror-theme.css'

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
