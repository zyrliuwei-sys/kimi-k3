'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type TouchEvent as ReactTouchEvent,
} from 'react';
import { ArrowRight } from 'lucide-react';
import { motion } from 'motion/react';

import { Link } from '@/core/i18n/navigation';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import { buttonVariants } from '@/components/ui/button';

export function Hero() {
  return (
    <InfiniteScrollCanvas>
      <div className="flex h-full items-center justify-center">
        <div className="mx-auto max-w-xl px-4 text-center">
          <motion.h1
            initial={{ opacity: 0, filter: 'blur(10px)' }}
            animate={{ opacity: 1, filter: 'blur(0px)' }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="font-serif text-[clamp(1.75rem,5vw,3.5rem)] leading-[1.05] font-medium tracking-tight md:text-6xl"
          >
            {m['landing.hero.headline_prefix']()}{' '}
            <span className="text-brand-gradient">
              {m['landing.hero.headline_gradient']()}
            </span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, filter: 'blur(10px)' }}
            animate={{ opacity: 1, filter: 'blur(0px)' }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="text-foreground/65 mx-auto mt-5 max-w-md text-base leading-relaxed text-balance md:text-lg"
          >
            {m['landing.hero.subheadline']()}
          </motion.p>
          <motion.div
            initial={{ opacity: 0, filter: 'blur(10px)' }}
            animate={{ opacity: 1, filter: 'blur(0px)' }}
            transition={{ duration: 0.6, delay: 0.6 }}
            className="mt-7 flex flex-wrap items-center justify-center gap-3"
          >
            <Link
              href="/api-playground"
              className={cn(
                buttonVariants({ size: 'lg' }),
                'h-11 gap-2 rounded-full px-6 text-sm'
              )}
            >
              {m['landing.hero.cta_api']()}
              <ArrowRight className="size-4" />
            </Link>
            <Link
              href="/compare"
              className={cn(
                buttonVariants({ variant: 'outline', size: 'lg' }),
                'h-11 rounded-full px-6 text-sm'
              )}
            >
              {m['landing.hero.cta_compare']()}
            </Link>
          </motion.div>
        </div>
      </div>
    </InfiniteScrollCanvas>
  );
}

// Project's showcase + generated images — used as the scattered cards in the
// infinite scroll canvas. Loop them so each tile has enough variety.
const DEFAULT_IMAGES = [
  '/imgs/generated/showcase-case-1-report-summary-1784854330868.png',
  '/imgs/generated/showcase-case-2-idea-code-1784854334549.png',
  '/imgs/generated/showcase-case-3-notes-plan-1784854337121.png',
  '/imgs/generated/showcase-v3-case-2-code-1784854994466.png',
  '/imgs/generated/showcase-v3-case-3-plan-1784855038678.png',
  '/imgs/generated/showcase-v3b-case-3-plan-1784855108693.png',
  '/imgs/generated/showcase-v3c-case-3-plan-1784855150186.png',
  '/imgs/generated/url-clone.jpg',
  '/imgs/generated/web-motion.jpg',
  '/uploads/b57674b7e8dde7ae6fc45826074ab5dd.png',
];

interface CardItem {
  id: string;
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

function seededRandom(seed: number): () => number {
  return function () {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
}

function rectanglesOverlap(
  x1: number,
  y1: number,
  w1: number,
  h1: number,
  x2: number,
  y2: number,
  w2: number,
  h2: number,
  padding = 20
): boolean {
  return !(
    x1 + w1 + padding < x2 ||
    x2 + w2 + padding < x1 ||
    y1 + h1 + padding < y2 ||
    y2 + h2 + padding < y1
  );
}

function isInWorldCenterZone(
  absoluteX: number,
  absoluteY: number,
  width: number,
  height: number,
  exclusionWidth: number,
  exclusionHeight: number
): boolean {
  const zoneLeft = -exclusionWidth / 2;
  const zoneRight = exclusionWidth / 2;
  const zoneTop = -exclusionHeight / 2;
  const zoneBottom = exclusionHeight / 2;

  const cardRight = absoluteX + width;
  const cardBottom = absoluteY + height;

  return !(
    cardRight < zoneLeft ||
    absoluteX > zoneRight ||
    cardBottom < zoneTop ||
    absoluteY > zoneBottom
  );
}

function generateTileCards(
  tileX: number,
  tileY: number,
  tileSize: number,
  images: string[],
  cardCount: number,
  exclusionWidth: number,
  exclusionHeight: number,
  randomRotate: boolean
): CardItem[] {
  const seed = tileX * 10000 + tileY;
  const random = seededRandom(seed);

  const cards: CardItem[] = [];
  const maxAttempts = 50;

  for (let i = 0; i < cardCount; i++) {
    const imgIndex = Math.abs(tileX * cardCount + tileY + i) % images.length;

    const baseWidth = 240 + random() * 100;
    const aspectRatio = 1.2 + random() * 0.3;
    const height = baseWidth * aspectRatio;

    let x = 0;
    let y = 0;
    let attempts = 0;
    let validPosition = false;

    while (attempts < maxAttempts && !validPosition) {
      x = random() * (tileSize - baseWidth - 60) + 30;
      y = random() * (tileSize - height - 60) + 30;

      const absoluteX = tileX * tileSize + x;
      const absoluteY = tileY * tileSize + y;

      if (
        isInWorldCenterZone(
          absoluteX,
          absoluteY,
          baseWidth,
          height,
          exclusionWidth,
          exclusionHeight
        )
      ) {
        attempts++;
        continue;
      }

      validPosition = true;
      for (const existingCard of cards) {
        if (
          rectanglesOverlap(
            x,
            y,
            baseWidth,
            height,
            existingCard.x,
            existingCard.y,
            existingCard.width,
            existingCard.height
          )
        ) {
          validPosition = false;
          break;
        }
      }

      attempts++;
    }

    if (validPosition) {
      const rotation = randomRotate ? random() * 20 - 10 : 0;

      cards.push({
        id: `${tileX}-${tileY}-${i}`,
        src: images[imgIndex],
        x,
        y,
        width: baseWidth,
        height: height,
        rotation,
      });
    }
  }

  return cards;
}

interface InfiniteScrollCanvasProps {
  images?: string[];
  tileSize?: number;
  cardsPerTile?: number;
  className?: string;
  children?: React.ReactNode;
  centerExclusionWidth?: number;
  centerExclusionHeight?: number;
  randomRotate?: boolean;
}

export function InfiniteScrollCanvas({
  images = DEFAULT_IMAGES,
  tileSize = 800,
  cardsPerTile = 4,
  className,
  children,
  centerExclusionWidth = 700,
  centerExclusionHeight = 600,
  randomRotate = false,
}: InfiniteScrollCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef({ x: 0, y: 0 });
  const velocityRef = useRef({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const lastPosRef = useRef({ x: 0, y: 0 });
  const lastTimeRef = useRef(Date.now());
  const rafRef = useRef<number | null>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [visibleTiles, setVisibleTiles] = useState<
    { tileX: number; tileY: number; cards: CardItem[] }[]
  >([]);

  const updateVisibleTiles = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const { width, height } = container.getBoundingClientRect();
    const { x, y } = offsetRef.current;

    const buffer = 1;
    const startTileX = Math.floor(x / tileSize) - buffer;
    const startTileY = Math.floor(y / tileSize) - buffer;
    const endTileX = Math.ceil((x + width) / tileSize) + buffer;
    const endTileY = Math.ceil((y + height) / tileSize) + buffer;

    const tiles: { tileX: number; tileY: number; cards: CardItem[] }[] = [];

    for (let tx = startTileX; tx <= endTileX; tx++) {
      for (let ty = startTileY; ty <= endTileY; ty++) {
        tiles.push({
          tileX: tx,
          tileY: ty,
          cards: generateTileCards(
            tx,
            ty,
            tileSize,
            images,
            cardsPerTile,
            centerExclusionWidth,
            centerExclusionHeight,
            randomRotate
          ),
        });
      }
    }

    setVisibleTiles(tiles);
  }, [
    tileSize,
    images,
    cardsPerTile,
    centerExclusionWidth,
    centerExclusionHeight,
    randomRotate,
  ]);

  const updateTransform = useCallback(() => {
    if (contentRef.current) {
      const { x, y } = offsetRef.current;
      contentRef.current.style.transform = `translate3d(${-x}px, ${-y}px, 0)`;
    }
  }, []);

  const animate = useCallback(() => {
    if (isDraggingRef.current) {
      rafRef.current = requestAnimationFrame(animate);
      return;
    }

    const friction = 0.95;
    const minVelocity = 0.5;

    velocityRef.current.x *= friction;
    velocityRef.current.y *= friction;

    if (
      Math.abs(velocityRef.current.x) > minVelocity ||
      Math.abs(velocityRef.current.y) > minVelocity
    ) {
      offsetRef.current.x -= velocityRef.current.x;
      offsetRef.current.y -= velocityRef.current.y;
      updateTransform();
      updateVisibleTiles();
      rafRef.current = requestAnimationFrame(animate);
    } else {
      velocityRef.current = { x: 0, y: 0 };
    }
  }, [updateTransform, updateVisibleTiles]);

  const handleMouseDown = useCallback((e: ReactMouseEvent) => {
    isDraggingRef.current = true;
    setIsDragging(true);
    lastPosRef.current = { x: e.clientX, y: e.clientY };
    lastTimeRef.current = Date.now();
    velocityRef.current = { x: 0, y: 0 };

    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }
  }, []);

  const handleMouseMove = useCallback(
    (e: ReactMouseEvent) => {
      if (!isDraggingRef.current) return;

      const dx = e.clientX - lastPosRef.current.x;
      const dy = e.clientY - lastPosRef.current.y;
      const now = Date.now();
      const dt = now - lastTimeRef.current;

      if (dt > 0) {
        velocityRef.current.x = (dx / dt) * 16;
        velocityRef.current.y = (dy / dt) * 16;
      }

      offsetRef.current.x -= dx;
      offsetRef.current.y -= dy;
      lastPosRef.current = { x: e.clientX, y: e.clientY };
      lastTimeRef.current = now;

      updateTransform();
      updateVisibleTiles();
    },
    [updateTransform, updateVisibleTiles]
  );

  const handleMouseUp = useCallback(() => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    setIsDragging(false);
    rafRef.current = requestAnimationFrame(animate);
  }, [animate]);

  const handleTouchStart = useCallback((e: ReactTouchEvent) => {
    const touch = e.touches[0];
    isDraggingRef.current = true;
    setIsDragging(true);
    lastPosRef.current = { x: touch.clientX, y: touch.clientY };
    lastTimeRef.current = Date.now();
    velocityRef.current = { x: 0, y: 0 };

    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }
  }, []);

  const handleTouchMove = useCallback(
    (e: ReactTouchEvent) => {
      if (!isDraggingRef.current) return;
      e.preventDefault();

      const touch = e.touches[0];
      const dx = touch.clientX - lastPosRef.current.x;
      const dy = touch.clientY - lastPosRef.current.y;
      const now = Date.now();
      const dt = now - lastTimeRef.current;

      if (dt > 0) {
        velocityRef.current.x = (dx / dt) * 16;
        velocityRef.current.y = (dy / dt) * 16;
      }

      offsetRef.current.x -= dx;
      offsetRef.current.y -= dy;
      lastPosRef.current = { x: touch.clientX, y: touch.clientY };
      lastTimeRef.current = now;

      updateTransform();
      updateVisibleTiles();
    },
    [updateTransform, updateVisibleTiles]
  );

  const handleTouchEnd = useCallback(() => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    setIsDragging(false);
    rafRef.current = requestAnimationFrame(animate);
  }, [animate]);

  // Wheel events are intentionally NOT captured — vertical scroll should
  // bubble up and scroll the page past the hero, not pan the cards.
  // Card panning is reserved for explicit drag (mouse / touch).

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const { width, height } = container.getBoundingClientRect();
    offsetRef.current = { x: -width / 2, y: -height / 2 };

    updateVisibleTiles();
    updateTransform();

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [updateVisibleTiles, updateTransform]);

  useEffect(() => {
    const handleResize = () => updateVisibleTiles();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [updateVisibleTiles]);

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative isolate min-h-[560px] w-full overflow-hidden bg-[#f5f3f0] py-24 sm:py-28 dark:bg-neutral-950',
        isDragging ? 'cursor-grabbing' : 'cursor-grab',
        className
      )}
      style={{
        // Allow vertical page scroll to pass through (pan-y); only block
        // horizontal panning and pinch-zoom so the canvas drag experience
        // remains predictable on touch devices.
        touchAction: 'pan-y',
        WebkitUserSelect: 'none',
        userSelect: 'none',
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Dot grid background */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(circle, rgba(0,0,0,0.08) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />

      {/* Scrollable content layer */}
      <div
        ref={contentRef}
        className="absolute will-change-transform"
        style={{ transform: 'translate3d(0, 0, 0)' }}
      >
        {visibleTiles.map((tile) => (
          <div
            key={`${tile.tileX}-${tile.tileY}`}
            className="absolute"
            style={{
              left: tile.tileX * tileSize,
              top: tile.tileY * tileSize,
              width: tileSize,
              height: tileSize,
            }}
          >
            {tile.cards.map((card) => (
              <div
                key={card.id}
                className="absolute overflow-hidden rounded-lg bg-white p-1.5 shadow-lg ring-1 ring-black/5 dark:bg-neutral-800 dark:ring-white/10"
                style={{
                  left: card.x,
                  top: card.y,
                  transform: card.rotation
                    ? `rotate(${card.rotation}deg)`
                    : undefined,
                }}
              >
                <div
                  className="overflow-hidden rounded-md bg-neutral-100 dark:bg-neutral-700"
                  style={{ height: card.height - 12 }}
                >
                  <img
                    src={card.src}
                    alt=""
                    className="size-full object-cover object-left-top"
                    loading="lazy"
                    draggable={false}
                  />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Children overlay - pointer-events-none so the canvas keeps receiving
          drag/wheel events even when the cursor is over the text/CTA area.
          Interactive children (buttons/links) re-enable pointer events via
          the [&_a]:pointer-events-auto / [&_button]:pointer-events-auto
          rules below — only the actual <a> and <button> elements capture
          clicks, everything else passes through to the canvas. */}
      {children && (
        <div
          className="pointer-events-none absolute inset-0 z-10"
          children-container=""
        >
          <div className="pointer-events-none size-full [&_a]:pointer-events-auto [&_button]:pointer-events-auto">
            {children}
          </div>
        </div>
      )}
    </div>
  );
}
