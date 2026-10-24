import { enc, toB64 } from './utils.js';

const MIN_PREFIX = 3;  
const MAX_PREFIX = 12;
const MAX_TOKENS = 64;

const words = (text) =>
  String(text).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 2);

async function token(searchKey, term) {
  const mac = await crypto.subtle.sign('HMAC', searchKey, enc.encode(`sv-search-v1:${term}`));
  return toB64(mac).slice(0, 22); 
}

export async function indexTokens(searchKey, filename) {
  const terms = new Set();
  for (const w of words(filename)) {
    const cap = Math.min(w.length, MAX_PREFIX);
    if (w.length < MIN_PREFIX) terms.add(w);
    for (let n = MIN_PREFIX; n <= cap; n++) terms.add(w.slice(0, n));
  }
  return Promise.all([...terms].slice(0, MAX_TOKENS).map((t) => token(searchKey, t)));
}

export async function queryTokens(searchKey, query) {
  const terms = [...new Set(words(query).map((w) => w.slice(0, MAX_PREFIX)))].slice(0, 8);
  return Promise.all(terms.map((t) => token(searchKey, t)));
}