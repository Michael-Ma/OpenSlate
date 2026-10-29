# production/shot_plan@1

Specify what each requested shot communicates, the visible action, framing, camera or subject motion, references, and intended duration. Make neighboring shots complementary rather than repeated descriptions. Use settled scene purposes and narration meaning as constraints.

Create shots through the supported creative patch and then read their saved IDs before writing executable source. For an existing shot, preserve its ID. Reauthor or deliberately reconfirm both prompts against changed intent and set `reauthorPrompts: true`; never change the framing while silently keeping a contradictory old prompt.

A planned visual duration is explicit. No narration uses it directly; accepted compact voiceover fits inside that visual slot unless the human explicitly chooses audio-led duration. The current source uses seconds while shot intent uses integer frames at 30 fps. Review and video must use the same effective settings. For existing shots, use propose_change for changes to duration, narration or paid-media inputs. Apply only pure text edits without media impact.
