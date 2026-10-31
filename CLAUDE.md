# Wizard Puppet

A projected "virtual puppet" face for a Wizard of Oz production: a Three.js page
(Vite + TypeScript, no framework) that displays only the puppet and is driven
from the keyboard.

## Working rules

- **Stay inside this repo.** Don't read, search, or open files outside the
  repository (including other folders under the home directory, the source
  `.blend` files, or system-wide searches) without asking first. If something
  needed seems to live elsewhere, say so and ask.

## Notes

- Requires Node 20.19+ (Vite 8). The system `node` may be older; use nvm
  (`nvm use 25`).
- The model is `public/models/wizard_head.glb`, exported from Blender. three.js
  strips `.` from node names on load, so bone `eye.L` is found as `eyeL`.
