import './link-hub.css';

const groups = [
  {
    title: 'Learn something new',
    description: 'Good places to start when you want to explore a subject.',
    links: [
      {
        name: 'Khan Academy',
        url: 'https://www.khanacademy.org/',
        detail: 'Free lessons across math, science, computing, and more.',
      },
      {
        name: 'Coursera',
        url: 'https://www.coursera.org/',
        detail: 'Online courses and guided learning from universities.',
      },
      {
        name: 'edX',
        url: 'https://www.edx.org/',
        detail: 'Explore courses from schools and organizations around the world.',
      },
    ],
  },
  {
    title: 'Build your skills',
    description: 'Hands-on resources for making things and learning by doing.',
    links: [
      {
        name: 'freeCodeCamp',
        url: 'https://www.freecodecamp.org/learn/',
        detail: 'Practice coding with free, interactive projects and courses.',
      },
      {
        name: 'MDN Web Docs',
        url: 'https://developer.mozilla.org/',
        detail: 'A trusted reference for web development.',
      },
      {
        name: 'roadmap.sh',
        url: 'https://roadmap.sh/',
        detail: 'Visual roadmaps for exploring technology careers and skills.',
      },
    ],
  },
  {
    title: 'Find inspiration',
    description: 'Browse ideas, creators, and projects worth exploring.',
    links: [
      {
        name: 'YouTube',
        url: 'https://www.youtube.com/',
        detail: 'Watch tutorials, talks, and demonstrations on almost any topic.',
      },
      {
        name: 'GitHub',
        url: 'https://github.com/explore',
        detail: 'Discover projects and learn from how others build.',
      },
    ],
  },
];

const app = document.querySelector('#app');

app.innerHTML = `
  <main class="page">
    <header class="site-header">
      <a class="brand" href="./" aria-label="Pathwise home">
        <span class="brand-mark" aria-hidden="true">P</span>
        <span>Pathwise</span>
      </a>
      <span class="header-note">A little direction goes a long way.</span>
    </header>

    <section class="intro" aria-labelledby="page-title">
      <p class="eyebrow">A collection for curious minds</p>
      <h1 id="page-title">Good places to <span>go next.</span></h1>
      <p class="intro-copy">A simple list of useful places to learn, make, and find your next idea.</p>
    </section>

    <div class="link-groups">
      ${groups.map((group, groupIndex) => `
        <section class="link-group" aria-labelledby="group-${groupIndex}">
          <div class="group-heading">
            <h2 id="group-${groupIndex}">${group.title}</h2>
            <p>${group.description}</p>
          </div>
          <div class="link-list">
            ${group.links.map((link) => `
              <a class="link-card" href="${link.url}" target="_blank" rel="noopener noreferrer">
                <span class="link-copy">
                  <strong>${link.name}</strong>
                  <span>${link.detail}</span>
                </span>
                <span class="link-arrow" aria-hidden="true">↗</span>
              </a>
            `).join('')}
          </div>
        </section>
      `).join('')}
    </div>

    <footer class="site-footer">
      <span>Keep following what makes you curious.</span>
      <span>Pathwise · Useful links, all in one place.</span>
    </footer>
  </main>
`;
