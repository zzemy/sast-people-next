import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { signInAs } from "./session";

/**
 * The row menu is opened by a tap and by nothing else.
 *
 * Radix opens a dropdown from its trigger's `pointerdown`, which on touch is the
 * instant a finger lands — so a swipe that merely started on the action button
 * opened the menu mid-scroll, and an open menu holds the page (Radix locks the
 * scroll and the pointer events underneath it) until it is dismissed. The menu
 * tests in evaluationTable.test.tsx stub the dropdown out, so the gesture itself
 * is only observable here.
 */

const admin = { uid: 1, role: 3, name: "管理员" } as const;

// The route compiles on first request in a dev server, which can outlast the
// suite's default budget.
test.describe.configure({ timeout: 90_000 });

async function visibleActionTrigger(page: Page) {
  const trigger = page.locator('[data-slot="row-action-menu"]:visible').first();
  await trigger.waitFor({ state: "visible", timeout: 30_000 });
  const box = await trigger.boundingBox();
  if (!box) throw new Error("the row action trigger has no box");
  return {
    trigger,
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height / 2),
  };
}

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("a swipe that starts on the action button leaves the menu closed", async ({
    page,
    context,
  }) => {
    await signInAs(context, admin);
    await page.goto("/dashboard/interviews");

    const { x, y } = await visibleActionTrigger(page);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    for (const dy of [14, 44, 84, 124, 164]) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y: y - dy }],
      });
    }
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });

    await expect(page.getByRole("menu")).toHaveCount(0);
  });

  test("a tap opens the menu, and a tap while it is open closes it", async ({
    page,
    context,
  }) => {
    await signInAs(context, admin);
    await page.goto("/dashboard/interviews");

    const first = await visibleActionTrigger(page);
    await page.touchscreen.tap(first.x, first.y);
    await expect(page.getByRole("menu")).toBeVisible();

    const second = await visibleActionTrigger(page);
    await page.touchscreen.tap(second.x, second.y);
    await expect(page.getByRole("menu")).toHaveCount(0);
  });
});

test.describe("with a mouse", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("clicking the action button opens the menu", async ({
    page,
    context,
  }) => {
    await signInAs(context, admin);
    await page.goto("/dashboard/interviews");

    const { trigger } = await visibleActionTrigger(page);
    await trigger.click();
    await expect(page.getByRole("menu")).toBeVisible();
  });
});
