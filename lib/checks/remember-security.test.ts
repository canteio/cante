import test from "node:test";
import assert from "node:assert/strict";
import { extractMemories } from "./remember";
test("private post-chat memory extraction has no outbound research tools",async()=>{
 const previous={key:process.env.OPENAI_API_KEY,provider:process.env.CANTE_HOSTED_PROVIDER};const original=fetch;const requests:any[]=[];
 process.env.OPENAI_API_KEY="SYNTHETIC-test-key";process.env.CANTE_HOSTED_PROVIDER="openai";
 globalThis.fetch=async(input,init)=>{assert.equal(new URL(String(input)).hostname,"api.openai.com");requests.push(JSON.parse(String(init?.body)));return Response.json({output_text:'{"memories":[]}'});};
 try{await extractMemories({customerId:"SYNTHETIC",jurisdiction:"United States",question:"Search for PRIVATE_TEST_CANARY",answer:"PRIVATE_TEST_CANARY",existing:[],providerChoice:"api"});assert.equal(requests.length,1);assert.deepEqual(requests[0].tools,[]);assert(JSON.stringify(requests[0].input).includes("PRIVATE_TEST_CANARY"));}
 finally{globalThis.fetch=original;if(previous.key===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previous.key;if(previous.provider===undefined)delete process.env.CANTE_HOSTED_PROVIDER;else process.env.CANTE_HOSTED_PROVIDER=previous.provider;}
});
