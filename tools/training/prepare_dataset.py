"""Validate confirmed pages, eliminate duplicates, split by song, and emit YOLO files."""
import argparse, collections, hashlib, json, os, re, shutil
from pathlib import Path
from PIL import Image
from image_rgb import NORMALIZATION, needs_rgb_normalization, rgb_on_white

VERSION = 2
Image.MAX_IMAGE_PIXELS = 50_000_000

def sha_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''): h.update(chunk)
    return h.hexdigest()

def save_json(path, value):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    part = path.with_name(path.name + '.partial')
    part.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    os.replace(part, path)

def contained(root, name):
    p = (root / name).resolve()
    if not p.is_relative_to(root.resolve()): raise ValueError('Asset path outside data root')
    return p

def label_signature(s):
    return sorted((b['classKey'], b['x'], b['y'], b['width'], b['height']) for b in s['boxes'])

def prepare(data_root, manifest_path=None, *, exclude_conflicts=False, output_root=None):
    root = Path(data_root).resolve()
    metadata_root = Path(output_root).resolve() if output_root is not None else root
    if manifest_path is None:
        pointer = json.loads((root / 'latest.json').read_text(encoding='utf-8'))
        manifest_path = contained(root, pointer['manifest'])
    manifest = json.loads(Path(manifest_path).read_text(encoding='utf-8'))
    if manifest.get('complete') is not True or manifest.get('task') != 'layout-detection':
        raise ValueError('Download manifest is incomplete or has another task')
    categories = manifest['taxonomy']
    if [c['id'] for c in categories] != list(range(len(categories))): raise ValueError('Non-contiguous taxonomy')
    class_ids = {c['key']: c['id'] for c in categories}
    samples = manifest['samples']
    if not samples: raise ValueError('No confirmed samples')
    parents, group_split, pixels, cache = {}, {}, {}, {}
    def find(g):
        parents.setdefault(g, g)
        if parents[g] != g: parents[g] = find(parents[g])
        return parents[g]
    def union(a, b): parents[find(a)] = find(b)
    validated = []
    for s in samples:
        image = s['image']; group = s['songGroupKey']; split = s['split']
        if not re.fullmatch(r'[a-fA-F0-9-]{1,36}',str(image['id'])):raise ValueError('Invalid page filename')
        if image['status'] != 'confirmed' or image.get('deletedAt') or split not in ('train','val','test'):
            raise ValueError('Unconfirmed/deleted page or invalid split')
        if group in group_split and group_split[group] != split: raise ValueError('Song crosses splits: ' + group)
        group_split[group] = split; find(group)
        if not s['boxes'] and image.get('pageType') != 'negative': raise ValueError('Empty music page')
        for b in s['boxes']:
            if b['classKey'] not in class_ids: raise ValueError('Unknown class')
            if any(type(b[k]) is not int for k in ('x','y','width','height')) or min(b['x'],b['y'])<0 or min(b['width'],b['height'])<=0 or b['x']+b['width']>image['width'] or b['y']+b['height']>image['height']:
                raise ValueError('Out-of-bounds annotation')
        for field, asset in [('workingPath',image['coordinate']['working']),('originalPath',image['coordinate']['original'])]:
            path = contained(root, s[field]); key = str(path)
            if key not in cache:
                if path.stat().st_size != asset['bytes'] or sha_file(path) != asset['checksum']:
                    raise ValueError('SHA256/size mismatch: ' + str(path))
                cache[key] = (asset['checksum'],asset['bytes'])
            elif cache[key] != (asset['checksum'],asset['bytes']):raise ValueError('Conflicting asset metadata')
        path = contained(root, s['workingPath'])
        checksum = image['coordinate']['working']['checksum']
        if checksum not in pixels:
            with Image.open(path) as im:
                if im.size != (image['width'],image['height']) or im.getexif().get(274,1)!=1:
                    raise ValueError('Dimensions/orientation disagree with annotation')
                pixel_sha = hashlib.sha256(str(im.size).encode()+rgb_on_white(im).tobytes()).hexdigest()
                normalize_rgb = needs_rgb_normalization(im)
            pixels[checksum] = (pixel_sha, normalize_rgb)
        validated.append({**s, 'pixelSha':pixels[checksum][0], 'normalizeRgb':pixels[checksum][1]})
    # Compare visible pixels after alpha compositing. Never choose one contradictory label set.
    clusters = collections.defaultdict(list)
    for s in validated: clusters[s['pixelSha']].append(s)
    conflicts = []
    for pixel_sha, items in clusters.items():
        if any(label_signature(s) != label_signature(items[0]) for s in items[1:]):
            conflicts.append({'pixelSha':pixel_sha,'samples':[
                {'pageId':s['image']['id'],'name':s['image'].get('name'),'songName':s.get('songName'),
                 'datasetId':s.get('datasetId'),'songGroupKey':s['songGroupKey'],'split':s['split'],
                 'source':s['image'].get('source'),'workingPath':s['workingPath'],'boxes':s['boxes']}
                for s in items]})
    conflict_path = metadata_root/'conflicts'/(manifest['fingerprint']+'.json')
    excluded = {item['pageId'] for c in conflicts for item in c['samples']} if exclude_conflicts else set()
    save_json(conflict_path,{'sourceFingerprint':manifest['fingerprint'],'normalization':NORMALIZATION,
        'policy':'exclude-all-conflicting-copies' if exclude_conflicts else 'error',
        'groups':conflicts,'excludedPageIds':sorted(excluded)})
    if conflicts and not exclude_conflicts:
        raise ValueError('Identical image has conflicting labels: ' +
            ', '.join(s['pageId'] for s in conflicts[0]['samples']) +
            '; report: '+str(conflict_path)+'; review the report or explicitly use --exclude-conflicts')
    retained = [s for s in validated if s['image']['id'] not in excluded]
    if not retained: raise ValueError('No samples remain after excluding conflicting copies')
    by_pixel = {}
    for s in retained:
        old = by_pixel.get(s['pixelSha'])
        if old: union(old['songGroupKey'],s['songGroupKey'])
        else: by_pixel[s['pixelSha']] = s
    groups = {}
    for s in retained:
        group=find(s['songGroupKey']); g=groups.setdefault(group,{'splits':set(),'real':False,'items':[]})
        g['splits'].add(s['split']); g['real'] |= s.get('sourceKind') != 'synthetic';g['items'].append(s)
    for group,g in groups.items():
        if len(g['splits'])!=1: raise ValueError('Identical image crosses splits: ' + group)
        g['split']=next(iter(g['splits']))
    overrides=[]
    # Fill missing holdouts; prefer real pages. Never move existing val/test into training.
    for target, fraction in [('val',0.15),('test',0.10)]:
        present=[g for g in groups.values() if g['split']==target]
        candidates=[(k,g) for k,g in groups.items() if g['split']=='train']
        real=[(k,g) for k,g in candidates if g['real']]
        need_real=not any(g['real'] for g in present) and len(real)>=3
        if not present or need_real:
            choices=real if need_real else candidates
            choices=sorted(choices,key=lambda pair:(not pair[1]['real'],hashlib.sha256(pair[0].encode()).hexdigest()))
            amount=max(1,round(len(choices)*fraction)) if len(candidates)>=2 else 0
            for key,g in choices[:min(amount,max(0,len(candidates)-1))]:
                g['split']=target;overrides.append({'songGroupKey':key,'from':'train','to':target,'reason':'local independent holdout'})
    if not any(g['split']=='train' for g in groups.values()) or not any(g['split']=='val' for g in groups.values()):
        raise ValueError('Need independent train and val song groups; at least two groups are required')
    selected=[]; duplicate_map={}
    for s in retained:
        split=groups[find(s['songGroupKey'])]['split']
        if s['pixelSha'] in duplicate_map:
            duplicate_map[s['pixelSha']]['aliases'].append(s['image']['id']);continue
        item={**s,'localSplit':split,'aliases':[s['image']['id']]}
        duplicate_map[s['pixelSha']]=item;selected.append(item)
    identity={'version':VERSION,'normalization':NORMALIZATION,'excludedPageIds':sorted(excluded),'sourceFingerprint':manifest['fingerprint'],'samples':[(s['image']['id'],s['pixelSha'],s['localSplit']) for s in selected]}
    fingerprint=hashlib.sha256(json.dumps(identity,sort_keys=True).encode()).hexdigest()
    output=metadata_root/'prepared'/fingerprint
    class_counts={split:collections.Counter() for split in ('train','val','test')}
    stats={split:{'pages':0,'synthetic':0,'confirmedOther':0,'boxes':0} for split in ('train','val','test')}
    image_index=[]
    for s in selected:
        split=s['localSplit'];name=s['image']['id'];src=contained(root,s['workingPath'])
        dest=output/'images'/split/(name+('.png' if s['normalizeRgb'] else src.suffix));dest.parent.mkdir(parents=True,exist_ok=True)
        if dest.exists():
            if s['normalizeRgb']:
                with Image.open(dest) as cached:
                    actual = hashlib.sha256(str(cached.size).encode()+cached.tobytes()).hexdigest()
                    if cached.mode != 'RGB' or actual != s['pixelSha']: raise ValueError('Prepared image was modified')
            elif sha_file(dest)!=s['image']['coordinate']['working']['checksum']:raise ValueError('Prepared image was modified')
        elif s['normalizeRgb']:
            with Image.open(src) as image:
                rgb = rgb_on_white(image)
                if hashlib.sha256(str(rgb.size).encode()+rgb.tobytes()).hexdigest() != s['pixelSha']:
                    raise ValueError('Source image changed during preparation')
                part = dest.with_name(dest.name+'.partial')
                try:
                    rgb.save(part,format='PNG')
                    os.replace(part,dest)
                finally:part.unlink(missing_ok=True)
        else:
            try:os.link(src,dest)
            except OSError:shutil.copy2(src,dest)
        w,h=s['image']['width'],s['image']['height'];lines=[]
        for b in s['boxes']:
            cid=class_ids[b['classKey']];class_counts[split][b['classKey']]+=1
            lines.append(f"{cid} {(b['x']+b['width']/2)/w:.12f} {(b['y']+b['height']/2)/h:.12f} {b['width']/w:.12f} {b['height']/h:.12f}")
        labels=output/'labels'/split/(name+'.txt');labels.parent.mkdir(parents=True,exist_ok=True)
        labels.write_text('\n'.join(lines)+ ('\n' if lines else ''),encoding='utf-8')
        stats[split]['pages']+=1;stats[split]['boxes']+=len(s['boxes']);stats[split]['synthetic' if s.get('sourceKind')=='synthetic' else 'confirmedOther']+=1
        image_index.append({'path':dest.relative_to(output).as_posix(),'pageId':name,'aliases':s['aliases'],'sourceKind':s.get('sourceKind'),'songGroupKey':s['songGroupKey'],'split':split,'pixelSha':s['pixelSha']})
    config={'path':output.as_posix(),'train':'images/train','val':'images/val','names':{c['id']:c['key'] for c in categories}}
    if stats['test']['pages']:config['test']='images/test'
    warnings=[]
    if excluded:warnings.append(f"Excluded all {len(excluded)} pages from {len(conflicts)} conflicting image groups; see {conflict_path}")
    if not stats['val']['confirmedOther']:warnings.append('Validation has no non-synthetic pages; real-world quality is unmeasured')
    if not stats['test']['confirmedOther']:warnings.append('No independent real test pages')
    missing=[c['key'] for c in categories if not class_counts['train'][c['key']]]
    if missing:warnings.append('Classes absent from training: '+', '.join(missing))
    summary={'fingerprint':fingerprint,'sourceFingerprint':manifest['fingerprint'],'splits':stats,'classCounts':{k:dict(v) for k,v in class_counts.items()},'sourcePages':len(samples),'imageNormalization':NORMALIZATION,'normalizedPages':sum(s['normalizeRgb'] for s in selected),'excludedConflictingPages':len(excluded),'conflictReport':str(conflict_path),'duplicatesRemoved':len(retained)-len(selected),'splitOverrides':overrides,'warnings':warnings,'categories':[{'id':c['id'],'key':c['key']} for c in categories]}
    save_json(output/'index.json',image_index);save_json(output/'audit.json',summary)
    save_json(output/'data.yaml',config)  # JSON is a strict subset of YAML.
    save_json(metadata_root/'prepared-latest.json',{'directory':str(output),'yaml':str(output/'data.yaml'),'summary':summary})
    return output,summary

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--data-root',required=True);p.add_argument('--manifest');p.add_argument('--exclude-conflicts',action='store_true');p.add_argument('--output-root')
    args=p.parse_args();out,summary=prepare(args.data_root,args.manifest,exclude_conflicts=args.exclude_conflicts,output_root=args.output_root)
    print(json.dumps({'event':'dataset-ready','directory':str(out),**summary},ensure_ascii=False))
