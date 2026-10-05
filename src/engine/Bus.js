import mitt from 'mitt'

// Event bus global. Engine dan scene hanya bicara lewat bus ini (dan uniform global),
// supaya engine tidak pernah meng-import scene secara langsung.
// Event utama: prerender, render, postrender, resize, wheel, keydown, pointer_move,
// pointer_down, pointer_up, click, touch_drag, scroll_enable, scroll_disable.
export const bus = mitt()
