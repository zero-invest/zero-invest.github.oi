import React, { useEffect, useState } from 'react';

interface Appreciation {
  id: number;
  userId: number;
  userAccountId: string;
  userNickname: string;
  amount: number;
  transactionId: string;
  screenshotUrl?: string;
  submittedAt: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy?: number;
  reviewedAt?: string;
  rejectReason?: string;
}

const Appreciations: React.FC = () => {
  const [appreciations, setAppreciations] = useState<Appreciation[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');

  useEffect(() => {
    loadAppreciations();
  }, []);

  const loadAppreciations = async () => {
    try {
      const response = await fetch('/api/admin/appreciations');
      const data = await response.json();
      
      if (response.ok) {
        setAppreciations(data.appreciations || []);
      } else {
        // 模拟数据
        setAppreciations([
          {
            id: 1,
            userId: 1,
            userAccountId: 'user-001',
            userNickname: '测试用户 1',
            amount: 99,
            transactionId: 'TXN001',
            screenshotUrl: '/screenshots/test1.png',
            submittedAt: '2025-01-15T10:30:00',
            status: 'pending',
          },
          {
            id: 2,
            userId: 2,
            userAccountId: 'user-002',
            userNickname: '测试用户 2',
            amount: 199,
            transactionId: 'TXN002',
            screenshotUrl: '/screenshots/test2.png',
            submittedAt: '2025-01-14T15:20:00',
            status: 'approved',
            reviewedBy: 1,
            reviewedAt: '2025-01-14T16:00:00',
          },
        ]);
      }
    } catch (error) {
      console.error('Failed to load appreciations:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (id: number, userId: number, amount: number) => {
    if (!confirm(`确认通过该赞赏？将为用户赠送 ${Math.floor(amount / 100)} 个月会员。`)) return;

    try {
      const response = await fetch(`/api/admin/appreciations/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, amount }),
      });

      if (response.ok) {
        alert('赞赏已通过，会员权益已发放');
        loadAppreciations();
      } else {
        const data = await response.json();
        alert(`审核失败：${data.error}`);
      }
    } catch (error) {
      console.error('Failed to approve appreciation:', error);
      alert('审核失败，请重试');
    }
  };

  const handleReject = async (id: number, userId: number) => {
    const reason = prompt('请输入拒绝原因（选填）：');
    if (reason === null) return; // 用户取消

    if (!confirm('确定要拒绝该赞赏吗？')) return;

    try {
      const response = await fetch(`/api/admin/appreciations/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, reason: reason || undefined }),
      });

      if (response.ok) {
        alert('赞赏已拒绝');
        loadAppreciations();
      } else {
        const data = await response.json();
        alert(`操作失败：${data.error}`);
      }
    } catch (error) {
      console.error('Failed to reject appreciation:', error);
      alert('操作失败，请重试');
    }
  };

  const handleBanUser = async (userId: number, userNickname: string) => {
    if (!confirm(`确定要封禁用户 "${userNickname}" 吗？该操作将同时取消该用户的所有会员权益。`)) return;

    try {
      const response = await fetch(`/api/admin/users/${userId}/ban`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isBanned: true, cancelMembership: true }),
      });

      if (response.ok) {
        alert(`用户 ${userNickname} 已被封禁，会员权益已取消`);
        loadAppreciations();
      } else {
        const data = await response.json();
        alert(`操作失败：${data.error}`);
      }
    } catch (error) {
      console.error('Failed to ban user:', error);
      alert('操作失败，请重试');
    }
  };

  const filteredAppreciations = appreciations.filter(
    (app) => filterStatus === 'all' || app.status === filterStatus
  );

  if (loading) {
    return <div className="admin-loading-card">加载赞赏列表...</div>;
  }

  const stats = {
    total: appreciations.length,
    pending: appreciations.filter(a => a.status === 'pending').length,
    approved: appreciations.filter(a => a.status === 'approved').length,
    rejected: appreciations.filter(a => a.status === 'rejected').length,
  };

  return (
    <div className="admin-appreciations-page">
      <div className="admin-page-header">
        <h2>赞赏审核</h2>
        <div className="admin-filter-tabs">
          <button
            className={`admin-tab ${filterStatus === 'all' ? 'active' : ''}`}
            onClick={() => setFilterStatus('all')}
          >
            全部 ({stats.total})
          </button>
          <button
            className={`admin-tab ${filterStatus === 'pending' ? 'active' : ''}`}
            onClick={() => setFilterStatus('pending')}
          >
            待审核 ({stats.pending})
          </button>
          <button
            className={`admin-tab ${filterStatus === 'approved' ? 'active' : ''}`}
            onClick={() => setFilterStatus('approved')}
          >
            已通过 ({stats.approved})
          </button>
          <button
            className={`admin-tab ${filterStatus === 'rejected' ? 'active' : ''}`}
            onClick={() => setFilterStatus('rejected')}
          >
            已拒绝 ({stats.rejected})
          </button>
        </div>
      </div>

      <div className="admin-table-container">
        <table className="admin-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>用户</th>
              <th>金额</th>
              <th>交易 ID</th>
              <th>截图</th>
              <th>提交时间</th>
              <th>状态</th>
              <th>审核信息</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {filteredAppreciations.map((app) => (
              <tr key={app.id}>
                <td>{app.id}</td>
                <td>
                  <div>{app.userNickname}</div>
                  <div className="admin-text-small">{app.userAccountId}</div>
                </td>
                <td className="admin-amount">¥{app.amount.toFixed(2)}</td>
                <td className="admin-code-text">{app.transactionId}</td>
                <td>
                  {app.screenshotUrl ? (
                    <a href={app.screenshotUrl} target="_blank" rel="noopener noreferrer" className="admin-link">
                      📷 查看截图
                    </a>
                  ) : (
                    '-'
                  )}
                </td>
                <td>{new Date(app.submittedAt).toLocaleString('zh-CN')}</td>
                <td>
                  {app.status === 'pending' && (
                    <span className="admin-badge admin-badge-warning">待审核</span>
                  )}
                  {app.status === 'approved' && (
                    <span className="admin-badge admin-badge-success">已通过</span>
                  )}
                  {app.status === 'rejected' && (
                    <span className="admin-badge admin-badge-danger">已拒绝</span>
                  )}
                </td>
                <td>
                  {app.status === 'approved' && app.reviewedBy && (
                    <div className="admin-text-small">
                      审核人：{app.reviewedBy}<br />
                      {app.reviewedAt && new Date(app.reviewedAt).toLocaleString('zh-CN')}
                    </div>
                  )}
                  {app.status === 'rejected' && app.rejectReason && (
                    <div className="admin-text-small admin-text-danger">
                      原因：{app.rejectReason}
                    </div>
                  )}
                </td>
                <td className="admin-actions">
                  {app.status === 'pending' ? (
                    <>
                      <button
                        className="admin-btn admin-btn-sm admin-btn-success"
                        onClick={() => handleApprove(app.id, app.userId, app.amount)}
                      >
                        ✅ 通过
                      </button>
                      <button
                        className="admin-btn admin-btn-sm admin-btn-danger"
                        onClick={() => handleReject(app.id, app.userId)}
                      >
                        ❌ 拒绝
                      </button>
                      <button
                        className="admin-btn admin-btn-sm admin-btn-danger"
                        onClick={() => handleBanUser(app.userId, app.userNickname)}
                        title="怀疑 P 图，封禁用户"
                      >
                        🚫 封禁
                      </button>
                    </>
                  ) : (
                    <span className="admin-text-small">已审核</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="admin-table-footer">
        共 {filteredAppreciations.length} 条记录
      </div>
    </div>
  );
};

export default Appreciations;
