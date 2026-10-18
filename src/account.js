const SESSION_KEY = 'pathwise-auth-session-v1';
const PENDING_STATE_PREFIX = 'pathwise-pending-account-state-v1:';
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, '');
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export function isAccountStorageConfigured() {
  return Boolean(supabaseUrl && supabaseKey);
}

async function readSession() {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  if (fragment.has('error')) {
    window.history.replaceState({}, '', `${window.location.pathname}${window.location.search}`);
    throw new Error(fragment.get('error_description') || fragment.get('error'));
  }
  const accessToken = fragment.get('access_token');
  const refreshToken = fragment.get('refresh_token');
  if (accessToken && refreshToken) {
    window.history.replaceState({}, '', `${window.location.pathname}${window.location.search}`);
    const user = await request('/auth/v1/user', { accessToken });
    const session = normalizedSession({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: fragment.get('expires_in') || 3600,
      expires_at: Number(fragment.get('expires_at')) || undefined,
      user,
    });
    saveSession(session);
    return session;
  }
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY));
    return session?.access_token && session?.refresh_token && session?.user?.id ? session : null;
  } catch (error) {
    console.warn('Could not read the saved account session.', error);
    return null;
  }
}

function saveSession(session) {
  if (session?.access_token && session?.refresh_token && session?.user?.id) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } else {
    localStorage.removeItem(SESSION_KEY);
  }
}

async function request(path, { method = 'GET', body, accessToken, prefer } = {}) {
  const response = await fetch(`${supabaseUrl}${path}`, {
    method,
    headers: {
      apikey: supabaseKey,
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(prefer ? { Prefer: prefer } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let result = {};
  if (text) {
    try {
      result = JSON.parse(text);
    } catch {
      throw new Error(`The account service returned an invalid response (HTTP ${response.status}).`);
    }
  }
  if (!response.ok) {
    const message = result.msg || result.message || result.error_description || result.error || result.details;
    throw new Error(typeof message === 'string' ? message : `The account service returned HTTP ${response.status}.`);
  }
  return result;
}

function normalizedSession(result) {
  if (!result.access_token || !result.refresh_token || !result.user?.id) {
    throw new Error('The account service did not return a complete sign-in session.');
  }
  return {
    ...result,
    expires_at: result.expires_at || Math.floor(Date.now() / 1000) + Number(result.expires_in || 3600),
  };
}

export async function signUp(email, password, name) {
  const result = await request('/auth/v1/signup', {
    method: 'POST',
    body: { email, password, data: { display_name: name } },
  });
  if (!result.access_token) return { requiresEmailConfirmation: true };
  const session = normalizedSession(result);
  saveSession(session);
  return { session, requiresEmailConfirmation: false };
}

export async function signIn(email, password) {
  const result = await request('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email, password },
  });
  const session = normalizedSession(result);
  saveSession(session);
  return session;
}

export async function getAccountSession() {
  let session = await readSession();
  if (!session) return null;
  if (Number(session.expires_at) > Math.floor(Date.now() / 1000) + 60) return session;
  try {
    const result = await request('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      body: { refresh_token: session.refresh_token },
    });
    session = normalizedSession(result);
    saveSession(session);
    return session;
  } catch (error) {
    saveSession(null);
    throw error;
  }
}

export async function signOut(session) {
  try {
    await request('/auth/v1/logout', { method: 'POST', accessToken: session?.access_token });
  } finally {
    saveSession(null);
  }
}

export async function loadAccountState(session) {
  const query = new URLSearchParams({
    select: 'state',
    user_id: `eq.${session.user.id}`,
  });
  const rows = await request(`/rest/v1/learning_states?${query}`, { accessToken: session.access_token });
  if (!Array.isArray(rows)) throw new Error('The account service returned an unexpected learning-state response.');
  return rows[0]?.state ?? null;
}

export function loadPendingAccountState(userId) {
  try {
    const pending = localStorage.getItem(`${PENDING_STATE_PREFIX}${userId}`);
    return pending ? JSON.parse(pending) : null;
  } catch (error) {
    throw new Error(`Could not read changes waiting to sync: ${error.message}`);
  }
}

export function savePendingAccountState(userId, state) {
  try {
    localStorage.setItem(`${PENDING_STATE_PREFIX}${userId}`, JSON.stringify(state));
  } catch (error) {
    throw new Error(`Could not preserve changes waiting to sync: ${error.message}`);
  }
}

export function clearPendingAccountState(userId) {
  localStorage.removeItem(`${PENDING_STATE_PREFIX}${userId}`);
}

export async function saveAccountState(session, state) {
  const query = new URLSearchParams({ on_conflict: 'user_id' });
  await request(`/rest/v1/learning_states?${query}`, {
    method: 'POST',
    accessToken: session.access_token,
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: {
      user_id: session.user.id,
      state,
      updated_at: new Date().toISOString(),
    },
  });
}
