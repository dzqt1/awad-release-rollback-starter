// npm run rollback
const CONTROL = process.env.CONTROL ?? 'http://127.0.0.1:8081';

async function requestJson(path, options = {}) {
  const response = await fetch(`${CONTROL}${path}`, {
    ...options,
    signal: options.signal ?? AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${options.method ?? 'GET'} ${CONTROL}${path} returned ${response.status}: ${text}`);
  }
  return response.json();
}

async function mark(text) {
  await fetch(`${CONTROL}/mark`, { method: 'POST', body: text }).catch(() => {});
}

try {
  const state = await requestJson('/state');
  const blueActive = state.slots.blue.weight === 100;
  const greenActive = state.slots.green.weight === 100;
  if (!blueActive && !greenActive) {
    throw new Error('router is not currently serving 100% on one slot');
  }

  const targetSlot = blueActive ? 'green' : 'blue';
  const weights = targetSlot === 'blue' ? { blue: 100, green: 0 } : { blue: 0, green: 100 };
  await requestJson('/weights', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(weights),
  });

  const confirmed = await requestJson('/state');
  if (confirmed.slots[targetSlot].weight !== 100 ||
      confirmed.slots[targetSlot === 'blue' ? 'green' : 'blue'].weight !== 0) {
    throw new Error(`router did not confirm rollback to ${targetSlot}`);
  }

  await mark(`rollback traffic to ${targetSlot}`);
  console.log('done');
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
