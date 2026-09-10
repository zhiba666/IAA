const fs=require('fs'),path=require('path'),crypto=require('crypto');
const sharp=require('C:/Users/chenweilun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp/dist/index.cjs');
async function run(){
const [owner,id,edgeArg='512']=process.argv.slice(2);if(!['logistics','ui','scene'].includes(owner)||!/^[a-z_]+$/.test(id))throw Error('Invalid target');
const root=path.resolve(__dirname,'../../..'),dir=path.join(root,'art-source/six-gen',owner);const src=path.join(dir,'sources',id+'.png'),out=path.join(dir,'exports',id+'.png');fs.mkdirSync(path.dirname(out),{recursive:true});
const m=await sharp(src).metadata(),r=await sharp(src).ensureAlpha().raw().toBuffer({resolveWithObject:true});
let x0=m.width,y0=m.height,x1=-1,y1=-1,edgeCount=0,transparent=0;
for(let y=0;y<m.height;y++)for(let x=0;x<m.width;x++){const a=r.data[(y*m.width+x)*4+3];if(!a)transparent++;if(a>8){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}if(a>=128&&(x==0||y==0||x==m.width-1||y==m.height-1))edgeCount++;}
if(id!='factory_room_extension'&&(!m.hasAlpha||transparent<100))throw Error('NO_TRUE_ALPHA');
const rect={left:Math.max(0,x0-3),top:Math.max(0,y0-3),width:Math.min(m.width,x1+4)-Math.max(0,x0-3),height:Math.min(m.height,y1+4)-Math.max(0,y0-3)};
const maxEdge=Number(edgeArg)-8;
await sharp(src).extract(rect).resize({width:maxEdge,height:maxEdge,fit:'inside',withoutEnlargement:true}).extend({top:4,bottom:4,left:4,right:4,background:{r:0,g:0,b:0,alpha:0}}).png({palette:true,colours:256,quality:92,dither:.5,compressionLevel:9,effort:7}).toFile(out);
const om=await sharp(out).metadata(),hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const result={id,owner,sourceFile:path.relative(root,src).replaceAll('\\','/'),file:path.relative(root,out).replaceAll('\\','/'),sourceSize:[m.width,m.height],sourceRect:[rect.left,rect.top,rect.width,rect.height],width:om.width,height:om.height,anchor:[om.width/2,om.height-4],sourceSha256:hash(src),sha256:hash(out),bytes:fs.statSync(out).size,rgbaBytes:om.width*om.height*4,originalAlpha:m.hasAlpha,originalBoundaryPixels:edgeCount,transform:'crop alpha>8 bbox +3px, uniform Lanczos3 resize, 4px transparent padding, palette256 quality92 dither0.5',status:'EXPORTED'};
fs.writeFileSync(path.join(dir,id+'.export.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
const fits=await sharp(out).resize({width:300,height:260,fit:'inside'}).toBuffer(),fm=await sharp(fits).metadata();
const layers=[];for(let i=0;i<3;i++){const bg=i==0?'#faf6eb':i==1?'#163039':'#a8b6b4';layers.push({input:await sharp({create:{width:320,height:300,channels:4,background:bg}}).png().toBuffer(),left:320*i,top:0});layers.push({input:fits,left:320*i+Math.round((320-fm.width)/2),top:Math.round((300-fm.height)/2)});}
await sharp({create:{width:960,height:300,channels:4,background:'#ffffff'}}).composite(layers).png().toFile(path.join(dir,id+'.three-backgrounds.png'));
}run().catch(e=>{console.error(e);process.exitCode=1});
