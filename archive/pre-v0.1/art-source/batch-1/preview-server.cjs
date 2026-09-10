'use strict';
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
http.createServer(async(req,res)=>{
  try{
    const route=decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1)||'art-source/batch-1/preview.html';
    if(!route.startsWith('art-source/batch-1/')&&!route.startsWith('art-source/batch-0/')&&!route.startsWith('assets/art/'))throw Error('Not found');
    const file=path.resolve(root,route);
    if(!file.startsWith(root+path.sep))throw Error('Not found');
    const data=await fs.readFile(file);
    const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'};
    res.writeHead(200,{'Content-Type':types[path.extname(file)]||'text/plain; charset=utf-8','Cache-Control':'no-store'});res.end(data);
  }catch{res.writeHead(404);res.end('Not found');}
}).listen(4175,'127.0.0.1',()=>console.log('Artwork only: http://127.0.0.1:4175/art-source/batch-1/preview.html'));
