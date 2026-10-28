# Style library 8.0.0

Use the style ID and label from this table in `visualStyle.styleId`/`label` and `libraryVersion: "8.0.0"`. Each family's full traits, image template, negatives, motion and consistency notes are in `craft-style-prompting` (`references/<family>.md`); read the family file before writing a look's record or its prompts.

| Style ID | Label | Family file | Suits | Main risk |
|---|---|---|---|---|
| `grounded-realism` | Grounded realism | realism | Drama, narrative, brand story, relatable comedy, explainer with people | Drifts to the glossy "AI look": smoothed skin, teal-orange grade |
| `documentary-handheld` | Documentary handheld | realism | Social-impact, behind the scenes, testimonials, travel, native social | "Handheld" turns into heavy shake or warping; ask for subtle drift |
| `glossy-commercial` | Glossy commercial | realism | Product ads, launches, e-commerce loops, mock-epic parody | Logos and label text garble |
| `fashion-editorial` | Fashion editorial | realism | Fashion and beauty, lookbooks, mood films | Anatomy breaks in dynamic poses |
| `noir-bw` | Noir black and white | film-and-period | Mystery, crime, moody brand films, flashback treatment | Colour creeps back; blacks lift to grey |
| `vintage-film-16mm` | Vintage 16mm | film-and-period | Memoir, home-movie nostalgia, travel diary, indie music | Grain boils between frames |
| `vintage-film-35mm` | Vintage 35mm | film-and-period | Narrative drama, premium brand, romance | Collapses into generic digital "cinematic" |
| `period-70s` | 1970s | film-and-period | Retro ads, nostalgia, period fiction | Modern objects leak in |
| `period-80s` | 1980s | film-and-period | Synth music, retro tech ads, action pastiche | Turns into neon cyberpunk |
| `period-90s` | 1990s | film-and-period | Youth culture, nostalgia ads, skate and street | Anachronistic devices |
| `vhs-camcorder` | VHS camcorder | film-and-period | Found footage, horror, parody, music inserts | Pristine HD with a fake scanline overlay |
| `neon-cyberpunk` | Neon cyberpunk | stylized-live-action | Sci-fi, tech launches, electronic music, gaming | Gibberish signage; ask for abstract glyphs |
| `pastel-storybook` | Pastel storybook | stylized-live-action | Whimsical ads, quirky stories, kids, hospitality | Symmetry breaks in clips |
| `dreamy-soft-focus` | Dreamy soft focus | stylized-live-action | Romance, wellness, memory treatment, lifestyle | Mush with no readable subject |
| `surreal-dreamcore` | Surreal dreamcore | stylized-live-action | Art films, music pieces, fashion mood, concept ads | Models normalise the impossible element |
| `anime-2d` | 2D anime | 2d-illustrated | Story shorts, music, youth brands, game trailers | Faces turn semi-realistic in video |
| `cel-flat` | Flat cel animation | 2d-illustrated | Explainers, onboarding, corporate, education | Video adds shading and gradients |
| `watercolor-ink` | Watercolour and ink | 2d-illustrated | Poetry, memoir, cultural pieces, gentle stories | Becomes digital painting; faces vary |
| `paper-cutout` | Paper cut-out | 2d-illustrated | Explainers, kids, folk tales, craft brands | Characters bend like rubber |
| `pixel-art` | Pixel art | 2d-illustrated | Games, retro tech, playful ads, loops | Mixed pixel sizes; smeared pixels; no readable text |
| `comic-graphic-novel` | Comic graphic novel | 2d-illustrated | Action shorts, gaming, editorial explainers | Never ask for a known publisher's look |
| `stylized-3d-feature` | Stylized 3D | 3d-and-tactile | Kids and family, mascots, animal and object comedy | Drifts to a generic toy render |
| `claymation-stop-motion` | Claymation | 3d-and-tactile | Quirky ads, kids, craft and food brands, holiday | Motion turns buttery smooth; needs more takes |
| `minimal-motion-graphics` | Minimal motion graphics | motion-graphics | Data explainers, app features, title sequences | Poor easing, alignment and text; shapes wobble |

`custom` is allowed when no entry fits: write the traits from the brief and say which library entry it is closest to.
