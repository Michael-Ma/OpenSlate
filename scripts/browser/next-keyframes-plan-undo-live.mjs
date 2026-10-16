// B22.1: real application routes in the disposable fake-provider studio. No fixture transport or response mocks.
// The integration seed already has frames, so first add one directed shot that has never bought a keyframe.
const expect = (condition, message) => { if (!condition) throw new Error(message); };

async function savedShot(page) {
  await page.click('[data-act="save-shot"]');
  await page.waitForSelector('form[data-form="shot"]', { state: "detached", timeout: 15000 });
}

export const scenarios = [{
  name: "next-keyframes-live-plan-edit-undo",
  query: "ui=next",
  viewport: { width: 1440, height: 900 },
  async run({ page }) {
    await page.waitForSelector('main.work[data-view="keyframes"] .preview .pic-img', { timeout: 30000 });
    await page.click('[data-act="tab"][data-view="plan"]');
    await page.waitForSelector('main.plan .scene[data-scene]');
    const sceneId = await page.locator('main.plan .scene[data-scene]').first().getAttribute("data-scene");
    await page.click(`[data-act="add-shot"][data-scene="${sceneId}"]`);
    await page.waitForSelector('[data-editing="true"] form[data-form="shot"]');
    const shotId = await page.locator('[data-editing="true"][data-shot]').getAttribute("data-shot");
    const originalPurpose = "A quiet fixture detail before the café opens";
    await page.fill('form[data-form="shot"] [data-field="purpose"]', originalPurpose);
    await page.fill('form[data-form="shot"] [data-field="framing"]', "Close up");
    await page.fill('form[data-form="shot"] [data-field="prompt"]', "Synthetic fixture: a cup on the café counter at dawn.");
    await savedShot(page);

    // The live sequence: human Plan edit, Undo, fresh Keyframes read, and a new scene keyframe press.
    const headBefore = Number(await page.locator("main.plan").getAttribute("data-head"));
    await page.click(`[data-act="edit-shot"][data-shot="${shotId}"]`);
    await page.fill('form[data-form="shot"] [data-field="purpose"]', `${originalPurpose}, quietly`);
    await savedShot(page);
    const undoReply = page.waitForResponse(response => response.request().method() === "POST" && /\/storyboard$/.test(new URL(response.url()).pathname));
    await page.click('[data-act="plan-undo"]');
    const undoResponse = await undoReply;
    expect(undoResponse.status() === 200, `Undo failed: ${undoResponse.status()} ${await undoResponse.text()}`);
    const undone = await undoResponse.json();
    expect(undone.headVersion === headBefore + 2, `Plan edit and Undo did not each advance the head: ${JSON.stringify(undone)}`);
    await page.waitForFunction(({ shotId, purpose, head }) => {
      const row = document.querySelector(`main.plan .shot-row[data-shot="${shotId}"]`);
      return document.querySelector("main.plan")?.getAttribute("data-head") === String(head) && row?.querySelector(".shot-main > b")?.textContent === purpose;
    }, { shotId, purpose: originalPurpose, head: undone.headVersion });

    await page.click('[data-act="tab"][data-view="keyframes"]');
    await page.click(`[data-act="scene"][data-scene="${sceneId}"]`);
    await page.waitForSelector('[data-act="make-keyframes"]:not([disabled])', { timeout: 15000 });
    const generationReply = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith(`/scenes/${sceneId}/generate`));
    await page.click('[data-act="make-keyframes"]');
    const response = await generationReply;
    expect(response.status() === 200, `Fresh keyframes after Undo were refused: ${response.status()} ${await response.text()}`);
    const body = response.request().postDataJSON(), result = await response.json();
    expect(body.expectedRequestId === undone.requestId, `Keyframes did not echo Undo's current request: ${JSON.stringify(body)}`);
    expect(body.kind === "image" && body.targetShotIds === undefined, `The scene action changed its scope: ${JSON.stringify(body)}`);
    expect(result.shotIds.length === 1 && result.shotIds[0] === shotId, `The scene action bought unexpected shots: ${JSON.stringify(result)}`);
    await page.waitForSelector(`[data-card="${shotId}"] .pic-img`, { timeout: 20000 });
  },
}];
