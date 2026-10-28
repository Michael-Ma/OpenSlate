# Sources

Searched 2026-10-28. Vendor and community guides vary by model version. Treat the specifics as starting points, and confirm them against the locked model before relying on them. Style traits come from general cinematography, photography and animation knowledge. The prompt-structure rules come from the sources below.

## Official guides

- Runway, Image to Video prompting guide (Gen-4.5): https://help.runwayml.com/hc/en-us/articles/48324313115155-Image-to-Video-Prompting-Guide. The image sets composition, lighting and style, so the prompt should describe motion: camera motion, motion style, timing, direction and speed.
- Runway, Creating with Gen-4 (legacy): https://help.runwayml.com/hc/en-us/articles/37327109429011-Creating-with-Gen-4
- Runway Academy prompt guide: https://academy.runwayml.com/prompt-guide
- Runway, AI image styles: https://runwayml.com/resources/ai-image-styles
- Google, Veo video generation prompt guide: https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/video/video-gen-prompt-guide. Covers breaking a prompt into components, with cinematography, subject, action, context and style.
- Google, Imagen prompt guide: https://ai.google.dev/gemini-api/docs/imagen-prompt-guide. Covers photography, lens and style modifiers.

## Community and vendor guides

- Atlabs, Runway Gen-4 image-to-video guide: https://www.atlabs.ai/blog/how-to-prompt-with-runway-gen-4-image-to-video-a-comprehensive-guide. Says to phrase constraints positively, because Gen-4 ignores exclusions.
- Magic Hour, reference images in image-to-video: https://magichour.ai/blog/how-to-use-reference-images-in-image-to-video. Recommends styling the image first, then animating it.
- Magic Hour, cinematic video prompt cookbook: https://magichour.ai/blog/cinematic-ai-video-prompt-cookbook
- Magic Hour, style transfer, video vs image: https://magichour.ai/blog/ai-style-transfer-video-vs-image
- Segmind, Wan image-to-video prompts: https://blog.segmind.com/wan-i2v-prompts-tips-guide/. Says vague prompts fall back to generic cinematic motion.
- fal, Kling 2.6 prompt guide: https://fal.ai/learn/devs/kling-2-6-pro-prompt-guide
- fal, Wan 2.6 prompt guide: https://fal.ai/learn/devs/wan-2-6-prompt-guide-mastering-all-three-generation-modes
- Frameo, writing AI video prompts: https://frameo.ai/blog/create-prompts-ai-video-generation
- Tessl registry, reference-driven video prompting: https://tessl.io/registry/skills/github/nolanx-ai/nolanx.ai/reference-driven-video-prompting. Says to separate subject motion from camera motion.
- Dreamina, start and end frame motion control: https://dreamina.capcut.com/ai-video/ai-video-motion-control
- DreamHost, Veo 3.1 prompt guide: https://www.dreamhost.com/blog/veo-3-1-prompt-guide/
- BestHub, photography and illustration prompt templates: https://www.besthub.dev/articles/15-essential-photography-illustration-prompt-templates-for-consistent-ai-images-c36487e2c087. Recommends limiting conflicting style words to two or three.
- ImagineArt, GPT Image 1.5 prompt guide: https://www.imagine.art/blogs/gpt-image-1-5-prompt-guide

## Failure modes

- Kling, fixing drift and consistency: https://kling.ai/blog/fix-ai-video-drift-consistency-guide. Covers identity and wardrobe drift.
- Higgsfield, why AI video generations fail: https://higgsfield.ai/blog/why-ai-video-generations-fail. Covers fine-detail and face flicker.
- FilmDaft, limits and failure modes in AI output: https://filmdaft.com/ai-failure-modes/
- A survey of AI-generated video evaluation (arXiv 2410.19884): https://arxiv.org/pdf/2410.19884. A taxonomy that includes blur and low-motion errors.

## Not found

I found no authoritative source on anime-specific or stop-motion-specific artifacts in current models. The failure modes listed for those styles come from general knowledge and should be tested on the locked models.
