import fs from 'node:fs/promises';
import path from 'node:path';

const USERNAME = process.env.GITHUB_USER || 'Mozeel-V';
const OUTPUT_PATH = process.env.OUTPUT_PATH || 'assets/language-pie-chart.svg';
const TOKEN = process.env.GITHUB_TOKEN || '';
const TOP_COUNT = 5;
const COLORS = ['#3b82f6', '#f59e0b', '#ef4444', '#10b981', '#8b5cf6', '#64748b'];

const headers = {
  Accept: 'application/vnd.github+json',
  'User-Agent': `${USERNAME}-language-chart`,
};

if (TOKEN) {
  headers.Authorization = 'Bearer ' + TOKEN;
}

const escapeXml = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

const toPercent = (value, total) => ((value / total) * 100).toFixed(1);

function polarToCartesian(cx, cy, radius, angleInDegrees) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(angleInRadians),
    y: cy + radius * Math.sin(angleInRadians),
  };
}

function describeSlice(cx, cy, radius, startAngle, endAngle, fill) {
  const start = polarToCartesian(cx, cy, radius, endAngle);
  const end = polarToCartesian(cx, cy, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
  return `<path d="M ${cx} ${cy} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y} Z" fill="${fill}" />`;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`GitHub API request failed (${response.status}): ${url}`);
  }
  return response.json();
}

async function fetchAllRepos(username) {
  const repos = [];
  let page = 1;

  while (true) {
    const url = `https://api.github.com/users/${username}/repos?type=owner&per_page=100&page=${page}`;
    const batch = await fetchJson(url);
    if (!Array.isArray(batch) || batch.length === 0) {
      break;
    }
    repos.push(...batch);
    if (batch.length < 100) {
      break;
    }
    page += 1;
  }

  return repos.filter((repo) => !repo.fork && !repo.archived);
}

async function aggregateLanguages(repos) {
  const totals = new Map();

  for (const repo of repos) {
    const languages = await fetchJson(repo.languages_url);
    for (const [language, bytes] of Object.entries(languages)) {
      totals.set(language, (totals.get(language) || 0) + bytes);
    }
  }

  return [...totals.entries()].sort((a, b) => b[1] - a[1]);
}

function buildDistribution(entries) {
  const totalBytes = entries.reduce((sum, [, bytes]) => sum + bytes, 0);
  const top = entries.slice(0, TOP_COUNT);
  const otherBytes = entries.slice(TOP_COUNT).reduce((sum, [, bytes]) => sum + bytes, 0);
  const distribution = [...top];

  if (otherBytes > 0) {
    distribution.push(['Other', otherBytes]);
  }

  return { distribution, totalBytes };
}

function buildSvg(distribution, totalBytes) {
  const cx = 210;
  const cy = 195;
  const radius = 110;

  let currentAngle = 0;
  const slices = [];

  distribution.forEach(([, bytes], index) => {
    const percentage = (bytes / totalBytes) * 100;
    const sliceAngle = (percentage / 100) * 360;
    const startAngle = currentAngle;
    const endAngle = currentAngle + sliceAngle;
    const color = COLORS[index % COLORS.length];
    slices.push(describeSlice(cx, cy, radius, startAngle, endAngle, color));
    currentAngle = endAngle;
  });

  const legend = distribution
    .map(([language, bytes], index) => {
      const y = 95 + index * 38;
      const color = COLORS[index % COLORS.length];
      const pct = toPercent(bytes, totalBytes);
      return `
    <rect x="0" y="${y}" width="18" height="18" rx="3" fill="${color}" />
    <text x="30" y="${y + 14}" class="label">${escapeXml(language)}</text>
    <text x="220" y="${y + 14}" class="value">${pct}%</text>`;
    })
    .join('\n');

  const updatedAt = new Date().toISOString().slice(0, 10);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="820" height="390" viewBox="0 0 820 390" role="img" aria-labelledby="title desc">
  <title id="title">Language Distribution</title>
  <desc id="desc">Auto-generated pie chart of primary programming languages across repositories.</desc>
  <style>
    .bg { fill: #0f172a; }
    .label { font: 600 16px 'Segoe UI', Arial, sans-serif; fill: #e5e7eb; }
    .value { font: 500 14px 'Segoe UI', Arial, sans-serif; fill: #cbd5e1; }
    .title { font: 700 22px 'Segoe UI', Arial, sans-serif; fill: #f8fafc; }
    .subtitle { font: 500 13px 'Segoe UI', Arial, sans-serif; fill: #94a3b8; }
  </style>
  <rect width="820" height="390" class="bg" rx="12" />
  <text x="38" y="46" class="title">Project Language Distribution</text>
  <text x="38" y="68" class="subtitle">Auto-updated via GitHub Actions • Last refresh: ${updatedAt}</text>
  <g>
    ${slices.join('\n    ')}
    <circle cx="${cx}" cy="${cy}" r="56" fill="#0f172a" />
    <text x="${cx}" y="${cy - 2}" text-anchor="middle" class="label">Languages</text>
    <text x="${cx}" y="${cy + 18}" text-anchor="middle" class="value">${distribution.length} groups</text>
  </g>
  <g transform="translate(430,0)">
    ${legend}
  </g>
</svg>`;
}

async function main() {
  const repos = await fetchAllRepos(USERNAME);
  const entries = await aggregateLanguages(repos);
  if (entries.length === 0) {
    throw new Error('No language data found from GitHub API.');
  }

  const { distribution, totalBytes } = buildDistribution(entries);
  const svg = buildSvg(distribution, totalBytes);

  const absoluteOutputPath = path.resolve(OUTPUT_PATH);
  await fs.mkdir(path.dirname(absoluteOutputPath), { recursive: true });
  await fs.writeFile(absoluteOutputPath, svg, 'utf8');

  console.log(`Generated ${absoluteOutputPath} from ${repos.length} repositories.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
