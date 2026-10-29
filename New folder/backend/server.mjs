import express from 'express';
import cors from 'cors';
import multer from 'multer';
import {spawn} from 'node:child_process';
import {createReadStream,existsSync,unlinkSync,readFileSync,mkdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const app=express();
app.use(cors({origin:process.env.CORS_ORIGIN?.split(',')||true}));
app.use(express.json({limit:'32kb'}));
const port=Number(process.env.PORT||8787);
const cobalt=(process.env.COBALT_URL||'').replace(/\/$/,'');
const better=(process.env.BETTER_AI_URL||'').replace(/\/$/,'');
const tempRoot=process.env.TEMP_DIR||'/tmp/badr';
mkdirSync(tempRoot,{recursive:true});
const jobs=new Map();

const upload=multer({
  dest:path.join(tempRoot,'uploads'),
  limits:{fileSize:Number(process.env.SUBTITLE_MAX_MB||300)*1024*1024},
  fileFilter:(_,file,cb)=>cb(null,/^video\//i.test(file.mimetype)||/\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(file.originalname))
});

const okUrl=u=>{try{const x=new URL(u);return x.protocol==='http:'||x.protocol==='https:'}catch{return false}};
async function cobaltTry(url,mode='auto'){if(!cobalt)throw Error('cobalt not configured');const r=await fetch(cobalt+'/',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({url,downloadMode:mode,videoQuality:'1080',audioFormat:'mp3',filenameStyle:'basic'})});const j=await r.json().catch(()=>({}));if(!r.ok||j.status==='error')throw Error(j?.error?.code||'cobalt failed');return {...j,engine:'cobalt'};}
async function betterTry(url,mode='auto'){if(!better)throw Error('secondary route not configured');const r=await fetch(better,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url,downloadMode:mode})});const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j?.error||'secondary route failed');return {...j,engine:'secondary'};}
function ytdlp(url,mode='auto'){return new Promise((resolve,reject)=>{if(process.env.YTDLP_ENABLED!=='true')return reject(Error('yt-dlp disabled'));const id=randomUUID();const out=path.join(tempRoot,`badr-${id}-%(id)s.%(ext)s`);const args=['--no-playlist','--newline','-o',out];if(mode==='audio')args.push('-x','--audio-format','mp3');else args.push('-f','bv*+ba/b','--merge-output-format','mp4');args.push(url);const p=spawn('yt-dlp',args,{stdio:['ignore','pipe','pipe']});let log='';p.stdout.on('data',d=>log+=d);p.stderr.on('data',d=>log+=d);p.on('error',reject);p.on('close',code=>{if(code!==0)return reject(Error(log.slice(-1400)||'yt-dlp failed'));const m=log.match(/Destination:\s*(.+)$/m)||log.match(/Merging formats into "(.+)"/);const file=m?.[1]?.replace(/^"|"$/g,'').trim();if(!file||!existsSync(file))return reject(Error('download completed but output file was not found'));resolve({engine:'yt-dlp',status:'file',path:file,filename:path.basename(file)})})})}

app.get('/health',(_,res)=>res.json({ok:true,cobalt:Boolean(cobalt),secondary:Boolean(better),ytDlp:process.env.YTDLP_ENABLED==='true',arabicSubtitles:true,subtitleModel:process.env.WHISPER_MODEL||'base'}));

app.post('/api/download',async(req,res)=>{const url=String(req.body?.url||'').trim(),mode=String(req.body?.downloadMode||'auto');if(!okUrl(url))return res.status(400).json({error:'Invalid URL'});let errs=[];for(const fn of [()=>cobaltTry(url,mode),()=>betterTry(url,mode),()=>ytdlp(url,mode)]){try{const r=await fn();if(r.status==='file'){res.setHeader('Content-Disposition',`attachment; filename="${r.filename||'download.mp4'}"`);res.setHeader('Content-Type','application/octet-stream');const stream=createReadStream(r.path);stream.on('close',()=>{try{unlinkSync(r.path)}catch{}});return stream.pipe(res)}return res.json(r)}catch(e){errs.push(String(e?.message||e))}}return res.status(502).json({error:'All configured routes failed',details:errs})});

function runSubtitleJob(jobId,inputPath,originalName,model){
  const dir=path.join(tempRoot,'jobs',jobId);mkdirSync(dir,{recursive:true});
  const output=path.join(dir,(originalName.replace(/\.[^.]+$/,'')||'badr-video')+'-arabic-subtitles.mp4');
  const srt=path.join(dir,'arabic-subtitles.srt');
  jobs.set(jobId,{id:jobId,status:'processing',progress:0,stage:'starting',message:'Preparing your video…',originalName,output,srt,createdAt:Date.now()});
  const args=['subtitle_worker.py','--input',inputPath,'--output',output,'--srt',srt,'--model',model];
  const child=spawn(process.env.PYTHON_BIN||'python3',args,{cwd:path.dirname(fileURLToPath(import.meta.url)),env:{...process.env,PYTHONUNBUFFERED:'1'}});
  let last='';
  child.stdout.on('data',buf=>{last+=buf.toString();const lines=last.split(/\r?\n/);last=lines.pop()||'';for(const line of lines){try{const p=JSON.parse(line);jobs.set(jobId,{...jobs.get(jobId),...p,status:p.stage==='error'?'error':p.stage==='done'?'done':'processing'});}catch{}}});
  child.stderr.on('data',buf=>{const msg=buf.toString().trim();if(msg)jobs.set(jobId,{...jobs.get(jobId),message:msg.slice(-400)});});
  child.on('error',err=>jobs.set(jobId,{...jobs.get(jobId),status:'error',stage:'error',message:err.message,progress:100}));
  child.on('close',code=>{
    const cur=jobs.get(jobId)||{};
    if(code===0&&existsSync(output)) jobs.set(jobId,{...cur,status:'done',stage:'done',progress:100,message:'Finished — your Arabic-subtitled video is ready.',download:`/api/subtitles/${jobId}/download`,subtitle:`/api/subtitles/${jobId}/srt`});
    else if(cur.status!=='error') jobs.set(jobId,{...cur,status:'error',stage:'error',progress:100,message:cur.message||'Subtitle processing failed.'});
    try{unlinkSync(inputPath)}catch{}
  });
}

app.post('/api/subtitles',upload.single('video'),(req,res)=>{
  if(!req.file)return res.status(400).json({error:'Please upload a video file.'});
  const jobId=randomUUID();
  const model=['tiny','base','small','medium','large-v3'].includes(String(req.body?.model))?String(req.body.model):'small';
  runSubtitleJob(jobId,req.file.path,req.file.originalname,model);
  res.status(202).json({jobId,status:'processing',message:'Your video is queued. No transcript file is required from you.'});
});
app.get('/api/subtitles/:id',(req,res)=>{const job=jobs.get(req.params.id);if(!job)return res.status(404).json({error:'Subtitle job not found.'});const safe={id:job.id,status:job.status,stage:job.stage,progress:job.progress,message:job.message,originalName:job.originalName,download:job.download,subtitle:job.subtitle};res.json(safe);});
app.get('/api/subtitles/:id/download',(req,res)=>{const job=jobs.get(req.params.id);if(!job||job.status!=='done'||!existsSync(job.output))return res.status(404).json({error:'The finished video is not ready.'});res.download(job.output,path.basename(job.output));});
app.get('/api/subtitles/:id/srt',(req,res)=>{const job=jobs.get(req.params.id);if(!job||job.status!=='done'||!existsSync(job.srt))return res.status(404).json({error:'Subtitles are not ready.'});res.download(job.srt,'arabic-subtitles.srt');});

setInterval(()=>{const cutoff=Date.now()-6*60*60*1000;for(const [id,j] of jobs){if(j.createdAt<cutoff){for(const p of [j.output,j.srt]){try{unlinkSync(p)}catch{}}jobs.delete(id);}}},30*60*1000).unref();

app.listen(port,()=>console.log(`BaDR backend on :${port}`));
