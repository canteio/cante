import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CPSC_RECALLS_SOURCE_ID,
  findCpscRecallSource,
} from "./load-live-recalls";
import type { SourceDefinition } from "@/lib/sources/registry";

function fakeSource(id: string): SourceDefinition {
  return {
    id,
    country: "United States",
    name: `fake source ${id}`,
    domain: "example.com",
    url: "https://example.com",
    regulationType: "standards",
    reliabilityStatus: "working",
    parser: "cpsc-recalls-json",
    view: id,
    rawFilename: `${id}.json`,
  } as SourceDefinition;
}

test("findCpscRecallSource finds the CPSC source by id among others", () => {
  const sources = [fakeSource("us-ofac-list-updates"), fakeSource(CPSC_RECALLS_SOURCE_ID), fakeSource("us-osha-federal-register")];
  const found = findCpscRecallSource(sources);
  assert.equal(found?.id, CPSC_RECALLS_SOURCE_ID);
});

test("findCpscRecallSource returns undefined when the CPSC source isn't registered", () => {
  const sources = [fakeSource("us-ofac-list-updates")];
  assert.equal(findCpscRecallSource(sources), undefined);
});
