const fs=require('fs'),path=require('path'),crypto=require('crypto'),cp=require('child_process');
const sharp=require('C:/Users/chenweilun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp/dist/index.cjs');
const ROOT=path.resolve(__dirname,'../../..'),base='art-source/six-gen',read=p=>JSON.parse(fs.readFileSync(path.resolve(ROOT,p),'utf8').replace(/^\uFEFF/,'')),hash=p=>crypto.createHash('sha256').update(fs.readFileSync(path.resolve(ROOT,p))).digest('hex');
async function main(){const m=read(base+'/integration/manifest.json'),rows=[],errors=[];
for(const a of m.assets){const b=fs.readFileSync(path.resolve(ROOT,a.file));if(b.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')errors.push(a.id+': bad PNG signature');const md=await sharp(b).metadata(),raw=await sharp(b).ensureAlpha().raw().toBuffer();let zero=0,edge=0;
for(let y=0;y<md.height;y++)for(let x=0;x<md.width;x++){const alpha=raw[(y*md.width+x)*4+3];if(!alpha)zero++;if(alpha>=128&&(x===0||y===0||x===md.width-1||y===md.height-1))edge++;}
const sha=hash(a.file);if(sha!==a.sha256)errors.push(a.id+': SHA');if(md.width!==a.width||md.height!==a.height)errors.push(a.id+': dimensions');if(!a.anchor?.every(Number.isFinite))errors.push(a.id+': anchor');if(!fs.existsSync(path.resolve(ROOT,a.sourceFile)))errors.push(a.id+': source missing');if(a.alphaMode==='RGBA'&&(!md.hasAlpha||!zero))errors.push(a.id+': alpha');if(a.alphaMode==='RGBA'&&edge)errors.push(a.id+': opaque edge');
rows.push({id:a.id,sha256:sha,width:md.width,height:md.height,bytes:b.length,hasAlpha:md.hasAlpha,transparentPixels:zero,borderAlpha128:edge,sourceExists:fs.existsSync(path.resolve(ROOT,a.sourceFile))});}
const modified=cp.execFileSync('git',['diff','--name-only'],{cwd:ROOT,encoding:'utf8'}).trim().split('\n').filter(Boolean),status=cp.execFileSync('git',['status','--short'],{cwd:ROOT,encoding:'utf8'}),head=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim();if(modified.length)errors.push('Tracked files changed: '+modified.join(','));
const report={createdAt:new Date().toISOString(),baseCommit:head,scope:'static art only',count:rows.length,errors,passed:!errors.length,rows,trackedModified:modified,gitStatus:status,runtimeTests:'NOT_RUN',build:'NOT_RUN',device:'NOT_RUN'};
console.log(JSON.stringify(report,null,2));if(errors.length)process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1});
