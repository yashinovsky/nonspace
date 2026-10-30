/**
 * Campaigns open Settings without importing the lazy overlay chunk.
 * App installs the opener after `createA11yOverlay`.
 */

type Opener = () => void;

let opener: Opener | null = null;
let pending = false;

export function setSettingsOpener(fn: Opener | null): void {
  opener = fn;
  if (fn && pending) {
    pending = false;
    fn();
  }
}

export function openSettings(): void {
  if (opener) opener();
  else pending = true;
}
