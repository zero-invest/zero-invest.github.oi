const OIL_CODES = ['160723', '501018', '161129', '160416', '162719', '162411', '163208', '159518', '160216'];

const DEFAULT_RUNTIME_SYNC_SOURCE =
  'https://987144016.github.io/lof-Premium-Rate-Web/generated/funds-runtime.json';
const DEFAULT_SYNC_INTERVAL_MINUTES = 5;
const MAX_SYNC_INTERVAL_MINUTES = 60;

// 导入自主同步引擎
import { syncAllFunds, getAllFunds, getFundByCode } from './sync-engine.js';
import { buildPremiumComparePayload } from './premium-compare-engine.js';
import { getAllTrainingMetrics, getTrainingMetricsByCode } from './training-metrics.js';

function buildCorsHeaders(request) {
  const origin = String(request?.headers?.get('origin') || '*').trim() || '*';
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, OPTIONS, POST',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-allow-credentials': 'true',
    vary: 'Origin',
  };
}

function json(payload, status = 200, request = null) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...buildCorsHeaders(request),
    },
  });
}

function withCors(response, request) {
  const headers = buildCorsHeaders(request);
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }
  return response;
}

const textEncoder = new TextEncoder();
const USERNAME_REGEX = /^[\u4e00-\u9fa5A-Za-z0-9_]{4,20}$/;
const PHONE_REGEX = /^1\d{10}$/;
const SESSION_COOKIE_NAME = 'lof_session';
const TRIAL_DAYS = 7;
const INVITE_REWARD_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const REWARD_PRICE_DAY_RULES = {
  500: 30,
  1000: 90,
};
const RATE_LIMIT_WINDOW_MINUTES = 15;
const RATE_LIMIT_MAX_HITS = 20;

function badRequest(error, extra = {}) {
  return json({ ok: false, error, ...extra }, 400);
}

function unauthorized(error = 'Unauthorized') {
  return json({ ok: false, error }, 401);
}

function forbidden(error = 'Forbidden') {
  return json({ ok: false, error }, 403);
}

function getClientIp(request) {
  return String(request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || '').trim();
}

function normalizeAccountId(value) {
  return String(value || '').trim();
}

function detectAccountType(accountId) {
  return PHONE_REGEX.test(accountId) ? 'phone' : 'username';
}

function validateAccountId(accountId) {
  if (!accountId) return '账号不能为空';
  if (PHONE_REGEX.test(accountId)) return '';
  if (!USERNAME_REGEX.test(accountId)) {
    return '账号需为4到20位，可使用中文、英文、数字、下划线';
  }
  return '';
}

function validatePassword(password) {
  const value = String(password || '');
  if (value.length < 6 || value.length > 64) {
    return '密码长度需在6到64位之间';
  }
  return '';
}

function normalizeNickname(value, fallback) {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  return raw.slice(0, 24);
}

function normalizeInviteCode(value) {
  return String(value || '').trim().toUpperCase();
}

function createInviteCode() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
}

function createOrderNo() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const random = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
  return `ORD${stamp}${random}`;
}

function maskRedeemCode(code) {
  const value = String(code || '').trim().toUpperCase();
  if (value.length <= 6) return value;
  return `${value.slice(0, 3)}***${value.slice(-3)}`;
}

async function sha256Hex(input) {
  const buffer = await crypto.subtle.digest('SHA-256', textEncoder.encode(String(input)));
  return [...new Uint8Array(buffer)].map((item) => item.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password, salt = crypto.randomUUID().replace(/-/g, '')) {
  const digest = await sha256Hex(`${salt}:${String(password)}`);
  return `sha256$${salt}$${digest}`;
}

async function verifyPassword(password, storedHash) {
  const [scheme, salt, digest] = String(storedHash || '').split('$');
  if (scheme !== 'sha256' || !salt || !digest) return false;
  const actual = await sha256Hex(`${salt}:${String(password)}`);
  return actual === digest;
}

function extractSessionToken(request) {
  const cookieHeader = String(request.headers.get('cookie') || '');
  const cookies = cookieHeader.split(';').map((item) => item.trim()).filter(Boolean);
  for (const cookie of cookies) {
    const index = cookie.indexOf('=');
    if (index < 0) continue;
    const name = cookie.slice(0, index).trim();
    const value = cookie.slice(index + 1).trim();
    if (name === SESSION_COOKIE_NAME) {
      return decodeURIComponent(value);
    }
  }
  return '';
}

function appendSessionCookie(response, token, expiresAt) {
  const expires = new Date(expiresAt).toUTCString();
  response.headers.append('set-cookie', `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Secure; Expires=${expires}`);
  return response;
}

function clearSessionCookie(response) {
  response.headers.append('set-cookie', `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Secure; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
  return response;
}

function getNowIso() {
  return new Date().toISOString();
}

function addDaysIso(baseValue, days) {
  const base = baseValue ? new Date(baseValue) : new Date();
  const safeBase = Number.isNaN(base.getTime()) ? new Date() : base;
  return new Date(safeBase.getTime() + days * DAY_MS).toISOString();
}

function isMembershipActive(expiresAt) {
  if (!expiresAt) return false;
  const ts = Date.parse(String(expiresAt));
  if (Number.isNaN(ts)) return false;
  return ts > Date.now();
}

function sanitizeFundForGuest(fund) {
  if (!fund || typeof fund !== 'object') return fund;
  const next = JSON.parse(JSON.stringify(fund));
  if (next.journal?.errors) {
    next.journal.errors = [];
  }
  if (next.runtime) {
    delete next.runtime.navHistory;
  }
  return next;
}

async function requireAdminToken(request, env) {
  const syncToken = String(env.RUNTIME_SYNC_TOKEN || '').trim();
  const authorization = String(request.headers.get('authorization') || '').trim();
  const bearerToken = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  return Boolean(syncToken && bearerToken === syncToken);
}

async function getUserByAccountId(db, accountId) {
  return db.prepare('SELECT * FROM users WHERE account_id = ? LIMIT 1').bind(accountId).first();
}

async function getUserByInviteCode(db, inviteCode) {
  return db.prepare('SELECT * FROM users WHERE invite_code = ? LIMIT 1').bind(inviteCode).first();
}

async function getMembershipByUserId(db, userId) {
  return db.prepare('SELECT * FROM memberships WHERE user_id = ? LIMIT 1').bind(userId).first();
}

async function registerRiskLog(db, scope, targetKey, action) {
  await db.prepare(
    'INSERT INTO risk_request_logs (scope, target_key, action, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
  ).bind(scope, targetKey, action).run();
}

async function assertRateLimit(db, scope, targetKey, action) {
  const row = await db.prepare(
    `SELECT COUNT(1) AS total FROM risk_request_logs
     WHERE scope = ? AND target_key = ? AND action = ?
       AND created_at >= datetime('now', ?)`,
  ).bind(scope, targetKey, action, `-${RATE_LIMIT_WINDOW_MINUTES} minutes`).first();
  if (Number(row?.total || 0) >= RATE_LIMIT_MAX_HITS) {
    throw new Error('操作过于频繁，请稍后再试');
  }
  await registerRiskLog(db, scope, targetKey, action);
}

async function createRiskFlag(db, userId, orderId, flagType, details) {
  await db.prepare(
    'INSERT INTO risk_flags (user_id, order_id, flag_type, details_json, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)',
  ).bind(userId || null, orderId || null, flagType, JSON.stringify(details || {})).run();
}

async function buildUserProfile(db, userRow) {
  if (!userRow) return null;
  const membership = await getMembershipByUserId(db, userRow.id);
  return {
    id: Number(userRow.id),
    accountId: String(userRow.account_id || ''),
    accountType: String(userRow.account_type || ''),
    nickname: String(userRow.nickname || ''),
    inviteCode: String(userRow.invite_code || ''),
    invitedByUserId: userRow.invited_by_user_id ? Number(userRow.invited_by_user_id) : null,
    inviteRewardDeadlineAt: String(userRow.invite_reward_deadline_at || ''),
    createdAt: String(userRow.created_at || ''),
    membership: {
      isActive: isMembershipActive(membership?.member_expires_at),
      expiresAt: String(membership?.member_expires_at || ''),
      trialGrantedAt: String(membership?.trial_granted_at || ''),
    },
  };
}

async function createSession(db, userId) {
  const sessionToken = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  const sessionTokenHash = await sha256Hex(sessionToken);
  const expiresAt = addDaysIso(getNowIso(), 30);
  await db.prepare(
    `INSERT INTO user_sessions (user_id, session_token_hash, expires_at, created_at, last_seen_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  ).bind(userId, sessionTokenHash, expiresAt).run();
  return { sessionToken, expiresAt };
}

async function getAuthenticatedUser(request, db) {
  const sessionToken = extractSessionToken(request);
  if (!sessionToken) return null;
  const sessionTokenHash = await sha256Hex(sessionToken);
  const session = await db.prepare(
    `SELECT s.id AS session_id, s.user_id, s.expires_at, s.revoked_at, u.*
     FROM user_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.session_token_hash = ?
     LIMIT 1`,
  ).bind(sessionTokenHash).first();
  if (!session || session.revoked_at) return null;
  if (!session.expires_at || Date.parse(String(session.expires_at)) <= Date.now()) return null;
  await db.prepare('UPDATE user_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?').bind(session.session_id).run();
  return session;
}

async function revokeSession(request, db) {
  const sessionToken = extractSessionToken(request);
  if (!sessionToken) return;
  const sessionTokenHash = await sha256Hex(sessionToken);
  await db.prepare('UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE session_token_hash = ?').bind(sessionTokenHash).run();
}

async function grantMembershipDays(db, userId, days, eventType, sourceType, sourceId, description) {
  const membership = await getMembershipByUserId(db, userId);
  const baseExpiresAt = isMembershipActive(membership?.member_expires_at) ? membership.member_expires_at : getNowIso();
  const nextExpiresAt = addDaysIso(baseExpiresAt, days);
  await db.batch([
    db.prepare(
      `INSERT INTO memberships (user_id, member_expires_at, trial_granted_at, created_at, updated_at)
       VALUES (?, ?, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET
         member_expires_at = excluded.member_expires_at,
         updated_at = CURRENT_TIMESTAMP`,
    ).bind(userId, nextExpiresAt),
    db.prepare(
      `INSERT INTO membership_events (user_id, event_type, days, source_type, source_id, description, created_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    ).bind(userId, eventType, days, sourceType, sourceId, description),
  ]);
  return nextExpiresAt;
}

async function grantTrialMembership(db, userId) {
  const membership = await getMembershipByUserId(db, userId);
  if (membership?.trial_granted_at) {
    return membership.member_expires_at;
  }
  const expiresAt = addDaysIso(getNowIso(), TRIAL_DAYS);
  await db.batch([
    db.prepare(
      `INSERT INTO memberships (user_id, member_expires_at, trial_granted_at, created_at, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET
         member_expires_at = excluded.member_expires_at,
         trial_granted_at = COALESCE(memberships.trial_granted_at, CURRENT_TIMESTAMP),
         updated_at = CURRENT_TIMESTAMP`,
    ).bind(userId, expiresAt),
    db.prepare(
      `INSERT INTO membership_events (user_id, event_type, days, source_type, source_id, description, created_at)
       VALUES (?, 'trial', ?, 'system', 'trial-on-register', '首次注册赠送7天会员', CURRENT_TIMESTAMP)`,
    ).bind(userId, TRIAL_DAYS),
  ]);
  return expiresAt;
}

async function handleRegister(request, env, db) {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method Not Allowed' }, 405);
  const payload = await request.json();
  await assertRateLimit(db, 'ip', getClientIp(request) || 'unknown', 'register');
  const accountId = normalizeAccountId(payload?.accountId);
  const password = String(payload?.password || '');
  const nickname = normalizeNickname(payload?.nickname, accountId);
  const inviteCode = normalizeInviteCode(payload?.inviteCode);
  const accountError = validateAccountId(accountId);
  if (accountError) return badRequest(accountError);
  const passwordError = validatePassword(password);
  if (passwordError) return badRequest(passwordError);
  const existing = await getUserByAccountId(db, accountId);
  if (existing) return badRequest('该账号已被注册');
  let inviter = null;
  if (inviteCode) {
    inviter = await getUserByInviteCode(db, inviteCode);
    if (!inviter) return badRequest('邀请码无效');
  }
  const passwordHash = await hashPassword(password);
  let finalInviteCode = createInviteCode();
  while (await getUserByInviteCode(db, finalInviteCode)) {
    finalInviteCode = createInviteCode();
  }
  const inviteRewardDeadlineAt = inviter ? addDaysIso(getNowIso(), INVITE_REWARD_WINDOW_DAYS) : '';
  await db.prepare(
    `INSERT INTO users (
      account_id, account_type, password_hash, nickname, invite_code, invited_by_user_id, invite_bound_at, invite_reward_deadline_at, status, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  ).bind(
    accountId,
    detectAccountType(accountId),
    passwordHash,
    nickname,
    finalInviteCode,
    inviter?.id || null,
    inviter ? getNowIso() : null,
    inviteRewardDeadlineAt || null,
  ).run();
  const user = await getUserByAccountId(db, accountId);
  await grantTrialMembership(db, user.id);
  const session = await createSession(db, user.id);
  const profile = await buildUserProfile(db, user);
  const response = json({ ok: true, user: profile });
  return appendSessionCookie(response, session.sessionToken, session.expiresAt);
}

async function handleLogin(request, env, db) {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method Not Allowed' }, 405);
  const payload = await request.json();
  await assertRateLimit(db, 'ip', getClientIp(request) || 'unknown', 'login');
  const accountId = normalizeAccountId(payload?.accountId);
  const password = String(payload?.password || '');
  const user = await getUserByAccountId(db, accountId);
  if (!user) return unauthorized('账号或密码错误');
  if (String(user.status || '') === 'blocked') return forbidden('账号已被封禁');
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return unauthorized('账号或密码错误');
  await db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(user.id).run();
  const session = await createSession(db, user.id);
  const profile = await buildUserProfile(db, user);
  const response = json({ ok: true, user: profile });
  return appendSessionCookie(response, session.sessionToken, session.expiresAt);
}

async function handleLogout(request, env, db) {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method Not Allowed' }, 405);
  await revokeSession(request, db);
  return clearSessionCookie(json({ ok: true }));
}

// Authing 嵌入式登录：前端 Guard 组件登录成功后，将 access_token 发送到此接口
// 后端用 token 向 Authing userinfo 端点验证身份，然后在本地创建/查找用户并建立会话
async function handleAuthingLogin(request, env, db) {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method Not Allowed' }, 405);
  const payload = await request.json();
  const accessToken = String(payload?.accessToken || payload?.access_token || '').trim();
  if (!accessToken) return badRequest('缺少 Authing access_token');

  await assertRateLimit(db, 'ip', getClientIp(request) || 'unknown', 'authing-login');

  // 从环境变量读取 Authing 域名，回退到硬编码默认值
  const authingDomain = String(env.AUTHING_DOMAIN || 'https://sicfljueranf-demo.authing.cn').replace(/\/+$/, '');

  // 使用 access_token 调用 Authing OIDC userinfo 端点验证用户身份
  let authingUser;
  try {
    const userinfoResponse = await fetch(`${authingDomain}/oidc/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!userinfoResponse.ok) {
      const errorText = await userinfoResponse.text().catch(() => '');
      return unauthorized(`Authing token 验证失败 (${userinfoResponse.status}): ${errorText}`);
    }
    authingUser = await userinfoResponse.json();
  } catch (error) {
    return json({ ok: false, error: `Authing 验证请求失败: ${error?.message || String(error)}` }, 502);
  }

  // 从 Authing userinfo 提取用户信息
  const authingSub = String(authingUser.sub || '').trim();
  if (!authingSub) return json({ ok: false, error: 'Authing 返回数据缺少 sub 字段' }, 502);

  // 用 authing:{sub} 作为 account_id，避免与自建账号冲突
  const accountId = `authing:${authingSub}`;
  const nickname = String(authingUser.nickname || authingUser.name || authingUser.preferred_username || authingUser.phone_number || authingSub).slice(0, 24);

  // 查找已有用户或创建新用户
  let user = await getUserByAccountId(db, accountId);
  if (user) {
    // 已有用户，检查是否被封禁
    if (String(user.status || '') === 'blocked') return forbidden('账号已被封禁');
    // 更新最后登录时间和昵称
    await db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP, nickname = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(nickname, user.id).run();
  } else {
    // 新用户：自动注册
    const passwordHash = await hashPassword(crypto.randomUUID()); // Authing 用户不需要本地密码，随机填充
    let inviteCode = createInviteCode();
    while (await getUserByInviteCode(db, inviteCode)) {
      inviteCode = createInviteCode();
    }
    await db.prepare(
      `INSERT INTO users (
        account_id, account_type, password_hash, nickname, invite_code, invited_by_user_id, invite_bound_at, invite_reward_deadline_at, status, created_at, updated_at
       ) VALUES (?, 'authing', ?, ?, ?, NULL, NULL, NULL, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    ).bind(accountId, passwordHash, nickname, inviteCode).run();
    user = await getUserByAccountId(db, accountId);
    // 赠送试用会员
    await grantTrialMembership(db, user.id);
  }

  // 创建会话
  const session = await createSession(db, user.id);
  const profile = await buildUserProfile(db, user);
  const response = json({ ok: true, user: profile });
  return appendSessionCookie(response, session.sessionToken, session.expiresAt);
}

// 发送邮箱验证码（通过 Authing API）
async function handleSendCode(request, env, db) {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method Not Allowed' }, 405);
  const payload = await request.json();
  const email = String(payload?.email || '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return badRequest('请输入正确的邮箱地址');

  await assertRateLimit(db, 'ip', getClientIp(request) || 'unknown', 'send-code');

  const cooldownKey = `send-code:${email}`;
  const cooldownWindowSeconds = 60;
  const existingCooldown = await db.prepare(
    `SELECT created_at
       FROM rate_limits
      WHERE subject_type = 'email' AND subject_key = ? AND action = 'send-code-cooldown'
      ORDER BY created_at DESC
      LIMIT 1`
  ).bind(cooldownKey).first();
  if (existingCooldown?.created_at) {
    const remaining = Math.ceil((new Date(String(existingCooldown.created_at)).getTime() + cooldownWindowSeconds * 1000 - Date.now()) / 1000);
    if (remaining > 0) {
      return json({ ok: false, error: `请在 ${remaining} 秒后再试` }, 429);
    }
  }

  const authingDomain = String(env.AUTHING_DOMAIN || 'https://sicfljueranf-demo.authing.cn').replace(/\/+$/, '');
  const appId = String(env.AUTHING_APP_ID || '69c768cd00a8bf9c4493e994');
  const appSecret = String(env.AUTHING_APP_SECRET || '');

  if (!appSecret) return json({ ok: false, error: '服务端未配置 AUTHING_APP_SECRET' }, 500);

  // 先获取 Management API access_token
  let mgmtToken;
  try {
    const tokenRes = await fetch(`${authingDomain}/oidc/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: appId,
        client_secret: appSecret,
        scope: 'openid',
      }),
    });
    const tokenData = await tokenRes.json();
    mgmtToken = tokenData.access_token;
    if (!mgmtToken) return json({ ok: false, error: 'Authing 认证失败' }, 502);
  } catch (error) {
    return json({ ok: false, error: `Authing token 获取失败: ${error?.message || String(error)}` }, 502);
  }

  // 调用 Authing v3 发送邮箱验证码 API
  try {
    const sendRes = await fetch(`${authingDomain}/api/v3/send-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${mgmtToken}`,
        'x-authing-app-id': appId,
      },
      body: JSON.stringify({
        channel: 'CHANNEL_LOGIN',
        email: email,
      }),
    });
    const sendData = await sendRes.json();
    if (sendData.statusCode !== 200 && sendData.apiCode !== 200) {
      return json({ ok: false, error: sendData.message || '验证码发送失败' }, 400);
    }
    await db.prepare(
      `INSERT INTO rate_limits (subject_type, subject_key, action, window_start, count, created_at)
       VALUES ('email', ?, 'send-code-cooldown', CURRENT_TIMESTAMP, 1, CURRENT_TIMESTAMP)`
    ).bind(cooldownKey).run();
    return json({ ok: true, message: '验证码已发送到邮箱' });
  } catch (error) {
    return json({ ok: false, error: `验证码发送请求失败: ${error?.message || String(error)}` }, 502);
  }
}

// 验证码登录（通过 Authing API 验证后走本地用户/会话逻辑）
async function handleCodeLogin(request, env, db) {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method Not Allowed' }, 405);
  const payload = await request.json();
  const email = String(payload?.email || '').trim().toLowerCase();
  const code = String(payload?.code || '').trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return badRequest('请输入正确的邮箱地址');
  if (!code || code.length < 4) return badRequest('请输入验证码');

  await assertRateLimit(db, 'ip', getClientIp(request) || 'unknown', 'code-login');

  const authingDomain = String(env.AUTHING_DOMAIN || 'https://sicfljueranf-demo.authing.cn').replace(/\/+$/, '');
  const appId = String(env.AUTHING_APP_ID || '69c768cd00a8bf9c4493e994');
  const appSecret = String(env.AUTHING_APP_SECRET || '');

  if (!appSecret) return json({ ok: false, error: '服务端未配置 AUTHING_APP_SECRET' }, 500);

  // 调用 Authing v3 邮箱验证码登录 API
  let authingUser;
  try {
    const loginRes = await fetch(`${authingDomain}/api/v3/signin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-authing-app-id': appId,
      },
      body: JSON.stringify({
        connection: 'PASSCODE',
        passCodePayload: {
          email: email,
          passCode: code,
        },
        options: {
          scope: 'openid profile email',
        },
      }),
    });
    const loginData = await loginRes.json();
    if (loginData.statusCode !== 200 || !loginData.data) {
      return json({ ok: false, error: loginData.message || '验证码登录失败' }, 401);
    }
    // loginData.data 中含有 access_token 和用户信息
    const accessToken = loginData.data.access_token;
    if (!accessToken) return json({ ok: false, error: 'Authing 未返回 access_token' }, 502);

    // 使用 access_token 获取用户信息
    const userinfoRes = await fetch(`${authingDomain}/oidc/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!userinfoRes.ok) {
      return unauthorized('Authing 用户信息获取失败');
    }
    authingUser = await userinfoRes.json();
  } catch (error) {
    return json({ ok: false, error: `Authing 登录请求失败: ${error?.message || String(error)}` }, 502);
  }

  // 以下逻辑与 handleAuthingLogin 相同
  const authingSub = String(authingUser.sub || '').trim();
  if (!authingSub) return json({ ok: false, error: 'Authing 返回数据缺少 sub 字段' }, 502);

  const accountId = `authing:${authingSub}`;
  const nickname = String(authingUser.nickname || authingUser.name || authingUser.preferred_username || authingUser.email || email).slice(0, 24);

  let user = await getUserByAccountId(db, accountId);
  if (user) {
    if (String(user.status || '') === 'blocked') return forbidden('账号已被封禁');
    await db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP, nickname = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(nickname, user.id).run();
  } else {
    const passwordHash = await hashPassword(crypto.randomUUID());
    let inviteCode = createInviteCode();
    while (await getUserByInviteCode(db, inviteCode)) {
      inviteCode = createInviteCode();
    }
    await db.prepare(
      `INSERT INTO users (
        account_id, account_type, password_hash, nickname, invite_code, invited_by_user_id, invite_bound_at, invite_reward_deadline_at, status, created_at, updated_at
       ) VALUES (?, 'authing', ?, ?, ?, NULL, NULL, NULL, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    ).bind(accountId, passwordHash, nickname, inviteCode).run();
    user = await getUserByAccountId(db, accountId);
    await grantTrialMembership(db, user.id);
  }

  const session = await createSession(db, user.id);
  const profile = await buildUserProfile(db, user);
  const response = json({ ok: true, user: profile });
  return appendSessionCookie(response, session.sessionToken, session.expiresAt);
}

async function handleAuthMe(request, env, db) {
  if (request.method !== 'GET') return json({ ok: false, error: 'Method Not Allowed' }, 405);
  const user = await getAuthenticatedUser(request, db);
  if (!user) return unauthorized('未登录');
  return json({ ok: true, user: await buildUserProfile(db, user) });
}

async function handleMemberStatus(request, env, db) {
  if (request.method !== 'GET') return json({ ok: false, error: 'Method Not Allowed' }, 405);
  const user = await getAuthenticatedUser(request, db);
  if (!user) return unauthorized('未登录');
  return json({ ok: true, user: await buildUserProfile(db, user) });
}

async function handleMemberEvents(request, env, db) {
  if (request.method !== 'GET') return json({ ok: false, error: 'Method Not Allowed' }, 405);
  const user = await getAuthenticatedUser(request, db);
  if (!user) return unauthorized('未登录');
  const result = await db.prepare(
    'SELECT event_type, days, source_type, source_id, description, created_at FROM membership_events WHERE user_id = ? ORDER BY id DESC LIMIT 100',
  ).bind(user.id).all();
  return json({ ok: true, events: result?.results || [] });
}

async function handleRedeemApply(request, env, db) {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method Not Allowed' }, 405);
  const user = await getAuthenticatedUser(request, db);
  if (!user) return unauthorized('请先登录');
  await assertRateLimit(db, 'user', String(user.id), 'redeem');
  const payload = await request.json();
  const rawCode = String(payload?.code || '').trim().toUpperCase();
  if (!rawCode) return badRequest('请输入兑换码');
  const codeHash = await sha256Hex(rawCode);
  const record = await db.prepare('SELECT * FROM redeem_codes WHERE code_hash = ? LIMIT 1').bind(codeHash).first();
  if (!record) return badRequest('兑换码无效');
  if (record.disabled_at) return forbidden('兑换码已停用');
  if (record.expires_at && Date.parse(String(record.expires_at)) <= Date.now()) return forbidden('兑换码已过期');
  if (Number(record.used_count || 0) >= Number(record.max_uses || 0)) return forbidden('兑换码已被使用完');
  const alreadyUsed = await db.prepare('SELECT id FROM redeem_code_usages WHERE redeem_code_id = ? AND user_id = ? LIMIT 1').bind(record.id, user.id).first();
  if (alreadyUsed) return forbidden('你已使用过该兑换码');
  const requestIp = getClientIp(request);
  await db.batch([
    db.prepare('UPDATE redeem_codes SET used_count = used_count + 1 WHERE id = ?').bind(record.id),
    db.prepare('INSERT INTO redeem_code_usages (redeem_code_id, user_id, used_at, request_ip) VALUES (?, ?, CURRENT_TIMESTAMP, ?)').bind(record.id, user.id, requestIp),
  ]);
  const expiresAt = await grantMembershipDays(db, user.id, Number(record.days || 0), 'redeem', 'redeem_code', String(record.id), `兑换码 ${record.code_mask} 生效`);
  return json({ ok: true, expiresAt, codeMask: String(record.code_mask || '') });
}

async function handleCreateManualOrder(request, env, db) {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method Not Allowed' }, 405);
  const user = await getAuthenticatedUser(request, db);
  if (!user) return unauthorized('请先登录');
  await assertRateLimit(db, 'user', String(user.id), 'create-order');
  await assertRateLimit(db, 'ip', getClientIp(request) || 'unknown', 'create-order');
  const payload = await request.json();
  const channel = String(payload?.channel || '').trim().toLowerCase();
  const amountFen = Number.parseInt(String(payload?.amountFen || ''), 10);
  const screenshotUrl = String(payload?.screenshotUrl || '').trim();
  const screenshotHash = String(payload?.screenshotHash || '').trim();
  if (!['wechat', 'alipay'].includes(channel)) return badRequest('付款渠道无效');
  const days = REWARD_PRICE_DAY_RULES[amountFen];
  if (!days) return badRequest('当前仅支持5元或10元赞赏规则');
  if (screenshotHash) {
    const duplicate = await db.prepare('SELECT id, user_id, order_no FROM reward_orders WHERE screenshot_hash = ? LIMIT 1').bind(screenshotHash).first();
    if (duplicate) {
      await createRiskFlag(db, user.id, duplicate.id, 'duplicate-screenshot-hash', { duplicateOrderNo: duplicate.order_no, duplicateUserId: duplicate.user_id });
      return forbidden('检测到重复截图，请勿重复提交');
    }
  }
  const orderNo = createOrderNo();
  await db.prepare(
    `INSERT INTO reward_orders (
      order_no, user_id, channel, amount_fen, days, status, screenshot_url, screenshot_hash, ocr_status, ocr_summary, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, 'pending_review', ?, ?, 'pending', '等待OCR/人工审核', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  ).bind(orderNo, user.id, channel, amountFen, days, screenshotUrl, screenshotHash).run();
  return json({ ok: true, orderNo, amountFen, days, reviewHint: '已进入待审核队列，首期采用截图+OCR占位+人工审核发货。' });
}

async function handleMyOrders(request, env, db) {
  if (request.method !== 'GET') return json({ ok: false, error: 'Method Not Allowed' }, 405);
  const user = await getAuthenticatedUser(request, db);
  if (!user) return unauthorized('请先登录');
  const result = await db.prepare(
    'SELECT order_no, channel, amount_fen, days, status, screenshot_url, ocr_status, ocr_summary, paid_at, reviewed_at, reviewer_note, created_at FROM reward_orders WHERE user_id = ? ORDER BY id DESC LIMIT 50',
  ).bind(user.id).all();
  return json({ ok: true, orders: result?.results || [] });
}

async function handleInviteMe(request, env, db) {
  if (request.method !== 'GET') return json({ ok: false, error: 'Method Not Allowed' }, 405);
  const user = await getAuthenticatedUser(request, db);
  if (!user) return unauthorized('请先登录');
  return json({
    ok: true,
    inviteCode: String(user.invite_code || ''),
    invitedByUserId: user.invited_by_user_id ? Number(user.invited_by_user_id) : null,
    inviteRewardDeadlineAt: String(user.invite_reward_deadline_at || ''),
  });
}

async function handleAdminGenerateRedeemCodes(request, env, db) {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method Not Allowed' }, 405);
  if (!(await requireAdminToken(request, env))) return unauthorized();
  const payload = await request.json();
  const count = Math.min(Math.max(Number.parseInt(String(payload?.count || '10'), 10), 1), 200);
  const days = Math.max(Number.parseInt(String(payload?.days || '30'), 10), 1);
  const batchNo = String(payload?.batchNo || `batch-${Date.now()}`).trim();
  const createdBy = String(payload?.createdBy || 'admin').trim();
  const expiresAt = String(payload?.expiresAt || '').trim();
  const codes = [];
  const statements = [];
  for (let index = 0; index < count; index += 1) {
    const plainCode = `VIP-${crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
    const codeHash = await sha256Hex(plainCode);
    const codeMask = maskRedeemCode(plainCode);
    codes.push({ code: plainCode, codeMask, days, batchNo, expiresAt });
    statements.push(
      db.prepare(
        `INSERT INTO redeem_codes (code_hash, code_mask, batch_no, days, max_uses, used_count, expires_at, created_at, created_by)
         VALUES (?, ?, ?, ?, 1, 0, ?, CURRENT_TIMESTAMP, ?)`,
      ).bind(codeHash, codeMask, batchNo, days, expiresAt || null, createdBy),
    );
  }
  await db.batch(statements);
  return json({ ok: true, batchNo, codes });
}

async function handleAdminRedeemCodeBatches(request, env, db) {
  if (request.method !== 'GET') return json({ ok: false, error: 'Method Not Allowed' }, 405);
  if (!(await requireAdminToken(request, env))) return unauthorized();
  const result = await db.prepare(
    `SELECT batch_no,
            COUNT(*) AS total_count,
            SUM(CASE WHEN disabled_at IS NULL THEN 0 ELSE 1 END) AS disabled_count,
            SUM(used_count) AS used_count,
            MIN(created_at) AS first_created_at,
            MAX(created_at) AS last_created_at
     FROM redeem_codes
     GROUP BY batch_no
     ORDER BY MAX(created_at) DESC`,
  ).all();
  return json({ ok: true, batches: result?.results || [] });
}

async function handleAdminRedeemCodesByBatch(request, env, db) {
  if (request.method !== 'GET') return json({ ok: false, error: 'Method Not Allowed' }, 405);
  if (!(await requireAdminToken(request, env))) return unauthorized();
  const url = new URL(request.url);
  const batchNo = String(url.searchParams.get('batchNo') || '').trim();
  if (!batchNo) return badRequest('缺少 batchNo');
  const result = await db.prepare(
    `SELECT id, code_mask, batch_no, days, max_uses, used_count, expires_at, disabled_at, created_at, created_by
     FROM redeem_codes
     WHERE batch_no = ?
     ORDER BY id DESC`,
  ).bind(batchNo).all();
  return json({ ok: true, codes: result?.results || [] });
}

async function handleAdminDisableRedeemBatch(request, env, db) {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method Not Allowed' }, 405);
  if (!(await requireAdminToken(request, env))) return unauthorized();
  const payload = await request.json();
  const batchNo = String(payload?.batchNo || '').trim();
  if (!batchNo) return badRequest('缺少 batchNo');
  await db.prepare(
    `UPDATE redeem_codes
     SET disabled_at = COALESCE(disabled_at, CURRENT_TIMESTAMP)
     WHERE batch_no = ?`,
  ).bind(batchNo).run();
  return json({ ok: true, batchNo, disabled: true });
}

async function handleAdminImportRedeemCodes(request, env, db) {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method Not Allowed' }, 405);
  if (!(await requireAdminToken(request, env))) return unauthorized();
  const payload = await request.json();
  const rows = Array.isArray(payload?.codes) ? payload.codes : [];
  if (!rows.length) return badRequest('缺少 codes');
  const statements = [];
  for (const item of rows) {
    const code = String(item?.code || '').trim().toUpperCase();
    const codeHash = code ? await sha256Hex(code) : String(item?.codeHash || '').trim();
    const codeMask = String(item?.codeMask || maskRedeemCode(code)).trim();
    const batchNo = String(item?.batchNo || 'imported-batch').trim();
    const days = Math.max(Number.parseInt(String(item?.days || '30'), 10), 1);
    const expiresAt = String(item?.expiresAt || '').trim();
    const createdBy = String(item?.createdBy || 'import-api').trim();
    if (!codeHash || !codeMask) continue;
    statements.push(
      db.prepare(
        `INSERT OR IGNORE INTO redeem_codes (code_hash, code_mask, batch_no, days, max_uses, used_count, expires_at, created_at, created_by)
         VALUES (?, ?, ?, ?, 1, 0, ?, CURRENT_TIMESTAMP, ?)`,
      ).bind(codeHash, codeMask, batchNo, days, expiresAt || null, createdBy),
    );
  }
  if (!statements.length) return badRequest('没有可导入的有效兑换码');
  await db.batch(statements);
  return json({ ok: true, imported: statements.length });
}

async function handleAdminGrantMembership(request, env, db) {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method Not Allowed' }, 405);
  if (!(await requireAdminToken(request, env))) return unauthorized();
  const payload = await request.json();
  const accountId = normalizeAccountId(payload?.accountId);
  const days = Math.max(Number.parseInt(String(payload?.days || '0'), 10), 1);
  const description = String(payload?.description || '管理员手工赠送会员').trim();
  const user = await getUserByAccountId(db, accountId);
  if (!user) return badRequest('账号不存在');
  const expiresAt = await grantMembershipDays(db, user.id, days, 'admin', 'manual-grant', accountId, description);
  return json({ ok: true, accountId, days, expiresAt });
}

async function handleAdminBlockUser(request, env, db) {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method Not Allowed' }, 405);
  if (!(await requireAdminToken(request, env))) return unauthorized();
  const payload = await request.json();
  const accountId = normalizeAccountId(payload?.accountId);
  const status = String(payload?.status || 'blocked').trim();
  if (!accountId) return badRequest('缺少账号');
  await db.prepare('UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE account_id = ?').bind(status, accountId).run();
  return json({ ok: true, accountId, status });
}

async function handleAdminMemberEvents(request, env, db) {
  if (request.method !== 'GET') return json({ ok: false, error: 'Method Not Allowed' }, 405);
  if (!(await requireAdminToken(request, env))) return unauthorized();
  const url = new URL(request.url);
  const accountId = normalizeAccountId(url.searchParams.get('accountId'));
  if (!accountId) return badRequest('缺少 accountId');
  const user = await getUserByAccountId(db, accountId);
  if (!user) return badRequest('账号不存在');
  const result = await db.prepare('SELECT event_type, days, source_type, source_id, description, created_at FROM membership_events WHERE user_id = ? ORDER BY id DESC LIMIT 200').bind(user.id).all();
  return json({ ok: true, events: result?.results || [] });
}

async function handleAdminApproveOrder(request, env, db) {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method Not Allowed' }, 405);
  if (!(await requireAdminToken(request, env))) return unauthorized();
  const payload = await request.json();
  const orderNo = String(payload?.orderNo || '').trim();
  const reviewerNote = String(payload?.reviewerNote || '人工审核通过').trim();
  if (!orderNo) return badRequest('缺少订单号');
  const order = await db.prepare('SELECT * FROM reward_orders WHERE order_no = ? LIMIT 1').bind(orderNo).first();
  if (!order) return badRequest('订单不存在');
  if (String(order.status || '') === 'approved') return json({ ok: true, skipped: true, reason: '订单已审核通过' });
  if (order.external_order_no) {
    const duplicateExternal = await db.prepare('SELECT id, order_no FROM reward_orders WHERE external_order_no = ? AND id != ? LIMIT 1').bind(order.external_order_no, order.id).first();
    if (duplicateExternal) {
      await createRiskFlag(db, order.user_id, order.id, 'duplicate-external-order-no', { duplicateOrderNo: duplicateExternal.order_no, externalOrderNo: order.external_order_no });
      return forbidden('外部订单号重复，禁止重复发放');
    }
  }
  await db.prepare(
    `UPDATE reward_orders
     SET status = 'approved', ocr_status = 'reviewed', reviewed_at = CURRENT_TIMESTAMP, paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP), reviewer_note = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  ).bind(reviewerNote, order.id).run();
  const expiresAt = await grantMembershipDays(db, order.user_id, Number(order.days || 0), 'payment', 'reward_order', String(order.id), `赞赏订单 ${orderNo} 审核通过`);
  const invitee = await db.prepare('SELECT * FROM users WHERE id = ? LIMIT 1').bind(order.user_id).first();
  if (
    invitee?.invited_by_user_id
    && invitee.invite_reward_deadline_at
    && Date.parse(String(invitee.invite_reward_deadline_at)) > Date.now()
  ) {
    const paidOrderCount = await db.prepare(
      "SELECT COUNT(1) AS total FROM reward_orders WHERE user_id = ? AND status = 'approved'",
    ).bind(order.user_id).first();
    const rewardExists = await db.prepare('SELECT id FROM invite_rewards WHERE reward_order_id = ? LIMIT 1').bind(order.id).first();
    if (Number(paidOrderCount?.total || 0) === 1 && !rewardExists) {
      await grantMembershipDays(db, invitee.invited_by_user_id, Number(order.days || 0), 'invite', 'reward_order', String(order.id), `邀请奖励：下级首单赞赏 ${orderNo}`);
      await db.prepare(
        'INSERT INTO invite_rewards (inviter_user_id, invitee_user_id, reward_order_id, days, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)',
      ).bind(invitee.invited_by_user_id, invitee.id, order.id, order.days).run();
    }
  }
  return json({ ok: true, orderNo, expiresAt });
}

async function handleAdminOrders(request, env, db) {
  if (request.method !== 'GET') return json({ ok: false, error: 'Method Not Allowed' }, 405);
  if (!(await requireAdminToken(request, env))) return unauthorized();
  const url = new URL(request.url);
  const status = String(url.searchParams.get('status') || '').trim();
  const query = status
    ? 'SELECT id, order_no, user_id, channel, amount_fen, days, status, screenshot_url, screenshot_hash, ocr_status, ocr_summary, paid_at, reviewed_at, reviewer_note, created_at, updated_at FROM reward_orders WHERE status = ? ORDER BY id DESC LIMIT 100'
    : 'SELECT id, order_no, user_id, channel, amount_fen, days, status, screenshot_url, screenshot_hash, ocr_status, ocr_summary, paid_at, reviewed_at, reviewer_note, created_at, updated_at FROM reward_orders ORDER BY id DESC LIMIT 100';
  const result = status ? await db.prepare(query).bind(status).all() : await db.prepare(query).all();
  const riskFlags = await db.prepare('SELECT user_id, order_id, flag_type, details_json, created_at FROM risk_flags ORDER BY id DESC LIMIT 200').all();
  return json({ ok: true, orders: result?.results || [], riskFlags: riskFlags?.results || [] });
}

async function handleAdminUpdateOrderOcr(request, env, db) {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method Not Allowed' }, 405);
  if (!(await requireAdminToken(request, env))) return unauthorized();
  const payload = await request.json();
  const orderNo = String(payload?.orderNo || '').trim();
  const ocrStatus = String(payload?.ocrStatus || 'reviewed').trim();
  const ocrSummary = String(payload?.ocrSummary || '').trim();
  const externalOrderNo = String(payload?.externalOrderNo || '').trim();
  if (!orderNo) return badRequest('缺少订单号');
  if (externalOrderNo) {
    const duplicate = await db.prepare('SELECT id FROM reward_orders WHERE external_order_no = ? AND order_no != ? LIMIT 1').bind(externalOrderNo, orderNo).first();
    if (duplicate) return forbidden('该外部订单号已存在，不能重复绑定');
  }
  await db.prepare(
    `UPDATE reward_orders
     SET ocr_status = ?, ocr_summary = ?, external_order_no = ?, updated_at = CURRENT_TIMESTAMP
     WHERE order_no = ?`,
  ).bind(ocrStatus, ocrSummary, externalOrderNo, orderNo).run();
  return json({ ok: true, orderNo, ocrStatus, ocrSummary, externalOrderNo });
}

async function handleUploadOrderScreenshot(request, env, db) {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method Not Allowed' }, 405);
  const user = await getAuthenticatedUser(request, db);
  if (!user) return unauthorized('请先登录');
  if (!env.ORDER_SCREENSHOT_BUCKET) {
    return json({ ok: false, error: 'ORDER_SCREENSHOT_BUCKET binding missing' }, 500);
  }

  const formData = await request.formData();
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return badRequest('缺少截图文件');
  }
  if (!String(file.type || '').startsWith('image/')) {
    return badRequest('仅支持图片文件');
  }
  if (file.size <= 0 || file.size > 8 * 1024 * 1024) {
    return badRequest('截图大小需在 8MB 以内');
  }

  const ext = String(file.name || 'png').split('.').pop()?.toLowerCase() || 'png';
  const arrayBuffer = await file.arrayBuffer();
  const hash = await sha256Hex(new Uint8Array(arrayBuffer));
  const duplicate = await db.prepare('SELECT id, user_id, order_no FROM reward_orders WHERE screenshot_hash = ? LIMIT 1').bind(hash).first();
  if (duplicate) {
    await createRiskFlag(db, user.id, duplicate.id, 'duplicate-upload-hash', { duplicateOrderNo: duplicate.order_no, duplicateUserId: duplicate.user_id });
  }
  const key = `orders/${user.id}/${new Date().toISOString().slice(0, 10)}/${hash}.${ext}`;

  await env.ORDER_SCREENSHOT_BUCKET.put(key, arrayBuffer, {
    httpMetadata: {
      contentType: file.type || 'application/octet-stream',
    },
  });

  return json({
    ok: true,
    key,
    hash,
    url: `/api/order/screenshot/${encodeURIComponent(key)}`,
  });
}

async function handleGetOrderScreenshot(request, env, db, key) {
  const user = await getAuthenticatedUser(request, db);
  if (!user) return unauthorized('请先登录');
  if (!env.ORDER_SCREENSHOT_BUCKET) {
    return json({ ok: false, error: 'ORDER_SCREENSHOT_BUCKET binding missing' }, 500);
  }
  const object = await env.ORDER_SCREENSHOT_BUCKET.get(key);
  if (!object) {
    return json({ ok: false, error: '截图不存在' }, 404);
  }
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('cache-control', 'private, max-age=60');
  return new Response(object.body, { status: 200, headers });
}

function parseRuntimeRow(row) {
  if (!row?.runtime_json) return null;
  try {
    return JSON.parse(String(row.runtime_json));
  } catch {
    return null;
  }
}

function toIsoString(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString();
}

function normalizeSourceBaseUrl(value) {
  const base = String(value || '').trim().replace(/\/+$/, '');
  return base;
}

function resolveGeneratedSourceBaseUrl(env) {
  return normalizeSourceBaseUrl(env.GENERATED_SOURCE_BASE_URL);
}

function joinGeneratedSourceUrl(baseUrl, fileName) {
  if (!baseUrl) return '';
  return `${baseUrl}/generated/${fileName}`;
}

function resolveRuntimeSyncSource(env) {
  const explicit = String(env.RUNTIME_SYNC_SOURCE || '').trim();
  if (explicit) return explicit;

  const generatedBaseUrl = resolveGeneratedSourceBaseUrl(env);
  return joinGeneratedSourceUrl(generatedBaseUrl, 'funds-runtime.json') || DEFAULT_RUNTIME_SYNC_SOURCE;
}

function resolvePremiumCompareSource(env) {
  const explicit = String(env.PREMIUM_COMPARE_SOURCE || '').trim();
  if (explicit) return explicit;

  const generatedBaseUrl = resolveGeneratedSourceBaseUrl(env);
  return joinGeneratedSourceUrl(generatedBaseUrl, 'premium-compare.json');
}

function resolveMinSyncIntervalMinutes(env) {
  const raw = Number.parseInt(String(env.RUNTIME_SYNC_MIN_INTERVAL_MINUTES || DEFAULT_SYNC_INTERVAL_MINUTES), 10);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_SYNC_INTERVAL_MINUTES;
  return Math.min(raw, MAX_SYNC_INTERVAL_MINUTES);
}

async function getLatestRun(db) {
  return (
    (await db      .prepare('SELECT id, synced_at, fund_count, source_url FROM runtime_runs ORDER BY id DESC LIMIT 1')
      .first()) || null
  );
}

async function getLatestSyncedAt(db) {
  const latest = await getLatestRun(db);
  return {
    syncedAt: latest?.synced_at ? String(latest.synced_at) : '',
    fundCount: Number(latest?.fund_count || 0),
    sourceUrl: latest?.source_url ? String(latest.source_url) : '',
  };
}

async function loadJsonFromSource(sourceUrl) {
  const response = await fetch(sourceUrl, {
    headers: {
      accept: 'application/json',
      'user-agent': 'lof-premium-rate-web-worker/1.0',
    },
  });

  if (!response.ok) {
    throw new Error(`Upstream fetch failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function loadRuntimePayload(sourceUrl) {
  const payload = await loadJsonFromSource(sourceUrl);
  const funds = Array.isArray(payload?.funds) ? payload.funds.filter((item) => item && item.code) : [];
  const syncedAt =
    toIsoString(payload?.syncedAt)
    || toIsoString(payload?.updatedAt)
    || toIsoString(payload?.generatedAt)
    || new Date().toISOString();

  if (!funds.length) {
    throw new Error('Upstream payload did not contain any funds');
  }

  return { syncedAt, funds };
}

async function upsertRuntimeSnapshot(db, sourceUrl, payload) {
  const { syncedAt, funds } = payload;
  const statements = [
    db.prepare('INSERT INTO runtime_runs (synced_at, fund_count, source_url) VALUES (?, ?, ?)').bind(
      syncedAt,
      funds.length,
      sourceUrl,
    ),
  ];

  for (const fund of funds) {
    const runtimeJson = JSON.stringify(fund);
    statements.push(
      db.prepare(
        `INSERT INTO latest_fund_runtime (code, synced_at, runtime_json)
         VALUES (?, ?, ?)
         ON CONFLICT(code) DO UPDATE SET
           synced_at = excluded.synced_at,
           runtime_json = excluded.runtime_json`,
      ).bind(String(fund.code), syncedAt, runtimeJson),
    );
  }

  await db.batch(statements);
  return {
    syncedAt,
    fundCount: funds.length,
    sourceUrl,
  };
}

async function syncRuntimeFromSource(db, env, options = {}) {
  const sourceUrl = resolveRuntimeSyncSource(env);
  const latestRun = await getLatestRun(db);
  const now = Date.now();
  const minIntervalMinutes = resolveMinSyncIntervalMinutes(env);
  const latestSyncedMs = latestRun?.synced_at ? Date.parse(String(latestRun.synced_at)) : Number.NaN;
  const dueToInterval =
    Number.isNaN(latestSyncedMs) || now - latestSyncedMs >= minIntervalMinutes * 60 * 1000;

  if (!options.force && latestRun && !dueToInterval) {
    return {
      ok: true,
      skipped: true,
      reason: `Minimum sync interval (${minIntervalMinutes} min) not reached`,
      syncedAt: String(latestRun.synced_at || ''),
      fundCount: Number(latestRun.fund_count || 0),
      sourceUrl,
    };
  }

  const payload = await loadRuntimePayload(sourceUrl);
  const latestFundCount = Number(latestRun?.fund_count || 0);
  if (!options.force && latestFundCount > 0 && payload.funds.length < latestFundCount) {
    return {
      ok: true,
      skipped: true,
      reason: `Upstream fund count (${payload.funds.length}) smaller than current (${latestFundCount})`,
      syncedAt: String(latestRun?.synced_at || ''),
      fundCount: latestFundCount,
      sourceUrl,
    };
  }

  if (!options.force && latestRun && String(latestRun.synced_at || '') === payload.syncedAt) {
    return {
      ok: true,
      skipped: true,
      reason: 'Upstream syncedAt unchanged',
      syncedAt: payload.syncedAt,
      fundCount: Number(latestRun.fund_count || payload.funds.length || 0),
      sourceUrl,
    };
  }

  return {
    ok: true,
    skipped: false,
    ...(await upsertRuntimeSnapshot(db, sourceUrl, payload)),
  };
}

// 手动溢价率数据保存端点
async function handleManualPremiumEntry(request, env, db) {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method Not Allowed' }, 405);

  const syncToken = String(env.RUNTIME_SYNC_TOKEN || '').trim();
  const authorization = String(request.headers.get('authorization') || '').trim();
  const bearerToken = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';

  if (!syncToken || bearerToken !== syncToken) {
    return json({ ok: false, error: 'Unauthorized' }, 401);
  }

  try {
    const data = await request.json();
    
    // 验证必要字段
    if (!data || !data.code || !data.date || data.premiumRate === undefined) {
      return json({ ok: false, error: 'Missing required fields: code, date, premiumRate' }, 400);
    }

    const code = String(data.code).trim();
    const date = String(data.date).trim();
    const premiumRate = Number(data.premiumRate);
    const provider = String(data.provider || 'manual-cloudflare').trim();
    const sourceUrl = String(data.sourceUrl || '').trim();
    const status = String(data.status || 'manual-input').trim();
    const time = String(data.time || '15:00:00').trim();

    // 验证日期格式
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return json({ ok: false, error: 'Invalid date format. Expected YYYY-MM-DD' }, 400);
    }

    // 验证溢价率是否为数字
    if (isNaN(premiumRate)) {
      return json({ ok: false, error: 'premiumRate must be a number' }, 400);
    }

    // 保存手动记录到数据库
    const statements = [
      db.prepare(
        `INSERT OR REPLACE INTO manual_premium_entries 
         (code, date, provider, premium_rate, source_url, status, time, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      ).bind(code, date, provider, premiumRate, sourceUrl, status, time),
    ];

    await db.batch(statements);

    return json({
      ok: true,
      message: 'Manual premium entry saved successfully',
      data: {
        code,
        date,
        provider,
        premiumRate,
        sourceUrl,
        status,
        time
      }
    });
  } catch (error) {
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error saving manual premium entry',
      },
      500,
    );
  }
}

// 获取手动记录数据
async function getManualPremiumEntries(db, date, provider) {
  let query = 'SELECT code, date, provider, premium_rate, source_url, status, time, created_at, updated_at FROM manual_premium_entries WHERE 1=1';
  const params = [];

  if (date) {
    query += ' AND date = ?';
    params.push(date);
  }

  if (provider) {
    query += ' AND provider = ?';
    params.push(provider);
  }

  query += ' ORDER BY code';

  const result = await db.prepare(query).bind(...params).all();
  return result.results || [];
}

async function handleGetManualPremiumEntries(request, env, db) {
  if (request.method !== 'GET') return json({ ok: false, error: 'Method Not Allowed' }, 405);

  const syncToken = String(env.RUNTIME_SYNC_TOKEN || '').trim();
  const authorization = String(request.headers.get('authorization') || '').trim();
  const bearerToken = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';

  if (!syncToken || bearerToken !== syncToken) {
    return json({ ok: false, error: 'Unauthorized' }, 401);
  }

  try {
    const url = new URL(request.url);
    const date = url.searchParams.get('date');
    const provider = url.searchParams.get('provider');

    const entries = await getManualPremiumEntries(db, date, provider);
    
    return json({
      ok: true,
      count: entries.length,
      entries: entries.map(entry => ({
        code: entry.code,
        date: entry.date,
        provider: entry.provider,
        premiumRate: entry.premium_rate,
        sourceUrl: entry.source_url,
        status: entry.status,
        time: entry.time,
        createdAt: entry.created_at,
        updatedAt: entry.updated_at
      }))
    });
  } catch (error) {
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error fetching manual premium entries',
      },
      500,
    );
  }
}

// 处理溢价率对比请求
async function handlePremiumCompareRequest(request, env, db) {
  try {
    const params = new URL(request.url).searchParams;
    const force = params.get('force') === 'true';
    const liveFetchLimit = Number.parseInt(String(params.get('liveFetchLimit') || ''), 10);
    const payload = await buildPremiumComparePayload(db, {
      force,
      liveFetchLimit: Number.isFinite(liveFetchLimit) ? liveFetchLimit : undefined,
    });
    return json({ ok: true, ...payload });
  } catch (error) {
    const fallbackSource = resolvePremiumCompareSource(env);
    if (fallbackSource) {
      try {
        const payload = await loadJsonFromSource(fallbackSource);
        return json({ ok: true, ...payload, fallbackSource, degraded: true });
      } catch {
        // ignore fallback error and return primary error below
      }
    }
    return json({ ok: false, error: error.message }, 500);
  }
}

// 处理手动同步请求
async function handleSyncRequest(request, env, db) {
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'Method Not Allowed' }, 405);
  }

  const syncToken = String(env.RUNTIME_SYNC_TOKEN || '').trim();
  const authorization = String(request.headers.get('authorization') || '').trim();
  const bearerToken = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';

  if (!syncToken || bearerToken !== syncToken) {
    return json({ ok: false, error: 'Unauthorized' }, 401);
  }

  try {
    const url = new URL(request.url);
    const force = url.searchParams.get('force') === 'true';
    const mode = String(url.searchParams.get('mode') || '').trim();
    const useSourceSync = mode === 'source';
    const batchSize = Number.parseInt(String(url.searchParams.get('batchSize') || ''), 10);

    let result;
    if (useSourceSync) {
      // 默认使用全量 runtime 源同步（覆盖所有基金与详情字段）
      result = await syncRuntimeFromSource(db, env, { force });
    } else {
      // 默认使用 Worker 自主抓取引擎（完全独立自主）
      result = await syncAllFunds(db, { force, batchSize: Number.isFinite(batchSize) ? batchSize : undefined });
    }

    return json(result);
  } catch (error) {
    return json(
      { ok: false, error: error.message },
      500
    );
  }
}

export default {
  async fetch(request, env) {
    const finish = (response) => withCors(response, request);
    if (request.method === 'OPTIONS') return finish(json({ ok: true }, 204, request));

    const url = new URL(request.url);
    const db = env.RUNTIME_DB;

    if (url.pathname === '/api/auth/register') {
      return finish(await handleRegister(request, env, db));
    }

    if (url.pathname === '/api/auth/login') {
      return finish(await handleLogin(request, env, db));
    }

    if (url.pathname === '/api/auth/authing-login') {
      return finish(await handleAuthingLogin(request, env, db));
    }

    if (url.pathname === '/api/auth/send-code') {
      return finish(await handleSendCode(request, env, db));
    }

    if (url.pathname === '/api/auth/code-login') {
      return finish(await handleCodeLogin(request, env, db));
    }

    if (url.pathname === '/api/auth/logout') {
      return finish(await handleLogout(request, env, db));
    }

    if (url.pathname === '/api/auth/me') {
      return finish(await handleAuthMe(request, env, db));
    }

    if (url.pathname === '/api/member/status') {
      return finish(await handleMemberStatus(request, env, db));
    }

    if (url.pathname === '/api/member/events') {
      return finish(await handleMemberEvents(request, env, db));
    }

    if (url.pathname === '/api/redeem/apply') {
      return finish(await handleRedeemApply(request, env, db));
    }

    if (url.pathname === '/api/order/create-manual') {
      return finish(await handleCreateManualOrder(request, env, db));
    }

    if (url.pathname === '/api/order/my') {
      return finish(await handleMyOrders(request, env, db));
    }

    if (url.pathname === '/api/order/upload-screenshot') {
      return finish(await handleUploadOrderScreenshot(request, env, db));
    }

    if (url.pathname.startsWith('/api/order/screenshot/')) {
      const key = decodeURIComponent(url.pathname.slice('/api/order/screenshot/'.length));
      return finish(await handleGetOrderScreenshot(request, env, db, key));
    }

    if (url.pathname === '/api/invite/me') {
      return finish(await handleInviteMe(request, env, db));
    }

    if (url.pathname === '/api/admin/redeem-codes/generate') {
      return finish(await handleAdminGenerateRedeemCodes(request, env, db));
    }

    if (url.pathname === '/api/admin/redeem-codes/batches') {
      return finish(await handleAdminRedeemCodeBatches(request, env, db));
    }

    if (url.pathname === '/api/admin/redeem-codes/list') {
      return finish(await handleAdminRedeemCodesByBatch(request, env, db));
    }

    if (url.pathname === '/api/admin/redeem-codes/disable-batch') {
      return finish(await handleAdminDisableRedeemBatch(request, env, db));
    }

    if (url.pathname === '/api/admin/redeem-codes/import') {
      return finish(await handleAdminImportRedeemCodes(request, env, db));
    }

    if (url.pathname === '/api/admin/member/grant') {
      return finish(await handleAdminGrantMembership(request, env, db));
    }

    if (url.pathname === '/api/admin/user/block') {
      return finish(await handleAdminBlockUser(request, env, db));
    }

    if (url.pathname === '/api/admin/member/events') {
      return finish(await handleAdminMemberEvents(request, env, db));
    }

    if (url.pathname === '/api/admin/order/approve') {
      return finish(await handleAdminApproveOrder(request, env, db));
    }

    if (url.pathname === '/api/admin/orders') {
      return finish(await handleAdminOrders(request, env, db));
    }

    if (url.pathname === '/api/admin/order/ocr') {
      return finish(await handleAdminUpdateOrderOcr(request, env, db));
    }

    // 手动溢价率数据API端点
    if (url.pathname === '/api/manual/premium-entry') {
      return finish(await handleManualPremiumEntry(request, env, db));
    }

    if (url.pathname === '/api/manual/premium-entries') {
      return finish(await handleGetManualPremiumEntries(request, env, db));
    }

    if (url.pathname === '/api/runtime/premium-compare') {
      if (request.method !== 'GET') return finish(json({ ok: false, error: 'Method Not Allowed' }, 405, request));
      return finish(await handlePremiumCompareRequest(request, env, db));
    }

    if (url.pathname === '/health') {
      const latest = db ? await getLatestSyncedAt(db) : { syncedAt: '', fundCount: 0, sourceUrl: '' };
      return finish(json({
        ok: true,
        runtimeDbAvailable: Boolean(db),
        ...latest,
        runtimeSyncSource: resolveRuntimeSyncSource(env),
        premiumCompareSource: resolvePremiumCompareSource(env),
        generatedSourceBaseUrl: resolveGeneratedSourceBaseUrl(env),
        minSyncIntervalMinutes: resolveMinSyncIntervalMinutes(env),
      }, 200, request));
    }

    if (!db) {
      return finish(json({ ok: false, error: 'RUNTIME_DB binding missing' }, 500, request));
    }

    if (url.pathname === '/internal/sync/runtime') {
      return finish(await handleSyncRequest(request, env, db));
    }

    if (request.method !== 'GET') return finish(json({ ok: false, error: 'Method Not Allowed' }, 405, request));

    if (url.pathname === '/api/runtime/all') {
      const latest = await getLatestSyncedAt(db);
      const result = await db.prepare('SELECT code, runtime_json FROM latest_fund_runtime ORDER BY code').all();
      const user = await getAuthenticatedUser(request, db);
      const membership = user?.id ? await getMembershipByUserId(db, user.id) : null;
      const isMember = isMembershipActive(membership?.member_expires_at);
      const funds = (result?.results || [])
        .map(parseRuntimeRow)
        .filter((item) => item && item.code)
        .map((item) => (isMember ? item : sanitizeFundForGuest(item)));
      return finish(json({ ok: true, syncedAt: latest.syncedAt, fundCount: funds.length, funds, stateByCode: {} }, 200, request));
    }

    if (url.pathname === '/api/training/metrics') {
      try {
        const code = String(url.searchParams.get('code') || '').trim();
        if (code) {
          const metric = await getTrainingMetricsByCode(db, code);
          if (!metric) return finish(json({ ok: false, error: 'Training metrics not found', code }, 404, request));
          return finish(json({ ok: true, metrics: [metric] }, 200, request));
        }
        const metrics = await getAllTrainingMetrics(db);
        return finish(json({ ok: true, metrics }, 200, request));
      } catch (error) {
        return finish(json({ ok: false, error: error.message }, 500, request));
      }
    }

    if (url.pathname === '/api/runtime/latest') {
      const code = String(url.searchParams.get('code') || '').trim();
      if (!code) return finish(json({ ok: false, error: 'Missing query parameter: code' }, 400, request));
      const user = await getAuthenticatedUser(request, db);
      const membership = user ? await getMembershipByUserId(db, user.id) : null;
      if (!isMembershipActive(membership?.member_expires_at)) {
        return finish(forbidden('非会员暂无权限查看基金详情'));
      }
      const row = await db
        .prepare('SELECT synced_at, runtime_json FROM latest_fund_runtime WHERE code = ?')
        .bind(code)
        .first();
      if (!row) return finish(json({ ok: false, error: 'Fund code not found', code }, 404, request));
      const fund = parseRuntimeRow(row);
      if (!fund) return finish(json({ ok: false, error: 'Invalid runtime_json payload', code }, 500, request));
      fund.syncedAt = String(row.synced_at || '');
      return finish(json({ ok: true, fund }, 200, request));
    }

    if (url.pathname === '/api/runtime/oil') {
      const placeholders = OIL_CODES.map(() => '?').join(',');
      const query = `SELECT code, synced_at, runtime_json FROM latest_fund_runtime WHERE code IN (${placeholders}) ORDER BY code`;
      const result = await db.prepare(query).bind(...OIL_CODES).all();
      const funds = (result?.results || [])
        .map((row) => {
          const runtime = parseRuntimeRow(row);
          if (!runtime) return null;
          runtime.syncedAt = String(row.synced_at || '');
          return runtime;
        })
        .filter((item) => item && item.code);
      return finish(json({ ok: true, total: funds.length, funds }, 200, request));
    }

    return finish(json({ ok: false, error: 'Not Found' }, 404, request));
  },

  async scheduled(_event, env, ctx) {
    if (!env.RUNTIME_DB) return;

    ctx.waitUntil(
      (async () => {
        try {
          // 优先从 Pages 静态 JSON 拉取完整数据（包含 navHistory、purchaseLimit、训练参数等）
          const result = await syncRuntimeFromSource(env.RUNTIME_DB, env, { force: false });
          if (result.ok) {
            console.log('[Scheduled] Source sync completed:', result.skipped ? `skipped: ${result.reason}` : `synced ${result.fundCount} funds`);
          } else {
            console.error('[Scheduled] Source sync failed, falling back to self-fetch engine');
            // 回退到自主抓取引擎
            const fallback = await syncAllFunds(env.RUNTIME_DB, { force: false, batchSize: 12 });
            console.log('[Scheduled] Fallback result:', fallback.ok ? `synced ${fallback.syncedBatchCount} funds` : fallback.error);
          }
        } catch (error) {
          console.error('[Scheduled] Sync error:', error);
        }
      })(),
    );
  },
};
