import { useEffect, useRef } from 'react';

import { cn } from '@/lib/utils';

interface CanvasRevealEffectProps {
  active?: boolean;
  animationSpeed?: number;
  className?: string;
  colors?: Array<[number, number, number]>;
  containerClassName?: string;
  dotSize?: number;
}

interface Particle {
  color: [number, number, number];
  phase: number;
  size: number;
  x: number;
  y: number;
}

/**
 * A compact canvas treatment for revealing a card's AI transformation state.
 * It owns no content and stays pointer-events-free, making it safe to layer
 * over images, buttons, and semantic card copy.
 */
export function CanvasRevealEffect({
  active = true,
  animationSpeed = 3,
  className,
  colors = [
    [125, 211, 252],
    [255, 255, 255],
  ],
  containerClassName,
  dotSize = 1.5,
}: CanvasRevealEffectProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !active) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    let animationFrame = 0;
    let particles: Particle[] = [];
    let width = 0;
    let height = 0;

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      width = bounds.width;
      height = bounds.height;
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

      const count = Math.max(
        68,
        Math.min(150, Math.round((width * height) / 2200))
      );
      particles = Array.from({ length: count }, (_, index) => ({
        x: Math.random() * width,
        y: Math.random() * height,
        phase: Math.random() * Math.PI * 2,
        size: dotSize * (0.65 + Math.random() * 0.8),
        color: colors[index % colors.length] ?? [255, 255, 255],
      }));
    };

    const paint = (timestamp: number) => {
      const time = timestamp * 0.001 * animationSpeed;
      context.clearRect(0, 0, width, height);

      const positions = particles.map((particle) => ({
        ...particle,
        currentX: particle.x + Math.sin(time + particle.phase) * 9,
        currentY: particle.y + Math.cos(time * 0.82 + particle.phase) * 9,
      }));

      for (let index = 0; index < positions.length; index++) {
        const current = positions[index];
        for (
          let nextIndex = index + 1;
          nextIndex < positions.length;
          nextIndex++
        ) {
          const next = positions[nextIndex];
          const distance = Math.hypot(
            current.currentX - next.currentX,
            current.currentY - next.currentY
          );
          if (distance > 88) continue;

          const opacity = (1 - distance / 88) * 0.2;
          const [red, green, blue] = current.color;
          context.beginPath();
          context.strokeStyle = `rgba(${red}, ${green}, ${blue}, ${opacity})`;
          context.lineWidth = 0.65;
          context.moveTo(current.currentX, current.currentY);
          context.lineTo(next.currentX, next.currentY);
          context.stroke();
        }
      }

      for (const particle of positions) {
        const [red, green, blue] = particle.color;
        context.beginPath();
        context.fillStyle = `rgba(${red}, ${green}, ${blue}, 0.82)`;
        context.arc(
          particle.currentX,
          particle.currentY,
          particle.size,
          0,
          Math.PI * 2
        );
        context.fill();
      }

      animationFrame = window.requestAnimationFrame(paint);
    };

    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    animationFrame = window.requestAnimationFrame(paint);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
    };
  }, [active, animationSpeed, colors, dotSize]);

  return (
    <div
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-0 overflow-hidden',
        containerClassName
      )}
    >
      <canvas ref={canvasRef} className={cn('size-full', className)} />
    </div>
  );
}
