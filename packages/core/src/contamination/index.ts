/** @openagentaudit/core/contamination */
import type { CanonicalEvent } from '@openagentaudit/schema';

export interface ContaminationPair {
  train_event_id: string;
  test_event_id: string;
  similarity: number;
  method: 'exact' | 'ngram' | 'minhash';
}

export interface ContaminationResult {
  candidate_pairs: number;
  high_similarity_pairs: number;
  threshold: number;
  method: 'exact' | 'ngram' | 'minhash';
  pairs: ContaminationPair[];
  contamination_score: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function exactSimilarity(train: CanonicalEvent, test: CanonicalEvent): number {
  if (train.event_id === test.event_id) return 1.0;
  if (train.tool?.name !== undefined && train.tool.name === test.tool?.name && train.type === test.type) return 0.9;
  if (train.type === test.type && train.actor === test.actor) return 0.5;
  return 0.0;
}

function tokenString(ev: CanonicalEvent): string {
  return [ev.type, ev.actor, ev.tool?.name ?? '', ev.observation?.source ?? '']
    .filter(Boolean)
    .join(' ');
}

function charTriGrams(s: string): Set<string> {
  const grams = new Set<string>();
  for (let i = 0; i + 2 < s.length; i++) {
    grams.add(s.slice(i, i + 3));
  }
  return grams;
}

function jaccardSets(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1.0;
  let intersection = 0;
  for (const v of a) {
    if (b.has(v)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 1.0 : intersection / union;
}

function ngramSimilarity(train: CanonicalEvent, test: CanonicalEvent): number {
  // Pre-filter: only compare if same type
  if (train.type !== test.type) return 0.0;
  const gA = charTriGrams(tokenString(train));
  const gB = charTriGrams(tokenString(test));
  return jaccardSets(gA, gB);
}

function minHashForSeed(tokens: string[], seed: number): number {
  let minVal = 0xffffffff;
  for (const token of tokens) {
    let h = seed;
    for (let i = 0; i < token.length; i++) {
      h = ((h * 31 + token.charCodeAt(i)) & 0xffffffff) >>> 0;
    }
    if (h < minVal) minVal = h;
  }
  return minVal;
}

const MINHASH_NUM_HASHES = 16;

function minhashSignature(ev: CanonicalEvent): number[] {
  const tokens = tokenString(ev).split(' ').filter(Boolean);
  const sig: number[] = [];
  for (let s = 0; s < MINHASH_NUM_HASHES; s++) {
    sig.push(minHashForSeed(tokens, s));
  }
  return sig;
}

function minhashSimilarity(sigA: number[], sigB: number[]): number {
  let matches = 0;
  for (let i = 0; i < MINHASH_NUM_HASHES; i++) {
    if (sigA[i] === sigB[i]) matches++;
  }
  return matches / MINHASH_NUM_HASHES;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function contamination(
  trainEvents: CanonicalEvent[],
  testEvents: CanonicalEvent[],
  opts?: { threshold?: number; method?: 'exact' | 'ngram' | 'minhash' },
): Promise<ContaminationResult> {
  const threshold = opts?.threshold ?? 0.8;
  const totalPairs = trainEvents.length * testEvents.length;
  const method: 'exact' | 'ngram' | 'minhash' =
    opts?.method ?? (totalPairs <= 10000 ? 'exact' : 'ngram');

  const pairs: ContaminationPair[] = [];

  if (method === 'exact') {
    for (const train of trainEvents) {
      for (const test of testEvents) {
        const similarity = exactSimilarity(train, test);
        if (similarity >= threshold) {
          pairs.push({ train_event_id: train.event_id, test_event_id: test.event_id, similarity, method });
        }
      }
    }
  } else if (method === 'ngram') {
    for (const train of trainEvents) {
      for (const test of testEvents) {
        const similarity = ngramSimilarity(train, test);
        if (similarity >= threshold) {
          pairs.push({ train_event_id: train.event_id, test_event_id: test.event_id, similarity, method });
        }
      }
    }
  } else {
    // minhash
    const trainSigs = trainEvents.map(ev => minhashSignature(ev));
    const testSigs = testEvents.map(ev => minhashSignature(ev));

    for (let ti = 0; ti < trainEvents.length; ti++) {
      for (let tj = 0; tj < testEvents.length; tj++) {
        const trainEv = trainEvents[ti];
        const testEv = testEvents[tj];
        const trainSig = trainSigs[ti];
        const testSig = testSigs[tj];
        if (trainEv === undefined || testEv === undefined || trainSig === undefined || testSig === undefined) continue;
        const similarity = minhashSimilarity(trainSig, testSig);
        if (similarity >= threshold) {
          pairs.push({ train_event_id: trainEv.event_id, test_event_id: testEv.event_id, similarity, method });
        }
      }
    }
  }

  const candidate_pairs = totalPairs;
  const high_similarity_pairs = pairs.length;
  const contamination_score = Math.min(
    100,
    Math.round((high_similarity_pairs / Math.max(candidate_pairs, 1)) * 500),
  );

  return {
    candidate_pairs,
    high_similarity_pairs,
    threshold,
    method,
    pairs,
    contamination_score,
  };
}
