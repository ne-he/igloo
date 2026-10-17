# igloo study

A real-time WebGL study of how award-winning scroll sites are built, made with vanilla three.js and my own assets. It is a personal experiment, inspired by [igloo.inc](https://www.igloo.inc) by abeto x Bureaux. No code, shaders, models, textures or audio from that site are used here. Everything was written, modelled, baked or synthesized for this project.

## What is inside

- **Engine.** Every section is its own scene rendered into a half-float target. A fullscreen composite joins them with an ice-cut transition and spectral chromatic aberration. Global bloom and SMAA run at the end.
- **Scroll.** Virtual scroll that loops, frame-rate independent damping, and auto-centering after the user stops.
- **Valley.** No real-time lights. Lighting is baked in Blender, fog reuses the sky gradient, and each scene has its own 3D LUT.
- **Igloo.** 70 bricks in one BatchedMesh with two baked lightmaps (assembled and exploded), mouse push, plexus and an intro timeline.
- **Crystals.** Two-pass refraction with per-channel IOR, a mouse frost simulation on the second UV set, and 3D MSDF labels.
- **Detail view.** A `/portfolio/:slug` router that blends into a dark detail scene with a text panel.
- **Particle room.** Portal rings, plus 150k GPGPU particles that follow signed distance volumes and get pushed by a small fluid sim.
- **Text and audio.** All text is MSDF in WebGL, with a hidden DOM copy for screen readers. All sound is synthesized by `tools/audio/synth.py`.

## Run it

```bash
npm install
npm run dev
```

The dev server opens on http://localhost:5179. Run the tests with `npm test`.

Asset pipelines live in `tools/`: Blender bake scripts (headless), texture and volume generators, audio synthesis, and Playwright checks that take screenshots and measure FPS.

## Stack

three.js r165, Vite, GSAP, postprocessing, three-mesh-bvh, Vitest. Blender 5.1 for bakes, gltf-transform with Draco for geometry.

## Credit

Inspired by igloo.inc by abeto x Bureaux. This repository is an independent study and is not affiliated with them.

Font: IBM Plex Mono (SIL Open Font License).
