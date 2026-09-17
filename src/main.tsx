import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// React 18 createRoot 并发挂载
// StrictMode 开发期双挂载校验：MatrixEngine 订阅与 FSM 定时器均已保证幂等清理
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
