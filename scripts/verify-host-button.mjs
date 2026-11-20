// Drives the real page: press "Start hosting" and confirm the lobby then shows
// a shareable LAN link, with no manual address entry.
/* global document */
export default async function run(page) {
  await page.waitForSelector("#start-hosting:not([hidden])", {
    timeout: 20000,
  });
  const before = await page.evaluate(() => ({
    status: document.querySelector("#lan-status").textContent,
    button: document.querySelector("#start-hosting").textContent.trim(),
    linkVisible: !document
      .querySelector("#lan-addresses")
      .hasAttribute("hidden"),
  }));

  await page.click("#start-hosting");
  await page.waitForFunction(
    () => !document.querySelector("#lan-addresses").hasAttribute("hidden"),
    { timeout: 30000 },
  );

  const after = await page.evaluate(() => {
    const hostField = document.querySelector("#server-host");
    return {
      status: document.querySelector("#lan-status").textContent,
      notice: document.querySelector("#lobby-notice").textContent,
      link: document.querySelector("#lan-addresses code")?.textContent ?? null,
      buttonHiddenAfter:
        document.querySelector("#start-hosting").getBoundingClientRect()
          .height === 0,
      advancedIsCollapsed: !document
        .querySelector(".advanced")
        .hasAttribute("open"),
      hostFieldValue: hostField?.value ?? null,
    };
  });
  return { before, after };
}
