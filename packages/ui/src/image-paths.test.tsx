// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { domAnimation, LazyMotion } from "motion/react";
import { Tooltip } from "radix-ui";
import { expect, test } from "vitest";
import { NoFileLinks } from "./file-links.tsx";
import { imagePathText } from "./image-paths.ts";
import { Markdown } from "./markdown.tsx";

const SHOT = "/Users/me/Library/Application Support/Kothar/work/ab/shot.png";
// Outside a chat, a local image renders as "Image: <path>", which is enough to see the path it was read as.
// Paths in text are file links; NoFileLinks keeps them plain, as in a reply still streaming.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const render = (text: string) => {
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() =>
    root.render(
      <LazyMotion features={domAnimation} strict>
        <Tooltip.Provider delayDuration={0}>
          <NoFileLinks>
            <Markdown className="assistant" text={text} />
          </NoFileLinks>
        </Tooltip.Provider>
      </LazyMotion>,
    ),
  );
  const html = host.innerHTML;
  act(() => root.unmount());
  return html;
};

test("a local path with spaces is wrapped in angle brackets and renders as an image", () => {
  expect(imagePathText(`See ![The card](${SHOT}) here.`)).toBe(
    `See ![The card](<${SHOT}>) here.`,
  );
  const html = render(`See ![The card](${SHOT}) here.`);
  expect(html).toContain(`Image: ${SHOT}`);
  expect(html).not.toContain("![The card]");
});

test("~/ and file:// paths are wrapped too, and file:// decodes back to the path", () => {
  expect(imagePathText("![a](~/My Pics/x.JPG)")).toBe(
    "![a](<~/My Pics/x.JPG>)",
  );
  expect(imagePathText("![a](file:///tmp/my dir/x.webp)")).toBe(
    "![a](<file:///tmp/my dir/x.webp>)",
  );
  expect(render("![a](file:///tmp/my dir/x.webp)")).toContain(
    "Image: /tmp/my dir/x.webp",
  );
});

test("a title after the path is kept", () => {
  expect(imagePathText(`![cap](${SHOT} "A title")`)).toBe(
    `![cap](<${SHOT}> "A title")`,
  );
  expect(render(`![cap](${SHOT} "A title")`)).toContain(`Image: ${SHOT}`);
});

test("code spans and fenced code are left as written", () => {
  const span = `Write \`![cap](${SHOT})\` to show it.`;
  expect(imagePathText(span)).toBe(span);
  const fence = `\`\`\`md\n![cap](${SHOT})\n\`\`\``;
  expect(imagePathText(fence)).toBe(fence);
  expect(render(fence)).toContain(`![cap](${SHOT})`);
});

test("already-bracketed, %20-encoded and space-free paths are unchanged", () => {
  for (const text of [
    `![cap](<${SHOT}>)`,
    "![cap](/Users/me/Application%20Support/x.png)",
    "![cap](/tmp/x.png)",
  ]) {
    expect(imagePathText(text)).toBe(text);
  }
  expect(render("![cap](/Users/me/Application%20Support/x.png)")).toContain(
    "Image: /Users/me/Application Support/x.png",
  );
});

test("web addresses, links and non-image paths are unchanged", () => {
  for (const text of [
    "![cap](https://example.com/a b.png)",
    "[doc](/Users/me/Application Support/notes.png)",
    "![cap](/Users/me/Application Support/notes.txt)",
    "![cap](relative dir/x.png)",
  ]) {
    expect(imagePathText(text)).toBe(text);
  }
});

test("several images in one message all render", () => {
  const two = `![one](${SHOT}) and ![two](/tmp/other dir/b.png)\n\n![three](/tmp/c.png)`;
  const html = render(two);
  expect(html).toContain(`Image: ${SHOT}`);
  expect(html).toContain("Image: /tmp/other dir/b.png");
  expect(html).toContain("Image: /tmp/c.png");
});

test("a reply still streaming stays text until the closing parenthesis arrives", () => {
  const full = `Here: ![cap](${SHOT})`;
  for (let end = full.length - 20; end < full.length; end++) {
    const partial = full.slice(0, end);
    expect(imagePathText(partial)).toBe(partial);
    expect(render(partial)).not.toContain("Image:");
  }
  expect(render(full)).toContain(`Image: ${SHOT}`);
});
