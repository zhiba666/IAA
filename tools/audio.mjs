// Original PCM sound assets for the native mini-game audio API.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const sounds={pop:[.10,[760]],burst:[.42,[220,330,440,550,660,770]],upgrade:[.48,[440,554,659,880]],order:[.36,[659,880,1047]],complete:[.82,[523,659,784,1047,784,1047]],click:[.07,[440]],error:[.14,[160]],heatReady:[.2,[880,1175]]};
export async function generateAudio(directory){
  await mkdir(directory,{recursive:true});
  for(const [name,[duration,notes]] of Object.entries(sounds)){
    const rate=22050,count=Math.ceil(rate*duration),buf=Buffer.alloc(44+count*2);
    buf.write('RIFF',0);buf.writeUInt32LE(36+count*2,4);buf.write('WAVEfmt ',8);buf.writeUInt32LE(16,16);buf.writeUInt16LE(1,20);buf.writeUInt16LE(1,22);buf.writeUInt32LE(rate,24);buf.writeUInt32LE(rate*2,28);buf.writeUInt16LE(2,32);buf.writeUInt16LE(16,34);buf.write('data',36);buf.writeUInt32LE(count*2,40);
    for(let i=0;i<count;i++){
      const t=i/rate,noteLength=duration/notes.length,index=Math.min(notes.length-1,Math.floor(t/noteLength)),local=t-index*noteLength;
      const envelope=Math.min(1,local/.004)*Math.max(0,1-local/noteLength)**1.8;
      const freq=notes[index],phase=2*Math.PI*(freq*local-(name==='pop'?220*local*local:0));
      const value=Math.sin(phase)*envelope*.25;
      buf.writeInt16LE(Math.round(value*32767),44+i*2);
    }
    await writeFile(path.join(directory,name+'.wav'),buf);
  }
}
