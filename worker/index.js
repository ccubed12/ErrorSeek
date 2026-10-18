const searchAngles = [
  { name: 'Foundations', query: (skill, level) => `${skill} ${physicsFoundationTerms(skill)} ${level} learning prerequisites core concepts curriculum` },
  { name: 'Practice', query: (skill, level) => `${skill} ${level} practical techniques exercises common mistakes` },
  { name: 'Real-world workflow', query: (skill, level) => `${skill} ${level} workflow project case study advanced techniques` },
];

const ignoredSourceTerms = new Set([
  'about', 'after', 'also', 'and', 'are', 'been', 'beginner', 'beginners', 'being',
  'basics', 'chapter', 'concepts', 'core', 'course', 'describe', 'foundation',
  'foundations', 'from', 'have', 'into', 'introduction', 'learn', 'learning',
  'lesson', 'more', 'most', 'other', 'over', 'relative', 'that', 'their', 'these',
  'this', 'through', 'with', 'what', 'when', 'where', 'which', 'will', 'your',
]);

function physicsFoundationTerms(skill) {
  return /\b(physics|mechanics|kinematics)\b/i.test(skill)
    ? 'velocity speed frame of reference'
    : '';
}

function termsFromSources(sources, skill) {
  const excluded = new Set([
    ...ignoredSourceTerms,
    ...(skill.toLowerCase().match(/[a-z0-9]+/g) || []),
  ]);
  const words = sources.flatMap(({ title, snippet }) => `${title} ${snippet}`.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) || []);
  return [...new Set(words.filter((word) => !excluded.has(word)))].slice(0, 10);
}

function textFromRuns(value) {
  return value?.runs?.map((run) => run.text).join('') || value?.simpleText || '';
}

function durationInMinutes(duration) {
  const parts = duration.split(':').map(Number);
  if (parts.length < 2 || parts.some((part) => !Number.isInteger(part))) return 30;
  const seconds = parts.reduce((total, part) => total * 60 + part, 0);
  return Math.max(1, Math.ceil(seconds / 60));
}

function findVideoRenderers(node, videos = []) {
  if (!node || typeof node !== 'object') return videos;
  if (node.videoRenderer?.videoId) videos.push(node.videoRenderer);
  for (const value of Object.values(node)) findVideoRenderers(value, videos);
  return videos;
}

async function searchVideos(query, angle, limit = 4) {
  const url = new URL('https://www.youtube.com/results');
  url.searchParams.set('search_query', query);
  const resultPage = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!resultPage.ok) throw new Error(`YouTube search failed with HTTP ${resultPage.status}.`);

  const html = await resultPage.text();
  const marker = 'var ytInitialData = ';
  const start = html.indexOf(marker);
  const end = html.indexOf(';</script>', start);
  if (start < 0 || end < 0) throw new Error('YouTube did not return readable search results.');
  const searchData = JSON.parse(html.slice(start + marker.length, end));
  return findVideoRenderers(searchData).slice(0, limit).flatMap((video) => {
    const videoId = video.videoId;
    if (!/^[\w-]{11}$/.test(videoId)) return [];
    const title = textFromRuns(video.title).trim();
    if (!title) return [];
    return [{
      title: title.slice(0, 180),
      snippet: textFromRuns(video.descriptionSnippet).slice(0, 450),
      url: `https://www.youtube.com/watch?v=${videoId}`,
      videoId,
      duration: textFromRuns(video.lengthText),
      domain: 'youtube.com',
      angle,
    }];
  });
}

async function researchSkill(skill, level) {
  const searchErrors = [];
  const initialSearches = searchAngles.map((angle) => ({
    name: angle.name,
    query: angle.query(skill, level).replace(/\s+/g, ' ').trim(),
  }));
  const initialResultSets = await Promise.all(initialSearches.map(({ name, query }) =>
    searchVideos(query, name, 2).catch((error) => {
      searchErrors.push(error.message);
      return [];
    }),
  ));
  const initialVideos = initialResultSets.flat();
  const foundationVideos = initialResultSets[0].length
    ? initialResultSets[0]
    : initialVideos.slice(0, 2);
  const sourceTerms = termsFromSources(foundationVideos, skill);
  const sourceLedQuery = [
    skill,
    physicsFoundationTerms(skill),
    sourceTerms.join(' '),
    level,
    'video lesson',
  ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const sourceLedSearchUsed = sourceTerms.length > 0 || Boolean(physicsFoundationTerms(skill));
  const sourceLedVideos = sourceLedSearchUsed
    ? await searchVideos(sourceLedQuery, 'Source-led foundations', 4).catch((error) => {
      searchErrors.push(error.message);
      return [];
    })
    : [];
  const seen = new Set();
  const allVideos = [...initialVideos, ...sourceLedVideos];
  const sources = allVideos.filter((video) => {
    if (seen.has(video.videoId)) return false;
    seen.add(video.videoId);
    return true;
  }).slice(0, 6).map((video, index) => ({ id: `S${index + 1}`, ...video }));
  return {
    sources,
    searchErrors,
    angles: [...searchAngles.map(({ name }) => name), ...(sourceLedSearchUsed ? ['Source-led foundations'] : [])],
    queries: [...initialSearches.map(({ query }) => query), ...(sourceLedSearchUsed ? [sourceLedQuery] : [])],
  };
}

function jsonResponse(body, status, origin) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
  });
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type');
    headers.set('Access-Control-Max-Age', '86400');
  }
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
}

async function readJsonBody(request) {
  if (Number(request.headers.get('content-length')) > 10_000) {
    throw new Error('The request body is too large.');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new Error('The request body must be valid JSON.');
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 10_000) {
      await reader.cancel();
      throw new Error('The request body is too large.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('The request body must be valid JSON.');
  }
}

async function handleRequest(request, env) {
  const origin = request.headers.get('origin');
  const allowedOrigin = env.ALLOWED_ORIGIN;
  const originAllowed = !origin || origin === allowedOrigin;
  if (!originAllowed) return jsonResponse({ error: 'This website is not allowed to use the video search API.' }, 403);

  const url = new URL(request.url);
  if (url.pathname === '/health' && request.method === 'GET') {
    return jsonResponse({ status: 'ok' }, 200, origin);
  }
  if (url.pathname !== '/api/generate-path') {
    return jsonResponse({ error: 'Not found.' }, 404, origin);
  }
  if (request.method === 'OPTIONS') return jsonResponse({}, 204, origin);
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Use POST to search for videos.' }, 405, origin);
  }

  let input;
  try {
    input = await readJsonBody(request);
  } catch (error) {
    const status = error.message === 'The request body is too large.' ? 413 : 400;
    return jsonResponse({ error: error.message }, status, origin);
  }
  const { skill, level } = input || {};
  if (typeof skill !== 'string' || !skill.trim() || skill.length > 70) {
    return jsonResponse({ error: 'Enter a skill or subject up to 70 characters.' }, 400, origin);
  }
  if (!['Beginner', 'Comfortable', 'Advanced'].includes(level)) {
    return jsonResponse({ error: 'Choose a valid starting level.' }, 400, origin);
  }

  try {
    const research = await researchSkill(skill.trim(), level);
    if (!research.sources.length) {
      const providerError = research.searchErrors[0];
      return jsonResponse({
        error: providerError
          ? `Could not search YouTube: ${providerError}`
          : 'No matching YouTube videos were found. Try a more specific topic.',
        research,
      }, 502, origin);
    }

    const lessons = research.sources.map((source) => ({
      title: source.title.slice(0, 100),
      detail: `${source.angle} · YouTube video${source.duration ? ` · ${source.duration}` : ''}${source.snippet ? ` · ${source.snippet}` : ''}`.slice(0, 140),
      minutes: durationInMinutes(source.duration),
      sourceIds: [source.id],
      done: false,
    }));
    return jsonResponse({ lessons, research }, 200, origin);
  } catch (error) {
    return jsonResponse({ error: error.message || 'Could not create a learning path.' }, 502, origin);
  }
}

export { durationInMinutes, handleRequest, researchSkill };

export default {
  fetch: handleRequest,
};
