import React, { useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';

interface AdminUser {
  id: number;
  accountId: string;
  nickname: string;
  role: 'admin' | 'user';
}

interface AppProps {
  user: AdminUser;
  onLogout: () => void;
}

const App: React.FC<AppProps> = ({ user, onLogout }) => {
  const location = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const navItems = [
    { path: '/', label: '仪表盘', icon: '📊' },
    { path: '/users', label: '用户管理', icon: '👥' },
    { path: '/redeem-codes', label: '兑换码管理', icon: '🎫' },
    { path: '/appreciations', label: '赞赏审核', icon: '💰' },
    { path: '/traffic', label: '访客统计', icon: '📈' },
  ];

  return (
    <div className="admin-app">
      <aside className={`admin-sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="admin-sidebar-header">
          {!sidebarCollapsed && (
            <>
              <span className="admin-logo">🔐</span>
              <h2>后台管理</h2>
            </>
          )}
          <button className="collapse-btn" onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>
            {sidebarCollapsed ? '→' : '←'}
          </button>
        </div>
        
        <nav className="admin-nav">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`admin-nav-item ${location.pathname === item.path ? 'active' : ''}`}
              title={sidebarCollapsed ? item.label : ''}
            >
              <span className="admin-nav-icon">{item.icon}</span>
              {!sidebarCollapsed && <span>{item.label}</span>}
            </Link>
          ))}
        </nav>

        <div className="admin-sidebar-footer">
          {!sidebarCollapsed && (
            <>
              <div className="admin-user-info">
                <span className="admin-user-avatar">👤</span>
                <div>
                  <div className="admin-user-name">{user.nickname}</div>
                  <div className="admin-user-role">管理员</div>
                </div>
              </div>
              <button className="admin-logout-btn" onClick={onLogout}>
                退出登录
              </button>
            </>
          )}
        </div>
      </aside>

      <main className="admin-main">
        <header className="admin-header">
          <h1 className="admin-page-title">
            {navItems.find(item => item.path === location.pathname)?.label || '后台管理'}
          </h1>
          <div className="admin-header-actions">
            <a href="/" target="_blank" rel="noopener noreferrer" className="admin-link-btn">
              🌐 访问前台
            </a>
            <span className="admin-current-time">{new Date().toLocaleString('zh-CN')}</span>
          </div>
        </header>

        <div className="admin-content">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default App;
