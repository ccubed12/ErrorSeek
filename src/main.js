import './styles.css';

const STORAGE_KEY = 'pathwise-learning-state-v1';
const defaultState = {
  name: 'Alex Morgan',
  path: {
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
  },
  reward: { title: 'A weekend pottery class', target: 8 },
  plan: 'free',
};

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && saved.path && Array.isArray(saved.path.lessons) && saved.reward) return { ...defaultState, ...saved };
  } catch (error) {
    console.warn('Could not read saved learning progress.', error);
  }
  return structuredClone(defaultState);
}

let state = loadState();
let toastTimer;
const app = document.querySelector('#app');

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (error) {
    showToast('Could not save on this device. Check browser storage settings.');
    return false;
  }
}

function safeText(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

async function readJsonResponse(response) {
  const body = await response.text();
  if (!body.trim()) {
    if (response.status === 404) {
      throw new Error('Video search is not available on this server yet (HTTP 404). Stop the existing app process and start it again with npm run dev.');
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
  const done = state.path.lessons.filter((lesson) => lesson.done).length;
  return { done, total: state.path.lessons.length, percent: state.path.lessons.length ? Math.round(done / state.path.lessons.length * 100) : 0 };
}

function getNextLesson() {
  return state.path.lessons.find((lesson) => !lesson.done) || state.path.lessons.at(-1);
}

function getWeeks() {
  const lessonHours = state.path.lessons.reduce((sum, lesson) => sum + lesson.minutes, 0) / 60;
  return Math.max(1, Math.ceil(lessonHours / Math.max(1, Number(state.path.weeklyHours) || 1)));
}

function render() {
  const progress = getProgress();
  const next = getNextLesson();
  const firstName = state.name.split(' ')[0];
  const research = state.path.research;
  const sourceById = new Map((research?.sources || []).map((source) => [source.id, source]));
  const rewardProgress = Math.min(progress.done, Number(state.reward.target));
  const rewardPercent = Math.min(100, Math.round(rewardProgress / Math.max(1, Number(state.reward.target)) * 100));
  const date = new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
  const lessonsMarkup = state.path.lessons.map((lesson, index) => {
    const citations = (lesson.sourceIds || []).map((id) => sourceById.get(id)).filter(Boolean);
    return `
    <div class="lesson-row">
      <button class="lesson-check ${lesson.done ? 'complete' : ''}" data-action="toggle-lesson" data-index="${index}" aria-label="${lesson.done ? 'Mark incomplete' : 'Mark complete'}: ${safeText(lesson.title)}">✓</button>
      <div class="lesson-copy"><strong>${safeText(lesson.title)}</strong><span>${safeText(lesson.detail)}</span>${citations.length ? `<span class="lesson-citations">Video: ${citations.map((source) => `<a href="${safeText(source.url)}" target="_blank" rel="noopener noreferrer" title="${safeText(source.title)}">${safeText(source.id)}</a>`).join(' ')}</span>` : ''}</div>
      <div class="lesson-actions"><span class="lesson-time">${lesson.minutes} min</span><button class="video-link" data-action="youtube" data-index="${index}" aria-label="Watch video for ${safeText(lesson.title)}">▶ Watch video</button></div>
    </div>`;
  }).join('');
  const researchMarkup = research?.sources?.length ? `
    <section class="research-block" aria-label="YouTube videos">
      <div class="research-heading"><strong>Videos for your path</strong><span>${research.sources.length} videos · ${research.angles.join(' · ')}</span></div>
      <p class="research-focus">Each video is matched to your search and becomes a lesson in your path. No account or API key needed.</p>
      ${research.queries?.length ? `<p class="research-queries"><strong>Searches used:</strong> ${research.queries.map((query) => safeText(query)).join(' · ')}</p>` : ''}
      <div class="research-sources">${research.sources.slice(0, 6).map((source) => `
        <article class="research-source">
          <span>${safeText(source.id)} · ${safeText(source.angle)}</span>
          ${source.videoId ? `<iframe src="https://www.youtube-nocookie.com/embed/${safeText(source.videoId)}" title="${safeText(source.title)}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>` : ''}
          <strong>${safeText(source.title)}</strong>
          ${source.snippet ? `<small>${safeText(source.snippet)}</small>` : ''}
          <a href="${safeText(source.url)}" target="_blank" rel="noopener noreferrer">${source.videoId ? 'Open on YouTube' : 'Open source'} ↗</a>
        </article>`).join('')}</div>
    </section>` : '';

  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand"><span class="brand-mark">↗</span><span class="brand-name">pathwise</span></div>
        <div class="side-label">Workspace</div>
        <nav class="nav-list" aria-label="Main navigation">
          <button class="nav-link active" data-action="nav-home"><span class="nav-icon">◫</span><span class="nav-text">My learning</span></button>
          <button class="nav-link" data-action="focus-path"><span class="nav-icon">⌁</span><span class="nav-text">Learning path</span></button>
          <button class="nav-link" data-action="build-path"><span class="nav-icon">＋</span><span class="nav-text">New path</span></button>
        </nav>
        <div class="side-spacer"></div>
        <div class="local-note"><strong>Saved on this device</strong>Your lessons and goals save automatically, even when you’re signed out.</div>
        <div class="upgrade-card"><span class="upgrade-kicker">Pathwise plus</span><p>More paths, deeper plans, and room to grow.</p><button data-action="upgrade">Explore membership</button></div>
        <div class="profile"><div class="avatar">${safeText(firstName.slice(0, 1))}${safeText(state.name.split(' ')[1]?.slice(0, 1) || '')}</div><div class="profile-copy"><strong>${safeText(state.name)}</strong><span>Local profile</span></div></div>
      </aside>
      <main class="main">
        <header class="topbar"><span class="date-label">${date}</span><div class="top-actions"><span class="saved-pill">● Saved on this device</span><span class="streak-pill"><span>✦</span> ${progress.done > 0 ? progress.done : 1} day learning streak</span></div></header>
        <section class="welcome"><div><div class="eyebrow">Your learning dashboard</div><h1>Keep your curiosity moving, ${safeText(firstName)}.</h1><p>A little progress today makes a big difference later.</p></div><div class="goal-chip">${getWeeks()} week path · ${safeText(state.path.level)} level</div></section>
        <div class="page-grid">
          <div class="primary-column">
            <section class="panel builder" id="builder">
              <div class="section-heading"><div><h2>Find videos for your next learning path</h2><p>Search the web for relevant YouTube lessons and turn them into a path. No key or account needed.</p></div><span class="ai-tag">▶ Free video search</span></div>
              <form class="builder-form" id="path-form">
                <div class="field"><label for="skill-input">I want to learn</label><input id="skill-input" name="skill" placeholder="e.g. Python, baking, public speaking" maxlength="70" required /></div>
                <div class="field"><label for="level-input">Starting level</label><select id="level-input" name="level"><option>Beginner</option><option selected>Comfortable</option><option>Advanced</option></select></div>
                <div class="field"><label for="hours-input">Hours / week</label><input id="hours-input" name="hours" type="number" min="1" max="40" value="4" /></div>
                <button class="primary-btn" type="submit">Find my videos <span aria-hidden="true">→</span></button>
              </form>
              <p id="form-error" class="form-error" role="alert">Add a skill or subject to get started.</p>
            </section>
            <section class="panel path-panel" id="path-panel">
              <div class="path-top"><div class="path-title-wrap"><div class="path-symbol">✳</div><div><div class="eyebrow">${research?.sources?.length ? 'Your video path' : 'Your active path'}</div><h2>${safeText(state.path.skill)}</h2><p class="path-subtitle">${safeText(state.path.level)} · about ${getWeeks()} weeks at ${state.path.weeklyHours} hours / week</p></div></div><button class="more-btn" data-action="upgrade" aria-label="Path options">···</button></div>
              <div class="progress-row"><div class="progress-meta"><span><strong>${progress.done} of ${progress.total}</strong> milestones complete</span><strong>${progress.percent}%</strong></div><div class="track" role="progressbar" aria-label="Learning path progress" aria-valuenow="${progress.percent}" aria-valuemin="0" aria-valuemax="100"><div class="track-fill" style="width:${progress.percent}%"></div></div></div>
              ${researchMarkup}
              <div class="lesson-list">${lessonsMarkup}</div>
            </section>
            <section class="panel activity"><div class="activity-head"><div><h3>Your rhythm</h3><p>Small steps add up. Keep your streak alive.</p></div><span class="week-total">THIS WEEK</span></div><div class="chart" aria-label="Weekly activity"><div class="chart-day"><div class="chart-bar" style="--bar:32%"></div><span>M</span></div><div class="chart-day"><div class="chart-bar" style="--bar:58%"></div><span>T</span></div><div class="chart-day"><div class="chart-bar" style="--bar:76%"></div><span>W</span></div><div class="chart-day"><div class="chart-bar" style="--bar:24%"></div><span>T</span></div><div class="chart-day"><div class="chart-bar" style="--bar:47%"></div><span>F</span></div><div class="chart-day today"><div class="chart-bar" style="--bar:${progress.done ? '68%' : '12%'}"></div><span>S</span></div><div class="chart-day"><div class="chart-bar" style="--bar:9%"></div><span>S</span></div></div></section>
          </div>
          <aside class="aside-column">
            <section class="panel aside-panel next-step"><div class="eyebrow">Up next · ${next.minutes} min</div><h3>${safeText(next.title)}</h3><p>Pick one focused session. Your path will be here when you get back.</p><button class="primary-btn" data-action="youtube" data-index="${state.path.lessons.indexOf(next)}">Find a video lesson <span aria-hidden="true">↗</span></button></section>
            <section class="panel aside-panel"><div class="reward-top"><div class="reward-icon">✦</div><button class="icon-btn" data-action="edit-reward" aria-label="Edit reward">···</button></div><div class="eyebrow">Your reward goal</div><h3 class="reward-name">${safeText(state.reward.title)}</h3><p class="reward-caption">A little treat for showing up.</p><div class="reward-progress"><span>Milestones completed</span><strong>${rewardProgress} / ${state.reward.target}</strong></div><div class="track"><div class="track-fill" style="width:${rewardPercent}%;background:#e99a78"></div></div><div class="reward-hint"><b>${rewardPercent >= 100 ? 'You did it!' : `${Math.max(0, Number(state.reward.target) - rewardProgress)} milestones to go.`}</b> Every completed lesson brings it closer.</div><button class="goal-edit" data-action="edit-reward">Edit reward goal</button></section>
            <section class="quick-stats"><div class="stat-box"><div class="stat-number">${progress.done}</div><div class="stat-label">Lessons finished</div></div><div class="stat-box"><div class="stat-number">${getWeeks()}</div><div class="stat-label">Weeks mapped out</div></div></section>
          </aside>
        </div>
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
    root.innerHTML = `<div class="modal-backdrop" data-action="backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><div><h2 id="modal-title">Make room to grow</h2><p>Choose a Pathwise Plus plan for more space to build your skills.</p></div><button class="close-btn" data-action="close-modal" aria-label="Close">×</button></div><form id="checkout-form"><label class="plan-option selected"><input type="radio" name="plan" value="monthly" checked /><span class="plan-copy"><strong>Monthly <span>$9 / month</span></strong><p>Flexible access. Cancel anytime.</p></span></label><label class="plan-option"><input type="radio" name="plan" value="annual" /><span class="plan-copy"><strong>Annual <span>$72 / year</span></strong><p>Save 33% with one yearly payment.</p></span></label><div class="checkout-note">Checkout is in preview mode. Connect a Stripe account to accept real payments; no charge will be made here.</div><div class="modal-actions"><button type="button" class="secondary-btn" data-action="close-modal">Not now</button><button type="submit" class="primary-btn">Continue to checkout →</button></div></form></section></div>`;
    root.querySelectorAll('.plan-option input').forEach((input) => input.addEventListener('change', () => {
      root.querySelectorAll('.plan-option').forEach((option) => option.classList.toggle('selected', option.querySelector('input').checked));
    }));
  }
  root.querySelector('.modal-backdrop').addEventListener('click', (event) => {
    if (event.target.classList.contains('modal-backdrop')) root.innerHTML = '';
  });
}

function searchYouTube(index) {
  const lesson = state.path.lessons[index];
  if (!lesson) return;
  const sourceById = new Map((state.path.research?.sources || []).map((source) => [source.id, source]));
  const video = (lesson.sourceIds || []).map((id) => sourceById.get(id)).find((source) => source?.videoId);
  if (video) {
    window.open(video.url, '_blank', 'noopener,noreferrer');
    return;
  }
  const level = state.path.searchLevel || state.path.level.toLowerCase();
  const query = `${state.path.skill} ${lesson.title} ${level} tutorial course`;
  window.open(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, '_blank', 'noopener,noreferrer');
}

app.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const { action } = target.dataset;
  if (action === 'toggle-lesson') {
    const index = Number(target.dataset.index);
    state.path.lessons[index].done = !state.path.lessons[index].done;
    saveState();
    render();
  } else if (action === 'youtube') {
    searchYouTube(Number(target.dataset.index));
  } else if (action === 'upgrade') {
    openModal('upgrade');
  } else if (action === 'edit-reward') {
    openModal('reward');
  } else if (action === 'close-modal' || action === 'backdrop') {
    document.querySelector('#modal-root').innerHTML = '';
  } else if (action === 'focus-path') {
    document.querySelector('#path-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else if (action === 'build-path') {
    document.querySelector('#skill-input').focus();
    document.querySelector('#builder').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
});

app.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (event.target.id === 'path-form') {
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
      const response = await fetch('/api/generate-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skill, level, weeklyHours }),
      });
      const result = await readJsonResponse(response);
      if (!response.ok) throw new Error(result.error || 'Could not find videos for that subject.');
      if (!result.research?.sources?.length || !Array.isArray(result.lessons) || !result.lessons.length) {
        throw new Error('The search did not return any matching YouTube videos. Try a more specific topic.');
      }
      state.path = { ...starterPath, lessons: result.lessons, research: result.research };
      completionMessage = `Found ${result.research.sources.length} YouTube videos for your path.`;
    } catch (error) {
      submitButton.disabled = false;
      submitButton.textContent = 'Find my videos →';
      showToast(error.message || 'Could not research that subject. Try again.');
      return;
    }
    saveState();
    render();
    showToast(completionMessage);
  } else if (event.target.id === 'reward-form') {
    const formData = new FormData(event.target);
    state.reward = { title: String(formData.get('title')).trim(), target: Math.max(1, Number(formData.get('target')) || 1) };
    saveState();
    render();
    showToast('Your reward goal is saved.');
  } else if (event.target.id === 'checkout-form') {
    document.querySelector('#modal-root').innerHTML = '';
    showToast('Preview only: connect Stripe to enable secure checkout.');
  }
});

render();
