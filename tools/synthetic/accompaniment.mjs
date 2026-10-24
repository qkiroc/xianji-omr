import {createHash} from 'node:crypto';
export const ACCOMPANIMENT_REVISION='audition195-accompaniment-v3';
const hash=value=>createHash('sha256').update(String(value)).digest('hex');
const beatLength=b=>4/b.duration*(b.dotted?1.5:1)*(b.tuplet?b.tuplet.denominator/b.tuplet.numerator:1);

// Keep common editions in cross notation; choose minority slots among the other editions.
export function assignAccompanimentStyles(jobs){
 const ranked=[...jobs].sort((a,b)=>hash(a.id+':style-rank').localeCompare(hash(b.id+':style-rank')));
 const numeric=Math.round(jobs.length*.15),mixed=Math.round(jobs.length*.30),result=new Map();
 for(const [rank,job]of ranked.entries()){
  const styles=Object.fromEntries(job.profiles.map(p=>[p.id,'chord-cross']));
  if(rank<numeric+mixed){const alternatives=job.profiles.filter(p=>p.family!==0&&p.id!=='synth195-01');const index=parseInt(hash(job.id+':minority-slot').slice(0,8),16)%alternatives.length;styles[alternatives[index].id]=rank<numeric?'numeric':'mixed';}
  result.set(job.id,styles);
 }
 return result;
}
export function accompanimentProfile(profile,style){
 if(!['numeric','mixed','chord-cross'].includes(style))throw Error('Unknown accompaniment style');
 const baseName=profile.featureFamily===0?'基础伴奏谱':profile.name||'吉他伴奏';
 const name=baseName+' · '+({'chord-cross':'×拨弦／箭头扫弦',mixed:'数字与×混合',numeric:'数字品位版'})[style];
 return {...profile,name,notesStyle:style,pluckNotation:style,strumHeadStyle:style==='numeric'?'numeric':'arrows',notationRevision:ACCOMPANIMENT_REVISION};
}
export function applyAccompanimentNotation(original,source,profile){
 const score=structuredClone(original),kind=profile.pluckNotation||profile.notesStyle||'numeric';
 if(!['numeric','mixed','chord-cross'].includes(kind))throw Error('Unknown accompaniment style '+kind);
 const coverage={style:kind,pluckedNotes:0,eligibleChordPlucks:0,crossPlucks:0,numericPlucks:0,mutedPlucks:0,protectedPlucks:0,strums:0,arrowStrums:0};
 const protectedNotes=new Set(),previous=new Map();
 for(const bar of score.bars)for(const beat of bar.beats)for(const n of beat.notes){
  if(n.grace||n.synthDisplayFret||(n.technique&&n.technique!=='PM'))protectedNotes.add(n);
  if(n.technique&&n.technique!=='PM'&&previous.has(n.string))protectedNotes.add(previous.get(n.string));
  previous.set(n.string,n);
 }
 const shapes=new Map((score.customChords||[]).map(c=>[c.id,c.frets]));let current;
 for(const [barIndex,bar]of score.bars.entries()){
  const raw=source.measures?.[barIndex],changes=(raw?.chords||[]).map((c,i)=>({...c,index:i})).sort((a,b)=>a.beat-b.beat||a.index-b.index);let changeIndex=0,time=0;
  const useCross=kind==='chord-cross'||kind==='mixed'&&parseInt(hash(source.id+':'+profile.id+':'+barIndex).slice(0,8),16)/4294967296<.65;
  for(const [eventIndex,beat]of bar.beats.entries()){
   if(beat.chord&&shapes.has(beat.chord))current=shapes.get(beat.chord);
   while(changeIndex<changes.length&&changes[changeIndex].beat<=time+1e-7){
    const c=changes[changeIndex++],frets=c.frets||source.chordShapes?.[c.name];
    if(Array.isArray(frets))current=frets.map(n=>n===null?-1:n).reverse();
    else if(!beat.chord)current=undefined;
   }
   const rawNotes=raw?.guitar?.[eventIndex]?.notes||[];
   for(const n of beat.notes){
    const explicit=protectedNotes.has(n)||rawNotes.some(r=>r.string===n.string&&r.displayFret);
    if(explicit)n.synthKeepFret=true;
    if(beat.stroke)continue;
    coverage.pluckedNotes++;
    if(n.mode==='mute'||beat.synth?.mute){coverage.mutedPlucks++;continue;}
    const protectedPitch=explicit||beat.synth?.ghost;
    if(protectedPitch)coverage.protectedPlucks++;
    const eligible=!beat.rest&&!protectedPitch&&current?.[n.string-1]>=0&&current[n.string-1]===n.fret;
    if(eligible)coverage.eligibleChordPlucks++;
    n.mode=useCross&&eligible?'chord':'fret';
    if(n.mode==='chord')coverage.crossPlucks++;else coverage.numericPlucks++;
   }
   if(beat.stroke){coverage.strums++;if(profile.strumHeadStyle==='arrows'&&!profile.strumXs&&profile.notationHead!=='slash'&&!beat.synth?.mute&&!beat.synth?.ghost&&!(profile.longNoteCircles&&beat.duration<=2))coverage.arrowStrums++;}
   time+=beatLength(beat);
  }
 }
 return {score,coverage};
}


export const REPAIR_PHASES=['repair-common','repair-existing','continue-import'];
export function repairQueue(jobs,states){
 const items=[];
 for(const job of jobs)for(const profile of job.profiles){
  const prior=states.get(job.id)?.profiles?.find(p=>p.id===profile.id),hasPages=(prior?.pages?.length||prior?.pendingPages||0)>0;
  const common=profile.family===0||profile.id==='synth195-01';
  items.push({sourceId:job.id,profileId:profile.id,phase:hasPages?(common?'repair-common':'repair-existing'):'continue-import',sourceIndex:job.index});
 }
 return items.sort((a,b)=>REPAIR_PHASES.indexOf(a.phase)-REPAIR_PHASES.indexOf(b.phase)||a.sourceIndex-b.sourceIndex||a.profileId.localeCompare(b.profileId));
}
