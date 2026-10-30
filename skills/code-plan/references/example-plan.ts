export default async function film(ctx: Studio): Promise<void> {
  await ctx.scene({ id: "scene-1", title: "A quiet morning" });
  const clips: Artifact[] = [];
  for (const [index, prompt] of ["Sunrise through a misty window", "A cup of tea beside the window"].entries()) {
    const id = `shot-${index + 1}`;
    await ctx.shot({ id, sceneId: "scene-1", title: prompt });
    const frames = await Promise.all(["a", "b", "c"].map(variant => ctx.image({ model: "fake-image", prompt, variant })));
    const options = frames.flatMap(result => result.ok ? [result.artifact] : []);
    if (!options.length) { await ctx.log(`No frames for ${id}`); return; }
    const firstFrame = await ctx.choose(`${id}-keyframe`, { question: `Choose a frame for ${id}`, options });
    const clip = await ctx.video({ model: "fake-video", firstFrame, prompt: "Slow gentle push in", durationSeconds: 6 });
    if (clip.ok) clips.push(clip.artifact);
    else {
      await ctx.log(`Primary clip failed for ${id}: ${clip.error.code}`);
      const fallback = await ctx.video({ model: "fake-video", firstFrame, prompt: "Locked camera, subtle natural movement", durationSeconds: 6, variant: "fallback" });
      if (!fallback.ok) { await ctx.log(`Fallback failed: ${fallback.error.code}`); return; }
      clips.push(fallback.artifact);
    }
  }
  const rendered = await ctx.render(clips);
  await ctx.log(rendered.ok ? "Film rendered" : `Render failed: ${rendered.error.code}`);
}
