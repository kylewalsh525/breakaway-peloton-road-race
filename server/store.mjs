import {mkdir,readFile,appendFile,writeFile,rename,stat} from 'node:fs/promises';
import {join} from 'node:path';
/** Single-process result journal. Atomic compaction bounds retention to 5,000 records.
 * No audio, transcripts, email addresses, or raw telemetry are stored. */
export class ResultStore {
    constructor(directory=null){this.directory=directory;this.results=[];this.queue=Promise.resolve();this.error=null;this.entries=0;}
    async replace(records){
        const temp=join(this.directory,'results.next.jsonl');
        await writeFile(temp,records.map(r=>JSON.stringify(r)).join('\n')+(records.length?'\n':''));
        await rename(temp,join(this.directory,'results.jsonl'));
    }
    async load(){
        if(!this.directory)return;
        await mkdir(this.directory,{recursive:true});
        try{
            const file=join(this.directory,'results.jsonl');
            if((await stat(file)).size>50*1024*1024)throw new Error('Result journal exceeds 50 MiB safety limit; archive/repair it before startup');
            const text=await readFile(file,'utf8'),lines=text.trim().split('\n');
            for(const line of lines.slice(-5000)){
                try{const r=JSON.parse(line);if(r&&typeof r==='object'&&!Array.isArray(r))this.results.push(r);}catch{/* A torn record is not accepted as a result. */}
            }
            // Repair a torn tail before appending: otherwise the next valid record could be lost too.
            await this.replace(this.results);this.entries=this.results.length;
        }catch(error){if(error.code!=='ENOENT')throw error;}
    }
    append(result){
        this.results.push(result);if(this.results.length>5000)this.results.shift();
        if(!this.directory)return;
        this.entries++;
        if(this.entries>=6000){
            const checkpoint=this.results.slice();this.entries=checkpoint.length;
            this.queue=this.queue.then(()=>this.replace(checkpoint));
        }else{
            this.queue=this.queue.then(()=>appendFile(join(this.directory,'results.jsonl'),JSON.stringify(result)+'\n'));
        }
        this.queue=this.queue.catch(error=>{this.error=error.message;console.error('Result journal write failed:',error.message);});
    }
    leaderboard(trackId,mode='arcade'){
        return this.results.filter(r=>r.trackId===trackId&&r.mode===mode&&Number.isFinite(r.seconds)&&r.seconds>0&&r.source!=='demo')
            .sort((a,b)=>a.seconds-b.seconds).slice(0,20)
            .map(({name,seconds,avgWatts,date,source})=>({name,seconds,avgWatts,date,source,verified:false}));
    }
}
