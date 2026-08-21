import { useEffect, useRef, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

const DEFAULT_WAVE_COLORS = [
  'rgba(14, 165, 233, 0.24)',
  'rgba(56, 189, 248, 0.2)',
  'rgba(59, 130, 246, 0.16)',
  'rgba(125, 211, 252, 0.18)',
];

const DARK_WAVE_COLORS = [
  'rgba(14, 165, 233, 0.38)',
  'rgba(2, 132, 199, 0.3)',
  'rgba(59, 130, 246, 0.25)',
  'rgba(34, 211, 238, 0.2)',
];

/** A lightweight canvas wave field that leaves the supplied content untouched. */
export function WavyBackground({
  children,
  className,
  containerClassName,
  colors = DEFAULT_WAVE_COLORS,
}: {
  children: ReactNode;
  className?: string;
  containerClassName?: string;
  colors?: string[];
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!host || !canvas || !context) return;

    let width = 0;
    let height = 0;
    let frameId = 0;
    let pixelRatio = 1;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    const resize = () => {
      const rect = host.getBoundingClientRect();
      pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    };

    const draw = (timestamp: number) => {
      context.clearRect(0, 0, width, height);
      const time = timestamp / 1000;
      const baseAmplitude = Math.max(22, height * 0.055);
      const isDark =
        document.documentElement.classList.contains('dark') ||
        window.matchMedia('(prefers-color-scheme: dark)').matches;
      const waveColors = isDark ? DARK_WAVE_COLORS : colors;

      waveColors.forEach((color, index) => {
        const baseY = height * (0.26 + index * 0.16);
        const amplitude = baseAmplitude * (1 - index * 0.1);
        const speed = 0.28 + index * 0.055;
        const frequency = 0.007 + index * 0.0008;

        context.beginPath();
        context.moveTo(-24, height + 24);
        for (let x = -24; x <= width + 24; x += 10) {
          const y =
            baseY +
            Math.sin(x * frequency + time * speed + index * 1.7) * amplitude +
            Math.sin(x * frequency * 0.43 - time * speed * 1.8) *
              amplitude *
              0.42;
          context.lineTo(x, y);
        }
        context.lineTo(width + 24, height + 24);
        context.closePath();
        context.fillStyle = color;
        context.fill();
      });
    };

    const render = (timestamp: number) => {
      draw(timestamp);
      if (!reduceMotion.matches) frameId = requestAnimationFrame(render);
    };

    const restart = () => {
      cancelAnimationFrame(frameId);
      draw(0);
      if (!reduceMotion.matches) frameId = requestAnimationFrame(render);
    };

    const observer = new ResizeObserver(() => {
      resize();
      restart();
    });

    resize();
    restart();
    observer.observe(host);
    reduceMotion.addEventListener('change', restart);

    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
      reduceMotion.removeEventListener('change', restart);
    };
  }, [colors]);

  return (
    <div
      ref={hostRef}
      className={cn(
        'relative overflow-hidden bg-[linear-gradient(180deg,#ccecff_0%,#e6f5fc_48%,#f5f5f7_100%)] dark:bg-[linear-gradient(180deg,#07131d_0%,#080d12_55%,#050505_100%)]',
        containerClassName
      )}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 size-full blur-[10px] dark:mix-blend-screen"
      />
      <div className={cn('relative z-10', className)}>{children}</div>
    </div>
  );
}
