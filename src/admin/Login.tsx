import React, { useState } from 'react';

interface LoginProps {
  onLogin: (user: { id: number; accountId: string; nickname: string; role: 'admin' | 'user' }) => void;
}

const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // 开发环境：使用本地存储模拟登录
      if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        if (username === 'admin' && password === 'admin123') {
          const user = {
            id: 1,
            accountId: 'admin',
            nickname: '管理员',
            role: 'admin' as const,
          };
          localStorage.setItem('admin_user', JSON.stringify(user));
          onLogin(user);
          return;
        } else {
          throw new Error('账号或密码错误');
        }
      }

      // 生产环境：调用 API
      const response = await fetch('/api/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || '登录失败');
      }

      const data = await response.json();
      localStorage.setItem('admin_token', data.token);
      onLogin(data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-login-page">
      <div className="admin-login-card">
        <div className="admin-login-header">
          <span className="admin-login-logo">🔐</span>
          <h1>后台管理系统</h1>
          <p>请使用管理员账号登录</p>
        </div>

        <form onSubmit={handleSubmit} className="admin-login-form">
          <div className="form-group">
            <label htmlFor="username">账号</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="请输入管理员账号"
              required
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">密码</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入密码"
              required
              disabled={loading}
            />
          </div>

          {error && <div className="form-error">{error}</div>}

          <button type="submit" className="admin-login-btn" disabled={loading}>
            {loading ? '登录中...' : '登录'}
          </button>

          <div className="admin-login-tips">
            <p>💡 提示：此为管理员专用登录入口</p>
            <p>如需访问会员中心，请前往 <a href="/member">/member</a></p>
          </div>
        </form>
      </div>
    </div>
  );
};

export default Login;
