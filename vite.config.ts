import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths, so the build works from a subpath such as GitHub
  // Pages' /wizard-puppet/ as well as from the root.
  base: './',
});
