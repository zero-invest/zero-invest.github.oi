import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import App from './App';
import Login from './Login';
import Dashboard from './Dashboard';
import Users from './Users';
import RedeemCodes from './RedeemCodes';
import Appreciations from './Appreciations';
import TrafficStats from './TrafficStats';
import '../styles.css';

const AdminApp: React.FC = () => {
  const [currentUser, setCurrentUser] = React.useState<{ id: number; accountId: string; nickname: string; role: 'admin' | 'user' } | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    // 检查是否已登录
    const checkAuth = async () => {
      try {
        const stored = localStorage.getItem('admin-user');
        if (stored) {
          const user = JSON.parse(stored);
          if (user && user.role === 'admin') {
            setCurrentUser(user);
          }
        }
      } catch (error) {
        console.error('Failed to check auth:', error);
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, []);

  const handleLogin = (user: { id: number; accountId: string; nickname: string; role: 'admin' | 'user' }) => {
    setCurrentUser(user);
    localStorage.setItem('admin-user', JSON.stringify(user));
  };

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem('admin-user');
  };

  if (loading) {
    return <div className="admin-loading">加载中...</div>;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={!currentUser ? <Login onLogin={handleLogin} /> : <Navigate to="/" />} />
        <Route path="/" element={currentUser ? <App user={currentUser} onLogout={handleLogout} /> : <Navigate to="/login" />}>
          <Route index element={<Dashboard />} />
          <Route path="users" element={<Users />} />
          <Route path="redeem-codes" element={<RedeemCodes />} />
          <Route path="appreciations" element={<Appreciations />} />
          <Route path="traffic" element={<TrafficStats />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AdminApp />
  </React.StrictMode>
);
