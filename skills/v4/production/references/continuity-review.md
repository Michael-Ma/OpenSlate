# Continuity and human review

For each affected shot, compare the relevant neighboring shots and shared references. Track subject identity, product details, wardrobe, setting, time of day, lighting direction, screen direction, camera distance, and action progression only where they matter. Preserve established choices; propose a changed continuity rule explicitly instead of letting prompts drift independently.

Separate the image prompt's composition and visible subject from the video's intended motion. Prefer a clear action and camera move that fit the clip duration. Carry approved product or character references through the supported reference inputs. Do not invent reference images or claim that text alone guarantees identity consistency.

Every video is conditioned on the exact image reviewed by the human. A frame needs cropping, replacement, or changed settings before approval, not an invisible alteration afterward. Review describes the frame together with motion, duration, and profile; an image-only “looks good” is not automatically an approval of a different generation setup. The human decision channel records the exact displayed subset. Neither a prompt nor `p.approvedImage` records that decision.

When the user requests a close-up of one shot, revise that shot's framing and prompts, retain neighboring shots' settled choices, and prepare the affected execution change. Present any continuity consequence. Keep previous takes in history; only compatible current results should enter the new draft. A late result from the replaced candidate remains evidence, not an instruction to restore the old choice.

Treat aesthetic criticism as creative feedback. Interpret the requested change and its scope, then use the service's recorded authority for any additional candidate. Do not launch a self-directed “improve until good” loop. A lost response is unresolved work, and a technically valid ugly clip is not a technical failure. Trusted retry classification and budget admission are executor responsibilities.

If image inspection is unavailable to the active model, describe only verified metadata and request human visual judgment. Never report unseen content as checked. When current artifact evidence marks a preview as a fixture, describe it as placeholder footage. Do not infer all outputs are fixtures or all are real from a provider choice.
