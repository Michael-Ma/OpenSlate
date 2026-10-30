export default async function film(ctx: Studio): Promise<void> {
  await ctx.scene({ id: "scene-1", title: "A quiet morning" });
  const clips: { artifact: Artifact; motion: string }[] = [];
  const shots = [
    { prompt: "Sunrise through a misty window", motion: "Slow gentle push in" },
    { prompt: "A cup of tea beside the window", motion: "Locked camera, subtle steam" },
  ];
  for (const [index, { prompt, motion }] of shots.entries()) {
    const id = `shot-${index + 1}`;
    await ctx.shot({ id, sceneId: "scene-1", title: prompt });
    const frames = await Promise.all(["a", "b", "c"].map(variant => ctx.image({ model: "fake-image", prompt, variant })));
    const options = frames.flatMap(result => result.ok ? [result.artifact] : []);
    if (!options.length) { await ctx.log(`No frames for ${id}`); return; }
    const firstFrame = await ctx.choose(`${id}-keyframe`, { question: `Choose a frame for ${id}`, options });
    const clip = await ctx.video({ model: "fake-video", firstFrame, prompt: motion, durationSeconds: 6 });
    // Fake clips share their bytes. Retain the actual motion in the fixture timeline too.
    if (clip.ok) clips.push({ artifact: clip.artifact, motion });
    else {
      await ctx.log(`Primary clip failed for ${id}: ${clip.error.code}`);
      const fallbackMotion = "Locked camera, subtle natural movement";
      const fallback = await ctx.video({ model: "fake-video", firstFrame, prompt: fallbackMotion, durationSeconds: 6, variant: "fallback" });
      if (!fallback.ok) { await ctx.log(`Fallback failed: ${fallback.error.code}`); return; }
      clips.push({ artifact: fallback.artifact, motion: fallbackMotion });
    }
  }
  const rendered = await ctx.render(clips);
  await ctx.log(rendered.ok ? "Film rendered" : `Render failed: ${rendered.error.code}`);
}
