'use strict';
// Local artwork review only. Never loads the game entry or writes game storage.
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
http.createServer(async(req,res)=>{
  try{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(pathname==='/'){res.writeHead(302,{Location:'/art-source/batch-0/preview.html'});res.end();return;}
    const route=pathname==='/'?'art-source/batch-0/preview.html':pathname.slice(1);
    if(!route.startsWith('art-source/batch-0/')&&!route.startsWith('assets/art/'))throw Error('Not found');
    const file=path.resolve(root,route);
    if(!file.startsWith(root+path.sep))throw Error('Not found');
    const data=await fs.readFile(file);
    const types={'.html':'text/html; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'};
    res.writeHead(200,{'Content-Type':types[path.extname(file)]||'text/plain; charset=utf-8','Cache-Control':'no-store'});res.end(data);
  }catch{res.writeHead(404);res.end('Not found');}
}).listen(4174,'127.0.0.1',()=>console.log('Artwork only: http://127.0.0.1:4174'));
