import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

/**
 * WebGL MeshGradient — multi-blob radial-gradient flow rendered into a
 * `<canvas>`. Used as the decorative backdrop of the sign-in side panel.
 *
 * Renders an empty `<canvas>` during SSR; the WebGL pipeline only boots
 * inside `useEffect`, so there is no hydration mismatch. If WebGL is
 * unavailable (Safari < 15, headless tests, GPU disabled, etc.) or if
 * the user prefers reduced motion, we fall back to a static CSS gradient
 * layer that uses the same brand palette.
 */

type MeshGradientProps = {
  className?: string;
  /**
   * Up to 5 colours used as the moving blobs. The component falls back to a
   * built-in brand palette if omitted. Provide valid CSS colours — they are
   * resolved to RGB via `getComputedStyle` before upload.
   */
  colors?: string[];
  /** Animation speed multiplier; `0` freezes the gradient on the first frame. */
  speed?: number;
  /** Render-resolution multiplier. Cap at 1.75 to avoid burning laptops. */
  resolutionScale?: number;
  /** Force the static fallback even when WebGL is available. */
  paused?: boolean;
};

const DEFAULT_COLORS = [
  '#a78bfa', // violet-400
  '#818cf8', // indigo-400
  '#67e8f9', // cyan-300
  '#f0abfc', // fuchsia-300
  '#fde68a', // amber-200
];

function resolveCssColorToRGB(color: string): [number, number, number] {
  // Only invoked from inside useEffect, so `document` is always defined.
  const el = document.createElement('div');
  el.style.color = color;
  document.body.appendChild(el);
  const computed = getComputedStyle(el).color;
  document.body.removeChild(el);
  const match = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!match) return [241, 116, 99];
  return [
    parseInt(match[1], 10),
    parseInt(match[2], 10),
    parseInt(match[3], 10),
  ];
}

export function MeshGradient({
  className,
  colors = DEFAULT_COLORS,
  speed = 1,
  resolutionScale = 1,
  paused = false,
}: MeshGradientProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // `supported` flips to `false` the first time getContext('webgl') throws
  // (or returns null). It also stays `false` if the user has reduced motion.
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const prefersReduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;

    let glCtx: WebGLRenderingContext | null = null;
    try {
      glCtx = canvas.getContext('webgl', {
        premultipliedAlpha: true,
        alpha: true,
      });
    } catch {
      glCtx = null;
    }
    if (!glCtx) {
      setSupported(false);
      return;
    }
    const gl = glCtx;

    const getDpr = () =>
      Math.min(window.devicePixelRatio || 1, 1.75) * resolutionScale;

    const vertexSrc = `
      attribute vec2 a_position;
      varying vec2 v_uv;
      void main() {
        v_uv = a_position * 0.5 + 0.5;
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `;

    const fragmentSrc = `
      precision mediump float;
      varying vec2 v_uv;
      uniform vec2 u_resolution;
      uniform float u_time;
      uniform vec3 u_colors[5];

      float hash(vec2 p) {
        p = fract(p*vec2(123.34, 456.21));
        p += dot(p, p+45.32);
        return fract(p.x*p.y);
      }

      void main() {
        vec2 uv = v_uv;
        uv.x *= u_resolution.x / u_resolution.y;

        float t = u_time;
        vec2 p0 = 0.52 + 0.35*vec2(sin(0.7*t), cos(0.9*t));
        vec2 p1 = 0.48 + 0.35*vec2(sin(0.6*t+1.7), cos(0.8*t+2.3));
        vec2 p2 = 0.50 + 0.38*vec2(sin(0.9*t+0.7), cos(0.7*t+1.7));
        vec2 p3 = 0.46 + 0.33*vec2(sin(0.5*t+2.9), cos(1.1*t+0.2));
        vec2 p4 = 0.50 + 0.30*vec2(sin(0.8*t-1.4), cos(0.6*t-0.9));

        float d0 = distance(uv, p0);
        float d1 = distance(uv, p1);
        float d2 = distance(uv, p2);
        float d3 = distance(uv, p3);
        float d4 = distance(uv, p4);

        float w0 = smoothstep(0.85, 0.05, d0);
        float w1 = smoothstep(0.85, 0.05, d1);
        float w2 = smoothstep(0.90, 0.05, d2);
        float w3 = smoothstep(0.95, 0.05, d3);
        float w4 = smoothstep(0.90, 0.05, d4);

        vec3 col = vec3(0.0);
        col += u_colors[0] * w0;
        col += u_colors[1] * w1;
        col += u_colors[2] * w2;
        col += u_colors[3] * w3;
        col += u_colors[4] * w4;

        float wsum = w0 + w1 + w2 + w3 + w4 + 1e-3;
        col /= wsum;

        float g = hash(uv * u_resolution * 0.5 + u_time);
        col += (g - 0.5) * 0.02;

        float vign = smoothstep(1.1, 0.35, length(uv - vec2(0.5)));
        col *= vign;

        gl_FragColor = vec4(col, 1.0);
      }
    `;

    function compile(type: number, src: string) {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(
          'MeshGradient: shader compile error',
          gl.getShaderInfoLog(shader)
        );
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    }

    const vs = compile(gl.VERTEX_SHADER, vertexSrc);
    const fs = compile(gl.FRAGMENT_SHADER, fragmentSrc);
    if (!vs || !fs) {
      setSupported(false);
      return;
    }

    const program = gl.createProgram();
    if (!program) {
      setSupported(false);
      return;
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(
        'MeshGradient: program link error',
        gl.getProgramInfoLog(program)
      );
      setSupported(false);
      return;
    }
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );

    const aPos = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uResolution = gl.getUniformLocation(program, 'u_resolution');
    const uTime = gl.getUniformLocation(program, 'u_time');
    const uColors = gl.getUniformLocation(program, 'u_colors');

    const parseColors = () => {
      const resolved = [...colors];
      while (resolved.length < 5)
        resolved.push(resolved[resolved.length - 1] ?? '#ffffff');
      const rgb = resolved.slice(0, 5).map((c) => {
        const [r, g, b] = resolveCssColorToRGB(c);
        return [r / 255, g / 255, b / 255] as [number, number, number];
      });
      return rgb.flat();
    };

    const resize = () => {
      const dpr = getDpr();
      const { clientWidth, clientHeight } = canvas;
      const w = Math.max(1, Math.floor(clientWidth * dpr));
      const h = Math.max(1, Math.floor(clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uResolution, canvas.width, canvas.height);
    };
    resize();
    window.addEventListener('resize', resize);

    gl.uniform3fv(uColors, new Float32Array(parseColors()));

    let rafId = 0;
    const start = performance.now();
    const tick = () => {
      const now = performance.now();
      const t =
        ((now - start) / 1000) * (paused || prefersReduced ? 0.0 : speed);
      gl.uniform1f(uTime, t);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      if (!paused && !prefersReduced) {
        rafId = requestAnimationFrame(tick);
      }
    };
    if (!paused && !prefersReduced) {
      rafId = requestAnimationFrame(tick);
    } else {
      // Reduced motion / paused → draw one static frame.
      tick();
    }

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      gl.useProgram(null);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buffer);
      // Help the browser release the GL context right away so repeated
      // mounts (e.g. React Strict Mode double-invoke) don't pile up.
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, [colors, speed, resolutionScale, paused]);

  if (!supported) {
    // Static CSS fallback — same brand palette, no animation, always renders.
    return (
      <div
        aria-hidden="true"
        className={cn(
          'absolute inset-0',
          'bg-[radial-gradient(circle_at_30%_20%,#a78bfa_0%,transparent_50%),radial-gradient(circle_at_70%_30%,#67e8f9_0%,transparent_55%),radial-gradient(circle_at_50%_80%,#f0abfc_0%,transparent_60%),linear-gradient(135deg,#ede9fe_0%,#e0f2fe_60%,#fce7f3_100%)]',
          'dark:bg-[radial-gradient(circle_at_30%_20%,#6d28d9_0%,transparent_50%),radial-gradient(circle_at_70%_30%,#0e7490_0%,transparent_55%),radial-gradient(circle_at_50%_80%,#a21caf_0%,transparent_60%),linear-gradient(135deg,#1e1b4b_0%,#082f49_60%,#4a044e_100%)]',
          className
        )}
      />
    );
  }

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={cn('h-full w-full', className)}
    />
  );
}
