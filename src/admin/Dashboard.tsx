import React, { useEffect, useState } from 'react';

interface DashboardStats {
  totalUsers: number;
  activeMembers: number;
  pendingAppreciations: number;
  todayVisitors: number;
  totalRedeemCodes: number;
  availableRedeemCodes: number;
}

const Dashboard: React.FC = () => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadStats = async () => {
      try {
        // TODO: 替换为实际的 API 调用
        const response = await fetch('/api/admin/dashboard/stats');
        const data = await response.json();
        
        if (response.ok) {
          setStats(data);
        } else {
          // 开发环境使用模拟数据
          setStats({
            totalUsers: 1258,
            activeMembers: 342,
            pendingAppreciations: 15,
            todayVisitors: 856,
            totalRedeemCodes: 500,
            availableRedeemCodes: 287,
          });
        }
      } catch (error) {
        console.error('Failed to load dashboard stats:', error);
        // 使用模拟数据
        setStats({
          totalUsers: 1258,
          activeMembers: 342,
          pendingAppreciations: 15,
          todayVisitors: 856,
          totalRedeemCodes: 500,
          availableRedeemCodes: 287,
        });
      } finally {
        setLoading(false);
      }
    };

    loadStats();
  }, []);

  if (loading) {
    return <div className="admin-loading-card">加载数据...</div>;
  }

  const statCards = [
    { title: '总用户数', value: stats?.totalUsers || 0, icon: '👥', color: '#4CAF50' },
    { title: '活跃会员', value: stats?.activeMembers || 0, icon: '⭐', color: '#2196F3' },
    { title: '待审核赞赏', value: stats?.pendingAppreciations || 0, icon: '⏳', color: '#FF9800' },
    { title: '今日访客', value: stats?.todayVisitors || 0, icon: '📊', color: '#9C27B0' },
    { title: '兑换码总数', value: stats?.totalRedeemCodes || 0, icon: '🎫', color: '#E91E63' },
    { title: '可用兑换码', value: stats?.availableRedeemCodes || 0, icon: '✅', color: '#00BCD4' },
  ];

  return (
    <div className="admin-dashboard">
      <div className="admin-stat-grid">
        {statCards.map((card) => (
          <div key={card.title} className="admin-stat-card" style={{ borderLeftColor: card.color }}>
            <div className="admin-stat-icon" style={{ backgroundColor: `${card.color}20` }}>
              {card.icon}
            </div>
            <div className="admin-stat-info">
              <div className="admin-stat-label">{card.title}</div>
              <div className="admin-stat-value">{card.value.toLocaleString()}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="admin-dashboard-sections">
        <div className="admin-dashboard-section">
          <h3>📋 快捷操作</h3>
          <div className="admin-quick-actions">
            <button className="admin-action-btn" onClick={() => window.location.href = '/admin/redeem-codes'}>
              🎫 生成兑换码
            </button>
            <button className="admin-action-btn" onClick={() => window.location.href = '/admin/appreciations'}>
              💰 审核赞赏
            </button>
            <button className="admin-action-btn" onClick={() => window.location.href = '/admin/users'}>
              👥 用户管理
            </button>
            <button className="admin-action-btn" onClick={() => window.location.href = '/admin/traffic'}>
              📈 查看统计
            </button>
          </div>
        </div>

        <div className="admin-dashboard-section">
          <h3>ℹ️ 系统信息</h3>
          <div className="admin-system-info">
            <div className="admin-info-row">
              <span className="admin-info-label">系统版本:</span>
              <span className="admin-info-value">v1.0.0</span>
            </div>
            <div className="admin-info-row">
              <span className="admin-info-label">最后更新:</span>
              <span className="admin-info-value">{new Date().toLocaleString('zh-CN')}</span>
            </div>
            <div className="admin-info-row">
              <span className="admin-info-label">环境</span>
              <span className="admin-info-value">{window.location.hostname === 'localhost' ? '开发环境' : '生产环境'}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
