import '@testing-library/jest-dom/vitest'

// jsdom does not implement media playback; give tests harmless stand-ins.
Object.defineProperty(window.HTMLMediaElement.prototype, 'play', {
  configurable: true,
  value: function play(this: HTMLMediaElement) {
    this.dispatchEvent(new Event('play'))
    return Promise.resolve()
  },
})
Object.defineProperty(window.HTMLMediaElement.prototype, 'pause', {
  configurable: true,
  value: function pause(this: HTMLMediaElement) {
    this.dispatchEvent(new Event('pause'))
  },
})
Object.defineProperty(window.HTMLMediaElement.prototype, 'load', {
  configurable: true,
  value: () => {},
})
