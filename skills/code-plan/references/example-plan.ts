export default async function film(ctx: Studio): Promise<void> {
  await ctx.scene({ id: "scene-1", title: "A quiet morning",
    format: "Short film", aim: "Calm",
    fixed: ["A kitchen at dawn", "Tea by the window", "A calm ending"],
    takes: [{ title: "A room wakes", basis: "bent: A day in one place", chosen: true },
      { title: "An absent guest", basis: "template: Trace of someone" },
      { title: "Light finds its home", basis: "own" }],
    reading: "The viewer first reads this as an empty room. Through light reaching a waiting cup, that becomes a place ready for someone. The image they keep is steam rising in the first sun.",
    rule: "Stay beside the window; let the light be the only arrival.",
    cuts: [{ sees: "The curtain reveals dawn", seconds: 3, clip: "shot-1" },
      { sees: "A cup waits in stillness", seconds: 1.5, clip: "shot-2" },
      { sees: "Light settles on the sill", seconds: 2, clip: "shot-1" },
      { sees: "Steam makes the room feel lived in", seconds: 3, clip: "shot-2" }] });
  const shots = [
    { id: "shot-1", title: "The room wakes", targetSeconds: 5, // Clear action: the curtain reveals the sunrise.
      frame: "Wide view of a quiet kitchen at dawn. A misty window catches the first golden light, above a wooden sill with a white cup on its right end. A folded blue cloth rests beside the cup. The window and sill form a simple, still composition, with the pale sky visible through the glass.",
      motion: "Slow gentle push in toward a misty kitchen window as dawn light reaches the sill. A breeze lifts the curtain, revealing a clear patch of glass with the sunrise beyond. The white cup remains on the right end of the sill, catching the new light. End with the curtain resting beside the window and the golden sky clearly visible through the glass." },
    { id: "shot-2", title: "Tea is ready", targetSeconds: 3, // Quick insert: steam above the cup.
      frame: "Close-up of the white tea cup on the right end of the wooden window sill. The folded blue cloth sits behind it, and soft morning light catches the rim. A narrow curl of steam hangs above the tea. The misty glass is softly out of focus behind the cup, with the curtain resting at its side.",
      motion: "Locked camera beside a white cup of tea on a wooden window sill, framed in close-up. A curl of steam rises above the rim, then unfurls into the morning light. The blue cloth and softly blurred window stay still behind the cup. End with a thin trail of steam hanging over the tea and the bright rim remaining clearly visible in the foreground." },
  ];
  for (const { id, title, targetSeconds } of shots) await ctx.shot({ id, sceneId: "scene-1", title, targetSeconds });
  // Small offline fixture: a real recurring cast/set first needs the shared references in film-craft.md.
  // Illustrative 5–15 s range; copy the chosen model's id and durationSeconds bounds from read_film.models.
  const videoModel = { id: "fake-video", durationSeconds: { min: 5, max: 15 } };
  // One keyframe per shot. All pipelines start together: a shot's card appears as soon as its frame exists,
  // and its clip runs while the person is still choosing for the next shot.
  const clips = await Promise.all(shots.map(async ({ id, frame: framePrompt, motion, targetSeconds }) => {
    const durationSeconds = Math.min(videoModel.durationSeconds.max,
      Math.max(videoModel.durationSeconds.min, Math.ceil(targetSeconds + 1.5)));
    const keyframe = await ctx.keyframe(id, { model: "fake-image", prompt: framePrompt,
      video: { model: videoModel.id, durationSeconds, aspectRatio: "16:9" },
      ...(id === "shot-1" ? { suggest: { input: "first_frame" as const, why: "Keep the window composition across the cuts." } } : {}) });
    if (!keyframe.ok) { await ctx.log(`No frame for ${id}`); return null; }
    const clip = await ctx.video({ ...keyframe.input, model: videoModel.id, shot: id, prompt: motion, durationSeconds, aspectRatio: "16:9" });
    // Fake clips share their bytes. Retain the actual motion in the fixture timeline too.
    if (clip.ok) return { artifact: clip.artifact, motion, frame: keyframe.frame };
    // In real films, fill these amounts from read_film.models (the fixture video costs $0).
    const cost = clip.error.mayHaveCharged ? "The earlier clip may already have charged. " : "The earlier clip did not charge. ";
    await ctx.log(`The clip for ${id} could not be completed. ${cost}`);
    if (clip.error.retry === "none") return null;
    const answer = await ctx.choose(`${id}-retry`, {
      question: `${cost}Retry this shot for an estimated additional $0.00 (offline fixture), or skip?`, options: ["retry", "skip"],
    });
    if (answer !== "retry") return null;
    const retried = await ctx.video({ ...keyframe.input, model: videoModel.id, shot: id, prompt: motion, durationSeconds, aspectRatio: "16:9", variant: "person-retry-1" });
    if (!retried.ok) { await ctx.log(`The retried clip for ${id} also failed. Please choose how to continue in chat.`); return null; }
    return { artifact: retried.artifact, motion, frame: keyframe.frame };
  }));
  const ready = clips.filter((clip): clip is { artifact: Artifact; motion: string; frame: ImageArtifact } => clip !== null);
  if (ready.length !== shots.length) return;
  // Watch before cutting. The run stops here and a review turn opens: it submits a new version with the ranges it saw
  // in place of these target-length placeholders (30 positions per second), and this review then returns at once.
  await ctx.review("first-cut", { clips: ready.map(clip => clip.artifact), note: "Does each clip finish its action?" });
  const range = (index: number, startFrame: number, durationFrames: number) => ({
    artifact: ready[index].artifact, motion: ready[index].motion, startFrame, durationFrames, fit: "cover" as const });
  const timeline = [range(0, 0, 90), { artifact: ready[1].frame, durationFrames: 45, fit: "contain" as const },
    range(0, 90, 60), range(1, 0, 90)]; // One clip, two distinct ranges; a confirmed frame held for 1.5 s.
  // Make the score once the final cut length is known; adapt fake-music to an installed model from read_film.
  const filmSamples = timeline.reduce((sum, row) => sum + row.durationFrames, 0) * 1600;
  const music = await ctx.music({ model: "fake-music", prompt: "Warm, reflective piano and soft strings at a slow tempo", durationSeconds: Math.ceil(filmSamples / 48000 / 30) * 30 });
  if (!music.ok) { await ctx.log("Music failed; choose how to continue before rendering."); return; }
  const leadIn = music.leadInSamples ?? 0;
  if ((music.durationSamples ?? 0) - leadIn < filmSamples) {
    await ctx.log("The music is shorter than the film. Tell the person and make another track with a stable variant."); return;
  }
  await ctx.log("Generated music carries an inaudible SynthID watermark (this demo uses placeholder audio).");
  const rendered = await ctx.render({ timeline,
    captions: [{ text: "Morning", atFrame: 0, durationFrames: 30 }],
    audio: [{ artifact: music.artifact, atSample: 0, startSample: leadIn, durationSamples: filmSamples, gainMilliDb: -6000,
      fadeInSamples: 4800, fadeOutSamples: Math.min(96000, filmSamples) }, { sound: "ding", atSample: 48000, gainMilliDb: -9000 }] });
  await ctx.log(rendered.ok ? "Film rendered" : `Render failed: ${rendered.error.code}`);
}
