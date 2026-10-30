export default async function film(ctx: Studio): Promise<void> {
  await ctx.scene({ id: "scene-1", title: "A quiet morning" });
  const shots = [
    { id: "shot-1", prompt: "Sunrise through a misty window", motion: "Slow gentle push in" },
    { id: "shot-2", prompt: "A cup of tea beside the window", motion: "Locked camera, subtle steam" },
  ];
  for (const { id, prompt } of shots) await ctx.shot({ id, sceneId: "scene-1", title: prompt });
  // Each shot is its own pipeline and all start together: a shot's choice appears as soon as its own frames exist,
  // and its clip runs while the person is still choosing for the next shot.
  const clips = await Promise.all(shots.map(async ({ id, prompt, motion }) => {
    const frames = await Promise.all(["a", "b", "c"].map(variant => ctx.image({ model: "fake-image", prompt, variant })));
    const options = frames.flatMap(result => result.ok ? [result.artifact] : []);
    if (!options.length) { await ctx.log(`No frames for ${id}`); return null; }
    const firstFrame = await ctx.choose(`${id}-keyframe`, { question: `Choose a frame for ${id}`, options });
    const clip = await ctx.video({ model: "fake-video", firstFrame, prompt: motion, durationSeconds: 6 });
    // Fake clips share their bytes. Retain the actual motion in the fixture timeline too.
    if (clip.ok) return { artifact: clip.artifact, motion };
    await ctx.log(`Primary clip failed for ${id}: ${clip.error.code}`);
    const fallbackMotion = "Locked camera, subtle natural movement";
    const fallback = await ctx.video({ model: "fake-video", firstFrame, prompt: fallbackMotion, durationSeconds: 6, variant: "fallback" });
    if (!fallback.ok) { await ctx.log(`Fallback failed for ${id}: ${fallback.error.code}`); return null; }
    return { artifact: fallback.artifact, motion: fallbackMotion };
  }));
  const ready = clips.filter((clip): clip is { artifact: Artifact; motion: string } => clip !== null);
  if (ready.length !== shots.length) return;
  const rendered = await ctx.render(ready);
  await ctx.log(rendered.ok ? "Film rendered" : `Render failed: ${rendered.error.code}`);
}
