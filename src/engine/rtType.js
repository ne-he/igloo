import { HalfFloatType, FloatType, UnsignedByteType } from 'three'

// Fallback render target float (M8). WebGL2 hanya bisa MERENDER ke tekstur HalfFloat/Float kalau
// EXT_color_buffer_float (atau EXT_color_buffer_half_float) tersedia. Sebagian GPU HP lama tidak punya,
// dan tanpa cek ini semua RT HalfFloat jadi framebuffer incomplete: layar hitam + banjir warning GL.
// Cek sekali per renderer dengan framebuffer uji sungguhan (ekstensi saja tidak selalu jujur),
// log sekali, lalu semua RT engine memakai UnsignedByte (banding sedikit, tapi tetap jalan).

const cache = new WeakMap()

function probe(renderer) {
  const gl = renderer.getContext()
  // three r165 sudah memanggil getExtension untuk dua ekstensi ini saat init, has() hanya membaca hasilnya
  const ext = renderer.extensions
  const half = ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float')
  const full = ext.has('EXT_color_buffer_float')
  const test = (internalFormat, type) => {
    const tex = gl.createTexture()
    const fb = gl.createFramebuffer()
    const prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING)
    const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, gl.RGBA, type, null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
    gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb)
    gl.bindTexture(gl.TEXTURE_2D, prevTex)
    gl.deleteFramebuffer(fb)
    gl.deleteTexture(tex)
    return ok
  }
  const res = {
    half: half && test(gl.RGBA16F, gl.HALF_FLOAT),
    float: full && test(gl.RGBA32F, gl.FLOAT),
  }
  // state GL diubah di luar three: paksa three membaca ulang binding berikutnya
  renderer.state.reset()
  if (!res.half) {
    console.warn('[engine] render target HalfFloat tidak bisa dirender di GPU ini (EXT_color_buffer_float tidak ada), fallback ke UnsignedByte')
  }
  return res
}

/** Hasil cek kemampuan render float, di-cache per renderer. */
export function floatSupport(renderer) {
  if (!cache.has(renderer)) cache.set(renderer, probe(renderer))
  return cache.get(renderer)
}

/**
 * Tipe RT yang aman: `wanted` (HalfFloatType default, atau FloatType) kalau bisa dirender,
 * turun ke HalfFloat lalu UnsignedByte kalau tidak.
 */
export function renderTargetType(renderer, wanted = HalfFloatType) {
  const s = floatSupport(renderer)
  if (wanted === FloatType && s.float) return FloatType
  if ((wanted === FloatType || wanted === HalfFloatType) && s.half) return HalfFloatType
  if (wanted === FloatType || wanted === HalfFloatType) return UnsignedByteType
  return wanted
}
