// Dev helper: log in and screenshot pages. Usage: npx tsx scripts/screens.mts <outdir> <email> <password> <path>...
import { chromium } from "@playwright/test";
const [outDir, email, password, ...paths] = process.argv.slice(2);
const base = process.env.BASE_URL ?? "http://localhost:3100";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
const page = await ctx.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
if (email) {
  await page.goto(`${base}/login`);
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
}
for (const p of paths) {
  const [path, action] = p.split("#");
  await page.goto(`${base}${path}`, { waitUntil: "networkidle", timeout: 60000 });
  if (action?.startsWith("type:")) {
    await page.waitForSelector(".xterm-helper-textarea", { timeout: 30000 });
    await page.waitForTimeout(1500);
    for (const cmd of action.slice(5).split("|")) {
      await page.locator(".xterm-helper-textarea").focus();
      await page.keyboard.type(cmd.replace(/~SP~/g, " "));
      await page.keyboard.press("Enter");
      await page.waitForTimeout(900);
    }
  }
  const file = `${outDir}/${path.replace(/\//g, "_") || "root"}.png`;
  await page.screenshot({ path: file, fullPage: !action });
  console.log("saved", file);
}
console.log(errors.length ? errors.join("\n") : "no browser errors");
await browser.close();
