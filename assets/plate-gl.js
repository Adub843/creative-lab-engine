// A small WebGL2 renderer for the plate maker: lit, flat-shaded plastic with soft shadows, so raised
// text and flowers read as real relief even from straight above. Units are millimetres, z up.
//   const r = createRenderer(canvas)       null when the browser has no WebGL2
//   r.draw(meshes, camera)                 meshes: [{ id, pos, matrix, color }]; camera: see below
// camera: { mode: "top", w, h } (orthographic, looking down at a w × h mm window centred on 0,0)
//      or { mode: "3d", yaw, pitch, radius, target } (perspective, orbiting the target)

// ---------- 4×4 matrices, column-major as WebGL wants them ----------
export const mat = {
  mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
    return o;
  },
  ortho(l, r, b, t, n, f) {
    return new Float32Array([2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, -2 / (f - n), 0, -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1]);
  },
  perspective(fovy, aspect, n, f) {
    const t = 1 / Math.tan(fovy / 2);
    return new Float32Array([t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, (2 * f * n) / (n - f), 0]);
  },
  lookAt(eye, at, up) {
    const z = norm(sub(eye, at)), x = norm(cross(up, z)), y = cross(z, x);
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
  },
  // Translate to (x, y, z), turn deg about z, then scale (sx, sy, sz): how items sit on the plate.
  place(x, y, z, deg, sx, sy, sz) {
    const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    return new Float32Array([c * sx, s * sx, 0, 0, -s * sy, c * sy, 0, 0, 0, 0, sz, 0, x, y, z, 1]);
  },
  identity: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
};
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
// Applies a placement matrix to a mesh (for export). A mirrored placement flips each triangle back
// so its faces still point outward.
export function transformMesh(pos, m) {
  const out = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    out[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
    out[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    out[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
  const det = m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
  if (det < 0) for (let i = 0; i < out.length; i += 9) for (let k = 0; k < 3; k++) [out[i + 3 + k], out[i + 6 + k]] = [out[i + 6 + k], out[i + 3 + k]];
  return out;
}

const VS = `#version 300 es
in vec3 p;
uniform mat4 uM, uVP, uL;
out vec3 vW;
out vec4 vL;
void main() { vec4 w = uM * vec4(p, 1.0); vW = w.xyz; vL = uL * w; gl_Position = uVP * w; }`;
const FS = `#version 300 es
precision highp float;
precision highp sampler2DShadow;
in vec3 vW;
in vec4 vL;
uniform vec3 uColor, uLight, uEye, uViewDir;
uniform float uOrtho, uTexel;
uniform sampler2DShadow uShadow;
out vec4 o;
void main() {
  vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
  vec3 v = uOrtho > 0.5 ? -uViewDir : normalize(uEye - vW);
  if (dot(n, v) < 0.0) n = -n;
  vec3 s = vL.xyz / vL.w * 0.5 + 0.5;
  float sh = 0.0;
  for (int x = -2; x <= 2; x++) for (int y = -2; y <= 2; y++)
    sh += texture(uShadow, vec3(s.xy + vec2(float(x), float(y)) * uTexel, s.z - 0.0006));
  sh /= 25.0;
  float lit = max(dot(n, uLight), 0.0) * sh;
  vec3 base = pow(uColor, vec3(2.2));
  vec3 h = normalize(uLight + v);
  float spec = pow(max(dot(n, h), 0.0), 60.0) * 0.16 * sh;
  float sky = 0.5 + 0.5 * n.z;
  vec3 c = base * (0.2 + 0.24 * sky + 0.78 * lit) + vec3(spec);
  o = vec4(pow(c, vec3(1.0 / 2.2)), 1.0);
}`;
const VS_DEPTH = `#version 300 es
in vec3 p;
uniform mat4 uM, uL;
void main() { gl_Position = uL * uM * vec4(p, 1.0); }`;
const FS_DEPTH = `#version 300 es
precision mediump float;
void main() {}`;

const SHADOW = 2048;
const rgb = (hex) => { const n = parseInt(String(hex).slice(1), 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };

export function createRenderer(canvas) {
  const gl = canvas.getContext("webgl2", { antialias: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true });
  if (!gl) return null;
  const program = (vs, fs) => {
    const p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    }
    gl.bindAttribLocation(p, 0, "p");
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = new Proxy({}, { get: (c, k) => (c[k] ??= gl.getUniformLocation(p, k)) });
    return { p, u };
  };
  const main = program(VS, FS), depth = program(VS_DEPTH, FS_DEPTH);

  const shadowTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, shadowTex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT32F, SHADOW, SHADOW);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
  const shadowFb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, shadowTex, 0);
  gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  // GPU buffers, kept while the same Float32Array is drawn again (moving an item only changes its matrix).
  const buffers = new Map(); // id -> { pos, vao, buf, count }
  const upload = (m) => {
    let b = buffers.get(m.id);
    if (b?.pos === m.pos) return b;
    if (b) { gl.deleteBuffer(b.buf); gl.deleteVertexArray(b.vao); }
    const vao = gl.createVertexArray(), buf = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, m.pos, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    b = { pos: m.pos, vao, buf, count: m.pos.length / 3 };
    buffers.set(m.id, b);
    return b;
  };

  function draw(meshes, cam) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.max(1, Math.round(canvas.clientWidth * dpr)), H = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    const live = new Set(meshes.map((m) => m.id));
    for (const [id, b] of buffers) if (!live.has(id)) { gl.deleteBuffer(b.buf); gl.deleteVertexArray(b.vao); buffers.delete(id); }
    const parts = meshes.filter((m) => m.pos?.length).map((m) => ({ ...m, b: upload(m) }));

    // The light: from the upper left, fairly high, like a softbox in a product shot.
    const light = norm([-0.5, 0.62, 0.95]);
    const R = cam.radius ?? Math.hypot(cam.w ?? 300, cam.h ?? 150) / 2 + 10;
    const target = cam.target ?? [0, 0, 0];
    const lightView = mat.lookAt([target[0] + light[0] * 2 * R, target[1] + light[1] * 2 * R, target[2] + light[2] * 2 * R], target, [0, 0, 1]);
    const L = mat.mul(mat.ortho(-R, R, -R, R, R * 0.5, R * 3.5), lightView);

    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    // 1. depth from the light, for the shadows
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFb);
    gl.viewport(0, 0, SHADOW, SHADOW);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1.5, 2);
    gl.useProgram(depth.p);
    gl.uniformMatrix4fv(depth.u.uL, false, L);
    for (const m of parts) { gl.uniformMatrix4fv(depth.u.uM, false, m.matrix); gl.bindVertexArray(m.b.vao); gl.drawArrays(gl.TRIANGLES, 0, m.b.count); }
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // 2. the view
    let VP, eye, viewDir, ortho = 0;
    if (cam.mode === "top") {
      const k = Math.max(cam.w / W, cam.h / H); // keep millimetres square
      const vw = (W * k) / 2, vh = (H * k) / 2;
      eye = [0, 0, 500]; viewDir = [0, 0, -1]; ortho = 1;
      VP = mat.mul(mat.ortho(-vw, vw, -vh, vh, 1, 1000), mat.lookAt(eye, [0, 0, 0], [0, 1, 0]));
    } else {
      const yaw = (cam.yaw * Math.PI) / 180, pitch = (cam.pitch * Math.PI) / 180, d = cam.distance;
      eye = [target[0] + d * Math.cos(pitch) * Math.sin(yaw), target[1] - d * Math.cos(pitch) * Math.cos(yaw), target[2] + d * Math.sin(pitch)];
      viewDir = norm(sub(target, eye));
      VP = mat.mul(mat.perspective((cam.fov * Math.PI) / 180, W / H, d / 20, d * 4), mat.lookAt(eye, target, [0, 0, 1]));
    }
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(main.p);
    gl.uniformMatrix4fv(main.u.uVP, false, VP);
    gl.uniformMatrix4fv(main.u.uL, false, L);
    gl.uniform3fv(main.u.uLight, light);
    gl.uniform3fv(main.u.uEye, eye);
    gl.uniform3fv(main.u.uViewDir, viewDir);
    gl.uniform1f(main.u.uOrtho, ortho);
    gl.uniform1f(main.u.uTexel, 1 / SHADOW);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, shadowTex);
    gl.uniform1i(main.u.uShadow, 0);
    for (const m of parts) {
      gl.uniformMatrix4fv(main.u.uM, false, m.matrix);
      gl.uniform3fv(main.u.uColor, rgb(m.color));
      gl.bindVertexArray(m.b.vao);
      gl.drawArrays(gl.TRIANGLES, 0, m.b.count);
    }
    gl.bindVertexArray(null);
  }
  return { draw, gl };
}
