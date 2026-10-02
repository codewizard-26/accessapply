// Verifies the real scanner against test-page/index.html in a real browser.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundle = await readFile(path.join(root, "tmp-scanner.js"), "utf8");

export default async function run(page) {
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(() => {
    const ctx = window.AA.scanPage();
    const byId = (id) => ctx.elements.find((e) => e.id === id);
    return {
      title: ctx.title,
      url: ctx.url,
      elementCount: ctx.elements.length,
      job: ctx.job ?? null,
      // hidden content must never appear
      leaksHidden: /INTERNAL_SECRET_TOKEN|ANOTHER_HIDDEN_TOKEN/.test(ctx.text),
      buttons: ctx.elements
        .filter((e) => e.type === "button")
        .map((e) => ({
          id: e.id,
          name: e.accessibleName,
          disabled: !!e.disabled,
        })),
      inputs: ctx.elements
        .filter((e) => e.type === "input")
        .map((e) => ({
          id: e.id,
          label: e.label,
          type: e.inputType,
          required: !!e.required,
          value: e.value,
        })),
      textarea: ctx.elements
        .filter((e) => e.type === "textarea")
        .map((e) => ({ id: e.id, label: e.label, placeholder: e.placeholder })),
      select: ctx.elements
        .filter((e) => e.type === "select")
        .map((e) => ({ id: e.id, label: e.label, options: e.options })),
      links: ctx.elements
        .filter((e) => e.type === "link")
        .map((e) => ({ id: e.id, name: e.accessibleName, href: e.href })),
      headings: ctx.elements
        .filter((e) => e.type === "heading")
        .map((e) => `${e.level}:${e.text}`),
    };
  });

  // Password value must never be emitted.
  const passwordLeak = result.inputs.some(
    (i) => i.type === "password" && i.value !== undefined,
  );

  // Live action check: click the details button through the scanner's ids.
  const action = await page.evaluate(() => {
    const ctx = window.AA.scanPage();
    const target = ctx.elements.find(
      (e) => e.accessibleName === "Show more details",
    );
    if (!target) return { error: "target not found" };
    const el = window.AA.resolveElement(target.id);
    if (!el) return { error: "resolve failed" };
    el.click();
    const disabledTarget = ctx.elements.find((e) => e.disabled);
    return {
      clickedId: target.id,
      result: document.getElementById("result").textContent,
      disabledId: disabledTarget?.id ?? null,
      disabledResolvable: disabledTarget
        ? !!window.AA.resolveElement(disabledTarget.id)
        : null,
      registered: window.AA.registeredCount(),
    };
  });

  const detaches = await page.evaluate(() => {
    const ctx = window.AA.scanPage();
    const target = ctx.elements.find(
      (e) => e.accessibleName === "Show more details",
    );
    const el = window.AA.resolveElement(target.id);
    el.remove();
    return {
      afterDetach: window.AA.revalidateElement(target.id),
      resolve: window.AA.resolveElement(target.id),
    };
  });

  const typeCheck = await page.evaluate(() => {
    const ctx = window.AA.scanPage();
    const email = ctx.elements.find((e) => e.label === "Email address");
    const el = window.AA.resolveElement(email.id);
    el.focus();
    return { id: email.id, focused: document.activeElement === el };
  });

  return { ...result, passwordLeak, action, detaches, typeCheck };
}
