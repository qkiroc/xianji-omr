#!/usr/bin/env python3
"""Validate locally downloaded OMR detection.zip and optional crops.zip; stdlib only."""
import json, hashlib, zipfile, sys, math
BASE_CATEGORIES=['system','guitar','melody','lyrics','chord_marks','staff_notation','other_tab']
def canonical(value):
    # Server uses explicit stable JSON; numbers in this metadata are integers.
    return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False)
def validate(path):
    with zipfile.ZipFile(path) as z:
        names=z.namelist();assert len(names)==len(set(names)), 'duplicate ZIP paths'
        assert all(not n.startswith('/') and '..' not in n.split('/') for n in names),'unsafe ZIP path'
        m=json.loads(z.read('manifest.json'));assert m['taxonomyVersion'] in ['layout-v1','layout-v2'] and m['schemaVersion']==2
        FULL_CATEGORIES=BASE_CATEGORIES+(['title','performer','time_signature','key_signature','tempo','capo'] if m['taxonomyVersion']=='layout-v2' else [])
        selection=m.get('exportSelection',{});selected=selection.get('classKeys')
        if selected is not None:
            assert selected and len(selected)==len(set(selected)) and all(k in FULL_CATEGORIES for k in selected)
            assert selected==[k for k in FULL_CATEGORIES if k in selected],'canonical category order'
        CATEGORIES=[k for k in FULL_CATEGORIES if selected is None or k in selected]
        if selected is not None:
            assert [(c['sourceId'],c['sourceCocoId']) for c in m['categories']]==[(FULL_CATEGORIES.index(k),FULL_CATEGORIES.index(k)+1) for k in CATEGORIES]
        assert [(c['id'],c['key'],c['cocoId']) for c in m['categories']]==[(i,k,i+1) for i,k in enumerate(CATEGORIES)]
        for name,expected in m['fileChecksums'].items():
            h=hashlib.sha256()
            with z.open(name) as stream:
                while chunk:=stream.read(1024*1024):h.update(chunk)
            assert h.hexdigest()==expected, 'checksum '+name
        identity={k:v for k,v in m.items() if k not in ['snapshotId','datasetFingerprint','artifact','fileChecksums']}
        assert hashlib.sha256(canonical(identity).encode()).hexdigest()==m['datasetFingerprint'],'fingerprint'
        groups={};images={};native=m['images'];song_map={s['id']:s for s in m['songs']}
        for image in native:
            w=image['coordinate']['working']['width'];h=image['coordinate']['working']['height'];checksum=image['coordinate']['original']['checksum'];split=image['split']
            assert images.get(checksum,split)==split,'image split leakage';images[checksum]=split
            for source in image['aliases']:
                key=source['songGroupKey'];assert groups.get(key,split)==split,'song split leakage';groups[key]=split;assert song_map[source['songId']]['split']==split
            boxes={b['id']:b for b in image['boxes']};assert len(boxes)==len(image['boxes'])
            assert image['pageType'] in ['music','negative'];assert bool(boxes)==(image['pageType']=='music')
            contexts={b['id']:b for b in image.get('contextBoxes',[])}
            assert not (set(contexts)&set(boxes)),'context duplicates selected regions'
            assert all(b['classKey']=='system' and any(c['parentSystemId']==b['id'] for c in boxes.values()) for b in contexts.values())
            assert all(b['classKey'] in CATEGORIES for b in boxes.values()),'unselected training label'
            geometry={**contexts,**boxes}
            for b in geometry.values():
                assert b['classKey'] in FULL_CATEGORIES
                assert all(type(b[k])==int for k in ['x','y','width','height','readingOrder'])
                assert b['x']>=0 and b['y']>=0 and b['width']>0 and b['height']>0 and b['x']+b['width']<=w and b['y']+b['height']<=h
                if b['parentSystemId']:
                    p=geometry[b['parentSystemId']];assert p['classKey']=='system';assert b['x']>=p['x'] and b['y']>=p['y'] and b['x']+b['width']<=p['x']+p['width'] and b['y']+b['height']<=p['y']+p['height']
                elif b['classKey'] not in ['system','chord_marks','title','performer','time_signature','key_signature','tempo','capo']:raise AssertionError('missing parent')
        assert sum(len(i['aliases']) for i in native)==m['stats']['sourcePages']
        assert len(native)==m['stats']['uniqueImages'];assert sum(len(i['boxes']) for i in native)==m['stats']['uniqueBoxes']
        if m['artifact']=='detection':
            coco=json.loads(z.read('annotations.coco.json'));assert [c['id'] for c in coco['categories']]==list(range(1,len(CATEGORIES)+1));assert [c['name'] for c in coco['categories']]==CATEGORIES;assert len(coco['images'])==len(native)
            assert json.loads(z.read('annotations.native.json'))==native
            for image in native:
                w=image['coordinate']['working']['width'];h=image['coordinate']['working']['height'];lines=z.read(f"labels/{image['split']}/{image['id']}.txt").decode().splitlines();assert len(lines)==len(image['boxes'])
                anns=[a for a in coco['annotations'] if a['image_id']==image['imageId']];assert len(anns)==len(lines)
                for b,line,a in zip(image['boxes'],lines,anns):
                    cls,cx,cy,bw,bh=map(float,line.split());reconstructed=[(cx-bw/2)*w,(cy-bh/2)*h,bw*w,bh*h]
                    assert a.get('metadata')==b.get('metadata')
                    assert int(cls)==CATEGORIES.index(b['classKey']) and a['category_id']==int(cls)+1
                    assert all(abs(x-b[k])<.01 and abs(y-b[k])<.01 for x,y,k in zip(reconstructed,a['bbox'],['x','y','width','height'])),'coordinate roundtrip'
                assert hashlib.sha256(z.read(image['originalPath'])).hexdigest()==image['coordinate']['original']['checksum']
                assert hashlib.sha256(z.read(image['path'])).hexdigest()==image['coordinate']['working']['checksum']
        else:
            mapping=json.loads(z.read('sources.json'));assert len(mapping)==m['stats']['uniqueBoxes']
            for crop in mapping:
                image=next(i for i in native if i['id']==crop['sourceImageId']);b=next(b for b in image['boxes'] if b['id']==crop['regionId']);assert crop['box']=={k:b[k] for k in ['x','y','width','height']};assert crop['parentSystemId']==b['parentSystemId'];assert crop['workingChecksum']==image['coordinate']['working']['checksum'];assert crop.get('metadata')==b.get('metadata')
        return m
if __name__=='__main__':
    if len(sys.argv)<2:raise SystemExit('用法: python3 tools/validate-export.py detection.zip [crops.zip]')
    manifests=[validate(p) for p in sys.argv[1:]];assert len({m['datasetFingerprint'] for m in manifests})==1,'packages belong to different datasets'
    print('PASS: checksums, fingerprint, taxonomy, native/YOLO/COCO pixels, groups and crop mapping')
