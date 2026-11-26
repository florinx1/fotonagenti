import {createExtractorFromData} from 'node-unrar-js';
import fs from 'fs';
const [,,file,out]=process.argv;
const data=Uint8Array.from(fs.readFileSync(file)).buffer;
const ex=await createExtractorFromData({data});
const {files}=ex.extract();
fs.mkdirSync(out,{recursive:true});
for(const f of files){ if(f.fileHeader.flags.directory) continue; const p=out+'/'+f.fileHeader.name.replace(/\\/g,'/'); fs.mkdirSync(p.split('/').slice(0,-1).join('/'),{recursive:true}); fs.writeFileSync(p,f.extraction); console.log(f.fileHeader.name, f.extraction.length);}
