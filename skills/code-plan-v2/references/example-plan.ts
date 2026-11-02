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
    const frame = await ctx.choose(`${id}-keyframe`, { question: `Choose a frame for ${id}`, options });
    const clip = await ctx.video({ model: "fake-video", shot: id, references: [frame], prompt: `${prompt}. ${motion}.`, durationSeconds: 6 });
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
    const retried = await ctx.video({ model: "fake-video", shot: id, references: [frame], prompt: `${prompt}. ${motion}.`, durationSeconds: 6, variant: "person-retry-1" });
    if (!retried.ok) { await ctx.log(`The retried clip for ${id} also failed. Please choose how to continue in chat.`); return null; }
    return { artifact: retried.artifact, motion };
  }));
  const ready = clips.filter((clip): clip is { artifact: Artifact; motion: string } => clip !== null);
  if (ready.length !== shots.length) return;
  // Make the score once the final cut length is known; adapt fake-music to an installed model from read_film.
  const filmSamples = ready.length * 6 * 48000;
  const music = await ctx.music({ model: "fake-music", prompt: "Warm, reflective piano and soft strings at a slow tempo", durationSeconds: filmSamples / 48000 });
  if (!music.ok) { await ctx.log("Music failed; choose how to continue before rendering."); return; }
  const leadIn = music.leadInSamples ?? 0;
  if ((music.durationSamples ?? 0) - leadIn < filmSamples) {
    await ctx.log("The music is shorter than the film. Tell the person and make another track with a stable variant."); return;
  }
  await ctx.log("Generated music carries an inaudible SynthID watermark (this demo uses placeholder audio).");
  const rendered = await ctx.render({ timeline: ready, audio: [{ artifact: music.artifact, atSample: 0, startSample: leadIn,
    durationSamples: filmSamples, gainMilliDb: -6000, fadeOutSamples: Math.min(96000, filmSamples) }] });
  await ctx.log(rendered.ok ? "Film rendered" : `Render failed: ${rendered.error.code}`);
}
