import { Vector2 } from 'three'
import { bus } from './Bus.js'
import { clamp, frictionFPS } from './math.js'

const CLICK_MAX_PX = 15
const CLICK_MAX_MS = 500
const LINE_PX = 33 // deltaMode 1 (baris) dikonversi ke piksel, berlaku untuk semua browser

// Pointer, wheel, keyboard, dan drag sentuh. Semua dikirim lewat bus.
export class Input {
  constructor(el) {
    this.el = el
    this.position = new Vector2() // px
    this.position01 = new Vector2(0.5, 0.5) // 0..1, y ke atas
    this.position11 = new Vector2() // -1..1, y ke atas
    this.delta01 = new Vector2()
    this.velocity = new Vector2()
    this.isDown = false
    this.pointerType = 'mouse'
    this._downAt = 0
    this._downPos = new Vector2()
    this._last01 = new Vector2(0.5, 0.5)

    el.addEventListener('pointerdown', (e) => this._onDown(e))
    el.addEventListener('pointermove', (e) => this._onMove(e))
    window.addEventListener('pointerup', (e) => this._onUp(e))
    window.addEventListener('pointercancel', (e) => this._onUp(e))
    el.addEventListener('wheel', (e) => this._onWheel(e), { passive: false })
    el.addEventListener('contextmenu', (e) => e.preventDefault())
    el.addEventListener('dblclick', (e) => e.preventDefault())
    window.addEventListener('keydown', (e) => bus.emit('keydown', e))
    bus.on('prerender', ({ ratio }) => this._friction(ratio))
  }

  _setFromEvent(e) {
    const r = this.el.getBoundingClientRect()
    this.position.set(e.clientX - r.left, e.clientY - r.top)
    this.position01.set(this.position.x / r.width, 1 - this.position.y / r.height)
    this.position11.set(this.position01.x * 2 - 1, this.position01.y * 2 - 1)
  }

  _onDown(e) {
    this.pointerType = e.pointerType
    this._setFromEvent(e)
    this.isDown = true
    this._downAt = performance.now()
    this._downPos.copy(this.position)
    this._last01.copy(this.position01)
    if (e.pointerType !== 'mouse') this.el.setPointerCapture?.(e.pointerId)
    bus.emit('pointer_down', this)
  }

  _onMove(e) {
    this.pointerType = e.pointerType
    this._setFromEvent(e)
    this.delta01.subVectors(this.position01, this._last01)
    this._last01.copy(this.position01)
    this.velocity.x = clamp(this.velocity.x + this.delta01.x, -1, 1)
    this.velocity.y = clamp(this.velocity.y + this.delta01.y, -1, 1)
    bus.emit('pointer_move', this)
    // Drag sentuh menggerakkan scroll. Drag mouse tidak (desktop pakai wheel). [?] cek perilaku igloo di desktop
    if (this.isDown && e.pointerType !== 'mouse') bus.emit('touch_drag', this.delta01)
  }

  _onUp(e) {
    if (!this.isDown) return
    this.isDown = false
    const moved = this.position.distanceTo(this._downPos)
    const held = performance.now() - this._downAt
    bus.emit('pointer_up', this)
    if (moved < CLICK_MAX_PX && held < CLICK_MAX_MS) bus.emit('click', this)
  }

  _onWheel(e) {
    e.preventDefault()
    let dy = e.deltaY
    if (e.deltaMode === 1) dy *= LINE_PX
    else if (e.deltaMode === 2) dy *= window.innerHeight
    bus.emit('wheel', { deltaY: dy, pinch: e.ctrlKey })
  }

  _friction(ratio) {
    this.velocity.multiplyScalar(frictionFPS(0.95, ratio))
  }
}
