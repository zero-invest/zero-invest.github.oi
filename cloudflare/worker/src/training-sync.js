/**
 * 同步训练状态到 Worker
 * 将本地的训练指标（MAE、样本数等）同步到 Worker 数据库
 */

// 需要从本地文件读取的训练指标
const OFFLINE_RESEARCH_CODES = new Set([
  '160216', '160723', '161725', '501018', '161129', '160719', '161116', '164701',
  '501225', '513310', '161130', '160416', '162719', '162411', '161125', '161126',
  '161127', '162415', '159329', '513080', '520830', '513730', '164824', '160644',
  '159100', '520870', '160620', '161217', '161124', '501300', '160140', '520580',
  '159509', '501312', '501011', '501050', '160221', '165520', '167301', '161226',
  '161128', '513800', '513880', '513520', '513100', '513500', '159502', '513290',
  '159561', '513030', '513850', '513300', '159518', '163208', '159577', '513400',
  '159985', '168204', '501036', '501043', '160807', '161607', '161039'
]);

/**
 * 从本地生成的 offline-research.json 文件中提取训练指标
 */
async function loadTrainingMetrics(code) {
  try {
    const response = await fetch(`./generated/${code}-offline-research.json`);
    if (!response.ok) return null;
    const data = await response.json();
    
    return {
      code,
      maeTrain: data?.segmented?.maeTrain || 0,
      maeValidation: data?.segmented?.maeValidation || 0,
      maeValidation30: data?.segmented?.maeValidation30 || 0,
      maeValidation30Robust: data?.segmented?.maeValidation30Robust,
      generatedAt: data?.generatedAt || new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * 同步所有训练指标到 Worker 数据库
 */
export async function syncTrainingMetrics(db) {
  const startTime = Date.now();
  console.log('[TrainingSync] Starting sync...');
  
  try {
    const metrics = [];
    
    // 批量加载训练指标
    for (const code of OFFLINE_RESEARCH_CODES) {
      const metric = await loadTrainingMetrics(code);
      if (metric) {
        metrics.push(metric);
      }
    }
    
    if (metrics.length === 0) {
      throw new Error('No training metrics loaded');
    }
    
    // 保存到数据库
    const syncedAt = new Date().toISOString();
    const statements = [
      db.prepare(
        'INSERT OR REPLACE INTO training_metrics (code, mae_train, mae_validation, mae_validation_30, mae_validation_30_robust, generated_at, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        metrics[0].code,
        metrics[0].maeTrain,
        metrics[0].maeValidation,
        metrics[0].maeValidation30,
        metrics[0].maeValidation30Robust || null,
        metrics[0].generatedAt,
        syncedAt
      )
    ];
    
    await db.batch(statements);
    
    const duration = Date.now() - startTime;
    console.log(`[TrainingSync] Sync completed: ${metrics.length} metrics in ${duration}ms`);
    
    return {
      ok: true,
      count: metrics.length,
      duration,
      codes: metrics.map(m => m.code),
    };
  } catch (error) {
    console.error('[TrainingSync] Sync failed:', error);
    return {
      ok: false,
      error: error.message,
      duration: Date.now() - startTime,
    };
  }
}

/**
 * 获取所有训练指标
 */
export async function getAllTrainingMetrics(db) {
  const result = await db.prepare(
    'SELECT code, mae_train, mae_validation, mae_validation_30, mae_validation_30_robust, generated_at FROM training_metrics ORDER BY code'
  ).all();
  
  return (result.results || []).map(row => ({
    code: row.code,
    maeTrain: row.mae_train,
    maeValidation: row.mae_validation,
    maeValidation30: row.mae_validation_30,
    maeValidation30Robust: row.mae_validation_30_robust,
    generatedAt: row.generated_at,
  }));
}

/**
 * 获取单个基金的训练指标
 */
export async function getTrainingMetricsByCode(db, code) {
  const row = await db.prepare(
    'SELECT code, mae_train, mae_validation, mae_validation_30, mae_validation_30_robust, generated_at FROM training_metrics WHERE code = ?'
  ).bind(code).first();
  
  if (!row) return null;
  
  return {
    code: row.code,
    maeTrain: row.mae_train,
    maeValidation: row.mae_validation,
    maeValidation30: row.mae_validation_30,
    maeValidation30Robust: row.mae_validation_30_robust,
    generatedAt: row.generated_at,
  };
}
