import './styles.css';
import {
  getAccountSession,
  isAccountStorageConfigured,
  loadAccountState,
  loadPendingAccountState,
  saveAccountState,
  savePendingAccountState,
  clearPendingAccountState,
  signIn,
  signOut,
  signUp,
} from './account.js';

const STORAGE_KEY = 'pathwise-learning-state-v1';
const configuredApiUrl = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');
const API_BASE_URL = configuredApiUrl || (import.meta.env.DEV ? window.location.origin : '');
const API_GENERATE_PATH_URL = API_BASE_URL ? `${API_BASE_URL}/api/generate-path` : '';
const defaultState = {
  name: 'Alex Morgan',
  streakDays: [],
  streakCircle: { name: 'Curiosity Club', friends: [] },
  paths: [{
    id: 'path-default',
    skill: 'Product design',
    level: 'Comfortable',
    weeklyHours: 4,
    lessons: [
      { title: 'Map the product design landscape', detail: 'Core concepts · UX, UI, and product thinking', minutes: 35, done: true },
      { title: 'Learn to research real user needs', detail: 'Research methods · Interviews and synthesis', minutes: 45, done: true },
      { title: 'Turn insights into clear user flows', detail: 'Information architecture · Flows and structure', minutes: 40, done: false },
      { title: 'Design a useful, polished interface', detail: 'Interface design · Layout, type, and components', minutes: 50, done: false },
      { title: 'Prototype, test, and improve', detail: 'Practice · Usability testing and iteration', minutes: 45, done: false },
      { title: 'Ship a case study you can share', detail: 'Capstone project · Present your decisions', minutes: 60, done: false },
    ],
  }],
  activePathId: 'path-default',
  reward: { title: 'A weekend pottery class', target: 8 },
  plan: 'free',
};

let hasSavedLocalState = false;

function normalizeState(saved) {
  if (saved && saved.reward) {
    const savedPaths = Array.isArray(saved.paths)
      ? saved.paths
      : saved.path && Array.isArray(saved.path.lessons)
        ? [{ ...saved.path, id: 'path-default' }]
        : defaultState.paths;
    const paths = savedPaths.filter((path) => path && Array.isArray(path.lessons)).map((path, index) => ({ ...path, id: path.id || `path-${index + 1}` }));
    const validPaths = paths.length ? paths : structuredClone(defaultState.paths);
    const savedState = { ...saved };
    delete savedState.path;
    return {
      ...defaultState,
      ...savedState,
      paths: validPaths,
      activePathId: validPaths.some((path) => path.id === saved.activePathId) ? saved.activePathId : validPaths[0].id,
      plan: saved.plan === 'plus' ? 'plus' : 'free',
    };
  }
  return structuredClone(defaultState);
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved) {
      hasSavedLocalState = true;
      return normalizeState(saved);
    }
  } catch (error) {
    console.warn('Could not read saved learning progress.', error);
  }
  return structuredClone(defaultState);
}

let state = loadState();
let activeView = 'home';
let toastTimer;
let authSession = null;
let authGeneration = 0;
let accountSaveTimer;
let accountSaveRevision = 0;
let accountSaveQueue = Promise.resolve();
let saveStatus = 'Saved on this device';
const app = document.querySelector('#app');

function saveState() {
  let savedLocally = true;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    hasSavedLocalState = true;
  } catch (error) {
    showToast('Could not save on this device. Check browser storage settings.');
    savedLocally = false;
  }
  if (authSession) {
    const revision = ++accountSaveRevision;
    try {
      savePendingAccountState(authSession.user.id, state);
    } catch (error) {
      saveStatus = 'Saved on this device';
      updateSaveStatus();
      showToast(error.message);
      return savedLocally;
    }
    clearTimeout(accountSaveTimer);
    saveStatus = 'Saving to your account…';
    updateSaveStatus();
    accountSaveTimer = setTimeout(() => {
      const session = authSession;
      const snapshot = structuredClone(state);
      accountSaveQueue = accountSaveQueue.then(async () => {
        if (authSession?.user.id !== session.user.id || revision !== accountSaveRevision) return;
        const refreshedSession = await getAccountSession();
        if (!refreshedSession || authSession?.user.id !== refreshedSession.user.id || revision !== accountSaveRevision) return;
        authSession = refreshedSession;
        await saveAccountState(refreshedSession, snapshot);
        if (authSession?.user.id === refreshedSession.user.id && revision === accountSaveRevision) {
          clearPendingAccountState(refreshedSession.user.id);
          saveStatus = 'Synced to your account';
          updateSaveStatus();
        }
      }).catch((error) => {
        if (authSession?.user.id === session.user.id && revision === accountSaveRevision) {
          saveStatus = 'Account sync issue';
          updateSaveStatus();
          showToast(`Your progress could not be synced: ${error.message}`);
        }
      });
    }, 500);
  }
  return savedLocally;
}

function updateSaveStatus() {
  const status = document.querySelector('#save-status');
  if (status) status.textContent = saveStatus;
}

function safeText(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function getActivePath() {
  return state.paths.find((path) => path.id === state.activePathId) || state.paths[0];
}

async function readJsonResponse(response) {
  const body = await response.text();
  if (!body.trim()) {
    if (response.status === 404) {
      throw new Error(API_BASE_URL
        ? 'The video search API endpoint was not found. Check the VITE_API_BASE_URL repository variable and redeploy the website.'
        : 'Video search is not available on this server yet (HTTP 404). Stop the existing app process and start it again with npm run dev.');
    }
    throw new Error(`The video search service returned an empty response (HTTP ${response.status}). Restart the app and try again.`);
  }

  let result;
  try {
    result = JSON.parse(body);
  } catch {
    throw new Error(`The video search service returned an invalid response (HTTP ${response.status}). Restart the app and try again.`);
  }
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('The video search service returned an unexpected response. Restart the app and try again.');
  }
  return result;
}

function getProgress() {
  const path = getActivePath();
  const done = path.lessons.filter((lesson) => lesson.done).length;
  return { done, total: path.lessons.length, percent: path.lessons.length ? Math.round(done / path.lessons.length * 100) : 0 };
}

function getNextLesson() {
  const lessons = getActivePath().lessons;
  return lessons.find((lesson) => !lesson.done) || lessons.at(-1);
}

function getYouTubeVideoId(value) {
  try {
    const url = new URL(value);
    if (url.hostname === 'youtu.be' || url.hostname === 'www.youtu.be') return url.pathname.slice(1).split('/')[0];
    if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(url.hostname)) {
      return url.searchParams.get('v') || url.pathname.match(/\/(?:embed|shorts)\/([^/?]+)/)?.[1] || '';
    }
  } catch {
    return '';
  }
  return '';
}

function getResourceType(source) {
  return source.type || (source.videoId ? 'video' : 'article');
}

function getHttpUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

function getDayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function shiftDay(dayKey, offset) {
  const [year, month, day] = dayKey.split('-').map(Number);
  return getDayKey(new Date(year, month - 1, day + offset, 12));
}

function getCurrentStreak(days) {
  const loggedDays = new Set(days || []);
  let cursor = getDayKey();
  if (!loggedDays.has(cursor)) {
    cursor = shiftDay(cursor, -1);
    if (!loggedDays.has(cursor)) return 0;
  }
  let count = 0;
  while (loggedDays.has(cursor)) {
    count += 1;
    cursor = shiftDay(cursor, -1);
  }
  return count;
}

function getLongestStreak(days) {
  const orderedDays = [...new Set(days || [])].sort();
  let current = 0;
  let longest = 0;
  let previousDay = '';
  for (const day of orderedDays) {
    current = previousDay && shiftDay(previousDay, 1) === day ? current + 1 : 1;
    longest = Math.max(longest, current);
    previousDay = day;
  }
  return longest;
}

function getGroupStreak() {
  const people = [{ days: state.streakDays || [] }, ...(state.streakCircle?.friends || [])];
  const sharedDays = (state.streakDays || []).filter((day) => people.every((person) => (person.days || []).includes(day)));
  return getCurrentStreak(sharedDays);
}

function recordToday(days) {
  const today = getDayKey();
  if (!days.includes(today)) days.push(today);
}

async function shareStreakUpdate() {
  const friends = state.streakCircle?.friends || [];
  const members = [{ name: state.name, days: state.streakDays || [] }, ...friends];
  const checkIns = members.map((member) => `${member.name}: ${(member.days || []).includes(getDayKey()) ? 'checked in' : 'not checked in'}`).join('\n');
  const message = `${state.streakCircle?.name || 'Curiosity Club'}\n${getGroupStreak()} day group learning streak\n${checkIns}`;
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Our learning streak', text: message });
    } else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(message);
      showToast('Streak update copied to your clipboard.');
    } else {
      window.prompt('Copy your group streak update:', message);
    }
  } catch (error) {
    if (error.name === 'AbortError') return;
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(message);
      showToast('Streak update copied to your clipboard.');
    } else {
      showToast('Could not share this update from your browser.');
    }
  }
}

function getWeeks() {
  const path = getActivePath();
  const lessonHours = path.lessons.reduce((sum, lesson) => sum + lesson.minutes, 0) / 60;
  return Math.max(1, Math.ceil(lessonHours / Math.max(1, Number(path.weeklyHours) || 1)));
}

function render() {
  const path = getActivePath();
  const progress = getProgress();
  const next = getNextLesson();
  const firstName = state.name.split(' ')[0];
  const currentStreak = getCurrentStreak(state.streakDays);
  const longestStreak = getLongestStreak(state.streakDays);
  const today = getDayKey();
  const friends = state.streakCircle?.friends || [];
  const rewardProgress = Math.min(progress.done, Number(state.reward.target));
  const rewardPercent = Math.min(100, Math.round(rewardProgress / Math.max(1, Number(state.reward.target)) * 100));
  const date = new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
  const nextLessonIndex = path.lessons.findIndex((lesson) => !lesson.done);
  const lessonPathMarkup = path.lessons.map((lesson, index) => `
    <div class="path-stop ${index % 2 ? 'right' : 'left'}">
      <button class="path-node ${lesson.done ? 'complete' : ''} ${index === nextLessonIndex ? 'current' : ''}" data-action="open-lesson" data-index="${index}" aria-haspopup="dialog" aria-label="Open lesson ${index + 1}: ${safeText(lesson.title)}">
        <span class="path-node-circle">${lesson.done ? '✓' : index + 1}</span>
        <span class="path-node-title">${safeText(lesson.title)}</span>
        <span class="path-node-meta">${lesson.minutes} min${lesson.done ? ' · complete' : index === nextLessonIndex ? ' · start here' : ''}</span>
      </button>
    </div>`).join('');
  const trailCommands = path.lessons.slice(0, -1).map((_, index) => {
    const startX = index % 2 ? 75 : 25;
    const endX = index % 2 ? 25 : 75;
    const startY = 62 + index * 124;
    const endY = startY + 124;
    return `M ${startX} ${startY} C ${startX} ${startY + 52}, ${endX} ${endY - 52}, ${endX} ${endY}`;
  }).join(' ');
  const lessonPathTrail = trailCommands
    ? `<svg class="path-trail" viewBox="0 0 100 ${path.lessons.length * 124}" preserveAspectRatio="none" aria-hidden="true"><path d="${trailCommands}" /></svg>`
    : '';
  const friendsMarkup = friends.length ? friends.map((friend) => {
    const checkedIn = (friend.days || []).includes(today);
    return `<div class="friend-row"><span class="friend-avatar">${safeText(friend.name.slice(0, 1).toUpperCase())}</span><div class="friend-copy"><strong>${safeText(friend.name)}</strong><span>${getCurrentStreak(friend.days)} day streak</span></div><button class="friend-checkin ${checkedIn ? 'checked-in' : ''}" data-action="toggle-friend-checkin" data-id="${safeText(friend.id)}">${checkedIn ? '✓ Today' : 'Check in'}</button><button class="remove-friend" data-action="remove-friend" data-id="${safeText(friend.id)}" aria-label="Remove ${safeText(friend.name)}">×</button></div>`;
  }).join('') : '<p class="friends-empty">Add friends to keep a shared daily goal together.</p>';
  const checkedInToday = state.streakDays.includes(today);
  const homeMarkup = `
    <section class="home-screen">
      <div class="home-hero">
        <div class="home-hero-copy"><div class="eyebrow">A good day to learn something</div><h1>Make room for what’s next, ${safeText(firstName)}.</h1><p>Your next step is ready when you are. Keep building the skills you care about, one focused session at a time.</p><div class="home-actions"><button class="primary-btn" data-action="nav-learning">Continue learning <span aria-hidden="true">→</span></button><button class="secondary-btn" data-action="build-path">＋ Create a path</button></div></div>
        <div class="home-progress"><span class="home-progress-label">CURRENT PATH</span><strong>${safeText(path.skill)}</strong><div class="home-progress-meta"><span>${progress.done} of ${progress.total} lessons</span><b>${progress.percent}%</b></div><div class="track"><div class="track-fill" style="width:${progress.percent}%"></div></div><span class="home-next-label">NEXT UP</span><span class="home-next-title">${safeText(next.title)}</span></div>
      </div>
      <section class="streak-circle" aria-label="Friends streak circle">
        <div class="streak-main"><div class="eyebrow">Learn together</div><h2>${safeText(state.streakCircle?.name || 'Curiosity Club')}</h2><div class="group-streak-number">${getGroupStreak()} <span>day group streak</span></div><div class="personal-streak-summary"><span>Your streak <strong>${currentStreak} days</strong></span><span>Best <strong>${longestStreak} days</strong></span></div><div class="streak-actions"><button class="primary-btn ${checkedInToday ? 'checked-in' : ''}" data-action="check-in">${checkedInToday ? '✓ Logged for today' : 'Log today’s learning'}</button><button class="secondary-btn" data-action="share-streak">Share update ↗</button></div></div>
        <div class="friends-panel"><div class="friends-heading"><div><strong>Friends</strong><span>${friends.length + 1} in this circle</span></div><form class="friend-form" id="friend-form"><input name="name" maxlength="35" placeholder="Add a friend" aria-label="Friend’s name" required /><button type="submit" aria-label="Add friend">＋</button></form></div><div class="friend-list"><div class="friend-row self-row"><span class="friend-avatar self-avatar">${safeText(firstName.slice(0, 1).toUpperCase())}</span><div class="friend-copy"><strong>You</strong></div><span class="friend-status ${checkedInToday ? 'done' : ''}">${checkedInToday ? 'Today ✓' : 'Not yet'}</span></div>${friendsMarkup}</div><p class="friend-note">Check-ins stay on this device. Share updates in your group chat.</p></div>
      </section>
    </section>`;
  const pathNavMarkup = state.paths.map((item) => {
    const done = item.lessons.filter((lesson) => lesson.done).length;
    const percent = item.lessons.length ? Math.round(done / item.lessons.length * 100) : 0;
    return `<div class="path-nav-item"><button class="path-nav-link ${item.id === path.id && activeView === 'learning' ? 'active' : ''}" data-action="select-path" data-id="${safeText(item.id)}"><span class="path-nav-mark">${safeText(item.skill.slice(0, 1).toUpperCase())}</span><span class="path-nav-copy"><strong>${safeText(item.skill)}</strong><small>${percent}% complete</small></span></button>${state.paths.length > 1 ? `<button class="remove-path-btn" data-action="remove-path" data-id="${safeText(item.id)}" aria-label="Remove ${safeText(item.skill)} path">×</button>` : ''}</div>`;
  }).join('');
  const builderMarkup = `
    <section class="panel builder" id="builder">
      <div class="section-heading"><div><h2>Create a learning path</h2><p>Choose a skill and we’ll find relevant video lessons to get you started.</p></div></div>
      <form class="builder-form" id="path-form">
        <div class="field"><label for="skill-input">Skill or subject</label><input id="skill-input" name="skill" placeholder="e.g. Python, baking, public speaking" maxlength="70" required /></div>
        <div class="field"><label for="level-input">Starting level</label><select id="level-input" name="level"><option>Beginner</option><option selected>Comfortable</option><option>Advanced</option></select></div>
        <div class="field"><label for="hours-input">Hours / week</label><input id="hours-input" name="hours" type="number" min="1" max="40" value="4" /></div>
        <button class="primary-btn" type="submit">Find lessons <span aria-hidden="true">→</span></button>
      </form>
      <p id="form-error" class="form-error" role="alert">Add a skill or subject to get started.</p>
    </section>`;
  const createMarkup = `<section class="create-page"><div class="workspace-heading"><h1>New learning path</h1><p>This path will have its own lessons, videos, and articles.</p></div>${builderMarkup}</section>`;
  const learningMarkup = `
    <section class="workspace-heading"><div><h1>${safeText(path.skill)}</h1><p>${safeText(path.level)} · ${getWeeks()} weeks · ${path.weeklyHours} hours / week</p></div></section>
    <div class="mobile-path-nav">${pathNavMarkup}</div>
    <div class="learning-stack">
      <section class="panel path-panel" id="path-panel">
        <div class="progress-row"><div class="progress-meta"><span><strong>${progress.done} of ${progress.total}</strong> lessons complete</span><strong>${progress.percent}%</strong></div><div class="track" role="progressbar" aria-label="Learning path progress" aria-valuenow="${progress.percent}" aria-valuemin="0" aria-valuemax="100"><div class="track-fill" style="width:${progress.percent}%"></div></div></div>
        <div class="path-heading"><div><strong>Your learning journey</strong><span>Choose a circle to open its notes and video.</span></div><div class="path-resource-actions"><button class="text-btn" data-action="toggle-resource-form" data-type="video" aria-expanded="false" aria-controls="add-resource-form">＋ Add video</button><button class="text-btn" data-action="toggle-resource-form" data-type="article" aria-expanded="false" aria-controls="add-resource-form">＋ Add article</button></div></div>
        <form class="add-video-form path-resource-form" id="add-resource-form" data-type="video" hidden>
          <div class="field"><label for="resource-title">Title</label><input id="resource-title" name="title" maxlength="100" placeholder="Give this resource a title" required /></div>
          <div class="field"><label for="resource-url">Link</label><input id="resource-url" name="url" type="url" placeholder="https://youtube.com/watch?v=..." required /></div>
          <div class="field resource-summary-field"><label for="resource-summary">Summary <span>optional</span></label><textarea id="resource-summary" name="summary" maxlength="1000" rows="3" placeholder="Capture the main ideas"></textarea></div>
          <button class="primary-btn" type="submit">Add to path <span aria-hidden="true">→</span></button>
          <p class="video-form-error" id="resource-form-error" role="alert"></p>
        </form>
        <div class="lesson-path" aria-label="Lessons in your learning path">${lessonPathTrail}${lessonPathMarkup}</div>
      </section>
      <section class="reward-strip"><div class="reward-icon">✦</div><div class="reward-strip-copy"><span class="eyebrow">Reward goal</span><strong>${safeText(state.reward.title)}</strong><div class="reward-strip-progress"><span>${rewardProgress} of ${state.reward.target} milestones</span><div class="track"><div class="track-fill" style="width:${rewardPercent}%;background:#e99a78"></div></div></div></div><button class="goal-edit" data-action="edit-reward">Edit</button></section>
    </div>`;

  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand"><span class="brand-mark">↗</span><span class="brand-name">pathwise</span></div>
        <div class="side-label">Workspace</div>
        <nav class="nav-list" aria-label="Main navigation">
          <button class="nav-link ${activeView === 'home' ? 'active' : ''}" data-action="nav-home"><span class="nav-icon">⌂</span><span class="nav-text">Home</span></button>
          <button class="nav-link ${activeView === 'learning' ? 'active' : ''}" data-action="nav-learning"><span class="nav-icon">◫</span><span class="nav-text">My learning</span></button>
          <button class="nav-link mobile-new-path" data-action="build-path"><span class="nav-icon">＋</span><span class="nav-text">New path</span></button>
        </nav>
        <div class="side-label path-label">LEARNING PATHS</div>
        <div class="path-nav">${pathNavMarkup}</div>
        <button class="new-path-btn" data-action="build-path"><span>＋</span> New path</button>
        <div class="plan-card"><span>${state.plan === 'plus' ? 'PLUS PLAN' : 'FREE PLAN'}</span><p>${state.plan === 'plus' ? `${state.paths.length} paths saved` : `${state.paths.length} of 1 path used`}</p>${state.plan === 'plus' ? '' : '<button data-action="upgrade">Unlock multiple paths</button>'}</div>
        <div class="side-spacer"></div>
        <div class="profile"><div class="avatar">${safeText(firstName.slice(0, 1))}${safeText(state.name.split(' ')[1]?.slice(0, 1) || '')}</div><div class="profile-copy"><strong>${safeText(state.name)}</strong><span>${authSession ? 'Account profile' : 'Device-only profile'}</span></div></div>
      </aside>
      <main class="main">
        <header class="topbar"><span class="date-label">${date}</span><div class="top-actions"><span class="saved-pill" id="save-status">${safeText(saveStatus)}</span><button class="account-button" data-action="account">${authSession ? safeText(authSession.user.email || 'Your account') : 'Sign in / create account'}</button></div></header>
        ${activeView === 'home' ? homeMarkup : activeView === 'create' ? createMarkup : learningMarkup}
      </main>
    </div>
    <div id="modal-root"></div><div class="toast" id="toast" role="status" aria-live="polite"></div>`;
}

function showToast(message) {
  const toast = document.querySelector('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

function openAccountModal(mode = 'signin') {
  const root = document.querySelector('#modal-root');
  if (authSession) {
    root.innerHTML = `<div class="modal-backdrop" data-action="backdrop"><section class="modal account-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><div><h2 id="modal-title">Your account</h2><p>Your learning progress is saved to this account.</p></div><button class="close-btn" data-action="close-modal" aria-label="Close">×</button></div><p class="account-email">${safeText(authSession.user.email || '')}</p><div class="modal-actions"><button type="button" class="secondary-btn" data-action="close-modal">Close</button><button type="button" class="primary-btn" data-action="sign-out">Sign out</button></div></section></div>`;
    return;
  }
  if (!isAccountStorageConfigured()) {
    root.innerHTML = `<div class="modal-backdrop" data-action="backdrop"><section class="modal account-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><div><h2 id="modal-title">Sync your learning</h2><p>Your progress is currently saved in this browser only.</p></div><button class="close-btn" data-action="close-modal" aria-label="Close">×</button></div><div class="setup-note"><strong>Connect a Supabase project to enable accounts.</strong><ol><li>Create a free Supabase project and run <code>supabase/schema.sql</code> in its SQL Editor.</li><li>Copy <code>.env.example</code> to <code>.env</code> and add your project URL and publishable anon key.</li><li>Restart the app. Then you can create an account and sync progress across devices.</li></ol></div><div class="modal-actions"><button type="button" class="primary-btn" data-action="close-modal">Continue on this device</button></div></section></div>`;
    return;
  }
  const isSignUp = mode === 'signup';
  root.innerHTML = `<div class="modal-backdrop" data-action="backdrop"><section class="modal account-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><div><h2 id="modal-title">${isSignUp ? 'Create your account' : 'Welcome back'}</h2><p>${isSignUp ? 'Your paths and progress will follow you across devices.' : 'Sign in to pick up where you left off.'}</p></div><button class="close-btn" data-action="close-modal" aria-label="Close">×</button></div><form id="account-form" data-mode="${mode}"><div class="modal-fields">${isSignUp ? '<div class="field"><label for="account-name">Your name</label><input id="account-name" name="name" autocomplete="name" maxlength="60" required /></div>' : ''}<div class="field"><label for="account-email">Email</label><input id="account-email" name="email" type="email" autocomplete="email" required /></div><div class="field"><label for="account-password">Password</label><input id="account-password" name="password" type="password" autocomplete="${isSignUp ? 'new-password' : 'current-password'}" minlength="8" required /></div></div><p class="account-form-error" id="account-form-error" role="alert"></p><div class="modal-actions"><button type="button" class="text-btn" data-action="switch-account-mode" data-mode="${isSignUp ? 'signin' : 'signup'}">${isSignUp ? 'Already have an account? Sign in' : 'New to Pathwise? Create an account'}</button><button type="submit" class="primary-btn">${isSignUp ? 'Create account' : 'Sign in'}</button></div></form></section></div>`;
}

async function initializeAccount() {
  if (!isAccountStorageConfigured()) return;
  const initialGeneration = authGeneration;
  let generation = initialGeneration;
  try {
    const session = await getAccountSession();
    if (authGeneration !== initialGeneration) return;
    if (!session) return;
    authSession = session;
    generation = ++authGeneration;
    const saveRevision = accountSaveRevision;
    const pendingState = loadPendingAccountState(session.user.id);
    const savedState = pendingState || await loadAccountState(session);
    if (authGeneration !== generation || authSession?.user.id !== session.user.id) return;
    if (accountSaveRevision !== saveRevision) {
      saveState();
      render();
      return;
    }
    if (savedState) {
      state = normalizeState(savedState);
      if (pendingState) {
        saveState();
      } else {
        saveStatus = 'Synced to your account';
      }
    } else {
      state = structuredClone(defaultState);
      state.name = session.user.user_metadata?.display_name || session.user.email?.split('@')[0] || state.name;
      saveState();
    }
    render();
  } catch (error) {
    if (authGeneration !== generation) return;
    authSession = null;
    saveStatus = 'Saved on this device';
    render();
    showToast(`Could not load your account: ${error.message}`);
  }
}

async function submitAccountForm(form) {
  const formData = new FormData(form);
  const mode = form.dataset.mode;
  const email = String(formData.get('email') || '').trim();
  const password = String(formData.get('password') || '');
  const name = String(formData.get('name') || '').trim();
  const submitButton = form.querySelector('button[type="submit"]');
  const errorMessage = document.querySelector('#account-form-error');
  submitButton.disabled = true;
  submitButton.textContent = mode === 'signup' ? 'Creating account…' : 'Signing in…';
  errorMessage.textContent = '';
  try {
    let session;
    if (mode === 'signup') {
      const result = await signUp(email, password, name);
      if (result.requiresEmailConfirmation) {
        openAccountModal('signin');
        showToast('Check your email to confirm your account, then sign in.');
        return;
      }
      session = result.session;
      if (hasSavedLocalState) {
        state = normalizeState(state);
      } else {
        state = structuredClone(defaultState);
      }
      state.name = name;
    } else {
      session = await signIn(email, password);
      const pendingState = loadPendingAccountState(session.user.id);
      const savedState = pendingState || await loadAccountState(session);
      if (savedState) {
        state = normalizeState(savedState);
      } else {
        state = structuredClone(defaultState);
        state.name = session.user.user_metadata?.display_name || email.split('@')[0] || state.name;
      }
    }
    authSession = session;
    authGeneration += 1;
    saveStatus = 'Saving to your account…';
    saveState();
    document.querySelector('#modal-root').innerHTML = '';
    render();
    showToast(mode === 'signup' ? 'Account created. Your learning is now synced.' : 'Welcome back. Your learning is synced.');
  } catch (error) {
    submitButton.disabled = false;
    submitButton.textContent = mode === 'signup' ? 'Create account' : 'Sign in';
    errorMessage.textContent = error.message;
  }
}

async function handleSignOut() {
  const session = authSession;
  try {
    await signOut(session);
  } catch (error) {
    showToast(`Signed out on this device, but the server sign-out failed: ${error.message}`);
  }
  authSession = null;
  authGeneration += 1;
  accountSaveRevision += 1;
  clearTimeout(accountSaveTimer);
  state = structuredClone(defaultState);
  hasSavedLocalState = false;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn('Could not clear local learning progress after sign-out.', error);
  }
  saveStatus = 'Saved on this device';
  render();
  showToast('You have signed out.');
}

async function completeCheckoutReturn() {
  const parameters = new URLSearchParams(window.location.search);
  const sessionId = parameters.get('checkout_session_id');
  if (parameters.has('checkout_cancelled')) {
    window.history.replaceState({}, '', window.location.pathname);
    showToast('Checkout was cancelled.');
    return;
  }
  if (!sessionId) return;
  try {
    const response = await fetch('/api/verify-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    const result = await readJsonResponse(response);
    if (!response.ok || !result.verified) throw new Error(result.error || 'Payment could not be verified.');
    state.plan = 'plus';
    saveState();
    activeView = 'home';
    window.history.replaceState({}, '', window.location.pathname);
    render();
    showToast('Plus is active. You can now create multiple learning paths.');
  } catch (error) {
    window.history.replaceState({}, '', window.location.pathname);
    showToast(error.message || 'Payment could not be verified.');
  }
}

function makePath(skill, level, weeklyHours) {
  const topic = skill.trim();
  const lessonsByLevel = {
    Beginner: [
      ['Get oriented with the basics', 'Foundations · Key terms and the big picture', 30],
      ['Learn the essential building blocks', 'Core skills · The tools and techniques', 40],
      ['Follow a guided first practice', 'Practice · A simple, step-by-step exercise', 35],
      ['Make a small project of your own', 'Project · Put the fundamentals to work', 50],
      ['Review, improve, and share your work', 'Next steps · Feedback and continued practice', 35],
    ],
    Comfortable: [
      ['Map the landscape and spot your gaps', 'Core concepts · A focused skills audit', 30],
      ['Strengthen the techniques that matter', 'Methods · Intermediate patterns and tools', 45],
      ['Work through a realistic challenge', 'Practice · Apply ideas to a real scenario', 45],
      ['Build a complete project from scratch', 'Project · Plan, make, and refine', 60],
      ['Get feedback and polish your approach', 'Refinement · Troubleshoot and iterate', 40],
      ['Share your work and choose what’s next', 'Capstone · Reflect and keep growing', 35],
    ],
    Advanced: [
      ['Audit your current practice and blind spots', 'Advanced review · Find the highest-value gap', 35],
      ['Study specialist methods and edge cases', 'Deep dive · Complex techniques and tradeoffs', 55],
      ['Analyze exemplary work in the field', 'Case studies · Deconstruct expert decisions', 45],
      ['Tackle an open-ended project brief', 'Applied practice · Work with real constraints', 70],
      ['Stress-test, refine, and document your work', 'Iteration · Test assumptions and improve', 55],
      ['Publish a portfolio-ready capstone', 'Capstone · Present your process and outcomes', 65],
      ['Set a deliberate plan for continued mastery', 'Next steps · Specialize and contribute', 35],
    ],
  };
  const levelFactor = level === 'Advanced' ? 'advanced' : level === 'Beginner' ? 'beginner' : 'intermediate';
  return {
    skill: topic,
    level,
    weeklyHours: Math.max(1, Math.min(40, Number(weeklyHours) || 4)),
    lessons: lessonsByLevel[level].map(([title, detail, minutes]) => ({ title: `${title} in ${topic}`, detail, minutes, done: false })),
    searchLevel: levelFactor,
  };
}

function openModal(type) {
  const root = document.querySelector('#modal-root');
  if (type === 'reward') {
    root.innerHTML = `<div class="modal-backdrop" data-action="backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><div><h2 id="modal-title">Set a reward goal</h2><p>Choose something you’ll be excited to work toward.</p></div><button class="close-btn" data-action="close-modal" aria-label="Close">×</button></div><form id="reward-form"><div class="modal-fields"><div class="field"><label for="reward-title">What are you working toward?</label><input id="reward-title" name="title" maxlength="60" value="${safeText(state.reward.title)}" required /></div><div class="field"><label for="reward-target">How many lessons until you earn it?</label><input id="reward-target" name="target" type="number" min="1" max="100" value="${safeText(state.reward.target)}" required /></div></div><div class="modal-actions"><button type="button" class="secondary-btn" data-action="close-modal">Cancel</button><button type="submit" class="primary-btn">Save reward</button></div></form></section></div>`;
  } else {
    root.innerHTML = `<div class="modal-backdrop" data-action="backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><div><h2 id="modal-title">Unlock Plus</h2><p>Save multiple learning paths and create exercises for your videos and articles.</p></div><button class="close-btn" data-action="close-modal" aria-label="Close">×</button></div><form id="checkout-form"><label class="plan-option selected"><input type="radio" name="interval" value="monthly" checked /><span class="plan-copy"><strong>Monthly</strong><p>Billed monthly. Cancel anytime.</p></span></label><label class="plan-option"><input type="radio" name="interval" value="annual" /><span class="plan-copy"><strong>Annual</strong><p>Billed annually.</p></span></label><p class="checkout-note">Payment is processed securely by Stripe. Your plan unlocks after payment is confirmed.</p><div class="modal-actions"><button type="button" class="secondary-btn" data-action="close-modal">Cancel</button><button type="submit" class="primary-btn">Continue to checkout</button></div></form></section></div>`;
    root.querySelectorAll('.plan-option input').forEach((input) => input.addEventListener('change', () => {
      root.querySelectorAll('.plan-option').forEach((option) => option.classList.toggle('selected', option.querySelector('input').checked));
    }));
  }
  root.querySelector('.modal-backdrop').addEventListener('click', (event) => {
    if (event.target.classList.contains('modal-backdrop')) root.innerHTML = '';
  });
}

function openLessonModal(index) {
  const path = getActivePath();
  const lesson = path.lessons[index];
  if (!lesson) return;

  const sourceById = new Map((path.research?.sources || []).map((source) => [source.id, source]));
  const sources = (lesson.sourceIds || []).map((id) => sourceById.get(id)).filter(Boolean);
  const videos = sources.filter((source) => getResourceType(source) === 'video');
  const summary = lesson.summary || lesson.detail || 'Use this lesson to build your skills one step at a time.';
  const resourcesMarkup = sources.map((source) => {
    const type = getResourceType(source);
    const sourceSummary = source.summary || source.snippet || '';
    const exercises = source.exercises || [];
    const exerciseCount = exercises.filter((exercise) => exercise.done).length;
    const practiceMarkup = state.plan === 'plus' ? `
      <div class="exercise-block">
        <div class="exercise-heading"><div><strong>Practice</strong>${exercises.length ? `<span>${exerciseCount}/${exercises.length} done</span>` : ''}</div><button class="text-btn" data-action="toggle-exercise-form" data-id="${safeText(source.id)}" aria-expanded="false" aria-controls="exercise-form-${safeText(source.id)}">＋ Add exercise</button></div>
        ${exercises.length ? `<ul class="exercise-list">${exercises.map((exercise) => `<li class="exercise-item ${exercise.done ? 'complete' : ''}"><label><input type="checkbox" data-action="toggle-exercise" data-source-id="${safeText(source.id)}" data-exercise-id="${safeText(exercise.id)}" ${exercise.done ? 'checked' : ''} /><span>${safeText(exercise.prompt)}</span></label><button class="remove-exercise" data-action="remove-exercise" data-source-id="${safeText(source.id)}" data-exercise-id="${safeText(exercise.id)}" aria-label="Remove exercise">×</button></li>`).join('')}</ul>` : ''}
        <form class="exercise-form" id="exercise-form-${safeText(source.id)}" data-source-id="${safeText(source.id)}" hidden><label for="exercise-prompt-${safeText(source.id)}">Exercise</label><div><input id="exercise-prompt-${safeText(source.id)}" name="prompt" maxlength="180" placeholder="e.g. Write down three key ideas" required /><button class="primary-btn" type="submit" aria-label="Save exercise">Add</button></div></form>
      </div>` : `<div class="exercise-locked"><span aria-hidden="true">✦</span><div><strong>Exercises are a Plus feature</strong><small>Unlock practice tasks for every resource.</small></div><button class="text-btn" data-action="upgrade">Unlock</button></div>`;
    return `<article class="lesson-resource">
      <div class="resource-source-meta"><span class="resource-kind">${type === 'video' ? 'VIDEO' : 'ARTICLE'}</span><button class="remove-video" data-action="remove-resource" data-id="${safeText(source.id)}" aria-label="Remove ${safeText(source.title)}">Remove</button></div>
      ${type === 'video' && source.videoId ? `<iframe src="https://www.youtube-nocookie.com/embed/${safeText(source.videoId)}" title="${safeText(source.title)}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>` : type === 'article' ? '<div class="article-preview"><span aria-hidden="true">Aa</span><strong>Reading</strong><small>Open this article in a new tab</small></div>' : ''}
      <strong class="resource-title">${safeText(source.title)}</strong>
      <div class="resource-summary"><div class="summary-heading"><strong>Summary</strong><button class="text-btn" data-action="toggle-summary-form" data-id="${safeText(source.id)}" aria-expanded="false" aria-controls="summary-form-${safeText(source.id)}">Edit</button></div><p>${sourceSummary ? safeText(sourceSummary) : 'Add a short summary for this resource.'}</p><form class="summary-form" id="summary-form-${safeText(source.id)}" data-source-id="${safeText(source.id)}" hidden><textarea name="summary" maxlength="1000" rows="3" placeholder="What are the main ideas?">${safeText(sourceSummary)}</textarea><button class="primary-btn" type="submit">Save summary</button></form></div>
      <a href="${safeText(source.url)}" target="_blank" rel="noopener noreferrer">${type === 'video' ? 'Open video' : 'Read article'} ↗</a>
      ${practiceMarkup}
    </article>`;
  }).join('');
  const root = document.querySelector('#modal-root');
  root.innerHTML = `<div class="modal-backdrop"><section class="modal lesson-modal" role="dialog" aria-modal="true" aria-labelledby="lesson-modal-title">
    <div class="modal-head"><div><span class="eyebrow">Lesson ${index + 1} · ${lesson.minutes} min</span><h2 id="lesson-modal-title">${safeText(lesson.title)}</h2></div><button class="close-btn" data-action="close-modal" aria-label="Close lesson">×</button></div>
    <section class="lesson-notes"><h3>Summary</h3><p>${safeText(summary)}</p></section>
    ${videos.length ? `<section class="lesson-modal-resources" aria-label="Lesson videos">${resourcesMarkup}</section>` : sources.length ? `<section class="lesson-modal-resources" aria-label="Lesson resources">${resourcesMarkup}<button class="video-link" data-action="youtube" data-index="${index}">Find a video on YouTube ↗</button></section>` : `<div class="lesson-video-empty"><p>No video is linked to this lesson yet.</p><button class="video-link" data-action="youtube" data-index="${index}">Find a video on YouTube ↗</button></div>`}
    <div class="modal-actions"><button class="secondary-btn" data-action="close-modal">Close</button><button class="primary-btn" data-action="toggle-lesson" data-index="${index}">${lesson.done ? 'Mark as not done' : 'Complete lesson ✓'}</button></div>
  </section></div>`;
  root.querySelector('.modal-backdrop').addEventListener('click', (event) => {
    if (event.target.classList.contains('modal-backdrop')) root.innerHTML = '';
  });
}

function searchYouTube(index) {
  const path = getActivePath();
  const lesson = path.lessons[index];
  if (!lesson) return;
  const sourceById = new Map((path.research?.sources || []).map((source) => [source.id, source]));
  const video = (lesson.sourceIds || []).map((id) => sourceById.get(id)).find((source) => source?.videoId);
  if (video) {
    window.open(video.url, '_blank', 'noopener,noreferrer');
    return;
  }
  const level = path.searchLevel || path.level.toLowerCase();
  const query = `${path.skill} ${lesson.title} ${level} tutorial course`;
  window.open(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, '_blank', 'noopener,noreferrer');
}

app.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const { action } = target.dataset;
  if (action === 'account') {
    openAccountModal();
  } else if (action === 'switch-account-mode') {
    openAccountModal(target.dataset.mode);
  } else if (action === 'sign-out') {
    handleSignOut();
  } else if (action === 'toggle-lesson') {
    const path = getActivePath();
    const index = Number(target.dataset.index);
    path.lessons[index].done = !path.lessons[index].done;
    if (path.lessons[index].done) recordToday(state.streakDays);
    saveState();
    render();
  } else if (action === 'check-in') {
    recordToday(state.streakDays);
    saveState();
    render();
    showToast('Today’s learning is logged.');
  } else if (action === 'toggle-friend-checkin') {
    const friend = state.streakCircle.friends.find((item) => item.id === target.dataset.id);
    if (!friend) return;
    friend.days ||= [];
    const today = getDayKey();
    friend.days = friend.days.includes(today) ? friend.days.filter((day) => day !== today) : [...friend.days, today];
    saveState();
    render();
  } else if (action === 'remove-friend') {
    state.streakCircle.friends = state.streakCircle.friends.filter((friend) => friend.id !== target.dataset.id);
    saveState();
    render();
  } else if (action === 'share-streak') {
    shareStreakUpdate();
  } else if (action === 'youtube') {
    searchYouTube(Number(target.dataset.index));
  } else if (action === 'open-lesson') {
    openLessonModal(Number(target.dataset.index));
  } else if (action === 'nav-home') {
    activeView = 'home';
    render();
  } else if (action === 'nav-learning') {
    activeView = 'learning';
    render();
  } else if (action === 'select-path') {
    state.activePathId = target.dataset.id;
    activeView = 'learning';
    saveState();
    render();
  } else if (action === 'remove-path') {
    if (state.paths.length < 2 || !window.confirm('Remove this learning path and its progress?')) return;
    const pathId = target.dataset.id;
    state.paths = state.paths.filter((item) => item.id !== pathId);
    if (state.activePathId === pathId) state.activePathId = state.paths[0].id;
    activeView = 'learning';
    saveState();
    render();
    showToast('Learning path removed.');
  } else if (action === 'upgrade') {
    openModal('upgrade');
  } else if (action === 'toggle-resource-form') {
    const form = document.querySelector('#add-resource-form');
    const type = target.dataset.type;
    const isOpen = form.hidden || form.dataset.type !== type;
    form.hidden = !isOpen;
    form.dataset.type = type;
    target.setAttribute('aria-expanded', String(isOpen));
    document.querySelector('#resource-title').placeholder = type === 'video' ? 'e.g. A practical introduction' : 'e.g. A guide to the fundamentals';
    document.querySelector('#resource-url').placeholder = type === 'video' ? 'https://youtube.com/watch?v=...' : 'https://example.com/article';
    if (isOpen) document.querySelector('#resource-title').focus();
  } else if (action === 'toggle-exercise-form') {
    if (state.plan !== 'plus') {
      openModal('upgrade');
      return;
    }
    const form = document.querySelector(`#exercise-form-${CSS.escape(target.dataset.id)}`);
    const isOpen = form.hidden;
    form.hidden = !isOpen;
    target.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) form.querySelector('input').focus();
  } else if (action === 'toggle-summary-form') {
    const form = document.querySelector(`#summary-form-${CSS.escape(target.dataset.id)}`);
    const isOpen = form.hidden;
    form.hidden = !isOpen;
    target.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) form.querySelector('textarea').focus();
  } else if (action === 'remove-exercise') {
    if (state.plan !== 'plus') {
      openModal('upgrade');
      return;
    }
    const source = getActivePath().research?.sources?.find((item) => item.id === target.dataset.sourceId);
    if (!source) return;
    source.exercises = (source.exercises || []).filter((exercise) => exercise.id !== target.dataset.exerciseId);
    saveState();
    render();
  } else if (action === 'remove-resource') {
    const sourceId = target.dataset.id;
    const path = getActivePath();
    const research = path.research;
    if (!research) return;
    research.sources = research.sources.filter((source) => source.id !== sourceId);
    const remainingLessons = path.lessons.map((lesson) => {
      const sourceIds = (lesson.sourceIds || []).filter((id) => id !== sourceId);
      return sourceIds.length ? { ...lesson, sourceIds } : lesson.sourceIds?.length ? null : lesson;
    }).filter(Boolean);
    if (remainingLessons.length) path.lessons = remainingLessons;
    else path.lessons = path.lessons.map((lesson) => ({ ...lesson, sourceIds: (lesson.sourceIds || []).filter((id) => id !== sourceId) }));
    saveState();
    render();
    showToast('Resource removed from your path.');
  } else if (action === 'edit-reward') {
    openModal('reward');
  } else if (action === 'close-modal' || action === 'backdrop') {
    document.querySelector('#modal-root').innerHTML = '';
  } else if (action === 'build-path') {
    if (state.plan !== 'plus' && state.paths.length >= 1) {
      openModal('upgrade');
      return;
    }
    activeView = 'create';
    render();
    document.querySelector('#skill-input').focus();
    document.querySelector('#builder').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
});

app.addEventListener('change', (event) => {
  const checkbox = event.target.closest('[data-action="toggle-exercise"]');
  if (!checkbox || state.plan !== 'plus') return;
  const source = getActivePath().research?.sources?.find((item) => item.id === checkbox.dataset.sourceId);
  const exercise = source?.exercises?.find((item) => item.id === checkbox.dataset.exerciseId);
  if (!exercise) return;
  exercise.done = checkbox.checked;
  if (exercise.done) recordToday(state.streakDays);
  saveState();
  render();
});

app.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (event.target.id === 'account-form') {
    await submitAccountForm(event.target);
  } else if (event.target.id === 'checkout-form') {
    const submitButton = event.target.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = 'Connecting to Stripe...';
    try {
      const response = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interval: new FormData(event.target).get('interval') }),
      });
      const result = await readJsonResponse(response);
      if (!response.ok) throw new Error(result.error || 'Could not start checkout.');
      window.location.assign(result.url);
    } catch (error) {
      submitButton.disabled = false;
      submitButton.textContent = 'Continue to checkout';
      showToast(error.message || 'Could not start checkout.');
    }
  } else if (event.target.id === 'path-form') {
    if (state.plan !== 'plus' && state.paths.length >= 1) {
      openModal('upgrade');
      return;
    }
    const formData = new FormData(event.target);
    const skill = String(formData.get('skill') || '').trim();
    if (!skill) {
      document.querySelector('#form-error').classList.add('visible');
      return;
    }
    const level = String(formData.get('level'));
    const weeklyHours = formData.get('hours');
    const submitButton = event.target.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = 'Finding videos...';
    let completionMessage = `Your ${skill} path is ready.`;
    const starterPath = makePath(skill, level, weeklyHours);
    try {
      const pathId = crypto.randomUUID();
      if (API_GENERATE_PATH_URL) {
        const response = await fetch(API_GENERATE_PATH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ skill, level, weeklyHours }),
        });
        const result = await readJsonResponse(response);
        if (!response.ok) throw new Error(result.error || 'Could not find videos for that subject.');
        if (!result.research?.sources?.length || !Array.isArray(result.lessons) || !result.lessons.length) {
          throw new Error('The search did not return any matching YouTube videos. Try a more specific topic.');
        }
        state.paths.push({ ...starterPath, id: pathId, lessons: result.lessons, research: result.research });
        completionMessage = `Found ${result.research.sources.length} YouTube videos for your path.`;
      } else {
        state.paths.push({ ...starterPath, id: pathId });
        completionMessage = 'Your learning path is ready. Open a lesson circle to search YouTube, or add your own video.';
      }
      state.activePathId = pathId;
    } catch (error) {
      submitButton.disabled = false;
      submitButton.textContent = 'Find my videos →';
      showToast(error.message || 'Could not research that subject. Try again.');
      return;
    }
    saveState();
    activeView = 'learning';
    render();
    showToast(completionMessage);
  } else if (event.target.id === 'add-resource-form') {
    const path = getActivePath();
    const formData = new FormData(event.target);
    const title = String(formData.get('title') || '').trim();
    const url = String(formData.get('url') || '').trim();
    const summary = String(formData.get('summary') || '').trim();
    const type = event.target.dataset.type;
    const parsedUrl = getHttpUrl(url);
    const videoId = type === 'video' ? getYouTubeVideoId(url) : '';
    if (!parsedUrl || (type === 'video' && (!videoId || !/^[\w-]{11}$/.test(videoId)))) {
      const error = document.querySelector('#resource-form-error');
      error.textContent = type === 'video' ? 'Enter a valid YouTube video link (watch, short, or embed URL).' : 'Enter a valid article link starting with http:// or https://.';
      error.classList.add('visible');
      return;
    }
    const sourceId = `${type === 'video' ? 'V' : 'A'}${crypto.randomUUID()}`;
    const source = { id: sourceId, type, title, angle: 'Added by you', videoId: videoId || undefined, url: type === 'video' ? `https://www.youtube.com/watch?v=${videoId}` : parsedUrl.href, summary, snippet: '', exercises: [] };
    path.research ||= { sources: [], angles: [], queries: [] };
    path.research.sources.push(source);
    path.lessons.push({ title, detail: `${type === 'video' ? 'Video' : 'Article'} · Added to your path`, minutes: type === 'video' ? 30 : 15, done: false, sourceIds: [sourceId] });
    saveState();
    activeView = 'learning';
    render();
    showToast(`${type === 'video' ? 'Video' : 'Article'} added to your learning path.`);
  } else if (event.target.matches('.exercise-form')) {
    if (state.plan !== 'plus') {
      openModal('upgrade');
      return;
    }
    const source = getActivePath().research?.sources?.find((item) => item.id === event.target.dataset.sourceId);
    const prompt = String(new FormData(event.target).get('prompt') || '').trim();
    if (!source || !prompt) return;
    source.exercises ||= [];
    source.exercises.push({ id: crypto.randomUUID(), prompt, done: false });
    saveState();
    render();
    showToast('Exercise added.');
  } else if (event.target.matches('.summary-form')) {
    const source = getActivePath().research?.sources?.find((item) => item.id === event.target.dataset.sourceId);
    if (!source) return;
    source.summary = String(new FormData(event.target).get('summary') || '').trim();
    saveState();
    render();
    showToast('Summary saved.');
  } else if (event.target.id === 'friend-form') {
    const name = String(new FormData(event.target).get('name') || '').trim();
    if (!name) return;
    state.streakCircle ||= { name: 'Curiosity Club', friends: [] };
    state.streakCircle.friends ||= [];
    if (state.streakCircle.friends.some((friend) => friend.name.toLowerCase() === name.toLowerCase())) {
      showToast('That friend is already in your circle.');
      return;
    }
    state.streakCircle.friends.push({ id: crypto.randomUUID(), name, days: [] });
    saveState();
    render();
    showToast(`${name} added to your streak circle.`);
  } else if (event.target.id === 'reward-form') {
    const formData = new FormData(event.target);
    state.reward = { title: String(formData.get('title')).trim(), target: Math.max(1, Number(formData.get('target')) || 1) };
    saveState();
    render();
    showToast('Your reward goal is saved.');
  }
});

render();
initializeAccount();
completeCheckoutReturn();
