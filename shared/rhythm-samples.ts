import type { RhythmRegion, RhythmSample } from "./localization";

// A system groups the aligned TAB, melody and lyric regions. An unattached
// source region is a separate sample; never guess that two rows belong together.
export function rhythmSamples(regions: RhythmRegion[]): {sample:RhythmSample;regions:RhythmRegion[]}[] {
  const groups=new Map<string,RhythmRegion[]>();
  for(const region of regions){
    const key=region.pageId+":"+(region.systemId?"system:"+region.systemId:"region:"+region.id);
    const group=groups.get(key)||[];group.push(region);groups.set(key,group);
  }
  return [...groups.values()].map(regions=>({regions,sample:{unit:"system" as const,
    id:regions[0].systemId?"system:"+regions[0].systemId:"region:"+regions[0].id,
    pageId:regions[0].pageId,index:0,bbox:[Math.min(...regions.map(r=>r.bbox[0])),Math.min(...regions.map(r=>r.bbox[1])),
      Math.max(...regions.map(r=>r.bbox[2])),Math.max(...regions.map(r=>r.bbox[3]))] as RhythmSample["bbox"],
  }})).sort((a,b)=>a.sample.bbox[1]-b.sample.bbox[1]||a.sample.bbox[0]-b.sample.bbox[0]||a.sample.id.localeCompare(b.sample.id))
    .map((group,i)=>({...group,sample:{...group.sample,index:i+1}}));
}
