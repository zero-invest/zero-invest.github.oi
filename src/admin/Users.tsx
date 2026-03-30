import React, { useEffect, useState } from 'react';

interface User {
  id: number;
  accountId: string;
  nickname: string;
  email?: string;
  inviteCode?: string;
  membership: {
    isActive: boolean;
    expiresAt: string;
  };
  createdAt: string;
  isBanned: boolean;
}

const Users: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'member' | 'banned'>('all');

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      const response = await fetch('/api/admin/users');
      const data = await response.json();
      
      if (response.ok) {
        setUsers(data.users || []);
      } else {
        // 模拟数据
        setUsers([
          {
            id: 1,
            accountId: 'user-001',
            nickname: '测试用户 1',
            email: 'test1@example.com',
            inviteCode: 'INV001',
            membership: { isActive: true, expiresAt: '2026-12-31T23:59:59' },
            createdAt: '2025-01-01T00:00:00',
            isBanned: false,
          },
          {
            id: 2,
            accountId: 'user-002',
            nickname: '测试用户 2',
            email: 'test2@example.com',
            inviteCode: 'INV002',
            membership: { isActive: false, expiresAt: '' },
            createdAt: '2025-02-01T00:00:00',
            isBanned: false,
          },
        ]);
      }
    } catch (error) {
      console.error('Failed to load users:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleBanUser = async (userId: number, isBanned: boolean) => {
    if (!confirm(`确定要${isBanned ? '解除' : '封禁'}该用户吗？`)) return;

    try {
      const response = await fetch(`/api/admin/users/${userId}/ban`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isBanned: !isBanned }),
      });

      if (response.ok) {
        loadUsers();
        alert('操作成功');
      } else {
        alert('操作失败');
      }
    } catch (error) {
      console.error('Failed to ban user:', error);
      alert('操作失败，请重试');
    }
  };

  const handleCancelMembership = async (userId: number) => {
    if (!confirm('确定要取消该用户的会员权限吗？')) return;

    try {
      const response = await fetch(`/api/admin/users/${userId}/cancel-membership`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.ok) {
        loadUsers();
        alert('会员权限已取消');
      } else {
        alert('操作失败');
      }
    } catch (error) {
      console.error('Failed to cancel membership:', error);
      alert('操作失败，请重试');
    }
  };

  const filteredUsers = users.filter((user) => {
    const matchesSearch = user.nickname.includes(searchTerm) || 
                         user.accountId.includes(searchTerm) ||
                         (user.email && user.email.includes(searchTerm));
    
    if (filterType === 'member') return matchesSearch && user.membership.isActive;
    if (filterType === 'banned') return matchesSearch && user.isBanned;
    return matchesSearch;
  });

  if (loading) {
    return <div className="admin-loading-card">加载用户列表...</div>;
  }

  return (
    <div className="admin-users-page">
      <div className="admin-page-header">
        <h2>用户管理</h2>
        <div className="admin-filters">
          <input
            type="text"
            placeholder="搜索用户..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="admin-search-input"
          />
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as any)}
            className="admin-filter-select"
          >
            <option value="all">全部用户</option>
            <option value="member">会员用户</option>
            <option value="banned">被封禁用户</option>
          </select>
        </div>
      </div>

      <div className="admin-table-container">
        <table className="admin-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>账号</th>
              <th>昵称</th>
              <th>邮箱</th>
              <th>邀请码</th>
              <th>会员状态</th>
              <th>注册时间</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map((user) => (
              <tr key={user.id}>
                <td>{user.id}</td>
                <td>{user.accountId}</td>
                <td>{user.nickname}</td>
                <td>{user.email || '-'}</td>
                <td>{user.inviteCode || '-'}</td>
                <td>
                  {user.membership.isActive ? (
                    <span className="admin-badge admin-badge-success">
                      有效至 {new Date(user.membership.expiresAt).toLocaleDateString('zh-CN')}
                    </span>
                  ) : (
                    <span className="admin-badge">未开通</span>
                  )}
                </td>
                <td>{new Date(user.createdAt).toLocaleDateString('zh-CN')}</td>
                <td>
                  {user.isBanned ? (
                    <span className="admin-badge admin-badge-danger">已封禁</span>
                  ) : (
                    <span className="admin-badge admin-badge-success">正常</span>
                  )}
                </td>
                <td className="admin-actions">
                  <button
                    className="admin-btn admin-btn-sm"
                    onClick={() => handleCancelMembership(user.id)}
                    disabled={!user.membership.isActive}
                    title="取消会员权限"
                  >
                    ❌ 取消会员
                  </button>
                  <button
                    className={`admin-btn admin-btn-sm ${user.isBanned ? 'admin-btn-success' : 'admin-btn-danger'}`}
                    onClick={() => handleBanUser(user.id, user.isBanned)}
                  >
                    {user.isBanned ? '✅ 解除封禁' : '🚫 封禁账号'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="admin-table-footer">
        共 {filteredUsers.length} 位用户
      </div>
    </div>
  );
};

export default Users;
