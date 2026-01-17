import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';

if (import.meta.env.DEV) {
  const win = window as typeof window & { __dicomGodDrawImagePatched?: boolean };
  if (!win.__dicomGodDrawImagePatched) {
    win.__dicomGodDrawImagePatched = true;

    const originalDrawImage = CanvasRenderingContext2D.prototype.drawImage;
    let drawCount = 0;

    const resetDrawCount = () => {
      drawCount = 0;
      requestAnimationFrame(resetDrawCount);
    };

    requestAnimationFrame(resetDrawCount);

    CanvasRenderingContext2D.prototype.drawImage = function (...args: any[]) {
      drawCount += 1;
      if (drawCount === 2) {
        const stack = new Error().stack;
        console.warn('[DEV] drawImage called more than once in a single frame');
        if (stack) {
          console.warn(stack);
        }
      }
      return originalDrawImage.apply(this, args as any);
    };
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
