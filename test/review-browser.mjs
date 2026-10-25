// Isolated PostgreSQL + in-memory OSS only. Run after the production build.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import next from "next";
import sharp from "sharp";
const { chromium } = await import(process.env.OMR_PLAYWRIGHT_MODULE || "playwright");
import { fixture } from "./fixture.mjs";
import { cookieFor, grantFor, request, json } from "./cli-helpers.mjs";
const nextApp = next({ dev: false, dir: process.cwd(), hostname: "127.0.0.1", port: 4179 });
await nextApp.prepare();
const f = await fixture({ port: 55512, webPort: 4179, previewLogin: true, webHandler: nextApp.getRequestHandler() });
let browser, page;
const errors = [];
const output = ".test-data/review-browser";
await mkdir(output, { recursive: true });
try {
  const grant = await grantFor(f, await cookieFor(f));
  const api = async (path, options = {}) => {
    const r = await request(f, "/api/v2" + path, {
      ...options, headers: { Authorization: "Bearer " + grant.token, ...options.headers },
    });
    const value = await r.json();
    assert.ok(r.ok, JSON.stringify(value));
    return value;
  };
  const ds = await api("/datasets", json({ name: "复核工作台", description: "隔离测试数据 · 每张谱页独立标注与复核" }));
  const song = await api("/datasets/" + ds.id + "/songs", json({ name: "晴天 · 弹唱谱", songGroupKey: "browser-score", split: "train" }));
  const ids = [];
  for (let n = 1; n <= 3; n++) {
    const svg = `<svg width="800" height="1100"><rect width="800" height="1100" fill="white"/><text x="80" y="110" font-size="38" fill="#334155">SUNNY DAY / ${n}</text><text x="80" y="170" font-size="20">4/4    Play=C    q=72    Capo=3</text><path d="M80 340H720 M80 360H720 M80 380H720 M80 400H720 M80 420H720 M80 440H720 M80 680H720 M80 700H720 M80 720H720 M80 740H720 M80 760H720 M80 780H720" stroke="#475569"/><text x="80" y="495" font-size="20">Synthetic guitar score</text><text x="80" y="830" font-size="20">Isolated UI acceptance fixture</text></svg>`;
    const data = await sharp(Buffer.from(svg)).png().toBuffer();
    let p = await api("/songs/" + song.id + "/pages", {
      method: "POST", headers: { "Content-Type": "image/png", "X-File-Name": "score-" + n + ".png" }, body: data,
    });
    const boxes = [
      { id: "system", classKey: "system", parentSystemId: null, readingOrder: 0, x: 60, y: 300, width: 680, height: 230 },
      { id: "title", classKey: "title", parentSystemId: null, readingOrder: 1, x: 70, y: 60, width: 550, height: 70, metadata: { scope: "page", rawText: "SUNNY DAY" } },
      { id: "guitar", classKey: "guitar", parentSystemId: "system", readingOrder: 2, x: 80, y: 330, width: 640, height: 120 },
    ];
    p = await api("/pages/" + p.image.id, json({ version: p.image.version, annotationFormat: "layout-v2", boxes }, "PUT"));
    if (n <= 2) p = await api("/pages/" + p.image.id + "/confirm", json({ version: p.image.version, acknowledged: true, reviewType: "ai" }));
    ids.push(p.image.id);
  }
  for (const split of ["val", "test"]) {
    const extraSong = await api("/datasets/" + ds.id + "/songs", json({ name: split + " score", songGroupKey: "browser-" + split, split }));
    await api("/songs/" + extraSong.id + "/pages", {
      method: "POST", headers: { "Content-Type": "image/png", "X-File-Name": "score-" + split + ".png" },
      body: await sharp({ create: { width: 800, height: 1100, channels: 3, background: "white" } }).png().toBuffer(),
    });
  }
  await api("/datasets", json({ name: "VeryLongDatasetName".repeat(10), description: "LongUnbrokenDescription".repeat(60) }));
  browser = await chromium.launch({ headless: true, ...(process.env.OMR_BROWSER_CHANNEL ? { channel: process.env.OMR_BROWSER_CHANNEL } : {}) });
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(f.url + "/__test-login");
  const assertSelectArrows = async () => {
    const broken = await page.locator(".ant-select:visible").evaluateAll(selects => selects.flatMap(select => {
      const arrow = select.querySelector(".ant-select-suffix, .ant-select-arrow");
      if (!arrow) return ["Missing Select suffix"];
      const box = select.getBoundingClientRect(), icon = arrow.getBoundingClientRect();
      return icon.bottom > box.bottom + 1 || icon.top < box.top - 1 ||
        Math.abs((icon.top + icon.bottom - box.top - box.bottom) / 2) > 5
        ? [JSON.stringify({ control: select.getAttribute("aria-label"), height: box.height, arrowTop: icon.top - box.top, arrowHeight: icon.height })] : [];
    }));
    assert.deepEqual(broken, [], "Select suffix must stay inside the control on the same line");
  };
  await page.goto(f.url + "/datasets");
  await page.getByRole("button", { name: "打开数据集", exact: true }).first().waitFor();
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 960 });
    await assertSelectArrows();
    const overflow = await page.locator(".dataset-card").evaluateAll(cards =>
      cards.filter(card => card.scrollWidth > card.clientWidth + 1).length);
    assert.equal(overflow, 0, "Dataset card text must not overflow");
    await page.screenshot({ path: output + "/cards-" + width + ".png", fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(f.url + "/datasets/" + ds.id + "?status=ai_reviewed");
  await page.getByText("共 2 张谱页", { exact: true }).first().waitFor();
  await page.screenshot({ path: output + "/01-list.png", fullPage: true });
  await page.getByRole("button", { name: "全部谱页 5", exact: true }).waitFor();
  await page.getByRole("button", { name: "草稿 3", exact: true }).click();
  await page.waitForURL(url => url.searchParams.get("status") === "draft");
  await page.getByText("共 3 张谱页", { exact: true }).first().waitFor();
  const draftText = await page.locator(".ant-table-tbody").innerText();
  for (const label of ["训练集", "验证集", "测试集"]) assert.ok(draftText.includes(label));
  await page.getByRole("button", { name: "AI 已复核 2", exact: true }).click();
  await page.waitForURL(url => url.searchParams.get("status") === "ai_reviewed");
  await page.getByText("共 2 张谱页", { exact: true }).first().waitFor();
  await assertSelectArrows();
  const rows = page.locator(".ant-table-tbody tr.ant-table-row");
  assert.ok(!(await rows.first().innerText()).includes(".png"), "Song column has no filename subtitle");
  assert.ok((await rows.first().boundingBox()).height <= 48, "Compact table rows");
  assert.equal(await rows.count(), 2);
  assert.ok((await rows.nth(0).innerText()).includes("第 2 页"));
  await rows.nth(0).locator("input[type=checkbox]").check();
  await page.getByText("已选 1 张谱页", { exact: true }).waitFor();
  assert.ok(!page.url().includes("/songs/"));
  await page.getByRole("button", { name: "取消选择", exact: true }).click();
  await page.getByRole("button", { name: "标注 / 复核", exact: true }).first().click();
  await page.waitForURL("**/pages/" + ids[1] + "?**");
  await page.locator(".canvas-loading").waitFor({ state: "hidden" });
  await page.screenshot({ path: output + "/02-editor.png", fullPage: true });
  const viewBounds = await page.locator(".editor-view-switch").boundingBox();
  assert.ok(Math.abs(viewBounds.x + viewBounds.width / 2 - 720) <= 2, "View switch is centred in the header");
  await page.locator(".stage").focus();
  await page.evaluate(() => {
    window.__reviewTabEvents = [];
    window.addEventListener("keydown", event => {
      if (event.key === "Tab") window.__reviewTabEvents.push({
        target: event.target.tagName, prevented: event.defaultPrevented,
        openSelect: !!document.querySelector('.ant-select [aria-expanded="true"]'),
        dialogs: [...document.querySelectorAll(".ant-modal-wrap")].filter(d => d.getClientRects().length).length,
      });
    });
  });
  await page.keyboard.press("Tab");
  await page.locator(".crop-results").waitFor();
  await assertSelectArrows();
  await page.screenshot({ path: output + "/03-crops.png", fullPage: true });
  const cropCount = await page.locator(".crop-card").count();
  for (const modifier of ["Control", "Meta"]) {
    await page.locator(".crop-card").first().hover();
    await page.keyboard.press("q");
    assert.equal(await page.locator(".crop-card").count(), cropCount - 1);
    await page.locator(".save-status.unsaved").waitFor();
    assert.equal(await page.locator(".ant-modal").count(), 0);
    assert.equal((await api("/pages/" + ids[1])).boxes.length, 3, "Q only edits the local JSON");
    await page.keyboard.press(modifier + "+z");
    assert.equal(await page.locator(".crop-card").count(), cropCount);
    await page.locator(".save-status.unsaved").waitFor({ state: "hidden" });
    await page.keyboard.press(modifier + "+Shift+z");
    assert.equal(await page.locator(".crop-card").count(), cropCount - 1);
    await page.keyboard.press(modifier + "+z");
    assert.equal(await page.locator(".crop-card").count(), cropCount);
  }

  await page.keyboard.press("Tab");
  await page.locator(".stage").waitFor({ state: "visible" });
  assert.equal(await page.locator(".ant-modal").count(), 0, "Switching views does not prompt to leave");
  const selectTitle = () => page.locator(".box-list button").filter({ hasText: "标题" }).click();
  await selectTitle();
  await assertSelectArrows();
  await page.locator(".properties textarea").first().focus();
  await page.keyboard.press("Tab");
  assert.ok(!new URL(page.url()).searchParams.get("view") || new URL(page.url()).searchParams.get("view") === "original", "Tab in inputs retains normal focus navigation");
  await page.getByRole("button", { name: "删除框", exact: true }).click();
  assert.equal(await page.locator(".ant-modal").count(), 0);
  await page.locator(".save-status.unsaved").waitFor();
  assert.equal((await api("/pages/" + ids[1])).boxes.length, 3);
  await page.route("**/api/v2/pages/" + ids[1], route =>
    route.request().method() === "PUT"
      ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "模拟保存失败" }) })
      : route.continue());
  await page.getByRole("button", { name: "确认并下一页", exact: true }).click();
  await page.getByText("模拟保存失败", { exact: true }).waitFor();
  assert.ok(page.url().includes(ids[1]));
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await page.locator(".save-status.unsaved").waitFor({ state: "hidden" });
  await page.unroute("**/api/v2/pages/" + ids[1]);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await page.locator(".stage").focus();
  await page.keyboard.press("Control+s");
  await page.locator(".save-status.unsaved").waitFor({ state: "hidden" });
  assert.equal((await api("/pages/" + ids[1])).boxes.length, 2);
  assert.equal(f.objects.size, 5);
  await page.getByRole("button", { name: "确认并下一页", exact: true }).click();
  await page.waitForURL("**/pages/" + ids[0] + "?**");
  assert.ok(page.url().includes("queue=ai_reviewed"));
  await page.locator(".canvas-loading").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "‹ 上一页", exact: true }).click();
  await page.waitForURL("**/pages/" + ids[1] + "?**");
  assert.equal((await api("/pages/" + ids[1])).image.status, "confirmed");
  await page.locator(".canvas-loading").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "下一页 ›", exact: true }).click();
  await page.waitForURL("**/pages/" + ids[0] + "?**");
  await page.locator(".canvas-loading").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "确认并下一页", exact: true }).click();
  await page.getByText(/队列已处理完成/).waitFor();
  assert.ok(page.url().includes(ids[0]));
  assert.equal((await api("/pages/" + ids[2])).image.status, "draft");
  for (const viewport of [{ width: 1024, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    // Wait for ResizeObserver and the browser layout pass.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const bounds = await page.evaluate(() => ({
      viewport: innerWidth, width: document.documentElement.scrollWidth,
      canvas: document.querySelector(".stage").getBoundingClientRect().height,
    }));
    assert.ok(bounds.width <= bounds.viewport + 1, JSON.stringify(bounds));
    assert.ok(bounds.canvas >= 180, JSON.stringify(bounds));
    await assertSelectArrows();
    await page.screenshot({ path: output + "/editor-" + viewport.width + ".png", fullPage: true });
  }
  assert.deepEqual(errors, []);
  console.log("PASS: Chromium list page numbers, reversible deletion, failed-save retention, AI queue confirmation, previous-page return, review counts, split labels, compact rows, cross-platform Q/delete/undo/redo in crops, Ctrl+S save, centred Tab view switching, card overflow, Select suffix alignment, 1024/390px layout.");
 } catch (error) {
  if (page) {
    console.error("Review browser state", await page.evaluate(() => ({
      url: location.href, activeTag: document.activeElement?.tagName,
      events: window.__reviewTabEvents,
      cropTargets: [...document.querySelectorAll(".crop-card")].map(c => ({ id: c.dataset.boxId, selected: c.classList.contains("crop-card-selected"), hovered: c.matches(":hover") })),
      body: document.body.innerText.slice(0, 3000),
    })).catch(() => ({})));
    console.error("Browser errors", errors);
    await writeFile(output + "/failure.html", await page.content()).catch(() => {});
    await page.screenshot({ path: output + "/failure.png", fullPage: true }).catch(() => {});
  }
  process.exitCode = 1;
  throw error;
} finally {
  await browser?.close();
  await f.close();
  await nextApp.close();
}
