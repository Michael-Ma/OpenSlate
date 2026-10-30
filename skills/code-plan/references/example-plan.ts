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
    const frames = await Promise.all(["a", "b", "c"].map(variant => ctx.image({ model: "fake-image", shot: id, prompt, variant })));
    const options = frames.flatMap(result => result.ok ? [result.artifact] : []);
    if (!options.length) { await ctx.log(`No frames for ${id}`); return null; }
    const firstFrame = await ctx.choose(`${id}-keyframe`, { question: `Choose a frame for ${id}`, options });
    const clip = await ctx.video({ model: "fake-video", shot: id, firstFrame, prompt: motion, durationSeconds: 6 });
    // Fake clips share their bytes. Retain the actual motion in the fixture timeline too.
    if (clip.ok) return { artifact: clip.artifact, motion };
    // In real films, fill these amounts from read_film.models (the fixture video costs $0).
    const cost = clip.error.mayHaveCharged ? "The earlier clip may already have charged. " : "The earlier clip did not charge. ";
    await ctx.log(`The clip for ${id} could not be completed. ${cost}`);
    if (clip.error.retry === "none") return null;
    const answer = await ctx.choose(`${id}-retry`, {
      question: `${cost}Retry this shot for an estimated additional $0.00 (offline fixture), or skip?`, options: ["retry", "skip"],
    });
    if (answer !== "retry") return null;
    const retried = await ctx.video({ model: "fake-video", shot: id, firstFrame, prompt: motion, durationSeconds: 6, variant: "person-retry-1" });
    if (!retried.ok) { await ctx.log(`The retried clip for ${id} also failed. Please choose how to continue in chat.`); return null; }
    return { artifact: retried.artifact, motion };
  }));
  const ready = clips.filter((clip): clip is { artifact: Artifact; motion: string } => clip !== null);
  if (ready.length !== shots.length) return;
  const rendered = await ctx.render(ready);
  await ctx.log(rendered.ok ? "Film rendered" : `Render failed: ${rendered.error.code}`);
}
