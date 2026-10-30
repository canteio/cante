import test from "node:test";
import assert from "node:assert/strict";
import { dailyEvent } from "../app/api/internal/tariff-live-check/daily";
import type { LiveCheckResult } from "../app/api/tariff/live-check/check";
function result(overrides:Record<string,unknown>={}):LiveCheckResult{return {sources:[],comparison:null,historicalComparison:{candidateSkus:[],legalChanges:[],headingChanges:[],baseChanges:[],issues:[]},unresolvedProducts:0,rows:[],...overrides} as unknown as LiveCheckResult;}
test("scheduled notices distinguish cost changes, legal leads, missing facts and source failure",()=>{
 assert.equal(dailyEvent(result()),null);
 assert.equal(dailyEvent(result({comparison:{status:"compared",rows:[{sku:"SYNTHETIC",difference:10}]}}))?.kind,"change");
 assert.equal(dailyEvent(result({historicalComparison:{candidateSkus:["SYNTHETIC"],legalChanges:[{before:"old",after:"new"}],headingChanges:[],baseChanges:[],issues:[]}}))?.kind,"review");
 assert.equal(dailyEvent(result({sources:[{status:"failed",name:"Official source",error:"Unavailable"}]}))?.kind,"failure");
 assert.equal(dailyEvent(result({unresolvedProducts:1,rows:[{product:{sku:"SYNTHETIC"},stack:{totalAmount:null}}]}))?.kind,"review");
 // A headline alone establishes neither product applicability nor a cost change.
 assert.equal(dailyEvent(result({notices:[{title:"New tariff publication"}]})),null);
});
