import type { TablePreview } from "@/app/api/files/tabular";
export type FileAttachment={filename:string;format:string;text:string;originalCsv?:string;uploadId?:string;tables?:TablePreview[];tableIndex?:number;mapping?:Record<string,number>;basis?:string;mappingConfirmed?:boolean;skipCheck?:boolean;warnings?:string[]};
export async function uploadChatFile(file:File,progress:(message:string)=>void):Promise<FileAttachment>{
 if(!file.size||file.size>15*1024*1024)throw Error("Use a nonempty file up to 15 MiB.");
 const bytes=await file.arrayBuffer();const digest=await crypto.subtle.digest("SHA-256",bytes);
 const sha256=[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,"0")).join("");
 const init=await fetch("/api/files/uploads",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({filename:file.name,size:file.size,sha256})});
 const metadata=await init.json();if(!init.ok)throw Error(metadata.error??"Could not reserve original file.");
 if(!Number.isInteger(metadata.chunkBytes)||metadata.chunkBytes<1||metadata.chunkBytes>1024*1024)throw Error("Invalid upload chunk configuration.");
 const parts=Math.ceil(file.size/metadata.chunkBytes);
 for(let part=0;part<parts;part++){
  progress(`Uploading ${file.name} · ${part+1}/${parts}`);
  const saved=await fetch(`/api/files/uploads/${metadata.id}?part=${part}`,{method:"PUT",headers:{"content-type":"application/octet-stream"},body:file.slice(part*metadata.chunkBytes,(part+1)*metadata.chunkBytes)});
  if(!saved.ok){const error=await saved.json();throw Error(error.error??"Original upload interrupted.");}
 }
 progress(`Reading ${file.name}…`);
 const response=await fetch("/api/files/extract",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({uploadId:metadata.id})});
 const data=await response.json();if(!response.ok)throw Error(data.error??"Could not read original file.");
 return data;
}
