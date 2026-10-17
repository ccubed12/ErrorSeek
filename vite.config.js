import { defineConfig, loadEnv } from 'vite';

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

function learningPathApi(env) {
  const registerMiddleware = (server) => {
    const sendJson = (response, status, body) => {
      response.statusCode = status;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(body));
    };
    const readBody = async (request) => {
      let rawBody = '';
      for await (const chunk of request) {
        rawBody += chunk;
        if (rawBody.length > 10_000) throw new Error('Request is too large.');
      }
      return JSON.parse(rawBody);
    };
    const stripePrices = {
      monthly: env.STRIPE_PLUS_MONTHLY_PRICE_ID,
      annual: env.STRIPE_PLUS_ANNUAL_PRICE_ID,
    };
    const stripeConfigured = Boolean(env.STRIPE_SECRET_KEY && stripePrices.monthly && stripePrices.annual);

    server.middlewares.use('/api/create-checkout-session', async (request, response) => {
      if (request.method !== 'POST') return sendJson(response, 405, { error: 'Use POST to start checkout.' });
      if (!stripeConfigured) return sendJson(response, 503, { error: 'Stripe is not configured. Set STRIPE_SECRET_KEY and both Plus price IDs in the server environment.' });
      try {
        const input = await readBody(request);
        if (!input || !['monthly', 'annual'].includes(input.interval)) {
          return sendJson(response, 400, { error: 'Choose a valid billing interval.' });
        }
        const priceId = stripePrices[input.interval];
        const protocol = request.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
        const origin = `${protocol}://${request.headers.host || 'localhost:5173'}`;
        const form = new URLSearchParams({
          mode: 'subscription',
          success_url: `${origin}/?checkout_session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${origin}/?checkout_cancelled=1`,
          'line_items[0][price]': priceId,
          'line_items[0][quantity]': '1',
        });
        const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: form,
        });
        const result = await stripeResponse.json();
        if (!stripeResponse.ok) throw new Error(result.error?.message || 'Stripe could not create a checkout session.');
        return sendJson(response, 200, { url: result.url });
      } catch (error) {
        return sendJson(response, 502, { error: error.message || 'Could not start Stripe checkout.' });
      }
    });

    server.middlewares.use('/api/verify-checkout', async (request, response) => {
      if (request.method !== 'POST') return sendJson(response, 405, { error: 'Use POST to verify checkout.' });
      if (!stripeConfigured) return sendJson(response, 503, { error: 'Stripe is not configured on this server.' });
      try {
        const input = await readBody(request);
        if (typeof input.sessionId !== 'string' || !/^cs_(test|live)_[A-Za-z0-9]+$/.test(input.sessionId)) {
          return sendJson(response, 400, { error: 'Invalid Checkout session.' });
        }
        const url = new URL(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(input.sessionId)}`);
        url.searchParams.append('expand[]', 'line_items');
        const stripeResponse = await fetch(url, {
          headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
        });
        const session = await stripeResponse.json();
        if (!stripeResponse.ok) throw new Error(session.error?.message || 'Stripe could not verify this session.');
        const hasPlusPrice = session.line_items?.data?.some((item) => Object.values(stripePrices).includes(item.price?.id));
        const verified = session.status === 'complete' && session.payment_status === 'paid' && hasPlusPrice;
        if (!verified) return sendJson(response, 402, { verified: false, error: 'This checkout session does not have a completed Plus payment.' });
        return sendJson(response, 200, { verified: true });
      } catch (error) {
        return sendJson(response, 502, { verified: false, error: error.message || 'Could not verify payment.' });
      }
    });

    server.middlewares.use('/api/generate-path', async (request, response) => {
      response.setHeader('Content-Type', 'application/json');
      if (request.method !== 'POST') {
        response.statusCode = 405;
        response.setHeader('Allow', 'POST');
        response.end(JSON.stringify({ error: 'Use POST to search for videos.' }));
        return;
      }

      let research;
      try {
        let rawBody = '';
        for await (const chunk of request) {
          rawBody += chunk;
          if (rawBody.length > 10_000) throw new Error('Request is too large.');
        }
        let input;
        try {
          input = JSON.parse(rawBody);
        } catch {
          response.statusCode = 400;
          throw new Error('The request body must be valid JSON.');
        }
        const { skill, level, weeklyHours } = input;
        if (typeof skill !== 'string' || !skill.trim() || skill.length > 70) {
          response.statusCode = 400;
          throw new Error('Enter a skill or subject up to 70 characters.');
        }
        if (!['Beginner', 'Comfortable', 'Advanced'].includes(level)) {
          response.statusCode = 400;
          throw new Error('Choose a valid starting level.');
        }

        research = await researchSkill(skill.trim(), level);
        if (!research.sources.length) {
          const providerError = research.searchErrors[0];
          throw new Error(providerError
            ? `Could not search YouTube: ${providerError}`
            : 'No matching YouTube videos were found. Try a more specific topic.');
        }

        const lessons = research.sources.map((source) => ({
          title: source.title.slice(0, 100),
          detail: `${source.angle} · YouTube video${source.duration ? ` · ${source.duration}` : ''}${source.snippet ? ` · ${source.snippet}` : ''}`.slice(0, 140),
          minutes: durationInMinutes(source.duration),
          sourceIds: [source.id],
          done: false,
        }));
        response.statusCode = 200;
        response.end(JSON.stringify({ lessons, research }));
      } catch (error) {
        response.statusCode = response.statusCode === 400 ? 400 : 502;
        response.end(JSON.stringify({ error: error.message || 'Could not create a learning path.', research }));
      }
    });
  };

  return {
    name: 'learning-path-api',
    configureServer: registerMiddleware,
    configurePreviewServer: registerMiddleware,
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [learningPathApi(loadEnv(mode, process.cwd(), ''))],
}));
