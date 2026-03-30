import React, { useEffect, useState } from 'react';

interface RedeemCode {
  id: number;
  code: string;
  type: 'trial' | 'membership';
  durationDays?: number;
  usedBy?: string;
  usedAt?: string;
  createdAt: string;
  status: 'available' | 'used' | 'expired';
}

const RedeemCodes: React.FC = () => {
  const [codes, setCodes] = useState<RedeemCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [batchCount, setBatchCount] = useState(10);
  const [codeType, setCodeType] = useState<'trial' | 'membership'>('trial');
  const [durationDays, setDurationDays] = useState(30);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    loadCodes();
  }, []);

  const loadCodes = async () => {
    try {
      const response = await fetch('/api/admin/redeem-codes');
      const data = await response.json();
      
      if (response.ok) {
        setCodes(data.codes || []);
      } else {
        // 模拟数据
        setCodes([
          {
            id: 1,
            code: 'TEST-CODE-001',
            type: 'trial',
            usedBy: undefined,
            usedAt: undefined,
            createdAt: '2025-01-01T00:00:00',
            status: 'available',
          },
          {
            id: 2,
            code: 'TEST-CODE-002',
            type: 'membership',
            durationDays: 30,
            usedBy: 'user-001',
            usedAt: '2025-01-15T10:30:00',
            createdAt: '2025-01-01T00:00:00',
            status: 'used',
          },
        ]);
      }
    } catch (error) {
      console.error('Failed to load redeem codes:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateCodes = async () => {
    if (!confirm(`确定要生成 ${batchCount} 个${codeType === 'trial' ? '体验' : '会员'}兑换码吗？`)) return;

    setGenerating(true);
    try {
      const response = await fetch('/api/admin/redeem-codes/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          count: batchCount,
          type: codeType,
          durationDays: codeType === 'membership' ? durationDays : undefined,
        }),
      });

      if (response.ok) {
        alert(`成功生成 ${batchCount} 个兑换码`);
        loadCodes();
      } else {
        const data = await response.json();
        alert(`生成失败：${data.error}`);
      }
    } catch (error) {
      console.error('Failed to generate codes:', error);
      alert('生成失败，请重试');
    } finally {
      setGenerating(false);
    }
  };

  const handleExportCodes = () => {
    const availableCodes = codes.filter(c => c.status === 'available');
    const csvContent = [
      ['ID', '兑换码', '类型', '天数', '状态', '创建时间'],
      ...availableCodes.map(c => [
        c.id,
        c.code,
        c.type === 'trial' ? '体验' : '会员',
        c.durationDays || '-',
        c.status,
        new Date(c.createdAt).toLocaleString('zh-CN'),
      ])
    ].map(row => row.join(',')).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `redeem-codes-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  if (loading) {
    return <div className="admin-loading-card">加载兑换码列表...</div>;
  }

  const stats = {
    total: codes.length,
    available: codes.filter(c => c.status === 'available').length,
    used: codes.filter(c => c.status === 'used').length,
    expired: codes.filter(c => c.status === 'expired').length,
  };

  return (
    <div className="admin-redeem-codes-page">
      <div className="admin-page-header">
        <h2>兑换码管理</h2>
      </div>

      <div className="admin-stat-row">
        <div className="admin-stat-item">
          <div className="admin-stat-label">总数</div>
          <div className="admin-stat-value">{stats.total}</div>
        </div>
        <div className="admin-stat-item">
          <div className="admin-stat-label">可用</div>
          <div className="admin-stat-value admin-stat-success">{stats.available}</div>
        </div>
        <div className="admin-stat-item">
          <div className="admin-stat-label">已使用</div>
          <div className="admin-stat-value admin-stat-warning">{stats.used}</div>
        </div>
        <div className="admin-stat-item">
          <div className="admin-stat-label">已过期</div>
          <div className="admin-stat-value admin-stat-danger">{stats.expired}</div>
        </div>
      </div>

      <div className="admin-generate-section">
        <h3>🎫 批量生成兑换码</h3>
        <div className="admin-generate-form">
          <div className="form-group">
            <label>生成数量</label>
            <input
              type="number"
              min="1"
              max="1000"
              value={batchCount}
              onChange={(e) => setBatchCount(Number(e.target.value))}
              className="admin-input"
            />
          </div>
          <div className="form-group">
            <label>兑换码类型</label>
            <select
              value={codeType}
              onChange={(e) => setCodeType(e.target.value as any)}
              className="admin-select"
            >
              <option value="trial">体验会员 (7 天)</option>
              <option value="membership">付费会员 (自定义天数)</option>
            </select>
          </div>
          {codeType === 'membership' && (
            <div className="form-group">
              <label>会员天数</label>
              <input
                type="number"
                min="1"
                max="365"
                value={durationDays}
                onChange={(e) => setDurationDays(Number(e.target.value))}
                className="admin-input"
              />
            </div>
          )}
          <div className="admin-generate-actions">
            <button
              className="admin-btn admin-btn-primary"
              onClick={handleGenerateCodes}
              disabled={generating}
            >
              {generating ? '生成中...' : '✨ 生成兑换码'}
            </button>
            <button
              className="admin-btn"
              onClick={handleExportCodes}
              disabled={stats.available === 0}
            >
              📥 导出可用兑换码
            </button>
          </div>
        </div>
      </div>

      <div className="admin-table-container">
        <table className="admin-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>兑换码</th>
              <th>类型</th>
              <th>天数</th>
              <th>使用者</th>
              <th>使用时间</th>
              <th>创建时间</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {codes.slice(0, 100).map((code) => (
              <tr key={code.id}>
                <td>{code.id}</td>
                <td className="admin-code-text">{code.code}</td>
                <td>{code.type === 'trial' ? '体验' : '会员'}</td>
                <td>{code.durationDays || '-'}</td>
                <td>{code.usedBy || '-'}</td>
                <td>{code.usedAt ? new Date(code.usedAt).toLocaleString('zh-CN') : '-'}</td>
                <td>{new Date(code.createdAt).toLocaleString('zh-CN')}</td>
                <td>
                  {code.status === 'available' && (
                    <span className="admin-badge admin-badge-success">可用</span>
                  )}
                  {code.status === 'used' && (
                    <span className="admin-badge admin-badge-warning">已使用</span>
                  )}
                  {code.status === 'expired' && (
                    <span className="admin-badge admin-badge-danger">已过期</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="admin-table-footer">
        显示前 100 条，共 {codes.length} 个兑换码
      </div>
    </div>
  );
};

export default RedeemCodes;
