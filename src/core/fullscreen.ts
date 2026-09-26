import { isCoarsePointer } from './device';

/** Hide the browser chrome on a phone. Must run from a tap. Desktop and unsupported browsers do nothing. */
export function requestGameFullscreen(): void {
  if (!isCoarsePointer()) return;
  if (document.fullscreenElement || !document.fullscreenEnabled) return;
  document.documentElement
    .requestFullscreen({ navigationUI: 'hide' })
    .then(() => {
      const orientation = screen.orientation as ScreenOrientation & { lock?: (type: string) => Promise<void> };
      return orientation.lock?.('landscape');
    })
    .catch(() => {});
}
