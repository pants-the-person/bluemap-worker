/*!
 * CRTFilterWebGL — WebGL CRT post-processing shader for HTML5 & WebGL Canvases
 *
 * Adapted from Ichiaka/CRTFilter (https://github.com/Ichiaka/CRTFilter)
 * Original work Copyright (c) 2025 Aka — MIT License
 *
 * Adaptations for BlueMap 98 (Three.js WebGL2 canvas):
 * - Direct GPU-to-GPU texImage2D upload from a WebGL source canvas (no 2D getImageData).
 * - Non-destructive pointer-events:none overlay so native mouse/wheel/touch controls stay intact.
 * - Fixed full-screen clip-space quad, color math, pre-sample jitter/tearing,
 *   pixel-aligned scanlines/aperture-grille, curved bezel vignette, ResizeObserver,
 *   cached uniform locations, and hidden-tab rAF pause.
 */
(() => {
  const PRESETS = {
    subtle: {
      barrelDistortion: 0.02,
      curvature: 0.015,
      chromaticAberration: 0.0007,
      staticNoise: 0.015,
      horizontalTearing: 0.0,
      glowBloom: 0.12,
      verticalJitter: 0.0,
      retraceLines: true,
      scanlineIntensity: 0.16,
      dotMask: true,
      dotMaskIntensity: 0.07,
      brightness: 1.04,
      contrast: 1.04,
      desaturation: 0.02,
      flicker: 0.004,
      signalLoss: 0.0,
      vignette: 0.25,
    },
    trinitron: {
      barrelDistortion: 0.045,
      curvature: 0.035,
      chromaticAberration: 0.0014,
      staticNoise: 0.03,
      horizontalTearing: 0.00018,
      glowBloom: 0.24,
      verticalJitter: 0.00025,
      retraceLines: true,
      scanlineIntensity: 0.30,
      dotMask: true,
      dotMaskIntensity: 0.14,
      brightness: 1.08,
      contrast: 1.09,
      desaturation: 0.05,
      flicker: 0.009,
      signalLoss: 0.02,
      vignette: 0.42,
    },
    heavy: {
      barrelDistortion: 0.09,
      curvature: 0.07,
      chromaticAberration: 0.0028,
      staticNoise: 0.06,
      horizontalTearing: 0.0006,
      glowBloom: 0.38,
      verticalJitter: 0.0007,
      retraceLines: true,
      scanlineIntensity: 0.44,
      dotMask: true,
      dotMaskIntensity: 0.22,
      brightness: 1.12,
      contrast: 1.14,
      desaturation: 0.10,
      flicker: 0.016,
      signalLoss: 0.055,
      vignette: 0.62,
    },
  };

  const VERTEX_SHADER_SRC = `
    attribute vec2 a_position;
    varying vec2 v_texCoord;
    void main() {
      v_texCoord = vec2(a_position.x * 0.5 + 0.5, 0.5 - a_position.y * 0.5);
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  const FRAGMENT_SHADER_SRC = `
    precision highp float;

    varying vec2 v_texCoord;
    uniform sampler2D u_texture;
    uniform vec2 u_resolution;
    uniform float u_time;

    uniform float u_barrel;
    uniform float u_curvature;
    uniform float u_aberration;
    uniform float u_noise;
    uniform float u_tearing;
    uniform float u_glow;
    uniform float u_jitter;
    uniform bool u_retrace;
    uniform float u_scanlineIntensity;
    uniform bool u_dotMask;
    uniform float u_dotMaskIntensity;
    uniform float u_brightness;
    uniform float u_contrast;
    uniform float u_desaturation;
    uniform float u_flicker;
    uniform float u_signalLoss;
    uniform float u_vignette;

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    vec2 applyBarrel(vec2 uv, float amount) {
      vec2 centered = uv - 0.5;
      float r2 = dot(centered, centered);
      // Overscan compensation so curved glass stays 100% full-bleed with no black borders
      float overscan = 1.0 / (1.0 + 0.5 * amount);
      return clamp(0.5 + centered * (1.0 + amount * r2) * overscan, 0.0, 1.0);
    }

    void main() {
      float curveAmt = u_barrel + u_curvature;
      vec2 uv = applyBarrel(v_texCoord, curveAmt);

      // Subtle pre-sample horizontal tearing & vertical sync jitter
      if (u_tearing > 0.0) {
        float tearWave = sin(uv.y * 14.0 + u_time * 2.5) * pow(max(0.0, sin(uv.y * 3.0 - u_time * 0.7)), 6.0);
        uv.x += tearWave * u_tearing;
      }
      if (u_jitter > 0.0) {
        uv.y += sin(u_time * 31.0) * u_jitter * step(0.96, fract(sin(u_time * 1.7) * 43758.5453));
      }

      // Edge-weighted RGB chromatic aberration (crisp center, vintage edge fringing)
      vec2 centered = uv - 0.5;
      float edgeFactor = 0.55 + 1.8 * dot(centered, centered);
      float ca = u_aberration * edgeFactor;

      vec3 col;
      col.r = texture2D(u_texture, vec2(clamp(uv.x + ca, 0.0, 1.0), uv.y)).r;
      col.g = texture2D(u_texture, uv).g;
      col.b = texture2D(u_texture, vec2(clamp(uv.x - ca, 0.0, 1.0), uv.y)).b;

      // Phosphor glow bloom (5-tap cross sample around bright areas)
      if (u_glow > 0.0) {
        vec2 texel = 2.0 / max(u_resolution, vec2(1.0));
        vec3 blur =
          texture2D(u_texture, clamp(uv + vec2(texel.x, 0.0), 0.0, 1.0)).rgb +
          texture2D(u_texture, clamp(uv - vec2(texel.x, 0.0), 0.0, 1.0)).rgb +
          texture2D(u_texture, clamp(uv + vec2(0.0, texel.y), 0.0, 1.0)).rgb +
          texture2D(u_texture, clamp(uv - vec2(0.0, texel.y), 0.0, 1.0)).rgb;
        blur *= 0.25;
        vec3 bright = smoothstep(0.55, 1.0, blur) * blur;
        col += bright * u_glow;
      }

      // Animated analog static grain
      if (u_noise > 0.0) {
        float n = hash12(gl_FragCoord.xy + fract(u_time * 13.7) * 1000.0) - 0.5;
        col += n * u_noise;
      }

      // Pixel-aligned horizontal scanlines (moiré-free at any resolution)
      if (u_scanlineIntensity > 0.0) {
        float scan = sin(gl_FragCoord.y * 3.14159265);
        float scanMask = 1.0 - u_scanlineIntensity * (0.5 - 0.5 * scan * scan);
        col *= scanMask;
      }

      // Rolling CRT retrace refresh band
      if (u_retrace) {
        float sweepY = fract(u_time * 0.18);
        float band = exp(-pow((uv.y - sweepY) * 16.0, 2.0));
        col *= 1.0 + 0.055 * band;
      }

      // Subtle UHF / VHS signal interference wave
      if (u_signalLoss > 0.0) {
        float sig = abs(sin(uv.y * 42.0 + u_time * 6.5));
        col *= 1.0 - (u_signalLoss * pow(sig, 8.0));
      }

      // Sony Trinitron-style RGB aperture grille / dot mask
      if (u_dotMask && u_dotMaskIntensity > 0.0) {
        float triad = mod(floor(gl_FragCoord.x), 3.0);
        vec3 mask = vec3(
          triad < 0.5 ? 1.0 : 1.0 - u_dotMaskIntensity,
          (triad >= 0.5 && triad < 1.5) ? 1.0 : 1.0 - u_dotMaskIntensity,
          triad >= 1.5 ? 1.0 : 1.0 - u_dotMaskIntensity
        );
        col *= mask;
      }

      // Desaturation, contrast & brightness
      float luma = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(luma), col, 1.0 - u_desaturation);
      col = (col - 0.5) * u_contrast + 0.5;
      col *= u_brightness;

      // Subtle CRT refresh flicker
      if (u_flicker > 0.0) {
        col *= 1.0 + u_flicker * sin(u_time * 55.0);
      }

      // Subtle CRT edge vignette (no black border)
      float vig = 1.0 - u_vignette * dot(centered * 1.35, centered * 1.35);
      col *= clamp(vig, 0.4, 1.0);

      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `;

  class CRTFilterWebGL {
    constructor(canvas, config = {}) {
      this.sourceCanvas = canvas;
      this.supported = false;
      this.running = false;
      this.animationFrameId = null;
      this.resizeObserver = null;
      this.config = Object.assign({}, PRESETS.trinitron, config);

      if (!canvas) return;

      this.glcanvas = document.createElement("canvas");
      this.glcanvas.className = "pp98-crt-canvas";
      this.glcanvas.setAttribute("aria-hidden", "true");

      const ctxAttrs = {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false,
        powerPreference: "high-performance",
      };
      this.gl =
        this.glcanvas.getContext("webgl2", ctxAttrs) ||
        this.glcanvas.getContext("webgl", ctxAttrs);

      if (!this.gl) return;

      if (!this.initShaders()) return;
      this.initBuffers();
      this.initTexture();
      this.syncSize();
      this.supported = true;

      this._onVisibilityChange = () => {
        if (!this.running) return;
        if (document.hidden) {
          if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
          }
        } else if (!this.animationFrameId) {
          this.renderCRT();
        }
      };

      this._onContextLost = (e) => {
        e.preventDefault();
        if (this.animationFrameId) {
          cancelAnimationFrame(this.animationFrameId);
          this.animationFrameId = null;
        }
      };

      this._onContextRestored = () => {
        if (this.initShaders()) {
          this.initBuffers();
          this.initTexture();
          this.syncSize();
          if (this.running && !document.hidden) this.renderCRT();
        }
      };

      this.glcanvas.addEventListener("webglcontextlost", this._onContextLost, false);
      this.glcanvas.addEventListener("webglcontextrestored", this._onContextRestored, false);
      document.addEventListener("visibilitychange", this._onVisibilityChange);
    }

    createShader(type, source) {
      const gl = this.gl;
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error("[CRTFilterWebGL] Shader compile error:", gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    }

    initShaders() {
      const gl = this.gl;
      const vs = this.createShader(gl.VERTEX_SHADER, VERTEX_SHADER_SRC);
      const fs = this.createShader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SRC);
      if (!vs || !fs) return false;

      const program = gl.createProgram();
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error("[CRTFilterWebGL] Program link error:", gl.getProgramInfoLog(program));
        return false;
      }

      this.program = program;
      gl.useProgram(program);

      const u = (name) => gl.getUniformLocation(program, name);
      this.uniforms = {
        texture: u("u_texture"),
        resolution: u("u_resolution"),
        time: u("u_time"),
        barrel: u("u_barrel"),
        curvature: u("u_curvature"),
        aberration: u("u_aberration"),
        noise: u("u_noise"),
        tearing: u("u_tearing"),
        glow: u("u_glow"),
        jitter: u("u_jitter"),
        retrace: u("u_retrace"),
        scanlineIntensity: u("u_scanlineIntensity"),
        dotMask: u("u_dotMask"),
        dotMaskIntensity: u("u_dotMaskIntensity"),
        brightness: u("u_brightness"),
        contrast: u("u_contrast"),
        desaturation: u("u_desaturation"),
        flicker: u("u_flicker"),
        signalLoss: u("u_signalLoss"),
        vignette: u("u_vignette"),
      };

      return true;
    }

    initBuffers() {
      const gl = this.gl;
      this.vertexBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
      const vertices = new Float32Array([
        -1, -1,
         1, -1,
        -1,  1,
        -1,  1,
         1, -1,
         1,  1,
      ]);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

      const posLoc = gl.getAttribLocation(this.program, "a_position");
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    }

    initTexture() {
      const gl = this.gl;
      this.texture = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1i(this.uniforms.texture, 0);
    }

    syncSize() {
      if (!this.sourceCanvas || !this.gl) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(this.sourceCanvas.clientWidth * dpr) || this.sourceCanvas.width || 1);
      const h = Math.max(1, Math.round(this.sourceCanvas.clientHeight * dpr) || this.sourceCanvas.height || 1);
      if (this.glcanvas.width !== w || this.glcanvas.height !== h) {
        this.glcanvas.width = w;
        this.glcanvas.height = h;
      }
      this.gl.viewport(0, 0, this.glcanvas.width, this.glcanvas.height);
    }

    setConfig(partial) {
      Object.assign(this.config, partial);
    }

    setPreset(name) {
      const preset = PRESETS[name];
      if (preset) {
        this.config = Object.assign({}, preset);
      }
    }

    renderCRT() {
      if (!this.running || !this.supported || !this.sourceCanvas) return;
      if (document.hidden) {
        this.animationFrameId = null;
        return;
      }

      const gl = this.gl;
      if (this.sourceCanvas.width > 0 && this.sourceCanvas.height > 0) {
        this.syncSize();
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          this.sourceCanvas,
        );

        gl.useProgram(this.program);
        const u = this.uniforms;
        const c = this.config;
        gl.uniform2f(u.resolution, this.glcanvas.width, this.glcanvas.height);
        gl.uniform1f(u.time, performance.now() * 0.001);
        gl.uniform1f(u.barrel, c.barrelDistortion);
        gl.uniform1f(u.curvature, c.curvature);
        gl.uniform1f(u.aberration, c.chromaticAberration);
        gl.uniform1f(u.noise, c.staticNoise);
        gl.uniform1f(u.tearing, c.horizontalTearing);
        gl.uniform1f(u.glow, c.glowBloom);
        gl.uniform1f(u.jitter, c.verticalJitter);
        gl.uniform1i(u.retrace, c.retraceLines ? 1 : 0);
        gl.uniform1f(u.scanlineIntensity, c.scanlineIntensity);
        gl.uniform1i(u.dotMask, c.dotMask ? 1 : 0);
        gl.uniform1f(u.dotMaskIntensity, c.dotMaskIntensity);
        gl.uniform1f(u.brightness, c.brightness);
        gl.uniform1f(u.contrast, c.contrast);
        gl.uniform1f(u.desaturation, c.desaturation);
        gl.uniform1f(u.flicker, c.flicker);
        gl.uniform1f(u.signalLoss, c.signalLoss);
        gl.uniform1f(u.vignette, c.vignette);

        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }

      this.animationFrameId = requestAnimationFrame(() => this.renderCRT());
    }

    start() {
      if (!this.supported || this.running) return this.supported;
      if (!this.glcanvas.isConnected && this.sourceCanvas.parentNode) {
        // Insert right after BlueMap's WebGL canvas so CSS2D markers stay crisp above it
        // and native pointer/wheel/touch events pass through straight to sourceCanvas.
        this.sourceCanvas.insertAdjacentElement("afterend", this.glcanvas);
      }
      this.glcanvas.style.display = "block";
      this.running = true;

      if (!this.resizeObserver && typeof ResizeObserver !== "undefined") {
        this.resizeObserver = new ResizeObserver(() => this.syncSize());
        this.resizeObserver.observe(this.sourceCanvas);
      }

      if (!document.hidden) {
        this.renderCRT();
      }
      return true;
    }

    stop() {
      this.running = false;
      if (this.animationFrameId) {
        cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
      }
      if (this.glcanvas) {
        this.glcanvas.style.display = "none";
      }
    }
  }

  CRTFilterWebGL.PRESETS = PRESETS;
  window.CRTFilterWebGL = CRTFilterWebGL;
})();
