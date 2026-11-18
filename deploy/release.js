// npm run release -- <tag>
import { spawnSync } from 'node:child_process';

const CONTROL = process.env.CONTROL ?? 'http://127.0.0.1:8081';
const FIRST_CANARY_PERCENT = 10;
const SECOND_CANARY_PERCENT = 25;
const FIRST_STAGE_MIN_MS = 10_000;

// 5% is above ordinary random noise but catches the drill, which fails 30% of read-style
// traffic. Wait for 30 canary requests so a few early failures cannot decide by themselves.
const CANARY_ERROR_RATIO = 0.05;
const MIN_CANARY_REQUESTS = 30;

const tag = process.argv[2];
if (!tag) {
  console.error('usage: npm run release -- <tag>');
  process.exit(2);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: options.signal ?? AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${options.method ?? 'GET'} ${url} returned ${response.status}: ${text}`);
  }
  return response.json();
}

async function getState() {
  return jsonFetch(`${CONTROL}/state`);
}

async function setWeights(blue, green) {
  await jsonFetch(`${CONTROL}/weights`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ blue, green }),
  });
  const state = await getState();
  if (state.slots.blue.weight !== blue || state.slots.green.weight !== green) {
    throw new Error(`router did not confirm weights blue=${blue}, green=${green}`);
  }
  return state;
}

async function mark(text) {
  await fetch(`${CONTROL}/mark`, { method: 'POST', body: text }).catch(() => {});
}

function dockerCompose(slot, tag) {
  const envName = slot === 'blue' ? 'BLUE_TAG' : 'GREEN_TAG';
  const r = spawnSync('docker', ['compose', 'up', '-d', '--no-deps', slot], {
    encoding: 'utf8',
    timeout: 120_000,
    killSignal: 'SIGKILL',
    env: { ...process.env, [envName]: tag },
  });
  if (r.status !== 0) {
    throw new Error(`could not start ${slot} with ${tag}: ${(r.stderr || r.stdout).trim()}`);
  }
}

async function waitForHealthy(slot) {
  const names = spawnSync('docker', ['compose', 'ps', '--format', '{{.Name}}', slot], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (names.status !== 0) throw new Error(`could not find container for slot ${slot}`);
  const name = names.stdout.trim().split(/\r?\n/).find(Boolean);
  if (!name) throw new Error(`slot ${slot} has no running container`);

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const inspect = spawnSync('docker', ['inspect', '-f',
      '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}', name], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    const status = inspect.stdout.trim();
    if (inspect.status === 0 && status === 'healthy') return name;
    if (inspect.status === 0 && status === 'exited') {
      throw new Error(`slot ${slot} container exited before becoming healthy`);
    }
    await sleep(250);
  }
  throw new Error(`slot ${slot} did not become healthy within 60 seconds`);
}

async function canaryIsHealthy(slot, baseline, startedAt) {
  const state = await getState();
  const now = state.slots[slot];
  const requests = now.requests - baseline.requests;
  const errors = now.errors - baseline.errors;
  if (Date.now() - startedAt < FIRST_STAGE_MIN_MS) return { ok: true, state, requests, errors };
  if (requests < MIN_CANARY_REQUESTS) return { ok: true, state, requests, errors };
  const ratio = errors / requests;
  return {
    ok: ratio <= CANARY_ERROR_RATIO,
    state,
    requests,
    errors,
    ratio,
  };
}

try {
  const initial = await getState();
  const blueWeight = initial.slots.blue.weight;
  const greenWeight = initial.slots.green.weight;
  let slot;
  let oldSlot;

  if (blueWeight === 100 && greenWeight === 0) {
    slot = 'green';
    oldSlot = 'blue';
  } else if (greenWeight === 100 && blueWeight === 0) {
    slot = 'blue';
    oldSlot = 'green';
  } else {
    throw new Error(`cannot identify idle slot from router state: blue=${blueWeight}, green=${greenWeight}`);
  }

  if (tag === 'v2') {
    await mark(`migration up from linkbox:${tag}`);
  }
  dockerCompose(slot, tag);
  await mark(`release ${tag} preparing slot ${slot}`);
  await waitForHealthy(slot);
  await mark(`release ${tag} slot ${slot} healthy`);

  const firstWeights = slot === 'blue'
    ? { blue: FIRST_CANARY_PERCENT, green: 100 - FIRST_CANARY_PERCENT }
    : { blue: 100 - FIRST_CANARY_PERCENT, green: FIRST_CANARY_PERCENT };
  let state = await setWeights(firstWeights.blue, firstWeights.green);
  const baseline = { ...state.slots[slot] };
  const startedAt = Date.now();
  await mark(`release ${tag} canary ${slot}=${FIRST_CANARY_PERCENT}%`);

  while (true) {
    await sleep(500);
    const result = await canaryIsHealthy(slot, baseline, startedAt);
    if (!result.ok) {
      await setWeights(oldSlot === 'blue' ? 100 : 0, oldSlot === 'green' ? 100 : 0);
      await mark(`release ${tag} gate stopped canary ${slot}: ${result.errors}/${result.requests}=${(result.ratio * 100).toFixed(1)}%`);
      console.log(`gate rollback: canary error rate ${(result.ratio * 100).toFixed(1)}% (${result.errors}/${result.requests})`);
      console.log('done');
      process.exit(0);
    }

    if (Date.now() - startedAt >= FIRST_STAGE_MIN_MS && result.requests >= MIN_CANARY_REQUESTS) break;
  }

  const secondWeights = slot === 'blue'
    ? { blue: SECOND_CANARY_PERCENT, green: 100 - SECOND_CANARY_PERCENT }
    : { blue: 100 - SECOND_CANARY_PERCENT, green: SECOND_CANARY_PERCENT };
  state = await setWeights(secondWeights.blue, secondWeights.green);
  await mark(`release ${tag} canary ${slot}=${SECOND_CANARY_PERCENT}%`);

  const secondBaseline = { ...state.slots[slot] };
  const secondStartedAt = Date.now();
  while (Date.now() - secondStartedAt < 5_000) {
    await sleep(500);
    const now = await getState();
    const requests = now.slots[slot].requests - secondBaseline.requests;
    const errors = now.slots[slot].errors - secondBaseline.errors;
    if (requests >= MIN_CANARY_REQUESTS && errors / requests > CANARY_ERROR_RATIO) {
      await setWeights(oldSlot === 'blue' ? 100 : 0, oldSlot === 'green' ? 100 : 0);
      await mark(`release ${tag} gate stopped canary ${slot} at ${SECOND_CANARY_PERCENT}%`);
      console.log(`gate rollback: canary error threshold exceeded at ${SECOND_CANARY_PERCENT}%`);
      console.log('done');
      process.exit(0);
    }
  }

  const finalWeights = slot === 'blue' ? { blue: 100, green: 0 } : { blue: 0, green: 100 };
  await setWeights(finalWeights.blue, finalWeights.green);
  await mark(`release ${tag} promoted ${slot}=100%`);
  console.log(`done: ${slot} is at 100% with ${tag}; ${oldSlot} remains running`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
