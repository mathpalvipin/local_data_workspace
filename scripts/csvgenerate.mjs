import { createWriteStream } from 'node:fs';
import { mkdirSync } from 'node:fs';

const ROWS = 500_000;
const STATUSES = ['pending', 'active', 'suspended', 'closed', 'trial', 'churned', 'review', 'archived'];
const REGIONS = ['us-east', 'us-west', 'eu-central', 'ap-south', 'sa-east'];

mkdirSync('data', { recursive: true });
const out = createWriteStream('data/large.csv');

// Header row. Column names are deliberately boring — you don't want to be
// squinting at "col_7" when you're deep in a profiling session at 1am.
out.write('id,email,name,region,status,score,balance,signup_date,last_login,notes\n');

// A seeded PRNG instead of Math.random(). This matters more than it looks:
// when you're comparing a profile from Tuesday against one from Thursday,
// you need byte-identical input. Otherwise you're measuring noise.
let seed = 42;
function rand() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}

function pick(arr) {
  return arr[Math.floor(rand() * arr.length)];
}

async function generate() {
  // Build rows in batches and write the batch as one string. Writing
  // row-by-row means 500k stream writes and 500k tiny buffers; batching
  // cuts that to 500. This is the exact same lesson as batching postMessage
  // later — per-item overhead dominates when N is large.
  const BATCH = 1000;
  let batch = [];

  for (let i = 0; i < ROWS; i++) {
    const status = pick(STATUSES);
    const signup = new Date(2020, 0, 1 + Math.floor(rand() * 2000));

    // ~8% of rows have a missing last_login. Real data is full of holes and
    // you want to hit that case from day one rather than discovering it
    // when your date sort throws on undefined.
    const lastLogin = rand() > 0.08
      ? new Date(signup.getTime() + rand() * 6e10).toISOString().slice(0, 10)
      : '';

    // One field with an embedded comma and quotes, on purpose. This is the
    // landmine that breaks every hand-rolled parser. If your pipeline
    // survives this column, it'll survive real files.
    const notes = rand() > 0.9
      ? `"Escalated, priority ${Math.floor(rand() * 5)}"`
      : 'ok';

    batch.push([
      i,
      `user${i}@example.com`,          // high-cardinality: worst-case memory
      `Person ${Math.floor(rand() * 50000)}`,
      pick(REGIONS),                    // low-cardinality: dictionary candidate
      status,                           // low-cardinality
      (rand() * 100).toFixed(2),        // numeric: float
      Math.floor(rand() * 1_000_000),   // numeric: int
      signup.toISOString().slice(0, 10),
      lastLogin,                        // nullable
      notes,
    ].join(','));

    if (batch.length >= BATCH) {
      // The backpressure check. write() returns false when the internal
      // buffer is full; if you ignore it and keep writing, Node buffers
      // the whole file in memory and you OOM around 200MB. Waiting for
      // 'drain' is what makes this a stream rather than a slow way to
      // build one enormous string.
      if (!out.write(batch.join('\n') + '\n')) {
        await new Promise(resolve => out.once('drain', resolve));
      }
      batch = [];
    }
  }

  if (batch.length) out.write(batch.join('\n') + '\n');
  out.end();
}

generate().then(() => console.log('done'));