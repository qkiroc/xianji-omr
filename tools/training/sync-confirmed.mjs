#!/usr/bin/env node
// Read-only platform download using existing CLI authorization.
import {createHash, randomUUID} from 'node:crypto';
import {mkdir, readFile, writeFile, rename, unlink, statfs, stat, open} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {resolve, dirname, join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {normalizeOrigin, readCredential, requireTransport} from '../cli/src/credentials.mjs';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA = /^[a-f0-9]{64}$/;
const EXT = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp'};
const log = value => console.log(JSON.stringify({at: new Date().toISOString(), ...value}));
export const digest = value => createHash('sha256').update(value).digest('hex');
export async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
export async function atomicJSON(path, value) {
  await mkdir(dirname(path), {recursive: true});
  const part = path + '.' + randomUUID() + '.partial';
  try {await writeFile(part, JSON.stringify(value, null, 2) + '\n'); await rename(part, path);}
  finally {await unlink(part).catch(() => {});}
}
async function cachedJSON(path) {
  try {return JSON.parse(await readFile(path, 'utf8'));}
  catch (error) {if (error.code === 'ENOENT') return null; throw error;}
}
export async function credentials(origin) {
  let credential = await readCredential(origin);
  if (!credential && !process.env.XDG_CONFIG_HOME) {
    process.env.XDG_CONFIG_HOME = join(ROOT, '.artifacts/cli-config');
    credential = await readCredential(origin);
  }
  if (!credential) throw Error('CLI_AUTH_REQUIRED: authorize with tools/cli/xianji-omr.mjs auth first');
  return credential;
}
export function makeAPI(origin, token, fetcher = fetch) {
  return async path => {
    if (!path.startsWith('/api/v2/') || path.includes('://')) throw Error('Invalid API path');
    for (let attempt = 0; attempt < 3; attempt++) {
      let response;
      try {
        response = await fetcher(origin + path, {method: 'GET', headers: {Authorization: 'Bearer ' + token},
          redirect: 'error', signal: AbortSignal.timeout(120000)});
      } catch (error) {
        const code = error.cause?.code || error.code || error.name;
        if (code === 'EACCES' || attempt === 2) throw Error('NETWORK: ' + code);
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); continue;
      }
      if (response.ok) return response;
      await response.body?.cancel();
      if (![429, 502, 503, 504].includes(response.status) || attempt === 2)
        throw Error('HTTP_' + response.status + ': ' + path);
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    }
  };
}
export async function catalogue(api, datasetIds) {
  const datasets = await (await api('/api/v2/datasets')).json();
  if (!Array.isArray(datasets)) throw Error('Invalid datasets response');
  const selected = datasetIds.length ? datasets.filter(d => datasetIds.includes(d.id)) : datasets;
  if (datasetIds.some(id => !selected.some(d => d.id === id))) throw Error('Unknown or deleted dataset');
  const rows = [];
  for (const dataset of selected) {
    if (!UUID.test(dataset.id)) throw Error('Invalid dataset id');
    let total, count = 0;
    for (let page = 1; ; page++) {
      const result = await (await api(`/api/v2/datasets/${dataset.id}/pages?status=confirmed&pageSize=100&page=${page}`)).json();
      if (!Array.isArray(result.items) || !Number.isSafeInteger(result.total)) throw Error('Invalid catalogue');
      if (total !== undefined && total !== result.total) throw Error('CATALOGUE_CHANGED: rerun to resume');
      total = result.total;
      for (const item of result.items) {
        if (!UUID.test(item.id) || item.status !== 'confirmed' || item.deletedAt)
          throw Error('Catalogue contains an unconfirmed/deleted/invalid page');
        rows.push({...item, datasetId: dataset.id, datasetName: dataset.name}); count++;
      }
      if (page * 100 >= total) break;
      if (!result.items.length) throw Error('Truncated catalogue');
    }
    if(count !== total) throw Error('CATALOGUE_CHANGED: unexpected count');
  }
  if (new Set(rows.map(r => r.id)).size !== rows.length) throw Error('CATALOGUE_CHANGED: duplicated page, rerun');
  return rows.sort((a, b) => a.id.localeCompare(b.id));
}
export function membership(rows) {
  return digest(JSON.stringify(rows.map(r => [r.id, r.version, r.split, r.songGroupKey, r.datasetId, r.checksum])));
}
export function validatePage(value, listed, categories) {
  const image = value.image;
  if (!image || image.id !== listed.id || image.datasetId !== listed.datasetId ||
      image.version !== listed.version || image.status !== 'confirmed' || image.deletedAt)
    throw Error('PAGE_CHANGED: ' + listed.id + '; rerun to resume');
  if (!['layout-v1', 'layout-v2'].includes(image.annotationFormat) || !image.coordinate)
    throw Error('UNSUPPORTED_PAGE: normalize legacy annotations before training: ' + image.id);
  const {width, height} = image;
  if (![width, height].every(n => Number.isSafeInteger(n) && n > 0)) throw Error('Invalid dimensions');
  if (!['train', 'val', 'test'].includes(listed.split) || !listed.songGroupKey)
    throw Error('Missing song group/split: ' + image.id);
  const keys = new Set(categories.map(c => c.key)), boxIds = new Set();
  if (!Array.isArray(value.boxes) || value.boxes.length > 5000) throw Error('Invalid boxes');
  if (!value.boxes.length && image.pageType !== 'negative')
    throw Error('EMPTY_MUSIC_PAGE: ' + image.id + '; review before using it as a negative sample');
  for (const box of value.boxes) {
    if (!box.id || boxIds.has(box.id) || !keys.has(box.classKey) ||
        ![box.x, box.y, box.width, box.height].every(Number.isSafeInteger) ||
        box.x < 0 || box.y < 0 || box.width < 1 || box.height < 1 ||
        box.x + box.width > width || box.y + box.height > height)
      throw Error('Invalid region on page ' + image.id);
    boxIds.add(box.id);
  }
  for (const asset of [image.coordinate.original, image.coordinate.working]) {
    if (!asset || !SHA.test(asset.checksum) || !EXT[asset.mime] ||
        !Number.isSafeInteger(asset.bytes) || asset.bytes < 1) throw Error('Invalid asset metadata');
  }
  if (image.coordinate.working.width !== width || image.coordinate.working.height !== height)
    throw Error('Coordinate/dimension mismatch: ' + image.id);
  return value;
}
export async function downloadAsset(api, apiPath, asset, destination) {
  try {
    if ((await stat(destination)).size === asset.bytes && await hashFile(destination) === asset.checksum) return false;
    throw Error('CORRUPT_CACHE: move the corrupt file before retrying: ' + destination);
  } catch (error) {if (error.code !== 'ENOENT') throw error;}
  await mkdir(dirname(destination), {recursive: true});
  const response = await api(apiPath), header = response.headers.get('x-checksum-sha256');
  if (header && header !== asset.checksum) {await response.body?.cancel(); throw Error('Asset changed during download');}
  const part = destination + '.' + randomUUID() + '.partial'; let file;
  try {
    file = await open(part, 'wx');
    const hash = createHash('sha256'); let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > asset.bytes) throw Error('Unexpected image length');
      hash.update(chunk); await file.writeFile(chunk);
    }
    if (bytes !== asset.bytes || hash.digest('hex') !== asset.checksum) throw Error('Image SHA256/length mismatch');
    await file.close(); file = null; await rename(part, destination); return true;
  } finally {await file?.close(); await response.body?.cancel().catch(() => {}); await unlink(part).catch(() => {});}
}
export async function sync({origin, output, datasetIds = [], allowInsecureHttp = false}) {
  origin = normalizeOrigin(origin); output = resolve(output);
  const credential = await credentials(origin);
  requireTransport(origin, allowInsecureHttp || credential.allowInsecureHttp);
  const api = makeAPI(origin, credential.token), rows = await catalogue(api, datasetIds);
  if (!rows.length) throw Error('No confirmed pages; AI-reviewed and draft pages are excluded');
  const taxonomy = await (await api('/api/v2/taxonomy?version=layout-v2')).json();
  if (taxonomy.taxonomyVersion !== 'layout-v2' || !Array.isArray(taxonomy.categories) ||
      !taxonomy.categories.length || taxonomy.categories.some((c, i) => c.id !== i || typeof c.key !== 'string')) throw Error('Invalid taxonomy');
  await mkdir(output, {recursive: true});
  const statusPath = join(output, 'sync-status.json');
  await atomicJSON(statusPath, {stage: 'downloading', complete: false, total: rows.length, finished: 0});
  const assetMap = new Map();
  for (const row of rows) for (const asset of [row.coordinate?.original, row.coordinate?.working])
    if (asset?.checksum && Number.isSafeInteger(asset.bytes)) assetMap.set(asset.checksum, asset);
  let pendingBytes = 0;
  for (const asset of assetMap.values()) {
    if (!EXT[asset.mime]) throw Error('Unsupported image MIME');
    try {await stat(join(output, 'assets', asset.checksum + '.' + EXT[asset.mime]));}
    catch (error) {if (error.code !== 'ENOENT') throw error; pendingBytes += asset.bytes;}
  }
  const space = await statfs(output);
  if (space.bavail * space.bsize < pendingBytes + 2 * 1024 ** 3)
    throw Error(`INSUFFICIENT_DISK: need ${(pendingBytes / 1024 ** 3 + 2).toFixed(1)} GiB free for data plus reserve`);
  log({event: 'sync-start', pages: rows.length, estimatedDownloadGiB: +(pendingBytes / 1024 ** 3).toFixed(2)});
  const samples = [];
  for (const [index, listed] of rows.entries()) {
    const cache = join(output, 'pages', listed.id + '-v' + listed.version + '.json');
    const value = await cachedJSON(cache) || await (await api('/api/v2/pages/' + listed.id)).json();
    validatePage(value, listed, taxonomy.categories);
    const working = value.image.coordinate.working, original = value.image.coordinate.original;
    const workingPath = join('assets', working.checksum + '.' + EXT[working.mime]);
    const originalPath = join('assets', original.checksum + '.' + EXT[original.mime]);
    await downloadAsset(api, `/api/v2/pages/${listed.id}/content`, working, join(output, workingPath));
    if (original.checksum !== working.checksum)
      await downloadAsset(api, `/api/v2/pages/${listed.id}/content?original=1`, original, join(output, originalPath));
    await atomicJSON(cache, value);
    const {deletedBoxes: ignored, ...annotation} = value;
    samples.push({...annotation, split: listed.split, songGroupKey: listed.songGroupKey,
      songName: listed.songName, datasetId: listed.datasetId, datasetName: listed.datasetName,
      sourceKind: /^synthetic:/i.test(value.image.source || '') ? 'synthetic' : 'confirmed_other',
      workingPath: workingPath.replaceAll('\\', '/'), originalPath: originalPath.replaceAll('\\', '/')});
    await atomicJSON(statusPath, {stage: 'downloading', complete: false, total: rows.length, finished: index + 1});
    if ((index + 1) % 20 === 0 || index === rows.length - 1) log({event: 'download-progress', finished: index + 1, total: rows.length});
  }
  if (membership(rows) !== membership(await catalogue(api, datasetIds)))
    throw Error('CATALOGUE_CHANGED: data changed during download; rerun to resume from verified cache');
  const identity = {origin, taxonomy: taxonomy.categories, samples};
  const fingerprint = digest(JSON.stringify(identity));
  const manifest = {schemaVersion: 1, task: 'layout-detection', complete: true,
    createdAt: new Date().toISOString(), fingerprint, ...identity};
  const path = join(output, 'manifests', fingerprint + '.json');
  await atomicJSON(path, manifest);
  await atomicJSON(join(output, 'latest.json'), {manifest: relative(output, path).replaceAll('\\', '/'), fingerprint});
  await atomicJSON(statusPath, {stage: 'complete', complete: true, pages: samples.length, fingerprint, manifest: path});
  log({event: 'sync-complete', pages: samples.length, synthetic: samples.filter(s => s.sourceKind === 'synthetic').length, manifest: path});
  return manifest;
}
function parse(argv) {
  const result = {origin: 'http://116.62.12.100:8790', output: join(ROOT, '.artifacts/training/data'), datasetIds: []};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--allow-insecure-http') result.allowInsecureHttp = true;
    else if (['--origin', '--output', '--dataset'].includes(flag) && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      const value = argv[++i];
      if (flag === '--dataset') {if (!UUID.test(value)) throw Error('Invalid dataset id'); result.datasetIds.push(value);}
      else result[flag.slice(2)] = value;
    } else throw Error('Usage: sync-confirmed.mjs [--origin URL] [--output DIRECTORY] [--dataset UUID] [--allow-insecure-http]');
  }
  return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let output;
  try {const options = parse(process.argv.slice(2)); output = options.output; await sync(options);}
  catch (error) {
    const message = String(error.message).replace(/omr_cli_[a-f0-9]{64}/g, '[redacted]');
    log({event: 'sync-failed', error: message});
    if (output) await atomicJSON(join(output, 'sync-status.json'), {stage: 'failed', complete: false, error: message}).catch(() => {});
    process.exitCode = 1;
  }
}